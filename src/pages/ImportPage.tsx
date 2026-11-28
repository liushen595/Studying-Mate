import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Eye,
  FileText,
  GripVertical,
  Highlighter,
  Image as ImageIcon,
  Layers,
  Merge,
  RefreshCw,
  RotateCw,
  Save,
  ScanText,
  Settings,
  Sparkles,
  Trash2,
  Underline,
  Upload,
  Wand2,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import type {
  ExamPaper,
  ExamSection,
  VocabExtractDensity,
  VocabExtractMode,
} from '../types/exam';
import { useSettingsStore } from '../stores/useSettingsStore';
import { useTaskStore } from '../stores/useTaskStore';
import {
  useImportSessionStore,
  type LocalImageItem,
} from '../stores/useImportSessionStore';
import {
  CANONICAL_SECTION_PRESETS,
  estimateImageTokens,
  estimateTextTokens,
  listMarkedVocabTokens,
  lockSectionsWithExplicitMarkers,
  mergeSectionWithPreviousInRawText,
  resolveCanonicalLabelAndType,
  splitPaperIntoSections,
  stripExplicitMarkerLine,
  updateSectionMarkerInRawText,
  type ParsedSectionDraft,
} from '../lib/pipeline/pre-parser';
import {
  formatByteSize,
  preprocessExamImage,
} from '../lib/pipeline/image-prep';
import {
  findMatchingExistingSection,
  runAiPaperSplitPreview,
  runPaperAnalysisPipeline,
  savePaperDraftToDb,
} from '../lib/pipeline/analyzer';
import { executeOcrSession } from '../lib/pipeline/ocr-session';
import type { PromptParsingMode } from '../lib/prompts/sections';
import { db } from '../lib/db';
import { ExecutionTimeline } from '../components/common/ExecutionTimeline';
import { TextFormatGuide } from '../components/import/TextFormatGuide';

const SECTION_TYPE_OPTIONS: Array<{ value: ExamSection['type'] | 'auto'; label: string }> = [
  { value: 'auto', label: '自动识别并按标准标签分段' },
  { value: 'cloze', label: '整段强制为「Section I Use of English (完形)」' },
  { value: 'reading', label: '整段强制为「Text1 (传统阅读)」' },
  { value: 'new_type', label: '整段强制为「Section II·Part B (新题型)」' },
  { value: 'translation', label: '整段强制为「Section II·Part C Translation (翻译)」' },
  { value: 'writing', label: '整段强制为「Section III·Writing (写作)」' },
  { value: 'general', label: '整段强制为「通用精读」' },
];

export function ImportPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const draftId = searchParams.get('draft');
  const editPaperId = searchParams.get('paperId');
  const targetPaperId = editPaperId || draftId;

  const {
    getAnalysisProvider,
    getVisionProvider,
    concurrency,
    vocabExtractMode,
    vocabExtractDensity,
    setVocabExtractMode,
    setVocabExtractDensity,
  } = useSettingsStore();
  const { running } = useTaskStore();

  const analysisProvider = getAnalysisProvider();
  const visionProvider = getVisionProvider();

  const {
    loadedPaperId,
    existingPaper,
    mode,
    parsingMode,
    title,
    examType,
    forcedSectionType,
    rawText,
    aiPreviewDrafts,
    images,
    ocrStage,
    draftPaperId,
    setField,
    setImages,
    loadPaperIntoSession,
    resetSession,
  } = useImportSessionStore();

  const setExistingPaper = (v: ExamPaper | null) => setField('existingPaper', v);
  const setMode = (v: 'text' | 'image') => setField('mode', v);
  const setParsingMode = (v: PromptParsingMode) => setField('parsingMode', v);
  const setTitle = (v: string) => setField('title', v);
  const setExamType = (v: ExamPaper['examType']) => setField('examType', v);
  const setForcedSectionType = (v: ExamSection['type'] | 'auto') => setField('forcedSectionType', v);
  const setRawText = (v: string) => setField('rawText', v);
  const setAiPreviewDrafts = (v: ParsedSectionDraft[] | null) => setField('aiPreviewDrafts', v);
  const setOcrStage = (v: 'upload' | 'review') => setField('ocrStage', v);
  const setDraftPaperId = (v: string | undefined) => setField('draftPaperId', v);

  // Incremental section selection (draft IDs selected to run)
  const [selectedDraftIds, setSelectedDraftIds] = useState<Set<string>>(new Set());

  // Track last cursor position inside textarea for predictable marker insertion
  const cursorPosRef = useRef<number | null>(null);

  // Local UI state for image preview/zoom
  const [dragImageIdx, setDragImageIdx] = useState<number | null>(null);
  const [activeImageIdx, setActiveImageIdx] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [savedTip, setSavedTip] = useState<string | null>(null);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const timelineRef = useRef<HTMLDivElement>(null);

  // Sync session with ?paperId=... or ?draft=... (reset when navigating to fresh /import)
  useEffect(() => {
    if (!targetPaperId) {
      if (loadedPaperId !== null) {
        resetSession();
      }
      return;
    }
    if (loadedPaperId === targetPaperId) return;

    (async () => {
      const paper = await db.papers.get(targetPaperId);
      if (!paper) return;
      loadPaperIntoSession(paper);
      // Clean up any legacy stored image blobs if present
      await db.images.where('paperId').equals(paper.id).delete().catch(() => {});
    })();
  }, [targetPaperId, loadedPaperId, loadPaperIntoSession, resetSession]);

  // Support Ctrl+V image paste in image upload view
  useEffect(() => {
    if (mode !== 'image' || ocrStage !== 'upload') return;
    const onPaste = async (e: ClipboardEvent) => {
      const files: File[] = [];
      for (const item of Array.from(e.clipboardData?.items || [])) {
        if (item.type.startsWith('image/')) {
          const f = item.getAsFile();
          if (f) files.push(f);
        }
      }
      if (files.length > 0) {
        e.preventDefault();
        await handleAddImageFiles(files);
      }
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [mode, ocrStage]);

  const markedVocabs = useMemo(() => listMarkedVocabTokens(rawText), [rawText]);

  const preParsedDrafts = useMemo(
    () => splitPaperIntoSections(rawText, forcedSectionType),
    [rawText, forcedSectionType],
  );

  // Effective drafts: either AI preview drafts (in ai_segmented mode if previewed) or local preParsedDrafts
  const effectiveDrafts = useMemo(() => {
    if (parsingMode === 'ai_segmented') {
      return aiPreviewDrafts ?? [];
    }
    return preParsedDrafts;
  }, [parsingMode, aiPreviewDrafts, preParsedDrafts]);

  // Compute diff status against existingPaper for incremental analysis defaults
  const draftStatuses = useMemo(() => {
    const map = new Map<
      string,
      { kind: 'new' | 'modified' | 'error' | 'unchanged'; label: string }
    >();
    if (!existingPaper || existingPaper.sections.length === 0) {
      for (const d of effectiveDrafts) {
        map.set(d.id, { kind: 'new', label: '待解析' });
      }
      return map;
    }

    for (const d of effectiveDrafts) {
      const matched = findMatchingExistingSection(existingPaper.sections, d);
      if (!matched) {
        map.set(d.id, { kind: 'new', label: '新增分段 · 待解析' });
      } else if (matched.status === 'error' || matched.status === 'pending') {
        map.set(d.id, { kind: 'error', label: '曾失败/未完成 · 待重析' });
      } else {
        const prevRaw = stripExplicitMarkerLine(matched.rawText || '').trim();
        const curRaw = stripExplicitMarkerLine(d.rawText).trim();
        if (prevRaw !== curRaw || matched.type !== d.type) {
          map.set(d.id, { kind: 'modified', label: '内容/题型已改 · 待重析' });
        } else {
          map.set(d.id, { kind: 'unchanged', label: '已解析 · 可复用' });
        }
      }
    }
    return map;
  }, [effectiveDrafts, existingPaper]);

  // Sync default selectedDraftIds whenever drafts or existingPaper changes
  useEffect(() => {
    if (effectiveDrafts.length === 0) {
      setSelectedDraftIds(new Set());
      return;
    }
    if (!existingPaper || existingPaper.sections.length === 0) {
      setSelectedDraftIds(new Set(effectiveDrafts.map((d) => d.id)));
      return;
    }
    const next = new Set<string>();
    for (const d of effectiveDrafts) {
      const st = draftStatuses.get(d.id)?.kind;
      if (st !== 'unchanged') next.add(d.id);
    }
    setSelectedDraftIds(next);
  }, [effectiveDrafts, draftStatuses, existingPaper]);

  const estimatedTokens = useMemo(() => estimateTextTokens(rawText), [rawText]);
  const pendingImages = useMemo(
    () => images.filter((img) => img.ocrStatus === 'pending'),
    [images],
  );
  const doneImageCount = images.length - pendingImages.length;
  const estimatedImgTokens = useMemo(
    () => estimateImageTokens(pendingImages.length || images.length, visionProvider.params.imageDetail),
    [pendingImages.length, images.length, visionProvider.params.imageDetail],
  );

  const handleAddImageFiles = async (fileList: FileList | File[]) => {
    const arr = Array.from(fileList).filter((f) => f.type.startsWith('image/'));
    if (arr.length === 0) return;

    const processed: LocalImageItem[] = [];
    for (const file of arr) {
      const res = await preprocessExamImage(file, { maxDimension: 2048, quality: 0.86 });
      processed.push({
        id: `img-${crypto.randomUUID().slice(0, 8)}`,
        name: file.name || `试卷页-${Date.now()}.jpg`,
        blob: res.blob,
        previewUrl: res.previewUrl,
        width: res.width,
        height: res.height,
        originalBytes: res.originalBytes,
        compressedBytes: res.compressedBytes,
        ocrStatus: 'pending',
      });
    }
    setImages((prev) => [...prev, ...processed]);
  };

  const handleMoveImage = (fromIdx: number, toIdx: number) => {
    if (fromIdx === toIdx || toIdx < 0 || toIdx >= images.length) return;
    setImages((prev) => {
      const next = [...prev];
      const [moved] = next.splice(fromIdx, 1);
      next.splice(toIdx, 0, moved);
      return next;
    });
    if (activeImageIdx === fromIdx) {
      setActiveImageIdx(toIdx);
    }
  };

  const handleRotateImage = async (idx: number) => {
    const target = images[idx];
    if (!target) return;
    const rotated = await preprocessExamImage(target.blob, {
      maxDimension: 2048,
      quality: 0.86,
      rotateDeg: 90,
    });
    URL.revokeObjectURL(target.previewUrl);
    setImages((prev) =>
      prev.map((img, i) =>
        i === idx
          ? {
              ...img,
              blob: rotated.blob,
              previewUrl: rotated.previewUrl,
              width: rotated.width,
              height: rotated.height,
              compressedBytes: rotated.compressedBytes,
            }
          : img,
      ),
    );
  };

  const handleRemoveImage = (idx: number) => {
    setImages((prev) => {
      const target = prev[idx];
      if (target) URL.revokeObjectURL(target.previewUrl);
      const next = prev.filter((_, i) => i !== idx);
      if (activeImageIdx >= next.length) {
        setActiveImageIdx(Math.max(0, next.length - 1));
      }
      return next;
    });
  };

  const syncCursorPos = () => {
    const el = textareaRef.current;
    if (!el) return;
    cursorPosRef.current = el.selectionStart;
  };

  const updateRawTextAndInvalidateAiPreview = (nextText: string) => {
    setRawText(nextText);
    if (aiPreviewDrafts) setAiPreviewDrafts(null);
  };

  /** Toggle {{...}} around selected text in editor (shortcut Ctrl/Cmd+M) */
  const handleToggleVocabWrap = () => {
    const el = textareaRef.current;
    if (!el) return;
    const start = el.selectionStart;
    const end = el.selectionEnd;
    if (start === end) return;
    const selected = rawText.slice(start, end);
    let replacement: string;
    if (selected.startsWith('{{') && selected.endsWith('}}')) {
      replacement = selected.slice(2, -2);
    } else {
      replacement = `{{${selected.trim()}}}`;
    }
    const next = rawText.slice(0, start) + replacement + rawText.slice(end);
    updateRawTextAndInvalidateAiPreview(next);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(start, start + replacement.length);
      cursorPosRef.current = start + replacement.length;
    });
  };

  /** Toggle <u>...</u> around selected translation sentence in editor */
  const handleToggleUnderlineWrap = () => {
    const el = textareaRef.current;
    if (!el) return;
    const start = el.selectionStart;
    const end = el.selectionEnd;
    if (start === end) return;
    const selected = rawText.slice(start, end);
    let replacement: string;
    if (/^<u>[\s\S]*<\/u>$/i.test(selected.trim())) {
      replacement = selected.trim().slice(3, -4);
    } else {
      replacement = `<u>${selected.trim()}</u>`;
    }
    const next = rawText.slice(0, start) + replacement + rawText.slice(end);
    updateRawTextAndInvalidateAiPreview(next);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(start, start + replacement.length);
      cursorPosRef.current = start + replacement.length;
    });
  };

  /** Insert an explicit canonical section marker cleanly at the current cursor position (never wraps/alters surrounding paragraphs) */
  const handleInsertSectionMarkerAtCursor = (label: string) => {
    const el = textareaRef.current;
    const rawPos =
      el && document.activeElement === el
        ? el.selectionStart
        : cursorPosRef.current !== null
          ? cursorPosRef.current
          : el
            ? el.selectionStart
            : rawText.length;
    const pos = Math.max(0, Math.min(rawText.length, rawPos));

    const beforeRaw = rawText.slice(0, pos);
    const afterRaw = rawText.slice(pos);
    const marker = `=== [${label}] ===`;

    const beforeTrimmed = beforeRaw.replace(/[ \t]+$/, '');
    const prefix =
      beforeTrimmed.length === 0
        ? ''
        : beforeTrimmed.endsWith('\n\n')
          ? beforeTrimmed
          : beforeTrimmed.endsWith('\n')
            ? `${beforeTrimmed}\n`
            : `${beforeTrimmed}\n\n`;

    const suffix =
      afterRaw.length === 0
        ? '\n'
        : afterRaw.startsWith('\n')
          ? afterRaw
          : `\n${afterRaw}`;

    const next = `${prefix}${marker}${suffix}`;
    const nextCursorPos = prefix.length + marker.length + 1;

    setParsingMode('pre_parsed');
    setForcedSectionType('auto');
    updateRawTextAndInvalidateAiPreview(next);

    requestAnimationFrame(() => {
      if (!el) return;
      el.focus();
      el.setSelectionRange(nextCursorPos, nextCursorPos);
      cursorPosRef.current = nextCursorPos;
    });
  };

  const handleChangeDraftLabel = (draftIdx: number, newLabel: string) => {
    if (parsingMode === 'ai_segmented' && aiPreviewDrafts) {
      const resolved = resolveCanonicalLabelAndType(newLabel);
      setAiPreviewDrafts(
        aiPreviewDrafts.map((d, i) =>
          i === draftIdx ? { ...d, title: resolved.label, type: resolved.type } : d,
        ),
      );
      return;
    }
    setForcedSectionType('auto');
    const next = updateSectionMarkerInRawText(rawText, draftIdx, newLabel, preParsedDrafts);
    setRawText(next);
  };

  const handleMergeDraftWithPrev = (draftIdx: number) => {
    if (draftIdx <= 0) return;
    if (parsingMode === 'ai_segmented' && aiPreviewDrafts) {
      const merged = [...aiPreviewDrafts];
      const prev = { ...merged[draftIdx - 1] };
      const cur = merged[draftIdx];
      prev.rawText = `${stripExplicitMarkerLine(prev.rawText)}\n\n${stripExplicitMarkerLine(cur.rawText)}`.trim();
      prev.vocabCount = listMarkedVocabTokens(prev.rawText).length;
      merged.splice(draftIdx - 1, 2, prev);
      setAiPreviewDrafts(merged);
      return;
    }
    setForcedSectionType('auto');
    const next = mergeSectionWithPreviousInRawText(draftIdx, preParsedDrafts);
    setRawText(next);
  };

  /** Saves OCR text draft or edited rawMarkedText WITHOUT persisting image blobs! */
  const saveRawTextToDb = async (
    textToSave: string,
    asDraftOnly: boolean,
  ): Promise<string> => {
    const saved = await savePaperDraftToDb({
      paperId: draftPaperId || existingPaper?.id,
      existingPaper,
      title,
      examType,
      sourceMode: mode,
      parsingMode,
      rawMarkedText: textToSave,
      asDraftOnly,
      providerName: analysisProvider.name,
      modelId: analysisProvider.modelId,
      ocrModelId: mode === 'image' ? visionProvider.modelId : undefined,
    });
    setDraftPaperId(saved.id);
    setExistingPaper(saved);
    setField('loadedPaperId', saved.id);
    return saved.id;
  };

  /** Stage 1: Incremental or Full OCR -> Route immediately to /import/ocr -> Review Workbench */
  const handleRunOcr = (forceFull = false) => {
    if (images.length === 0) return;
    const targets = forceFull ? images : pendingImages;
    if (targets.length === 0) {
      setOcrStage('review');
      return;
    }

    const returnPath = editPaperId
      ? `/import?paperId=${editPaperId}`
      : draftPaperId
        ? `/import?draft=${draftPaperId}`
        : '/import';

    setField('ocrForceFull', forceFull);
    setField('ocrReturnPath', returnPath);
    setActiveImageIdx(0);
    setZoom(1);

    void executeOcrSession({
      forceFull,
      onSuccess: (nextPath) => {
        if (window.location.pathname === '/import/ocr') {
          navigate(nextPath, { replace: true });
        }
      },
    });
    navigate('/import/ocr');
  };

  /** Preview AI Smart Segmentation (Prompt Set B-1) before launching full analysis */
  const handlePreviewAiSplit = async () => {
    if (!rawText.trim()) return;
    timelineRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    try {
      const { drafts } = await runAiPaperSplitPreview({
        provider: analysisProvider,
        rawText,
      });
      setAiPreviewDrafts(drafts);
    } catch {
      // Error surfaced cleanly in ExecutionTimeline
    }
  };

  const handleLockAiSplitIntoText = () => {
    if (!aiPreviewDrafts || aiPreviewDrafts.length === 0) return;
    const locked = lockSectionsWithExplicitMarkers(aiPreviewDrafts);
    setRawText(locked);
    setAiPreviewDrafts(null);
    setParsingMode('pre_parsed');
    setSavedTip('已将切分标签写入原文 === [标签] ===');
    setTimeout(() => setSavedTip(null), 2200);
  };

  /** Stage 2: Launch Full or Incremental Analysis Pipeline & route immediately to /paper/:id */
  const handleStartAnalysis = async (forceFull = false) => {
    if (!rawText.trim()) return;
    if (parsingMode === 'pre_parsed' && effectiveDrafts.length === 0) return;

    // For incremental mode, pass selectedDraftIds when editing an existing paper
    const useIncrementalSelection =
      !forceFull &&
      Boolean(existingPaper && existingPaper.sections.length > 0) &&
      effectiveDrafts.length > 0;

    if (useIncrementalSelection && selectedDraftIds.size === 0) {
      // Nothing selected to re-analyze: just save raw text edits and return to study page
      const id = await saveRawTextToDb(rawText, false);
      resetSession();
      navigate(`/paper/${id}`);
      return;
    }

    try {
      await runPaperAnalysisPipeline({
        paperId: draftPaperId || existingPaper?.id,
        existingPaper: existingPaper || undefined,
        title:
          title.trim() ||
          existingPaper?.title ||
          effectiveDrafts[0]?.title ||
          `考研英语精读 (${new Date().toLocaleDateString()})`,
        examType,
        sourceMode: existingPaper?.sourceMode || mode,
        parsingMode,
        vocabExtractMode,
        vocabExtractDensity,
        rawMarkedText: rawText,
        sectionsDraft: effectiveDrafts,
        selectedDraftIds: useIncrementalSelection ? selectedDraftIds : undefined,
        provider: analysisProvider,
        ocrModelId: mode === 'image' ? visionProvider.modelId : existingPaper?.analysisMeta?.ocrModelId,
        concurrency,
        onPaperInitialized: (paperId) => {
          resetSession();
          navigate(`/paper/${paperId}`);
        },
      });
    } catch {
      // Error surfaced cleanly in ExecutionTimeline on /paper/:id
    }
  };

  const toggleDraftSelected = (id: string) => {
    setSelectedDraftIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const contextRatio = Math.min(
    100,
    Math.round((estimatedTokens / Math.max(1, analysisProvider.params.contextWindow)) * 100),
  );

  const isEditingExisting = Boolean(existingPaper && existingPaper.sections.length > 0);

  return (
    <div className="space-y-4">
      {/* Existing Paper Edit / Incremental Banner */}
      {isEditingExisting && existingPaper && (
        <div className="island border-accent/30 bg-accent-soft/25 px-5 py-3.5 flex flex-wrap items-center justify-between gap-3">
          <div className="space-y-0.5">
            <div className="flex items-center gap-2 text-xs font-semibold text-accent">
              <Layers className="h-4 w-4" />
              <span>原文编辑与增量追加模式</span>
            </div>
            <p className="text-xs text-text-secondary">
              正在编辑「<strong className="text-text-primary">{existingPaper.title}</strong>」（已解析 {existingPaper.sections.length} 个模块）。你可以修正原文、重分配题型、追加文本或继续上传图片做增量 OCR，再仅对新增/改动模块做增量解析。
            </p>
          </div>
          <Link
            to={`/paper/${existingPaper.id}`}
            className="inline-flex items-center gap-1.5 rounded-xl border border-border-subtle bg-surface px-3 py-1.5 text-xs font-medium text-text-primary hover:border-accent"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            返回精读视图
          </Link>
        </div>
      )}

      {/* Top Mode Switcher Island */}
      <div className="island p-5 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-text-primary">
            {isEditingExisting ? '编辑原文 / 增量追加试卷' : '导入考研英语试卷'}
          </h1>
          <p className="mt-0.5 text-xs text-text-secondary">
            {isEditingExisting
              ? '可直接编辑下方原文、在光标处插入分段标签或切到「图像追加 OCR」新增试卷页；未改动的已解析模块将自动复用。'
              : '文本输入支持光标处一键插入分段标签或 AI 智能切分，并可选 AI 自动总结/补充生词；图像支持重排与增量 OCR。'}
          </p>
        </div>

        <div className="inline-flex rounded-xl border border-border-subtle bg-surface-subtle p-1">
          <button
            type="button"
            onClick={() => setMode('text')}
            className={`inline-flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-xs font-semibold transition ${
              mode === 'text'
                ? 'bg-surface text-text-primary shadow-xs'
                : 'text-text-secondary hover:text-text-primary'
            }`}
          >
            <FileText className="h-3.5 w-3.5" />
            {isEditingExisting ? '编辑原文与分段' : '文本输入（{{生词}}）'}
          </button>
          <button
            type="button"
            onClick={() => {
              setMode('image');
              if (images.length === 0) setOcrStage('upload');
            }}
            className={`inline-flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-xs font-semibold transition ${
              mode === 'image'
                ? 'bg-surface text-text-primary shadow-xs'
                : 'text-text-secondary hover:text-text-primary'
            }`}
          >
            <ImageIcon className="h-3.5 w-3.5" />
            {isEditingExisting ? '追加图片增量 OCR' : '图像 OCR → 校对 → 解析'}
          </button>
        </div>
      </div>

      {/* Live Agent Execution Timeline */}
      <div ref={timelineRef}>
        <ExecutionTimeline />
      </div>

      {/* Paper Metadata Bar */}
      <div className="island p-4 grid gap-3 sm:grid-cols-3">
        <div className="sm:col-span-1">
          <label className="block text-xs font-medium text-text-secondary mb-1">试卷标题</label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="例如：2024 考研英语（一）全卷"
            className="w-full rounded-xl border border-border-subtle bg-surface-subtle px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:border-accent focus:outline-none"
          />
        </div>

        <div>
          <label className="block text-xs font-medium text-text-secondary mb-1">考试类别</label>
          <select
            value={examType}
            onChange={(e) => setExamType(e.target.value as ExamPaper['examType'])}
            className="w-full rounded-xl border border-border-subtle bg-surface-subtle px-3 py-2 text-sm text-text-primary focus:border-accent focus:outline-none"
          >
            <option value="english_1">考研英语（一）</option>
            <option value="english_2">考研英语（二）</option>
            <option value="custom">自定义精读材料</option>
          </select>
        </div>

        <div>
          <label className="block text-xs font-medium text-text-secondary mb-1">
            分段策略（{parsingMode === 'ai_segmented' ? 'AI 智能切分' : '本地预解析'}）
          </label>
          <select
            value={parsingMode === 'ai_segmented' ? 'ai_segmented' : forcedSectionType}
            onChange={(e) => {
              const val = e.target.value;
              if (val === 'ai_segmented') {
                setParsingMode('ai_segmented');
                setForcedSectionType('auto');
              } else {
                setParsingMode('pre_parsed');
                setAiPreviewDrafts(null);
                setForcedSectionType(val as ExamSection['type'] | 'auto');
              }
            }}
            className="w-full rounded-xl border border-border-subtle bg-surface-subtle px-3 py-2 text-sm text-text-primary focus:border-accent focus:outline-none"
          >
            <option value="ai_segmented">放弃本地预解析，交由 AI 自动切分整卷</option>
            {SECTION_TYPE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* ==================== MODE B: IMAGE UPLOAD (Stage 1 / Incremental OCR) ==================== */}
      {mode === 'image' && ocrStage === 'upload' && (
        <div className="island p-5 sm:p-6 space-y-5">
          {/* Vision slot status banner */}
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border-subtle bg-surface-subtle px-4 py-2.5 text-xs">
            <div className="flex flex-wrap items-center gap-2">
              <Eye className="h-4 w-4 text-accent" />
              <span className="text-text-secondary">
                视觉 OCR 槽位：
                <strong className="ml-1 text-text-primary">
                  {visionProvider.name} · {visionProvider.modelId}
                </strong>
              </span>
              {visionProvider.capabilities.vision ? (
                <span className="rounded-full bg-answer-soft px-2 py-0.5 font-medium text-answer">
                  支持视觉
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 rounded-full bg-danger-soft px-2 py-0.5 font-medium text-danger">
                  <AlertTriangle className="h-3 w-3" />
                  当前模型不支持图片（请切换）
                </span>
              )}
              <span className="text-text-muted">· 图片仅内存临时处理，OCR 后不持久化</span>
            </div>
            <Link
              to="/settings"
              className="inline-flex items-center gap-1 font-medium text-accent hover:underline"
            >
              <Settings className="h-3.5 w-3.5" />
              切换视觉模型
            </Link>
          </div>

          {/* Dropzone */}
          <div
            onDragOver={(e) => e.preventDefault()}
            onDrop={async (e) => {
              e.preventDefault();
              if (e.dataTransfer.files.length > 0) {
                await handleAddImageFiles(e.dataTransfer.files);
              }
            }}
            onClick={() => fileInputRef.current?.click()}
            className="cursor-pointer rounded-2xl border-2 border-dashed border-border-strong bg-surface-subtle/50 p-7 text-center transition hover:border-accent hover:bg-accent-soft/20"
          >
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={async (e) => {
                if (e.target.files) await handleAddImageFiles(e.target.files);
                e.target.value = '';
              }}
            />
            <Upload className="mx-auto h-7 w-7 text-accent" />
            <p className="mt-2 text-sm font-semibold text-text-primary">
              点击选择、拖拽上传，或直接 Ctrl+V 粘贴{rawText.trim() ? '新增' : ''}试卷图片
            </p>
            <p className="mt-1 text-xs text-text-secondary">
              支持拖拽或点击箭头重排页码顺序；自动压缩为 2048px 以内彩色 JPEG（保留红笔方框与红笔订正）
            </p>
          </div>

          {/* Image Thumbnails Grid with Drag-Drop + Button Reordering */}
          {images.length > 0 && (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-text-secondary">
                <span>
                  共 {images.length} 张（待识别{' '}
                  <strong className="text-vocab">{pendingImages.length}</strong> 张，已识别{' '}
                  <strong className="text-answer">{doneImageCount}</strong> 张）· 压缩后共{' '}
                  <strong className="font-mono text-text-primary">
                    {formatByteSize(images.reduce((sum, item) => sum + item.compressedBytes, 0))}
                  </strong>{' '}
                  （Base64 分批直传，约 {estimatedImgTokens.toLocaleString()} 视觉 Token）
                </span>
                {rawText.trim() && (
                  <button
                    type="button"
                    onClick={() => setOcrStage('review')}
                    className="font-medium text-accent hover:underline"
                  >
                    返回校对编辑稿 →
                  </button>
                )}
              </div>

              <div className="grid gap-3 grid-cols-2 sm:grid-cols-3 md:grid-cols-4">
                {images.map((img, idx) => (
                  <div
                    key={img.id}
                    draggable
                    onDragStart={() => setDragImageIdx(idx)}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => {
                      e.preventDefault();
                      if (dragImageIdx !== null && dragImageIdx !== idx) {
                        handleMoveImage(dragImageIdx, idx);
                      }
                      setDragImageIdx(null);
                    }}
                    onDragEnd={() => setDragImageIdx(null)}
                    className={`group relative overflow-hidden rounded-xl border bg-surface-subtle transition ${
                      dragImageIdx === idx
                        ? 'border-accent opacity-60 scale-[0.98]'
                        : 'border-border-subtle hover:border-border-strong'
                    }`}
                  >
                    {/* Top page & status overlay */}
                    <div className="absolute inset-x-1.5 top-1.5 z-10 flex items-center justify-between gap-1">
                      <span className="inline-flex items-center gap-1 rounded-md bg-black/65 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-white backdrop-blur-xs cursor-grab">
                        <GripVertical className="h-3 w-3 opacity-80" />
                        P{idx + 1}
                      </span>
                      <span
                        className={`rounded-md px-1.5 py-0.5 text-[10px] font-semibold backdrop-blur-xs ${
                          img.ocrStatus === 'done'
                            ? 'bg-emerald-600/85 text-white'
                            : 'bg-amber-500/90 text-white'
                        }`}
                      >
                        {img.ocrStatus === 'done' ? '已 OCR' : '待识别'}
                      </span>
                    </div>

                    <img
                      src={img.previewUrl}
                      alt={img.name}
                      className="h-44 w-full object-cover"
                    />

                    <div className="flex items-center justify-between px-2 py-1.5 text-[11px] text-text-secondary bg-surface/95 border-t border-border-subtle">
                      <span
                        className="truncate font-mono"
                        title={
                          img.originalBytes
                            ? `原始 ${formatByteSize(img.originalBytes)} → 压缩后 ${formatByteSize(img.compressedBytes)} (${img.width}×${img.height})`
                            : `${formatByteSize(img.compressedBytes)} (${img.width}×${img.height})`
                        }
                      >
                        {formatByteSize(img.compressedBytes)}
                      </span>
                      <div className="flex items-center gap-0.5">
                        <button
                          type="button"
                          disabled={idx === 0}
                          onClick={() => handleMoveImage(idx, idx - 1)}
                          className="rounded p-1 hover:bg-surface-subtle hover:text-text-primary disabled:opacity-30"
                          title="向前移一页"
                        >
                          <ChevronLeft className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          disabled={idx === images.length - 1}
                          onClick={() => handleMoveImage(idx, idx + 1)}
                          className="rounded p-1 hover:bg-surface-subtle hover:text-text-primary disabled:opacity-30"
                          title="向后移一页"
                        >
                          <ChevronRight className="h-3.5 w-3.5" />
                        </button>
                        {img.ocrStatus === 'done' && (
                          <button
                            type="button"
                            onClick={() =>
                              setImages((prev) =>
                                prev.map((it, i) => (i === idx ? { ...it, ocrStatus: 'pending' } : it)),
                              )
                            }
                            className="rounded p-1 hover:bg-vocab-soft hover:text-vocab"
                            title="标为待重新识别"
                          >
                            <RefreshCw className="h-3 w-3" />
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => handleRotateImage(idx)}
                          className="rounded p-1 hover:bg-surface-subtle hover:text-text-primary"
                          title="顺时针旋转 90°"
                        >
                          <RotateCw className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleRemoveImage(idx)}
                          className="rounded p-1 hover:bg-danger-soft hover:text-danger"
                          title="移除"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              <div className="flex flex-wrap items-center justify-end gap-2.5 pt-2">
                {doneImageCount > 0 && (
                  <button
                    type="button"
                    disabled={running || !visionProvider.capabilities.vision}
                    onClick={() => handleRunOcr(true)}
                    className="inline-flex items-center gap-1.5 rounded-xl border border-border-subtle bg-surface-subtle px-4 py-2.5 text-xs font-semibold text-text-secondary hover:text-text-primary disabled:opacity-45"
                  >
                    <RefreshCw className="h-3.5 w-3.5" />
                    全量重识全部 {images.length} 页
                  </button>
                )}

                <button
                  type="button"
                  disabled={
                    running ||
                    !visionProvider.capabilities.vision ||
                    pendingImages.length === 0
                  }
                  onClick={() => handleRunOcr(false)}
                  className="inline-flex items-center gap-2 rounded-xl bg-accent px-5 py-2.5 text-sm font-semibold text-white shadow-xs transition hover:opacity-92 disabled:opacity-45"
                >
                  <ScanText className="h-4 w-4" />
                  {doneImageCount > 0 && pendingImages.length > 0
                    ? `增量 OCR：仅识别新增 ${pendingImages.length} 页（追加到原文）`
                    : `Stage 1：OCR 识图（${pendingImages.length} 页生成校对稿）`}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ==================== TEXT MODE OR OCR INTERMEDIATE REVIEW WORKBENCH ==================== */}
      {(mode === 'text' || ocrStage === 'review') && (
        <div className="space-y-4">
          {/* Complete User Guide for Text Input */}
          <TextFormatGuide
            defaultOpen={mode === 'text' && !rawText.trim() && !isEditingExisting}
            onInsertSample={(sample) => {
              updateRawTextAndInvalidateAiPreview(
                rawText.trim() ? `${rawText.trim()}\n\n${sample}` : sample,
              );
              setParsingMode('pre_parsed');
              setForcedSectionType('auto');
            }}
          />

          <div
            className={
              mode === 'image' && ocrStage === 'review' && images.length > 0
                ? 'grid gap-4 xl:grid-cols-2'
                : 'space-y-4'
            }
          >
            {/* Left Pane (Only in OCR Review Mode with active session images): Zoomable Original Image Viewer */}
            {mode === 'image' && ocrStage === 'review' && images.length > 0 && (
              <div className="island p-4 flex flex-col gap-3 xl:sticky xl:top-4 xl:h-[calc(100vh-8rem)]">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border-subtle pb-2.5">
                  <div className="flex items-center gap-2">
                    <span className="rounded-md bg-vocab-soft px-2 py-0.5 text-xs font-semibold text-vocab">
                      OCR 校对 · 原图对照
                    </span>
                    <span className="text-xs text-text-muted">
                      第 {activeImageIdx + 1} / {images.length} 页
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => setZoom((z) => Math.max(0.6, +(z - 0.2).toFixed(2)))}
                      className="rounded-lg border border-border-subtle p-1.5 text-text-secondary hover:text-text-primary"
                      title="缩小"
                    >
                      <ZoomOut className="h-3.5 w-3.5" />
                    </button>
                    <span className="w-11 text-center font-mono text-xs text-text-secondary">
                      {Math.round(zoom * 100)}%
                    </span>
                    <button
                      type="button"
                      onClick={() => setZoom((z) => Math.min(3, +(z + 0.2).toFixed(2)))}
                      className="rounded-lg border border-border-subtle p-1.5 text-text-secondary hover:text-text-primary"
                      title="放大"
                    >
                      <ZoomIn className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setOcrStage('upload')}
                      className="ml-1 rounded-lg border border-border-subtle px-2.5 py-1 text-xs text-text-secondary hover:text-text-primary"
                    >
                      管理/追加/重排图片
                    </button>
                  </div>
                </div>

                <div className="flex-1 overflow-auto rounded-xl bg-surface-subtle p-2">
                  <img
                    src={images[activeImageIdx]?.previewUrl}
                    alt={images[activeImageIdx]?.name}
                    style={{ width: `${zoom * 100}%`, maxWidth: 'none' }}
                    className="mx-auto rounded-lg transition-all duration-100"
                  />
                </div>

                {images.length > 1 && (
                  <div className="flex gap-2 overflow-x-auto pt-1">
                    {images.map((img, idx) => (
                      <button
                        key={img.id}
                        type="button"
                        onClick={() => setActiveImageIdx(idx)}
                        className={`shrink-0 overflow-hidden rounded-lg border-2 transition ${
                          idx === activeImageIdx
                            ? 'border-accent'
                            : 'border-transparent opacity-65 hover:opacity-100'
                        }`}
                      >
                        <img
                          src={img.previewUrl}
                          alt={`P${idx + 1}`}
                          className="h-14 w-12 object-cover"
                        />
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Right/Main Pane: Marked Text Editor + Selection Assignment Bar + Section Cards */}
            <div className="island p-5 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <h2 className="text-sm font-semibold text-text-primary">
                    {mode === 'image'
                      ? 'OCR 识别文本（可校对红框生词、翻译划线句与题型分区）'
                      : isEditingExisting
                        ? '试卷原文编辑器（统一真源，支持修改与追加）'
                        : '粘贴或编辑试卷文本'}
                  </h2>
                  <span className="rounded-full bg-vocab-soft px-2.5 py-0.5 text-xs font-medium text-vocab">
                    已标生词 {markedVocabs.length}
                  </span>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={handleToggleVocabWrap}
                    className="inline-flex items-center gap-1 rounded-lg border border-vocab/30 bg-vocab-soft/70 px-2.5 py-1 text-xs font-medium text-vocab hover:bg-vocab-soft"
                    title="选中任意单词后点击或按 Ctrl+M 快速包裹/取消 {{}}"
                  >
                    <Highlighter className="h-3.5 w-3.5" />
                    标生词 {'{{}}'} (Ctrl+M)
                  </button>

                  <button
                    type="button"
                    onClick={handleToggleUnderlineWrap}
                    className="inline-flex items-center gap-1 rounded-lg border border-accent/30 bg-accent-soft/60 px-2.5 py-1 text-xs font-medium text-accent hover:bg-accent-soft"
                    title="选中 Part C 翻译划线句后点击快速包裹/取消 <u>...</u>"
                  >
                    <Underline className="h-3.5 w-3.5" />
                    标翻译划线句
                  </button>

                  {(mode === 'image' || isEditingExisting) && (
                    <button
                      type="button"
                      onClick={async () => {
                        await saveRawTextToDb(rawText, !isEditingExisting);
                        setSavedTip(isEditingExisting ? '已保存原文修改' : '已存草稿（不含图片）');
                        setTimeout(() => setSavedTip(null), 2000);
                      }}
                      className="inline-flex items-center gap-1 rounded-lg border border-border-subtle bg-surface-subtle px-2.5 py-1 text-xs font-medium text-text-secondary hover:text-text-primary"
                    >
                      {savedTip ? (
                        <CheckCircle2 className="h-3.5 w-3.5 text-answer" />
                      ) : (
                        <Save className="h-3.5 w-3.5" />
                      )}
                      {savedTip || (isEditingExisting ? '仅保存原文修改' : '保存草稿')}
                    </button>
                  )}
                </div>
              </div>

              {/* Cursor-Only Explicit Section Marker Insertion Bar */}
              <div className="rounded-xl border border-border-subtle bg-surface-subtle/50 px-3 py-2.5">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-[11.5px] font-semibold text-text-primary mr-1">
                    在光标处插入分段标签：
                  </span>
                  {CANONICAL_SECTION_PRESETS.map((preset) => (
                    <button
                      key={preset.label}
                      type="button"
                      onMouseDown={(e) => e.preventDefault()} // Keep textarea focus & cursor intact!
                      onClick={() => handleInsertSectionMarkerAtCursor(preset.label)}
                      className="rounded-lg border border-border-subtle bg-surface px-2 py-0.5 text-[11px] font-medium text-text-secondary transition hover:border-accent hover:text-accent"
                      title={`在当前光标位置插入「=== [${preset.label}] ===」分段标记`}
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>
              </div>

              <textarea
                ref={textareaRef}
                value={rawText}
                onChange={(e) => updateRawTextAndInvalidateAiPreview(e.target.value)}
                onClick={syncCursorPos}
                onKeyUp={syncCursorPos}
                onSelect={syncCursorPos}
                onKeyDown={(e) => {
                  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'm') {
                    e.preventDefault();
                    handleToggleVocabWrap();
                  }
                }}
                rows={mode === 'image' ? 17 : 15}
                placeholder={`在此粘贴考研英语试卷文本（单篇或整套均可），生词可用 {{word}} 包裹（未标也可开启下方「AI 自动总结/补充生词」）。\n\n如需手动划定题型边界，将光标定位到对应题型开头后点击上方标签插入 === [标签] ===；或切换为「放弃本地预解析，交由 AI 自动切分整卷」。`}
                className="w-full rounded-2xl border border-border-subtle bg-surface-subtle/70 p-4 font-mono text-[13.5px] leading-relaxed text-text-primary placeholder:text-text-muted focus:border-accent focus:outline-none"
              />

              {/* Vocabulary Extraction Mode Panel (Manual Only vs AI Auto-Summarize / Augment) */}
              <div className="rounded-2xl border border-border-subtle bg-surface-subtle/60 p-4 space-y-2.5 text-xs">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold text-text-primary">生词提取策略：</span>
                    <div className="inline-flex rounded-lg border border-border-subtle bg-surface p-0.5">
                      {(
                        [
                          { id: 'manual_only', label: `仅提取手标 {{生词}} (${markedVocabs.length})` },
                          { id: 'ai_augment', label: 'AI 自动总结 / 在手标基础上补充' },
                        ] as Array<{ id: VocabExtractMode; label: string }>
                      ).map((opt) => (
                        <button
                          key={opt.id}
                          type="button"
                          onClick={() => setVocabExtractMode(opt.id)}
                          className={`rounded-md px-2.5 py-1 text-[11px] font-medium transition ${
                            vocabExtractMode === opt.id
                              ? 'bg-vocab text-white'
                              : 'text-text-secondary hover:text-text-primary'
                          }`}
                        >
                          {opt.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {vocabExtractMode === 'ai_augment' && (
                    <div className="flex items-center gap-1.5">
                      <span className="text-[11px] text-text-muted">补充密度：</span>
                      {(
                        [
                          { id: 'concise', label: '精简' },
                          { id: 'balanced', label: '适中' },
                          { id: 'comprehensive', label: '全面' },
                        ] as Array<{ id: VocabExtractDensity; label: string }>
                      ).map((d) => (
                        <button
                          key={d.id}
                          type="button"
                          onClick={() => setVocabExtractDensity(d.id)}
                          className={`rounded-md border px-2 py-0.5 text-[11px] font-medium transition ${
                            vocabExtractDensity === d.id
                              ? 'border-vocab/40 bg-vocab-soft text-vocab'
                              : 'border-border-subtle bg-surface text-text-secondary hover:text-text-primary'
                          }`}
                        >
                          {d.label}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                <p className="text-[11.5px] leading-relaxed text-text-secondary">
                  {vocabExtractMode === 'ai_augment'
                    ? markedVocabs.length > 0
                      ? `已保留你标记的 ${markedVocabs.length} 个生词，解析时 AI 将在此基础上自动补充遗漏的考研高频词、短语搭配与熟词僻义，并在阅读视图中自动加上可点击下划线（不会修改你的原始文本）。`
                      : '当前未手动标记 {{生词}}，解析时 AI 将通读各题型原文自动总结考研核心生词与熟词僻义，并在阅读视图与生词本中同步展示。'
                    : markedVocabs.length > 0
                      ? `仅提取你手动或红笔框选的 ${markedVocabs.length} 个 {{生词}}（100% 精确零遗漏）；若觉得框选不够多，可切换到「AI 自动总结 / 补充」。`
                      : '当前未检测到 {{生词}} 标记。如果你没有用红笔框词，建议切换到右侧「AI 自动总结 / 在手标基础上补充」让模型自动提炼核心词汇。'}
                </p>
              </div>

              {/* Detected Marked Vocab Chips */}
              {markedVocabs.length > 0 && (
                <div className="space-y-1.5">
                  <div className="text-xs font-medium text-text-muted">
                    已检测到 {markedVocabs.length} 个标记生词（本地精确提取，确保 0 遗漏）：
                  </div>
                  <div className="flex flex-wrap gap-1.5 max-h-24 overflow-y-auto">
                    {markedVocabs.map((w) => (
                      <span
                        key={w}
                        className="rounded-lg border border-vocab/25 bg-vocab-soft/60 px-2 py-0.5 text-xs font-medium text-vocab"
                      >
                        {w}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Segmentation Mode & Interactive Section Cards */}
              <div className="rounded-2xl border border-border-subtle bg-surface-subtle/60 p-4 space-y-3 text-xs">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold text-text-primary">题型切分方式：</span>
                    <div className="inline-flex rounded-lg border border-border-subtle bg-surface p-0.5">
                      <button
                        type="button"
                        onClick={() => {
                          setParsingMode('pre_parsed');
                          setAiPreviewDrafts(null);
                        }}
                        className={`rounded-md px-2.5 py-1 text-[11px] font-medium transition ${
                          parsingMode === 'pre_parsed'
                            ? 'bg-accent text-white'
                            : 'text-text-secondary hover:text-text-primary'
                        }`}
                      >
                        使用预解析 + 手动校正 ({preParsedDrafts.length})
                      </button>
                      <button
                        type="button"
                        onClick={() => setParsingMode('ai_segmented')}
                        className={`rounded-md px-2.5 py-1 text-[11px] font-medium transition ${
                          parsingMode === 'ai_segmented'
                            ? 'bg-accent text-white'
                            : 'text-text-secondary hover:text-text-primary'
                        }`}
                      >
                        放弃预解析，交由 AI 切分
                      </button>
                    </div>
                  </div>

                  <span className="font-mono text-[11px] text-text-muted">
                    主模型：{analysisProvider.name} · {analysisProvider.modelId}
                  </span>
                </div>

                {/* AI Split Preview Controls */}
                {parsingMode === 'ai_segmented' && (
                  <div className="rounded-xl border border-accent/25 bg-accent-soft/30 p-3 flex flex-wrap items-center justify-between gap-2">
                    <p className="text-xs text-text-secondary">
                      {aiPreviewDrafts
                        ? `AI 已切分出 ${aiPreviewDrafts.length} 个标准题型模块，你仍可在下方调整标签或勾选增量解析范围。`
                        : '已启用第二套「AI 智能切分提示词」：可直接点击开始解析由模型先切分再解析，或先预览切分结果。'}
                    </p>
                    <div className="flex flex-wrap items-center gap-2">
                      {aiPreviewDrafts && (
                        <button
                          type="button"
                          onClick={handleLockAiSplitIntoText}
                          className="rounded-lg border border-border-subtle bg-surface px-2.5 py-1 text-[11px] font-medium text-text-primary hover:border-accent"
                        >
                          将 AI 标签写入原文锁定
                        </button>
                      )}
                      <button
                        type="button"
                        disabled={running || !rawText.trim()}
                        onClick={handlePreviewAiSplit}
                        className="inline-flex items-center gap-1 rounded-lg bg-accent px-3 py-1.5 text-[11px] font-semibold text-white hover:opacity-90 disabled:opacity-45"
                      >
                        <Wand2 className="h-3.5 w-3.5" />
                        {aiPreviewDrafts ? '重新让 AI 预览切分' : '先让 AI 预览切分结果'}
                      </button>
                    </div>
                  </div>
                )}

                {/* Editable Section Partition Cards */}
                {effectiveDrafts.length > 0 && (
                  <div className="space-y-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-[11px] font-medium text-text-muted">
                        点击下拉框可随时改判任一分段的题型标签；勾选需要纳入本次解析的模块：
                      </span>
                      <div className="flex items-center gap-2 text-[11px]">
                        <button
                          type="button"
                          onClick={() =>
                            setSelectedDraftIds(new Set(effectiveDrafts.map((d) => d.id)))
                          }
                          className="text-accent hover:underline"
                        >
                          全选 ({effectiveDrafts.length})
                        </button>
                        {isEditingExisting && (
                          <button
                            type="button"
                            onClick={() => {
                              const changed = new Set<string>();
                              for (const d of effectiveDrafts) {
                                if (draftStatuses.get(d.id)?.kind !== 'unchanged') changed.add(d.id);
                              }
                              setSelectedDraftIds(changed);
                            }}
                            className="text-vocab hover:underline"
                          >
                            仅选新增/改动
                          </button>
                        )}
                      </div>
                    </div>

                    <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
                      {effectiveDrafts.map((sec, idx) => {
                        const checked = selectedDraftIds.has(sec.id);
                        const statusInfo = draftStatuses.get(sec.id);
                        const previewLine = stripExplicitMarkerLine(sec.rawText)
                          .replace(/\s+/g, ' ')
                          .slice(0, 90);
                        const isCanonicalPreset = CANONICAL_SECTION_PRESETS.some(
                          (p) => p.label === sec.title,
                        );

                        return (
                          <div
                            key={`${sec.id}-${idx}`}
                            className={`rounded-xl border p-2.5 transition ${
                              checked
                                ? 'border-accent/35 bg-surface'
                                : 'border-border-subtle bg-surface/55 opacity-80'
                            }`}
                          >
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <div className="flex items-center gap-2 min-w-0">
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  onChange={() => toggleDraftSelected(sec.id)}
                                  className="h-3.5 w-3.5 accent-accent"
                                  title="是否纳入本次解析"
                                />
                                <select
                                  value={isCanonicalPreset ? sec.title : sec.title}
                                  onChange={(e) => handleChangeDraftLabel(idx, e.target.value)}
                                  className="rounded-lg border border-border-subtle bg-surface-subtle px-2 py-1 text-xs font-semibold text-text-primary focus:border-accent focus:outline-none"
                                >
                                  {!isCanonicalPreset && (
                                    <option value={sec.title}>{sec.title} (当前)</option>
                                  )}
                                  {CANONICAL_SECTION_PRESETS.map((p) => (
                                    <option key={p.label} value={p.label}>
                                      {p.label}
                                    </option>
                                  ))}
                                </select>

                                {statusInfo && (
                                  <span
                                    className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                                      statusInfo.kind === 'unchanged'
                                        ? 'bg-answer-soft text-answer'
                                        : statusInfo.kind === 'error'
                                          ? 'bg-danger-soft text-danger'
                                          : 'bg-vocab-soft text-vocab'
                                    }`}
                                  >
                                    {statusInfo.label}
                                  </span>
                                )}
                              </div>

                              <div className="flex items-center gap-2 text-[11px] text-text-muted">
                                <span>{sec.vocabCount} 词</span>
                                <span>·</span>
                                <span>{sec.rawText.length} 字符</span>
                                {idx > 0 && (
                                  <button
                                    type="button"
                                    onClick={() => handleMergeDraftWithPrev(idx)}
                                    className="inline-flex items-center gap-1 rounded-md border border-border-subtle bg-surface-subtle px-1.5 py-0.5 text-[10.5px] text-text-secondary hover:border-accent hover:text-accent"
                                    title="将此段合并进上一段（修复误切分）"
                                  >
                                    <Merge className="h-3 w-3" />
                                    合并到上一段
                                  </button>
                                )}
                              </div>
                            </div>

                            <p className="mt-1.5 truncate font-mono text-[11px] text-text-muted pl-5">
                              {previewLine || '(空分段)'}
                            </p>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Context Window Bar */}
                <div className="space-y-1 pt-1">
                  <div className="flex justify-between font-mono text-[11px] text-text-muted">
                    <span>预计输入 ~{estimatedTokens.toLocaleString()} tokens</span>
                    <span>
                      上限 {analysisProvider.params.maxInputTokens.toLocaleString()} / 窗口{' '}
                      {analysisProvider.params.contextWindow.toLocaleString()} ({contextRatio}%)
                    </span>
                  </div>
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-border-subtle">
                    <div
                      className={`h-full rounded-full transition-all ${
                        estimatedTokens > analysisProvider.params.maxInputTokens
                          ? 'bg-danger'
                          : 'bg-accent'
                      }`}
                      style={{ width: `${Math.max(2, contextRatio)}%` }}
                    />
                  </div>
                </div>
              </div>

              {/* Primary Action */}
              <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
                <span className="text-xs text-text-muted">
                  {isEditingExisting
                    ? '未勾选的已解析模块将原样复用；也可点击「仅保存原文修改」后再去精读页按需重析单段。'
                    : '提示：确认无误后将按题型并发解析，并自动生成全面词典级生词本。'}
                </span>

                <div className="flex flex-wrap items-center gap-2">
                  {isEditingExisting && (
                    <button
                      type="button"
                      disabled={running || !rawText.trim()}
                      onClick={() => handleStartAnalysis(true)}
                      className="inline-flex items-center gap-1.5 rounded-xl border border-border-subtle bg-surface-subtle px-4 py-2.5 text-xs font-semibold text-text-secondary hover:text-text-primary disabled:opacity-45"
                    >
                      <RefreshCw className="h-3.5 w-3.5" />
                      全量重新解析
                    </button>
                  )}

                  <button
                    type="button"
                    disabled={running || !rawText.trim()}
                    onClick={() => handleStartAnalysis(false)}
                    className="inline-flex items-center gap-2 rounded-xl bg-accent px-5 py-2.5 text-sm font-semibold text-white shadow-xs transition hover:opacity-92 disabled:opacity-45"
                  >
                    <Sparkles className="h-4 w-4" />
                    {parsingMode === 'ai_segmented' && !aiPreviewDrafts
                      ? '由 AI 切分并开始解析'
                      : isEditingExisting
                        ? selectedDraftIds.size === 0
                          ? '保存原文并返回精读'
                          : `增量解析选中模块 (${selectedDraftIds.size}/${effectiveDrafts.length})`
                        : mode === 'image'
                          ? '确认无误，开始深度解析'
                          : '开始 AI 深度解析'}
                    <ArrowRight className="h-4 w-4" />
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
