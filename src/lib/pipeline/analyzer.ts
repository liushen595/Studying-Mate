import {
  LLMRequestError,
  type ExecutionStepState,
  type ImageAttachment,
  type LLMErrorDetail,
  type ProviderProfile,
} from '../../types/llm';
import type {
  ExamPaper,
  ExamSection,
  VocabEntry,
  VocabExtractDensity,
  VocabExtractMode,
} from '../../types/exam';
import { callLLM } from '../llm/adapters';
import { parseAndValidateJson } from '../llm/json-recovery';
import { buildOcrUserPrompt, OCR_SYSTEM_PROMPT } from '../prompts/ocr';
import {
  AiSplitResponseZod,
  buildAiPaperSplitPrompt,
  buildSectionPrompt,
  ClozeResponseZod,
  GeneralResponseZod,
  NewTypeResponseZod,
  ReadingResponseZod,
  TranslationResponseZod,
  WritingResponseZod,
  type PromptParsingMode,
} from '../prompts/sections';
import {
  AutoVocabExtractResponseZod,
  buildAutoVocabDiscoveryPrompt,
  buildVocabBatchPrompt,
  VocabBatchResponseZod,
  type ExtractedVocabItem,
} from '../prompts/vocab';
import { packOcrImageBatches } from './image-prep';
import {
  buildLineNumberedText,
  extractNamedVocabOccurrences,
  extractVocabWithContext,
  injectVocabMarkersIntoSection,
  listMarkedVocabTokens,
  sliceTextByLineRanges,
  splitPaperIntoSections,
  stripExplicitMarkerLine,
  type ParsedSectionDraft,
} from './pre-parser';
import { db } from '../db';
import { useTaskStore } from '../../stores/useTaskStore';

/**
 * Stage 1: OCR-Only Pipeline (Images -> Marked Text with {{vocab}}, <u>...</u>, & [ANSWER: ...])
 */
export async function runOcrStage(params: {
  visionProvider: ProviderProfile;
  images: ImageAttachment[];
  batchSize?: number;
  pageOffset?: number;
  totalPageCount?: number;
}): Promise<string> {
  const { visionProvider, images } = params;
  const batchSize = Math.max(1, params.batchSize ?? 2);
  const pageOffset = params.pageOffset ?? 0;
  const totalPageCount = params.totalPageCount ?? pageOffset + images.length;
  const batches = packOcrImageBatches(images, batchSize);

  const batchRanges: Array<{ startPage: number; endPage: number }> = [];
  let pageCursor = pageOffset + 1;
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
        images.length === 1 && pageOffset === 0
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
        userPrompt: buildOcrUserPrompt(startPage, endPage, totalPageCount),
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

/**
 * Standalone AI smart paper splitter (Prompt Set B-1) so users can inspect or run AI segmentation
 * without relying on local heuristic pre-parsing.
 */
export async function runAiPaperSplitPreview(params: {
  provider: ProviderProfile;
  rawText: string;
}): Promise<{ drafts: ParsedSectionDraft[]; tokens: number }> {
  const { provider, rawText } = params;
  const stepId = 'ai-split-preview';
  const controller = useTaskStore
    .getState()
    .startTask(`AI 智能题型切分（${provider.modelId}）`, [
      {
        id: stepId,
        label: '通读整卷并标注标准考研题型标签',
        kind: 'split',
        status: 'thinking',
        startedAt: Date.now(),
        thinkingText: '',
        contentPreview: '',
      },
    ]);

  try {
    const { numberedText } = buildLineNumberedText(rawText);
    const { systemPrompt, userPrompt } = buildAiPaperSplitPrompt(numberedText);
    const res = await callLLM(provider, {
      systemPrompt,
      userPrompt,
      expectJson: true,
      signal: controller.signal,
      onFirstToken: (ttftMs) => useTaskStore.getState().updateStep(stepId, { ttftMs }),
      onThinkingDelta: (_d, full) => useTaskStore.getState().appendStepThinking(stepId, full),
      onContentDelta: (_d, full) => useTaskStore.getState().appendStepContent(stepId, full),
    });

    const parsed = parseAndValidateJson(res.content, AiSplitResponseZod, {
      endpoint: res.endpoint,
      modelId: res.modelId,
    });
    const drafts = sliceTextByLineRanges(rawText, parsed.segments);

    useTaskStore.getState().updateStep(stepId, {
      status: 'done',
      finishedAt: Date.now(),
      usage: res.usage,
      detailNote: `识别出 ${drafts.length} 个题型模块`,
    });
    useTaskStore.getState().finishTask(null);
    return { drafts, tokens: res.usage.totalTokens || 0 };
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

async function analyzeSingleSection(
  provider: ProviderProfile,
  draft: ParsedSectionDraft,
  stepId: string,
  signal: AbortSignal,
  parsingMode: PromptParsingMode = 'pre_parsed',
): Promise<{ section: ExamSection; tokens: number }> {
  const cleanRawText = stripExplicitMarkerLine(draft.rawText);
  const { systemPrompt, userPrompt } = buildSectionPrompt(
    draft.type,
    draft.title,
    cleanRawText,
    parsingMode,
  );

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
      title: draft.title || data.title || 'Section I Use of English',
      rawText: cleanRawText,
      status: 'done',
      paragraphs: data.paragraphs,
      blanks: data.blanks,
    };
  } else if (draft.type === 'reading') {
    const data = parseAndValidateJson(res.content, ReadingResponseZod, ctx);
    section = {
      id: draft.id,
      type: 'reading',
      title: draft.title || data.title || 'Text1',
      rawText: cleanRawText,
      status: 'done',
      paragraphs: data.paragraphs,
      questions: data.questions,
    };
  } else if (draft.type === 'new_type') {
    const data = parseAndValidateJson(res.content, NewTypeResponseZod, ctx);
    section = {
      id: draft.id,
      type: 'new_type',
      title: draft.title || data.title || 'Section II·Part B',
      rawText: cleanRawText,
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
      title: draft.title || data.title || 'Section II·Part C Translation',
      rawText: cleanRawText,
      status: 'done',
      contextPassage: data.contextPassage,
      items: data.items,
    };
  } else if (draft.type === 'writing') {
    const data = parseAndValidateJson(res.content, WritingResponseZod, ctx);
    section = {
      id: draft.id,
      type: 'writing',
      title: draft.title || data.title || 'Section III·Writing',
      rawText: cleanRawText,
      status: 'done',
      tasks: data.tasks,
    };
  } else {
    const data = parseAndValidateJson(res.content, GeneralResponseZod, ctx);
    section = {
      id: draft.id,
      type: 'general',
      title: draft.title || data.title || '通用精读',
      rawText: cleanRawText,
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

function buildPendingSkeleton(d: ParsedSectionDraft): ExamSection {
  const cleanRaw = stripExplicitMarkerLine(d.rawText);
  if (d.type === 'cloze') {
    return { id: d.id, type: 'cloze', title: d.title, rawText: cleanRaw, status: 'pending', paragraphs: [], blanks: [] };
  }
  if (d.type === 'reading') {
    return { id: d.id, type: 'reading', title: d.title, rawText: cleanRaw, status: 'pending', paragraphs: [], questions: [] };
  }
  if (d.type === 'new_type') {
    return { id: d.id, type: 'new_type', title: d.title, rawText: cleanRaw, status: 'pending', subType: 'seven_choose_five', blocks: [], optionBank: [] };
  }
  if (d.type === 'translation') {
    return { id: d.id, type: 'translation', title: d.title, rawText: cleanRaw, status: 'pending', items: [] };
  }
  if (d.type === 'writing') {
    return { id: d.id, type: 'writing', title: d.title, rawText: cleanRaw, status: 'pending', tasks: [] };
  }
  return { id: d.id, type: 'general', title: d.title, rawText: cleanRaw, status: 'pending', paragraphs: [] };
}

/**
 * Matches an existing completed ExamSection against a draft to reuse it during incremental analysis.
 */
export function findMatchingExistingSection(
  existingSections: ExamSection[] | undefined,
  draft: ParsedSectionDraft,
): ExamSection | undefined {
  if (!existingSections || existingSections.length === 0) return undefined;
  const cleanDraftRaw = stripExplicitMarkerLine(draft.rawText);

  // 1. Exact id + type match
  const byId = existingSections.find((s) => s.id === draft.id && s.type === draft.type);
  if (byId) return byId;

  // 2. Exact normalized rawText + type match
  const byRaw = existingSections.find(
    (s) => s.type === draft.type && (s.rawText || '').trim() === cleanDraftRaw,
  );
  if (byRaw) return byRaw;

  // 3. Exact title + type match
  return existingSections.find(
    (s) => s.type === draft.type && s.title.trim().toLowerCase() === draft.title.trim().toLowerCase(),
  );
}

/**
 * Stage 2: Full OR Incremental Analysis Pipeline (Sections + Comprehensive Vocabulary Lexicon).
 * Automatically drops persisted image blobs since OCR text is now stored in `rawMarkedText`.
 */
export async function runPaperAnalysisPipeline(params: {
  paperId?: string;
  existingPaper?: ExamPaper;
  title: string;
  examType: ExamPaper['examType'];
  sourceMode: ExamPaper['sourceMode'];
  parsingMode?: PromptParsingMode;
  vocabExtractMode?: VocabExtractMode;
  vocabExtractDensity?: VocabExtractDensity;
  rawMarkedText: string;
  sectionsDraft: ParsedSectionDraft[];
  selectedDraftIds?: Set<string>;
  provider: ProviderProfile;
  ocrModelId?: string;
  concurrency?: number;
}): Promise<ExamPaper> {
  const {
    existingPaper,
    title,
    examType,
    sourceMode,
    parsingMode = 'pre_parsed',
    vocabExtractMode = 'manual_only',
    vocabExtractDensity = 'balanced',
    rawMarkedText,
    provider,
    ocrModelId,
    selectedDraftIds,
  } = params;
  const concurrency = Math.max(1, Math.min(4, params.concurrency ?? 2));
  const paperId = params.paperId || existingPaper?.id || `paper-${crypto.randomUUID().slice(0, 10)}`;
  const now = Date.now();

  let sectionsDraft = params.sectionsDraft;
  let totalTokens = existingPaper?.analysisMeta?.totalTokensUsed || 0;

  // Initialize task store
  const useAiSplitStep = parsingMode === 'ai_segmented' && sectionsDraft.length === 0;
  const splitStepId = 'ai-split-step';

  const initialSteps: ExecutionStepState[] = useAiSplitStep
    ? [
        {
          id: splitStepId,
          label: 'AI 智能题型切分与标准标签识别（跳过本地预解析）',
          kind: 'split',
          status: 'pending',
          thinkingText: '',
          contentPreview: '',
        },
      ]
    : [];

  const controller = useTaskStore
    .getState()
    .startTask(
      `Stage 2 · ${selectedDraftIds ? '增量' : '全卷'}深度解析（${provider.modelId}）`,
      initialSteps,
    );

  try {
    // If AI segmentation mode is chosen without pre-sliced drafts, run Prompt Set B-1 first
    if (useAiSplitStep) {
      useTaskStore.getState().updateStep(splitStepId, {
        status: 'thinking',
        startedAt: Date.now(),
      });
      const { numberedText } = buildLineNumberedText(rawMarkedText);
      const { systemPrompt, userPrompt } = buildAiPaperSplitPrompt(numberedText);
      const splitRes = await callLLM(provider, {
        systemPrompt,
        userPrompt,
        expectJson: true,
        signal: controller.signal,
        onFirstToken: (ttftMs) => useTaskStore.getState().updateStep(splitStepId, { ttftMs }),
        onThinkingDelta: (_d, full) => useTaskStore.getState().appendStepThinking(splitStepId, full),
        onContentDelta: (_d, full) => useTaskStore.getState().appendStepContent(splitStepId, full),
      });
      const splitData = parseAndValidateJson(splitRes.content, AiSplitResponseZod, {
        endpoint: splitRes.endpoint,
        modelId: splitRes.modelId,
      });
      sectionsDraft = sliceTextByLineRanges(rawMarkedText, splitData.segments);
      if (sectionsDraft.length === 0) {
        sectionsDraft = splitPaperIntoSections(rawMarkedText);
      }
      totalTokens += splitRes.usage.totalTokens || 0;
      useTaskStore.getState().updateStep(splitStepId, {
        status: 'done',
        finishedAt: Date.now(),
        usage: splitRes.usage,
        detailNote: `切分出 ${sectionsDraft.length} 个模块`,
      });
    }

    // Determine which sections to analyze vs reuse (incremental logic)
    const isIncremental = Boolean(existingPaper && selectedDraftIds);
    const targetDrafts: Array<{ draft: ParsedSectionDraft; targetIndex: number }> = [];
    const workingSections: ExamSection[] = sectionsDraft.map((d, idx) => {
      const shouldAnalyze = !selectedDraftIds || selectedDraftIds.has(d.id);
      if (!shouldAnalyze && existingPaper) {
        const matched = findMatchingExistingSection(existingPaper.sections, d);
        if (matched && matched.status === 'done') {
          return {
            ...matched,
            id: d.id,
            title: d.title,
            rawText: stripExplicitMarkerLine(d.rawText),
          };
        }
      }
      targetDrafts.push({ draft: d, targetIndex: idx });
      return buildPendingSkeleton(d);
    });

    // Step 0: Deterministic local {{vocab}} extraction ONLY for sections being analyzed (or all if fresh)
    const draftsForVocab = targetDrafts.map((t) => ({
      id: t.draft.id,
      title: t.draft.title,
      rawText: stripExplicitMarkerLine(t.draft.rawText),
    }));
    const userExtractedVocab = extractVocabWithContext(draftsForVocab);

    // Filter out occurrences already covered identically in retained vocabulary
    const retainedSectionIds = new Set(
      workingSections
        .filter((_, idx) => !targetDrafts.some((t) => t.targetIndex === idx))
        .map((s) => s.id),
    );

    const retainedVocab: VocabEntry[] = existingPaper
      ? existingPaper.vocabulary
          .map((entry) => ({
            ...entry,
            occurrences: entry.occurrences.filter((occ) => retainedSectionIds.has(occ.sectionId)),
          }))
          .filter((entry) => entry.occurrences.length > 0)
      : [];

    const useAiVocabAugment = vocabExtractMode === 'ai_augment';
    const aiVocabDraftTargets = useAiVocabAugment
      ? targetDrafts.filter(({ draft }) => stripExplicitMarkerLine(draft.rawText).length >= 40)
      : [];

    // Append execution steps to timeline (vocab dictionary batch steps are appended after discovery)
    const pipelineSteps: ExecutionStepState[] = [
      {
        id: 'local-preparse',
        label: isIncremental
          ? `增量规划：重析/新增 ${targetDrafts.length} 个模块（复用 ${sectionsDraft.length - targetDrafts.length} 个），手标 ${userExtractedVocab.length} 词${useAiVocabAugment ? ' + AI 自动补充生词' : ''}`
          : `分段就绪：共 ${sectionsDraft.length} 个题型模块，手标 ${userExtractedVocab.length} 个 {{生词}}${useAiVocabAugment ? ' + 开启 AI 自动总结/补充生词' : ''}`,
        kind: 'local',
        status: 'done',
        startedAt: Date.now(),
        finishedAt: Date.now(),
        thinkingText: '',
        contentPreview: '',
      },
      ...targetDrafts.map(({ draft }) => ({
        id: `sec-step-${draft.id}`,
        label: `精读解析 · ${draft.title}`,
        kind: 'section' as const,
        status: 'pending' as const,
        thinkingText: '',
        contentPreview: '',
      })),
      ...aiVocabDraftTargets.map(({ draft }) => ({
        id: `ai-vocab-discover-${draft.id}`,
        label: `AI 自动总结/补充生词 · ${draft.title}`,
        kind: 'vocab' as const,
        status: 'pending' as const,
        thinkingText: '',
        contentPreview: '',
      })),
    ];
    useTaskStore.getState().appendSteps(pipelineSteps);

    const paper: ExamPaper = {
      id: paperId,
      title: title.trim() || existingPaper?.title || '未命名考研英语试卷',
      examType,
      createdAt: existingPaper?.createdAt || now,
      updatedAt: now,
      status: 'analyzing',
      sourceMode,
      parsingMode,
      vocabExtractMode,
      rawMarkedText,
      sourceImageIds: undefined, // Images are discarded after OCR and not persisted
      sections: workingSections,
      vocabulary: retainedVocab,
      analysisMeta: {
        providerName: provider.name,
        modelId: provider.modelId,
        ocrModelId: ocrModelId || existingPaper?.analysisMeta?.ocrModelId,
        totalTokensUsed: totalTokens,
      },
    };

    // Persist paper and drop any legacy persisted images for this paper
    await db.transaction('rw', db.papers, db.images, async () => {
      await db.images.where('paperId').equals(paperId).delete();
      await db.papers.put(paper);
    });

    let hasErrors = false;
    let lastError: LLMErrorDetail | null = null;

    const runWithConcurrency = async <T,>(
      items: T[],
      worker: (item: T, idx: number) => Promise<void>,
    ) => {
      if (items.length === 0) return;
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

    // Step 1: Analyze target sections
    await runWithConcurrency(targetDrafts, async ({ draft, targetIndex }) => {
      const stepId = `sec-step-${draft.id}`;
      try {
        const { section, tokens } = await analyzeSingleSection(
          provider,
          draft,
          stepId,
          controller.signal,
          parsingMode,
        );
        totalTokens += tokens;
        paper.sections[targetIndex] = section;
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
        paper.sections[targetIndex] = {
          ...paper.sections[targetIndex],
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

    // Step 1.5 (Optional): AI Auto-Summarize / Augment Vocabulary on top of user-marked words
    const aiDiscoveredVocabItems: ExtractedVocabItem[] = [];
    const existingUserVocabKeys = new Set<string>(userExtractedVocab.map((v) => v.key));

    if (aiVocabDraftTargets.length > 0 && !controller.signal.aborted) {
      await runWithConcurrency(aiVocabDraftTargets, async ({ draft, targetIndex }) => {
        const stepId = `ai-vocab-discover-${draft.id}`;
        try {
          useTaskStore.getState().updateStep(stepId, {
            status: 'thinking',
            startedAt: Date.now(),
          });
          const cleanRaw = stripExplicitMarkerLine(draft.rawText);
          const userWordsInSection = listMarkedVocabTokens(cleanRaw);
          const { systemPrompt, userPrompt } = buildAutoVocabDiscoveryPrompt({
            sectionTitle: draft.title,
            sectionType: draft.type,
            rawText: cleanRaw,
            userMarkedWords: userWordsInSection,
            density: vocabExtractDensity,
          });
          const res = await callLLM(provider, {
            systemPrompt,
            userPrompt,
            expectJson: true,
            signal: controller.signal,
            onFirstToken: (ttftMs) => useTaskStore.getState().updateStep(stepId, { ttftMs }),
            onThinkingDelta: (_d, full) => useTaskStore.getState().appendStepThinking(stepId, full),
            onContentDelta: (_d, full) => useTaskStore.getState().appendStepContent(stepId, full),
          });
          const parsed = parseAndValidateJson(res.content, AutoVocabExtractResponseZod, {
            endpoint: res.endpoint,
            modelId: res.modelId,
          });
          totalTokens += res.usage.totalTokens || 0;

          const { items, matchedForms } = extractNamedVocabOccurrences(
            { id: draft.id, title: draft.title, rawText: cleanRaw },
            parsed.words,
            existingUserVocabKeys,
          );
          aiDiscoveredVocabItems.push(...items);

          // Inject {{...}} markers into the rendered section text so AI-added words are clickable in Reading View
          if (matchedForms.length > 0 && paper.sections[targetIndex]?.status === 'done') {
            paper.sections[targetIndex] = injectVocabMarkersIntoSection(
              paper.sections[targetIndex],
              matchedForms,
            );
            paper.updatedAt = Date.now();
            if (paper.analysisMeta) paper.analysisMeta.totalTokensUsed = totalTokens;
            await db.papers.put({ ...paper, sections: [...paper.sections] });
          }

          useTaskStore.getState().updateStep(stepId, {
            status: 'done',
            finishedAt: Date.now(),
            usage: res.usage,
            detailNote: `补充 ${items.length} 个考研核心词`,
          });
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
    }

    // Merge user-marked + AI-discovered vocabulary items (deduplicated; 'user' always wins)
    const combinedExtractedVocab = combineExtractedVocabItems([
      ...userExtractedVocab,
      ...aiDiscoveredVocabItems,
    ]);
    const vocabSourceLookup = buildVocabSourceLookup(combinedExtractedVocab);

    const vocabBatchSize = 18;
    const vocabBatches: ExtractedVocabItem[][] = [];
    for (let i = 0; i < combinedExtractedVocab.length; i += vocabBatchSize) {
      vocabBatches.push(combinedExtractedVocab.slice(i, i + vocabBatchSize));
    }

    if (vocabBatches.length > 0) {
      useTaskStore.getState().appendSteps(
        vocabBatches.map((batch, idx) => ({
          id: `vocab-step-${idx}`,
          label: `${isIncremental ? '增量' : ''}生词词典生成 · 第 ${idx + 1}/${vocabBatches.length} 批（${batch.length} 词）`,
          kind: 'vocab' as const,
          status: 'pending' as const,
          thinkingText: '',
          contentPreview: '',
        })),
      );
    }

    // Step 2: Generate comprehensive vocabulary lexicon in batches and merge with retainedVocab
    const newVocabEntries: VocabEntry[] = [];
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
        const taggedEntries: VocabEntry[] = parsed.entries.map((entry) => ({
          ...entry,
          source: resolveVocabEntrySource(entry, vocabSourceLookup),
        }));
        newVocabEntries.push(...taggedEntries);
        paper.vocabulary = mergeVocabEntries([...retainedVocab, ...newVocabEntries]);
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

    const anySectionError = paper.sections.some((s) => s.status === 'error');
    paper.status = hasErrors || anySectionError ? 'partial_error' : 'completed';
    paper.updatedAt = Date.now();
    await db.papers.put(paper);
    useTaskStore.getState().finishTask(hasErrors ? lastError : null);
    return paper;
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
    useTaskStore.getState().updateStep(splitStepId, {
      status: 'error',
      finishedAt: Date.now(),
      error: detail,
    });
    useTaskStore.getState().finishTask(detail);
    throw err;
  }
}

/**
 * Re-analyze ANY single section (whether previously 'error', 'pending', or 'done'!).
 * Always reads the latest paper from IndexedDB and resolves against the latest edited `rawMarkedText`
 * so edits in the unified editor are never ignored!
 */
export async function retrySingleSection(
  paper: ExamPaper,
  sectionId: string,
  provider: ProviderProfile,
  overrideRawText?: string,
  options?: {
    vocabExtractMode?: VocabExtractMode;
    vocabExtractDensity?: VocabExtractDensity;
  },
): Promise<ExamPaper> {
  const latestPaper = (await db.papers.get(paper.id)) || paper;
  const idx = latestPaper.sections.findIndex((s) => s.id === sectionId);
  if (idx === -1) throw new Error('未找到对应题型分段');
  const sec = latestPaper.sections[idx];

  // Resolve latest rawText: explicit override > latest rawMarkedText slice > section.rawText
  let effectiveRawText = overrideRawText?.trim() || '';
  if (!effectiveRawText && latestPaper.rawMarkedText) {
    const draftsFromRaw = splitPaperIntoSections(latestPaper.rawMarkedText);
    const matchedDraft = draftsFromRaw.find(
      (d) =>
        d.id === sec.id ||
        (d.type === sec.type && d.title.trim().toLowerCase() === sec.title.trim().toLowerCase()),
    );
    if (matchedDraft) {
      effectiveRawText = stripExplicitMarkerLine(matchedDraft.rawText);
    }
  }
  if (!effectiveRawText) {
    effectiveRawText = stripExplicitMarkerLine(sec.rawText || '');
  }
  if (!effectiveRawText) throw new Error('该分段缺少原始文本，无法重新解析');

  const draft: ParsedSectionDraft = {
    id: sec.id,
    title: sec.title,
    type: sec.type,
    rawText: effectiveRawText,
    vocabCount: 0,
  };

  const effectiveVocabMode: VocabExtractMode =
    options?.vocabExtractMode || latestPaper.vocabExtractMode || 'manual_only';
  const effectiveDensity: VocabExtractDensity = options?.vocabExtractDensity || 'balanced';
  const useAiVocab = effectiveVocabMode === 'ai_augment' && effectiveRawText.length >= 40;

  const userExtractedVocab = extractVocabWithContext([
    { id: draft.id, title: draft.title, rawText: effectiveRawText },
  ]);

  const stepId = `retry-${sectionId}`;
  const discoverStepId = `retry-ai-vocab-${sectionId}`;
  const initialSteps: ExecutionStepState[] = [
    {
      id: stepId,
      label: `重新解析 · ${sec.title}`,
      kind: 'section',
      status: 'pending',
      thinkingText: '',
      contentPreview: '',
    },
    ...(useAiVocab
      ? [
          {
            id: discoverStepId,
            label: `AI 自动总结/补充生词 · ${sec.title}`,
            kind: 'vocab' as const,
            status: 'pending' as const,
            thinkingText: '',
            contentPreview: '',
          },
        ]
      : []),
  ];

  const controller = useTaskStore
    .getState()
    .startTask(`单段重新解析 · ${sec.title}`, initialSteps);

  try {
    let { section, tokens } = await analyzeSingleSection(
      provider,
      draft,
      stepId,
      controller.signal,
      latestPaper.parsingMode || 'pre_parsed',
    );

    let totalNewTokens = tokens;
    let updatedVocabulary = latestPaper.vocabulary.map((entry) => ({
      ...entry,
      occurrences: entry.occurrences.filter((o) => o.sectionId !== sec.id),
    })).filter((entry) => entry.occurrences.length > 0);

    let aiItems: ExtractedVocabItem[] = [];
    if (useAiVocab) {
      useTaskStore.getState().updateStep(discoverStepId, {
        status: 'thinking',
        startedAt: Date.now(),
      });
      const { systemPrompt, userPrompt } = buildAutoVocabDiscoveryPrompt({
        sectionTitle: draft.title,
        sectionType: draft.type,
        rawText: effectiveRawText,
        userMarkedWords: listMarkedVocabTokens(effectiveRawText),
        density: effectiveDensity,
      });
      const discRes = await callLLM(provider, {
        systemPrompt,
        userPrompt,
        expectJson: true,
        signal: controller.signal,
        onFirstToken: (ttftMs) => useTaskStore.getState().updateStep(discoverStepId, { ttftMs }),
        onThinkingDelta: (_d, full) => useTaskStore.getState().appendStepThinking(discoverStepId, full),
        onContentDelta: (_d, full) => useTaskStore.getState().appendStepContent(discoverStepId, full),
      });
      const discParsed = parseAndValidateJson(discRes.content, AutoVocabExtractResponseZod, {
        endpoint: discRes.endpoint,
        modelId: discRes.modelId,
      });
      totalNewTokens += discRes.usage.totalTokens || 0;
      const { items, matchedForms } = extractNamedVocabOccurrences(
        { id: draft.id, title: draft.title, rawText: effectiveRawText },
        discParsed.words,
        new Set(userExtractedVocab.map((v) => v.key)),
      );
      aiItems = items;
      if (matchedForms.length > 0) {
        section = injectVocabMarkersIntoSection(section, matchedForms);
      }
      useTaskStore.getState().updateStep(discoverStepId, {
        status: 'done',
        finishedAt: Date.now(),
        usage: discRes.usage,
        detailNote: `补充 ${items.length} 词`,
      });
    }

    const combinedVocab = combineExtractedVocabItems([...userExtractedVocab, ...aiItems]);
    const vocabSourceLookup = buildVocabSourceLookup(combinedVocab);

    if (combinedVocab.length > 0) {
      const vocabStepId = `retry-vocab-${sectionId}`;
      useTaskStore.getState().appendSteps([
        {
          id: vocabStepId,
          label: `增量更新本段生词（${combinedVocab.length} 词）`,
          kind: 'vocab',
          status: 'thinking',
          startedAt: Date.now(),
          thinkingText: '',
          contentPreview: '',
        },
      ]);
      const { systemPrompt, userPrompt } = buildVocabBatchPrompt(combinedVocab);
      const vocabRes = await callLLM(provider, {
        systemPrompt,
        userPrompt,
        expectJson: true,
        signal: controller.signal,
        onFirstToken: (ttftMs) => useTaskStore.getState().updateStep(vocabStepId, { ttftMs }),
        onThinkingDelta: (_d, full) => useTaskStore.getState().appendStepThinking(vocabStepId, full),
        onContentDelta: (_d, full) => useTaskStore.getState().appendStepContent(vocabStepId, full),
      });
      const parsedVocab = parseAndValidateJson(vocabRes.content, VocabBatchResponseZod, {
        endpoint: vocabRes.endpoint,
        modelId: vocabRes.modelId,
      });
      totalNewTokens += vocabRes.usage.totalTokens || 0;
      const taggedEntries: VocabEntry[] = parsedVocab.entries.map((entry) => ({
        ...entry,
        source: resolveVocabEntrySource(entry, vocabSourceLookup),
      }));
      updatedVocabulary = mergeVocabEntries([...updatedVocabulary, ...taggedEntries]);
      useTaskStore.getState().updateStep(vocabStepId, {
        status: 'done',
        finishedAt: Date.now(),
        usage: vocabRes.usage,
      });
    }

    const updatedSections = [...latestPaper.sections];
    updatedSections[idx] = section;
    const anyError = updatedSections.some((s) => s.status === 'error');
    const updated: ExamPaper = {
      ...latestPaper,
      sections: updatedSections,
      vocabulary: updatedVocabulary,
      status: anyError ? 'partial_error' : 'completed',
      updatedAt: Date.now(),
      analysisMeta: {
        providerName: provider.name,
        modelId: provider.modelId,
        ocrModelId: latestPaper.analysisMeta?.ocrModelId,
        totalTokensUsed: (latestPaper.analysisMeta?.totalTokensUsed || 0) + totalNewTokens,
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
    const steps = useTaskStore.getState().steps;
    const runningStep = steps.find((s) => s.status === 'thinking' || s.status === 'streaming') || steps[0];
    if (runningStep) {
      useTaskStore.getState().updateStep(runningStep.id, {
        status: 'error',
        finishedAt: Date.now(),
        error: detail,
      });
    }
    useTaskStore.getState().finishTask(detail);
    throw err;
  }
}

function combineExtractedVocabItems(items: ExtractedVocabItem[]): ExtractedVocabItem[] {
  const map = new Map<string, ExtractedVocabItem>();
  for (const item of items) {
    const existing = map.get(item.key);
    if (!existing) {
      map.set(item.key, {
        ...item,
        surfaceForms: [...item.surfaceForms],
        occurrences: [...item.occurrences],
      });
    } else {
      if (item.source === 'user') existing.source = 'user';
      existing.surfaceForms = Array.from(new Set([...existing.surfaceForms, ...item.surfaceForms]));
      for (const occ of item.occurrences) {
        const dup = existing.occurrences.some(
          (o) =>
            o.sectionId === occ.sectionId &&
            o.surfaceForm.toLowerCase() === occ.surfaceForm.toLowerCase() &&
            o.sentenceEn === occ.sentenceEn,
        );
        if (!dup) existing.occurrences.push(occ);
      }
    }
  }
  return Array.from(map.values());
}

function buildVocabSourceLookup(items: ExtractedVocabItem[]): Map<string, 'user' | 'ai'> {
  const map = new Map<string, 'user' | 'ai'>();
  const put = (raw: string, src: 'user' | 'ai') => {
    const k = raw.toLowerCase().trim();
    if (!k) return;
    if (map.get(k) === 'user') return; // user always takes precedence
    map.set(k, src);
  };
  for (const item of items) {
    put(item.key, item.source);
    for (const f of item.surfaceForms) put(f, item.source);
  }
  return map;
}

function resolveVocabEntrySource(
  entry: Pick<VocabEntry, 'id' | 'lemma' | 'surfaceForms'>,
  lookup: Map<string, 'user' | 'ai'>,
): 'user' | 'ai' {
  const keys = [entry.id, entry.lemma, ...entry.surfaceForms]
    .map((k) => k?.toLowerCase().trim())
    .filter(Boolean) as string[];
  if (keys.some((k) => lookup.get(k) === 'user')) return 'user';
  if (keys.some((k) => lookup.get(k) === 'ai')) return 'ai';
  return 'user';
}

function mergeVocabEntries(entries: VocabEntry[]): VocabEntry[] {
  const byLemma = new Map<string, VocabEntry>();
  for (const entry of entries) {
    const key = (entry.lemma || entry.id).toLowerCase().trim();
    const existing = byLemma.get(key);
    if (!existing) {
      const dedupOccs = deduplicateOccurrences(entry.occurrences);
      byLemma.set(key, {
        ...entry,
        surfaceForms: Array.from(new Set([entry.lemma, ...entry.surfaceForms].filter(Boolean))),
        occurrences: dedupOccs,
      });
    } else {
      existing.surfaceForms = Array.from(
        new Set([...existing.surfaceForms, ...entry.surfaceForms, entry.lemma].filter(Boolean)),
      );
      existing.occurrences = deduplicateOccurrences([...existing.occurrences, ...entry.occurrences]);
      if (entry.source === 'user' || existing.source === 'user') {
        existing.source = 'user';
      } else if (entry.source === 'ai') {
        existing.source = 'ai';
      }
      if ((!existing.comprehensiveMeanings || existing.comprehensiveMeanings.length === 0) && entry.comprehensiveMeanings?.length) {
        existing.comprehensiveMeanings = entry.comprehensiveMeanings;
      }
      if ((!existing.collocations || existing.collocations.length === 0) && entry.collocations?.length) {
        existing.collocations = entry.collocations;
      }
    }
  }
  return Array.from(byLemma.values());
}

function deduplicateOccurrences(occurrences: VocabEntry['occurrences']): VocabEntry['occurrences'] {
  const seen = new Set<string>();
  const out: VocabEntry['occurrences'] = [];
  for (const occ of occurrences) {
    const sig = `${occ.sectionId}|${occ.surfaceForm.toLowerCase()}|${occ.sentenceEn}`;
    if (!seen.has(sig)) {
      seen.add(sig);
      out.push(occ);
    }
  }
  return out;
}
