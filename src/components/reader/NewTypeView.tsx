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

const SUBTYPE_META: Record<
  NewTypeSection['subType'],
  { label: string; hint: string; slotPrefix: string }
> = {
  seven_choose_five: {
    label: '七选五 · 句子已回填',
    hint: '绿色左边框块为正确回填选项',
    slotPrefix: '空',
  },
  ordering: {
    label: '排序题 · 段落顺序已还原',
    hint: '已按最终正确逻辑顺序重排（灰色徽章为题目原定固定段，绿色块为排定段落）',
    slotPrefix: '排序',
  },
  heading_matching: {
    label: '小标题匹配 · 标题已填入',
    hint: '绿色标题块已自动置入各对应段落上方',
    slotPrefix: '小标题',
  },
  info_matching: {
    label: '多项对应 · 信息已匹配',
    hint: '上方为完整原文，下方为 41–45 题匹配结果与完整选项池',
    slotPrefix: '匹配',
  },
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
  const meta = SUBTYPE_META[section.subType] || SUBTYPE_META.seven_choose_five;

  return (
    <div className="space-y-5">
      {/* Reconstructed Full Passage */}
      <div className="island p-5 sm:p-7 space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border-subtle pb-3">
          <div>
            <span className="rounded-md bg-answer-soft px-2 py-0.5 text-xs font-semibold text-answer">
              新题型 · {meta.label}
            </span>
            <h2 className="mt-1.5 text-lg font-semibold text-text-primary">{section.title}</h2>
          </div>
          <span className="text-xs text-text-muted">{meta.hint}</span>
        </div>

        <div className="space-y-5">
          {section.blocks.map((block, idx) => {
            if (block.kind === 'paragraph') {
              return (
                <div key={block.id || idx} className="space-y-2">
                  {block.fixedOption && (
                    <div className="flex items-center gap-2 text-xs">
                      <span className="inline-flex items-center rounded-md border border-border-strong bg-surface-subtle px-2 py-0.5 font-mono font-semibold text-text-secondary">
                        已给出固定段 [{block.fixedOption}]
                      </span>
                    </div>
                  )}
                  <div
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
                </div>
              );
            }

            // Filled slot (inserted correct sentence / ordered paragraph / heading / matched statement)
            const isHeading = section.subType === 'heading_matching';
            return (
              <div
                key={`slot-${block.number}-${idx}`}
                className={`rounded-xl border border-answer/30 border-l-4 border-l-answer bg-answer-soft/35 ${
                  isHeading ? 'px-4 py-3 space-y-1.5' : 'p-4 space-y-2'
                }`}
              >
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <span className="inline-flex items-center gap-1 rounded-md bg-answer px-2 py-0.5 font-mono font-semibold text-white">
                    <Sparkles className="h-3 w-3" />
                    第 {block.number} {meta.slotPrefix} · 选 [{block.selectedOption}]
                  </span>
                  {block.slotPrompt && (
                    <span className="rounded-md bg-surface px-2 py-0.5 font-medium text-text-primary border border-border-subtle">
                      {block.slotPrompt}
                    </span>
                  )}
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
                  <p
                    className={`${
                      isHeading ? 'font-serif text-base sm:text-lg font-bold' : `${enTextClass} font-medium`
                    } text-text-primary`}
                  >
                    <MarkedTextRenderer
                      text={block.en}
                      sectionId={section.id}
                      vocabulary={vocabulary}
                      activeSurfaceForm={activeSurfaceForm}
                      onSelectVocab={onSelectVocab}
                    />
                  </p>
                  {layout !== 'english_only' && (
                    <p
                      className={`${
                        isHeading ? 'text-sm font-medium' : 'text-[15px]'
                      } leading-relaxed text-text-secondary`}
                    >
                      {block.zh}
                    </p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Full Option Bank (including distractors / fixed anchors) */}
      {section.optionBank.length > 0 && (
        <div className="island p-5 space-y-3">
          <button
            type="button"
            onClick={() => setBankOpen((v) => !v)}
            className="flex w-full items-center justify-between text-left"
          >
            <h3 className="text-sm font-semibold text-text-primary">
              完整选项池（{section.subType === 'ordering' ? '含已给出固定段' : '含干扰项'}，共{' '}
              {section.optionBank.length} 项）
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
                const isFixed = Boolean(opt.isFixed);
                return (
                  <div
                    key={opt.label}
                    className={`rounded-xl border p-3.5 text-sm ${
                      used
                        ? 'border-answer/30 bg-answer-soft/25'
                        : isFixed
                          ? 'border-accent/25 bg-accent-soft/20'
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
                            : isFixed
                              ? 'bg-accent-soft text-accent'
                              : 'bg-surface text-text-muted border border-border-subtle'
                        }`}
                      >
                        {used
                          ? section.subType === 'ordering'
                            ? `排在第 ${opt.usedInSlot} 题`
                            : section.subType === 'heading_matching'
                              ? `匹配第 ${opt.usedInSlot} 题小标题`
                              : section.subType === 'info_matching'
                                ? `匹配第 ${opt.usedInSlot} 题`
                                : `已填入第 ${opt.usedInSlot} 空`
                          : isFixed
                            ? '题目已给出固定段'
                            : '多余干扰项'}
                      </span>
                    </div>
                    <p className="font-serif text-[15px] leading-relaxed text-text-primary">
                      <MarkedTextRenderer
                        text={opt.en}
                        sectionId={section.id}
                        vocabulary={vocabulary}
                        activeSurfaceForm={activeSurfaceForm}
                        onSelectVocab={onSelectVocab}
                      />
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
