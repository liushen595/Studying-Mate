import {
  LLMRequestError,
  type ExecutionStepState,
  type ImageAttachment,
  type LLMErrorDetail,
  type ProviderProfile,
} from '../../types/llm';
import type { ExamPaper, ExamSection, VocabEntry } from '../../types/exam';
import { callLLM } from '../llm/adapters';
import { parseAndValidateJson } from '../llm/json-recovery';
import { buildOcrUserPrompt, OCR_SYSTEM_PROMPT } from '../prompts/ocr';
import {
  buildSectionPrompt,
  ClozeResponseZod,
  GeneralResponseZod,
  NewTypeResponseZod,
  ReadingResponseZod,
  TranslationResponseZod,
  WritingResponseZod,
} from '../prompts/sections';
import { buildVocabBatchPrompt, VocabBatchResponseZod } from '../prompts/vocab';
import { packOcrImageBatches } from './image-prep';
import { extractVocabWithContext, type ParsedSectionDraft } from './pre-parser';
import { db } from '../db';
import { useTaskStore } from '../../stores/useTaskStore';

/**
 * Stage 1: OCR-Only Pipeline (Images -> Marked Text with {{vocab}} & [ANSWER: ...])
 */
export async function runOcrStage(params: {
  visionProvider: ProviderProfile;
  images: ImageAttachment[];
  batchSize?: number;
}): Promise<string> {
  const { visionProvider, images } = params;
  const batchSize = Math.max(1, params.batchSize ?? 2);
  const batches = packOcrImageBatches(images, batchSize);

  const batchRanges: Array<{ startPage: number; endPage: number }> = [];
  let pageCursor = 1;
  for (const batch of batches) {
    const startPage = pageCursor;
    const endPage = pageCursor + batch.length - 1;
    batchRanges.push({ startPage, endPage });
    pageCursor = endPage + 1;
  }

  const taskStore = useTaskStore.getState();
  const initialSteps: ExecutionStepState[] = batches.map((_, idx) => {
    const { startPage, endPage } = batchRanges[idx];
    return {
      id: `ocr-${idx}`,
      label:
        images.length === 1
          ? '视觉 OCR 识图与红框生词提取'
          : `视觉 OCR 第 ${startPage}${endPage > startPage ? `–${endPage}` : ''} 页`,
      kind: 'ocr',
      status: 'pending',
      thinkingText: '',
      contentPreview: '',
    };
  });

  const controller = taskStore.startTask(
    `Stage 1 · 视觉 OCR（${visionProvider.modelId}）`,
    initialSteps,
  );

  const outputs: string[] = [];

  try {
    for (let i = 0; i < batches.length; i++) {
      const stepId = `ocr-${i}`;
      const { startPage, endPage } = batchRanges[i];

      useTaskStore.getState().updateStep(stepId, {
        status: 'thinking',
        startedAt: Date.now(),
      });

      const res = await callLLM(visionProvider, {
        systemPrompt: OCR_SYSTEM_PROMPT,
        userPrompt: buildOcrUserPrompt(startPage, endPage, images.length),
        images: batches[i],
        expectJson: false,
        signal: controller.signal,
        onFirstToken: (ttftMs) =>
          useTaskStore.getState().updateStep(stepId, { ttftMs }),
        onThinkingDelta: (_d, full) =>
          useTaskStore.getState().appendStepThinking(stepId, full),
        onContentDelta: (_d, full) =>
          useTaskStore.getState().appendStepContent(stepId, full),
      });

      outputs.push(res.content.trim());
      useTaskStore.getState().updateStep(stepId, {
        status: 'done',
        finishedAt: Date.now(),
        usage: res.usage,
      });
    }

    useTaskStore.getState().finishTask(null);
    return outputs.join('\n\n');
  } catch (err) {
    const detail: LLMErrorDetail =
      err instanceof LLMRequestError
        ? err.detail
        : {
            kind: 'validation',
            message: err instanceof Error ? err.message : String(err),
            endpoint: visionProvider.baseUrl,
            modelId: visionProvider.modelId,
            timestamp: Date.now(),
          };
    // Mark current running step as error
    const currentSteps = useTaskStore.getState().steps;
    const active = currentSteps.find((s) => s.status === 'thinking' || s.status === 'streaming') || currentSteps[0];
    if (active) {
      useTaskStore.getState().updateStep(active.id, {
        status: 'error',
        finishedAt: Date.now(),
        error: detail,
      });
    }
    useTaskStore.getState().finishTask(detail);
    throw err;
  }
}

async function analyzeSingleSection(
  provider: ProviderProfile,
  draft: ParsedSectionDraft,
  stepId: string,
  signal: AbortSignal,
): Promise<{ section: ExamSection; tokens: number }> {
  const { systemPrompt, userPrompt } = buildSectionPrompt(draft.type, draft.title, draft.rawText);

  useTaskStore.getState().updateStep(stepId, {
    status: 'thinking',
    startedAt: Date.now(),
  });

  const res = await callLLM(provider, {
    systemPrompt,
    userPrompt,
    expectJson: true,
    signal,
    onFirstToken: (ttftMs) => useTaskStore.getState().updateStep(stepId, { ttftMs }),
    onThinkingDelta: (_d, full) => useTaskStore.getState().appendStepThinking(stepId, full),
    onContentDelta: (_d, full) => useTaskStore.getState().appendStepContent(stepId, full),
  });

  const ctx = { endpoint: res.endpoint, modelId: res.modelId };
  let section: ExamSection;

  if (draft.type === 'cloze') {
    const data = parseAndValidateJson(res.content, ClozeResponseZod, ctx);
    section = {
      id: draft.id,
      type: 'cloze',
      title: data.title || draft.title,
      rawText: draft.rawText,
      status: 'done',
      paragraphs: data.paragraphs,
      blanks: data.blanks,
    };
  } else if (draft.type === 'reading') {
    const data = parseAndValidateJson(res.content, ReadingResponseZod, ctx);
    section = {
      id: draft.id,
      type: 'reading',
      title: data.title || draft.title,
      rawText: draft.rawText,
      status: 'done',
      paragraphs: data.paragraphs,
      questions: data.questions,
    };
  } else if (draft.type === 'new_type') {
    const data = parseAndValidateJson(res.content, NewTypeResponseZod, ctx);
    section = {
      id: draft.id,
      type: 'new_type',
      title: data.title || draft.title,
      rawText: draft.rawText,
      status: 'done',
      subType: data.subType,
      blocks: data.blocks,
      optionBank: data.optionBank,
    };
  } else if (draft.type === 'translation') {
    const data = parseAndValidateJson(res.content, TranslationResponseZod, ctx);
    section = {
      id: draft.id,
      type: 'translation',
      title: data.title || draft.title,
      rawText: draft.rawText,
      status: 'done',
      contextPassage: data.contextPassage,
      items: data.items,
    };
  } else if (draft.type === 'writing') {
    const data = parseAndValidateJson(res.content, WritingResponseZod, ctx);
    section = {
      id: draft.id,
      type: 'writing',
      title: data.title || draft.title,
      rawText: draft.rawText,
      status: 'done',
      tasks: data.tasks,
    };
  } else {
    const data = parseAndValidateJson(res.content, GeneralResponseZod, ctx);
    section = {
      id: draft.id,
      type: 'general',
      title: data.title || draft.title,
      rawText: draft.rawText,
      status: 'done',
      paragraphs: data.paragraphs,
    };
  }

  useTaskStore.getState().updateStep(stepId, {
    status: 'done',
    finishedAt: Date.now(),
    usage: res.usage,
  });

  return { section, tokens: res.usage.totalTokens || 0 };
}

/**
 * Stage 2: Full Analysis Pipeline (Sections + Comprehensive Vocabulary Lexicon)
 */
export async function runPaperAnalysisPipeline(params: {
  paperId?: string;
  title: string;
  examType: ExamPaper['examType'];
  sourceMode: ExamPaper['sourceMode'];
  rawMarkedText: string;
  sourceImageIds?: string[];
  sectionsDraft: ParsedSectionDraft[];
  provider: ProviderProfile;
  ocrModelId?: string;
  concurrency?: number;
}): Promise<ExamPaper> {
  const {
    title,
    examType,
    sourceMode,
    rawMarkedText,
    sourceImageIds,
    sectionsDraft,
    provider,
    ocrModelId,
  } = params;
  const concurrency = Math.max(1, Math.min(4, params.concurrency ?? 2));
  const paperId = params.paperId || `paper-${crypto.randomUUID().slice(0, 10)}`;
  const now = Date.now();

  // Step 0: Deterministic local {{vocab}} extraction (zero missed words!)
  const extractedVocab = extractVocabWithContext(sectionsDraft);
  const vocabBatchSize = 18;
  const vocabBatches = [];
  for (let i = 0; i < extractedVocab.length; i += vocabBatchSize) {
    vocabBatches.push(extractedVocab.slice(i, i + vocabBatchSize));
  }

  const initialSteps: ExecutionStepState[] = [
    {
      id: 'local-preparse',
      label: `本地预解析：切分 ${sectionsDraft.length} 个题型模块，提取 ${extractedVocab.length} 个 {{生词}}`,
      kind: 'local',
      status: 'done',
      startedAt: now,
      finishedAt: now,
      thinkingText: '',
      contentPreview: '',
    },
    ...sectionsDraft.map((sec) => ({
      id: `sec-step-${sec.id}`,
      label: `精读解析 · ${sec.title}`,
      kind: 'section' as const,
      status: 'pending' as const,
      thinkingText: '',
      contentPreview: '',
    })),
    ...vocabBatches.map((batch, idx) => ({
      id: `vocab-step-${idx}`,
      label: `生词词典生成 · 第 ${idx + 1}/${vocabBatches.length} 批（${batch.length} 词）`,
      kind: 'vocab' as const,
      status: 'pending' as const,
      thinkingText: '',
      contentPreview: '',
    })),
  ];

  const controller = useTaskStore
    .getState()
    .startTask(`Stage 2 · 试卷深度解析（${provider.modelId}）`, initialSteps);

  // Create initial paper skeleton in IndexedDB so progressive updates persist immediately
  const initialSections: ExamSection[] = sectionsDraft.map((d) => {
    if (d.type === 'cloze') {
      return { id: d.id, type: 'cloze', title: d.title, rawText: d.rawText, status: 'pending', paragraphs: [], blanks: [] };
    }
    if (d.type === 'reading') {
      return { id: d.id, type: 'reading', title: d.title, rawText: d.rawText, status: 'pending', paragraphs: [], questions: [] };
    }
    if (d.type === 'new_type') {
      return { id: d.id, type: 'new_type', title: d.title, rawText: d.rawText, status: 'pending', subType: 'seven_choose_five', blocks: [], optionBank: [] };
    }
    if (d.type === 'translation') {
      return { id: d.id, type: 'translation', title: d.title, rawText: d.rawText, status: 'pending', items: [] };
    }
    if (d.type === 'writing') {
      return { id: d.id, type: 'writing', title: d.title, rawText: d.rawText, status: 'pending', tasks: [] };
    }
    return { id: d.id, type: 'general', title: d.title, rawText: d.rawText, status: 'pending', paragraphs: [] };
  });

  const paper: ExamPaper = {
    id: paperId,
    title: title.trim() || '未命名考研英语试卷',
    examType,
    createdAt: now,
    updatedAt: now,
    status: 'analyzing',
    sourceMode,
    rawMarkedText,
    sourceImageIds,
    sections: initialSections,
    vocabulary: [],
    analysisMeta: {
      providerName: provider.name,
      modelId: provider.modelId,
      ocrModelId,
      totalTokensUsed: 0,
    },
  };

  await db.papers.put(paper);

  let totalTokens = 0;
  let hasErrors = false;
  let lastError: LLMErrorDetail | null = null;

  // Bounded concurrency worker pool
  const runWithConcurrency = async <T,>(items: T[], worker: (item: T, idx: number) => Promise<void>) => {
    let cursor = 0;
    const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
      while (cursor < items.length) {
        if (controller.signal.aborted) break;
        const idx = cursor++;
        await worker(items[idx], idx);
      }
    });
    await Promise.all(runners);
  };

  // Step 1: Analyze each section
  await runWithConcurrency(sectionsDraft, async (draft, idx) => {
    const stepId = `sec-step-${draft.id}`;
    try {
      const { section, tokens } = await analyzeSingleSection(
        provider,
        draft,
        stepId,
        controller.signal,
      );
      totalTokens += tokens;
      paper.sections[idx] = section;
      paper.updatedAt = Date.now();
      if (paper.analysisMeta) paper.analysisMeta.totalTokensUsed = totalTokens;
      await db.papers.put({ ...paper, sections: [...paper.sections] });
    } catch (err) {
      hasErrors = true;
      const detail: LLMErrorDetail =
        err instanceof LLMRequestError
          ? err.detail
          : {
              kind: 'validation',
              message: err instanceof Error ? err.message : String(err),
              endpoint: provider.baseUrl,
              modelId: provider.modelId,
              timestamp: Date.now(),
            };
      lastError = detail;
      paper.sections[idx] = {
        ...paper.sections[idx],
        status: 'error',
        errorMessage: detail.message,
      };
      useTaskStore.getState().updateStep(stepId, {
        status: 'error',
        finishedAt: Date.now(),
        error: detail,
      });
      await db.papers.put({ ...paper, sections: [...paper.sections] });
    }
  });

  // Step 2: Generate comprehensive vocabulary lexicon in batches
  const allVocab: VocabEntry[] = [];
  await runWithConcurrency(vocabBatches, async (batch, idx) => {
    const stepId = `vocab-step-${idx}`;
    try {
      useTaskStore.getState().updateStep(stepId, {
        status: 'thinking',
        startedAt: Date.now(),
      });
      const { systemPrompt, userPrompt } = buildVocabBatchPrompt(batch);
      const res = await callLLM(provider, {
        systemPrompt,
        userPrompt,
        expectJson: true,
        signal: controller.signal,
        onFirstToken: (ttftMs) => useTaskStore.getState().updateStep(stepId, { ttftMs }),
        onThinkingDelta: (_d, full) => useTaskStore.getState().appendStepThinking(stepId, full),
        onContentDelta: (_d, full) => useTaskStore.getState().appendStepContent(stepId, full),
      });
      const parsed = parseAndValidateJson(res.content, VocabBatchResponseZod, {
        endpoint: res.endpoint,
        modelId: res.modelId,
      });
      totalTokens += res.usage.totalTokens || 0;
      allVocab.push(...parsed.entries);
      paper.vocabulary = mergeVocabEntries(allVocab);
      paper.updatedAt = Date.now();
      if (paper.analysisMeta) paper.analysisMeta.totalTokensUsed = totalTokens;
      useTaskStore.getState().updateStep(stepId, {
        status: 'done',
        finishedAt: Date.now(),
        usage: res.usage,
      });
      await db.papers.put({ ...paper, vocabulary: [...paper.vocabulary] });
    } catch (err) {
      hasErrors = true;
      const detail: LLMErrorDetail =
        err instanceof LLMRequestError
          ? err.detail
          : {
              kind: 'validation',
              message: err instanceof Error ? err.message : String(err),
              endpoint: provider.baseUrl,
              modelId: provider.modelId,
              timestamp: Date.now(),
            };
      lastError = detail;
      useTaskStore.getState().updateStep(stepId, {
        status: 'error',
        finishedAt: Date.now(),
        error: detail,
      });
    }
  });

  paper.status = hasErrors ? 'partial_error' : 'completed';
  paper.updatedAt = Date.now();
  await db.papers.put(paper);
  useTaskStore.getState().finishTask(hasErrors ? lastError : null);
  return paper;
}

/**
 * Retry a single failed section without re-running the whole paper!
 */
export async function retrySingleSection(
  paper: ExamPaper,
  sectionId: string,
  provider: ProviderProfile,
): Promise<ExamPaper> {
  const idx = paper.sections.findIndex((s) => s.id === sectionId);
  if (idx === -1) throw new Error('未找到对应题型分段');
  const sec = paper.sections[idx];
  if (!sec.rawText) throw new Error('该分段缺少原始文本，无法重试');

  const stepId = `retry-${sectionId}`;
  const controller = useTaskStore.getState().startTask(`单段重试 · ${sec.title}`, [
    {
      id: stepId,
      label: `重新解析 · ${sec.title}`,
      kind: 'section',
      status: 'pending',
      thinkingText: '',
      contentPreview: '',
    },
  ]);

  try {
    const { section, tokens } = await analyzeSingleSection(
      provider,
      {
        id: sec.id,
        title: sec.title,
        type: sec.type,
        rawText: sec.rawText,
        vocabCount: 0,
      },
      stepId,
      controller.signal,
    );

    const updatedSections = [...paper.sections];
    updatedSections[idx] = section;
    const anyError = updatedSections.some((s) => s.status === 'error');
    const updated: ExamPaper = {
      ...paper,
      sections: updatedSections,
      status: anyError ? 'partial_error' : 'completed',
      updatedAt: Date.now(),
      analysisMeta: {
        providerName: provider.name,
        modelId: provider.modelId,
        ocrModelId: paper.analysisMeta?.ocrModelId,
        totalTokensUsed: (paper.analysisMeta?.totalTokensUsed || 0) + tokens,
      },
    };
    await db.papers.put(updated);
    useTaskStore.getState().finishTask(null);
    return updated;
  } catch (err) {
    const detail: LLMErrorDetail =
      err instanceof LLMRequestError
        ? err.detail
        : {
            kind: 'validation',
            message: err instanceof Error ? err.message : String(err),
            endpoint: provider.baseUrl,
            modelId: provider.modelId,
            timestamp: Date.now(),
          };
    useTaskStore.getState().updateStep(stepId, {
      status: 'error',
      finishedAt: Date.now(),
      error: detail,
    });
    useTaskStore.getState().finishTask(detail);
    throw err;
  }
}

function mergeVocabEntries(entries: VocabEntry[]): VocabEntry[] {
  const byLemma = new Map<string, VocabEntry>();
  for (const entry of entries) {
    const key = (entry.lemma || entry.id).toLowerCase().trim();
    const existing = byLemma.get(key);
    if (!existing) {
      byLemma.set(key, {
        ...entry,
        surfaceForms: Array.from(new Set([entry.lemma, ...entry.surfaceForms].filter(Boolean))),
      });
    } else {
      existing.surfaceForms = Array.from(
        new Set([...existing.surfaceForms, ...entry.surfaceForms, entry.lemma].filter(Boolean)),
      );
      existing.occurrences = [...existing.occurrences, ...entry.occurrences];
    }
  }
  return Array.from(byLemma.values());
}
