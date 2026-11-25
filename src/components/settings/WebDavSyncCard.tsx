import { useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeftRight,
  CheckCircle2,
  Cloud,
  CloudDownload,
  CloudUpload,
  Eye,
  EyeOff,
  FolderPlus,
  HelpCircle,
  KeyRound,
  Loader2,
  Lock,
  RefreshCw,
  Trash2,
  Unlock,
  X,
  Zap,
} from 'lucide-react';
import {
  useSettingsStore,
  type ApiKeyMergeMode,
} from '../../stores/useSettingsStore';
import { formatByteSize } from '../../lib/pipeline/image-prep';
import {
  decryptAndApplyVaultOnly,
  type RestorePaperMode,
} from '../../lib/sync/backup';
import {
  clearSessionVaultPassphrase,
  evaluatePassphraseStrength,
  getSessionVaultPassphrase,
  MIN_PASSPHRASE_LENGTH,
  setSessionVaultPassphrase,
  VaultCryptoError,
  type EncryptedApiKeysVault,
} from '../../lib/sync/crypto-vault';
import {
  backupToWebDav,
  deleteWebDavBackup,
  ensureRemoteDirectory,
  listWebDavBackups,
  previewWebDavPaths,
  restoreFromWebDav,
  smartSyncWithWebDav,
  testWebDavConnection,
  WEBDAV_LATEST_FILENAME,
  WebDavError,
  type RemoteBackupFile,
  type WebDavTestResult,
} from '../../lib/sync/webdav';

const PROVIDER_HINTS = [
  {
    name: 'Alist / OpenList',
    exampleUrl: 'https://your-alist.com/dav',
    tip: '后台或反代放行站点 Origin 即可直连。',
  },
  {
    name: 'Nextcloud / ownCloud',
    exampleUrl: 'https://cloud.example.com/remote.php/dav/files/用户名',
    tip: '建议生成应用专用密码，并在反代放行 CORS。',
  },
  {
    name: '群晖 NAS / 自建 Nginx',
    exampleUrl: 'https://nas.example.com:5006',
    tip: '需放行 PROPFIND/MKCOL/PUT/GET/DELETE/OPTIONS 及 Authorization/Depth 头。',
  },
  {
    name: '坚果云 (Jianguoyun)',
    exampleUrl: 'https://dav.jianguoyun.com/dav',
    tip: '使用第三方应用密码并设置子目录（如 /Studying-Mate）；浏览器直连需自建反代放行 CORS。',
  },
];

type BusyAction = 'test' | 'mkdir' | 'backup' | 'restore' | 'sync' | 'list' | 'unlock' | null;

export function WebDavSyncCard() {
  const { webdav, providers, updateWebDav } = useSettingsStore();

  const [showPassword, setShowPassword] = useState(false);
  const [showPassphrase, setShowPassphrase] = useState(false);
  const [showGuide, setShowGuide] = useState(false);
  const [includeSettings, setIncludeSettings] = useState(true);
  const [restoreMode, setRestoreMode] = useState<RestorePaperMode>('merge_newest');

  const [vaultPassphrase, setVaultPassphraseState] = useState<string>(() =>
    getSessionVaultPassphrase(),
  );
  const [pendingVault, setPendingVault] = useState<EncryptedApiKeysVault | null>(null);
  const [unlockPassphrase, setUnlockPassphrase] = useState<string>('');
  const [unlockError, setUnlockError] = useState<string | null>(null);

  const [busy, setBusy] = useState<BusyAction>(null);
  const [testResult, setTestResult] = useState<WebDavTestResult | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorInfo, setErrorInfo] = useState<{
    message: string;
    hintZh: string;
    status?: number;
    url?: string;
  } | null>(null);

  const [remoteFiles, setRemoteFiles] = useState<RemoteBackupFile[] | null>(null);
  const [showRemoteFiles, setShowRemoteFiles] = useState(false);

  const syncApiKeys = Boolean(webdav.syncApiKeys);
  const apiKeyMergeMode: ApiKeyMergeMode = webdav.apiKeyMergeMode || 'merge_newest';

  const localConfiguredKeyCount = useMemo(
    () => providers.filter((p) => Boolean(p.apiKey?.trim())).length,
    [providers],
  );

  const passStrength = useMemo(
    () => evaluatePassphraseStrength(vaultPassphrase),
    [vaultPassphrase],
  );

  const pathPreview = useMemo(
    () => previewWebDavPaths(webdav.serverUrl, webdav.remoteDir),
    [webdav.serverUrl, webdav.remoteDir],
  );

  const handlePassphraseChange = (val: string) => {
    setVaultPassphraseState(val);
    setSessionVaultPassphrase(val);
  };

  const handleClearPassphrase = () => {
    setVaultPassphraseState('');
    clearSessionVaultPassphrase();
  };

  const handleError = (err: unknown) => {
    if (err instanceof WebDavError) {
      setErrorInfo({
        message: err.message,
        hintZh: err.hintZh,
        status: err.status,
        url: err.url,
      });
    } else {
      setErrorInfo({
        message: err instanceof Error ? err.message : String(err),
        hintZh: '请检查 WebDAV 配置与网络连接。',
      });
    }
  };

  const clearFeedback = () => {
    setErrorInfo(null);
    setStatusMessage(null);
    setUnlockError(null);
  };

  const handleTestConnection = async () => {
    setBusy('test');
    clearFeedback();
    setTestResult(null);
    try {
      const res = await testWebDavConnection(webdav);
      setTestResult(res);
    } catch (err) {
      handleError(err);
    } finally {
      setBusy(null);
    }
  };

  const handleCreateDir = async () => {
    setBusy('mkdir');
    clearFeedback();
    try {
      const res = await ensureRemoteDirectory(webdav);
      const msg =
        res.createdDirs.length > 0
          ? `已创建目录：${res.createdDirs.join(' → ')}`
          : `目录 ${res.cleanDirPath} 已存在`;
      setStatusMessage(msg);
      setTestResult((prev) =>
        prev
          ? {
              ...prev,
              dirExists: true,
              message: `目录 ${res.cleanDirPath} 已就绪`,
            }
          : prev,
      );
    } catch (err) {
      handleError(err);
    } finally {
      setBusy(null);
    }
  };

  const handleBackup = async () => {
    setBusy('backup');
    clearFeedback();
    try {
      const res = await backupToWebDav(webdav, {
        includeSettings,
        vaultPassphrase: syncApiKeys ? vaultPassphrase : undefined,
      });
      const parts = [
        `备份完成（${res.paperCount} 套试卷 · ${res.vocabCount} 词 · ${formatByteSize(res.bytes)}）`,
      ];
      if (res.apiKeysSyncedCount > 0) parts.push(`已加密同步 ${res.apiKeysSyncedCount} 个 Key`);
      if (res.createdDirs.length > 0) parts.push(`自动新建目录 ${res.createdDirs.join(', ')}`);
      if (res.snapshotName) parts.push(`快照 ${res.snapshotName}`);

      const summary = parts.join('；');
      setStatusMessage(summary);
      updateWebDav({
        lastSyncAt: Date.now(),
        lastSyncAction: 'backup',
        lastSyncSummary: summary,
      });
      if (testResult && !testResult.dirExists) {
        setTestResult({ ...testResult, dirExists: true });
      }
      if (showRemoteFiles) {
        const list = await listWebDavBackups(webdav).catch(() => null);
        if (list) setRemoteFiles(list);
      }
    } catch (err) {
      handleError(err);
    } finally {
      setBusy(null);
    }
  };

  const handleRestore = async (filename = WEBDAV_LATEST_FILENAME) => {
    setBusy('restore');
    clearFeedback();
    setPendingVault(null);
    try {
      const res = await restoreFromWebDav(webdav, {
        filename,
        mode: restoreMode,
        restoreSettings: includeSettings,
        vaultPassphrase: vaultPassphrase || undefined,
        apiKeyMergeMode,
      });

      const parts = [
        `已恢复：新增 ${res.added} 套、更新 ${res.updated} 套${
          res.skippedOlder > 0 ? `、跳过较旧 ${res.skippedOlder} 套` : ''
        }`,
      ];
      if (res.settingsRestored) parts.push('已同步设置');

      if (res.apiKeysStatus === 'restored') {
        parts.push(`导入 ${res.apiKeysApplied} 个 Key`);
      } else if (res.apiKeysStatus === 'needs_passphrase' && res.pendingVault) {
        setPendingVault(res.pendingVault);
        setUnlockPassphrase(vaultPassphrase);
        parts.push('请在下方输入口令解密 API Key');
      } else if (res.apiKeysStatus === 'wrong_passphrase' && res.pendingVault) {
        setPendingVault(res.pendingVault);
        setUnlockPassphrase('');
        setUnlockError(res.apiKeysError || '口令错误，请重试');
      }

      const summary = parts.join('；');
      setStatusMessage(summary);
      updateWebDav({
        lastSyncAt: Date.now(),
        lastSyncAction: 'restore',
        lastSyncSummary: summary,
      });
    } catch (err) {
      handleError(err);
    } finally {
      setBusy(null);
    }
  };

  const handleUnlockPendingVault = async () => {
    if (!pendingVault) return;
    setBusy('unlock');
    setUnlockError(null);
    try {
      const res = await decryptAndApplyVaultOnly(
        pendingVault,
        unlockPassphrase,
        apiKeyMergeMode,
      );
      handlePassphraseChange(unlockPassphrase);
      setPendingVault(null);
      setStatusMessage(`解密成功，已导入 ${res.applied} 个 API Key`);
    } catch (err) {
      setUnlockError(
        err instanceof VaultCryptoError || err instanceof Error ? err.message : String(err),
      );
    } finally {
      setBusy(null);
    }
  };

  const handleSmartSync = async () => {
    setBusy('sync');
    clearFeedback();
    setPendingVault(null);
    try {
      const res = await smartSyncWithWebDav(webdav, {
        syncSettings: includeSettings,
        vaultPassphrase: syncApiKeys ? vaultPassphrase : undefined,
        apiKeyMergeMode,
      });
      const parts: string[] = [];
      if (res.direction === 'initial_push') {
        parts.push(`首次推送完成（${res.pushedPapers} 套试卷 · ${formatByteSize(res.pushedBytes)}）`);
      } else {
        parts.push(
          `同步完成：拉取 +${res.pulled?.added ?? 0}/更新 ${res.pulled?.updated ?? 0}，推送 ${res.pushedPapers} 套`,
        );
      }
      if (res.apiKeysSyncedCount > 0) {
        parts.push(`同步 ${res.apiKeysSyncedCount} 个加密 Key`);
      }

      const summary = parts.join('；');
      setStatusMessage(summary);
      updateWebDav({
        lastSyncAt: Date.now(),
        lastSyncAction: 'sync',
        lastSyncSummary: summary,
      });
      if (showRemoteFiles) {
        const list = await listWebDavBackups(webdav).catch(() => null);
        if (list) setRemoteFiles(list);
      }
    } catch (err) {
      handleError(err);
    } finally {
      setBusy(null);
    }
  };

  const handleListFiles = async () => {
    setBusy('list');
    clearFeedback();
    try {
      const files = await listWebDavBackups(webdav);
      setRemoteFiles(files);
      setShowRemoteFiles(true);
      if (files.length === 0) {
        setStatusMessage(`目录 ${pathPreview.cleanDirPath} 下暂无备份文件`);
      }
    } catch (err) {
      handleError(err);
    } finally {
      setBusy(null);
    }
  };

  const handleDeleteRemoteFile = async (filename: string) => {
    setBusy('list');
    clearFeedback();
    try {
      await deleteWebDavBackup(webdav, filename);
      setRemoteFiles((prev) => (prev ? prev.filter((f) => f.name !== filename) : prev));
      setStatusMessage(`已删除：${filename}`);
    } catch (err) {
      handleError(err);
    } finally {
      setBusy(null);
    }
  };

  const disabled = busy !== null || !webdav.serverUrl.trim();

  return (
    <div className="island p-5 sm:p-6 space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border-subtle pb-3.5">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent">
            <Cloud className="h-4 w-4" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-base font-semibold text-text-primary">WebDAV 云端同步</h2>
              {syncApiKeys && (
                <span className="inline-flex items-center gap-1 rounded-full bg-answer-soft px-2 py-0.5 text-[10.5px] font-semibold text-answer">
                  <Lock className="h-2.5 w-2.5" />
                  Key 加密同步
                </span>
              )}
            </div>
            <p className="text-xs text-text-muted">备份试卷、生词本与偏好设置，缺失目录自动创建</p>
          </div>
        </div>

        <button
          type="button"
          onClick={() => setShowGuide((v) => !v)}
          className="inline-flex items-center gap-1 rounded-lg border border-border-subtle bg-surface-subtle px-2.5 py-1.5 text-xs font-medium text-text-secondary hover:border-accent hover:text-accent"
        >
          <HelpCircle className="h-3.5 w-3.5" />
          {showGuide ? '收起说明' : '常见网盘说明'}
        </button>
      </div>

      {/* Collapsible Setup Guide */}
      {showGuide && (
        <div className="rounded-xl border border-accent/25 bg-accent-soft/20 p-3 space-y-2 text-xs">
          <div className="grid gap-2 sm:grid-cols-2">
            {PROVIDER_HINTS.map((p) => (
              <div
                key={p.name}
                className="rounded-lg border border-border-subtle bg-surface p-2.5 space-y-1"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold text-text-primary">{p.name}</span>
                  <button
                    type="button"
                    onClick={() => updateWebDav({ serverUrl: p.exampleUrl })}
                    className="text-[11px] font-medium text-accent hover:underline"
                  >
                    填入示例
                  </button>
                </div>
                <div className="font-mono text-[11px] text-text-muted break-all">{p.exampleUrl}</div>
                <p className="text-[11px] text-text-secondary">{p.tip}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Configuration Grid */}
      <div className="grid gap-3.5 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label className="block text-xs font-medium text-text-secondary mb-1">
            服务器地址
          </label>
          <input
            type="url"
            value={webdav.serverUrl}
            onChange={(e) => {
              updateWebDav({ serverUrl: e.target.value });
              setTestResult(null);
            }}
            placeholder="https://your-alist.com/dav"
            className="w-full rounded-xl border border-border-subtle bg-surface-subtle px-3 py-2 font-mono text-xs text-text-primary placeholder:text-text-muted focus:border-accent focus:outline-none"
          />
        </div>

        <div>
          <label className="block text-xs font-medium text-text-secondary mb-1">用户名</label>
          <input
            type="text"
            value={webdav.username}
            onChange={(e) => updateWebDav({ username: e.target.value })}
            placeholder="WebDAV 账号"
            autoComplete="off"
            className="w-full rounded-xl border border-border-subtle bg-surface-subtle px-3 py-2 text-xs text-text-primary focus:border-accent focus:outline-none"
          />
        </div>

        <div>
          <label className="block text-xs font-medium text-text-secondary mb-1">
            密码 / 应用专用密码
          </label>
          <div className="relative">
            <input
              type={showPassword ? 'text' : 'password'}
              value={webdav.password}
              onChange={(e) => updateWebDav({ password: e.target.value })}
              placeholder="仅存本机"
              autoComplete="off"
              className="w-full rounded-xl border border-border-subtle bg-surface-subtle py-2 pl-3 pr-9 font-mono text-xs text-text-primary focus:border-accent focus:outline-none"
            />
            <button
              type="button"
              onClick={() => setShowPassword((v) => !v)}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-primary"
              aria-label="显示或隐藏密码"
            >
              {showPassword ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
            </button>
          </div>
        </div>

        <div>
          <label className="block text-xs font-medium text-text-secondary mb-1">备份目录</label>
          <input
            type="text"
            value={webdav.remoteDir}
            onChange={(e) => {
              updateWebDav({ remoteDir: e.target.value });
              setTestResult(null);
            }}
            placeholder="/Studying-Mate"
            className="w-full rounded-xl border border-border-subtle bg-surface-subtle px-3 py-2 font-mono text-xs text-text-primary focus:border-accent focus:outline-none"
          />
        </div>

        <div>
          <label className="block text-xs font-medium text-text-secondary mb-1">
            历史快照保留
          </label>
          <select
            value={webdav.keepSnapshots ?? 5}
            onChange={(e) => updateWebDav({ keepSnapshots: Number(e.target.value) })}
            className="w-full rounded-xl border border-border-subtle bg-surface-subtle px-3 py-2 text-xs text-text-primary focus:border-accent focus:outline-none"
          >
            <option value={0}>不保留历史快照（仅主备份）</option>
            <option value={3}>保留最近 3 份</option>
            <option value={5}>保留最近 5 份（推荐）</option>
            <option value={10}>保留最近 10 份</option>
          </select>
        </div>
      </div>

      {/* Compact Path Preview */}
      {pathPreview.valid && (
        <div className="rounded-xl border border-border-subtle bg-surface-subtle/50 px-3 py-2 text-[11px] text-text-muted break-all">
          目标路径：<code className="font-mono text-text-secondary">{pathPreview.latestFileUrl}</code>
        </div>
      )}

      {/* Sync Options */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border-subtle bg-surface-subtle/40 px-3.5 py-2.5 text-xs">
        <label className="inline-flex items-center gap-2 text-text-primary cursor-pointer">
          <input
            type="checkbox"
            checked={includeSettings}
            onChange={(e) => setIncludeSettings(e.target.checked)}
            className="accent-accent"
          />
          <span>同步应用与模型设置</span>
        </label>

        <div className="flex items-center gap-1.5">
          <span className="text-[11px] text-text-muted">恢复策略：</span>
          <select
            value={restoreMode}
            onChange={(e) => setRestoreMode(e.target.value as RestorePaperMode)}
            className="rounded-lg border border-border-subtle bg-surface px-2 py-1 text-[11px] text-text-primary focus:border-accent focus:outline-none"
          >
            <option value="merge_newest">合并最新（推荐）</option>
            <option value="overwrite_matching">云端覆盖本地</option>
          </select>
        </div>
      </div>

      {/* Optional E2EE API Keys Vault Panel */}
      <div
        className={`rounded-xl border p-3.5 space-y-3 transition ${
          syncApiKeys
            ? 'border-answer/35 bg-answer-soft/20'
            : 'border-border-subtle bg-surface-subtle/45'
        }`}
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <label className="inline-flex items-center gap-2 text-xs font-semibold text-text-primary cursor-pointer">
            <input
              type="checkbox"
              checked={syncApiKeys}
              onChange={(e) => updateWebDav({ syncApiKeys: e.target.checked })}
              className="accent-answer"
            />
            <KeyRound className="h-3.5 w-3.5 text-answer" />
            <span>加密同步 API Key</span>
          </label>
          <span className="text-[11px] text-text-muted">
            本机 {localConfiguredKeyCount} 个 Key · 仅主备份携带
          </span>
        </div>

        {syncApiKeys ? (
          <div className="space-y-2.5">
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-[11.5px] font-medium text-text-secondary">
                    同步加密口令（≥ {MIN_PASSPHRASE_LENGTH} 位）
                  </label>
                  {vaultPassphrase && (
                    <button
                      type="button"
                      onClick={handleClearPassphrase}
                      className="text-[11px] text-text-muted hover:text-danger"
                    >
                      清除
                    </button>
                  )}
                </div>
                <div className="relative">
                  <input
                    type={showPassphrase ? 'text' : 'password'}
                    value={vaultPassphrase}
                    onChange={(e) => handlePassphraseChange(e.target.value)}
                    placeholder="独立加密口令（切勿用 WebDAV 密码）"
                    autoComplete="off"
                    className="w-full rounded-xl border border-border-subtle bg-surface py-2 pl-3 pr-9 font-mono text-xs text-text-primary focus:border-accent focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassphrase((v) => !v)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-primary"
                    aria-label="显示或隐藏同步口令"
                  >
                    {showPassphrase ? (
                      <EyeOff className="h-3.5 w-3.5" />
                    ) : (
                      <Eye className="h-3.5 w-3.5" />
                    )}
                  </button>
                </div>
                <div className="mt-1 text-[11px]">
                  <span
                    className={
                      passStrength.level === 'strong' || passStrength.level === 'good'
                        ? 'text-answer font-medium'
                        : passStrength.level === 'weak'
                          ? 'text-danger'
                          : 'text-text-muted'
                    }
                  >
                    强度：{passStrength.label}
                  </span>
                </div>
              </div>

              <div>
                <label className="block text-[11.5px] font-medium text-text-secondary mb-1">
                  Key 冲突策略
                </label>
                <select
                  value={apiKeyMergeMode}
                  onChange={(e) =>
                    updateWebDav({ apiKeyMergeMode: e.target.value as ApiKeyMergeMode })
                  }
                  className="w-full rounded-xl border border-border-subtle bg-surface px-3 py-2 text-xs text-text-primary focus:border-accent focus:outline-none"
                >
                  <option value="merge_newest">按最新时间合并</option>
                  <option value="fill_missing">仅补全本机缺失</option>
                  <option value="overwrite_remote">云端覆盖本机</option>
                </select>
              </div>
            </div>

            <p className="text-[11px] text-text-muted">
              口令仅暂存当前标签页（关闭后清除，不上传云端）；忘记口令仍可正常恢复试卷与普通设置。
            </p>
          </div>
        ) : (
          <p className="text-[11px] text-text-muted">
            未开启时，备份自动剔除 API Key 与密码。
          </p>
        )}
      </div>

      {/* Action Buttons */}
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={disabled}
          onClick={handleTestConnection}
          className="inline-flex items-center gap-1.5 rounded-xl border border-border-subtle bg-surface-subtle px-3.5 py-2 text-xs font-semibold text-text-primary hover:border-accent hover:text-accent disabled:opacity-45"
        >
          {busy === 'test' ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Zap className="h-3.5 w-3.5 text-accent" />
          )}
          测试连通性
        </button>

        <button
          type="button"
          disabled={disabled}
          onClick={handleBackup}
          className="inline-flex items-center gap-1.5 rounded-xl bg-accent px-3.5 py-2 text-xs font-semibold text-white shadow-xs transition hover:opacity-92 disabled:opacity-45"
        >
          {busy === 'backup' ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <CloudUpload className="h-3.5 w-3.5" />
          )}
          备份到云端
        </button>

        <button
          type="button"
          disabled={disabled}
          onClick={handleSmartSync}
          className="inline-flex items-center gap-1.5 rounded-xl border border-accent/35 bg-accent-soft/70 px-3.5 py-2 text-xs font-semibold text-accent hover:bg-accent hover:text-white transition disabled:opacity-45"
        >
          {busy === 'sync' ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <ArrowLeftRight className="h-3.5 w-3.5" />
          )}
          双向同步
        </button>

        <button
          type="button"
          disabled={disabled}
          onClick={() => handleRestore(WEBDAV_LATEST_FILENAME)}
          className="inline-flex items-center gap-1.5 rounded-xl border border-border-subtle bg-surface-subtle px-3.5 py-2 text-xs font-medium text-text-primary hover:border-border-strong disabled:opacity-45"
        >
          {busy === 'restore' ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <CloudDownload className="h-3.5 w-3.5" />
          )}
          恢复最新
        </button>

        <button
          type="button"
          disabled={disabled}
          onClick={handleListFiles}
          className="inline-flex items-center gap-1.5 rounded-xl border border-border-subtle bg-surface px-3 py-2 text-xs font-medium text-text-secondary hover:border-border-strong hover:text-text-primary disabled:opacity-45 ml-auto"
        >
          {busy === 'list' ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <RefreshCw className="h-3.5 w-3.5" />
          )}
          历史快照
        </button>
      </div>

      {/* Inline Unlock Card */}
      {pendingVault && (
        <div className="rounded-xl border border-vocab/40 bg-vocab-soft/35 p-3.5 space-y-2.5 text-xs">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 font-semibold text-text-primary">
              <Unlock className="h-4 w-4 text-vocab shrink-0" />
              <span>解密云端 API Key（{pendingVault.keyCount} 个）</span>
            </div>
            <button
              type="button"
              onClick={() => {
                setPendingVault(null);
                setUnlockError(null);
              }}
              className="rounded-lg p-1 text-text-muted hover:text-text-primary"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <input
              type="password"
              value={unlockPassphrase}
              onChange={(e) => setUnlockPassphrase(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && unlockPassphrase.trim()) {
                  handleUnlockPendingVault();
                }
              }}
              placeholder="输入同步加密口令"
              autoComplete="off"
              className="flex-1 min-w-[180px] rounded-xl border border-border-subtle bg-surface px-3 py-1.5 font-mono text-xs text-text-primary focus:border-accent focus:outline-none"
            />
            <button
              type="button"
              disabled={busy !== null || !unlockPassphrase.trim()}
              onClick={handleUnlockPendingVault}
              className="inline-flex items-center gap-1.5 rounded-xl bg-vocab px-3.5 py-1.5 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-45"
            >
              {busy === 'unlock' ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <KeyRound className="h-3.5 w-3.5" />
              )}
              解密导入
            </button>
            <button
              type="button"
              onClick={() => {
                setPendingVault(null);
                setUnlockError(null);
              }}
              className="rounded-xl border border-border-subtle bg-surface px-3 py-1.5 text-xs text-text-secondary hover:text-text-primary"
            >
              跳过
            </button>
          </div>

          {unlockError && (
            <div className="text-xs font-medium text-danger">{unlockError}</div>
          )}
        </div>
      )}

      {/* Connectivity Test Result Banner */}
      {testResult && (
        <div
          className={`rounded-xl border px-3.5 py-2.5 text-xs flex flex-wrap items-center justify-between gap-2 ${
            testResult.dirExists
              ? 'border-answer/30 bg-answer-soft/45 text-text-primary'
              : 'border-vocab/35 bg-vocab-soft/45 text-text-primary'
          }`}
        >
          <div className="flex items-start gap-2">
            {testResult.dirExists ? (
              <CheckCircle2 className="h-4 w-4 text-answer shrink-0 mt-0.5" />
            ) : (
              <AlertTriangle className="h-4 w-4 text-vocab shrink-0 mt-0.5" />
            )}
            <div>
              <div className="font-medium">{testResult.message}</div>
              <div className="font-mono text-[11px] text-text-muted">
                {testResult.durationMs}ms · {testResult.normalizedDirPath}
              </div>
            </div>
          </div>

          {!testResult.dirExists && (
            <button
              type="button"
              disabled={busy !== null}
              onClick={handleCreateDir}
              className="inline-flex items-center gap-1 rounded-lg bg-vocab px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-50"
            >
              {busy === 'mkdir' ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <FolderPlus className="h-3.5 w-3.5" />
              )}
              立即创建目录
            </button>
          )}
        </div>
      )}

      {/* Operation Status Message */}
      {statusMessage && (
        <div className="rounded-xl border border-answer/30 bg-answer-soft/40 px-3.5 py-2.5 text-xs text-text-primary flex items-start gap-2">
          <CheckCircle2 className="h-4 w-4 text-answer shrink-0 mt-0.5" />
          <span>{statusMessage}</span>
        </div>
      )}

      {/* Error Card */}
      {errorInfo && (
        <div className="rounded-xl border border-danger/30 bg-danger-soft/40 p-3 text-xs space-y-1">
          <div className="flex items-center gap-2 font-semibold text-danger">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            <span>{errorInfo.message}</span>
          </div>
          <p className="text-text-primary">{errorInfo.hintZh}</p>
        </div>
      )}

      {/* Remote Snapshot List */}
      {showRemoteFiles && remoteFiles && (
        <div className="rounded-xl border border-border-subtle bg-surface-subtle/50 p-3 space-y-2">
          <div className="flex items-center justify-between text-xs">
            <span className="font-semibold text-text-primary">
              云端文件（{remoteFiles.length}）
            </span>
            <button
              type="button"
              onClick={() => setShowRemoteFiles(false)}
              className="text-text-muted hover:text-text-primary"
            >
              收起
            </button>
          </div>

          {remoteFiles.length === 0 ? (
            <p className="text-xs text-text-muted py-1.5">暂无备份文件。</p>
          ) : (
            <div className="space-y-1.5 max-h-56 overflow-y-auto">
              {remoteFiles.map((file) => (
                <div
                  key={file.name}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border-subtle bg-surface px-3 py-2 text-xs"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="truncate font-mono font-medium text-text-primary">
                        {file.name}
                      </span>
                      {file.isLatest && (
                        <span className="rounded bg-accent-soft px-1.5 py-0.2 text-[10px] font-semibold text-accent">
                          主备份
                        </span>
                      )}
                    </div>
                    <div className="text-[11px] text-text-muted">
                      {file.size != null ? formatByteSize(file.size) : ''}
                      {file.lastModifiedMs
                        ? ` · ${new Date(file.lastModifiedMs).toLocaleString()}`
                        : ''}
                    </div>
                  </div>

                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      disabled={busy !== null}
                      onClick={() => handleRestore(file.name)}
                      className="rounded-lg border border-accent/30 bg-accent-soft/60 px-2.5 py-1 text-[11px] font-medium text-accent hover:bg-accent hover:text-white transition disabled:opacity-45"
                    >
                      恢复
                    </button>
                    {!file.isLatest && (
                      <button
                        type="button"
                        disabled={busy !== null}
                        onClick={() => handleDeleteRemoteFile(file.name)}
                        className="rounded-lg border border-border-subtle p-1 text-text-muted hover:border-danger/40 hover:bg-danger-soft hover:text-danger disabled:opacity-45"
                        title="删除快照"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Last Sync Metadata */}
      {webdav.lastSyncAt && (
        <div className="text-[11px] text-text-muted border-t border-border-subtle pt-2.5 flex flex-wrap items-center justify-between gap-2">
          <span>上次同步：{new Date(webdav.lastSyncAt).toLocaleString()}</span>
          {webdav.lastSyncSummary && (
            <span className="truncate max-w-md" title={webdav.lastSyncSummary}>
              {webdav.lastSyncSummary}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
