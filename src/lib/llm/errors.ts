import type { LLMErrorDetail, PresetProviderKey } from '../../types/llm';

export function buildHttpErrorDetail(params: {
  status: number;
  statusText: string;
  rawBody: string;
  headers: Headers;
  endpoint: string;
  modelId: string;
  presetKey: PresetProviderKey;
}): LLMErrorDetail {
  const { status, statusText, rawBody, headers, endpoint, modelId, presetKey } = params;
  const requestId =
    headers.get('x-request-id') ||
    headers.get('request-id') ||
    headers.get('x-amzn-requestid') ||
    headers.get('cf-ray') ||
    undefined;

  let message = `HTTP ${status} ${statusText || ''}`.trim();
  let providerErrorType: string | undefined;
  let providerErrorCode: string | undefined;
  let providerErrorParam: string | undefined;

  try {
    const parsed = JSON.parse(rawBody);
    const errObj = parsed?.error || parsed;
    if (typeof errObj?.message === 'string' && errObj.message.trim()) {
      message = errObj.message;
    } else if (typeof parsed?.message === 'string' && parsed.message.trim()) {
      message = parsed.message;
    }
    if (typeof errObj?.type === 'string') providerErrorType = errObj.type;
    if (errObj?.code !== undefined && errObj?.code !== null) {
      providerErrorCode = String(errObj.code);
    } else if (typeof errObj?.status === 'string') {
      providerErrorCode = errObj.status;
    }
    if (typeof errObj?.param === 'string') providerErrorParam = errObj.param;
  } catch {
    if (rawBody.trim()) {
      message = rawBody.trim().slice(0, 320);
    }
  }

  const hintZh = diagnoseHint({ status, message, presetKey, modelId });

  return {
    kind: 'http',
    status,
    statusText,
    message,
    providerErrorType,
    providerErrorCode,
    providerErrorParam,
    requestId,
    endpoint,
    modelId,
    rawBody,
    hintZh,
    timestamp: Date.now(),
  };
}

export function buildNetworkErrorDetail(params: {
  err: unknown;
  endpoint: string;
  modelId: string;
  presetKey: PresetProviderKey;
  wasTimeout: boolean;
  wasUserAbort: boolean;
}): LLMErrorDetail {
  const { err, endpoint, modelId, presetKey, wasTimeout, wasUserAbort } = params;
  const rawMsg = err instanceof Error ? err.message : String(err);

  if (wasUserAbort) {
    return {
      kind: 'aborted',
      message: '请求已被用户手动取消',
      endpoint,
      modelId,
      timestamp: Date.now(),
    };
  }

  if (wasTimeout) {
    return {
      kind: 'timeout',
      message: '请求超时：模型响应时间超过当前设定的超时阈值',
      endpoint,
      modelId,
      hintZh: '开启深度思考或解析整篇长文时耗时较长，可在设置中增大 Timeout 超时时间，或确认已开启流式传输（stream）。',
      timestamp: Date.now(),
    };
  }

  const hintZh =
    presetKey === 'dashscope'
      ? '网络请求失败：请检查阿里云百炼「业务空间专属域名」拼写是否正确（格式 https://{WorkspaceId}.{region}.maas.aliyuncs.com/compatible-mode/v1），或检查浏览器网络连接。'
      : '浏览器网络请求被拦截或不可达：可能是目标接口未开启 CORS 跨域放行（例如本地 Ollama 需设置 OLLAMA_ORIGINS）、Base URL 填写有误，或当前网络无法直连该 API。';

  return {
    kind: 'network_cors',
    message: rawMsg || 'Failed to fetch',
    endpoint,
    modelId,
    rawBody: rawMsg,
    hintZh,
    timestamp: Date.now(),
  };
}

function diagnoseHint(input: {
  status: number;
  message: string;
  presetKey: PresetProviderKey;
  modelId: string;
}): string | undefined {
  const lower = input.message.toLowerCase();

  if (input.status === 401 || input.status === 403) {
    if (input.presetKey === 'dashscope') {
      return '鉴权失败：阿里云百炼的 API Key 与「业务空间 ID + 地域」强绑定，请核对当前 Key 是否属于该业务空间专属域名。';
    }
    if (lower.includes('anthropic-dangerous-direct-browser-access')) {
      return 'Anthropic 浏览器直连缺少必需请求头，请确认协议设置为 anthropic-messages。';
    }
    return 'API Key 无效、已过期，或当前账号无权调用所选模型。';
  }

  if (input.status === 404) {
    return `模型 ID（${input.modelId}）不存在或接口路径有误，请核对 Base URL 与最新模型名称。`;
  }

  if (input.status === 429) {
    return '触发供应商频率限制（RPM/TPM）或账户余额不足，建议稍后重试或在设置中降低并发/切换模型。';
  }

  if (input.status === 400) {
    if (lower.includes('does not support image') || lower.includes('vision') || lower.includes('image')) {
      return `当前模型（${input.modelId}）不支持图像输入！请在设置页「视觉 OCR 模型槽位」切换为支持视觉的模型（如 deepseek-flash / qwen3-vl-plus / gemini-2.5-flash / gpt-5）。`;
    }
    if (lower.includes('thinking_budget') && lower.includes('thinking_level')) {
      return 'Gemini 不允许同时传 thinkingBudget 与 thinkingLevel，请切换对应代际模型或检查自定义 extraBody。';
    }
    if (lower.includes('thinking') || lower.includes('reasoning') || lower.includes('effort') || lower.includes('budget')) {
      return '思考/推理参数与该模型不兼容（多数供应商会直接报 400），请检查思考深度档位、预算上限或是否需要开启流式输出（stream）。';
    }
    if (lower.includes('temperature') || lower.includes('top_p')) {
      return '当前推理/思考模型禁止修改 temperature 或 top_p，请将采样参数留空（使用默认值）。';
    }
    if (lower.includes('stream')) {
      return '该模型在当前模式下要求开启流式输出（stream: true），请在高级参数中打开流式开关。';
    }
  }

  return undefined;
}
