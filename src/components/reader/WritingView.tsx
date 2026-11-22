import { useState } from 'react';
import {
  BookOpen,
  Check,
  Compass,
  Copy,
  FileText,
  Image as ImageIcon,
  Lightbulb,
  PenTool,
  Quote,
  Sparkles,
} from 'lucide-react';
import type { VocabEntry, WritingSection, WritingTaskItem } from '../../types/exam';
import type { ReadingLayout } from '../../stores/useSettingsStore';
import { MarkedTextRenderer } from './MarkedTextRenderer';

interface Props {
  section: WritingSection;
  vocabulary: VocabEntry[];
  layout: ReadingLayout;
  enTextClass: string;
  activeSurfaceForm?: string | null;
  onSelectVocab: (
    surfaceForm: string,
    sectionId: string,
    anchorEl: HTMLElement,
    entry?: VocabEntry,
  ) => void;
}

function WritingTaskCard({
  task,
  sectionId,
  vocabulary,
  layout,
  enTextClass,
  activeSurfaceForm,
  onSelectVocab,
}: {
  task: WritingTaskItem;
  sectionId: string;
  vocabulary: VocabEntry[];
  layout: ReadingLayout;
  enTextClass: string;
  activeSurfaceForm?: string | null;
  onSelectVocab: Props['onSelectVocab'];
}) {
  const [copiedEssay, setCopiedEssay] = useState(false);

  const handleCopyEssay = async () => {
    const cleanText = [
      task.sampleEssay.title ? task.sampleEssay.title : '',
      ...task.sampleEssay.paragraphs.map((p) => p.en.replace(/\{\{([^{}]+?)\}\}/g, '$1')),
    ]
      .filter(Boolean)
      .join('\n\n');
    try {
      await navigator.clipboard.writeText(cleanText);
      setCopiedEssay(true);
      setTimeout(() => setCopiedEssay(false), 1800);
    } catch {
      // Ignore clipboard permission errors
    }
  };

  const partBadgeStyle =
    task.part === 'part_a'
      ? 'bg-accent-soft text-accent'
      : task.part === 'part_b'
        ? 'bg-answer-soft text-answer'
        : 'bg-vocab-soft text-vocab';

  return (
    <div className="space-y-4">
      {/* 1. 题目与审题要求卡片 */}
      <article className="island p-5 sm:p-6 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border-subtle pb-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`rounded-md px-2.5 py-1 text-xs font-semibold ${partBadgeStyle}`}>
              {task.partLabel || (task.part === 'part_a' ? 'Part A · 小作文' : 'Part B · 大作文')}
            </span>
            {task.number !== undefined && (
              <span className="rounded-md bg-surface-subtle border border-border-subtle px-2 py-0.5 font-mono text-xs font-semibold text-text-secondary">
                第 {task.number} 题
              </span>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="rounded-full border border-border-subtle bg-surface-subtle px-2.5 py-0.5 text-text-secondary">
              {task.guidance.genreAndTone}
            </span>
            <span className="rounded-full border border-accent/25 bg-accent-soft/60 px-2.5 py-0.5 font-medium text-accent">
              {task.guidance.wordCountTarget}
            </span>
          </div>
        </div>

        <div className="space-y-2.5">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-text-muted">
            <FileText className="h-3.5 w-3.5" />
            <span>原题要求 (Directions)</span>
          </div>
          <p className={`${enTextClass} text-text-primary whitespace-pre-line`}>
            <MarkedTextRenderer
              text={task.promptEn}
              sectionId={sectionId}
              vocabulary={vocabulary}
              activeSurfaceForm={activeSurfaceForm}
              onSelectVocab={onSelectVocab}
            />
          </p>
          {layout !== 'english_only' && task.promptZh && (
            <p className="rounded-xl bg-surface-subtle/70 px-3.5 py-2.5 text-xs leading-relaxed text-text-secondary">
              <span className="font-semibold text-text-primary">审题译文：</span>
              {task.promptZh}
            </p>
          )}
        </div>

        {task.visualSummary && (
          <div className="rounded-xl border border-vocab/25 bg-vocab-soft/35 px-4 py-3 space-y-1">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-vocab">
              <ImageIcon className="h-3.5 w-3.5" />
              <span>图画 / 图表核心信息</span>
            </div>
            <p className="text-xs leading-relaxed text-text-secondary">{task.visualSummary}</p>
          </div>
        )}
      </article>

      {/* 2. 写作指导与谋篇布局 */}
      <section className="island p-5 sm:p-6 space-y-4">
        <div className="flex items-center gap-2 border-b border-border-subtle pb-2.5">
          <Compass className="h-4 w-4 text-accent" />
          <h3 className="text-sm font-semibold text-text-primary">审题立意与写作指导</h3>
        </div>

        {/* Core Theme */}
        <div className="rounded-2xl border border-accent/20 bg-accent-soft/40 px-4 py-3 space-y-1">
          <div className="text-xs font-semibold text-accent">核心立意与切入角度</div>
          <p className="text-sm leading-relaxed text-text-primary">{task.guidance.coreThemeZh}</p>
        </div>

        {/* Paragraph-by-paragraph outline */}
        {task.guidance.outline.length > 0 && (
          <div className="space-y-2.5">
            <div className="text-xs font-semibold text-text-muted">分段谋篇大纲</div>
            <div className="grid gap-3 md:grid-cols-3">
              {task.guidance.outline.map((step, idx) => (
                <div
                  key={idx}
                  className="rounded-xl border border-border-subtle bg-surface-subtle/50 p-3.5 space-y-2"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-semibold text-text-primary">
                      {step.paragraphLabel}
                    </span>
                    {step.suggestedWords && (
                      <span className="shrink-0 rounded-md bg-surface px-1.5 py-0.5 font-mono text-[10px] text-text-muted border border-border-subtle">
                        {step.suggestedWords}
                      </span>
                    )}
                  </div>
                  <ul className="space-y-1 pl-4 text-xs leading-relaxed text-text-secondary list-disc">
                    {step.keyPoints.map((pt, pIdx) => (
                      <li key={pIdx}>{pt}</li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Scoring Tips */}
        {task.guidance.scoringTips.length > 0 && (
          <div className="rounded-xl border border-border-subtle bg-surface px-4 py-3 space-y-1.5">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-vocab">
              <Lightbulb className="h-3.5 w-3.5" />
              <span>阅卷得分点与避坑指南</span>
            </div>
            <ul className="space-y-1 pl-4 text-xs leading-relaxed text-text-secondary list-disc">
              {task.guidance.scoringTips.map((tip, idx) => (
                <li key={idx}>{tip}</li>
              ))}
            </ul>
          </div>
        )}
      </section>

      {/* 3. 高分范文 */}
      <section className="island p-5 sm:p-6 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border-subtle pb-3">
          <div className="flex items-center gap-2">
            <PenTool className="h-4 w-4 text-answer" />
            <h3 className="text-sm font-semibold text-text-primary">考场高分范文</h3>
            {task.sampleEssay.wordCount > 0 && (
              <span className="rounded-full bg-answer-soft px-2 py-0.5 font-mono text-[11px] font-medium text-answer">
                约 {task.sampleEssay.wordCount} 词
              </span>
            )}
          </div>
          <button
            type="button"
            onClick={handleCopyEssay}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border-subtle bg-surface-subtle px-2.5 py-1 text-xs font-medium text-text-secondary hover:text-text-primary"
          >
            {copiedEssay ? (
              <>
                <Check className="h-3.5 w-3.5 text-answer" />
                已复制英文范文
              </>
            ) : (
              <>
                <Copy className="h-3.5 w-3.5" />
                复制范文
              </>
            )}
          </button>
        </div>

        {task.sampleEssay.title && (
          <h4 className="text-center font-serif text-lg font-bold text-text-primary">
            {task.sampleEssay.title}
          </h4>
        )}

        <div className="space-y-5">
          {task.sampleEssay.paragraphs.map((p, idx) => (
            <div
              key={p.id || idx}
              className={
                layout === 'split'
                  ? 'grid gap-4 lg:grid-cols-2 lg:gap-8'
                  : 'space-y-2'
              }
            >
              <p className={`${enTextClass} text-text-primary`}>
                <MarkedTextRenderer
                  text={p.en}
                  sectionId={sectionId}
                  vocabulary={vocabulary}
                  activeSurfaceForm={activeSurfaceForm}
                  onSelectVocab={onSelectVocab}
                />
              </p>
              {layout !== 'english_only' && (
                <p className="text-[14.5px] leading-relaxed text-text-secondary">{p.zh}</p>
              )}
            </div>
          ))}
        </div>

        {task.sampleEssay.commentaryZh && (
          <div className="rounded-xl border border-answer/25 bg-answer-soft/35 px-4 py-3 text-xs leading-relaxed text-text-secondary">
            <span className="font-semibold text-answer">范文点评：</span>
            {task.sampleEssay.commentaryZh}
          </div>
        )}
      </section>

      {/* 4. 提分好词与高级替换 */}
      {task.goodWords.length > 0 && (
        <section className="island p-5 sm:p-6 space-y-4">
          <div className="flex items-center justify-between border-b border-border-subtle pb-2.5">
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-vocab" />
              <h3 className="text-sm font-semibold text-text-primary">提分好词与高级表达</h3>
            </div>
            <span className="text-xs text-text-muted">{task.goodWords.length} 个精选表达</span>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            {task.goodWords.map((w, idx) => (
              <div
                key={idx}
                className="rounded-xl border border-border-subtle bg-surface-subtle/45 p-3.5 space-y-1.5"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-serif text-[15px] font-semibold text-text-primary">
                    {w.expression}
                  </span>
                  <div className="flex items-center gap-1.5">
                    {w.posOrType && (
                      <span className="rounded-md bg-surface px-1.5 py-0.5 text-[10px] font-medium text-text-muted border border-border-subtle">
                        {w.posOrType}
                      </span>
                    )}
                    {w.replaces && (
                      <span className="rounded-md bg-vocab-soft px-2 py-0.5 text-[10px] font-medium text-vocab">
                        {w.replaces}
                      </span>
                    )}
                  </div>
                </div>
                <p className="text-xs font-medium text-text-secondary">{w.meaningZh}</p>
                {w.usageExample && (
                  <p className="font-serif text-xs italic leading-relaxed text-text-muted pt-0.5">
                    {w.usageExample}
                  </p>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* 5. 亮点好句与万能句型 */}
      {task.goodSentences.length > 0 && (
        <section className="island p-5 sm:p-6 space-y-4">
          <div className="flex items-center justify-between border-b border-border-subtle pb-2.5">
            <div className="flex items-center gap-2">
              <Quote className="h-4 w-4 text-accent" />
              <h3 className="text-sm font-semibold text-text-primary">亮点好句与可套用句型</h3>
            </div>
            <span className="text-xs text-text-muted">{task.goodSentences.length} 个高分句型</span>
          </div>

          <div className="space-y-3">
            {task.goodSentences.map((s, idx) => (
              <div
                key={idx}
                className="rounded-xl border border-border-subtle border-l-4 border-l-accent/70 bg-surface-subtle/45 p-4 space-y-2"
              >
                <div className="flex items-center gap-2">
                  <span className="inline-flex h-5 w-5 items-center justify-center rounded-md bg-accent/15 font-mono text-[11px] font-bold text-accent">
                    {idx + 1}
                  </span>
                  <span className="rounded-md bg-accent-soft px-2 py-0.5 text-[11px] font-semibold text-accent">
                    {s.pattern}
                  </span>
                </div>
                <p className="font-serif text-[15.5px] leading-relaxed text-text-primary">
                  <MarkedTextRenderer
                    text={s.en}
                    sectionId={sectionId}
                    vocabulary={vocabulary}
                    activeSurfaceForm={activeSurfaceForm}
                    onSelectVocab={onSelectVocab}
                  />
                </p>
                <p className="text-xs leading-relaxed text-text-secondary">{s.zh}</p>
                {s.explanationZh && (
                  <div className="flex items-start gap-1.5 pt-0.5 text-[11.5px] leading-relaxed text-text-muted">
                    <BookOpen className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent" />
                    <span>{s.explanationZh}</span>
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

export function WritingView({
  section,
  vocabulary,
  layout,
  enTextClass,
  activeSurfaceForm,
  onSelectVocab,
}: Props) {
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2 px-1">
        <span className="rounded-md bg-accent-soft px-2.5 py-1 text-xs font-semibold text-accent">
          Section III · 写作精讲（指导 / 范文 / 好词好句）
        </span>
        <h2 className="text-base font-semibold text-text-primary">{section.title}</h2>
      </div>

      {section.tasks.map((task, idx) => (
        <WritingTaskCard
          key={`${task.part}-${task.number ?? idx}`}
          task={task}
          sectionId={section.id}
          vocabulary={vocabulary}
          layout={layout}
          enTextClass={enTextClass}
          activeSurfaceForm={activeSurfaceForm}
          onSelectVocab={onSelectVocab}
        />
      ))}
    </div>
  );
}
