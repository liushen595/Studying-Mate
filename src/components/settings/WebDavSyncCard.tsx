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
  ShieldCheck,
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
    tip: '原生支持自定义 CORS，在后台或反向代理放行本站点 Origin 即可直连。',
  },
  {
    name: 'Nextcloud / ownCloud',
    exampleUrl: 'https://cloud.example.com/remote.php/dav/files/你的用户名',
    tip: '建议使用「安全 → 设备与会话」生成应用专用密码；需在 Nginx/Apache 放行 CORS。',
  },
  {
    name: '群晖 NAS / 自建 Nginx',
    exampleUrl: 'https://nas.example.com:5006',
    tip: '反代配置放行 Origin 及 PROPFIND/MKCOL/PUT/GET/DELETE/OPTIONS 方法与 Authorization/Depth 请求头。',
  },
  {
    name: '坚果云 (Jianguoyun)',
    exampleUrl: 'https://dav.jianguoyun.com/dav',
    tip: '须使用「安全选项 → 第三方应用管理」专用密码，且必须填子目录（如 /Studying-Mate）；注：坚果云官方默认不放行浏览器 CORS，纯前端需经由你自己的反代/CF Worker 地址接入。',
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

  // Session-only sync passphrase (stored ONLY in sessionStorage; cleared when browser tab closes)
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
        hintZh: '请检查 WebDAV 配置项与网络连接后重试。',
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
          ? `已成功逐级创建目录：${res.createdDirs.join(' → ')}`
          : `目标目录 ${res.cleanDirPath} 已存在，无需重复创建。`;
      setStatusMessage(msg);
      setTestResult((prev) =>
        prev
          ? {
              ...prev,
              dirExists: true,
              message: `目录 ${res.cleanDirPath} 已创建就绪，可直接备份。`,
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
        `备份成功（${res.paperCount} 套试卷 · ${res.vocabCount} 词 · ${formatByteSize(res.bytes)} · ${res.durationMs}ms）`,
      ];
      if (includeSettings) parts.push('含应用设置与模型参数');
      if (res.apiKeysSyncedCount > 0) {
        parts.push(`主备份已端到端加密同步 ${res.apiKeysSyncedCount} 个 API Key`);
      } else if (syncApiKeys) {
        parts.push('本机暂无非空 API Key 可加密');
      }
      if (res.createdDirs.length > 0) parts.push(`已自动创建目录 ${res.createdDirs.join(', ')}`);
      if (res.snapshotName) parts.push(`历史快照 ${res.snapshotName}（不含 Key）`);
      if (res.prunedSnapshots > 0) parts.push(`已清理 ${res.prunedSnapshots} 份旧快照`);

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
        `已从 ${res.filename} 恢复：新增 ${res.added} 套、更新 ${res.updated} 套${
          res.skippedOlder > 0 ? `、保留本地较新 ${res.skippedOlder} 套` : ''
        }`,
      ];
      if (res.settingsRestored) parts.push('已同步非敏感应用设置');

      if (res.apiKeysStatus === 'restored') {
        parts.push(
          `已解密导入 ${res.apiKeysApplied} 个 API Key${
            res.apiKeysSkippedLocal > 0 ? `（保留本地 ${res.apiKeysSkippedLocal} 个）` : ''
          }`,
        );
      } else if (res.apiKeysStatus === 'needs_passphrase' && res.pendingVault) {
        setPendingVault(res.pendingVault);
        setUnlockPassphrase(vaultPassphrase);
        parts.push('检测到云端加密 API Key 保险库，请在下方输入同步主口令解密');
      } else if (res.apiKeysStatus === 'wrong_passphrase' && res.pendingVault) {
        setPendingVault(res.pendingVault);
        setUnlockPassphrase('');
        setUnlockError(res.apiKeysError || '同步主口令错误，请重试');
        parts.push('API Key 保险库解密未通过（已保留本机 Key，试卷与基础设置不受影响）');
      }

      const summary = `${parts.join('；')}（${res.durationMs}ms）`;
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
      // Remember valid passphrase in sessionStorage for the rest of this tab session
      handlePassphraseChange(unlockPassphrase);
      setPendingVault(null);
      setStatusMessage(
        `API Key 保险库解密成功：共 ${res.totalInVault} 个，已导入 ${res.applied} 个${
          res.skippedLocal > 0 ? `（保留本地已有/较新 ${res.skippedLocal} 个）` : ''
        }！`,
      );
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
        parts.push(
          `云端尚无历史备份，已完成首次推送（${res.pushedPapers} 套试卷 · ${formatByteSize(res.pushedBytes)}）`,
        );
      } else {
        parts.push(
          `双向同步完成：拉取新增 ${res.pulled?.added ?? 0} 套、更新 ${res.pulled?.updated ?? 0} 套，并将合并后的 ${res.pushedPapers} 套试卷推送至云端（${formatByteSize(res.pushedBytes)}）`,
        );
      }
      if (res.apiKeysSyncedCount > 0) {
        parts.push(
          `已端到端加密同步 ${res.apiKeysSyncedCount} 个 API Key${
            res.pulled?.apiKeysApplied ? `（含云端新导入 ${res.pulled.apiKeysApplied} 个）` : ''
          }`,
        );
      } else if (res.preservedRemoteVault) {
        parts.push('已原样保留云端既有加密 API Key 保险库');
      }

      const summary = `${parts.join('；')}（${res.durationMs}ms）`;
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
        setStatusMessage(`目标目录 ${pathPreview.cleanDirPath} 中暂未发现 .json 备份文件。`);
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
      setStatusMessage(`已删除云端备份文件：${filename}`);
    } catch (err) {
      handleError(err);
    } finally {
      setBusy(null);
    }
  };

  const disabled = busy !== null || !webdav.serverUrl.trim();

  return (
    <div className="island p-5 space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border-subtle pb-3.5">
        <div className="flex items-start gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent">
            <Cloud className="h-4.5 w-4.5" />
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-sm font-semibold text-text-primary">WebDAV 云端备份与跨端同步</h3>
              <span className="rounded-full bg-surface-subtle border border-border-subtle px-2 py-0.5 text-[10.5px] font-medium text-text-secondary">
                试卷 + 生词本 + 设置同步
              </span>
              {syncApiKeys && (
                <span className="inline-flex items-center gap-1 rounded-full bg-answer-soft px-2 py-0.5 text-[10.5px] font-semibold text-answer">
                  <Lock className="h-2.5 w-2.5" />
                  E2EE 密钥保险库已开启
                </span>
              )}
            </div>
            <p className="mt-0.5 text-xs text-text-secondary">
              自动规范化路径与递归创建缺失目录（MKCOL），支持连通性检测、历史快照轮转与按时间戳双向合并。
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={() => setShowGuide((v) => !v)}
          className="inline-flex items-center gap-1 rounded-lg border border-border-subtle bg-surface-subtle px-2.5 py-1.5 text-xs font-medium text-text-secondary hover:border-accent hover:text-accent"
        >
          <HelpCircle className="h-3.5 w-3.5" />
          {showGuide ? '收起配置指南' : '常见网盘地址与 CORS 指南'}
        </button>
      </div>

      {/* Collapsible Setup Guide */}
      {showGuide && (
        <div className="rounded-xl border border-accent/25 bg-accent-soft/20 p-3.5 space-y-2.5 text-xs">
          <div className="font-semibold text-text-primary">常见 WebDAV 服务端配置说明</div>
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
                    填入示例格式
                  </button>
                </div>
                <div className="font-mono text-[11px] text-text-muted break-all">{p.exampleUrl}</div>
                <p className="text-[11px] leading-relaxed text-text-secondary">{p.tip}</p>
              </div>
            ))}
          </div>
          <p className="text-[11px] leading-relaxed text-text-secondary">
            <strong>纯前端直连 CORS 提示：</strong>浏览器直连 WebDAV 时，目标服务端需放行当前站点 Origin，并在{' '}
            <code className="font-mono">Access-Control-Allow-Methods</code> 中包含{' '}
            <code className="font-mono">OPTIONS, PROPFIND, MKCOL, GET, PUT, DELETE</code>，在{' '}
            <code className="font-mono">Access-Control-Allow-Headers</code> 中包含{' '}
            <code className="font-mono">Authorization, Content-Type, Depth</code>。
          </p>
        </div>
      )}

      {/* Configuration Grid */}
      <div className="grid gap-3.5 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label className="block text-xs font-medium text-text-secondary mb-1">
            WebDAV 服务器地址（Server URL）
          </label>
          <input
            type="url"
            value={webdav.serverUrl}
            onChange={(e) => {
              updateWebDav({ serverUrl: e.target.value });
              setTestResult(null);
            }}
            placeholder="例如：https://your-alist.com/dav 或 https://cloud.example.com/remote.php/dav/files/user"
            className="w-full rounded-xl border border-border-subtle bg-surface-subtle px-3 py-2 font-mono text-xs text-text-primary placeholder:text-text-muted focus:border-accent focus:outline-none"
          />
        </div>

        <div>
          <label className="block text-xs font-medium text-text-secondary mb-1">
            用户名（Username）
          </label>
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
            密码 / 应用专用密码（仅存本机）
          </label>
          <div className="relative">
            <input
              type={showPassword ? 'text' : 'password'}
              value={webdav.password}
              onChange={(e) => updateWebDav({ password: e.target.value })}
              placeholder="推荐使用应用专用密码"
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
          <label className="block text-xs font-medium text-text-secondary mb-1">
            远程备份目录（不存在时将自动递归创建）
          </label>
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
            历史快照保留份数（历史快照不含 API Key）
          </label>
          <select
            value={webdav.keepSnapshots ?? 5}
            onChange={(e) => updateWebDav({ keepSnapshots: Number(e.target.value) })}
            className="w-full rounded-xl border border-border-subtle bg-surface-subtle px-3 py-2 text-xs text-text-primary focus:border-accent focus:outline-none"
          >
            <option value={0}>仅更新主文件 studying-mate-latest.json（不存历史快照）</option>
            <option value={3}>保留最近 3 份时间戳快照 + 主文件</option>
            <option value={5}>保留最近 5 份时间戳快照 + 主文件（推荐）</option>
            <option value={10}>保留最近 10 份时间戳快照 + 主文件</option>
          </select>
        </div>
      </div>

      {/* Live Normalized Path Preview */}
      <div className="rounded-xl border border-border-subtle bg-surface-subtle/60 px-3.5 py-2.5 text-[11.5px] space-y-1">
        <div className="flex flex-wrap items-center gap-1.5 text-text-secondary">
          <span className="font-medium text-text-primary">规范化目标目录：</span>
          <code className="rounded bg-surface px-1.5 py-0.5 font-mono text-accent">
            {pathPreview.cleanDirPath}
          </code>
        </div>
        {pathPreview.valid ? (
          <div className="text-text-muted break-all">
            主备份目标 URL：
            <code className="ml-1 font-mono text-text-secondary">{pathPreview.latestFileUrl}</code>
          </div>
        ) : (
          <div className="text-text-muted">填写有效的 http:// 或 https:// 服务器地址后将实时预览完整路径。</div>
        )}
      </div>

      {/* Sync Options */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border-subtle bg-surface-subtle/40 px-3.5 py-2.5 text-xs">
        <label className="inline-flex items-center gap-2 text-text-primary cursor-pointer">
          <input
            type="checkbox"
            checked={includeSettings}
            onChange={(e) => setIncludeSettings(e.target.checked)}
            className="accent-accent"
          />
          <span>同时同步应用设置与模型参数（主题/排版/模型路由/生词策略）</span>
        </label>

        <div className="flex items-center gap-1.5">
          <span className="text-[11px] text-text-muted">试卷恢复策略：</span>
          <select
            value={restoreMode}
            onChange={(e) => setRestoreMode(e.target.value as RestorePaperMode)}
            className="rounded-lg border border-border-subtle bg-surface px-2 py-1 text-[11px] text-text-primary focus:border-accent focus:outline-none"
          >
            <option value="merge_newest">智能合并（按最新时间保留，推荐）</option>
            <option value="overwrite_matching">云端覆盖本地同名试卷</option>
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
            <span>启用 API Key 端到端加密同步（仅主备份 latest.json 携带）</span>
          </label>
          <span className="text-[11px] text-text-muted">
            本机已配置 {localConfiguredKeyCount} 个非空 API Key
          </span>
        </div>

        {syncApiKeys ? (
          <div className="space-y-3 pt-0.5">
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-[11.5px] font-medium text-text-secondary">
                    独立同步主口令（≥ {MIN_PASSPHRASE_LENGTH} 位，切勿复用 WebDAV 密码）
                  </label>
                  {vaultPassphrase && (
                    <button
                      type="button"
                      onClick={handleClearPassphrase}
                      className="text-[11px] text-text-muted hover:text-danger"
                    >
                      清除会话口令
                    </button>
                  )}
                </div>
                <div className="relative">
                  <input
                    type={showPassphrase ? 'text' : 'password'}
                    value={vaultPassphrase}
                    onChange={(e) => handlePassphraseChange(e.target.value)}
                    placeholder="输入独立同步主口令（仅暂存当前标签页）"
                    autoComplete="off"
                    className="w-full rounded-xl border border-border-subtle bg-surface py-2 pl-3 pr-9 font-mono text-xs text-text-primary focus:border-accent focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassphrase((v) => !v)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-primary"
                    aria-label="显示或隐藏同步主口令"
                  >
                    {showPassphrase ? (
                      <EyeOff className="h-3.5 w-3.5" />
                    ) : (
                      <Eye className="h-3.5 w-3.5" />
                    )}
                  </button>
                </div>
                <div className="mt-1 flex items-center justify-between text-[11px]">
                  <span
                    className={
                      passStrength.level === 'strong' || passStrength.level === 'good'
                        ? 'text-answer font-medium'
                        : passStrength.level === 'weak'
                          ? 'text-danger'
                          : 'text-text-muted'
                    }
                  >
                    口令强度：{passStrength.label}
                  </span>
                  <span className="text-text-muted">仅存 sessionStorage</span>
                </div>
              </div>

              <div>
                <label className="block text-[11.5px] font-medium text-text-secondary mb-1">
                  多端 API Key 冲突合并策略
                </label>
                <select
                  value={apiKeyMergeMode}
                  onChange={(e) =>
                    updateWebDav({ apiKeyMergeMode: e.target.value as ApiKeyMergeMode })
                  }
                  className="w-full rounded-xl border border-border-subtle bg-surface px-3 py-2 text-xs text-text-primary focus:border-accent focus:outline-none"
                >
                  <option value="merge_newest">按更新时间合并最新（推荐，不覆空）</option>
                  <option value="fill_missing">仅补全本机缺失的 Key（保留本机已有）</option>
                  <option value="overwrite_remote">云端非空 Key 覆盖本机已有 Key</option>
                </select>
                <p className="mt-1 text-[11px] text-text-muted">
                  如需修改同步口令：直接输入新口令后点击「备份到云端」即可重新生成随机盐值覆盖主备份。
                </p>
              </div>
            </div>

            <div className="flex items-start gap-2 rounded-lg bg-surface/80 border border-border-subtle px-3 py-2 text-[11px] leading-relaxed text-text-secondary">
              <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-answer mt-0.5" />
              <span>
                采用浏览器原生 <strong>PBKDF2-HMAC-SHA256（600,000 次迭代）+ AES-256-GCM（含 AAD 认证）</strong>
                端到端加密；每次加密均生成全新随机 Salt 与 IV。口令仅暂存当前标签页{' '}
                <code className="font-mono">sessionStorage</code>（关闭标签页自动清除，绝不写入{' '}
                <code className="font-mono">localStorage</code> 或上传云端）。历史快照不含密钥保险库；即使忘记口令，试卷与普通设置仍可完整恢复。
              </span>
            </div>
          </div>
        ) : (
          <p className="text-[11.5px] leading-relaxed text-text-secondary">
            当前未开启：云端备份将自动剔除全部 LLM API Key 与 WebDAV 密码（恢复设置时自动保留本机已填 API Key）。开启后可使用独立同步口令对 API Key 进行客户端端到端加密，并仅随主备份{' '}
            <code className="font-mono">{WEBDAV_LATEST_FILENAME}</code> 同步。
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
          title="拉取云端较新试卷并合并到本地，再将合并结果推回云端"
        >
          {busy === 'sync' ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <ArrowLeftRight className="h-3.5 w-3.5" />
          )}
          双向智能同步
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
          恢复最新备份
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
          云端历史快照
        </button>
      </div>

      {/* Inline Unlock Card when Cloud Backup Contains Encrypted apiKeysVault */}
      {pendingVault && (
        <div className="rounded-xl border border-vocab/40 bg-vocab-soft/35 p-4 space-y-2.5 text-xs">
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-start gap-2">
              <Unlock className="h-4 w-4 text-vocab shrink-0 mt-0.5" />
              <div>
                <div className="font-semibold text-text-primary">
                  检测到云端加密 API Key 保险库（含 {pendingVault.keyCount} 个 Key）
                </div>
                <p className="mt-0.5 text-text-secondary">
                  试卷与基础设置已安全恢复。输入你加密时设置的同步主口令即可立即解密导入 API Key，也可忽略跳过。
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => {
                setPendingVault(null);
                setUnlockError(null);
              }}
              className="rounded-lg p-1 text-text-muted hover:text-text-primary"
              title="暂不解密"
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
              placeholder="输入同步主口令以解密..."
              autoComplete="off"
              className="flex-1 min-w-[200px] rounded-xl border border-border-subtle bg-surface px-3 py-1.5 font-mono text-xs text-text-primary focus:border-accent focus:outline-none"
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
              解密并导入 API Key
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
          className={`rounded-xl border px-3.5 py-3 text-xs flex flex-wrap items-center justify-between gap-2 ${
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
            <div className="space-y-0.5">
              <div className="font-medium">{testResult.message}</div>
              <div className="font-mono text-[11px] text-text-muted">
                延迟 {testResult.durationMs}ms · 目标路径 {testResult.normalizedDirPath}
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
              立即创建目标目录
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

      {/* Detailed Error Diagnostic Card */}
      {errorInfo && (
        <div className="rounded-xl border border-danger/30 bg-danger-soft/40 p-3.5 text-xs space-y-1.5">
          <div className="flex items-center gap-2 font-semibold text-danger">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            <span>{errorInfo.message}</span>
          </div>
          <p className="leading-relaxed text-text-primary">{errorInfo.hintZh}</p>
          {errorInfo.url && (
            <div className="font-mono text-[11px] text-text-muted break-all">
              请求地址：{errorInfo.url}
            </div>
          )}
        </div>
      )}

      {/* Remote Snapshot List */}
      {showRemoteFiles && remoteFiles && (
        <div className="rounded-xl border border-border-subtle bg-surface-subtle/50 p-3 space-y-2">
          <div className="flex items-center justify-between text-xs">
            <span className="font-semibold text-text-primary">
              云端备份列表（{remoteFiles.length} 个文件）
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
            <p className="text-xs text-text-muted py-2">当前目录下暂无备份文件。</p>
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
                          最新主备份
                        </span>
                      )}
                    </div>
                    <div className="text-[11px] text-text-muted">
                      {file.size != null ? formatByteSize(file.size) : '未知大小'}
                      {file.lastModifiedMs
                        ? ` · ${new Date(file.lastModifiedMs).toLocaleString()}`
                        : file.lastModified
                          ? ` · ${file.lastModified}`
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
                      恢复此份
                    </button>
                    {!file.isLatest && (
                      <button
                        type="button"
                        disabled={busy !== null}
                        onClick={() => handleDeleteRemoteFile(file.name)}
                        className="rounded-lg border border-border-subtle p-1 text-text-muted hover:border-danger/40 hover:bg-danger-soft hover:text-danger disabled:opacity-45"
                        title="删除此历史快照"
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

      {/* Last Sync Metadata Footer */}
      {webdav.lastSyncAt && (
        <div className="text-[11px] text-text-muted border-t border-border-subtle pt-2.5 flex flex-wrap items-center justify-between gap-2">
          <span>上次同步时间：{new Date(webdav.lastSyncAt).toLocaleString()}</span>
          {webdav.lastSyncSummary && (
            <span className="truncate max-w-xl" title={webdav.lastSyncSummary}>
              {webdav.lastSyncSummary}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
