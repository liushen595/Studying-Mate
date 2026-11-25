export interface BilingualParagraph {
  id: string;
  en: string;
  zh: string;
}

export type AnswerSource = 'paper_marked' | 'llm_solved';

export interface BaseSection {
  id: string;
  title: string;
  rawText?: string;
  status: 'pending' | 'streaming' | 'done' | 'error';
  errorMessage?: string;
}

export interface ClozeBlank {
  number: number;
  correctOption: 'A' | 'B' | 'C' | 'D';
  correctWord: string;
  answerSource: AnswerSource;
  options: Array<{
    label: 'A' | 'B' | 'C' | 'D';
    text: string;
    briefZh: string;
  }>;
}

export interface ClozeSection extends BaseSection {
  type: 'cloze';
  paragraphs: BilingualParagraph[];
  blanks: ClozeBlank[];
}

export interface ReadingQuestion {
  number: number;
  stemEn: string;
  stemZh: string;
  correctOption: 'A' | 'B' | 'C' | 'D';
  answerSource: AnswerSource;
  options: Array<{
    label: 'A' | 'B' | 'C' | 'D';
    textEn: string;
    textZh: string;
  }>;
}

export interface ReadingSection extends BaseSection {
  type: 'reading';
  paragraphs: BilingualParagraph[];
  questions: ReadingQuestion[];
}

export type NewTypeSubType =
  | 'seven_choose_five'
  | 'ordering'
  | 'heading_matching'
  | 'info_matching';

export type NewTypeBlock =
  | {
      kind: 'paragraph';
      id: string;
      /** For ordering questions: original option letter if this paragraph was a pre-fixed anchor (e.g. "C") */
      fixedOption?: string;
      en: string;
      zh: string;
    }
  | {
      kind: 'filled_slot';
      number: number;
      selectedOption: string;
      answerSource: AnswerSource;
      /** For info_matching (English II) or labeled slots: left-column prompt/person/topic name */
      slotPrompt?: string;
      en: string;
      zh: string;
    };

export interface NewTypeSection extends BaseSection {
  type: 'new_type';
  subType: NewTypeSubType;
  blocks: NewTypeBlock[];
  optionBank: Array<{
    label: string;
    en: string;
    zh: string;
    usedInSlot: number | null;
    /** For ordering questions: marks a pre-given fixed paragraph so UI does not label it as a distractor */
    isFixed?: boolean;
  }>;
}

export type SyntaxRole =
  | 'main_clause'
  | 'attributive_clause'
  | 'adverbial_clause'
  | 'noun_clause'
  | 'non_finite'
  | 'prepositional_phrase'
  | 'parenthetical'
  | 'special_syntax';

export interface SyntaxComponent {
  text: string;
  role: SyntaxRole;
  roleLabelZh: string;
  modifies?: string;
  meaningZh: string;
}

export interface TranslationItem {
  number: number;
  originalEn: string;
  sentenceStructure: {
    sentenceType: string;
    backbone: {
      subject: string;
      predicate: string;
      objectOrComplement?: string;
      backboneZh: string;
    };
    components: SyntaxComponent[];
    literalZh: string;
    polishedZh: string;
    keyPoints: string[];
  };
}

export interface TranslationSection extends BaseSection {
  type: 'translation';
  contextPassage?: BilingualParagraph[];
  items: TranslationItem[];
}

export interface WritingGoodWord {
  expression: string;
  posOrType?: string;
  meaningZh: string;
  replaces?: string;
  usageExample?: string;
}

export interface WritingGoodSentence {
  en: string;
  zh: string;
  pattern: string;
  explanationZh: string;
}

export interface WritingTaskItem {
  part: 'part_a' | 'part_b' | 'general';
  partLabel: string;
  number?: number;
  promptEn: string;
  promptZh: string;
  visualSummary?: string;
  guidance: {
    genreAndTone: string;
    wordCountTarget: string;
    coreThemeZh: string;
    outline: Array<{
      paragraphLabel: string;
      keyPoints: string[];
      suggestedWords?: string;
    }>;
    scoringTips: string[];
  };
  sampleEssay: {
    title?: string;
    paragraphs: BilingualParagraph[];
    wordCount: number;
    commentaryZh: string;
  };
  goodWords: WritingGoodWord[];
  goodSentences: WritingGoodSentence[];
}

export interface WritingSection extends BaseSection {
  type: 'writing';
  tasks: WritingTaskItem[];
}

export interface GeneralSection extends BaseSection {
  type: 'general';
  paragraphs: BilingualParagraph[];
}

export type ExamSection =
  | ClozeSection
  | ReadingSection
  | NewTypeSection
  | TranslationSection
  | WritingSection
  | GeneralSection;

export interface VocabOccurrence {
  sectionId: string;
  sectionTitle: string;
  surfaceForm: string;
  contextMeaning: string;
  isUncommonMeaning?: boolean;
  sentenceEn: string;
  sentenceZh: string;
}

export type VocabExtractMode = 'manual_only' | 'ai_augment';
export type VocabExtractDensity = 'concise' | 'balanced' | 'comprehensive';

export interface VocabEntry {
  id: string;
  lemma: string;
  surfaceForms: string[];
  phoneticUk: string;
  phoneticUs: string;
  /** Whether the word was explicitly marked by the user ({{word}}) or auto-summarized/supplemented by AI */
  source?: 'user' | 'ai';
  comprehensiveMeanings: Array<{
    pos: string;
    definitions: string[];
  }>;
  occurrences: VocabOccurrence[];
  collocations: Array<{
    phrase: string;
    meaning: string;
  }>;
  wordFamily?: string[];
  confusables?: Array<{
    word: string;
    diff: string;
  }>;
}

export interface ExamPaper {
  id: string;
  title: string;
  examType: 'english_1' | 'english_2' | 'custom';
  createdAt: number;
  updatedAt: number;
  status: 'ocr_draft' | 'analyzing' | 'completed' | 'partial_error';
  // 原始输入存档
  sourceMode: 'text' | 'image';
  parsingMode?: 'pre_parsed' | 'ai_segmented';
  vocabExtractMode?: VocabExtractMode;
  rawMarkedText: string;
  sourceImageIds?: string[];
  sections: ExamSection[];
  vocabulary: VocabEntry[];
  analysisMeta?: {
    providerName: string;
    modelId: string;
    ocrModelId?: string;
    totalTokensUsed?: number;
  };
}

export interface StoredImage {
  id: string;
  paperId: string;
  order: number;
  name: string;
  mimeType: string;
  width: number;
  height: number;
  blob: Blob;
  createdAt: number;
}
