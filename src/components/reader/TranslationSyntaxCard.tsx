import { useState } from 'react';
import { Eye, GitBranch, Lightbulb, Sparkles } from 'lucide-react';
import type { SyntaxRole, TranslationSection, VocabEntry } from '../../types/exam';
import type { ReadingLayout } from '../../stores/useSettingsStore';
import { MarkedTextRenderer } from './MarkedTextRenderer';

interface Props {
  section: TranslationSection;
  vocabulary: VocabEntry[];
  layout: ReadingLayout;
  enTextClass: string;
  activeSurfaceForm?: string | null;
  onSelectVocab: (surfaceForm: string, sectionId: string, anchorEl: HTMLElement, entry?: VocabEntry) => void;
}

const ROLE_STYLES: Record<SyntaxRole, { badge: string; border: string; label: string }> = {
  main_clause: {
    badge: 'bg-blue-500/12 text-blue-700 dark:text-blue-300',
    border: 'border-l-blue-500/70',
    label: '主句核心',
  },
  attributive_clause: {
    badge: 'bg-purple-500/12 text-purple-700 dark:text-purple-300',
    border: 'border-l-purple-500/70',
    label: '定语从句',
  },
  adverbial_clause: {
    badge: 'bg-teal-500/12 text-teal-700 dark:text-teal-300',
    border: 'border-l-teal-500/70',
    label: '状语从句',
  },
  noun_clause: {
    badge: 'bg-indigo-500/12 text-indigo-700 dark:text-indigo-300',
    border: 'border-l-indigo-500/70',
    label: '名词性从句',
  },
  non_finite: {
    badge: 'bg-amber-500/14 text-amber-700 dark:text-amber-300',
    border: 'border-l-amber-500/70',
    label: '非谓语',
  },
  prepositional_phrase: {
    badge: 'bg-slate-500/12 text-slate-700 dark:text-slate-300',
    border: 'border-l-slate-400',
    label: '介词短语',
  },
  parenthetical: {
    badge: 'bg-rose-500/12 text-rose-700 dark:text-rose-300',
    border: 'border-l-rose-500/70',
    label: '插入语',
  },
  special_syntax: {
    badge: 'bg-emerald-500/12 text-emerald-700 dark:text-emerald-300',
    border: 'border-l-emerald-500/70',
    label: '特殊句式',
  },
};

export function TranslationSyntaxCard({
  section,
  vocabulary,
  layout,
  enTextClass,
  activeSurfaceForm,
  onSelectVocab,
}: Props) {
  const [showLiteral, setShowLiteral] = useState(true);

  return (
    <div className="space-y-5">
      {/* Optional Context Passage (for English I underlined sentences) */}
      {section.contextPassage && section.contextPassage.length > 0 && (
        <div className="island p-5 sm:p-6 space-y-4">
          <div className="flex items-center justify-between border-b border-border-subtle pb-2.5">
            <h3 className="text-sm font-semibold text-text-primary">上下文参考段落</h3>
            <span className="text-xs text-text-muted">辅助理解代词指代与语境</span>
          </div>
          <div className="space-y-4">
            {section.contextPassage.map((p, idx) => (
              <div key={p.id || idx} className="space-y-1.5">
                <p className="font-serif text-[15.5px] leading-relaxed text-text-primary">
                  <MarkedTextRenderer
                    text={p.en}
                    sectionId={section.id}
                    vocabulary={vocabulary}
                    activeSurfaceForm={activeSurfaceForm}
                    onSelectVocab={onSelectVocab}
                    allowUnderline
                  />
                </p>
                {layout !== 'english_only' && (
                  <p className="text-xs leading-relaxed text-text-secondary">{p.zh}</p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Header bar */}
      <div className="flex flex-wrap items-center justify-between gap-2 px-1">
        <div className="flex items-center gap-2">
          <span className="rounded-md bg-accent-soft px-2.5 py-1 text-xs font-semibold text-accent">
            翻译题 · 结构化句法剖析
          </span>
          <h2 className="text-base font-semibold text-text-primary">{section.title}</h2>
        </div>

        <button
          type="button"
          onClick={() => setShowLiteral((v) => !v)}
          className="inline-flex items-center gap-1.5 rounded-xl border border-border-subtle bg-surface px-3 py-1.5 text-xs font-medium text-text-secondary transition hover:text-text-primary"
        >
          <Eye className="h-3.5 w-3.5" />
          {showLiteral ? '隐藏直译拆解' : '显示直译拆解'}
        </button>
      </div>

      {/* Each Translation Sentence Card */}
      {section.items.map((item) => {
        const s = item.sentenceStructure;
        return (
          <article key={item.number} className="island p-5 sm:p-6 space-y-5">
            {/* Sentence Header & Original English */}
            <div className="space-y-2.5 border-b border-border-subtle pb-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className="inline-flex h-6 items-center rounded-md bg-accent px-2 font-mono text-xs font-bold text-white">
                  ({item.number})
                </span>
                <span className="rounded-full bg-surface-subtle px-2.5 py-0.5 text-xs font-medium text-text-secondary border border-border-subtle">
                  {s.sentenceType}
                </span>
              </div>

              <p className={`${enTextClass} font-medium text-text-primary`}>
                <MarkedTextRenderer
                  text={item.originalEn}
                  sectionId={section.id}
                  vocabulary={vocabulary}
                  activeSurfaceForm={activeSurfaceForm}
                  onSelectVocab={onSelectVocab}
                />
              </p>
            </div>

            {/* 1. Backbone Extraction Bar (句子主干) */}
            <div className="rounded-2xl border border-accent/20 bg-accent-soft/40 p-4 space-y-2.5">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-accent">
                <GitBranch className="h-3.5 w-3.5" />
                <span>句子主干提取 (Backbone)</span>
              </div>
              <div className="flex flex-wrap items-stretch gap-2">
                <div className="rounded-xl bg-surface px-3 py-2 border border-border-subtle">
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-text-muted">
                    主语 Subject
                  </div>
                  <div className="mt-0.5 font-serif text-sm font-semibold text-text-primary">
                    {s.backbone.subject}
                  </div>
                </div>
                <div className="rounded-xl bg-surface px-3 py-2 border border-border-subtle">
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-text-muted">
                    谓语 Predicate
                  </div>
                  <div className="mt-0.5 font-serif text-sm font-semibold text-accent">
                    {s.backbone.predicate}
                  </div>
                </div>
                {s.backbone.objectOrComplement && (
                  <div className="rounded-xl bg-surface px-3 py-2 border border-border-subtle">
                    <div className="text-[10px] font-semibold uppercase tracking-wider text-text-muted">
                      宾语 / 表语 Object
                    </div>
                    <div className="mt-0.5 font-serif text-sm font-semibold text-text-primary">
                      {s.backbone.objectOrComplement}
                    </div>
                  </div>
                )}
              </div>
              <p className="text-xs leading-relaxed text-text-secondary">
                <span className="font-semibold text-text-primary">主干含义：</span>
                {s.backbone.backboneZh}
              </p>
            </div>

            {/* 2. Layered Component Breakdown (分层成分拆解) */}
            <div className="space-y-2.5">
              <div className="text-xs font-semibold text-text-muted">分层成分拆解</div>
              <div className="grid gap-2.5 md:grid-cols-2">
                {s.components.map((comp, idx) => {
                  const style = ROLE_STYLES[comp.role] || ROLE_STYLES.main_clause;
                  return (
                    <div
                      key={idx}
                      className={`rounded-xl border border-border-subtle border-l-4 ${style.border} bg-surface-subtle/50 p-3 space-y-1.5`}
                    >
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span
                          className={`rounded-md px-2 py-0.5 text-[11px] font-semibold ${style.badge}`}
                        >
                          {comp.roleLabelZh || style.label}
                        </span>
                        {comp.modifies && (
                          <span className="text-[11px] text-text-muted">→ {comp.modifies}</span>
                        )}
                      </div>
                      <p className="font-serif text-sm text-text-primary leading-relaxed">
                        {comp.text}
                      </p>
                      <p className="text-xs text-text-secondary leading-relaxed">
                        {comp.meaningZh}
                      </p>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* 3. Literal -> Polished Translation */}
            <div className="space-y-2.5 pt-1">
              {showLiteral && (
                <div className="rounded-xl border border-border-subtle bg-surface-subtle/60 px-4 py-3">
                  <div className="text-[11px] font-semibold text-text-muted">顺译 / 结构直译</div>
                  <p className="mt-1 text-sm leading-relaxed text-text-secondary">
                    {s.literalZh}
                  </p>
                </div>
              )}

              <div className="rounded-xl border border-answer/30 bg-answer-soft/40 px-4 py-3.5">
                <div className="flex items-center gap-1.5 text-xs font-semibold text-answer">
                  <Sparkles className="h-3.5 w-3.5" />
                  <span>参考译文（考场润色版）</span>
                </div>
                <p className="mt-1.5 text-[15.5px] font-medium leading-relaxed text-text-primary">
                  {s.polishedZh}
                </p>
              </div>
            </div>

            {/* 4. Scoring Key Points */}
            {s.keyPoints.length > 0 && (
              <div className="rounded-xl border border-border-subtle bg-surface px-4 py-3 space-y-1.5">
                <div className="flex items-center gap-1.5 text-xs font-semibold text-vocab">
                  <Lightbulb className="h-3.5 w-3.5" />
                  <span>考点与翻译避坑</span>
                </div>
                <ul className="space-y-1 pl-4 text-xs leading-relaxed text-text-secondary list-disc">
                  {s.keyPoints.map((pt, idx) => (
                    <li key={idx}>{pt}</li>
                  ))}
                </ul>
              </div>
            )}
          </article>
        );
      })}
    </div>
  );
}
