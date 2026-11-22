import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Eye,
  FileText,
  Highlighter,
  Image as ImageIcon,
  RotateCw,
  Save,
  ScanText,
  Settings,
  Sparkles,
  Trash2,
  Underline,
  Upload,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import type { ExamPaper, ExamSection, StoredImage } from '../types/exam';
import { useSettingsStore } from '../stores/useSettingsStore';
import { useTaskStore } from '../stores/useTaskStore';
import {
  estimateImageTokens,
  estimateTextTokens,
  listMarkedVocabTokens,
  splitPaperIntoSections,
} from '../lib/pipeline/pre-parser';
import {
  blobsToAttachments,
  formatByteSize,
  preprocessExamImage,
} from '../lib/pipeline/image-prep';
import {
  runOcrStage,
  runPaperAnalysisPipeline,
} from '../lib/pipeline/analyzer';
import { db } from '../lib/db';
import { ExecutionTimeline } from '../components/common/ExecutionTimeline';

interface LocalImageItem {
  id: string;
  name: string;
  blob: Blob;
  previewUrl: string;
  width: number;
  height: number;
  originalBytes?: number;
  compressedBytes: number;
}

const SECTION_TYPE_OPTIONS: Array<{ value: ExamSection['type'] | 'auto'; label: string }> = [
  { value: 'auto', label: '自动识别题型与分段（推荐）' },
  { value: 'cloze', label: '强制按「Section I 完形填空」解析' },
  { value: 'reading', label: '强制按「Section II Part A 传统阅读」解析' },
  { value: 'new_type', label: '强制按「Section II Part B 新题型」解析' },
  { value: 'translation', label: '强制按「Section II Part C 翻译（含句法）」解析' },
  { value: 'writing', label: '强制按「Section III 写作（指导/范文/好词好句）」解析' },
  { value: 'general', label: '按「通用双语精读」解析' },
];

export function ImportPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const draftId = searchParams.get('draft');

  const { getAnalysisProvider, getVisionProvider, concurrency } = useSettingsStore();
  const { running } = useTaskStore();

  const analysisProvider = getAnalysisProvider();
  const visionProvider = getVisionProvider();

  const [mode, setMode] = useState<'text' | 'image'>('text');
  const [title, setTitle] = useState('');
  const [examType, setExamType] = useState<ExamPaper['examType']>('english_1');
  const [forcedSectionType, setForcedSectionType] = useState<ExamSection['type'] | 'auto'>('auto');
  const [rawText, setRawText] = useState('');

  // Image OCR state
  const [images, setImages] = useState<LocalImageItem[]>([]);
  const [ocrStage, setOcrStage] = useState<'upload' | 'review'>('upload');
  const [activeImageIdx, setActiveImageIdx] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [draftPaperId, setDraftPaperId] = useState<string | undefined>(undefined);
  const [draftSavedTip, setDraftSavedTip] = useState(false);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Load existing OCR draft if ?draft=... is present
  useEffect(() => {
    if (!draftId) return;
    (async () => {
      const paper = await db.papers.get(draftId);
      if (!paper) return;
      setDraftPaperId(paper.id);
      setTitle(paper.title);
      setExamType(paper.examType);
      setRawText(paper.rawMarkedText);
      const storedImgs = await db.images.where('paperId').equals(paper.id).sortBy('order');
      if (storedImgs.length > 0) {
        setImages(
          storedImgs.map((img) => ({
            id: img.id,
            name: img.name,
            blob: img.blob,
            previewUrl: URL.createObjectURL(img.blob),
            width: img.width,
            height: img.height,
            compressedBytes: img.blob.size,
          })),
        );
        setMode('image');
        setOcrStage('review');
      } else {
        setMode('text');
      }
    })();
  }, [draftId]);

  // Support Ctrl+V image paste anywhere in image mode
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
  const sectionsDraft = useMemo(
    () => splitPaperIntoSections(rawText, forcedSectionType),
    [rawText, forcedSectionType],
  );
  const estimatedTokens = useMemo(() => estimateTextTokens(rawText), [rawText]);
  const estimatedImgTokens = useMemo(
    () => estimateImageTokens(images.length, visionProvider.params.imageDetail),
    [images.length, visionProvider.params.imageDetail],
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
      });
    }
    setImages((prev) => [...prev, ...processed]);
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
    setRawText(next);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(start, start + replacement.length);
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
    setRawText(next);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(start, start + replacement.length);
    });
  };

  const saveOcrDraftToDb = async (ocrText: string): Promise<string> => {
    const paperId = draftPaperId || `paper-${crypto.randomUUID().slice(0, 10)}`;
    setDraftPaperId(paperId);
    const now = Date.now();

    const storedImgs: StoredImage[] = images.map((img, idx) => ({
      id: img.id,
      paperId,
      order: idx,
      name: img.name,
      mimeType: img.blob.type || 'image/jpeg',
      width: img.width,
      height: img.height,
      blob: img.blob,
      createdAt: now,
    }));

    await db.transaction('rw', db.papers, db.images, async () => {
      await db.images.where('paperId').equals(paperId).delete();
      if (storedImgs.length > 0) await db.images.bulkPut(storedImgs);
      await db.papers.put({
        id: paperId,
        title: title.trim() || `拍照试卷草稿 (${new Date().toLocaleDateString()})`,
        examType,
        createdAt: now,
        updatedAt: now,
        status: 'ocr_draft',
        sourceMode: 'image',
        rawMarkedText: ocrText,
        sourceImageIds: storedImgs.map((i) => i.id),
        sections: [],
        vocabulary: [],
        analysisMeta: {
          providerName: analysisProvider.name,
          modelId: analysisProvider.modelId,
          ocrModelId: visionProvider.modelId,
        },
      });
    });

    return paperId;
  };

  /** Stage 1: Run OCR Only -> Enter Intermediate Review Workbench */
  const handleRunOcrOnly = async () => {
    if (images.length === 0) return;
    try {
      const attachments = await blobsToAttachments(images);
      const ocrText = await runOcrStage({
        visionProvider,
        images: attachments,
        batchSize: 2,
      });
      setRawText(ocrText);
      await saveOcrDraftToDb(ocrText);
      setOcrStage('review');
      setActiveImageIdx(0);
      setZoom(1);
    } catch {
      // Error is displayed in ExecutionTimeline with full raw response diagnostics
    }
  };

  /** Stage 2: Run Deep Analysis Pipeline (shared by Text mode & OCR Review confirmed mode!) */
  const handleStartAnalysis = async () => {
    if (!rawText.trim() || sectionsDraft.length === 0) return;

    let paperId = draftPaperId;
    if (mode === 'image' && images.length > 0) {
      paperId = await saveOcrDraftToDb(rawText);
    }

    const paper = await runPaperAnalysisPipeline({
      paperId,
      title:
        title.trim() ||
        sectionsDraft[0]?.title ||
        `考研英语精读 (${new Date().toLocaleDateString()})`,
      examType,
      sourceMode: mode,
      rawMarkedText: rawText,
      sourceImageIds: images.map((i) => i.id),
      sectionsDraft,
      provider: analysisProvider,
      ocrModelId: mode === 'image' ? visionProvider.modelId : undefined,
      concurrency,
    });

    navigate(`/paper/${paper.id}`);
  };

  const contextRatio = Math.min(
    100,
    Math.round((estimatedTokens / Math.max(1, analysisProvider.params.contextWindow)) * 100),
  );

  return (
    <div className="space-y-4">
      {/* Top Mode Switcher Island */}
      <div className="island p-5 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-text-primary">导入考研英语试卷</h1>
          <p className="mt-0.5 text-xs text-text-secondary">
            文本输入直接解析；图像输入先走「纯 OCR 中间校对态」核对红笔方框生词与订正答案，确认无误后再解析。
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
            文本输入（{'{{生词}}'}）
          </button>
          <button
            type="button"
            onClick={() => setMode('image')}
            className={`inline-flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-xs font-semibold transition ${
              mode === 'image'
                ? 'bg-surface text-text-primary shadow-xs'
                : 'text-text-secondary hover:text-text-primary'
            }`}
          >
            <ImageIcon className="h-3.5 w-3.5" />
            图像 OCR → 校对 → 解析
          </button>
        </div>
      </div>

      {/* Live Agent Execution Timeline (OCR or Analysis progress + thinking stream + raw errors) */}
      <ExecutionTimeline />

      {/* Paper Metadata Bar */}
      <div className="island p-4 grid gap-3 sm:grid-cols-3">
        <div className="sm:col-span-1">
          <label className="block text-xs font-medium text-text-secondary mb-1">试卷标题</label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="例如：2024 考研英语（一）Text 1-4"
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
          <label className="block text-xs font-medium text-text-secondary mb-1">题型切分方式</label>
          <select
            value={forcedSectionType}
            onChange={(e) => setForcedSectionType(e.target.value as ExamSection['type'] | 'auto')}
            className="w-full rounded-xl border border-border-subtle bg-surface-subtle px-3 py-2 text-sm text-text-primary focus:border-accent focus:outline-none"
          >
            {SECTION_TYPE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* ==================== MODE B: IMAGE UPLOAD (Stage 1) ==================== */}
      {mode === 'image' && ocrStage === 'upload' && (
        <div className="island p-5 sm:p-6 space-y-5">
          {/* Vision slot status banner */}
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border-subtle bg-surface-subtle px-4 py-2.5 text-xs">
            <div className="flex items-center gap-2">
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
            className="cursor-pointer rounded-2xl border-2 border-dashed border-border-strong bg-surface-subtle/50 p-8 text-center transition hover:border-accent hover:bg-accent-soft/20"
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
            <Upload className="mx-auto h-8 w-8 text-accent" />
            <p className="mt-2.5 text-sm font-semibold text-text-primary">
              点击选择、拖拽上传，或直接 Ctrl+V 粘贴试卷图片
            </p>
            <p className="mt-1 text-xs text-text-secondary">
              支持多页连拍（保留彩色通道清晰识别红笔方框生词与红笔订正答案，前端自动压缩至 2048px 以内）
            </p>
          </div>

          {/* Image Thumbnails Grid */}
          {images.length > 0 && (
            <div className="space-y-3">
              <div className="flex items-center justify-between text-xs text-text-secondary">
                <span>
                  已添加 {images.length} 张试卷照片 · 压缩后共{' '}
                  <strong className="font-mono text-text-primary">
                    {formatByteSize(images.reduce((sum, item) => sum + item.compressedBytes, 0))}
                  </strong>{' '}
                  （Base64 分批直传，每批 2 页，约 {estimatedImgTokens.toLocaleString()} 视觉 Token）
                </span>
                {rawText.trim() && (
                  <button
                    type="button"
                    onClick={() => setOcrStage('review')}
                    className="font-medium text-accent hover:underline"
                  >
                    返回已识别的校对稿 →
                  </button>
                )}
              </div>

              <div className="grid gap-3 grid-cols-2 sm:grid-cols-3 md:grid-cols-4">
                {images.map((img, idx) => (
                  <div
                    key={img.id}
                    className="group relative overflow-hidden rounded-xl border border-border-subtle bg-surface-subtle"
                  >
                    <img
                      src={img.previewUrl}
                      alt={img.name}
                      className="h-44 w-full object-cover"
                    />
                    <div className="flex items-center justify-between px-2.5 py-1.5 text-[11px] text-text-secondary bg-surface/90">
                      <span
                        className="truncate font-mono"
                        title={
                          img.originalBytes
                            ? `原始 ${formatByteSize(img.originalBytes)} → 压缩后 ${formatByteSize(img.compressedBytes)} (${img.width}×${img.height})`
                            : `${formatByteSize(img.compressedBytes)} (${img.width}×${img.height})`
                        }
                      >
                        P{idx + 1} · {formatByteSize(img.compressedBytes)}
                        {img.originalBytes && img.originalBytes > img.compressedBytes * 1.5
                          ? ` (原${formatByteSize(img.originalBytes)})`
                          : ''}
                      </span>
                      <div className="flex items-center gap-1">
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

              <div className="flex justify-end pt-2">
                <button
                  type="button"
                  disabled={running || !visionProvider.capabilities.vision}
                  onClick={handleRunOcrOnly}
                  className="inline-flex items-center gap-2 rounded-xl bg-accent px-5 py-2.5 text-sm font-semibold text-white shadow-xs transition hover:opacity-92 disabled:opacity-45"
                >
                  <ScanText className="h-4 w-4" />
                  Stage 1：仅 OCR 识图（生成校对稿）
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ==================== TEXT MODE OR OCR INTERMEDIATE REVIEW WORKBENCH ==================== */}
      {(mode === 'text' || ocrStage === 'review') && (
        <div
          className={
            mode === 'image' && ocrStage === 'review' && images.length > 0
              ? 'grid gap-4 xl:grid-cols-2'
              : 'space-y-4'
          }
        >
          {/* Left Pane (Only in OCR Intermediate Review Mode): Zoomable Original Exam Image Viewer */}
          {mode === 'image' && ocrStage === 'review' && images.length > 0 && (
            <div className="island p-4 flex flex-col gap-3 xl:sticky xl:top-4 xl:h-[calc(100vh-8rem)]">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border-subtle pb-2.5">
                <div className="flex items-center gap-2">
                  <span className="rounded-md bg-vocab-soft px-2 py-0.5 text-xs font-semibold text-vocab">
                    OCR 中间校对态 · 原图对照
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
                    重选图片
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
                        idx === activeImageIdx ? 'border-accent' : 'border-transparent opacity-65 hover:opacity-100'
                      }`}
                    >
                      <img src={img.previewUrl} alt={`P${idx + 1}`} className="h-14 w-12 object-cover" />
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Right/Main Pane: Marked Text Editor + Pre-parse Summary + Launch Stage 2 */}
          <div className="island p-5 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-semibold text-text-primary">
                  {mode === 'image' ? 'OCR 识别文本（请核对红框生词与订正答案）' : '粘贴试卷文本'}
                </h2>
                <span className="rounded-full bg-vocab-soft px-2.5 py-0.5 text-xs font-medium text-vocab">
                  已标生词 {markedVocabs.length}
                </span>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleToggleVocabWrap}
                  className="inline-flex items-center gap-1 rounded-lg border border-vocab/30 bg-vocab-soft/70 px-2.5 py-1 text-xs font-medium text-vocab hover:bg-vocab-soft"
                  title="选中任意单词后点击或按 Ctrl+M 快速包裹/取消 {{}}"
                >
                  <Highlighter className="h-3.5 w-3.5" />
                  标记/取消 {'{{生词}}'} (Ctrl+M)
                </button>

                <button
                  type="button"
                  onClick={handleToggleUnderlineWrap}
                  className="inline-flex items-center gap-1 rounded-lg border border-accent/30 bg-accent-soft/60 px-2.5 py-1 text-xs font-medium text-accent hover:bg-accent-soft"
                  title="选中 Part C 翻译划线句后点击快速包裹/取消 <u>...</u>"
                >
                  <Underline className="h-3.5 w-3.5" />
                  标记翻译划线句
                </button>

                {mode === 'image' && (
                  <button
                    type="button"
                    onClick={async () => {
                      await saveOcrDraftToDb(rawText);
                      setDraftSavedTip(true);
                      setTimeout(() => setDraftSavedTip(false), 1800);
                    }}
                    className="inline-flex items-center gap-1 rounded-lg border border-border-subtle bg-surface-subtle px-2.5 py-1 text-xs font-medium text-text-secondary hover:text-text-primary"
                  >
                    {draftSavedTip ? (
                      <CheckCircle2 className="h-3.5 w-3.5 text-answer" />
                    ) : (
                      <Save className="h-3.5 w-3.5" />
                    )}
                    {draftSavedTip ? '已存草稿' : '保存草稿'}
                  </button>
                )}
              </div>
            </div>

            <textarea
              ref={textareaRef}
              value={rawText}
              onChange={(e) => setRawText(e.target.value)}
              onKeyDown={(e) => {
                if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'm') {
                  e.preventDefault();
                  handleToggleVocabWrap();
                }
              }}
              rows={mode === 'image' ? 18 : 15}
              placeholder={`在此粘贴考研英语试卷文本（单篇或整套均可），生词请用双花括号包裹，例如：\n\nText 1\nFor decades, urban planners assumed widening highways would {{alleviate}} congestion...\n\n若卷面已订正答案，可附注：[ANSWER: 21=C]`}
              className="w-full rounded-2xl border border-border-subtle bg-surface-subtle/70 p-4 font-mono text-[13.5px] leading-relaxed text-text-primary placeholder:text-text-muted focus:border-accent focus:outline-none"
            />

            {/* Detected Marked Vocab Chips */}
            {markedVocabs.length > 0 && (
              <div className="space-y-1.5">
                <div className="text-xs font-medium text-text-muted">
                  已检测到 {markedVocabs.length} 个标记生词（本地精确提取，确保 0 遗漏）：
                </div>
                <div className="flex flex-wrap gap-1.5 max-h-28 overflow-y-auto">
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

            {/* Auto-Detected Sections Preview & Token Estimate */}
            <div className="rounded-xl border border-border-subtle bg-surface-subtle/60 p-3.5 space-y-2.5 text-xs">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-medium text-text-primary">
                  预解析切分预览：{sectionsDraft.length} 个模块
                </span>
                <span className="font-mono text-text-muted">
                  主分析模型：{analysisProvider.name} · {analysisProvider.modelId}
                </span>
              </div>

              {sectionsDraft.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {sectionsDraft.map((s) => (
                    <span
                      key={s.id}
                      className="inline-flex items-center gap-1 rounded-lg bg-surface px-2.5 py-1 border border-border-subtle text-text-secondary"
                    >
                      <span className="font-semibold text-accent">
                        {s.type === 'cloze'
                          ? '完形'
                          : s.type === 'reading'
                            ? '阅读'
                            : s.type === 'new_type'
                              ? '新题型'
                              : s.type === 'translation'
                                ? '翻译(含句法)'
                                : s.type === 'writing'
                                  ? '写作(指导+范文)'
                                  : '精读'}
                      </span>
                      <span className="truncate max-w-[180px]">{s.title}</span>
                    </span>
                  ))}
                </div>
              )}

              {/* Context Window Bar */}
              <div className="space-y-1">
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
                提示：确认无误后将按题型并发解析，并自动生成全面词典级生词本。
              </span>
              <button
                type="button"
                disabled={running || !rawText.trim()}
                onClick={handleStartAnalysis}
                className="inline-flex items-center gap-2 rounded-xl bg-accent px-5 py-2.5 text-sm font-semibold text-white shadow-xs transition hover:opacity-92 disabled:opacity-45"
              >
                <Sparkles className="h-4 w-4" />
                {mode === 'image' ? '确认无误，开始深度解析' : '开始 AI 深度解析'}
                <ArrowRight className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
