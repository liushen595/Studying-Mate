import type { ExamSection } from '../../types/exam';
import type { ExtractedVocabItem } from '../prompts/vocab';

export interface ParsedSectionDraft {
  id: string;
  title: string;
  type: ExamSection['type'];
  rawText: string;
  vocabCount: number;
}

const VOCAB_REGEX = /\{\{([^{}]+?)\}\}/g;

/**
 * Lightweight client-side token estimator (English ~4 chars/token, CJK ~1.5 chars/token).
 */
export function estimateTextTokens(text: string): number {
  if (!text) return 0;
  let cjk = 0;
  let other = 0;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code >= 0x4e00 && code <= 0x9fff) cjk++;
    else other++;
  }
  return Math.ceil(cjk / 1.5 + other / 4);
}

export function estimateImageTokens(count: number, detail: 'auto' | 'low' | 'high'): number {
  if (count <= 0) return 0;
  if (detail === 'low') return count * 256;
  return count * 1200;
}

/**
 * Extract all unique marked {{vocab}} tokens from raw text for quick preview.
 */
export function listMarkedVocabTokens(text: string): string[] {
  const seen = new Set<string>();
  const list: string[] = [];
  let m: RegExpExecArray | null;
  const regex = new RegExp(VOCAB_REGEX.source, 'g');
  while ((m = regex.exec(text)) !== null) {
    const word = m[1].trim();
    if (!word) continue;
    const key = word.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      list.push(word);
    }
  }
  return list;
}

/**
 * Detect section type heuristically from title + content.
 */
export function detectSectionType(title: string, body: string): ExamSection['type'] {
  const combined = `${title}\n${body.slice(0, 600)}`.toLowerCase();
  if (
    /use\s+of\s+english|cloze|完形|完型/.test(combined) ||
    /\[\[\s*1\s*\]\][\s\S]*\[\[\s*2\s*\]\]/.test(body) ||
    /(?:___|\(\s*1\s*\)|\[\s*1\s*\])[\s\S]{10,400}(?:___|\(\s*2\s*\)|\[\s*2\s*\])/.test(body)
  ) {
    return 'cloze';
  }
  if (/part\s*c|translation|翻译/.test(title.toLowerCase()) || /\(46\)|46\.\s/.test(body)) {
    return 'translation';
  }
  if (
    /part\s*b|新题型|七选五|排序|小标题|heading/i.test(title) ||
    (/\[\s*A\s*\][\s\S]*\[\s*G\s*\]/.test(body) && /41|42|43|44|45/.test(body))
  ) {
    return 'new_type';
  }
  if (/text\s*[1-4]|reading|阅读|part\s*a/i.test(title) || /21\.|26\.|31\.|36\./.test(body)) {
    return 'reading';
  }
  // If long English paragraphs exist, default to reading
  if (body.trim().length > 260) {
    return 'reading';
  }
  return 'general';
}

const SECTION_HEADER_REGEX =
  /^(?:#{1,3}\s*)?(Section\s+[I1-3]+[^\n]*|Part\s+[A-C]\b[^\n]*|Text\s+[1-4]\b[^\n]*|完[形型]填空[^\n]*|新题型[^\n]*|翻译[题部]?[^\n]*|Translation[^\n]*|Reading\s+Comprehension[^\n]*)$/im;

/**
 * Splits a full or partial Kaoyan English paper into structured section drafts.
 */
export function splitPaperIntoSections(
  rawText: string,
  forcedType?: ExamSection['type'] | 'auto',
): ParsedSectionDraft[] {
  const normalized = rawText.replace(/\r\n/g, '\n').trim();
  if (!normalized) return [];

  if (forcedType && forcedType !== 'auto') {
    const typeLabels: Record<ExamSection['type'], string> = {
      cloze: 'Section I Use of English (完形填空)',
      reading: 'Reading Comprehension (阅读理解)',
      new_type: 'Part B 新题型',
      translation: 'Part C Translation (翻译)',
      general: '文章精读',
    };
    return [
      {
        id: 'sec-1',
        title: typeLabels[forcedType],
        type: forcedType,
        rawText: normalized,
        vocabCount: listMarkedVocabTokens(normalized).length,
      },
    ];
  }

  const lines = normalized.split('\n');
  const boundaries: Array<{ lineIdx: number; title: string }> = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.length > 85) continue;
    if (SECTION_HEADER_REGEX.test(line)) {
      boundaries.push({ lineIdx: i, title: line.replace(/^#{1,3}\s*/, '') });
    }
  }

  if (boundaries.length <= 1) {
    const title = boundaries[0]?.title || '文章精读';
    const type = detectSectionType(title, normalized);
    return [
      {
        id: 'sec-1',
        title:
          title === '文章精读'
            ? type === 'cloze'
              ? 'Section I Use of English (完形填空)'
              : type === 'new_type'
                ? 'Part B 新题型'
                : type === 'translation'
                  ? 'Part C Translation (翻译)'
                  : type === 'reading'
                    ? 'Reading Comprehension (阅读理解)'
                    : '文章精读'
            : title,
        type,
        rawText: normalized,
        vocabCount: listMarkedVocabTokens(normalized).length,
      },
    ];
  }

  const drafts: ParsedSectionDraft[] = [];
  for (let b = 0; b < boundaries.length; b++) {
    const start = boundaries[b].lineIdx;
    const end = b + 1 < boundaries.length ? boundaries[b + 1].lineIdx : lines.length;
    const slice = lines.slice(start, end).join('\n').trim();
    // Skip empty wrapper headers like "Section II Reading Comprehension" immediately followed by "Part A" or "Text 1"
    const bodyWithoutHeader = lines.slice(start + 1, end).join('\n').trim();
    if (bodyWithoutHeader.length < 12) continue;

    const title = boundaries[b].title;
    const type = detectSectionType(title, bodyWithoutHeader);
    drafts.push({
      id: `sec-${drafts.length + 1}`,
      title,
      type,
      rawText: slice,
      vocabCount: listMarkedVocabTokens(slice).length,
    });
  }

  if (drafts.length === 0) {
    const type = detectSectionType('', normalized);
    return [
      {
        id: 'sec-1',
        title: '文章精读',
        type,
        rawText: normalized,
        vocabCount: listMarkedVocabTokens(normalized).length,
      },
    ];
  }

  return drafts;
}

/**
 * Extracts all {{vocab}} occurrences along with their surrounding English sentence
 * across all sections so ZERO marked words can ever be dropped by the LLM.
 */
export function extractVocabWithContext(
  sections: Array<{ id: string; title: string; rawText: string }>,
): ExtractedVocabItem[] {
  const map = new Map<string, ExtractedVocabItem>();

  for (const sec of sections) {
    const text = sec.rawText;
    const regex = new RegExp(VOCAB_REGEX.source, 'g');
    let match: RegExpExecArray | null;

    while ((match = regex.exec(text)) !== null) {
      const surfaceForm = match[1].trim();
      if (!surfaceForm) continue;
      const key = surfaceForm.toLowerCase().replace(/\s+/g, ' ');
      const sentenceEn = findContainingSentence(text, match.index, match.index + match[0].length);

      let entry = map.get(key);
      if (!entry) {
        entry = {
          key,
          surfaceForms: [surfaceForm],
          occurrences: [],
        };
        map.set(key, entry);
      } else if (!entry.surfaceForms.includes(surfaceForm)) {
        entry.surfaceForms.push(surfaceForm);
      }

      // Deduplicate identical sentence occurrences in same section
      const alreadyExists = entry.occurrences.some(
        (o) => o.sectionId === sec.id && o.sentenceEn === sentenceEn && o.surfaceForm === surfaceForm,
      );
      if (!alreadyExists) {
        entry.occurrences.push({
          sectionId: sec.id,
          sectionTitle: sec.title,
          surfaceForm,
          sentenceEn,
        });
      }
    }
  }

  return Array.from(map.values());
}

function findContainingSentence(text: string, startIdx: number, endIdx: number): string {
  // Expand left to sentence boundary or newline
  let left = startIdx;
  while (left > 0) {
    const ch = text[left - 1];
    if (ch === '\n' || ((ch === '.' || ch === '!' || ch === '?') && /\s/.test(text[left] || ' '))) {
      break;
    }
    left--;
  }

  // Expand right to sentence boundary or newline
  let right = endIdx;
  while (right < text.length) {
    const ch = text[right];
    if (ch === '\n') break;
    if ((ch === '.' || ch === '!' || ch === '?') && (right + 1 >= text.length || /\s|"|'|\)/.test(text[right + 1]))) {
      right++;
      break;
    }
    right++;
  }

  return text
    .slice(left, right)
    .replace(/\{\{([^{}]+?)\}\}/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}
