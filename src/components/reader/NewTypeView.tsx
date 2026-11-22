import { useState } from 'react';
import { ChevronDown, ChevronUp, Sparkles } from 'lucide-react';
import type { NewTypeSection, VocabEntry } from '../../types/exam';
import type { ReadingLayout } from '../../stores/useSettingsStore';
import { MarkedTextRenderer } from './MarkedTextRenderer';

interface Props {
  section: NewTypeSection;
  vocabulary: VocabEntry[];
  layout: ReadingLayout;
  enTextClass: string;
  activeSurfaceForm?: string | null;
  onSelectVocab: (surfaceForm: string, sectionId: string, anchorEl: HTMLElement, entry?: VocabEntry) => void;
}

const SUBTYPE_LABELS: Record<NewTypeSection['subType'], string> = {
  seven_choose_five: '七选五 · 句子已回填',
  ordering: '排序题 · 顺序已还原',
  heading_matching: '小标题匹配 · 标题已填入',
};

export function NewTypeView({
  section,
  vocabulary,
  layout,
  enTextClass,
  activeSurfaceForm,
  onSelectVocab,
}: Props) {
  const [bankOpen, setBankOpen] = useState(true);

  return (
    <div className="space-y-5">
      {/* Reconstructed Full Passage */}
      <div className="island p-5 sm:p-7 space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border-subtle pb-3">
          <div>
            <span className="rounded-md bg-answer-soft px-2 py-0.5 text-xs font-semibold text-answer">
              新题型 · {SUBTYPE_LABELS[section.subType]}
            </span>
            <h2 className="mt-1.5 text-lg font-semibold text-text-primary">{section.title}</h2>
          </div>
          <span className="text-xs text-text-muted">绿色左边框块为正确回填选项</span>
        </div>

        <div className="space-y-5">
          {section.blocks.map((block, idx) => {
            if (block.kind === 'paragraph') {
              return (
                <div
                  key={block.id || idx}
                  className={
                    layout === 'split'
                      ? 'grid gap-5 lg:grid-cols-2 lg:gap-8'
                      : 'space-y-2'
                  }
                >
                  <p className={`${enTextClass} text-text-primary`}>
                    <MarkedTextRenderer
                      text={block.en}
                      sectionId={section.id}
                      vocabulary={vocabulary}
                      activeSurfaceForm={activeSurfaceForm}
                      onSelectVocab={onSelectVocab}
                    />
                  </p>
                  {layout !== 'english_only' && (
                    <p className="text-[15px] leading-relaxed text-text-secondary">{block.zh}</p>
                  )}
                </div>
              );
            }

            // Filled slot (inserted correct sentence/heading)
            return (
              <div
                key={`slot-${block.number}-${idx}`}
                className="rounded-xl border border-answer/30 border-l-4 border-l-answer bg-answer-soft/35 p-4 space-y-2"
              >
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <span className="inline-flex items-center gap-1 rounded-md bg-answer px-2 py-0.5 font-mono font-semibold text-white">
                    <Sparkles className="h-3 w-3" />
                    第 {block.number} 空 · 选 [{block.selectedOption}]
                  </span>
                  <span className="text-text-muted">
                    {block.answerSource === 'paper_marked' ? '沿用卷面订正' : 'AI 解答'}
                  </span>
                </div>

                <div
                  className={
                    layout === 'split'
                      ? 'grid gap-4 lg:grid-cols-2 lg:gap-7'
                      : 'space-y-1.5'
                  }
                >
                  <p className={`${enTextClass} font-medium text-text-primary`}>
                    <MarkedTextRenderer
                      text={block.en}
                      sectionId={section.id}
                      vocabulary={vocabulary}
                      activeSurfaceForm={activeSurfaceForm}
                      onSelectVocab={onSelectVocab}
                    />
                  </p>
                  {layout !== 'english_only' && (
                    <p className="text-[15px] leading-relaxed text-text-secondary">{block.zh}</p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Full Option Bank (including distractors) */}
      {section.optionBank.length > 0 && (
        <div className="island p-5 space-y-3">
          <button
            type="button"
            onClick={() => setBankOpen((v) => !v)}
            className="flex w-full items-center justify-between text-left"
          >
            <h3 className="text-sm font-semibold text-text-primary">
              完整选项池（含干扰项，共 {section.optionBank.length} 项）
            </h3>
            <span className="inline-flex items-center gap-1 text-xs text-text-secondary">
              {bankOpen ? (
                <>
                  收起 <ChevronUp className="h-4 w-4" />
                </>
              ) : (
                <>
                  展开 <ChevronDown className="h-4 w-4" />
                </>
              )}
            </span>
          </button>

          {bankOpen && (
            <div className="space-y-2.5 pt-1">
              {section.optionBank.map((opt) => {
                const used = opt.usedInSlot !== null;
                return (
                  <div
                    key={opt.label}
                    className={`rounded-xl border p-3.5 text-sm ${
                      used
                        ? 'border-answer/30 bg-answer-soft/25'
                        : 'border-border-subtle bg-surface-subtle/50 opacity-80'
                    }`}
                  >
                    <div className="mb-1 flex items-center justify-between gap-2">
                      <span className="font-mono text-xs font-bold text-text-primary">
                        [{opt.label}]
                      </span>
                      <span
                        className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
                          used
                            ? 'bg-answer-soft text-answer'
                            : 'bg-surface text-text-muted border border-border-subtle'
                        }`}
                      >
                        {used ? `已填入第 ${opt.usedInSlot} 空` : '多余干扰项'}
                      </span>
                    </div>
                    <p className="font-serif text-[15px] leading-relaxed text-text-primary">
                      {opt.en}
                    </p>
                    {layout !== 'english_only' && (
                      <p className="mt-1 text-xs leading-relaxed text-text-secondary">{opt.zh}</p>
                    )}
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
