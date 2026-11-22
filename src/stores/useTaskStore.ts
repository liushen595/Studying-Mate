import { create } from 'zustand';
import type { ExecutionStepState, LLMErrorDetail } from '../types/llm';

interface TaskState {
  activeTaskLabel: string | null;
  running: boolean;
  steps: ExecutionStepState[];
  abortController: AbortController | null;
  fatalError: LLMErrorDetail | null;

  startTask: (label: string, initialSteps: ExecutionStepState[]) => AbortController;
  updateStep: (id: string, patch: Partial<ExecutionStepState>) => void;
  appendStepThinking: (id: string, fullThinking: string) => void;
  appendStepContent: (id: string, fullContent: string) => void;
  finishTask: (fatalError?: LLMErrorDetail | null) => void;
  abortTask: () => void;
  clearTask: () => void;
}

export const useTaskStore = create<TaskState>((set, get) => ({
  activeTaskLabel: null,
  running: false,
  steps: [],
  abortController: null,
  fatalError: null,

  startTask: (label, initialSteps) => {
    get().abortController?.abort();
    const controller = new AbortController();
    set({
      activeTaskLabel: label,
      running: true,
      steps: initialSteps,
      abortController: controller,
      fatalError: null,
    });
    return controller;
  },

  updateStep: (id, patch) =>
    set((state) => ({
      steps: state.steps.map((s) => (s.id === id ? { ...s, ...patch } : s)),
    })),

  appendStepThinking: (id, fullThinking) =>
    set((state) => ({
      steps: state.steps.map((s) =>
        s.id === id
          ? {
              ...s,
              status: s.status === 'pending' ? 'thinking' : s.status,
              thinkingText: fullThinking,
            }
          : s,
      ),
    })),

  appendStepContent: (id, fullContent) =>
    set((state) => ({
      steps: state.steps.map((s) =>
        s.id === id
          ? {
              ...s,
              status: 'streaming',
              contentPreview: fullContent.slice(-420),
            }
          : s,
      ),
    })),

  finishTask: (fatalError = null) =>
    set({
      running: false,
      abortController: null,
      fatalError,
    }),

  abortTask: () => {
    get().abortController?.abort();
    set({ running: false, abortController: null });
  },

  clearTask: () => {
    get().abortController?.abort();
    set({
      activeTaskLabel: null,
      running: false,
      steps: [],
      abortController: null,
      fatalError: null,
    });
  },
}));
