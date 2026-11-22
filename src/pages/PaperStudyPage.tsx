import { useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  AlertCircle,
  BookMarked,
  BookOpen,
  Columns2,
  Loader2,
  RefreshCw,
  Rows3,
  Type,
} from 'lucide-react';
import { db } from '../lib/db';
import {
  useSettingsStore,
  type FontSize,
  type ReadingLayout,
} from '../stores/useSettingsStore';
import { useTaskStore } from '../stores/useTaskStore';
import { retrySingleSection } from '../lib/pipeline/analyzer';
import type { VocabEntry } from '../types/exam';
import { ClozeView } from '../components/reader/ClozeView';
import { ReadingView } from '../components/reader/ReadingView';
import { NewTypeView } from '../components/reader/NewTypeView';
import { TranslationSyntaxCard } from '../components/reader/TranslationSyntaxCard';
import { MarkedTextRenderer } from '../components/reader/MarkedTextRenderer';
import {
  WordPopoverCard,
  type ActiveWordPopup,
} from '../components/reader/WordPopoverCard';
import { VocabBookView } from '../components/vocab/VocabBookView';
import { ExecutionTimeline } from '../components/common/ExecutionTimeline';

export function PaperStudyPage() {
  const { id } = useParams<{ id: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = searchParams.get('tab') === 'vocab' ? 'vocab' : 'reading';

  const paper = useLiveQuery(() => (id ? db.papers.get(id) : undefined), [id]);
  const {
    readingLayout,
    setReadingLayout,
    fontStyle,
    setFontStyle,
    fontSize,
    setFontSize,
    getAnalysisProvider,
  } = useSettingsStore();
  const { running } = useTaskStore();

  const [selectedSectionId, setSelectedSectionId] = useState<string | null>(null);
  const [wordPopup, setWordPopup] = useState<ActiveWordPopup | null>(null);
  const [highlightedVocabId, setHighlightedVocabId] = useState<string | null>(null);

  const activeSection = useMemo(() => {
    if (!paper || paper.sections.length === 0) return null;
    if (selectedSectionId) {
      const found = paper.sections.find((s) => s.id === selectedSectionId);
      if (found) return found;
    }
    return paper.sections[0];
  }, [paper, selectedSectionId]);

  const enTextClass = useMemo(() => {
    const family = fontStyle === 'serif' ? 'font-serif' : 'font-sans';
    const size =
      fontSize === 'sm'
        ? 'text-[15.5px] leading-[1.8]'
        : fontSize === 'lg'
          ? 'text-[19px] leading-[1.9]'
          : 'text-[17.5px] leading-[1.85]';
    return `${family} ${size}`;
  }, [fontStyle, fontSize]);

  const setTab = (tab: 'reading' | 'vocab') => {
    setWordPopup(null);
    setSearchParams(tab === 'vocab' ? { tab: 'vocab' } : {});
  };

  const handleSelectVocab = (
    surfaceForm: string,
    sectionId: string,
    anchorEl: HTMLElement,
    entry?: VocabEntry,
  ) => {
    setWordPopup({ surfaceForm, sectionId, anchorEl, entry });
  };

  const handleJumpToVocab = (vocabId: string) => {
    setHighlightedVocabId(vocabId);
    setTab('vocab');
    setTimeout(() => {
      document
        .getElementById(`vocab-card-${vocabId}`)
        ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 120);
  };

  const handleJumpToSection = (sectionId: string) => {
    setSelectedSectionId(sectionId);
    setTab('reading');
  };

  const handleRetrySection = async (sectionId: string) => {
    if (!paper) return;
    try {
      await retrySingleSection(paper, sectionId, getAnalysisProvider());
    } catch {
      // Error surfaced cleanly in ExecutionTimeline
    }
  };

  if (paper === undefined) {
    return (
      <div className="island p-12 text-center text-sm text-text-muted">加载试卷中...</div>
    );
  }

  if (!paper) {
    return (
      <div className="island p-12 text-center space-y-3">
        <p className="text-sm text-text-secondary">未找到该套试卷，可能已被删除。</p>
        <Link
          to="/"
          className="inline-flex rounded-xl bg-accent px-4 py-2 text-xs font-medium text-white"
        >
          返回试卷库
        </Link>
      </div>
    );
  }

  const layoutOptions: Array<{ value: ReadingLayout; label: string; icon: typeof Rows3 }> = [
    { value: 'stacked', label: '逐段对照', icon: Rows3 },
    { value: 'split', label: '双栏对照', icon: Columns2 },
    { value: 'english_only', label: '纯英文', icon: Type },
  ];

  return (
    <div className="space-y-4">
      {/* Top Sticky Control Bar Island (Hidden when printing vocab book) */}
      <header className="no-print island sticky top-3 z-20 px-4 py-3 flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="truncate text-base font-bold text-text-primary">{paper.title}</h1>
          <div className="flex flex-wrap items-center gap-2 text-[11px] text-text-muted">
            <span>{paper.sections.length} 个题型模块</span>
            <span>·</span>
            <span>{paper.vocabulary.length} 个生词</span>
            {paper.analysisMeta?.modelId && (
              <>
                <span>·</span>
                <span className="font-mono">{paper.analysisMeta.modelId}</span>
              </>
            )}
          </div>
        </div>

        {/* Two-Part Primary Switcher: 文章翻译与解析 | 本卷生词本 */}
        <div className="inline-flex rounded-xl border border-border-subtle bg-surface-subtle p-1">
          <button
            type="button"
            onClick={() => setTab('reading')}
            className={`inline-flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-xs font-semibold transition ${
              activeTab === 'reading'
                ? 'bg-surface text-accent shadow-xs'
                : 'text-text-secondary hover:text-text-primary'
            }`}
          >
            <BookOpen className="h-3.5 w-3.5" />
            文章翻译与解析
          </button>
          <button
            type="button"
            onClick={() => setTab('vocab')}
            className={`inline-flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-xs font-semibold transition ${
              activeTab === 'vocab'
                ? 'bg-surface text-vocab shadow-xs'
                : 'text-text-secondary hover:text-text-primary'
            }`}
          >
            <BookMarked className="h-3.5 w-3.5" />
            本卷生词本
            <span className="rounded-full bg-vocab-soft px-1.5 py-0.2 font-mono text-[10px] text-vocab">
              {paper.vocabulary.length}
            </span>
          </button>
        </div>

        {/* Reading Controls (visible in reading tab) */}
        {activeTab === 'reading' && (
          <div className="flex flex-wrap items-center gap-1.5">
            <div className="inline-flex rounded-lg border border-border-subtle bg-surface-subtle p-0.5">
              {layoutOptions.map((opt) => {
                const Icon = opt.icon;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setReadingLayout(opt.value)}
                    title={opt.label}
                    className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium transition ${
                      readingLayout === opt.value
                        ? 'bg-surface text-text-primary shadow-2xs'
                        : 'text-text-muted hover:text-text-primary'
                    }`}
                  >
                    <Icon className="h-3.5 w-3.5" />
                    <span className="hidden sm:inline">{opt.label}</span>
                  </button>
                );
              })}
            </div>

            <button
              type="button"
              onClick={() => setFontStyle(fontStyle === 'serif' ? 'sans' : 'serif')}
              className="rounded-lg border border-border-subtle bg-surface-subtle px-2 py-1 text-[11px] font-medium text-text-secondary hover:text-text-primary"
              title="切换英文字体（衬线/无衬线）"
            >
              {fontStyle === 'serif' ? '衬线' : '无衬线'}
            </button>

            <div className="inline-flex rounded-lg border border-border-subtle bg-surface-subtle p-0.5">
              {(['sm', 'md', 'lg'] as FontSize[]).map((sz) => (
                <button
                  key={sz}
                  type="button"
                  onClick={() => setFontSize(sz)}
                  className={`rounded px-1.5 py-0.5 text-[11px] font-mono transition ${
                    fontSize === sz
                      ? 'bg-surface font-bold text-text-primary'
                      : 'text-text-muted hover:text-text-primary'
                  }`}
                >
                  {sz === 'sm' ? 'A-' : sz === 'md' ? 'A' : 'A+'}
                </button>
              ))}
            </div>
          </div>
        )}
      </header>

      {/* Live Execution Timeline if retrying or still streaming */}
      <ExecutionTimeline />

      {/* ==================== TAB A: ARTICLE TRANSLATION & ANALYSIS ==================== */}
      {activeTab === 'reading' && (
        <div className="space-y-4">
          {/* Section Pill Tabs */}
          {paper.sections.length > 1 && (
            <div className="no-print flex items-center gap-2 overflow-x-auto pb-1">
              {paper.sections.map((sec) => {
                const isSelected = activeSection?.id === sec.id;
                return (
                  <button
                    key={sec.id}
                    type="button"
                    onClick={() => {
                      setWordPopup(null);
                      setSelectedSectionId(sec.id);
                    }}
                    className={`inline-flex shrink-0 items-center gap-1.5 rounded-xl border px-3.5 py-2 text-xs font-medium transition ${
                      isSelected
                        ? 'border-accent bg-accent text-white shadow-xs'
                        : 'border-border-subtle bg-surface text-text-secondary hover:border-border-strong hover:text-text-primary'
                    }`}
                  >
                    {sec.status === 'error' && <AlertCircle className="h-3.5 w-3.5 text-danger" />}
                    {sec.status === 'pending' && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                    <span>{sec.title}</span>
                  </button>
                );
              })}
            </div>
          )}

          {/* Active Section Content */}
          {!activeSection ? (
            <div className="island p-10 text-center space-y-3">
              <p className="text-sm text-text-secondary">
                该试卷暂无解析内容（可能处于 OCR 草稿状态）。
              </p>
              <Link
                to={`/import?draft=${paper.id}`}
                className="inline-flex rounded-xl bg-accent px-4 py-2 text-xs font-medium text-white"
              >
                前往校对并解析
              </Link>
            </div>
          ) : activeSection.status === 'error' ? (
            <div className="island p-6 space-y-3 border-danger/30">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-danger font-semibold text-sm">
                  <AlertCircle className="h-4 w-4" />
                  <span>「{activeSection.title}」解析失败</span>
                </div>
                <button
                  type="button"
                  disabled={running}
                  onClick={() => handleRetrySection(activeSection.id)}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-accent px-3.5 py-1.5 text-xs font-medium text-white hover:opacity-90 disabled:opacity-45"
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                  仅重试此段
                </button>
              </div>
              {activeSection.errorMessage && (
                <p className="rounded-xl bg-danger-soft/50 p-3 font-mono text-xs text-text-primary break-all">
                  {activeSection.errorMessage}
                </p>
              )}
            </div>
          ) : activeSection.type === 'cloze' ? (
            <ClozeView
              section={activeSection}
              vocabulary={paper.vocabulary}
              layout={readingLayout}
              enTextClass={enTextClass}
              activeSurfaceForm={wordPopup?.surfaceForm}
              onSelectVocab={handleSelectVocab}
            />
          ) : activeSection.type === 'reading' ? (
            <ReadingView
              section={activeSection}
              vocabulary={paper.vocabulary}
              layout={readingLayout}
              enTextClass={enTextClass}
              activeSurfaceForm={wordPopup?.surfaceForm}
              onSelectVocab={handleSelectVocab}
            />
          ) : activeSection.type === 'new_type' ? (
            <NewTypeView
              section={activeSection}
              vocabulary={paper.vocabulary}
              layout={readingLayout}
              enTextClass={enTextClass}
              activeSurfaceForm={wordPopup?.surfaceForm}
              onSelectVocab={handleSelectVocab}
            />
          ) : activeSection.type === 'translation' ? (
            <TranslationSyntaxCard
              section={activeSection}
              vocabulary={paper.vocabulary}
              layout={readingLayout}
              enTextClass={enTextClass}
              activeSurfaceForm={wordPopup?.surfaceForm}
              onSelectVocab={handleSelectVocab}
            />
          ) : (
            <div className="island p-5 sm:p-7 space-y-6">
              <h2 className="text-lg font-semibold text-text-primary border-b border-border-subtle pb-3">
                {activeSection.title}
              </h2>
              <div className="space-y-6">
                {activeSection.paragraphs.map((p, idx) => (
                  <div
                    key={p.id || idx}
                    className={
                      readingLayout === 'split'
                        ? 'grid gap-5 lg:grid-cols-2 lg:gap-8'
                        : 'space-y-2.5'
                    }
                  >
                    <p className={`${enTextClass} text-text-primary`}>
                      <MarkedTextRenderer
                        text={p.en}
                        sectionId={activeSection.id}
                        vocabulary={paper.vocabulary}
                        activeSurfaceForm={wordPopup?.surfaceForm}
                        onSelectVocab={handleSelectVocab}
                      />
                    </p>
                    {readingLayout !== 'english_only' && (
                      <p className="text-[15px] leading-relaxed text-text-secondary">{p.zh}</p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Floating Interactive Word Popover Card */}
          <WordPopoverCard
            popup={wordPopup}
            onClose={() => setWordPopup(null)}
            onJumpToVocab={handleJumpToVocab}
          />
        </div>
      )}

      {/* ==================== TAB B: PAPER VOCABULARY BOOK ==================== */}
      {activeTab === 'vocab' && (
        <VocabBookView
          title={paper.title}
          vocabulary={paper.vocabulary}
          highlightedVocabId={highlightedVocabId}
          onJumpToSection={handleJumpToSection}
        />
      )}
    </div>
  );
}
