import { create } from 'zustand';
import type { ExamPaper, ExamSection } from '../types/exam';
import type { PromptParsingMode } from '../lib/prompts/sections';
import type { ParsedSectionDraft } from '../lib/pipeline/pre-parser';

export interface LocalImageItem {
  id: string;
  name: string;
  blob: Blob;
  previewUrl: string;
  width: number;
  height: number;
  originalBytes?: number;
  compressedBytes: number;
  ocrStatus: 'pending' | 'done';
}

interface ImportSessionState {
  loadedPaperId: string | null;
  existingPaper: ExamPaper | null;
  draftPaperId: string | undefined;
  mode: 'text' | 'image';
  parsingMode: PromptParsingMode;
  title: string;
  examType: ExamPaper['examType'];
  forcedSectionType: ExamSection['type'] | 'auto';
  rawText: string;
  images: LocalImageItem[];
  ocrStage: 'upload' | 'review';
  ocrForceFull: boolean;
  ocrReturnPath: string;
  aiPreviewDrafts: ParsedSectionDraft[] | null;

  setField: <K extends keyof ImportSessionFields>(key: K, value: ImportSessionFields[K]) => void;
  setImages: (updater: LocalImageItem[] | ((prev: LocalImageItem[]) => LocalImageItem[])) => void;
  loadPaperIntoSession: (paper: ExamPaper) => void;
  resetSession: () => void;
}

type ImportSessionFields = Omit<
  ImportSessionState,
  'setField' | 'setImages' | 'loadPaperIntoSession' | 'resetSession'
>;

const INITIAL_FIELDS: ImportSessionFields = {
  loadedPaperId: null,
  existingPaper: null,
  draftPaperId: undefined,
  mode: 'text',
  parsingMode: 'pre_parsed',
  title: '',
  examType: 'english_1',
  forcedSectionType: 'auto',
  rawText: '',
  images: [],
  ocrStage: 'upload',
  ocrForceFull: false,
  ocrReturnPath: '/import',
  aiPreviewDrafts: null,
};

export const useImportSessionStore = create<ImportSessionState>((set, get) => ({
  ...INITIAL_FIELDS,

  setField: (key, value) => set({ [key]: value } as Partial<ImportSessionState>),

  setImages: (updater) =>
    set((state) => ({
      images: typeof updater === 'function' ? updater(state.images) : updater,
    })),

  loadPaperIntoSession: (paper) => {
    get().images.forEach((img) => URL.revokeObjectURL(img.previewUrl));
    set({
      loadedPaperId: paper.id,
      existingPaper: paper,
      draftPaperId: paper.id,
      mode: 'text',
      parsingMode: paper.parsingMode || 'pre_parsed',
      title: paper.title,
      examType: paper.examType,
      forcedSectionType: 'auto',
      rawText: paper.rawMarkedText,
      images: [],
      ocrStage: 'upload',
      ocrForceFull: false,
      ocrReturnPath: `/import?paperId=${paper.id}`,
      aiPreviewDrafts: null,
    });
  },

  resetSession: () => {
    get().images.forEach((img) => URL.revokeObjectURL(img.previewUrl));
    set({ ...INITIAL_FIELDS, images: [] });
  },
}));
