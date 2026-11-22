import { useEffect } from 'react';
import {
  autoUpdate,
  flip,
  FloatingPortal,
  offset,
  shift,
  useDismiss,
  useFloating,
  useInteractions,
} from '@floating-ui/react';
import { ArrowUpRight, Sparkles, Volume2, X } from 'lucide-react';
import type { VocabEntry } from '../../types/exam';

export interface ActiveWordPopup {
  surfaceForm: string;
  sectionId: string;
  anchorEl: HTMLElement;
  entry?: VocabEntry;
}

interface Props {
  popup: ActiveWordPopup | null;
  onClose: () => void;
  onJumpToVocab?: (vocabId: string) => void;
}

function speakWord(text: string, lang: 'en-GB' | 'en-US' = 'en-US') {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
  try {
    window.speechSynthesis.cancel();
    const utter = new SpeechSynthesisUtterance(text);
    utter.lang = lang;
    utter.rate = 0.92;
    window.speechSynthesis.speak(utter);
  } catch {
    // ignore speech synthesis errors
  }
}

export function WordPopoverCard({ popup, onClose, onJumpToVocab }: Props) {
  const { refs, floatingStyles, context } = useFloating({
    open: Boolean(popup),
    onOpenChange: (open) => {
      if (!open) onClose();
    },
    elements: {
      reference: popup?.anchorEl ?? null,
    },
    placement: 'bottom-start',
    middleware: [offset(8), flip({ padding: 14 }), shift({ padding: 14 })],
    whileElementsMounted: autoUpdate,
  });

  const dismiss = useDismiss(context, { outsidePress: true, escapeKey: true });
  const { getFloatingProps } = useInteractions([dismiss]);

  useEffect(() => {
    if (!popup) return;
    const onScroll = () => {
      // Keep anchored via autoUpdate; close only if anchor is detached
      if (!document.body.contains(popup.anchorEl)) onClose();
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, [popup, onClose]);

  if (!popup) return null;

  const entry = popup.entry;
  const matchedOcc =
    entry?.occurrences.find(
      (o) =>
        o.sectionId === popup.sectionId &&
        o.surfaceForm.toLowerCase() === popup.surfaceForm.toLowerCase(),
    ) ||
    entry?.occurrences.find((o) => o.sectionId === popup.sectionId) ||
    entry?.occurrences[0];

  const displayWord = entry?.lemma || popup.surfaceForm;

  return (
    <FloatingPortal>
      <div
        ref={refs.setFloating}
        style={floatingStyles}
        {...getFloatingProps()}
        className="z-50 w-[min(360px,calc(100vw-24px))] island-popover p-4 text-sm text-text-primary animate-in fade-in duration-120"
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex flex-wrap items-baseline gap-2">
              <h4 className="font-serif text-lg font-bold tracking-tight text-text-primary">
                {displayWord}
              </h4>
              {entry &&
                popup.surfaceForm.toLowerCase() !== entry.lemma.toLowerCase() && (
                  <span className="rounded-md bg-surface-subtle px-1.5 py-0.5 text-[11px] text-text-muted">
                    原文: {popup.surfaceForm}
                  </span>
                )}
            </div>

            {entry && (entry.phoneticUk || entry.phoneticUs) && (
              <div className="mt-1 flex flex-wrap items-center gap-2.5 text-xs text-text-muted">
                {entry.phoneticUk && (
                  <button
                    type="button"
                    onClick={() => speakWord(displayWord, 'en-GB')}
                    className="inline-flex items-center gap-1 rounded-md px-1 py-0.5 transition hover:bg-surface-subtle hover:text-text-primary"
                    title="点击朗读英式发音"
                  >
                    <span>UK {entry.phoneticUk}</span>
                    <Volume2 className="h-3.5 w-3.5 text-accent" />
                  </button>
                )}
                {entry.phoneticUs && (
                  <button
                    type="button"
                    onClick={() => speakWord(displayWord, 'en-US')}
                    className="inline-flex items-center gap-1 rounded-md px-1 py-0.5 transition hover:bg-surface-subtle hover:text-text-primary"
                    title="点击朗读美式发音"
                  >
                    <span>US {entry.phoneticUs}</span>
                    <Volume2 className="h-3.5 w-3.5 text-accent" />
                  </button>
                )}
              </div>
            )}
          </div>

          <button
            type="button"
            onClick={onClose}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-text-muted hover:bg-surface-subtle hover:text-text-primary"
            aria-label="关闭单词卡片"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {!entry ? (
          <div className="mt-3 rounded-xl bg-surface-subtle p-3 text-xs text-text-secondary">
            暂无该词的词典解析数据（生词本可能仍在生成中，或该词在解析前未被标注）。
          </div>
        ) : (
          <div className="mt-3 space-y-3">
            {/* In-Context Meaning (Highlighted) */}
            {matchedOcc && (
              <div className="rounded-xl border border-vocab/25 bg-vocab-soft/75 px-3 py-2.5">
                <div className="flex items-center gap-1.5 text-[11px] font-semibold text-vocab">
                  <Sparkles className="h-3.5 w-3.5" />
                  <span>本文语境释义</span>
                  {matchedOcc.isUncommonMeaning && (
                    <span className="ml-auto rounded-full bg-vocab/20 px-1.5 py-0.5 text-[10px]">
                      熟词僻义
                    </span>
                  )}
                </div>
                <p className="mt-1 text-sm font-medium text-text-primary leading-relaxed">
                  {matchedOcc.contextMeaning}
                </p>
              </div>
            )}

            {/* Comprehensive Dictionary Meanings */}
            <div className="space-y-1.5">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-text-muted">
                全面释义
              </div>
              <div className="space-y-1.5 max-h-40 overflow-y-auto pr-1">
                {entry.comprehensiveMeanings.map((m, idx) => (
                  <div key={idx} className="flex items-start gap-2 text-xs leading-relaxed">
                    <span className="mt-0.5 shrink-0 rounded bg-surface-subtle px-1.5 py-0.5 font-mono text-[11px] font-semibold text-accent">
                      {m.pos}
                    </span>
                    <span className="text-text-secondary">{m.definitions.join('；')}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Collocations */}
            {entry.collocations.length > 0 && (
              <div className="border-t border-border-subtle pt-2.5">
                <div className="mb-1 text-[11px] font-semibold text-text-muted">常见搭配</div>
                <div className="space-y-1 text-xs">
                  {entry.collocations.slice(0, 3).map((col, idx) => (
                    <div key={idx} className="flex items-baseline justify-between gap-2">
                      <span className="font-medium text-text-primary">{col.phrase}</span>
                      <span className="text-text-secondary text-right">{col.meaning}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Confusables */}
            {entry.confusables && entry.confusables.length > 0 && (
              <div className="rounded-lg bg-surface-subtle px-2.5 py-2 text-xs text-text-secondary">
                <span className="font-semibold text-text-primary">易混辨析：</span>
                {entry.confusables.map((c) => `${c.word}（${c.diff}）`).join('；')}
              </div>
            )}

            {/* Footer jump */}
            {onJumpToVocab && (
              <div className="flex justify-end border-t border-border-subtle pt-2">
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    onJumpToVocab(entry.id);
                  }}
                  className="inline-flex items-center gap-1 text-xs font-medium text-accent hover:underline"
                >
                  <span>在生词本中查看详情</span>
                  <ArrowUpRight className="h-3.5 w-3.5" />
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </FloatingPortal>
  );
}
