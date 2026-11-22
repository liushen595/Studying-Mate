import { CheckCircle2 } from 'lucide-react';
import type { ReadingSection, VocabEntry } from '../../types/exam';
import type { ReadingLayout } from '../../stores/useSettingsStore';
import { MarkedTextRenderer } from './MarkedTextRenderer';

interface Props {
  section: ReadingSection;
  vocabulary: VocabEntry[];
  layout: ReadingLayout;
  enTextClass: string;
  activeSurfaceForm?: string | null;
  onSelectVocab: (surfaceForm: string, sectionId: string, anchorEl: HTMLElement, entry?: VocabEntry) => void;
}

export function ReadingView({
  section,
  vocabulary,
  layout,
  enTextClass,
  activeSurfaceForm,
  onSelectVocab,
}: Props) {
  return (
    <div className="space-y-5">
      <div className="island p-5 sm:p-7 space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border-subtle pb-3">
          <div>
            <span className="rounded-md bg-accent-soft px-2 py-0.5 text-xs font-semibold text-accent">
              传统阅读理解
            </span>
            <h2 className="mt-1.5 text-lg font-semibold text-text-primary">{section.title}</h2>
          </div>
          <span className="text-xs text-text-muted">点击虚线下划线生词查看释义卡片</span>
        </div>

        <div className="space-y-6">
          {section.paragraphs.map((p, idx) => (
            <div
              key={p.id || idx}
              className={
                layout === 'split'
                  ? 'grid gap-5 lg:grid-cols-2 lg:gap-8'
                  : 'space-y-2.5'
              }
            >
              <p className={`${enTextClass} text-text-primary`}>
                <span className="mr-2 inline-block select-none font-mono text-xs text-text-muted">
                  ¶{idx + 1}
                </span>
                <MarkedTextRenderer
                  text={p.en}
                  sectionId={section.id}
                  vocabulary={vocabulary}
                  activeSurfaceForm={activeSurfaceForm}
                  onSelectVocab={onSelectVocab}
                />
              </p>

              {layout !== 'english_only' && (
                <p className="text-[15px] leading-relaxed text-text-secondary">
                  {p.zh}
                </p>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Compact Questions & Answers */}
      {section.questions.length > 0 && (
        <div className="island p-5 sm:p-6 space-y-4">
          <h3 className="text-sm font-semibold text-text-primary">
            题目与答案（{section.questions.length} 题）
          </h3>
          <div className="space-y-4">
            {section.questions.map((q) => (
              <div
                key={q.number}
                className="rounded-xl border border-border-subtle bg-surface-subtle/50 p-4 space-y-2.5"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="space-y-1">
                    <p className="font-serif text-[15.5px] font-medium text-text-primary">
                      <span className="mr-1.5 font-mono text-xs font-bold text-accent">
                        {q.number}.
                      </span>
                      {q.stemEn}
                    </p>
                    {layout !== 'english_only' && (
                      <p className="text-xs text-text-secondary">{q.stemZh}</p>
                    )}
                  </div>
                  <span className="shrink-0 rounded-full bg-answer-soft px-2.5 py-0.5 text-xs font-semibold text-answer">
                    答案 {q.correctOption}
                    <span className="ml-1 font-normal opacity-80">
                      ({q.answerSource === 'paper_marked' ? '卷面' : 'AI'})
                    </span>
                  </span>
                </div>

                <div className="grid gap-1.5 sm:grid-cols-2">
                  {q.options.map((opt) => {
                    const isCorrect = opt.label === q.correctOption;
                    return (
                      <div
                        key={opt.label}
                        className={`rounded-lg border px-3 py-2 text-xs transition ${
                          isCorrect
                            ? 'border-answer/40 bg-answer-soft/60 text-text-primary'
                            : 'border-border-subtle bg-surface/60 text-text-secondary'
                        }`}
                      >
                        <div className="flex items-start gap-1.5">
                          <span
                            className={`font-mono font-bold ${
                              isCorrect ? 'text-answer' : 'text-text-muted'
                            }`}
                          >
                            [{opt.label}]
                          </span>
                          <div className="min-w-0 flex-1 space-y-0.5">
                            <p className="font-medium text-text-primary">{opt.textEn}</p>
                            {layout !== 'english_only' && (
                              <p className="text-text-secondary">{opt.textZh}</p>
                            )}
                          </div>
                          {isCorrect && (
                            <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-answer" />
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
