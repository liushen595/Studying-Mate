import { useRef, useState } from 'react';
import {
  Brain,
  CheckCircle2,
  Database,
  Download,
  ExternalLink,
  Eye,
  EyeOff,
  Info,
  Loader2,
  Plus,
  ShieldCheck,
  Sliders,
  Trash2,
  Upload,
  Zap,
} from 'lucide-react';
import { useSettingsStore } from '../stores/useSettingsStore';
import {
  BAILIAN_REGIONS,
  PRESET_PROVIDERS,
} from '../lib/llm/presets';
import { testProviderConnection } from '../lib/llm/adapters';
import {
  buildBackupBundle,
  restoreBackupBundle,
} from '../lib/sync/backup';
import {
  LLMRequestError,
  type ApiProtocol,
  type LLMCallResult,
  type LLMErrorDetail,
  type ReasoningEffort,
} from '../types/llm';
import { ErrorDiagnosticCard } from '../components/common/ErrorDiagnosticCard';
import { WebDavSyncCard } from '../components/settings/WebDavSyncCard';

const EFFORT_LABELS: Record<ReasoningEffort, string> = {
  none: 'none (关闭)',
  minimal: 'minimal (极简)',
  low: 'low (低)',
  medium: 'medium (中)',
  high: 'high (高)',
  xhigh: 'xhigh (极高)',
  max: 'max (最大)',
};

export function SettingsPage() {
  const {
    providers,
    activeProviderId,
    visionProviderId,
    visionFollowAnalysis,
    concurrency,
    setActiveProviderId,
    setVisionRouting,
    updateProvider,
    updateProviderParams,
    selectPresetModel,
    updateBailianWorkspace,
    addCustomProvider,
    removeCustomProvider,
    setConcurrency,
  } = useSettingsStore();

  const [editingId, setEditingId] = useState<string>(activeProviderId);
  const [showKey, setShowKey] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<LLMCallResult | null>(null);
  const [testError, setTestError] = useState<LLMErrorDetail | null>(null);
  const [backupMessage, setBackupMessage] = useState<string | null>(null);
  const importInputRef = useRef<HTMLInputElement>(null);

  const selected = providers.find((p) => p.id === editingId) || providers[0];
  const presetDef =
    selected.presetKey !== 'custom' ? PRESET_PROVIDERS[selected.presetKey] : null;

  const isSamplingDisabled =
    (selected.params.thinking.enabled || selected.capabilities.alwaysOnThinking) &&
    selected.capabilities.disableSamplingWhenThinking;

  const isStreamLocked =
    selected.params.thinking.enabled && selected.capabilities.streamRequiredWhenThinking;

  const handleTestConnection = async () => {
    setTesting(true);
    setTestResult(null);
    setTestError(null);
    try {
      const res = await testProviderConnection(selected);
      setTestResult(res);
    } catch (err) {
      if (err instanceof LLMRequestError) {
        setTestError(err.detail);
      } else {
        setTestError({
          kind: 'network_cors',
          message: err instanceof Error ? err.message : String(err),
          endpoint: selected.baseUrl,
          modelId: selected.modelId,
          timestamp: Date.now(),
        });
      }
    } finally {
      setTesting(false);
    }
  };

  const handleExportBackup = async () => {
    const bundle = await buildBackupBundle({ includeSettings: true });
    const json = JSON.stringify(bundle, null, 2);
    const blob = new Blob([json], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `studying-mate-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    setBackupMessage(
      `已导出 ${bundle.papers.length} 套试卷与应用设置（自动剔除 API Key 与 WebDAV 密码）。`,
    );
  };

  const handleImportBackup = async (file: File) => {
    try {
      const text = await file.text();
      const res = await restoreBackupBundle(text, {
        mode: 'merge_newest',
        restoreSettings: true,
      });
      setBackupMessage(
        `导入完成：新增 ${res.added} 套、更新 ${res.updated} 套${
          res.skippedOlder > 0 ? `、保留本地较新 ${res.skippedOlder} 套` : ''
        }${res.settingsRestored ? '，并同步了应用设置（已保留本机 API Key）' : ''}！`,
      );
    } catch (err) {
      setBackupMessage(`导入失败：${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const thinkingSpecNote = () => {
    switch (selected.capabilities.thinkingVariant) {
      case 'deepseek':
        return '映射协议字段：顶层 thinking: { type: "enabled"|"disabled" } + reasoning_effort（支持 none/low/high/max；medium 服务端自动映射到 high；思考模式下采样参数静默忽略，本适配器自动省略）。';
      case 'dashscope':
        return '映射协议字段：REST 顶层 enable_thinking (boolean) + thinking_budget (正整数 Token 上限)。开启思考时强制 stream=true（非流式将触发百炼 400 报错）。';
      case 'openai-chat':
        return '映射协议字段：顶层 reasoning_effort + max_completion_tokens。推理模型传 temperature/top_p 或不兼容档位将直接报 400，本适配器自动隔离。';
      case 'openai-responses':
        return '映射协议字段：嵌套 reasoning: { effort } + max_output_tokens（Responses API 专用结构）。';
      case 'anthropic-adaptive':
        return '映射协议字段：Claude 5.x 使用 thinking: { type: "adaptive" } + output_config: { effort }（low/medium/high/xhigh/max）；自动附加 anthropic-dangerous-direct-browser-access 请求头。';
      case 'anthropic-manual':
        return '映射协议字段：旧版 Claude 使用 thinking: { type: "enabled", budget_tokens }（>=1024 且自动保证 max_tokens > budget_tokens）。';
      case 'gemini-level':
        return '映射协议字段：Gemini 3/4 使用 generationConfig.thinkingConfig.thinkingLevel（LOW/MEDIUM/HIGH/XHIGH），严格互斥不传 thinkingBudget 防 400。';
      case 'gemini-budget':
        return '映射协议字段：Gemini 2.5 使用 generationConfig.thinkingConfig.thinkingBudget（-1 动态思考 / 0 关闭 / 正整数上限），严格互斥不传 thinkingLevel 防 400。';
      default:
        return '当前模型无内置思考参数；自定义模型如需透传扩展参数，可使用下方「额外请求体 JSON」。';
    }
  };

  return (
    <div className="space-y-4">
      {/* Header Island */}
      <div className="island p-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-text-primary">LLM 供应商与高级参数工作台</h1>
          <p className="mt-0.5 text-xs text-text-secondary">
            五大预设供应商与自定义供应商共用同一套底层参数模型；所有 API Key 仅存储在本地浏览器并直连官方接口。
          </p>
        </div>

        <div className="inline-flex items-center gap-1.5 rounded-xl bg-answer-soft px-3 py-1.5 text-xs font-medium text-answer">
          <ShieldCheck className="h-4 w-4" />
          <span>纯前端直连 · 零服务端存储 Key</span>
        </div>
      </div>

      {/* Dual-Slot Routing Bar (主分析模型槽位 + 视觉 OCR 槽位) */}
      <div className="island p-4 grid gap-4 md:grid-cols-3">
        <div>
          <label className="block text-xs font-semibold text-text-primary mb-1.5">
            主分析模型槽位（精读 / 翻译 / 生词本）
          </label>
          <select
            value={activeProviderId}
            onChange={(e) => {
              setActiveProviderId(e.target.value);
              setEditingId(e.target.value);
            }}
            className="w-full rounded-xl border border-border-subtle bg-surface-subtle px-3 py-2 text-xs font-medium text-text-primary focus:border-accent focus:outline-none"
          >
            {providers.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} · {p.modelId || '(未填模型)'} {p.apiKey ? '✓' : '(未填Key)'}
              </option>
            ))}
          </select>
        </div>

        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label className="text-xs font-semibold text-text-primary">
              视觉 OCR 模型槽位（拍照识图）
            </label>
            <label className="inline-flex items-center gap-1.5 text-[11px] text-text-secondary cursor-pointer">
              <input
                type="checkbox"
                checked={visionFollowAnalysis}
                onChange={(e) => setVisionRouting(e.target.checked, visionProviderId)}
                className="accent-accent"
              />
              跟随主模型
            </label>
          </div>
          <select
            disabled={visionFollowAnalysis}
            value={visionFollowAnalysis ? activeProviderId : visionProviderId}
            onChange={(e) => setVisionRouting(false, e.target.value)}
            className="w-full rounded-xl border border-border-subtle bg-surface-subtle px-3 py-2 text-xs font-medium text-text-primary focus:border-accent focus:outline-none disabled:opacity-55"
          >
            {providers.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} · {p.modelId || '(未填)'} {p.capabilities.vision ? '[支持识图]' : '[纯文本]'}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-xs font-semibold text-text-primary mb-1.5">
            分段并发请求数（推荐 2）
          </label>
          <div className="flex items-center gap-2">
            {[1, 2, 3, 4].map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => setConcurrency(n)}
                className={`flex-1 rounded-xl border py-2 text-xs font-mono font-semibold transition ${
                  concurrency === n
                    ? 'border-accent bg-accent-soft text-accent'
                    : 'border-border-subtle bg-surface-subtle text-text-secondary hover:text-text-primary'
                }`}
              >
                {n}x
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Main Two-Column Settings Layout */}
      <div className="grid gap-4 lg:grid-cols-[260px_minmax(0,1fr)]">
        {/* Left: Provider Preset & Custom List */}
        <div className="island p-3 space-y-2 h-fit">
          <div className="px-2 pt-1 text-[11px] font-semibold uppercase tracking-wider text-text-muted">
            预设供应商
          </div>
          {providers
            .filter((p) => p.presetKey !== 'custom')
            .map((p) => {
              const isSelected = p.id === selected.id;
              const isActive = p.id === activeProviderId;
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => {
                    setEditingId(p.id);
                    setTestResult(null);
                    setTestError(null);
                  }}
                  className={`w-full rounded-xl border px-3 py-2.5 text-left transition ${
                    isSelected
                      ? 'border-accent bg-accent-soft/60'
                      : 'border-transparent hover:bg-surface-subtle'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-semibold text-text-primary">{p.name}</span>
                    <span
                      className={`h-2 w-2 rounded-full ${
                        p.apiKey ? 'bg-answer' : 'bg-border-strong'
                      }`}
                    />
                  </div>
                  <div className="mt-0.5 flex items-center justify-between text-[11px] text-text-muted">
                    <span className="truncate font-mono">{p.modelId}</span>
                    {isActive && (
                      <span className="shrink-0 rounded bg-accent/15 px-1.5 py-0.2 text-[10px] font-semibold text-accent">
                        使用中
                      </span>
                    )}
                  </div>
                </button>
              );
            })}

          <div className="px-2 pt-3 text-[11px] font-semibold uppercase tracking-wider text-text-muted">
            自定义供应商
          </div>
          {providers
            .filter((p) => p.presetKey === 'custom')
            .map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => {
                  setEditingId(p.id);
                  setTestResult(null);
                  setTestError(null);
                }}
                className={`w-full rounded-xl border px-3 py-2.5 text-left transition ${
                  p.id === selected.id
                    ? 'border-accent bg-accent-soft/60'
                    : 'border-transparent hover:bg-surface-subtle'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-sm font-semibold text-text-primary">{p.name}</span>
                  <span
                    className={`h-2 w-2 shrink-0 rounded-full ${
                      p.apiKey ? 'bg-answer' : 'bg-border-strong'
                    }`}
                  />
                </div>
                <div className="mt-0.5 truncate font-mono text-[11px] text-text-muted">
                  {p.modelId || p.protocol}
                </div>
              </button>
            ))}

          <button
            type="button"
            onClick={() => {
              const created = addCustomProvider();
              setEditingId(created.id);
              setTestResult(null);
              setTestError(null);
            }}
            className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-border-strong py-2.5 text-xs font-medium text-text-secondary transition hover:border-accent hover:text-accent"
          >
            <Plus className="h-3.5 w-3.5" />
            添加自定义供应商
          </button>
        </div>

        {/* Right: Detailed Provider & Agent Parameters Form */}
        <div className="space-y-4">
          <div className="island p-5 sm:p-6 space-y-5">
            {/* Provider Title & Quick Actions */}
            <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border-subtle pb-4">
              <div className="space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  {selected.presetKey === 'custom' ? (
                    <input
                      type="text"
                      value={selected.name}
                      onChange={(e) => updateProvider(selected.id, { name: e.target.value })}
                      className="rounded-lg border border-border-subtle bg-surface-subtle px-2.5 py-1 text-base font-bold text-text-primary focus:border-accent focus:outline-none"
                    />
                  ) : (
                    <h2 className="text-lg font-bold text-text-primary">{selected.name}</h2>
                  )}
                  {presetDef && (
                    <span className="rounded-full bg-surface-subtle px-2.5 py-0.5 text-[11px] font-medium text-text-secondary border border-border-subtle">
                      {presetDef.badge}
                    </span>
                  )}
                </div>
                {presetDef && (
                  <p className="text-xs leading-relaxed text-text-secondary max-w-2xl">
                    {presetDef.description}{' '}
                    <a
                      href={presetDef.docsUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-0.5 font-medium text-accent hover:underline"
                    >
                      官方文档 <ExternalLink className="h-3 w-3" />
                    </a>
                  </p>
                )}
              </div>

              <div className="flex items-center gap-2">
                {activeProviderId !== selected.id && (
                  <button
                    type="button"
                    onClick={() => setActiveProviderId(selected.id)}
                    className="rounded-xl border border-accent/40 bg-accent-soft px-3 py-1.5 text-xs font-semibold text-accent hover:bg-accent hover:text-white transition"
                  >
                    设为主分析模型
                  </button>
                )}

                <button
                  type="button"
                  disabled={testing}
                  onClick={handleTestConnection}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-accent px-3.5 py-1.5 text-xs font-semibold text-white shadow-xs transition hover:opacity-92 disabled:opacity-50"
                >
                  {testing ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Zap className="h-3.5 w-3.5" />
                  )}
                  测试连接
                </button>

                {selected.presetKey === 'custom' && (
                  <button
                    type="button"
                    onClick={() => {
                      removeCustomProvider(selected.id);
                      setEditingId('deepseek');
                    }}
                    className="rounded-xl border border-danger/30 p-1.5 text-danger hover:bg-danger-soft"
                    title="删除该自定义供应商"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
              </div>
            </div>

            {/* Connection Test Feedback */}
            {testResult && (
              <div className="rounded-xl border border-answer/30 bg-answer-soft/50 px-4 py-3 text-xs text-text-primary flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-answer shrink-0" />
                  <span>
                    <strong>连接成功（CORS 放行 & 鉴权通过）！</strong> 模型回复：
                    <code className="ml-1 rounded bg-surface px-1.5 py-0.5 font-mono">
                      {testResult.content.trim().slice(0, 60) || '(empty)'}
                    </code>
                  </span>
                </div>
                <span className="font-mono text-text-secondary">
                  TTFT {testResult.ttftMs ?? '-'}ms · 总耗时 {testResult.durationMs}ms
                </span>
              </div>
            )}
            {testError && <ErrorDiagnosticCard error={testError} onRetry={handleTestConnection} />}

            {/* ==================== 1. Connection & Bailian Workspace Builder ==================== */}
            <div className="space-y-4">
              {/* Alibaba Bailian Special Workspace Domain Helper */}
              {selected.presetKey === 'dashscope' && (
                <div className="rounded-2xl border border-accent/25 bg-accent-soft/30 p-4 space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="text-xs font-semibold text-accent">
                      阿里云百炼 · 业务空间专属域名配置（每人账号不同）
                    </div>
                    <label className="inline-flex items-center gap-1.5 text-xs text-text-secondary cursor-pointer">
                      <input
                        type="checkbox"
                        checked={Boolean(selected.workspaceMeta?.useLegacyEndpoint)}
                        onChange={(e) =>
                          updateBailianWorkspace(selected.id, {
                            useLegacyEndpoint: e.target.checked,
                          })
                        }
                        className="accent-accent"
                      />
                      使用旧版通用域名 (dashscope.aliyuncs.com)
                    </label>
                  </div>

                  {!selected.workspaceMeta?.useLegacyEndpoint && (
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div>
                        <label className="block text-[11px] font-medium text-text-secondary mb-1">
                          业务空间 ID（WorkspaceId，如 llm-xxxx）
                        </label>
                        <input
                          type="text"
                          value={selected.workspaceMeta?.workspaceId || ''}
                          onChange={(e) =>
                            updateBailianWorkspace(selected.id, { workspaceId: e.target.value })
                          }
                          placeholder="在百炼控制台 → 业务空间管理复制"
                          className="w-full rounded-xl border border-border-subtle bg-surface px-3 py-2 font-mono text-xs text-text-primary focus:border-accent focus:outline-none"
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] font-medium text-text-secondary mb-1">
                          接入地域（Region）
                        </label>
                        <select
                          value={selected.workspaceMeta?.region || 'cn-beijing'}
                          onChange={(e) =>
                            updateBailianWorkspace(selected.id, { region: e.target.value })
                          }
                          className="w-full rounded-xl border border-border-subtle bg-surface px-3 py-2 text-xs text-text-primary focus:border-accent focus:outline-none"
                        >
                          {BAILIAN_REGIONS.map((r) => (
                            <option key={r.id} value={r.id}>
                              {r.label}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                  )}

                  <p className="text-[11px] text-text-secondary">
                    自动生成专属 Base URL：<code className="font-mono text-text-primary">{selected.baseUrl || '（请填写 WorkspaceId）'}</code>。注意：百炼 API Key 必须是在该业务空间下创建的，否则会报 401/403。
                  </p>
                </div>
              )}

              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="block text-xs font-medium text-text-secondary mb-1">
                    API 协议类型
                  </label>
                  <select
                    value={selected.protocol}
                    onChange={(e) =>
                      updateProvider(selected.id, { protocol: e.target.value as ApiProtocol })
                    }
                    className="w-full rounded-xl border border-border-subtle bg-surface-subtle px-3 py-2 text-sm text-text-primary focus:border-accent focus:outline-none"
                  >
                    <option value="openai-compatible">OpenAI Compatible (/chat/completions)</option>
                    <option value="openai-responses">OpenAI Responses API (/responses)</option>
                    <option value="anthropic-messages">Anthropic Messages (/v1/messages)</option>
                    <option value="gemini-native">Google Gemini Native (:streamGenerateContent)</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-medium text-text-secondary mb-1">
                    API Base URL（可手动覆盖）
                  </label>
                  <input
                    type="text"
                    value={selected.baseUrl}
                    onChange={(e) => updateProvider(selected.id, { baseUrl: e.target.value })}
                    placeholder={
                      selected.presetKey === 'dashscope'
                        ? 'https://{WorkspaceId}.{region}.maas.aliyuncs.com/compatible-mode/v1'
                        : 'https://api.example.com/v1'
                    }
                    className="w-full rounded-xl border border-border-subtle bg-surface-subtle px-3 py-2 font-mono text-xs text-text-primary focus:border-accent focus:outline-none"
                  />
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="block text-xs font-medium text-text-secondary mb-1">
                    API Key（仅存本机浏览器）
                  </label>
                  <div className="relative">
                    <input
                      type={showKey ? 'text' : 'password'}
                      value={selected.apiKey}
                      onChange={(e) => updateProvider(selected.id, { apiKey: e.target.value })}
                      placeholder="sk-..."
                      autoComplete="off"
                      className="w-full rounded-xl border border-border-subtle bg-surface-subtle py-2 pl-3 pr-10 font-mono text-xs text-text-primary focus:border-accent focus:outline-none"
                    />
                    <button
                      type="button"
                      onClick={() => setShowKey((v) => !v)}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-primary"
                    >
                      {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-medium text-text-secondary mb-1">
                    模型 ID（支持预设切换或手动输入）
                  </label>
                  <div className="space-y-1.5">
                    {presetDef && (
                      <select
                        value={
                          presetDef.models.some((m) => m.id === selected.modelId)
                            ? selected.modelId
                            : '__custom__'
                        }
                        onChange={(e) => {
                          if (e.target.value !== '__custom__') {
                            selectPresetModel(selected.id, e.target.value);
                          }
                        }}
                        className="w-full rounded-xl border border-border-subtle bg-surface-subtle px-3 py-2 text-xs font-medium text-text-primary focus:border-accent focus:outline-none"
                      >
                        {presetDef.models.map((m) => (
                          <option key={m.id} value={m.id}>
                            {m.label}
                          </option>
                        ))}
                        <option value="__custom__">手动输入其他模型 ID…</option>
                      </select>
                    )}
                    <input
                      type="text"
                      value={selected.modelId}
                      onChange={(e) => updateProvider(selected.id, { modelId: e.target.value })}
                      placeholder="输入精确 Model ID，例如 deepseek-flash"
                      className="w-full rounded-xl border border-border-subtle bg-surface-subtle px-3 py-1.5 font-mono text-xs text-text-primary focus:border-accent focus:outline-none"
                    />
                  </div>
                </div>
              </div>

              {/* Capability Checkboxes (Editable for Custom, transparent for Presets) */}
              <div className="flex flex-wrap items-center gap-4 rounded-xl bg-surface-subtle/70 px-3.5 py-2.5 text-xs">
                <label className="inline-flex items-center gap-1.5 text-text-secondary cursor-pointer">
                  <input
                    type="checkbox"
                    checked={selected.capabilities.vision}
                    onChange={(e) =>
                      updateProvider(selected.id, {
                        capabilities: { ...selected.capabilities, vision: e.target.checked },
                      })
                    }
                    className="accent-accent"
                  />
                  支持图像输入 (Vision OCR)
                </label>

                <label className="inline-flex items-center gap-1.5 text-text-secondary cursor-pointer">
                  <input
                    type="checkbox"
                    checked={selected.capabilities.disableSamplingWhenThinking}
                    onChange={(e) =>
                      updateProvider(selected.id, {
                        capabilities: {
                          ...selected.capabilities,
                          disableSamplingWhenThinking: e.target.checked,
                        },
                      })
                    }
                    className="accent-accent"
                  />
                  思考时自动省略采样参数（防 400）
                </label>

                {presetDef && (
                  <span className="ml-auto text-[11px] text-answer">{presetDef.corsNote}</span>
                )}
              </div>
            </div>

            {/* ==================== 2. Thinking & Reasoning Control ==================== */}
            <div className="border-t border-border-subtle pt-5 space-y-3.5">
              <div className="flex items-center gap-2">
                <Brain className="h-4 w-4 text-accent" />
                <h3 className="text-sm font-semibold text-text-primary">深度思考 / 推理参数</h3>
              </div>

              <div className="rounded-xl border border-border-subtle bg-surface-subtle/60 p-3 text-xs leading-relaxed text-text-secondary flex items-start gap-2">
                <Info className="h-4 w-4 shrink-0 text-accent mt-0.5" />
                <span>{thinkingSpecNote()}</span>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <label className="flex items-center justify-between rounded-xl border border-border-subtle bg-surface-subtle/50 px-3.5 py-2.5 text-xs cursor-pointer">
                  <div>
                    <div className="font-semibold text-text-primary">开启深度思考模式</div>
                    <div className="text-[11px] text-text-muted">
                      {selected.capabilities.alwaysOnThinking
                        ? '当前旗舰模型强制常驻思考'
                        : '关闭可提速并降低 Token 成本'}
                    </div>
                  </div>
                  <input
                    type="checkbox"
                    disabled={Boolean(selected.capabilities.alwaysOnThinking)}
                    checked={
                      Boolean(selected.capabilities.alwaysOnThinking) ||
                      selected.params.thinking.enabled
                    }
                    onChange={(e) =>
                      updateProviderParams(selected.id, {
                        thinking: { ...selected.params.thinking, enabled: e.target.checked },
                      })
                    }
                    className="h-4 w-4 accent-accent"
                  />
                </label>

                <label className="flex items-center justify-between rounded-xl border border-border-subtle bg-surface-subtle/50 px-3.5 py-2.5 text-xs cursor-pointer">
                  <div>
                    <div className="font-semibold text-text-primary">实时展示模型思考过程</div>
                    <div className="text-[11px] text-text-muted">
                      在执行面板中提供可折叠的推理流
                    </div>
                  </div>
                  <input
                    type="checkbox"
                    checked={selected.params.thinking.includeThoughts}
                    onChange={(e) =>
                      updateProviderParams(selected.id, {
                        thinking: {
                          ...selected.params.thinking,
                          includeThoughts: e.target.checked,
                        },
                      })
                    }
                    className="h-4 w-4 accent-accent"
                  />
                </label>
              </div>

              {/* Effort selector (when effort mode supported) */}
              {selected.capabilities.thinking.includes('effort') && (
                <div>
                  <label className="block text-xs font-medium text-text-secondary mb-1.5">
                    推理深度档位 (Effort / Thinking Level)
                  </label>
                  <div className="flex flex-wrap gap-1.5">
                    {(
                      selected.capabilities.supportedEfforts || [
                        'none',
                        'low',
                        'medium',
                        'high',
                        'max',
                      ]
                    ).map((eff) => {
                      const active = selected.params.thinking.effort === eff;
                      return (
                        <button
                          key={eff}
                          type="button"
                          onClick={() =>
                            updateProviderParams(selected.id, {
                              thinking: {
                                ...selected.params.thinking,
                                enabled: eff !== 'none',
                                effort: eff,
                              },
                            })
                          }
                          className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition ${
                            active
                              ? 'border-accent bg-accent text-white'
                              : 'border-border-subtle bg-surface-subtle text-text-secondary hover:text-text-primary'
                          }`}
                        >
                          {EFFORT_LABELS[eff]}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Token Budget input (when budget mode supported) */}
              {selected.capabilities.thinking.includes('budget') && (
                <div>
                  <label className="block text-xs font-medium text-text-secondary mb-1">
                    思考 Token 预算上限 (thinking_budget / budget_tokens)
                    {selected.capabilities.thinkingVariant === 'gemini-budget' && (
                      <span className="ml-1.5 text-text-muted">（Gemini 2.5 填 -1 为动态思考）</span>
                    )}
                  </label>
                  <input
                    type="number"
                    value={selected.params.thinking.budgetTokens ?? 8192}
                    onChange={(e) =>
                      updateProviderParams(selected.id, {
                        thinking: {
                          ...selected.params.thinking,
                          budgetTokens: Number(e.target.value),
                        },
                      })
                    }
                    className="w-56 rounded-xl border border-border-subtle bg-surface-subtle px-3 py-2 font-mono text-xs text-text-primary focus:border-accent focus:outline-none"
                  />
                </div>
              )}
            </div>

            {/* ==================== 3. Context Window & Token Limits ==================== */}
            <div className="border-t border-border-subtle pt-5 space-y-3.5">
              <div className="flex items-center gap-2">
                <Sliders className="h-4 w-4 text-accent" />
                <h3 className="text-sm font-semibold text-text-primary">上下文窗口与采样参数</h3>
              </div>

              <div className="grid gap-3 sm:grid-cols-3">
                <div>
                  <label className="block text-xs font-medium text-text-secondary mb-1">
                    上下文窗口 (Context Window)
                  </label>
                  <input
                    type="number"
                    value={selected.params.contextWindow}
                    onChange={(e) =>
                      updateProviderParams(selected.id, {
                        contextWindow: Math.max(4096, Number(e.target.value) || 128000),
                      })
                    }
                    className="w-full rounded-xl border border-border-subtle bg-surface-subtle px-3 py-2 font-mono text-xs text-text-primary focus:border-accent focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-text-secondary mb-1">
                    最大输入保护阈值 (Max Input)
                  </label>
                  <input
                    type="number"
                    value={selected.params.maxInputTokens}
                    onChange={(e) =>
                      updateProviderParams(selected.id, {
                        maxInputTokens: Math.max(2048, Number(e.target.value) || 100000),
                      })
                    }
                    className="w-full rounded-xl border border-border-subtle bg-surface-subtle px-3 py-2 font-mono text-xs text-text-primary focus:border-accent focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-text-secondary mb-1">
                    最大输出 Token (Max Output)
                  </label>
                  <input
                    type="number"
                    value={selected.params.maxOutputTokens}
                    onChange={(e) =>
                      updateProviderParams(selected.id, {
                        maxOutputTokens: Math.max(512, Number(e.target.value) || 16384),
                      })
                    }
                    className="w-full rounded-xl border border-border-subtle bg-surface-subtle px-3 py-2 font-mono text-xs text-text-primary focus:border-accent focus:outline-none"
                  />
                </div>
              </div>

              {isSamplingDisabled && (
                <div className="rounded-xl bg-vocab-soft/60 px-3 py-2 text-xs text-vocab">
                  当前模型开启思考模式时禁止修改采样参数（temperature / top_p 等），发包时适配器将自动省略以避免 400 报错。
                </div>
              )}

              <div className={`grid gap-3 sm:grid-cols-3 ${isSamplingDisabled ? 'opacity-45 pointer-events-none' : ''}`}>
                <div>
                  <label className="block text-xs font-medium text-text-secondary mb-1">
                    Temperature（留空用默认，建议 0.2）
                  </label>
                  <input
                    type="number"
                    step="0.05"
                    min="0"
                    max="2"
                    value={selected.params.temperature ?? ''}
                    placeholder="默认"
                    onChange={(e) =>
                      updateProviderParams(selected.id, {
                        temperature: e.target.value === '' ? null : Number(e.target.value),
                      })
                    }
                    className="w-full rounded-xl border border-border-subtle bg-surface-subtle px-3 py-2 font-mono text-xs text-text-primary focus:border-accent focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-text-secondary mb-1">
                    Top P（0 ~ 1，留空用默认）
                  </label>
                  <input
                    type="number"
                    step="0.05"
                    min="0"
                    max="1"
                    value={selected.params.topP ?? ''}
                    placeholder="默认"
                    onChange={(e) =>
                      updateProviderParams(selected.id, {
                        topP: e.target.value === '' ? null : Number(e.target.value),
                      })
                    }
                    className="w-full rounded-xl border border-border-subtle bg-surface-subtle px-3 py-2 font-mono text-xs text-text-primary focus:border-accent focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-text-secondary mb-1">
                    Top K（仅 Gemini/Claude/百炼）
                  </label>
                  <input
                    type="number"
                    min="1"
                    disabled={!selected.capabilities.supportsTopK}
                    value={selected.params.topK ?? ''}
                    placeholder={selected.capabilities.supportsTopK ? '默认' : '不支持'}
                    onChange={(e) =>
                      updateProviderParams(selected.id, {
                        topK: e.target.value === '' ? null : Number(e.target.value),
                      })
                    }
                    className="w-full rounded-xl border border-border-subtle bg-surface-subtle px-3 py-2 font-mono text-xs text-text-primary focus:border-accent focus:outline-none disabled:opacity-50"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-text-secondary mb-1">
                    Frequency Penalty (-2 ~ 2)
                  </label>
                  <input
                    type="number"
                    step="0.1"
                    min="-2"
                    max="2"
                    disabled={!selected.capabilities.supportsFrequencyPenalty}
                    value={selected.params.frequencyPenalty ?? ''}
                    placeholder={selected.capabilities.supportsFrequencyPenalty ? '默认' : '不支持'}
                    onChange={(e) =>
                      updateProviderParams(selected.id, {
                        frequencyPenalty: e.target.value === '' ? null : Number(e.target.value),
                      })
                    }
                    className="w-full rounded-xl border border-border-subtle bg-surface-subtle px-3 py-2 font-mono text-xs text-text-primary focus:border-accent focus:outline-none disabled:opacity-50"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-text-secondary mb-1">
                    Presence Penalty (-2 ~ 2)
                  </label>
                  <input
                    type="number"
                    step="0.1"
                    min="-2"
                    max="2"
                    disabled={!selected.capabilities.supportsPresencePenalty}
                    value={selected.params.presencePenalty ?? ''}
                    placeholder={selected.capabilities.supportsPresencePenalty ? '默认' : '不支持'}
                    onChange={(e) =>
                      updateProviderParams(selected.id, {
                        presencePenalty: e.target.value === '' ? null : Number(e.target.value),
                      })
                    }
                    className="w-full rounded-xl border border-border-subtle bg-surface-subtle px-3 py-2 font-mono text-xs text-text-primary focus:border-accent focus:outline-none disabled:opacity-50"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-text-secondary mb-1">
                    Seed 随机种子（可选）
                  </label>
                  <input
                    type="number"
                    disabled={!selected.capabilities.supportsSeed}
                    value={selected.params.seed ?? ''}
                    placeholder={selected.capabilities.supportsSeed ? '留空随机' : '不支持'}
                    onChange={(e) =>
                      updateProviderParams(selected.id, {
                        seed: e.target.value === '' ? null : Number(e.target.value),
                      })
                    }
                    className="w-full rounded-xl border border-border-subtle bg-surface-subtle px-3 py-2 font-mono text-xs text-text-primary focus:border-accent focus:outline-none disabled:opacity-50"
                  />
                </div>
              </div>

              {/* Transport & Advanced */}
              <div className="grid gap-3 sm:grid-cols-4 pt-2">
                <label className="flex items-center justify-between rounded-xl border border-border-subtle bg-surface-subtle px-3 py-2 text-xs cursor-pointer">
                  <span className="font-medium text-text-primary">
                    流式传输 {isStreamLocked ? '(必开)' : ''}
                  </span>
                  <input
                    type="checkbox"
                    disabled={isStreamLocked}
                    checked={isStreamLocked || selected.params.stream}
                    onChange={(e) =>
                      updateProviderParams(selected.id, { stream: e.target.checked })
                    }
                    className="accent-accent"
                  />
                </label>

                <div>
                  <label className="block text-[11px] font-medium text-text-secondary mb-1">
                    结构化 JSON 模式
                  </label>
                  <select
                    value={selected.params.structuredOutputMode}
                    onChange={(e) =>
                      updateProviderParams(selected.id, {
                        structuredOutputMode: e.target.value as any,
                      })
                    }
                    className="w-full rounded-xl border border-border-subtle bg-surface-subtle px-2.5 py-1.5 text-xs text-text-primary focus:border-accent focus:outline-none"
                  >
                    <option value="auto">自动协商（推荐）</option>
                    <option value="json_object">json_object</option>
                    <option value="prompt_only">仅 Prompt 约束</option>
                  </select>
                </div>

                <div>
                  <label className="block text-[11px] font-medium text-text-secondary mb-1">
                    OCR 图像清晰度
                  </label>
                  <select
                    value={selected.params.imageDetail}
                    onChange={(e) =>
                      updateProviderParams(selected.id, {
                        imageDetail: e.target.value as 'auto' | 'low' | 'high',
                      })
                    }
                    className="w-full rounded-xl border border-border-subtle bg-surface-subtle px-2.5 py-1.5 text-xs text-text-primary focus:border-accent focus:outline-none"
                  >
                    <option value="high">high（试卷推荐）</option>
                    <option value="auto">auto</option>
                    <option value="low">low（省 Token）</option>
                  </select>
                </div>

                <div>
                  <label className="block text-[11px] font-medium text-text-secondary mb-1">
                    超时时间 (秒)
                  </label>
                  <input
                    type="number"
                    min="15"
                    max="600"
                    value={Math.round((selected.params.timeoutMs || 180000) / 1000)}
                    onChange={(e) =>
                      updateProviderParams(selected.id, {
                        timeoutMs: Math.max(15, Number(e.target.value) || 180) * 1000,
                      })
                    }
                    className="w-full rounded-xl border border-border-subtle bg-surface-subtle px-2.5 py-1.5 font-mono text-xs text-text-primary focus:border-accent focus:outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-text-secondary mb-1">
                  额外请求体 JSON 透传（Extra Body，合并至顶层 JSON，可选）
                </label>
                <textarea
                  rows={2}
                  value={selected.params.extraBodyJson}
                  onChange={(e) =>
                    updateProviderParams(selected.id, { extraBodyJson: e.target.value })
                  }
                  placeholder='例如：{ "repetition_penalty": 1.05 }'
                  className="w-full rounded-xl border border-border-subtle bg-surface-subtle px-3 py-2 font-mono text-xs text-text-primary placeholder:text-text-muted focus:border-accent focus:outline-none"
                />
              </div>
            </div>
          </div>

          {/* WebDAV Cloud Backup & Sync Island */}
          <WebDavSyncCard />

          {/* Local Data Backup & Restore Island */}
          <div className="island p-5 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-surface-subtle text-text-secondary">
                <Database className="h-4.5 w-4.5" />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-text-primary">本地 JSON 备份与迁移</h3>
                <p className="text-xs text-text-secondary">
                  导出全部试卷精读、生词本与应用设置（自动剔除 API Key），支持智能按最新时间合并恢复。
                </p>
                {backupMessage && (
                  <p className="mt-1 text-xs font-medium text-answer">{backupMessage}</p>
                )}
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleExportBackup}
                className="inline-flex items-center gap-1.5 rounded-xl border border-border-subtle bg-surface-subtle px-3.5 py-2 text-xs font-medium text-text-primary hover:border-border-strong"
              >
                <Download className="h-3.5 w-3.5" />
                导出备份 JSON
              </button>

              <button
                type="button"
                onClick={() => importInputRef.current?.click()}
                className="inline-flex items-center gap-1.5 rounded-xl border border-border-subtle bg-surface-subtle px-3.5 py-2 text-xs font-medium text-text-primary hover:border-border-strong"
              >
                <Upload className="h-3.5 w-3.5" />
                导入恢复
              </button>
              <input
                ref={importInputRef}
                type="file"
                accept="application/json,.json"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) handleImportBackup(f);
                  e.target.value = '';
                }}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
