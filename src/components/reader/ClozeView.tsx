import { useMemo, useState } from 'react';
import { Check, ChevronDown, ChevronUp } from 'lucide-react';
import type { ClozeSection, VocabEntry } from '../../types/exam';
import type { ReadingLayout } from '../../stores/useSettingsStore';
import { MarkedTextRenderer } from './MarkedTextRenderer';

interface Props {
  section: ClozeSection;
  vocabulary: VocabEntry[];
  layout: ReadingLayout;
  enTextClass: string;
  activeSurfaceForm?: string | null;
  onSelectVocab: (surfaceForm: string, sectionId: string, anchorEl: HTMLElement, entry?: VocabEntry) => void;
}

export function ClozeView({
  section,
  vocabulary,
  layout,
  enTextClass,
  activeSurfaceForm,
  onSelectVocab,
}: Props) {
  const [selectedBlankNum, setSelectedBlankNum] = useState<number | null>(
    section.blanks[0]?.number ?? null,
  );
  const [showAllOptions, setShowAllOptions] = useState(true);

  const blankMap = useMemo(() => {
    const map = new Map(section.blanks.map((b) => [b.number, b]));
    return map;
  }, [section.blanks]);

  const activeBlank = selectedBlankNum !== null ? blankMap.get(selectedBlankNum) : undefined;

  return (
    <div className="space-y-5">
      {/* Passage with inline filled answers */}
      <div className="island p-5 sm:p-7 space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border-subtle pb-3">
          <div>
            <span className="rounded-md bg-answer-soft px-2 py-0.5 text-xs font-semibold text-answer">
              完形填空 · 答案已填入
            </span>
            <h2 className="mt-1.5 text-lg font-semibold text-text-primary">{section.title}</h2>
          </div>
          <span className="text-xs text-text-muted">
            点击绿色填空胶囊可查看 A/B/C/D 选项，点击虚线下划线查看生词卡片
          </span>
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
                <MarkedTextRenderer
                  text={p.en}
                  sectionId={section.id}
                  vocabulary={vocabulary}
                  activeSurfaceForm={activeSurfaceForm}
                  onSelectVocab={onSelectVocab}
                  clozeBlanks={blankMap}
                  activeBlankNumber={selectedBlankNum}
                  onSelectBlank={(num) => {
                    setSelectedBlankNum(num);
                    setShowAllOptions(true);
                  }}
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

      {/* Selected Blank Quick Spotlight + Full Option Matrix */}
      {section.blanks.length > 0 && (
        <div className="island p-5 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-semibold text-text-primary">
                完形选项对照（共 {section.blanks.length} 空）
              </h3>
              {activeBlank && (
                <span className="rounded-full bg-surface-subtle px-2.5 py-0.5 text-xs text-text-secondary">
                  当前聚焦第 {activeBlank.number} 空
                </span>
              )}
            </div>
            <button
              type="button"
              onClick={() => setShowAllOptions((v) => !v)}
              className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-text-secondary hover:bg-surface-subtle hover:text-text-primary"
            >
              {showAllOptions ? (
                <>
                  收起全部选项 <ChevronUp className="h-3.5 w-3.5" />
                </>
              ) : (
                <>
                  展开全部选项 <ChevronDown className="h-3.5 w-3.5" />
                </>
              )}
            </button>
          </div>

          {showAllOptions && (
            <div className="grid gap-3 sm:grid-cols-2">
              {section.blanks.map((blank) => {
                const isFocused = blank.number === selectedBlankNum;
                return (
                  <div
                    key={blank.number}
                    onClick={() => setSelectedBlankNum(blank.number)}
                    className={`cursor-pointer rounded-xl border p-3.5 transition ${
                      isFocused
                        ? 'border-answer/50 bg-answer-soft/35'
                        : 'border-border-subtle bg-surface-subtle/50 hover:border-border-strong'
                    }`}
                  >
                    <div className="mb-2 flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="flex h-6 w-6 items-center justify-center rounded-md bg-surface font-mono text-xs font-semibold text-text-primary border border-border-subtle">
                          {blank.number}
                        </span>
                        <span className="text-xs font-semibold text-answer">
                          选 {blank.correctOption} · {blank.correctWord}
                        </span>
                      </div>
                      <span className="text-[11px] text-text-muted">
                        {blank.answerSource === 'paper_marked' ? '沿用卷面订正' : 'AI 解答'}
                      </span>
                    </div>

                    <div className="grid grid-cols-2 gap-1.5 text-xs">
                      {blank.options.map((opt) => {
                        const isCorrect = opt.label === blank.correctOption;
                        return (
                          <div
                            key={opt.label}
                            className={`flex items-baseline gap-1.5 rounded-lg px-2 py-1 ${
                              isCorrect
                                ? 'bg-answer-soft text-answer font-medium'
                                : 'text-text-secondary'
                            }`}
                          >
                            <span className="font-mono font-semibold">{opt.label}.</span>
                            <span className="truncate">
                              {opt.text}
                              {opt.briefZh && (
                                <span className="ml-1 opacity-75 font-normal">
                                  ({opt.briefZh})
                                </span>
                              )}
                            </span>
                            {isCorrect && <Check className="ml-auto h-3 w-3 shrink-0" />}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
