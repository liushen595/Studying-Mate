import {
  LLMRequestError,
  type LLMCallOptions,
  type LLMCallResult,
  type LLMUsage,
  type ProviderProfile,
} from '../../types/llm';
import { buildHttpErrorDetail, buildNetworkErrorDetail } from './errors';
import { consumeSSEStream } from './sse';

function stripTrailingSlash(url: string): string {
  return url.trim().replace(/\/+$/, '');
}

function parseExtraBody(raw: string): Record<string, unknown> {
  if (!raw || !raw.trim()) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function validateBeforeRequest(profile: ProviderProfile, options: LLMCallOptions) {
  const endpointHint = profile.baseUrl || '(未填写 Base URL)';
  if (!profile.baseUrl.trim()) {
    throw new LLMRequestError({
      kind: 'validation',
      message:
        profile.presetKey === 'dashscope'
          ? '请先在设置中填写阿里云百炼「业务空间专属域名」（Workspace ID 与地域）'
          : '请先在设置中填写供应商 Base URL',
      endpoint: endpointHint,
      modelId: profile.modelId,
      hintZh:
        profile.presetKey === 'dashscope'
          ? '登录阿里云百炼控制台 → 业务空间管理，复制业务空间 ID 并选择地域，或直接粘贴完整 Base URL。'
          : '打开右上角「模型设置」填写有效的 API Base URL。',
      timestamp: Date.now(),
    });
  }
  if (!profile.apiKey.trim()) {
    throw new LLMRequestError({
      kind: 'validation',
      message: `请先为「${profile.name}」填写 API Key`,
      endpoint: profile.baseUrl,
      modelId: profile.modelId,
      hintZh: 'API Key 仅保存在您的本地浏览器中，不会上传到任何第三方服务器。',
      timestamp: Date.now(),
    });
  }
  if (!profile.modelId.trim()) {
    throw new LLMRequestError({
      kind: 'validation',
      message: `请先为「${profile.name}」指定模型 ID`,
      endpoint: profile.baseUrl,
      modelId: '(空)',
      timestamp: Date.now(),
    });
  }
  if (options.images && options.images.length > 0 && !profile.capabilities.vision) {
    throw new LLMRequestError({
      kind: 'validation',
      message: `当前模型「${profile.modelId}」不支持图像输入（Vision）`,
      endpoint: profile.baseUrl,
      modelId: profile.modelId,
      hintZh:
        '请在设置页将「视觉 OCR 模型槽位」切换为支持识图的模型（例如 DeepSeek 的 deepseek-flash、阿里云百炼的 qwen3-vl-plus、Gemini 或 GPT-5）。',
      timestamp: Date.now(),
    });
  }
}

function resolveStructuredMode(profile: ProviderProfile, options: LLMCallOptions) {
  if (!options.expectJson) return 'none' as const;
  const preferred = profile.params.structuredOutputMode;
  const supported = profile.capabilities.structuredOutput;

  if (preferred === 'prompt_only') return 'prompt_only' as const;
  if (preferred === 'json_schema' && options.jsonSchema && supported.includes('json_schema')) {
    return 'json_schema' as const;
  }
  if (preferred === 'json_object' && supported.includes('json_object')) {
    return 'json_object' as const;
  }
  // Auto selection
  if (options.jsonSchema && supported.includes('json_schema')) {
    return 'json_schema' as const;
  }
  if (supported.includes('json_object')) {
    return 'json_object' as const;
  }
  return 'prompt_only' as const;
}

/**
 * Determine whether sampling params should be omitted to prevent HTTP 400
 */
function shouldOmitSampling(profile: ProviderProfile): boolean {
  const { capabilities, params } = profile;
  if (capabilities.alwaysOnThinking && capabilities.disableSamplingWhenThinking) {
    return true;
  }
  if (params.thinking.enabled && capabilities.disableSamplingWhenThinking) {
    return true;
  }
  return false;
}

function resolveStreamFlag(profile: ProviderProfile): boolean {
  if (profile.params.thinking.enabled && profile.capabilities.streamRequiredWhenThinking) {
    return true;
  }
  return profile.params.stream;
}

function buildOpenAICompatibleRequest(profile: ProviderProfile, options: LLMCallOptions) {
  const base = stripTrailingSlash(profile.baseUrl);
  const endpoint = base.endsWith('/chat/completions') ? base : `${base}/chat/completions`;
  const { params, capabilities, presetKey, modelId } = profile;
  const stream = resolveStreamFlag(profile);
  const omitSampling = shouldOmitSampling(profile);
  const structuredMode = resolveStructuredMode(profile, options);

  const userContent: unknown =
    options.images && options.images.length > 0
      ? [
          { type: 'text', text: options.userPrompt },
          ...options.images.map((img) => ({
            type: 'image_url',
            image_url: {
              url: `data:${img.mimeType};base64,${img.base64}`,
              ...(presetKey === 'openai' || presetKey === 'deepseek'
                ? { detail: params.imageDetail }
                : {}),
            },
          })),
        ]
      : options.userPrompt;

  const body: Record<string, unknown> = {
    model: modelId,
    messages: [
      { role: 'system', content: options.systemPrompt },
      { role: 'user', content: userContent },
    ],
    stream,
  };

  if (stream && (presetKey === 'openai' || presetKey === 'dashscope' || presetKey === 'deepseek')) {
    body.stream_options = { include_usage: true };
  }

  // Output token field: OpenAI reasoning / GPT-5 uses max_completion_tokens
  const useMaxCompletionTokens =
    presetKey === 'openai' && (/^(o\d|gpt-5)/i.test(modelId) || capabilities.thinkingVariant === 'openai-chat');
  if (params.maxOutputTokens > 0) {
    if (useMaxCompletionTokens) {
      body.max_completion_tokens = params.maxOutputTokens;
    } else {
      body.max_tokens = params.maxOutputTokens;
    }
  }

  // Thinking / Reasoning parameters per provider spec (Section 4.4)
  const variant = capabilities.thinkingVariant;
  if (variant === 'deepseek' || presetKey === 'deepseek') {
    if (params.thinking.enabled) {
      body.thinking = { type: 'enabled' };
      const effort = params.thinking.effort;
      if (effort && effort !== 'none') {
        // DeepSeek supports low / high / max (medium maps to high)
        body.reasoning_effort = effort === 'medium' || effort === 'minimal' ? 'high' : effort === 'xhigh' ? 'max' : effort;
      }
    } else {
      body.thinking = { type: 'disabled' };
      body.reasoning_effort = 'none';
    }
  } else if (variant === 'dashscope' || presetKey === 'dashscope') {
    if (capabilities.thinking.includes('toggle')) {
      body.enable_thinking = params.thinking.enabled;
      if (params.thinking.enabled && params.thinking.budgetTokens && params.thinking.budgetTokens > 0) {
        body.thinking_budget = Math.floor(params.thinking.budgetTokens);
      }
    }
  } else if (variant === 'openai-chat') {
    if (params.thinking.enabled || capabilities.alwaysOnThinking) {
      const allowed = capabilities.supportedEfforts;
      let effort = params.thinking.effort || 'medium';
      if (allowed && !allowed.includes(effort)) {
        effort = allowed.includes('medium') ? 'medium' : allowed[0];
      }
      body.reasoning_effort = effort;
    } else if (capabilities.supportedEfforts?.includes('none')) {
      body.reasoning_effort = 'none';
    }
  }

  // Sampling parameters (strictly omitted when incompatible)
  if (!omitSampling) {
    if (params.temperature !== null) body.temperature = params.temperature;
    if (params.topP !== null) body.top_p = params.topP;
    if (params.topK !== null && capabilities.supportsTopK) body.top_k = params.topK;
    if (params.frequencyPenalty !== null && capabilities.supportsFrequencyPenalty) {
      body.frequency_penalty = params.frequencyPenalty;
    }
    if (params.presencePenalty !== null && capabilities.supportsPresencePenalty) {
      body.presence_penalty = params.presencePenalty;
    }
  }
  if (params.seed !== null && capabilities.supportsSeed) body.seed = params.seed;
  if (params.stopSequences.length > 0) body.stop = params.stopSequences;

  // Structured Output
  if (structuredMode === 'json_schema' && options.jsonSchema) {
    body.response_format = {
      type: 'json_schema',
      json_schema: {
        name: options.jsonSchema.name,
        strict: true,
        schema: options.jsonSchema.schema,
      },
    };
  } else if (structuredMode === 'json_object') {
    body.response_format = { type: 'json_object' };
  }

  // Merge user extraBody last
  const extra = parseExtraBody(params.extraBodyJson);
  Object.assign(body, extra);

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${profile.apiKey.trim()}`,
    ...params.customHeaders,
  };

  return { endpoint, headers, body, stream };
}

function buildOpenAIResponsesRequest(profile: ProviderProfile, options: LLMCallOptions) {
  const base = stripTrailingSlash(profile.baseUrl);
  const endpoint = base.endsWith('/responses') ? base : `${base}/responses`;
  const { params, capabilities, modelId } = profile;
  const stream = resolveStreamFlag(profile);
  const omitSampling = shouldOmitSampling(profile);
  const structuredMode = resolveStructuredMode(profile, options);

  const userParts: unknown[] = [{ type: 'input_text', text: options.userPrompt }];
  if (options.images && options.images.length > 0) {
    for (const img of options.images) {
      userParts.push({
        type: 'input_image',
        image_url: `data:${img.mimeType};base64,${img.base64}`,
        detail: params.imageDetail,
      });
    }
  }

  const body: Record<string, unknown> = {
    model: modelId,
    instructions: options.systemPrompt,
    input: [{ role: 'user', content: userParts }],
    stream,
  };

  if (params.maxOutputTokens > 0) {
    body.max_output_tokens = params.maxOutputTokens;
  }

  if (params.thinking.enabled || capabilities.alwaysOnThinking) {
    const effort = params.thinking.effort || 'medium';
    body.reasoning = {
      effort,
      ...(params.thinking.includeThoughts ? { summary: 'auto' } : {}),
    };
  }

  if (!omitSampling) {
    if (params.temperature !== null) body.temperature = params.temperature;
    if (params.topP !== null) body.top_p = params.topP;
  }

  if (structuredMode === 'json_schema' && options.jsonSchema) {
    body.text = {
      format: {
        type: 'json_schema',
        name: options.jsonSchema.name,
        strict: true,
        schema: options.jsonSchema.schema,
      },
    };
  } else if (structuredMode === 'json_object') {
    body.text = { format: { type: 'json_object' } };
  }

  Object.assign(body, parseExtraBody(params.extraBodyJson));

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${profile.apiKey.trim()}`,
    ...params.customHeaders,
  };

  return { endpoint, headers, body, stream };
}

function buildAnthropicRequest(profile: ProviderProfile, options: LLMCallOptions) {
  const base = stripTrailingSlash(profile.baseUrl);
  const endpoint = base.endsWith('/v1/messages') ? base : `${base}/v1/messages`;
  const { params, capabilities, modelId } = profile;
  const stream = resolveStreamFlag(profile);
  const omitSampling = shouldOmitSampling(profile);

  const userBlocks: unknown[] = [];
  if (options.images && options.images.length > 0) {
    for (const img of options.images) {
      userBlocks.push({
        type: 'image',
        source: {
          type: 'base64',
          media_type: img.mimeType,
          data: img.base64,
        },
      });
    }
  }
  userBlocks.push({ type: 'text', text: options.userPrompt });

  let maxTokens = Math.max(1024, params.maxOutputTokens || 16384);

  const body: Record<string, unknown> = {
    model: modelId,
    system: options.systemPrompt,
    messages: [{ role: 'user', content: userBlocks }],
    max_tokens: maxTokens,
    stream,
  };

  const isAdaptive =
    capabilities.thinkingVariant === 'anthropic-adaptive' ||
    /claude-(opus|sonnet|haiku|fable)-(4-6|5)/i.test(modelId);

  if (isAdaptive) {
    if (params.thinking.enabled || capabilities.alwaysOnThinking) {
      body.thinking = { type: 'adaptive' };
      const effort = params.thinking.effort || 'medium';
      body.output_config = { effort };
    } else if (!capabilities.alwaysOnThinking) {
      body.thinking = { type: 'disabled' };
    }
  } else if (capabilities.thinkingVariant === 'anthropic-manual' || capabilities.thinking.includes('budget')) {
    if (params.thinking.enabled) {
      const budget = Math.max(1024, Math.floor(params.thinking.budgetTokens || 4096));
      if (maxTokens <= budget) {
        maxTokens = budget + 4096;
        body.max_tokens = maxTokens;
      }
      body.thinking = {
        type: 'enabled',
        budget_tokens: budget,
      };
    }
  }

  if (!omitSampling) {
    if (params.temperature !== null) body.temperature = Math.min(1, Math.max(0, params.temperature));
    if (params.topP !== null) body.top_p = params.topP;
    if (params.topK !== null && capabilities.supportsTopK) body.top_k = params.topK;
  }

  if (params.stopSequences.length > 0) {
    body.stop_sequences = params.stopSequences;
  }

  Object.assign(body, parseExtraBody(params.extraBodyJson));

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'x-api-key': profile.apiKey.trim(),
    'anthropic-version': '2023-06-01',
    'anthropic-dangerous-direct-browser-access': 'true',
    ...params.customHeaders,
  };

  return { endpoint, headers, body, stream };
}

function sanitizeSchemaForGemini(schema: Record<string, unknown>): Record<string, unknown> {
  // Gemini responseSchema does not accept `additionalProperties`
  const clone: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(schema)) {
    if (key === 'additionalProperties') continue;
    if (val && typeof val === 'object' && !Array.isArray(val)) {
      clone[key] = sanitizeSchemaForGemini(val as Record<string, unknown>);
    } else if (Array.isArray(val)) {
      clone[key] = val.map((item) =>
        item && typeof item === 'object' && !Array.isArray(item)
          ? sanitizeSchemaForGemini(item as Record<string, unknown>)
          : item,
      );
    } else {
      clone[key] = val;
    }
  }
  return clone;
}

function buildGeminiRequest(profile: ProviderProfile, options: LLMCallOptions) {
  const base = stripTrailingSlash(profile.baseUrl);
  const stream = resolveStreamFlag(profile);
  const action = stream ? 'streamGenerateContent?alt=sse' : 'generateContent';
  const endpoint = `${base}/v1beta/models/${encodeURIComponent(profile.modelId)}:${action}`;

  const { params, capabilities, modelId } = profile;
  const structuredMode = resolveStructuredMode(profile, options);

  const parts: unknown[] = [{ text: options.userPrompt }];
  if (options.images && options.images.length > 0) {
    for (const img of options.images) {
      parts.push({
        inline_data: {
          mime_type: img.mimeType,
          data: img.base64,
        },
      });
    }
  }

  const generationConfig: Record<string, unknown> = {};
  if (params.maxOutputTokens > 0) generationConfig.maxOutputTokens = params.maxOutputTokens;
  if (params.temperature !== null) generationConfig.temperature = params.temperature;
  if (params.topP !== null) generationConfig.topP = params.topP;
  if (params.topK !== null && capabilities.supportsTopK) generationConfig.topK = params.topK;
  if (params.seed !== null && capabilities.supportsSeed) generationConfig.seed = params.seed;
  if (params.stopSequences.length > 0) generationConfig.stopSequences = params.stopSequences;

  // Strictly mutually exclusive: Gemini 3/4 uses thinkingLevel; Gemini 2.5 uses thinkingBudget
  const isLevelModel =
    capabilities.thinkingVariant === 'gemini-level' || /^gemini-[34]/i.test(modelId);
  const isBudgetModel =
    !isLevelModel && (capabilities.thinkingVariant === 'gemini-budget' || /^gemini-2\.5/i.test(modelId));

  if (isLevelModel) {
    const rawEffort = params.thinking.effort || 'medium';
    const levelMap: Record<string, string> = {
      none: 'LOW',
      minimal: 'LOW',
      low: 'LOW',
      medium: 'MEDIUM',
      high: 'HIGH',
      xhigh: 'XHIGH',
      max: 'XHIGH',
    };
    generationConfig.thinkingConfig = {
      thinkingLevel: levelMap[rawEffort] || 'MEDIUM',
      includeThoughts: params.thinking.includeThoughts,
    };
  } else if (isBudgetModel) {
    if (params.thinking.enabled || capabilities.alwaysOnThinking) {
      const budget =
        params.thinking.budgetTokens !== undefined ? Math.floor(params.thinking.budgetTokens) : -1;
      generationConfig.thinkingConfig = {
        thinkingBudget: budget,
        includeThoughts: params.thinking.includeThoughts,
      };
    } else {
      generationConfig.thinkingConfig = {
        thinkingBudget: 0,
        includeThoughts: false,
      };
    }
  }

  if (structuredMode === 'json_schema' && options.jsonSchema) {
    generationConfig.responseMimeType = 'application/json';
    generationConfig.responseSchema = sanitizeSchemaForGemini(options.jsonSchema.schema);
  } else if (structuredMode === 'json_object') {
    generationConfig.responseMimeType = 'application/json';
  }

  const body: Record<string, unknown> = {
    systemInstruction: {
      parts: [{ text: options.systemPrompt }],
    },
    contents: [
      {
        role: 'user',
        parts,
      },
    ],
    generationConfig,
  };

  Object.assign(body, parseExtraBody(params.extraBodyJson));

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'x-goog-api-key': profile.apiKey.trim(),
    ...params.customHeaders,
  };

  return { endpoint, headers, body, stream };
}

export async function callLLM(
  profile: ProviderProfile,
  options: LLMCallOptions,
): Promise<LLMCallResult> {
  validateBeforeRequest(profile, options);

  const built =
    profile.protocol === 'anthropic-messages'
      ? buildAnthropicRequest(profile, options)
      : profile.protocol === 'gemini-native'
        ? buildGeminiRequest(profile, options)
        : profile.protocol === 'openai-responses'
          ? buildOpenAIResponsesRequest(profile, options)
          : buildOpenAICompatibleRequest(profile, options);

  const { endpoint, headers, body, stream } = built;
  const maxRetries = Math.max(0, profile.params.maxRetries ?? 1);
  let attempt = 0;

  while (true) {
    attempt++;
    const startedAt = performance.now();
    const controller = new AbortController();
    let timedOut = false;
    let userAborted = false;

    const timeoutId = window.setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, Math.max(10_000, profile.params.timeoutMs || 180_000));

    const onExternalAbort = () => {
      userAborted = true;
      controller.abort();
    };
    if (options.signal) {
      if (options.signal.aborted) {
        window.clearTimeout(timeoutId);
        throw new LLMRequestError({
          kind: 'aborted',
          message: '请求已取消',
          endpoint,
          modelId: profile.modelId,
          timestamp: Date.now(),
        });
      }
      options.signal.addEventListener('abort', onExternalAbort, { once: true });
    }

    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        credentials: 'omit', // Crucial for Anthropic ACAO: * + ACAC: true
        signal: controller.signal,
      });

      const requestId =
        response.headers.get('x-request-id') ||
        response.headers.get('request-id') ||
        response.headers.get('cf-ray') ||
        undefined;

      if (!response.ok) {
        const rawBody = await response.text().catch(() => '');
        const detail = buildHttpErrorDetail({
          status: response.status,
          statusText: response.statusText,
          rawBody,
          headers: response.headers,
          endpoint,
          modelId: profile.modelId,
          presetKey: profile.presetKey,
        });
        // Retry only on 429 or 5xx transient failures
        if ((response.status === 429 || response.status >= 500) && attempt <= maxRetries) {
          await new Promise((r) => setTimeout(r, 900 * attempt));
          continue;
        }
        throw new LLMRequestError(detail);
      }

      let content = '';
      let thinking = '';
      let ttftMs: number | null = null;
      const usage: LLMUsage = {};

      const markFirstToken = () => {
        if (ttftMs === null) {
          ttftMs = Math.round(performance.now() - startedAt);
          options.onFirstToken?.(ttftMs);
        }
      };

      const appendThinking = (delta: string) => {
        if (!delta) return;
        markFirstToken();
        thinking += delta;
        options.onThinkingDelta?.(delta, thinking);
      };

      const appendContent = (delta: string) => {
        if (!delta) return;
        markFirstToken();
        content += delta;
        options.onContentDelta?.(delta, content);
      };

      if (stream && response.body) {
        await consumeSSEStream(response.body, ({ event, data }) => {
          if (data === '[DONE]') return;
          let json: any;
          try {
            json = JSON.parse(data);
          } catch {
            return;
          }

          if (profile.protocol === 'anthropic-messages') {
            if (json.type === 'message_start' && json.message?.usage) {
              usage.inputTokens = json.message.usage.input_tokens;
            } else if (json.type === 'content_block_delta') {
              if (json.delta?.type === 'thinking_delta') {
                appendThinking(json.delta.thinking || '');
              } else if (json.delta?.type === 'text_delta') {
                appendContent(json.delta.text || '');
              }
            } else if (json.type === 'message_delta' && json.usage) {
              usage.outputTokens = json.usage.output_tokens;
            } else if (json.type === 'error' || event === 'error') {
              throw new LLMRequestError({
                kind: 'http',
                status: 500,
                message: json.error?.message || 'Anthropic Stream Error',
                providerErrorType: json.error?.type,
                endpoint,
                modelId: profile.modelId,
                rawBody: data,
                timestamp: Date.now(),
              });
            }
          } else if (profile.protocol === 'gemini-native') {
            const parts = json.candidates?.[0]?.content?.parts;
            if (Array.isArray(parts)) {
              for (const part of parts) {
                if (typeof part?.text === 'string') {
                  if (part.thought) {
                    appendThinking(part.text);
                  } else {
                    appendContent(part.text);
                  }
                }
              }
            }
            if (json.usageMetadata) {
              usage.inputTokens = json.usageMetadata.promptTokenCount;
              usage.outputTokens = json.usageMetadata.candidatesTokenCount;
              usage.reasoningTokens = json.usageMetadata.thoughtsTokenCount;
              usage.totalTokens = json.usageMetadata.totalTokenCount;
            }
          } else if (profile.protocol === 'openai-responses') {
            if (json.type === 'response.output_text.delta') {
              appendContent(json.delta || '');
            } else if (json.type === 'response.reasoning_summary_text.delta') {
              appendThinking(json.delta || '');
            } else if (json.type === 'response.completed' && json.response?.usage) {
              usage.inputTokens = json.response.usage.input_tokens;
              usage.outputTokens = json.response.usage.output_tokens;
              usage.reasoningTokens = json.response.usage.output_tokens_details?.reasoning_tokens;
              usage.totalTokens = json.response.usage.total_tokens;
            }
          } else {
            // OpenAI-compatible (OpenAI Chat / DeepSeek / Bailian / Custom)
            const choice = json.choices?.[0];
            const delta = choice?.delta;
            if (delta) {
              if (typeof delta.reasoning_content === 'string') {
                appendThinking(delta.reasoning_content);
              } else if (typeof delta.reasoning === 'string') {
                appendThinking(delta.reasoning);
              }
              if (typeof delta.content === 'string') {
                appendContent(delta.content);
              }
            }
            if (json.usage) {
              usage.inputTokens = json.usage.prompt_tokens;
              usage.outputTokens = json.usage.completion_tokens;
              usage.reasoningTokens = json.usage.completion_tokens_details?.reasoning_tokens;
              usage.totalTokens = json.usage.total_tokens;
            }
          }
        });
      } else {
        // Non-streaming JSON response
        const rawText = await response.text();
        let json: any;
        try {
          json = JSON.parse(rawText);
        } catch {
          throw new LLMRequestError({
            kind: 'json_parse',
            message: '供应商返回了非 JSON 响应体',
            endpoint,
            modelId: profile.modelId,
            rawBody: rawText,
            timestamp: Date.now(),
          });
        }

        if (profile.protocol === 'anthropic-messages') {
          for (const block of json.content || []) {
            if (block.type === 'thinking') appendThinking(block.thinking || '');
            if (block.type === 'text') appendContent(block.text || '');
          }
          if (json.usage) {
            usage.inputTokens = json.usage.input_tokens;
            usage.outputTokens = json.usage.output_tokens;
          }
        } else if (profile.protocol === 'gemini-native') {
          for (const part of json.candidates?.[0]?.content?.parts || []) {
            if (typeof part?.text === 'string') {
              if (part.thought) appendThinking(part.text);
              else appendContent(part.text);
            }
          }
          if (json.usageMetadata) {
            usage.inputTokens = json.usageMetadata.promptTokenCount;
            usage.outputTokens = json.usageMetadata.candidatesTokenCount;
            usage.reasoningTokens = json.usageMetadata.thoughtsTokenCount;
            usage.totalTokens = json.usageMetadata.totalTokenCount;
          }
        } else if (profile.protocol === 'openai-responses') {
          if (typeof json.output_text === 'string') {
            appendContent(json.output_text);
          } else {
            for (const item of json.output || []) {
              if (item.type === 'message') {
                for (const c of item.content || []) {
                  if (c.type === 'output_text') appendContent(c.text || '');
                }
              }
            }
          }
          if (json.usage) {
            usage.inputTokens = json.usage.input_tokens;
            usage.outputTokens = json.usage.output_tokens;
            usage.totalTokens = json.usage.total_tokens;
          }
        } else {
          const msg = json.choices?.[0]?.message;
          if (typeof msg?.reasoning_content === 'string') appendThinking(msg.reasoning_content);
          if (typeof msg?.content === 'string') appendContent(msg.content);
          if (json.usage) {
            usage.inputTokens = json.usage.prompt_tokens;
            usage.outputTokens = json.usage.completion_tokens;
            usage.reasoningTokens = json.usage.completion_tokens_details?.reasoning_tokens;
            usage.totalTokens = json.usage.total_tokens;
          }
        }
      }

      if (!usage.totalTokens && (usage.inputTokens || usage.outputTokens)) {
        usage.totalTokens = (usage.inputTokens || 0) + (usage.outputTokens || 0);
      }

      return {
        content,
        thinking,
        usage,
        ttftMs,
        durationMs: Math.round(performance.now() - startedAt),
        requestId,
        endpoint,
        modelId: profile.modelId,
      };
    } catch (err) {
      if (err instanceof LLMRequestError) {
        throw err;
      }
      const detail = buildNetworkErrorDetail({
        err,
        endpoint,
        modelId: profile.modelId,
        presetKey: profile.presetKey,
        wasTimeout: timedOut,
        wasUserAbort: userAborted,
      });
      if (!userAborted && !timedOut && attempt <= maxRetries) {
        await new Promise((r) => setTimeout(r, 800 * attempt));
        continue;
      }
      throw new LLMRequestError(detail);
    } finally {
      window.clearTimeout(timeoutId);
      options.signal?.removeEventListener('abort', onExternalAbort);
    }
  }
}

export async function testProviderConnection(profile: ProviderProfile): Promise<LLMCallResult> {
  // Use a tiny prompt with low max output tokens to verify auth + CORS + thinking param compatibility
  const probeProfile: ProviderProfile = {
    ...profile,
    params: {
      ...profile.params,
      maxOutputTokens: Math.min(profile.params.maxOutputTokens || 2048, 2048),
      timeoutMs: Math.min(profile.params.timeoutMs || 45_000, 45_000),
      maxRetries: 0,
    },
  };
  return callLLM(probeProfile, {
    systemPrompt: 'You are a connection health check probe. Reply with exactly: OK',
    userPrompt: 'Ping',
    expectJson: false,
  });
}
