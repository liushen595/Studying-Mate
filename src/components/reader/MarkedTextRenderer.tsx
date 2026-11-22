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
  /** Only true for Part C Translation context passages; stripped in Reading/Cloze/NewType/Writing to prevent cross-type OCR pollution */
  allowUnderline?: boolean;
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
 * 1. `<u>...</u>` -> underlined translation sentence highlight (supports nested `{{word}}`)
 * 2. `{{word}}` -> understated amber dashed underline, clickable to open Word Popover Card
 * 3. `[[1]]` -> emerald inline filled-answer pill for Cloze passages
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
  allowUnderline = false,
}: Props) {
  // Strip stray <u> tags in non-translation sections so OCR mis-marks never create blue underlines in Reading/Cloze
  const normalizedText = allowUnderline ? text : text.replace(/<\/?u>/gi, '');
  // Split outer <u>...</u> spans first so underlined translation sentences render cleanly with nested {{vocab}}
  const underlineRegex = /(<u>[\s\S]*?<\/u>)/gi;
  const segments = normalizedText.split(underlineRegex);

  const renderInlineTokens = (segment: string, keyPrefix: string) => {
    const tokenRegex = /(\{\{[^{}]+?\}\}|\[\[\s*\d+\s*\]\])/g;
    const parts = segment.split(tokenRegex);

    return parts.map((part, idx) => {
      if (!part) return null;
      const key = `${keyPrefix}-${idx}`;

      // Marked vocabulary {{...}}
      if (part.startsWith('{{') && part.endsWith('}}')) {
        const surfaceForm = part.slice(2, -2).trim();
        const entry = findVocabEntry(vocabulary, surfaceForm);
        const isActive =
          activeSurfaceForm?.toLowerCase() === surfaceForm.toLowerCase();
        return (
          <span
            key={key}
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
              key={key}
              className="mx-0.5 inline-flex items-center rounded-md bg-surface-subtle px-1.5 py-0.5 font-mono text-xs text-text-muted"
            >
              [{num}]
            </span>
          );
        }

        return (
          <button
            key={key}
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

      return <span key={key}>{part}</span>;
    });
  };

  return (
    <>
      {segments.map((seg, sIdx) => {
        if (!seg) return null;
        if (/^<u>[\s\S]*<\/u>$/i.test(seg)) {
          const inner = seg.slice(3, -4);
          return (
            <u
              key={`u-${sIdx}`}
              className="decoration-accent/70 decoration-2 underline-offset-4 bg-accent-soft/35 rounded-xs px-0.5"
            >
              {renderInlineTokens(inner, `u-${sIdx}`)}
            </u>
          );
        }
        return <span key={`s-${sIdx}`}>{renderInlineTokens(seg, `s-${sIdx}`)}</span>;
      })}
    </>
  );
}
