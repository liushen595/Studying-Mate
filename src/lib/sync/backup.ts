import type { ExamPaper } from '../../types/exam';
import { db } from '../db';
import {
  useSettingsStore,
  type ApiKeyMergeMode,
  type SyncedSettingsPayload,
} from '../../stores/useSettingsStore';
import {
  decryptApiKeysVault,
  isEncryptedApiKeysVault,
  VaultCryptoError,
  type EncryptedApiKeysVault,
} from './crypto-vault';

export interface StudyingMateBackupBundle {
  version: 2;
  app: 'Studying-Mate';
  exportedAt: string;
  exportedAtMs: number;
  includesApiKeys: boolean;
  note: string;
  papers: ExamPaper[];
  settings?: SyncedSettingsPayload;
  /** Optional E2EE encrypted API key vault (attached ONLY to primary latest.json when user opts in) */
  apiKeysVault?: EncryptedApiKeysVault;
}

export type RestorePaperMode = 'merge_newest' | 'overwrite_matching';

export type ApiKeysRestoreStatus =
  | 'none'
  | 'restored'
  | 'skipped'
  | 'needs_passphrase'
  | 'wrong_passphrase';

export interface RestoreSummary {
  totalInBackup: number;
  added: number;
  updated: number;
  skippedOlder: number;
  settingsRestored: boolean;
  apiKeysStatus: ApiKeysRestoreStatus;
  apiKeysApplied: number;
  apiKeysSkippedLocal: number;
  apiKeysError?: string;
  /** Returned when apiKeysStatus is 'needs_passphrase' or 'wrong_passphrase' so UI can unlock in-place */
  pendingVault?: EncryptedApiKeysVault;
}

/**
 * Builds a complete v2 backup bundle containing all papers + vocabulary
 * and optionally sanitized app/model settings.
 * Plaintext API keys are NEVER placed in `settings`; encrypted keys are attached strictly via `apiKeysVault`.
 */
export async function buildBackupBundle(options?: {
  includeSettings?: boolean;
  apiKeysVault?: EncryptedApiKeysVault;
}): Promise<StudyingMateBackupBundle> {
  const includeSettings = options?.includeSettings ?? true;
  const apiKeysVault = options?.apiKeysVault;
  const papers = await db.papers.toArray();
  const now = Date.now();

  return {
    version: 2,
    app: 'Studying-Mate',
    exportedAt: new Date(now).toISOString(),
    exportedAtMs: now,
    includesApiKeys: Boolean(apiKeysVault),
    note: apiKeysVault
      ? '包含试卷精读、生词本、非敏感设置与 AES-256-GCM 端到端加密的 API Key 保险库（不含明文 Key 与 WebDAV 密码）'
      : includeSettings
        ? '包含全部试卷精读、生词本与应用设置（已自动剔除所有 LLM API Key 与 WebDAV 密码）'
        : '仅包含试卷精读记录与生词本数据（不含 API Key）',
    papers,
    settings: includeSettings
      ? useSettingsStore.getState().exportSyncedSettings()
      : undefined,
    ...(apiKeysVault ? { apiKeysVault } : {}),
  };
}

/**
 * Parses either a v2 StudyingMateBackupBundle (with optional apiKeysVault), legacy v1 backup JSON, or raw ExamPaper[].
 */
export function parseBackupBundle(jsonText: string): {
  papers: ExamPaper[];
  settings?: Partial<SyncedSettingsPayload>;
  apiKeysVault?: EncryptedApiKeysVault;
  exportedAtMs?: number;
  version: number;
} {
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    throw new Error('备份文件不是有效的 JSON 格式');
  }

  if (Array.isArray(parsed)) {
    return { papers: parsed as ExamPaper[], version: 1 };
  }

  if (!parsed || typeof parsed !== 'object') {
    throw new Error('备份文件结构无效');
  }

  const obj = parsed as Record<string, unknown>;
  const papers = Array.isArray(obj.papers) ? (obj.papers as ExamPaper[]) : [];
  const settings =
    obj.settings && typeof obj.settings === 'object'
      ? (obj.settings as Partial<SyncedSettingsPayload>)
      : undefined;
  const apiKeysVault = isEncryptedApiKeysVault(obj.apiKeysVault)
    ? obj.apiKeysVault
    : undefined;

  if (papers.length === 0 && !settings && !apiKeysVault) {
    throw new Error('备份文件中未找到有效的试卷或设置数据');
  }

  const exportedAtMs =
    typeof obj.exportedAtMs === 'number'
      ? obj.exportedAtMs
      : typeof obj.exportedAt === 'string'
        ? Date.parse(obj.exportedAt) || undefined
        : undefined;

  return {
    papers,
    settings,
    apiKeysVault,
    exportedAtMs,
    version: typeof obj.version === 'number' ? obj.version : 1,
  };
}

/**
 * Decrypts a standalone EncryptedApiKeysVault and merges keys into the local settings store.
 */
export async function decryptAndApplyVaultOnly(
  vault: EncryptedApiKeysVault,
  passphrase: string,
  mergeMode: ApiKeyMergeMode = 'merge_newest',
): Promise<{ applied: number; skippedLocal: number; totalInVault: number }> {
  const plaintext = await decryptApiKeysVault(vault, passphrase);
  const { applied, skippedLocal } = useSettingsStore
    .getState()
    .applyDecryptedApiKeys(plaintext.keys, mergeMode);
  return {
    applied,
    skippedLocal,
    totalInVault: Object.keys(plaintext.keys).length,
  };
}

/**
 * Restores papers, non-sensitive settings, and optionally encrypted API keys from a backup bundle.
 * Failure or absence of vault passphrase NEVER blocks restoring papers & non-sensitive settings!
 */
export async function restoreBackupBundle(
  jsonText: string,
  options?: {
    mode?: RestorePaperMode;
    restoreSettings?: boolean;
    vaultPassphrase?: string;
    apiKeyMergeMode?: ApiKeyMergeMode;
    skipApiKeys?: boolean;
  },
): Promise<RestoreSummary> {
  const mode = options?.mode ?? 'merge_newest';
  const restoreSettings = options?.restoreSettings ?? true;
  const parsed = parseBackupBundle(jsonText);

  const localPapers = await db.papers.toArray();
  const localById = new Map<string, ExamPaper>(localPapers.map((p) => [p.id, p]));

  const toWrite: ExamPaper[] = [];
  let added = 0;
  let updated = 0;
  let skippedOlder = 0;

  for (const remotePaper of parsed.papers) {
    if (!remotePaper || typeof remotePaper.id !== 'string') continue;
    const local = localById.get(remotePaper.id);
    if (!local) {
      toWrite.push(remotePaper);
      added++;
    } else if (mode === 'overwrite_matching') {
      toWrite.push(remotePaper);
      updated++;
    } else {
      const remoteUpdated = remotePaper.updatedAt || 0;
      const localUpdated = local.updatedAt || 0;
      if (remoteUpdated > localUpdated) {
        toWrite.push(remotePaper);
        updated++;
      } else {
        skippedOlder++;
      }
    }
  }

  if (toWrite.length > 0) {
    await db.papers.bulkPut(toWrite);
  }

  let settingsRestored = false;
  if (restoreSettings && parsed.settings) {
    useSettingsStore.getState().applySyncedSettings(parsed.settings);
    settingsRestored = true;
  }

  // Handle isolated encrypted API Key vault AFTER papers & settings have safely succeeded
  let apiKeysStatus: ApiKeysRestoreStatus = 'none';
  let apiKeysApplied = 0;
  let apiKeysSkippedLocal = 0;
  let apiKeysError: string | undefined;
  let pendingVault: EncryptedApiKeysVault | undefined;

  if (parsed.apiKeysVault) {
    if (options?.skipApiKeys) {
      apiKeysStatus = 'skipped';
    } else if (!options?.vaultPassphrase?.trim()) {
      apiKeysStatus = 'needs_passphrase';
      pendingVault = parsed.apiKeysVault;
    } else {
      try {
        const res = await decryptAndApplyVaultOnly(
          parsed.apiKeysVault,
          options.vaultPassphrase,
          options.apiKeyMergeMode ?? 'merge_newest',
        );
        apiKeysStatus = 'restored';
        apiKeysApplied = res.applied;
        apiKeysSkippedLocal = res.skippedLocal;
      } catch (err) {
        apiKeysStatus = 'wrong_passphrase';
        apiKeysError =
          err instanceof VaultCryptoError
            ? err.message
            : err instanceof Error
              ? err.message
              : String(err);
        pendingVault = parsed.apiKeysVault;
      }
    }
  }

  return {
    totalInBackup: parsed.papers.length,
    added,
    updated,
    skippedOlder,
    settingsRestored,
    apiKeysStatus,
    apiKeysApplied,
    apiKeysSkippedLocal,
    apiKeysError,
    pendingVault,
  };
}
