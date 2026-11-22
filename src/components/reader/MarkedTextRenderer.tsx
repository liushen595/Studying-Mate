import type { ClozeBlank, VocabEntry } from '../../types/exam';

interface Props {
  text: string;
  sectionId: string;
  vocabulary: VocabEntry[];
  activeSurfaceForm?: string | null;
  onSelectVocab: (surfaceForm: string, sectionId: string, anchorEl: HTMLElement, entry?: VocabEntry) => void;
  /** Optional cloze blanks map for replacing [[1]] placeholders with filled answer pills */
  clozeBlanks?: Map<number, ClozeBlank>;
  activeBlankNumber?: number | null;
  onSelectBlank?: (blankNumber: number) => void;
}

export function findVocabEntry(vocabulary: VocabEntry[], surfaceForm: string): VocabEntry | undefined {
  const target = surfaceForm.trim().toLowerCase();
  return vocabulary.find(
    (v) =>
      v.id.toLowerCase() === target ||
      v.lemma.toLowerCase() === target ||
      v.surfaceForms.some((f) => f.toLowerCase() === target),
  );
}

/**
 * Renders English exam text with:
 * 1. `{{word}}` -> understated amber dashed underline, clickable to open Word Popover Card
 * 2. `[[1]]` -> emerald inline filled-answer pill for Cloze passages
 */
export function MarkedTextRenderer({
  text,
  sectionId,
  vocabulary,
  activeSurfaceForm,
  onSelectVocab,
  clozeBlanks,
  activeBlankNumber,
  onSelectBlank,
}: Props) {
  const tokenRegex = /(\{\{[^{}]+?\}\}|\[\[\s*\d+\s*\]\])/g;
  const parts = text.split(tokenRegex);

  return (
    <>
      {parts.map((part, idx) => {
        if (!part) return null;

        // Marked vocabulary {{...}}
        if (part.startsWith('{{') && part.endsWith('}}')) {
          const surfaceForm = part.slice(2, -2).trim();
          const entry = findVocabEntry(vocabulary, surfaceForm);
          const isActive =
            activeSurfaceForm?.toLowerCase() === surfaceForm.toLowerCase();
          return (
            <span
              key={idx}
              role="button"
              tabIndex={0}
              data-active={isActive ? 'true' : undefined}
              onClick={(e) => {
                e.stopPropagation();
                onSelectVocab(surfaceForm, sectionId, e.currentTarget, entry);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onSelectVocab(surfaceForm, sectionId, e.currentTarget, entry);
                }
              }}
              className="vocab-mark"
              title="点击查看生词释义卡片"
            >
              {surfaceForm}
            </span>
          );
        }

        // Cloze blank placeholder [[1]]
        if (part.startsWith('[[') && part.endsWith(']]')) {
          const num = parseInt(part.slice(2, -2).trim(), 10);
          const blank = clozeBlanks?.get(num);
          const isSelected = activeBlankNumber === num;

          if (!blank) {
            return (
              <span
                key={idx}
                className="mx-0.5 inline-flex items-center rounded-md bg-surface-subtle px-1.5 py-0.5 font-mono text-xs text-text-muted"
              >
                [{num}]
              </span>
            );
          }

          return (
            <button
              key={idx}
              type="button"
              onClick={() => onSelectBlank?.(num)}
              className={`mx-0.5 inline-flex items-baseline gap-1 rounded-lg border px-2 py-0.5 font-sans text-[0.88em] font-semibold transition ${
                isSelected
                  ? 'border-answer bg-answer text-white shadow-xs'
                  : 'border-answer/30 bg-answer-soft text-answer hover:border-answer/60'
              }`}
              title={`第 ${num} 空 · 选 ${blank.correctOption}（点击查看四个选项）`}
            >
              <span className="font-mono text-[0.78em] opacity-80">{num}</span>
              <span>{blank.correctWord}</span>
            </button>
          );
        }

        return <span key={idx}>{part}</span>;
      })}
    </>
  );
}
