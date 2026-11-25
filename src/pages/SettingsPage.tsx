import { useRef, useState } from 'react';
import {
  Brain,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Cloud,
  Database,
  Download,
  ExternalLink,
  Eye,
  EyeOff,
  Loader2,
  Plus,
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

type SettingsSection =
  | { kind: 'provider'; id: string }
  | { kind: 'webdav' }
  | { kind: 'export' };

const EFFORT_LABELS: Record<ReasoningEffort, string> = {
  none: 'none',
  minimal: 'minimal',
  low: 'low',
  medium: 'medium',
  high: 'high',
  xhigh: 'xhigh',
  max: 'max',
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

  const [activeNav, setActiveNav] = useState<SettingsSection>({
    kind: 'provider',
    id: activeProviderId,
  });
  const [showKey, setShowKey] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<LLMCallResult | null>(null);
  const [testError, setTestError] = useState<LLMErrorDetail | null>(null);
  const [backupMessage, setBackupMessage] = useState<string | null>(null);
  const importInputRef = useRef<HTMLInputElement>(null);

  const selectedProviderId =
    activeNav.kind === 'provider' ? activeNav.id : activeProviderId;
  const selected =
    providers.find((p) => p.id === selectedProviderId) || providers[0];
  const presetDef =
    selected.presetKey !== 'custom' ? PRESET_PROVIDERS[selected.presetKey] : null;

  const isSamplingDisabled =
    (selected.params.thinking.enabled || selected.capabilities.alwaysOnThinking) &&
    selected.capabilities.disableSamplingWhenThinking;

  const isStreamLocked =
    selected.params.thinking.enabled && selected.capabilities.streamRequiredWhenThinking;

  const selectProvider = (id: string) => {
    setActiveNav({ kind: 'provider', id });
    setTestResult(null);
    setTestError(null);
  };

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
    setBackupMessage(`已导出 ${bundle.papers.length} 套试卷与设置（不含密钥）`);
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
          res.skippedOlder > 0 ? `、跳过较旧 ${res.skippedOlder} 套` : ''
        }`,
      );
    } catch (err) {
      setBackupMessage(`导入失败：${err instanceof Error ? err.message : String(err)}`);
    }
  };

  return (
    <div className="space-y-4">
      {/* Compact Page Title */}
      <div className="flex items-center justify-between px-1">
        <h1 className="text-lg font-bold tracking-tight text-text-primary">设置</h1>
      </div>

      {/* Two-Column Settings Layout */}
      <div className="grid gap-4 lg:grid-cols-[240px_minmax(0,1fr)]">
        {/* Left Navigation Sidebar: LLM Providers + Sync & Export */}
        <aside className="island p-3 space-y-1.5 h-fit lg:sticky lg:top-4">
          <div className="px-2 pt-1 text-[11px] font-semibold uppercase tracking-wider text-text-muted">
            LLM 供应商
          </div>
          {providers
            .filter((p) => p.presetKey !== 'custom')
            .map((p) => {
              const isSelected = activeNav.kind === 'provider' && activeNav.id === p.id;
              const isActive = p.id === activeProviderId;
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => selectProvider(p.id)}
                  className={`w-full rounded-xl border px-3 py-2 text-left transition ${
                    isSelected
                      ? 'border-accent bg-accent-soft/60'
                      : 'border-transparent hover:bg-surface-subtle'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-medium text-text-primary">{p.name}</span>
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
                        主模型
                      </span>
                    )}
                  </div>
                </button>
              );
            })}

          {providers.some((p) => p.presetKey === 'custom') && (
            <>
              <div className="px-2 pt-2.5 text-[11px] font-semibold uppercase tracking-wider text-text-muted">
                自定义供应商
              </div>
              {providers
                .filter((p) => p.presetKey === 'custom')
                .map((p) => {
                  const isSelected = activeNav.kind === 'provider' && activeNav.id === p.id;
                  return (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => selectProvider(p.id)}
                      className={`w-full rounded-xl border px-3 py-2 text-left transition ${
                        isSelected
                          ? 'border-accent bg-accent-soft/60'
                          : 'border-transparent hover:bg-surface-subtle'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate text-sm font-medium text-text-primary">
                          {p.name}
                        </span>
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
                  );
                })}
            </>
          )}

          <button
            type="button"
            onClick={() => {
              const created = addCustomProvider();
              selectProvider(created.id);
            }}
            className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-border-strong py-2 text-xs font-medium text-text-secondary transition hover:border-accent hover:text-accent"
          >
            <Plus className="h-3.5 w-3.5" />
            添加自定义供应商
          </button>

          {/* Parallel Group: Sync & Export */}
          <div className="pt-2.5 mt-2 border-t border-border-subtle space-y-1">
            <div className="px-2 pt-0.5 text-[11px] font-semibold uppercase tracking-wider text-text-muted">
              同步与导出
            </div>
            <button
              type="button"
              onClick={() => setActiveNav({ kind: 'webdav' })}
              className={`flex w-full items-center gap-2.5 rounded-xl border px-3 py-2 text-left text-sm font-medium transition ${
                activeNav.kind === 'webdav'
                  ? 'border-accent bg-accent-soft/60 text-accent'
                  : 'border-transparent text-text-secondary hover:bg-surface-subtle hover:text-text-primary'
              }`}
            >
              <Cloud className="h-4 w-4 shrink-0" />
              <span>WebDAV 同步</span>
            </button>

            <button
              type="button"
              onClick={() => setActiveNav({ kind: 'export' })}
              className={`flex w-full items-center gap-2.5 rounded-xl border px-3 py-2 text-left text-sm font-medium transition ${
                activeNav.kind === 'export'
                  ? 'border-accent bg-accent-soft/60 text-accent'
                  : 'border-transparent text-text-secondary hover:bg-surface-subtle hover:text-text-primary'
              }`}
            >
              <Database className="h-4 w-4 shrink-0" />
              <span>导出与本地备份</span>
            </button>
          </div>
        </aside>

        {/* Right Main Content Area */}
        <div className="space-y-4 min-w-0">
          {activeNav.kind === 'webdav' ? (
            <WebDavSyncCard />
          ) : activeNav.kind === 'export' ? (
            <div className="island p-5 sm:p-6 space-y-4">
              <div className="flex items-center gap-2.5 border-b border-border-subtle pb-3.5">
                <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-surface-subtle text-text-secondary">
                  <Database className="h-4 w-4" />
                </div>
                <div>
                  <h2 className="text-base font-semibold text-text-primary">导出与本地备份</h2>
                  <p className="text-xs text-text-muted">
                    导出或导入全部试卷、生词本与非敏感设置（自动剔除密钥）
                  </p>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2.5">
                <button
                  type="button"
                  onClick={handleExportBackup}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-accent px-4 py-2 text-xs font-semibold text-white shadow-xs transition hover:opacity-92"
                >
                  <Download className="h-3.5 w-3.5" />
                  导出 JSON 备份
                </button>

                <button
                  type="button"
                  onClick={() => importInputRef.current?.click()}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-border-subtle bg-surface-subtle px-4 py-2 text-xs font-medium text-text-primary hover:border-border-strong"
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

              {backupMessage && (
                <div className="rounded-xl border border-answer/30 bg-answer-soft/40 px-3.5 py-2.5 text-xs text-text-primary flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-answer shrink-0" />
                  <span>{backupMessage}</span>
                </div>
              )}
            </div>
          ) : (
            <>
              {/* Demoted Compact Model Routing & Concurrency Card */}
              <div className="island p-4 grid gap-3 sm:grid-cols-3">
                <div>
                  <label className="block text-[11.5px] font-medium text-text-secondary mb-1">
                    主分析模型
                  </label>
                  <select
                    value={activeProviderId}
                    onChange={(e) => {
                      setActiveProviderId(e.target.value);
                      selectProvider(e.target.value);
                    }}
                    className="w-full rounded-xl border border-border-subtle bg-surface-subtle px-2.5 py-1.5 text-xs font-medium text-text-primary focus:border-accent focus:outline-none"
                  >
                    {providers.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} · {p.modelId || '未设模型'} {p.apiKey ? '✓' : ''}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-[11.5px] font-medium text-text-secondary">
                      视觉 OCR 模型
                    </label>
                    <label className="inline-flex items-center gap-1 text-[11px] text-text-muted cursor-pointer">
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
                    className="w-full rounded-xl border border-border-subtle bg-surface-subtle px-2.5 py-1.5 text-xs font-medium text-text-primary focus:border-accent focus:outline-none disabled:opacity-55"
                  >
                    {providers.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} · {p.modelId || '未设'} {p.capabilities.vision ? '' : '[无视觉]'}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-[11.5px] font-medium text-text-secondary mb-1">
                    并发请求数
                  </label>
                  <div className="flex items-center gap-1.5">
                    {[1, 2, 3, 4].map((n) => (
                      <button
                        key={n}
                        type="button"
                        onClick={() => setConcurrency(n)}
                        className={`flex-1 rounded-xl border py-1.5 text-xs font-mono font-semibold transition ${
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

              {/* Selected Provider Form */}
              <div className="island p-5 sm:p-6 space-y-5">
                {/* Provider Header */}
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border-subtle pb-4">
                  <div className="flex flex-wrap items-center gap-2 min-w-0">
                    {selected.presetKey === 'custom' ? (
                      <input
                        type="text"
                        value={selected.name}
                        onChange={(e) => updateProvider(selected.id, { name: e.target.value })}
                        className="rounded-lg border border-border-subtle bg-surface-subtle px-2.5 py-1 text-base font-semibold text-text-primary focus:border-accent focus:outline-none"
                      />
                    ) : (
                      <h2 className="text-base font-semibold text-text-primary">{selected.name}</h2>
                    )}
                    {presetDef && (
                      <a
                        href={presetDef.docsUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-0.5 text-xs text-accent hover:underline"
                      >
                        文档 <ExternalLink className="h-3 w-3" />
                      </a>
                    )}
                  </div>

                  <div className="flex items-center gap-2">
                    {activeProviderId !== selected.id && (
                      <button
                        type="button"
                        onClick={() => setActiveProviderId(selected.id)}
                        className="rounded-xl border border-accent/40 bg-accent-soft px-3 py-1.5 text-xs font-semibold text-accent hover:bg-accent hover:text-white transition"
                      >
                        设为主模型
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
                          selectProvider('deepseek');
                        }}
                        className="rounded-xl border border-danger/30 p-1.5 text-danger hover:bg-danger-soft"
                        title="删除供应商"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                </div>

                {/* Connection Test Feedback */}
                {testResult && (
                  <div className="rounded-xl border border-answer/30 bg-answer-soft/50 px-3.5 py-2.5 text-xs text-text-primary flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <CheckCircle2 className="h-4 w-4 text-answer shrink-0" />
                      <span>
                        连接成功：
                        <code className="ml-1 rounded bg-surface px-1.5 py-0.5 font-mono">
                          {testResult.content.trim().slice(0, 60) || '(empty)'}
                        </code>
                      </span>
                    </div>
                    <span className="font-mono text-text-muted">
                      TTFT {testResult.ttftMs ?? '-'}ms · {testResult.durationMs}ms
                    </span>
                  </div>
                )}
                {testError && <ErrorDiagnosticCard error={testError} onRetry={handleTestConnection} />}

                {/* 1. Connection & Model */}
                <div className="space-y-3.5">
                  {selected.presetKey === 'dashscope' && (
                    <div className="rounded-xl border border-accent/25 bg-accent-soft/25 p-3.5 space-y-2.5">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="text-xs font-semibold text-accent">
                          百炼业务空间域名
                        </span>
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
                          使用通用旧域名
                        </label>
                      </div>

                      {!selected.workspaceMeta?.useLegacyEndpoint && (
                        <div className="grid gap-3 sm:grid-cols-2">
                          <div>
                            <label className="block text-[11px] font-medium text-text-secondary mb-1">
                              WorkspaceId
                            </label>
                            <input
                              type="text"
                              value={selected.workspaceMeta?.workspaceId || ''}
                              onChange={(e) =>
                                updateBailianWorkspace(selected.id, { workspaceId: e.target.value })
                              }
                              placeholder="llm-xxxx"
                              className="w-full rounded-xl border border-border-subtle bg-surface px-3 py-1.5 font-mono text-xs text-text-primary focus:border-accent focus:outline-none"
                            />
                          </div>
                          <div>
                            <label className="block text-[11px] font-medium text-text-secondary mb-1">
                              地域
                            </label>
                            <select
                              value={selected.workspaceMeta?.region || 'cn-beijing'}
                              onChange={(e) =>
                                updateBailianWorkspace(selected.id, { region: e.target.value })
                              }
                              className="w-full rounded-xl border border-border-subtle bg-surface px-3 py-1.5 text-xs text-text-primary focus:border-accent focus:outline-none"
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
                    </div>
                  )}

                  <div className="grid gap-3.5 sm:grid-cols-2">
                    <div>
                      <label className="block text-xs font-medium text-text-secondary mb-1">
                        API 协议
                      </label>
                      <select
                        value={selected.protocol}
                        onChange={(e) =>
                          updateProvider(selected.id, { protocol: e.target.value as ApiProtocol })
                        }
                        className="w-full rounded-xl border border-border-subtle bg-surface-subtle px-3 py-2 text-xs text-text-primary focus:border-accent focus:outline-none"
                      >
                        <option value="openai-compatible">OpenAI Compatible</option>
                        <option value="openai-responses">OpenAI Responses</option>
                        <option value="anthropic-messages">Anthropic Messages</option>
                        <option value="gemini-native">Google Gemini Native</option>
                      </select>
                    </div>

                    <div>
                      <label className="block text-xs font-medium text-text-secondary mb-1">
                        Base URL
                      </label>
                      <input
                        type="text"
                        value={selected.baseUrl}
                        onChange={(e) => updateProvider(selected.id, { baseUrl: e.target.value })}
                        placeholder="https://api.example.com/v1"
                        className="w-full rounded-xl border border-border-subtle bg-surface-subtle px-3 py-2 font-mono text-xs text-text-primary focus:border-accent focus:outline-none"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-medium text-text-secondary mb-1">
                        API Key
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
                        模型 ID
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
                            <option value="__custom__">自定义模型 ID…</option>
                          </select>
                        )}
                        <input
                          type="text"
                          value={selected.modelId}
                          onChange={(e) => updateProvider(selected.id, { modelId: e.target.value })}
                          placeholder="Model ID"
                          className="w-full rounded-xl border border-border-subtle bg-surface-subtle px-3 py-1.5 font-mono text-xs text-text-primary focus:border-accent focus:outline-none"
                        />
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-4 rounded-xl bg-surface-subtle/60 px-3.5 py-2 text-xs">
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
                      支持图像 (Vision)
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
                      思考时省略采样参数
                    </label>
                  </div>
                </div>

                {/* 2. Thinking & Reasoning Control */}
                <div className="border-t border-border-subtle pt-4 space-y-3">
                  <div className="flex items-center gap-2">
                    <Brain className="h-4 w-4 text-accent" />
                    <h3 className="text-sm font-semibold text-text-primary">深度思考</h3>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2">
                    <label className="flex items-center justify-between rounded-xl border border-border-subtle bg-surface-subtle/50 px-3.5 py-2 text-xs cursor-pointer">
                      <span className="font-medium text-text-primary">
                        开启思考模式{selected.capabilities.alwaysOnThinking ? '（必开）' : ''}
                      </span>
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

                    <label className="flex items-center justify-between rounded-xl border border-border-subtle bg-surface-subtle/50 px-3.5 py-2 text-xs cursor-pointer">
                      <span className="font-medium text-text-primary">展示思考过程</span>
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

                  {selected.capabilities.thinking.includes('effort') && (
                    <div>
                      <label className="block text-xs font-medium text-text-secondary mb-1.5">
                        推理强度 (Effort)
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
                              className={`rounded-lg border px-3 py-1 text-xs font-medium transition ${
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

                  {selected.capabilities.thinking.includes('budget') && (
                    <div>
                      <label className="block text-xs font-medium text-text-secondary mb-1">
                        思考 Token 预算
                        {selected.capabilities.thinkingVariant === 'gemini-budget' && (
                          <span className="ml-1.5 text-text-muted">（-1 为动态）</span>
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
                        className="w-48 rounded-xl border border-border-subtle bg-surface-subtle px-3 py-1.5 font-mono text-xs text-text-primary focus:border-accent focus:outline-none"
                      />
                    </div>
                  )}
                </div>

                {/* 3. Collapsible Advanced Parameters */}
                <div className="border-t border-border-subtle pt-4">
                  <button
                    type="button"
                    onClick={() => setAdvancedOpen((v) => !v)}
                    className="flex w-full items-center justify-between text-left"
                  >
                    <span className="inline-flex items-center gap-2 text-sm font-semibold text-text-primary">
                      <Sliders className="h-4 w-4 text-accent" />
                      高级参数（上下文 / 采样 / 超时）
                    </span>
                    <span className="inline-flex items-center gap-1 text-xs text-text-muted">
                      {advancedOpen ? (
                        <>
                          收起 <ChevronDown className="h-4 w-4" />
                        </>
                      ) : (
                        <>
                          展开 <ChevronRight className="h-4 w-4" />
                        </>
                      )}
                    </span>
                  </button>

                  {advancedOpen && (
                    <div className="mt-4 space-y-3.5">
                      <div className="grid gap-3 sm:grid-cols-3">
                        <div>
                          <label className="block text-xs font-medium text-text-secondary mb-1">
                            Context Window
                          </label>
                          <input
                            type="number"
                            value={selected.params.contextWindow}
                            onChange={(e) =>
                              updateProviderParams(selected.id, {
                                contextWindow: Math.max(4096, Number(e.target.value) || 128000),
                              })
                            }
                            className="w-full rounded-xl border border-border-subtle bg-surface-subtle px-3 py-1.5 font-mono text-xs text-text-primary focus:border-accent focus:outline-none"
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-text-secondary mb-1">
                            Max Input
                          </label>
                          <input
                            type="number"
                            value={selected.params.maxInputTokens}
                            onChange={(e) =>
                              updateProviderParams(selected.id, {
                                maxInputTokens: Math.max(2048, Number(e.target.value) || 100000),
                              })
                            }
                            className="w-full rounded-xl border border-border-subtle bg-surface-subtle px-3 py-1.5 font-mono text-xs text-text-primary focus:border-accent focus:outline-none"
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-text-secondary mb-1">
                            Max Output
                          </label>
                          <input
                            type="number"
                            value={selected.params.maxOutputTokens}
                            onChange={(e) =>
                              updateProviderParams(selected.id, {
                                maxOutputTokens: Math.max(512, Number(e.target.value) || 16384),
                              })
                            }
                            className="w-full rounded-xl border border-border-subtle bg-surface-subtle px-3 py-1.5 font-mono text-xs text-text-primary focus:border-accent focus:outline-none"
                          />
                        </div>
                      </div>

                      <div
                        className={`grid gap-3 sm:grid-cols-3 ${
                          isSamplingDisabled ? 'opacity-45 pointer-events-none' : ''
                        }`}
                      >
                        <div>
                          <label className="block text-xs font-medium text-text-secondary mb-1">
                            Temperature
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
                            className="w-full rounded-xl border border-border-subtle bg-surface-subtle px-3 py-1.5 font-mono text-xs text-text-primary focus:border-accent focus:outline-none"
                          />
                        </div>

                        <div>
                          <label className="block text-xs font-medium text-text-secondary mb-1">
                            Top P
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
                            className="w-full rounded-xl border border-border-subtle bg-surface-subtle px-3 py-1.5 font-mono text-xs text-text-primary focus:border-accent focus:outline-none"
                          />
                        </div>

                        <div>
                          <label className="block text-xs font-medium text-text-secondary mb-1">
                            Top K
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
                            className="w-full rounded-xl border border-border-subtle bg-surface-subtle px-3 py-1.5 font-mono text-xs text-text-primary focus:border-accent focus:outline-none disabled:opacity-50"
                          />
                        </div>

                        <div>
                          <label className="block text-xs font-medium text-text-secondary mb-1">
                            Frequency Penalty
                          </label>
                          <input
                            type="number"
                            step="0.1"
                            min="-2"
                            max="2"
                            disabled={!selected.capabilities.supportsFrequencyPenalty}
                            value={selected.params.frequencyPenalty ?? ''}
                            placeholder={
                              selected.capabilities.supportsFrequencyPenalty ? '默认' : '不支持'
                            }
                            onChange={(e) =>
                              updateProviderParams(selected.id, {
                                frequencyPenalty:
                                  e.target.value === '' ? null : Number(e.target.value),
                              })
                            }
                            className="w-full rounded-xl border border-border-subtle bg-surface-subtle px-3 py-1.5 font-mono text-xs text-text-primary focus:border-accent focus:outline-none disabled:opacity-50"
                          />
                        </div>

                        <div>
                          <label className="block text-xs font-medium text-text-secondary mb-1">
                            Presence Penalty
                          </label>
                          <input
                            type="number"
                            step="0.1"
                            min="-2"
                            max="2"
                            disabled={!selected.capabilities.supportsPresencePenalty}
                            value={selected.params.presencePenalty ?? ''}
                            placeholder={
                              selected.capabilities.supportsPresencePenalty ? '默认' : '不支持'
                            }
                            onChange={(e) =>
                              updateProviderParams(selected.id, {
                                presencePenalty:
                                  e.target.value === '' ? null : Number(e.target.value),
                              })
                            }
                            className="w-full rounded-xl border border-border-subtle bg-surface-subtle px-3 py-1.5 font-mono text-xs text-text-primary focus:border-accent focus:outline-none disabled:opacity-50"
                          />
                        </div>

                        <div>
                          <label className="block text-xs font-medium text-text-secondary mb-1">
                            Seed
                          </label>
                          <input
                            type="number"
                            disabled={!selected.capabilities.supportsSeed}
                            value={selected.params.seed ?? ''}
                            placeholder={selected.capabilities.supportsSeed ? '随机' : '不支持'}
                            onChange={(e) =>
                              updateProviderParams(selected.id, {
                                seed: e.target.value === '' ? null : Number(e.target.value),
                              })
                            }
                            className="w-full rounded-xl border border-border-subtle bg-surface-subtle px-3 py-1.5 font-mono text-xs text-text-primary focus:border-accent focus:outline-none disabled:opacity-50"
                          />
                        </div>
                      </div>

                      <div className="grid gap-3 sm:grid-cols-4">
                        <label className="flex items-center justify-between rounded-xl border border-border-subtle bg-surface-subtle px-3 py-1.5 text-xs cursor-pointer">
                          <span className="font-medium text-text-primary">
                            流式{isStreamLocked ? ' (必开)' : ''}
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
                            JSON 模式
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
                            <option value="auto">自动</option>
                            <option value="json_object">json_object</option>
                            <option value="prompt_only">Prompt 约束</option>
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
                            <option value="high">high</option>
                            <option value="auto">auto</option>
                            <option value="low">low</option>
                          </select>
                        </div>

                        <div>
                          <label className="block text-[11px] font-medium text-text-secondary mb-1">
                            超时 (秒)
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
                          Extra Body JSON
                        </label>
                        <textarea
                          rows={2}
                          value={selected.params.extraBodyJson}
                          onChange={(e) =>
                            updateProviderParams(selected.id, { extraBodyJson: e.target.value })
                          }
                          placeholder='{ "repetition_penalty": 1.05 }'
                          className="w-full rounded-xl border border-border-subtle bg-surface-subtle px-3 py-2 font-mono text-xs text-text-primary placeholder:text-text-muted focus:border-accent focus:outline-none"
                        />
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
