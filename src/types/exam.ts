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

export type NewTypeBlock =
  | {
      kind: 'paragraph';
      id: string;
      en: string;
      zh: string;
    }
  | {
      kind: 'filled_slot';
      number: number;
      selectedOption: string;
      answerSource: AnswerSource;
      en: string;
      zh: string;
    };

export interface NewTypeSection extends BaseSection {
  type: 'new_type';
  subType: 'seven_choose_five' | 'ordering' | 'heading_matching';
  blocks: NewTypeBlock[];
  optionBank: Array<{
    label: string;
    en: string;
    zh: string;
    usedInSlot: number | null;
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

export interface GeneralSection extends BaseSection {
  type: 'general';
  paragraphs: BilingualParagraph[];
}

export type ExamSection =
  | ClozeSection
  | ReadingSection
  | NewTypeSection
  | TranslationSection
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

export interface VocabEntry {
  id: string;
  lemma: string;
  surfaceForms: string[];
  phoneticUk: string;
  phoneticUs: string;
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
  sourceMode: 'text' | 'image';
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
