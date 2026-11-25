import {
  useSettingsStore,
  type ApiKeyMergeMode,
  type WebDavConfig,
} from '../../stores/useSettingsStore';
import {
  buildBackupBundle,
  parseBackupBundle,
  restoreBackupBundle,
  type RestorePaperMode,
  type RestoreSummary,
} from './backup';
import {
  encryptApiKeysVault,
  VaultCryptoError,
  type EncryptedApiKeysVault,
} from './crypto-vault';

export const WEBDAV_LATEST_FILENAME = 'studying-mate-latest.json';
const SNAPSHOT_PREFIX = 'studying-mate-';

export type WebDavErrorKind =
  | 'invalid_config'
  | 'auth'
  | 'forbidden'
  | 'not_found'
  | 'conflict'
  | 'method_not_allowed'
  | 'cors_or_network'
  | 'timeout'
  | 'http';

export class WebDavError extends Error {
  kind: WebDavErrorKind;
  status?: number;
  url?: string;
  hintZh: string;

  constructor(params: {
    kind: WebDavErrorKind;
    message: string;
    hintZh: string;
    status?: number;
    url?: string;
  }) {
    super(params.message);
    this.name = 'WebDavError';
    this.kind = params.kind;
    this.status = params.status;
    this.url = params.url;
    this.hintZh = params.hintZh;
  }
}

export interface RemoteBackupFile {
  name: string;
  url: string;
  size: number | null;
  lastModified: string | null;
  lastModifiedMs: number;
  isLatest: boolean;
}

export interface WebDavTestResult {
  ok: boolean;
  durationMs: number;
  normalizedServerUrl: string;
  normalizedDirPath: string;
  targetDirUrl: string;
  latestFileUrl: string;
  dirExists: boolean;
  backupFilesCount: number;
  message: string;
}

export interface WebDavBackupResult {
  createdDirs: string[];
  latestFileUrl: string;
  snapshotName?: string;
  prunedSnapshots: number;
  bytes: number;
  paperCount: number;
  vocabCount: number;
  apiKeysSyncedCount: number;
  durationMs: number;
}

export interface WebDavSmartSyncResult {
  direction: 'initial_push' | 'merged_and_pushed';
  createdDirs: string[];
  pulled: RestoreSummary | null;
  pushedPapers: number;
  pushedVocabs: number;
  pushedBytes: number;
  apiKeysSyncedCount: number;
  preservedRemoteVault: boolean;
  durationMs: number;
}

/**
 * UTF-8 safe Basic Auth encoder (native btoa fails on non-Latin1 characters).
 */
function encodeBasicAuth(username: string, password: string): string {
  const bytes = new TextEncoder().encode(`${username}:${password}`);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return `Basic ${btoa(binary)}`;
}

/**
 * Validates and normalizes the WebDAV base server URL (trims whitespace & trailing slashes).
 */
export function normalizeServerUrl(rawUrl: string): string {
  const trimmed = rawUrl.trim();
  if (!trimmed) {
    throw new WebDavError({
      kind: 'invalid_config',
      message: 'WebDAV 服务器地址不能为空',
      hintZh: '请先填写完整的 WebDAV 服务器地址（以 https:// 或 http:// 开头）。',
    });
  }
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new WebDavError({
      kind: 'invalid_config',
      message: `服务器地址格式无效：${trimmed}`,
      hintZh: '请检查地址是否包含协议头，例如 https://dav.example.com/dav',
    });
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new WebDavError({
      kind: 'invalid_config',
      message: `不支持的协议：${parsed.protocol}`,
      hintZh: 'WebDAV 服务器地址必须使用 https:// 或 http:// 协议。',
    });
  }
  // Remove trailing slashes while preserving root path segments
  return trimmed.replace(/\/+$/, '');
}

/**
 * Sanitizes and normalizes a remote directory path (handles backslashes, repeated slashes,
 * leading/trailing slashes, and strips "." / ".." traversal segments).
 */
export function normalizeRemoteDir(rawDir: string): {
  cleanPath: string;
  segments: string[];
} {
  const segments = (rawDir || '')
    .replace(/\\/g, '/')
    .split('/')
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && s !== '.' && s !== '..');

  return {
    cleanPath: segments.length > 0 ? `/${segments.join('/')}` : '/',
    segments,
  };
}

/**
 * Joins normalized serverUrl + encoded path segments cleanly.
 */
export function buildWebDavUrl(
  normalizedServer: string,
  segments: string[],
  isDirectory = false,
): string {
  const encodedPath = segments.map((seg) => encodeURIComponent(seg)).join('/');
  const base = encodedPath ? `${normalizedServer}/${encodedPath}` : normalizedServer;
  return isDirectory ? `${base}/` : base;
}

/**
 * Pure preview helper for UI (never throws).
 */
export function previewWebDavPaths(serverUrl: string, remoteDir: string): {
  valid: boolean;
  cleanDirPath: string;
  targetDirUrl: string;
  latestFileUrl: string;
} {
  const { cleanPath, segments } = normalizeRemoteDir(remoteDir);
  const trimmed = serverUrl.trim().replace(/\/+$/, '');
  if (!trimmed || !/^https?:\/\//i.test(trimmed)) {
    return {
      valid: false,
      cleanDirPath: cleanPath,
      targetDirUrl: '',
      latestFileUrl: '',
    };
  }
  return {
    valid: true,
    cleanDirPath: cleanPath,
    targetDirUrl: buildWebDavUrl(trimmed, segments, true),
    latestFileUrl: buildWebDavUrl(trimmed, [...segments, WEBDAV_LATEST_FILENAME], false),
  };
}

function classifyHttpError(status: number, statusText: string, url: string, action: string): WebDavError {
  if (status === 401) {
    return new WebDavError({
      kind: 'auth',
      status,
      url,
      message: `${action}失败：HTTP 401 未授权`,
      hintZh:
        '用户名或密码验证失败。若使用坚果云/Nextcloud/iCloud 等网盘，请务必使用「应用专用密码」而非账号登录密码。',
    });
  }
  if (status === 403) {
    return new WebDavError({
      kind: 'forbidden',
      status,
      url,
      message: `${action}失败：HTTP 403 拒绝访问`,
      hintZh:
        '当前账号无权操作该路径。部分网盘（如坚果云）禁止直接在根目录 /dav/ 写入文件，请确认已设置子目录（例如 /Studying-Mate）。',
    });
  }
  if (status === 404) {
    return new WebDavError({
      kind: 'not_found',
      status,
      url,
      message: `${action}失败：HTTP 404 路径不存在`,
      hintZh: '目标路径或文件不存在，请检查 WebDAV 服务器地址及目标目录拼写。',
    });
  }
  if (status === 409) {
    return new WebDavError({
      kind: 'conflict',
      status,
      url,
      message: `${action}失败：HTTP 409 上级目录不存在或冲突`,
      hintZh: '目标文件夹的上级目录尚不存在，或同名文件与目录冲突。',
    });
  }
  if (status === 405) {
    return new WebDavError({
      kind: 'method_not_allowed',
      status,
      url,
      message: `${action}失败：HTTP 405 服务器不允许该方法`,
      hintZh: '服务器拒绝了该 WebDAV 请求方法，请确认目标 URL 确实是 WebDAV 端点而非普通网页地址。',
    });
  }
  return new WebDavError({
    kind: 'http',
    status,
    url,
    message: `${action}失败：HTTP ${status} ${statusText || ''}`.trim(),
    hintZh: 'WebDAV 服务端返回异常状态码，请检查服务端日志或存储空间配额。',
  });
}

async function davFetch(
  config: Pick<WebDavConfig, 'username' | 'password'>,
  url: string,
  init: {
    method: string;
    headers?: Record<string, string>;
    body?: string;
    timeoutMs?: number;
  },
  actionLabel: string,
): Promise<Response> {
  const controller = new AbortController();
  const timeoutMs = init.timeoutMs ?? 20000;
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  const headers: Record<string, string> = {
    ...(init.headers || {}),
  };
  if (config.username || config.password) {
    headers['Authorization'] = encodeBasicAuth(config.username || '', config.password || '');
  }

  try {
    return await fetch(url, {
      method: init.method,
      headers,
      body: init.body,
      credentials: 'omit',
      mode: 'cors',
      signal: controller.signal,
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new WebDavError({
        kind: 'timeout',
        url,
        message: `${actionLabel}超时（>${Math.round(timeoutMs / 1000)}s）`,
        hintZh: 'WebDAV 服务器响应超时，请检查网络连接或服务器是否在线。',
      });
    }
    throw new WebDavError({
      kind: 'cors_or_network',
      url,
      message: `${actionLabel}遇到网络或浏览器 CORS 跨域拦截`,
      hintZh:
        '纯前端浏览器直连 WebDAV 需要目标服务端放行 CORS（允许 Origin 及 PROPFIND/MKCOL/GET/PUT/DELETE/OPTIONS 方法与 Authorization/Depth 请求头）。Alist/OpenList、自建 Nginx/Caddy/Nextcloud 可直接配置放行；坚果云等不开放浏览器 CORS 的网盘可通过你自己的 Cloudflare Worker / 反向代理中转后填写代理后的 WebDAV 地址。',
    });
  } finally {
    clearTimeout(timer);
  }
}

const PROPFIND_MINIMAL_BODY = `<?xml version="1.0" encoding="utf-8"?>
<D:propfind xmlns:D="DAV:">
  <D:prop>
    <D:displayname/>
    <D:getcontentlength/>
    <D:getlastmodified/>
    <D:resourcetype/>
  </D:prop>
</D:propfind>`;

/**
 * Checks whether a remote directory exists via PROPFIND (Depth: 0).
 */
async function checkDirectoryExists(
  config: WebDavConfig,
  dirUrl: string,
): Promise<{ exists: boolean; status: number }> {
  const res = await davFetch(
    config,
    dirUrl,
    {
      method: 'PROPFIND',
      headers: {
        Depth: '0',
        'Content-Type': 'application/xml; charset=utf-8',
      },
      body: PROPFIND_MINIMAL_BODY,
      timeoutMs: 15000,
    },
    '检测远程目录',
  );

  if (res.status === 207 || res.status === 200 || res.status === 204) {
    return { exists: true, status: res.status };
  }
  if (res.status === 404) {
    return { exists: false, status: res.status };
  }
  throw classifyHttpError(res.status, res.statusText, dirUrl, '检测远程目录');
}

/**
 * Ensures the target remote directory chain exists by checking first, then recursively
 * issuing MKCOL segment-by-segment when missing (handles nested paths like /Studying-Mate/backups).
 */
export async function ensureRemoteDirectory(
  config: WebDavConfig,
): Promise<{
  normalizedServer: string;
  cleanDirPath: string;
  segments: string[];
  targetDirUrl: string;
  createdDirs: string[];
}> {
  const normalizedServer = normalizeServerUrl(config.serverUrl);
  const { cleanPath, segments } = normalizeRemoteDir(config.remoteDir);
  const targetDirUrl = buildWebDavUrl(normalizedServer, segments, true);

  if (segments.length === 0) {
    return {
      normalizedServer,
      cleanDirPath: cleanPath,
      segments,
      targetDirUrl,
      createdDirs: [],
    };
  }

  // Fast path: check full target directory first (1 single request when already present)
  const existingCheck = await checkDirectoryExists(config, targetDirUrl);
  if (existingCheck.exists) {
    return {
      normalizedServer,
      cleanDirPath: cleanPath,
      segments,
      targetDirUrl,
      createdDirs: [],
    };
  }

  // Slow path: walk top-down and MKCOL each missing level
  const createdDirs: string[] = [];
  for (let i = 0; i < segments.length; i++) {
    const partialSegments = segments.slice(0, i + 1);
    const partialPath = `/${partialSegments.join('/')}`;
    const levelUrl = buildWebDavUrl(normalizedServer, partialSegments, true);

    const levelCheck = await checkDirectoryExists(config, levelUrl);
    if (levelCheck.exists) continue;

    const mkRes = await davFetch(
      config,
      levelUrl,
      {
        method: 'MKCOL',
        timeoutMs: 15000,
      },
      `创建目录 ${partialPath}`,
    );

    if (mkRes.status === 201 || mkRes.status === 200 || mkRes.status === 204) {
      createdDirs.push(partialPath);
      continue;
    }

    // RFC 4918: 405 on MKCOL typically means the collection already exists (race or server quirk)
    if (mkRes.status === 405 || mkRes.status === 301) {
      const verify = await checkDirectoryExists(config, levelUrl);
      if (verify.exists) continue;
    }

    throw classifyHttpError(mkRes.status, mkRes.statusText, levelUrl, `创建目录 ${partialPath}`);
  }

  return {
    normalizedServer,
    cleanDirPath: cleanPath,
    segments,
    targetDirUrl,
    createdDirs,
  };
}

/**
 * Namespace-agnostic XML child text helper for WebDAV multistatus responses.
 */
function findFirstByLocalName(parent: Element, localName: string): Element | null {
  const target = localName.toLowerCase();
  const all = parent.getElementsByTagName('*');
  for (let i = 0; i < all.length; i++) {
    const el = all[i];
    if ((el.localName || el.nodeName.split(':').pop() || '').toLowerCase() === target) {
      return el;
    }
  }
  return null;
}

function parsePropfindBackupsXml(
  xmlText: string,
  normalizedServer: string,
  segments: string[],
): RemoteBackupFile[] {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xmlText, 'application/xml');
  const parseErr = doc.querySelector('parsererror');
  if (parseErr) return [];

  const responseNodes: Element[] = [];
  const allNodes = doc.getElementsByTagName('*');
  for (let i = 0; i < allNodes.length; i++) {
    const el = allNodes[i];
    if ((el.localName || el.nodeName.split(':').pop() || '').toLowerCase() === 'response') {
      responseNodes.push(el);
    }
  }

  const files: RemoteBackupFile[] = [];
  for (const node of responseNodes) {
    const hrefEl = findFirstByLocalName(node, 'href');
    const resourceTypeEl = findFirstByLocalName(node, 'resourcetype');
    const isCollection = Boolean(
      resourceTypeEl && findFirstByLocalName(resourceTypeEl, 'collection'),
    );
    if (isCollection) continue;

    const rawHref = hrefEl?.textContent?.trim() || '';
    if (!rawHref || rawHref.endsWith('/')) continue;

    const lastSeg = rawHref.split('/').filter(Boolean).pop() || '';
    let decodedName = lastSeg;
    try {
      decodedName = decodeURIComponent(lastSeg);
    } catch {
      // keep raw segment
    }

    if (!decodedName.toLowerCase().endsWith('.json')) continue;

    const sizeEl = findFirstByLocalName(node, 'getcontentlength');
    const modEl = findFirstByLocalName(node, 'getlastmodified');
    const parsedSize = sizeEl?.textContent ? Number(sizeEl.textContent.trim()) : NaN;
    const lastModified = modEl?.textContent?.trim() || null;
    const lastModifiedMs = lastModified ? Date.parse(lastModified) || 0 : 0;

    files.push({
      name: decodedName,
      url: buildWebDavUrl(normalizedServer, [...segments, decodedName], false),
      size: Number.isFinite(parsedSize) ? parsedSize : null,
      lastModified,
      lastModifiedMs,
      isLatest: decodedName === WEBDAV_LATEST_FILENAME,
    });
  }

  return files.sort((a, b) => {
    if (a.isLatest && !b.isLatest) return -1;
    if (!a.isLatest && b.isLatest) return 1;
    return b.lastModifiedMs - a.lastModifiedMs || b.name.localeCompare(a.name);
  });
}

/**
 * Lists all .json backup files inside the configured remote directory.
 */
export async function listWebDavBackups(config: WebDavConfig): Promise<RemoteBackupFile[]> {
  const normalizedServer = normalizeServerUrl(config.serverUrl);
  const { segments } = normalizeRemoteDir(config.remoteDir);
  const dirUrl = buildWebDavUrl(normalizedServer, segments, true);

  const res = await davFetch(
    config,
    dirUrl,
    {
      method: 'PROPFIND',
      headers: {
        Depth: '1',
        'Content-Type': 'application/xml; charset=utf-8',
      },
      body: PROPFIND_MINIMAL_BODY,
      timeoutMs: 20000,
    },
    '读取云端备份列表',
  );

  if (res.status === 404) {
    return [];
  }
  if (res.status !== 207 && res.status !== 200) {
    throw classifyHttpError(res.status, res.statusText, dirUrl, '读取云端备份列表');
  }

  const xmlText = await res.text();
  return parsePropfindBackupsXml(xmlText, normalizedServer, segments);
}

/**
 * Tests WebDAV server reachability, authentication, CORS, and target directory existence.
 */
export async function testWebDavConnection(config: WebDavConfig): Promise<WebDavTestResult> {
  const startedAt = performance.now();
  const normalizedServer = normalizeServerUrl(config.serverUrl);
  const { cleanPath, segments } = normalizeRemoteDir(config.remoteDir);
  const rootUrl = buildWebDavUrl(normalizedServer, [], true);
  const targetDirUrl = buildWebDavUrl(normalizedServer, segments, true);
  const latestFileUrl = buildWebDavUrl(
    normalizedServer,
    [...segments, WEBDAV_LATEST_FILENAME],
    false,
  );

  // Step 1: Probe root WebDAV endpoint (PROPFIND Depth: 0)
  const rootRes = await davFetch(
    config,
    rootUrl,
    {
      method: 'PROPFIND',
      headers: {
        Depth: '0',
        'Content-Type': 'application/xml; charset=utf-8',
      },
      body: PROPFIND_MINIMAL_BODY,
      timeoutMs: 15000,
    },
    '测试 WebDAV 根地址连接',
  );

  // Some servers restrict PROPFIND on root or require OPTIONS; only 207/200/204 mean immediate pass
  if (rootRes.status !== 207 && rootRes.status !== 200 && rootRes.status !== 204) {
    // If 403/404 on root, some setups only grant access to a nested subpath; try targetDir before failing
    if ((rootRes.status === 403 || rootRes.status === 404) && segments.length > 0) {
      const subCheck = await checkDirectoryExists(config, targetDirUrl);
      const durationMs = Math.round(performance.now() - startedAt);
      if (subCheck.exists) {
        const files = await listWebDavBackups(config).catch(() => []);
        return {
          ok: true,
          durationMs,
          normalizedServerUrl: normalizedServer,
          normalizedDirPath: cleanPath,
          targetDirUrl,
          latestFileUrl,
          dirExists: true,
          backupFilesCount: files.length,
          message: `连接成功！目标目录 ${cleanPath} 已存在（当前含 ${files.length} 个备份文件）。`,
        };
      }
    }
    throw classifyHttpError(rootRes.status, rootRes.statusText, rootUrl, '测试 WebDAV 连接');
  }

  // Step 2: Check whether target subdirectory exists
  let dirExists = true;
  let backupFilesCount = 0;
  if (segments.length > 0) {
    const check = await checkDirectoryExists(config, targetDirUrl);
    dirExists = check.exists;
  }

  if (dirExists) {
    const files = await listWebDavBackups(config).catch(() => []);
    backupFilesCount = files.length;
  }

  const durationMs = Math.round(performance.now() - startedAt);
  const message = dirExists
    ? `连接成功（CORS 放行 & 鉴权通过）！目标目录 ${cleanPath} 已就绪，当前检测到 ${backupFilesCount} 个云端备份文件。`
    : `连接与鉴权成功！目标目录 ${cleanPath} 尚不存在，备份时将自动逐级创建，也可点击「立即创建目录」。`;

  return {
    ok: true,
    durationMs,
    normalizedServerUrl: normalizedServer,
    normalizedDirPath: cleanPath,
    targetDirUrl,
    latestFileUrl,
    dirExists,
    backupFilesCount,
    message,
  };
}

function formatSnapshotFilename(date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  const stamp = `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(
    date.getHours(),
  )}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
  return `${SNAPSHOT_PREFIX}${stamp}.json`;
}

async function putJsonFile(config: WebDavConfig, url: string, jsonText: string, label: string) {
  const res = await davFetch(
    config,
    url,
    {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
      },
      body: jsonText,
      timeoutMs: 60000,
    },
    label,
  );
  if (res.status !== 200 && res.status !== 201 && res.status !== 204) {
    throw classifyHttpError(res.status, res.statusText, url, label);
  }
}

export async function deleteWebDavBackup(config: WebDavConfig, filename: string): Promise<void> {
  const normalizedServer = normalizeServerUrl(config.serverUrl);
  const { segments } = normalizeRemoteDir(config.remoteDir);
  const fileUrl = buildWebDavUrl(normalizedServer, [...segments, filename], false);

  const res = await davFetch(
    config,
    fileUrl,
    {
      method: 'DELETE',
      timeoutMs: 20000,
    },
    `删除云端备份 ${filename}`,
  );
  if (res.status !== 200 && res.status !== 204 && res.status !== 404) {
    throw classifyHttpError(res.status, res.statusText, fileUrl, `删除云端备份 ${filename}`);
  }
}

/**
 * Backs up all papers, vocabulary, and synced settings to WebDAV.
 * - If `config.syncApiKeys` is enabled, encrypts local non-empty API keys into `apiKeysVault`
 *   and attaches it ONLY to the primary backup (`studying-mate-latest.json`).
 * - Timestamped history snapshots NEVER include `apiKeysVault` to minimize exposure surface.
 */
export async function backupToWebDav(
  config: WebDavConfig,
  options?: {
    includeSettings?: boolean;
    vaultPassphrase?: string;
  },
): Promise<WebDavBackupResult> {
  const startedAt = performance.now();
  const includeSettings = options?.includeSettings ?? true;

  // Encrypt API keys BEFORE making network calls so weak/missing passphrase fails fast
  let apiKeysVault: EncryptedApiKeysVault | undefined;
  let apiKeysSyncedCount = 0;
  if (config.syncApiKeys) {
    const pass = options?.vaultPassphrase?.trim() || '';
    if (!pass) {
      throw new WebDavError({
        kind: 'invalid_config',
        message: '已开启 API Key 加密同步，但未填写同步主口令',
        hintZh: '请填写至少 8 位独立同步主口令（仅暂存当前标签页 sessionStorage），或关闭「加密同步 API Key」开关后再备份。',
      });
    }
    const keysMap = useSettingsStore.getState().exportApiKeysForVault();
    const count = Object.keys(keysMap).length;
    if (count > 0) {
      try {
        apiKeysVault = await encryptApiKeysVault(keysMap, pass);
        apiKeysSyncedCount = count;
      } catch (err) {
        throw new WebDavError({
          kind: 'invalid_config',
          message: err instanceof Error ? err.message : String(err),
          hintZh: '请检查同步主口令长度（至少 8 位）以及浏览器是否处于 HTTPS / localhost 安全上下文。',
        });
      }
    }
  }

  const { normalizedServer, segments, createdDirs } = await ensureRemoteDirectory(config);

  // Primary latest.json bundle (carries encrypted apiKeysVault when enabled)
  const latestBundle = await buildBackupBundle({
    includeSettings,
    apiKeysVault,
  });
  const latestJsonText = JSON.stringify(latestBundle, null, 2);
  const bytes = new TextEncoder().encode(latestJsonText).byteLength;

  const latestFileUrl = buildWebDavUrl(
    normalizedServer,
    [...segments, WEBDAV_LATEST_FILENAME],
    false,
  );
  await putJsonFile(config, latestFileUrl, latestJsonText, '上传最新主备份');

  let snapshotName: string | undefined;
  let prunedSnapshots = 0;
  const keepCount = Math.max(0, Math.min(30, config.keepSnapshots ?? 5));

  if (keepCount > 0) {
    // History snapshots STRICTLY exclude apiKeysVault (only latest.json holds encrypted keys)
    const snapshotBundle = apiKeysVault
      ? {
          ...latestBundle,
          includesApiKeys: false,
          apiKeysVault: undefined,
          note: '历史快照备份（为降低凭证暴露面，历史快照默认不含 API Key 保险库，仅最新主备份携带）',
        }
      : latestBundle;
    const snapshotJsonText = JSON.stringify(snapshotBundle, null, 2);
    snapshotName = formatSnapshotFilename();
    const snapshotUrl = buildWebDavUrl(normalizedServer, [...segments, snapshotName], false);
    await putJsonFile(config, snapshotUrl, snapshotJsonText, '上传历史快照备份');

    // Best-effort pruning of oldest timestamped snapshots beyond keepCount
    try {
      const remoteFiles = await listWebDavBackups(config);
      const snapshots = remoteFiles.filter(
        (f) => !f.isLatest && f.name.startsWith(SNAPSHOT_PREFIX) && f.name.endsWith('.json'),
      );
      if (snapshots.length > keepCount) {
        const toDelete = snapshots.slice(keepCount);
        for (const oldFile of toDelete) {
          await deleteWebDavBackup(config, oldFile.name).catch(() => {});
          prunedSnapshots++;
        }
      }
    } catch {
      // Never fail backup if snapshot cleanup cannot list/delete
    }
  }

  const vocabCount = latestBundle.papers.reduce((sum, p) => sum + (p.vocabulary?.length || 0), 0);

  return {
    createdDirs,
    latestFileUrl,
    snapshotName,
    prunedSnapshots,
    bytes,
    paperCount: latestBundle.papers.length,
    vocabCount,
    apiKeysSyncedCount,
    durationMs: Math.round(performance.now() - startedAt),
  };
}

/**
 * Downloads and restores a specific backup file (defaults to `studying-mate-latest.json`) from WebDAV.
 */
export async function restoreFromWebDav(
  config: WebDavConfig,
  options?: {
    filename?: string;
    mode?: RestorePaperMode;
    restoreSettings?: boolean;
    vaultPassphrase?: string;
    apiKeyMergeMode?: ApiKeyMergeMode;
    skipApiKeys?: boolean;
  },
): Promise<RestoreSummary & { filename: string; durationMs: number }> {
  const startedAt = performance.now();
  const normalizedServer = normalizeServerUrl(config.serverUrl);
  const { segments } = normalizeRemoteDir(config.remoteDir);
  const filename = options?.filename || WEBDAV_LATEST_FILENAME;
  const fileUrl = buildWebDavUrl(normalizedServer, [...segments, filename], false);

  const res = await davFetch(
    config,
    fileUrl,
    {
      method: 'GET',
      timeoutMs: 60000,
    },
    `下载云端备份 ${filename}`,
  );
  if (!res.ok) {
    throw classifyHttpError(res.status, res.statusText, fileUrl, `下载云端备份 ${filename}`);
  }

  const jsonText = await res.text();
  const summary = await restoreBackupBundle(jsonText, {
    mode: options?.mode ?? 'merge_newest',
    restoreSettings: options?.restoreSettings ?? true,
    vaultPassphrase: options?.vaultPassphrase,
    apiKeyMergeMode: options?.apiKeyMergeMode ?? config.apiKeyMergeMode ?? 'merge_newest',
    skipApiKeys: options?.skipApiKeys,
  });

  return {
    ...summary,
    filename,
    durationMs: Math.round(performance.now() - startedAt),
  };
}

/**
 * Two-way Smart Sync with E2EE Vault Guardrails:
 * 1. Ensures target directory exists
 * 2. Pulls `studying-mate-latest.json` if present & merges newer papers/settings locally
 * 3. If `config.syncApiKeys` is ON:
 *    - Validates passphrase first; if cloud has an existing `apiKeysVault`, decrypts & merges BEFORE pushing
 *      (if passphrase is wrong/missing, aborts before pushing so cloud vault is NEVER accidentally overwritten!)
 *    - Re-encrypts merged API keys with fresh salt/IV and writes to `studying-mate-latest.json`.
 * 4. If `config.syncApiKeys` is OFF:
 *    - Preserves any existing cloud `apiKeysVault` untouched in `studying-mate-latest.json` so this device
 *      never erases another device's encrypted keys!
 */
export async function smartSyncWithWebDav(
  config: WebDavConfig,
  options?: {
    syncSettings?: boolean;
    vaultPassphrase?: string;
    apiKeyMergeMode?: ApiKeyMergeMode;
  },
): Promise<WebDavSmartSyncResult> {
  const startedAt = performance.now();
  const syncSettings = options?.syncSettings ?? true;
  const mergeMode = options?.apiKeyMergeMode ?? config.apiKeyMergeMode ?? 'merge_newest';

  if (config.syncApiKeys) {
    const pass = options?.vaultPassphrase?.trim() || '';
    if (!pass) {
      throw new WebDavError({
        kind: 'invalid_config',
        message: '已开启 API Key 加密同步，请先输入同步主口令再执行双向同步',
        hintZh: '请填写至少 8 位同步主口令，或先关闭「加密同步 API Key」开关。',
      });
    }
  }

  const { normalizedServer, segments, createdDirs } = await ensureRemoteDirectory(config);
  const latestFileUrl = buildWebDavUrl(
    normalizedServer,
    [...segments, WEBDAV_LATEST_FILENAME],
    false,
  );

  // Try pulling remote latest first
  const getRes = await davFetch(
    config,
    latestFileUrl,
    {
      method: 'GET',
      timeoutMs: 60000,
    },
    '拉取云端最新同步文件',
  );

  let pulled: RestoreSummary | null = null;
  let direction: 'initial_push' | 'merged_and_pushed' = 'initial_push';
  let existingRemoteVault: EncryptedApiKeysVault | undefined;

  if (getRes.ok) {
    const remoteJson = await getRes.text();
    const parsedMeta = parseBackupBundle(remoteJson);
    existingRemoteVault = parsedMeta.apiKeysVault;

    const shouldApplyRemoteSettings =
      syncSettings &&
      Boolean(parsedMeta.settings) &&
      (!config.lastSyncAt || (parsedMeta.exportedAtMs ?? 0) > config.lastSyncAt);

    pulled = await restoreBackupBundle(remoteJson, {
      mode: 'merge_newest',
      restoreSettings: shouldApplyRemoteSettings,
      vaultPassphrase: config.syncApiKeys ? options?.vaultPassphrase : undefined,
      apiKeyMergeMode: mergeMode,
      skipApiKeys: !config.syncApiKeys,
    });
    direction = 'merged_and_pushed';

    // Safety guardrail: if user enabled API key sync and cloud has a vault that failed to decrypt,
    // STOP before pushing so we don't blindly clobber the cloud vault with local keys!
    if (
      config.syncApiKeys &&
      existingRemoteVault &&
      (pulled.apiKeysStatus === 'wrong_passphrase' || pulled.apiKeysStatus === 'needs_passphrase')
    ) {
      throw new WebDavError({
        kind: 'auth',
        url: latestFileUrl,
        message: '云端 API Key 保险库解密失败，已中止回推以防覆盖云端密钥',
        hintZh:
          '试卷与基础设置已完成本地合并；但云端存在用其他口令加密的 API Key 保险库。请核对同步主口令后重试；若确实忘记旧口令想用本机 Key 重建云端保险库，请使用「用当前口令重置云端保险库」或直接点击「备份到云端」。',
      });
    }
  } else if (getRes.status !== 404) {
    throw classifyHttpError(getRes.status, getRes.statusText, latestFileUrl, '拉取云端最新同步文件');
  }

  // Decide apiKeysVault to write back to latest.json
  let vaultToPush: EncryptedApiKeysVault | undefined;
  let apiKeysSyncedCount = 0;
  let preservedRemoteVault = false;

  if (config.syncApiKeys && options?.vaultPassphrase?.trim()) {
    const mergedKeys = useSettingsStore.getState().exportApiKeysForVault();
    const keyCount = Object.keys(mergedKeys).length;
    if (keyCount > 0) {
      try {
        vaultToPush = await encryptApiKeysVault(mergedKeys, options.vaultPassphrase);
        apiKeysSyncedCount = keyCount;
      } catch (err) {
        throw new WebDavError({
          kind: 'invalid_config',
          message:
            err instanceof VaultCryptoError || err instanceof Error ? err.message : String(err),
          hintZh: '请检查同步主口令长度（至少 8 位）后重试。',
        });
      }
    }
  } else if (!config.syncApiKeys && existingRemoteVault) {
    // Keep remote encrypted vault untouched when this device does not participate in API key sync
    vaultToPush = existingRemoteVault;
    preservedRemoteVault = true;
  }

  // Push merged full bundle back to latest.json
  const mergedBundle = await buildBackupBundle({
    includeSettings: syncSettings,
    apiKeysVault: vaultToPush,
  });
  const mergedJson = JSON.stringify(mergedBundle, null, 2);
  const pushedBytes = new TextEncoder().encode(mergedJson).byteLength;
  await putJsonFile(config, latestFileUrl, mergedJson, '推送合并后的最新备份');

  const pushedVocabs = mergedBundle.papers.reduce(
    (sum, p) => sum + (p.vocabulary?.length || 0),
    0,
  );

  return {
    direction,
    createdDirs,
    pulled,
    pushedPapers: mergedBundle.papers.length,
    pushedVocabs,
    pushedBytes,
    apiKeysSyncedCount,
    preservedRemoteVault,
    durationMs: Math.round(performance.now() - startedAt),
  };
}
