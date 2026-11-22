export type ApiProtocol =
  | 'openai-compatible'
  | 'openai-responses'
  | 'anthropic-messages'
  | 'gemini-native';

export type PresetProviderKey =
  | 'deepseek'
  | 'dashscope'
  | 'openai'
  | 'anthropic'
  | 'gemini'
  | 'custom';

export type ThinkingMode = 'none' | 'toggle' | 'effort' | 'budget';

export type ReasoningEffort =
  | 'none'
  | 'minimal'
  | 'low'
  | 'medium'
  | 'high'
  | 'xhigh'
  | 'max';

export interface ModelCapabilities {
  vision: boolean;
  thinking: ThinkingMode[];
  supportedEfforts?: ReasoningEffort[];
  alwaysOnThinking?: boolean;
  structuredOutput: ('json_schema' | 'json_object' | 'prompt_only')[];
  supportsTopK: boolean;
  supportsFrequencyPenalty: boolean;
  supportsPresencePenalty: boolean;
  supportsSeed: boolean;
  disableSamplingWhenThinking: boolean;
  streamRequiredWhenThinking: boolean;
  /** Provider-specific hint for thinking engine variant */
  thinkingVariant?:
    | 'deepseek'
    | 'dashscope'
    | 'openai-chat'
    | 'openai-responses'
    | 'anthropic-adaptive'
    | 'anthropic-manual'
    | 'gemini-level'
    | 'gemini-budget'
    | 'none';
}

export interface PresetModelSpec {
  id: string;
  label: string;
  description: string;
  contextWindow: number;
  maxInputTokens: number;
  defaultMaxOutputTokens: number;
  maxOutputTokensLimit: number;
  defaultThinkingEnabled: boolean;
  defaultEffort?: ReasoningEffort;
  defaultBudgetTokens?: number;
  capabilities: ModelCapabilities;
}

export interface UnifiedModelParams {
  contextWindow: number;
  maxInputTokens: number;
  maxOutputTokens: number;

  thinking: {
    enabled: boolean;
    effort?: ReasoningEffort;
    budgetTokens?: number;
    includeThoughts: boolean;
  };

  temperature: number | null;
  topP: number | null;
  topK: number | null;
  frequencyPenalty: number | null;
  presencePenalty: number | null;
  seed: number | null;
  stopSequences: string[];

  stream: boolean;
  structuredOutputMode: 'auto' | 'json_schema' | 'json_object' | 'prompt_only';
  imageDetail: 'auto' | 'low' | 'high';
  timeoutMs: number;
  maxRetries: number;

  customHeaders: Record<string, string>;
  extraBodyJson: string;
}

export interface WorkspaceMeta {
  workspaceId: string;
  region: string;
  useLegacyEndpoint?: boolean;
}

export interface ProviderProfile {
  id: string;
  presetKey: PresetProviderKey;
  name: string;
  protocol: ApiProtocol;
  baseUrl: string;
  workspaceMeta?: WorkspaceMeta;
  apiKey: string;
  modelId: string;
  capabilities: ModelCapabilities;
  params: UnifiedModelParams;
}

export interface ImageAttachment {
  mimeType: string;
  /** Pure base64 string WITHOUT data:image/...;base64, prefix */
  base64: string;
  width?: number;
  height?: number;
}

export interface LLMCallOptions {
  systemPrompt: string;
  userPrompt: string;
  images?: ImageAttachment[];
  /** Optional JSON schema for native structured output */
  jsonSchema?: {
    name: string;
    schema: Record<string, unknown>;
  };
  /** Hint whether we expect JSON output */
  expectJson?: boolean;
  signal?: AbortSignal;
  onThinkingDelta?: (delta: string, full: string) => void;
  onContentDelta?: (delta: string, full: string) => void;
  onFirstToken?: (ttftMs: number) => void;
}

export interface LLMUsage {
  inputTokens?: number;
  outputTokens?: number;
  reasoningTokens?: number;
  totalTokens?: number;
}

export interface LLMCallResult {
  content: string;
  thinking: string;
  usage: LLMUsage;
  ttftMs: number | null;
  durationMs: number;
  requestId?: string;
  endpoint: string;
  modelId: string;
}

export interface LLMErrorDetail {
  kind: 'http' | 'network_cors' | 'timeout' | 'aborted' | 'validation' | 'json_parse';
  status?: number;
  statusText?: string;
  message: string;
  providerErrorType?: string;
  providerErrorCode?: string;
  providerErrorParam?: string;
  requestId?: string;
  endpoint: string;
  modelId: string;
  rawBody?: string;
  hintZh?: string;
  timestamp: number;
}

export class LLMRequestError extends Error {
  detail: LLMErrorDetail;

  constructor(detail: LLMErrorDetail) {
    super(detail.message);
    this.name = 'LLMRequestError';
    this.detail = detail;
  }
}

export interface ExecutionStepState {
  id: string;
  label: string;
  kind: 'local' | 'ocr' | 'section' | 'vocab';
  status: 'pending' | 'thinking' | 'streaming' | 'done' | 'error';
  startedAt?: number;
  finishedAt?: number;
  ttftMs?: number | null;
  thinkingText: string;
  contentPreview: string;
  usage?: LLMUsage;
  detailNote?: string;
  error?: LLMErrorDetail;
}
