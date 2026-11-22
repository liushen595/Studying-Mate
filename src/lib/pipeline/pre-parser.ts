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
 * Detect section type heuristically from title + content + optional parent section context.
 */
export function detectSectionType(
  title: string,
  body: string,
  parentSection?: 'section1' | 'section2' | 'section3',
): ExamSection['type'] {
  const titleLower = title.toLowerCase();
  const combined = `${title}\n${body.slice(0, 700)}`.toLowerCase();

  // Explicit parent context disambiguates Part A / Part B under Section III Writing
  if (parentSection === 'section3') {
    return 'writing';
  }
  if (
    /section\s*(iii|3)\b|writing|写作|作文|小作文|大作文/.test(titleLower) ||
    /\[图画\/图表信息|write\s+an?\s+(essay|letter|email|notice|memo|reply|report)|about\s+(100|150)\s+words|160\s*[-–—~]\s*200\s+words|do\s+not\s+sign\s+your\s+own\s+name/i.test(
      combined,
    )
  ) {
    return 'writing';
  }
  if (
    /use\s+of\s+english|cloze|完形|完型/.test(combined) ||
    /\[\[\s*1\s*\]\][\s\S]*\[\[\s*2\s*\]\]/.test(body) ||
    /(?:___|\(\s*1\s*\)|\[\s*1\s*\])[\s\S]{10,400}(?:___|\(\s*2\s*\)|\[\s*2\s*\])/.test(body)
  ) {
    return 'cloze';
  }
  if (
    /part\s*c|translation|翻译/.test(titleLower) ||
    /<u>\s*\(\s*46\s*\)|\b\(46\)|46\.\s/.test(body)
  ) {
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
  /^(?:#{1,3}\s*)?(Section\s+(?:III|II|I|[1-3])\b[^\n]*|Part\s+[A-C]\b[^\n]*|Text\s+[1-4]\b[^\n]*|完[形型]填空[^\n]*|新题型[^\n]*|翻译[题部]?[^\n]*|Translation[^\n]*|Reading\s+Comprehension[^\n]*|Writing[^\n]*|[大小]?作文[^\n]*|写作[题部]?[^\n]*)$/im;

function detectParentSectionContext(
  header: string,
  current?: 'section1' | 'section2' | 'section3',
): 'section1' | 'section2' | 'section3' | undefined {
  const lower = header.toLowerCase();
  if (/^section\s*(i\b|1\b)|use\s+of\s+english|完[形型]/.test(lower)) return 'section1';
  if (/^section\s*(ii\b|2\b)|reading\s+comprehension|^text\s*[1-4]\b/.test(lower)) return 'section2';
  if (/^section\s*(iii\b|3\b)|writing|写作|[大小]?作文/.test(lower)) return 'section3';
  return current;
}

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
      reading: 'Section II · Part A Reading Comprehension (阅读理解)',
      new_type: 'Section II · Part B 新题型',
      translation: 'Section II · Part C Translation (翻译)',
      writing: 'Section III Writing (写作)',
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
  const boundaries: Array<{
    lineIdx: number;
    title: string;
    parentSection?: 'section1' | 'section2' | 'section3';
  }> = [];

  let currentParent: 'section1' | 'section2' | 'section3' | undefined;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.length > 85) continue;
    if (SECTION_HEADER_REGEX.test(line)) {
      const cleanTitle = line.replace(/^#{1,3}\s*/, '');
      currentParent = detectParentSectionContext(cleanTitle, currentParent);
      boundaries.push({ lineIdx: i, title: cleanTitle, parentSection: currentParent });
    }
  }

  if (boundaries.length <= 1) {
    const title = boundaries[0]?.title || '文章精读';
    const type = detectSectionType(title, normalized, boundaries[0]?.parentSection);
    return [
      {
        id: 'sec-1',
        title:
          title === '文章精读'
            ? type === 'cloze'
              ? 'Section I Use of English (完形填空)'
              : type === 'new_type'
                ? 'Section II · Part B 新题型'
                : type === 'translation'
                  ? 'Section II · Part C Translation (翻译)'
                  : type === 'writing'
                    ? 'Section III Writing (写作)'
                    : type === 'reading'
                      ? 'Section II · Part A Reading Comprehension (阅读理解)'
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
    const bodyWithoutHeader = lines.slice(start + 1, end).join('\n').trim();

    // Skip empty wrapper headers (e.g. "Section II Reading Comprehension" or "Section III Writing" immediately followed by "Part A")
    if (bodyWithoutHeader.length < 12) continue;

    // Skip Section II Part A directions-only wrapper when immediately followed by Text 1
    const nextTitle = boundaries[b + 1]?.title || '';
    if (
      /^part\s*a\b/i.test(boundaries[b].title) &&
      boundaries[b].parentSection !== 'section3' &&
      /^text\s*1\b/i.test(nextTitle) &&
      bodyWithoutHeader.length < 320 &&
      /directions/i.test(bodyWithoutHeader)
    ) {
      continue;
    }

    const parent = boundaries[b].parentSection;
    let title = boundaries[b].title;
    const type = detectSectionType(title, bodyWithoutHeader, parent);

    // Disambiguate display title for Writing Part A / Part B
    if (type === 'writing' && /^part\s*[ab]\b/i.test(title)) {
      title = `Section III Writing · ${title}`;
    }

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
