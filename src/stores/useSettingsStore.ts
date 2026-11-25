import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { VocabExtractDensity, VocabExtractMode } from '../types/exam';
import type { ProviderProfile } from '../types/llm';
import {
  buildBailianBaseUrl,
  createCustomProviderProfile,
  createDefaultParamsFromModel,
  createInitialProviderProfiles,
  findPresetModelSpec,
} from '../lib/llm/presets';

export type ThemeMode = 'system' | 'light' | 'dark';
export type ReadingLayout = 'stacked' | 'split' | 'english_only';
export type FontStyle = 'serif' | 'sans';
export type FontSize = 'sm' | 'md' | 'lg';

export type ApiKeyMergeMode = 'merge_newest' | 'fill_missing' | 'overwrite_remote';

export interface WebDavConfig {
  serverUrl: string;
  username: string;
  password: string;
  remoteDir: string;
  keepSnapshots: number;
  /** Opt-in: encrypt & sync LLM API Keys ONLY in studying-mate-latest.json (never in history snapshots) */
  syncApiKeys?: boolean;
  apiKeyMergeMode?: ApiKeyMergeMode;
  lastSyncAt?: number;
  lastSyncAction?: 'backup' | 'restore' | 'sync';
  lastSyncSummary?: string;
}

export interface SyncedSettingsPayload {
  theme: ThemeMode;
  readingLayout: ReadingLayout;
  fontStyle: FontStyle;
  fontSize: FontSize;
  sidebarCollapsed: boolean;
  concurrency: number;
  vocabExtractMode: VocabExtractMode;
  vocabExtractDensity: VocabExtractDensity;
  activeProviderId: string;
  visionProviderId: string;
  visionFollowAnalysis: boolean;
  /** Provider configs with API keys strictly stripped (never exported in plaintext) */
  providers: Array<Omit<ProviderProfile, 'apiKey' | 'apiKeyUpdatedAt'>>;
}

interface SettingsState {
  providers: ProviderProfile[];
  /** Active provider ID for Stage 2 text analysis */
  activeProviderId: string;
  /** Optional separate provider ID for Stage 1 Vision OCR ('same' = follow activeProviderId) */
  visionProviderId: string;
  /** Optional override model ID when visionProviderId === 'same' or custom */
  visionFollowAnalysis: boolean;
  /** Max concurrent section analysis requests */
  concurrency: number;

  // Vocabulary extraction preferences
  vocabExtractMode: VocabExtractMode;
  vocabExtractDensity: VocabExtractDensity;

  // WebDAV backup & sync config (stored locally only; never included in exported backups)
  webdav: WebDavConfig;

  // UI & Reading Preferences
  theme: ThemeMode;
  readingLayout: ReadingLayout;
  fontStyle: FontStyle;
  fontSize: FontSize;
  sidebarCollapsed: boolean;

  // Actions
  setActiveProviderId: (id: string) => void;
  setVisionRouting: (followAnalysis: boolean, providerId?: string) => void;
  updateProvider: (id: string, patch: Partial<ProviderProfile>) => void;
  updateProviderParams: (
    id: string,
    patch: Partial<ProviderProfile['params']>,
  ) => void;
  selectPresetModel: (providerId: string, modelId: string) => void;
  updateBailianWorkspace: (
    providerId: string,
    meta: { workspaceId?: string; region?: string; useLegacyEndpoint?: boolean },
  ) => void;
  addCustomProvider: () => ProviderProfile;
  removeCustomProvider: (id: string) => void;
  setConcurrency: (n: number) => void;
  setVocabExtractMode: (mode: VocabExtractMode) => void;
  setVocabExtractDensity: (density: VocabExtractDensity) => void;
  updateWebDav: (patch: Partial<WebDavConfig>) => void;
  setTheme: (theme: ThemeMode) => void;
  setReadingLayout: (layout: ReadingLayout) => void;
  setFontStyle: (style: FontStyle) => void;
  setFontSize: (size: FontSize) => void;
  toggleSidebar: () => void;

  // Sync helpers
  exportSyncedSettings: () => SyncedSettingsPayload;
  applySyncedSettings: (payload: Partial<SyncedSettingsPayload>) => void;
  exportApiKeysForVault: () => Record<string, { apiKey: string; updatedAt: number }>;
  applyDecryptedApiKeys: (
    keys: Record<string, { apiKey: string; updatedAt: number }>,
    mode?: ApiKeyMergeMode,
  ) => { applied: number; skippedLocal: number };

  // Helpers
  getAnalysisProvider: () => ProviderProfile;
  getVisionProvider: () => ProviderProfile;
}

const initialProviders = createInitialProviderProfiles();

const defaultWebDavConfig: WebDavConfig = {
  serverUrl: '',
  username: '',
  password: '',
  remoteDir: '/Studying-Mate',
  keepSnapshots: 5,
  syncApiKeys: false,
  apiKeyMergeMode: 'merge_newest',
};

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set, get) => ({
      providers: initialProviders,
      activeProviderId: 'deepseek',
      visionProviderId: 'deepseek',
      visionFollowAnalysis: true,
      concurrency: 2,

      vocabExtractMode: 'manual_only',
      vocabExtractDensity: 'balanced',

      webdav: defaultWebDavConfig,

      theme: 'system',
      readingLayout: 'stacked',
      fontStyle: 'serif',
      fontSize: 'md',
      sidebarCollapsed: false,

      setActiveProviderId: (id) => set({ activeProviderId: id }),

      setVisionRouting: (followAnalysis, providerId) =>
        set((state) => ({
          visionFollowAnalysis: followAnalysis,
          visionProviderId: providerId ?? state.visionProviderId,
        })),

      updateProvider: (id, patch) =>
        set((state) => ({
          providers: state.providers.map((p) => {
            if (p.id !== id) return p;
            const keyChanged =
              patch.apiKey !== undefined && patch.apiKey !== p.apiKey;
            return {
              ...p,
              ...patch,
              ...(keyChanged ? { apiKeyUpdatedAt: Date.now() } : {}),
            };
          }),
        })),

      updateProviderParams: (id, patch) =>
        set((state) => ({
          providers: state.providers.map((p) =>
            p.id === id
              ? {
                  ...p,
                  params: {
                    ...p.params,
                    ...patch,
                    thinking: patch.thinking
                      ? { ...p.params.thinking, ...patch.thinking }
                      : p.params.thinking,
                  },
                }
              : p,
          ),
        })),

      selectPresetModel: (providerId, modelId) =>
        set((state) => ({
          providers: state.providers.map((p) => {
            if (p.id !== providerId) return p;
            const spec = findPresetModelSpec(p.presetKey, modelId);
            if (!spec) {
              return { ...p, modelId };
            }
            const defaults = createDefaultParamsFromModel(spec);
            return {
              ...p,
              modelId: spec.id,
              capabilities: { ...spec.capabilities },
              params: {
                ...p.params,
                contextWindow: defaults.contextWindow,
                maxInputTokens: defaults.maxInputTokens,
                maxOutputTokens: defaults.maxOutputTokens,
                thinking: {
                  ...defaults.thinking,
                  includeThoughts: p.params.thinking.includeThoughts,
                },
              },
            };
          }),
        })),

      updateBailianWorkspace: (providerId, meta) =>
        set((state) => ({
          providers: state.providers.map((p) => {
            if (p.id !== providerId) return p;
            const nextMeta = {
              workspaceId: meta.workspaceId ?? p.workspaceMeta?.workspaceId ?? '',
              region: meta.region ?? p.workspaceMeta?.region ?? 'cn-beijing',
              useLegacyEndpoint:
                meta.useLegacyEndpoint ?? p.workspaceMeta?.useLegacyEndpoint ?? false,
            };
            const nextBaseUrl = buildBailianBaseUrl(
              nextMeta.workspaceId,
              nextMeta.region,
              nextMeta.useLegacyEndpoint,
            );
            return {
              ...p,
              workspaceMeta: nextMeta,
              baseUrl: nextBaseUrl,
            };
          }),
        })),

      addCustomProvider: () => {
        const created = createCustomProviderProfile(
          `自定义供应商 ${get().providers.filter((p) => p.presetKey === 'custom').length + 1}`,
        );
        set((state) => ({
          providers: [...state.providers, created],
          activeProviderId: created.id,
        }));
        return created;
      },

      removeCustomProvider: (id) =>
        set((state) => {
          const filtered = state.providers.filter((p) => !(p.id === id && p.presetKey === 'custom'));
          return {
            providers: filtered,
            activeProviderId:
              state.activeProviderId === id ? filtered[0]?.id || 'deepseek' : state.activeProviderId,
            visionProviderId:
              state.visionProviderId === id ? filtered[0]?.id || 'deepseek' : state.visionProviderId,
          };
        }),

      setConcurrency: (n) => set({ concurrency: Math.min(4, Math.max(1, n)) }),
      setVocabExtractMode: (vocabExtractMode) => set({ vocabExtractMode }),
      setVocabExtractDensity: (vocabExtractDensity) => set({ vocabExtractDensity }),
      updateWebDav: (patch) =>
        set((state) => ({
          webdav: { ...defaultWebDavConfig, ...state.webdav, ...patch },
        })),
      setTheme: (theme) => set({ theme }),
      setReadingLayout: (readingLayout) => set({ readingLayout }),
      setFontStyle: (fontStyle) => set({ fontStyle }),
      setFontSize: (fontSize) => set({ fontSize }),
      toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),

      exportSyncedSettings: () => {
        const s = get();
        return {
          theme: s.theme,
          readingLayout: s.readingLayout,
          fontStyle: s.fontStyle,
          fontSize: s.fontSize,
          sidebarCollapsed: s.sidebarCollapsed,
          concurrency: s.concurrency,
          vocabExtractMode: s.vocabExtractMode,
          vocabExtractDensity: s.vocabExtractDensity,
          activeProviderId: s.activeProviderId,
          visionProviderId: s.visionProviderId,
          visionFollowAnalysis: s.visionFollowAnalysis,
          providers: s.providers.map(
            ({ apiKey: _stripped, apiKeyUpdatedAt: _strippedTs, ...rest }) => rest,
          ),
        };
      },

      applySyncedSettings: (payload) =>
        set((state) => {
          const nextProviders = [...state.providers];
          if (Array.isArray(payload.providers)) {
            for (const remoteProv of payload.providers) {
              if (!remoteProv || typeof remoteProv.id !== 'string') continue;
              const idx = nextProviders.findIndex((p) => p.id === remoteProv.id);
              if (idx >= 0) {
                // Preserve local API key & timestamp while syncing model, params, baseUrl, workspaceMeta, etc.
                const localKey = nextProviders[idx].apiKey;
                const localKeyTs = nextProviders[idx].apiKeyUpdatedAt;
                nextProviders[idx] = {
                  ...nextProviders[idx],
                  ...remoteProv,
                  apiKey: localKey,
                  apiKeyUpdatedAt: localKeyTs,
                  capabilities: {
                    ...nextProviders[idx].capabilities,
                    ...(remoteProv.capabilities || {}),
                  },
                  params: {
                    ...nextProviders[idx].params,
                    ...(remoteProv.params || {}),
                    thinking: {
                      ...nextProviders[idx].params.thinking,
                      ...(remoteProv.params?.thinking || {}),
                    },
                  },
                };
              } else if (remoteProv.presetKey === 'custom') {
                nextProviders.push({
                  ...remoteProv,
                  apiKey: '',
                } as ProviderProfile);
              }
            }
          }

          const hasProvider = (id?: string) =>
            Boolean(id && nextProviders.some((p) => p.id === id));

          return {
            providers: nextProviders,
            theme: payload.theme ?? state.theme,
            readingLayout: payload.readingLayout ?? state.readingLayout,
            fontStyle: payload.fontStyle ?? state.fontStyle,
            fontSize: payload.fontSize ?? state.fontSize,
            sidebarCollapsed: payload.sidebarCollapsed ?? state.sidebarCollapsed,
            concurrency:
              typeof payload.concurrency === 'number'
                ? Math.min(4, Math.max(1, payload.concurrency))
                : state.concurrency,
            vocabExtractMode: payload.vocabExtractMode ?? state.vocabExtractMode,
            vocabExtractDensity: payload.vocabExtractDensity ?? state.vocabExtractDensity,
            activeProviderId: hasProvider(payload.activeProviderId)
              ? payload.activeProviderId!
              : state.activeProviderId,
            visionProviderId: hasProvider(payload.visionProviderId)
              ? payload.visionProviderId!
              : state.visionProviderId,
            visionFollowAnalysis:
              typeof payload.visionFollowAnalysis === 'boolean'
                ? payload.visionFollowAnalysis
                : state.visionFollowAnalysis,
          };
        }),

      exportApiKeysForVault: () => {
        const s = get();
        const out: Record<string, { apiKey: string; updatedAt: number }> = {};
        const now = Date.now();
        for (const p of s.providers) {
          const trimmed = p.apiKey?.trim();
          if (trimmed) {
            out[p.id] = {
              apiKey: trimmed,
              updatedAt: p.apiKeyUpdatedAt || now,
            };
          }
        }
        return out;
      },

      applyDecryptedApiKeys: (keys, mode = 'merge_newest') => {
        let applied = 0;
        let skippedLocal = 0;
        set((state) => ({
          providers: state.providers.map((p) => {
            const rec = keys[p.id];
            const remoteKey = rec?.apiKey?.trim();
            if (!remoteKey) return p; // Never overwrite with empty string

            const localKey = p.apiKey?.trim() || '';
            if (!localKey) {
              applied++;
              return {
                ...p,
                apiKey: remoteKey,
                apiKeyUpdatedAt: rec.updatedAt || Date.now(),
              };
            }
            if (localKey === remoteKey) {
              return p;
            }
            if (mode === 'fill_missing') {
              skippedLocal++;
              return p;
            }
            if (mode === 'overwrite_remote') {
              applied++;
              return {
                ...p,
                apiKey: remoteKey,
                apiKeyUpdatedAt: rec.updatedAt || Date.now(),
              };
            }
            // merge_newest: adopt remote key only if its updatedAt is strictly newer than local
            const localTs = p.apiKeyUpdatedAt || 0;
            const remoteTs = rec.updatedAt || 0;
            if (remoteTs > localTs) {
              applied++;
              return {
                ...p,
                apiKey: remoteKey,
                apiKeyUpdatedAt: remoteTs,
              };
            }
            skippedLocal++;
            return p;
          }),
        }));
        return { applied, skippedLocal };
      },

      getAnalysisProvider: () => {
        const s = get();
        return s.providers.find((p) => p.id === s.activeProviderId) || s.providers[0];
      },

      getVisionProvider: () => {
        const s = get();
        if (s.visionFollowAnalysis) {
          return s.getAnalysisProvider();
        }
        return s.providers.find((p) => p.id === s.visionProviderId) || s.getAnalysisProvider();
      },
    }),
    {
      name: 'studying-mate-settings-v1',
    },
  ),
);
