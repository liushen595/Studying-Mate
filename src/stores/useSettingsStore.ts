import { create } from 'zustand';
import { persist } from 'zustand/middleware';
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
  setTheme: (theme: ThemeMode) => void;
  setReadingLayout: (layout: ReadingLayout) => void;
  setFontStyle: (style: FontStyle) => void;
  setFontSize: (size: FontSize) => void;
  toggleSidebar: () => void;

  // Helpers
  getAnalysisProvider: () => ProviderProfile;
  getVisionProvider: () => ProviderProfile;
}

const initialProviders = createInitialProviderProfiles();

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set, get) => ({
      providers: initialProviders,
      activeProviderId: 'deepseek',
      visionProviderId: 'deepseek',
      visionFollowAnalysis: true,
      concurrency: 2,

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
          providers: state.providers.map((p) =>
            p.id === id ? { ...p, ...patch } : p,
          ),
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
      setTheme: (theme) => set({ theme }),
      setReadingLayout: (readingLayout) => set({ readingLayout }),
      setFontStyle: (fontStyle) => set({ fontStyle }),
      setFontSize: (fontSize) => set({ fontSize }),
      toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),

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
