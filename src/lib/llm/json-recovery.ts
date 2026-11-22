import { jsonrepair } from 'jsonrepair';
import type { z } from 'zod';
import { LLMRequestError } from '../../types/llm';

/**
 * Robustly extracts and parses JSON from LLM outputs (handles ```json fences,
 * preamble/postamble text, trailing commas, unescaped quotes, etc.).
 */
export function parseAndValidateJson<T>(
  rawText: string,
  schema: z.ZodType<T>,
  context: { endpoint: string; modelId: string },
): T {
  const cleaned = extractJsonCandidate(rawText);

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    try {
      const repaired = jsonrepair(cleaned);
      parsed = JSON.parse(repaired);
    } catch (repairErr) {
      throw new LLMRequestError({
        kind: 'json_parse',
        message: `模型返回内容无法解析为合法 JSON：${repairErr instanceof Error ? repairErr.message : String(repairErr)}`,
        endpoint: context.endpoint,
        modelId: context.modelId,
        rawBody: rawText,
        hintZh: '可能是模型输出过长触发 max_tokens 截断，或当前模型未严格遵循 JSON 格式。建议调大 maxOutputTokens 后点击「重试此段」。',
        timestamp: Date.now(),
      });
    }
  }

  const result = schema.safeParse(parsed);
  if (!result.success) {
    const issues = result.error.issues
      .slice(0, 5)
      .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('；');
    throw new LLMRequestError({
      kind: 'json_parse',
      message: `JSON 结构校验失败：${issues}`,
      endpoint: context.endpoint,
      modelId: context.modelId,
      rawBody: rawText,
      hintZh: '模型输出了 JSON 但缺少部分必填字段或类型不符，可直接点击单段重试。',
      timestamp: Date.now(),
    });
  }

  return result.data;
}

function extractJsonCandidate(raw: string): string {
  const trimmed = raw.trim();
  // Match ```json ... ``` or ``` ... ```
  const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenceMatch?.[1]) {
    return fenceMatch[1].trim();
  }

  const firstObj = trimmed.indexOf('{');
  const firstArr = trimmed.indexOf('[');
  let start = -1;
  let end = -1;

  if (firstObj !== -1 && (firstArr === -1 || firstObj < firstArr)) {
    start = firstObj;
    end = trimmed.lastIndexOf('}');
  } else if (firstArr !== -1) {
    start = firstArr;
    end = trimmed.lastIndexOf(']');
  }

  if (start !== -1 && end > start) {
    return trimmed.slice(start, end + 1);
  }
  return trimmed;
}
