import type { ExamSection } from '../../types/exam';
import type { ExtractedVocabItem } from '../prompts/vocab';

export interface CanonicalSectionPreset {
  label: string;
  shortLabel: string;
  type: ExamSection['type'];
}

export const CANONICAL_SECTION_PRESETS: CanonicalSectionPreset[] = [
  { label: 'Section I Use of English', shortLabel: '完形填空', type: 'cloze' },
  { label: 'Text1', shortLabel: 'Text1', type: 'reading' },
  { label: 'Text2', shortLabel: 'Text2', type: 'reading' },
  { label: 'Text3', shortLabel: 'Text3', type: 'reading' },
  { label: 'Text4', shortLabel: 'Text4', type: 'reading' },
  { label: 'Section II·Part B', shortLabel: 'Part B 新题型', type: 'new_type' },
  { label: 'Section II·Part C Translation', shortLabel: 'Part C 翻译', type: 'translation' },
  { label: 'Section III·Writing·Part A', shortLabel: 'Writing Part A', type: 'writing' },
  { label: 'Section III·Writing·Part B', shortLabel: 'Writing Part B', type: 'writing' },
  { label: '通用精读', shortLabel: '通用精读', type: 'general' },
];

export interface ParsedSectionDraft {
  id: string;
  title: string;
  type: ExamSection['type'];
  rawText: string;
  vocabCount: number;
  startLine?: number;
  endLine?: number;
  hasExplicitMarker?: boolean;
}

const VOCAB_REGEX = /\{\{([^{}]+?)\}\}/g;
const EXPLICIT_MARKER_REGEX = /^===\s*\[([^\]]+)\]\s*===$/;

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
 * Map a canonical or user-provided label string to its ExamSection['type'] and normalized canonical label.
 */
export function resolveCanonicalLabelAndType(
  rawLabel: string,
  parentSection?: 'section1' | 'section2' | 'section3',
): { label: string; type: ExamSection['type'] } {
  const trimmed = rawLabel.trim();
  const lower = trimmed.toLowerCase();

  // Direct preset match (case-insensitive)
  const exact = CANONICAL_SECTION_PRESETS.find((p) => p.label.toLowerCase() === lower);
  if (exact) return { label: exact.label, type: exact.type };

  // Writing (check Section III context or keywords first)
  if (
    parentSection === 'section3' ||
    /section\s*(iii|3)\b|writ+ing|写作|[大小]?作文/.test(lower)
  ) {
    if (/part\s*a|小作文/.test(lower)) {
      return { label: 'Section III·Writing·Part A', type: 'writing' };
    }
    if (/part\s*b|大作文/.test(lower)) {
      return { label: 'Section III·Writing·Part B', type: 'writing' };
    }
    return { label: 'Section III·Writing', type: 'writing' };
  }

  // Cloze
  if (/use\s+of\s+english|cloze|完[形型]|^section\s*(i\b|1\b)/.test(lower)) {
    return { label: 'Section I Use of English', type: 'cloze' };
  }

  // Reading Text 1-4
  const textMatch = trimmed.match(/text\s*([1-4])\b/i);
  if (textMatch) {
    return { label: `Text${textMatch[1]}`, type: 'reading' };
  }

  // Translation (Part C)
  if (/part\s*c|translation|翻译/.test(lower)) {
    return { label: 'Section II·Part C Translation', type: 'translation' };
  }

  // New Type (Part B)
  if (/part\s*b|新题型|七选五|排序|小标题|heading/.test(lower)) {
    return { label: 'Section II·Part B', type: 'new_type' };
  }

  // Generic Reading
  if (/reading|阅读|part\s*a/.test(lower)) {
    return { label: 'Text1', type: 'reading' };
  }

  if (/通用精读|general/.test(lower)) {
    return { label: '通用精读', type: 'general' };
  }

  return { label: trimmed, type: 'general' };
}

/**
 * Detect section type heuristically from title + content + optional parent section context.
 * Fixed: NEVER misclassify Reading passages (Text1-4) as Cloze due to occasional ___ or (1)/(2)!
 */
export function detectSectionType(
  title: string,
  body: string,
  parentSection?: 'section1' | 'section2' | 'section3',
): ExamSection['type'] {
  const titleLower = title.toLowerCase();
  const bodySample = body.slice(0, 1200);
  const combined = `${title}\n${bodySample}`.toLowerCase();

  // 1. Explicit title / parent context always wins
  if (parentSection === 'section3' || /section\s*(iii|3)\b|writ+ing|写作|[大小]?作文/.test(titleLower)) {
    return 'writing';
  }
  if (/use\s+of\s+english|cloze|完[形型]/.test(titleLower)) {
    return 'cloze';
  }
  if (/part\s*c|translation|翻译/.test(titleLower)) {
    return 'translation';
  }
  if (/part\s*b|新题型|七选五|排序|小标题|heading/.test(titleLower)) {
    return 'new_type';
  }
  if (/text\s*[1-4]\b|reading|阅读|part\s*a/.test(titleLower)) {
    return 'reading';
  }

  // 2. Body heuristics (strict thresholds to avoid false positives!)
  if (
    /\[图画\/图表信息|write\s+an?\s+(essay|letter|email|notice|memo|reply|report)|about\s+(100|150)\s+words|160\s*[-–—~]\s*200\s+words|do\s+not\s+sign\s+your\s+own\s+name/i.test(
      combined,
    )
  ) {
    return 'writing';
  }

  if (/<u>\s*\(\s*46\s*\)|\b\(46\)[\s\S]{10,500}\(47\)/.test(body)) {
    return 'translation';
  }

  if (/\[\s*A\s*\][\s\S]*\[\s*G\s*\]/.test(body) && /41|42|43|44|45/.test(body)) {
    return 'new_type';
  }

  // Require >= 5 cloze blanks ([[1]]..[[5]] or ___1___..___5___) before inferring cloze from body alone
  const bracketBlanks = (body.match(/\[\[\s*(?:[1-9]|1\d|20)\s*\]\]/g) || []).length;
  const underscoreBlanks = (body.match(/_{2,}\s*(?:[1-9]|1\d|20)\s*_{2,}/g) || []).length;
  if (bracketBlanks >= 5 || underscoreBlanks >= 5) {
    return 'cloze';
  }

  if (/\b(21|26|31|36)\.\s/.test(body) || body.trim().length > 260) {
    return 'reading';
  }
  return 'general';
}

function getDefaultCanonicalTitle(type: ExamSection['type'], rawTitle: string, readingIndex: number): string {
  const lower = rawTitle.toLowerCase();
  if (type === 'cloze') return 'Section I Use of English';
  if (type === 'new_type') return 'Section II·Part B';
  if (type === 'translation') return 'Section II·Part C Translation';
  if (type === 'writing') {
    if (/part\s*a|小作文/.test(lower)) return 'Section III·Writing·Part A';
    if (/part\s*b|大作文/.test(lower)) return 'Section III·Writing·Part B';
    return 'Section III·Writing';
  }
  if (type === 'reading') {
    const m = rawTitle.match(/text\s*([1-4])\b/i);
    if (m) return `Text${m[1]}`;
    return `Text${Math.min(4, Math.max(1, readingIndex))}`;
  }
  return rawTitle || '通用精读';
}

const SECTION_HEADER_REGEX =
  /^(?:#{1,3}\s*)?(Section\s+(?:III|II|I|[1-3])(?:\s*[·•\-:]\s*[^\n]+|\s+(?:Use\s+of\s+English|Reading\s+Comprehension|Writ+ing)[^\n]*)?|Part\s+[A-C](?:\s*[·•:\-].*)?|Text\s*[1-4](?:\s*[·•:\-].*)?|完[形型]填空[^\n]*|新题型[^\n]*|翻译[题部]?[^\n]*|Translation[^\n]*|Reading\s+Comprehension[^\n]*|Writ+ing[^\n]*|[大小]?作文[^\n]*|写作[题部]?[^\n]*)$/i;

function detectParentSectionContext(
  header: string,
  current?: 'section1' | 'section2' | 'section3',
): 'section1' | 'section2' | 'section3' | undefined {
  const lower = header.toLowerCase();
  if (/^section\s*(i\b|1\b)|use\s+of\s+english|完[形型]/.test(lower)) return 'section1';
  if (/^section\s*(ii\b|2\b)|reading\s+comprehension|^text\s*[1-4]\b/.test(lower)) return 'section2';
  if (/^section\s*(iii\b|3\b)|writ+ing|写作|[大小]?作文/.test(lower)) return 'section3';
  return current;
}

/**
 * Strips leading `=== [Label] ===` line when sending text to the LLM so the model gets clean exam text.
 */
export function stripExplicitMarkerLine(sliceText: string): string {
  const lines = sliceText.replace(/\r\n/g, '\n').split('\n');
  if (lines.length > 0 && EXPLICIT_MARKER_REGEX.test(lines[0].trim())) {
    return lines.slice(1).join('\n').trim();
  }
  return sliceText.trim();
}

/**
 * Splits a full or partial Kaoyan English paper into structured section drafts.
 * Supports explicit `=== [标准标签] ===` boundaries (highest priority, never overridden by heuristics).
 */
export function splitPaperIntoSections(
  rawText: string,
  forcedType?: ExamSection['type'] | 'auto',
): ParsedSectionDraft[] {
  const normalized = rawText.replace(/\r\n/g, '\n').trim();
  if (!normalized) return [];

  if (forcedType && forcedType !== 'auto') {
    const typeLabels: Record<ExamSection['type'], string> = {
      cloze: 'Section I Use of English',
      reading: 'Text1',
      new_type: 'Section II·Part B',
      translation: 'Section II·Part C Translation',
      writing: 'Section III·Writing',
      general: '通用精读',
    };
    const cleanBody = stripExplicitMarkerLine(normalized);
    return [
      {
        id: 'sec-1',
        title: typeLabels[forcedType],
        type: forcedType,
        rawText: cleanBody,
        vocabCount: listMarkedVocabTokens(cleanBody).length,
        startLine: 0,
        endLine: normalized.split('\n').length - 1,
        hasExplicitMarker: false,
      },
    ];
  }

  const lines = normalized.split('\n');
  const boundaries: Array<{
    lineIdx: number;
    title: string;
    isExplicit: boolean;
    explicitType?: ExamSection['type'];
    parentSection?: 'section1' | 'section2' | 'section3';
  }> = [];

  let currentParent: 'section1' | 'section2' | 'section3' | undefined;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.length > 90) continue;

    const explicitMatch = line.match(EXPLICIT_MARKER_REGEX);
    if (explicitMatch) {
      const resolved = resolveCanonicalLabelAndType(explicitMatch[1], currentParent);
      currentParent = detectParentSectionContext(resolved.label, currentParent);
      boundaries.push({
        lineIdx: i,
        title: resolved.label,
        isExplicit: true,
        explicitType: resolved.type,
        parentSection: currentParent,
      });
      continue;
    }

    // Avoid false splits on lines that clearly look like full sentences ending in period/question mark
    if (/[.?!。？！]$/.test(line) && !/^part\s*[a-c]\b/i.test(line)) continue;

    if (SECTION_HEADER_REGEX.test(line)) {
      const cleanTitle = line.replace(/^#{1,3}\s*/, '').trim();
      currentParent = detectParentSectionContext(cleanTitle, currentParent);
      boundaries.push({
        lineIdx: i,
        title: cleanTitle,
        isExplicit: false,
        parentSection: currentParent,
      });
    }
  }

  // Case: 0 or 1 boundary found
  if (boundaries.length === 0) {
    const type = detectSectionType('', normalized);
    const title = getDefaultCanonicalTitle(type, '', 1);
    return [
      {
        id: 'sec-1',
        title,
        type,
        rawText: normalized,
        vocabCount: listMarkedVocabTokens(normalized).length,
        startLine: 0,
        endLine: lines.length - 1,
        hasExplicitMarker: false,
      },
    ];
  }

  const drafts: ParsedSectionDraft[] = [];
  let readingCounter = 0;

  // Handle any leading text before the first boundary
  if (boundaries[0].lineIdx > 0) {
    const preSlice = lines.slice(0, boundaries[0].lineIdx).join('\n').trim();
    if (preSlice.length >= 20) {
      const preType = detectSectionType('', preSlice);
      if (preType === 'reading') readingCounter++;
      const preTitle = getDefaultCanonicalTitle(preType, '', readingCounter || 1);
      drafts.push({
        id: `sec-${drafts.length + 1}`,
        title: preTitle,
        type: preType,
        rawText: preSlice,
        vocabCount: listMarkedVocabTokens(preSlice).length,
        startLine: 0,
        endLine: boundaries[0].lineIdx - 1,
        hasExplicitMarker: false,
      });
    }
  }

  for (let b = 0; b < boundaries.length; b++) {
    const cur = boundaries[b];
    const start = cur.lineIdx;
    const end = b + 1 < boundaries.length ? boundaries[b + 1].lineIdx : lines.length;
    const bodyWithoutHeader = lines.slice(start + 1, end).join('\n').trim();

    // Skip empty wrapper headers (e.g., "Section II Reading Comprehension" immediately followed by "Text 1")
    if (bodyWithoutHeader.length < 12 && !cur.isExplicit) continue;

    // Skip Section II Part A directions-only wrapper immediately followed by Text 1
    const nextTitle = boundaries[b + 1]?.title || '';
    if (
      !cur.isExplicit &&
      /^part\s*a\b/i.test(cur.title) &&
      cur.parentSection !== 'section3' &&
      /^text\s*1\b/i.test(nextTitle) &&
      bodyWithoutHeader.length < 320 &&
      /directions/i.test(bodyWithoutHeader)
    ) {
      continue;
    }

    const type =
      cur.isExplicit && cur.explicitType
        ? cur.explicitType
        : detectSectionType(cur.title, bodyWithoutHeader, cur.parentSection);

    if (type === 'reading') readingCounter++;

    const title = cur.isExplicit
      ? cur.title
      : getDefaultCanonicalTitle(
          type,
          cur.parentSection === 'section3' && /^part\s*[ab]\b/i.test(cur.title)
            ? `Section III·Writing·${cur.title}`
            : cur.title,
          readingCounter || 1,
        );

    const rawSlice = cur.isExplicit
      ? bodyWithoutHeader
      : lines.slice(start, end).join('\n').trim();

    if (!rawSlice) continue;

    drafts.push({
      id: `sec-${drafts.length + 1}`,
      title,
      type,
      rawText: rawSlice,
      vocabCount: listMarkedVocabTokens(rawSlice).length,
      startLine: start,
      endLine: end - 1,
      hasExplicitMarker: cur.isExplicit,
    });
  }

  if (drafts.length === 0) {
    const clean = stripExplicitMarkerLine(normalized);
    const type = detectSectionType('', clean);
    return [
      {
        id: 'sec-1',
        title: getDefaultCanonicalTitle(type, '', 1),
        type,
        rawText: clean,
        vocabCount: listMarkedVocabTokens(clean).length,
        startLine: 0,
        endLine: lines.length - 1,
        hasExplicitMarker: false,
      },
    ];
  }

  return drafts;
}

/**
 * Rebuilds rawText with explicit `=== [Label] ===` markers for every draft so boundaries are 100% locked.
 */
export function lockSectionsWithExplicitMarkers(drafts: ParsedSectionDraft[]): string {
  return drafts
    .map((d) => `=== [${d.title}] ===\n${stripExplicitMarkerLine(d.rawText)}`)
    .join('\n\n');
}

/**
 * Updates the section label/type of a specific draft index directly inside `rawText`.
 */
export function updateSectionMarkerInRawText(
  rawText: string,
  draftIdx: number,
  newLabel: string,
  currentDrafts: ParsedSectionDraft[],
): string {
  const updated = currentDrafts.map((d, i) =>
    i === draftIdx ? { ...d, title: newLabel } : d,
  );
  return lockSectionsWithExplicitMarkers(updated);
}

/**
 * Merges draft `draftIdx` (where draftIdx > 0) into `draftIdx - 1` inside `rawText`.
 */
export function mergeSectionWithPreviousInRawText(
  draftIdx: number,
  currentDrafts: ParsedSectionDraft[],
): string {
  if (draftIdx <= 0 || draftIdx >= currentDrafts.length) {
    return lockSectionsWithExplicitMarkers(currentDrafts);
  }
  const merged: ParsedSectionDraft[] = [];
  for (let i = 0; i < currentDrafts.length; i++) {
    if (i === draftIdx) {
      const prev = merged[merged.length - 1];
      prev.rawText = `${stripExplicitMarkerLine(prev.rawText)}\n\n${stripExplicitMarkerLine(currentDrafts[i].rawText)}`.trim();
      prev.vocabCount = listMarkedVocabTokens(prev.rawText).length;
    } else {
      merged.push({ ...currentDrafts[i] });
    }
  }
  return lockSectionsWithExplicitMarkers(merged);
}

/**
 * Builds line-numbered text (`L1: ...`) for AI smart paper segmentation.
 */
export function buildLineNumberedText(rawText: string): { numberedText: string; lines: string[] } {
  const lines = rawText.replace(/\r\n/g, '\n').split('\n');
  const numberedText = lines.map((line, i) => `L${i + 1}: ${line}`).join('\n');
  return { numberedText, lines };
}

/**
 * Deterministically slices rawText using 1-based inclusive line ranges returned by AI split.
 * Guarantees 100% verbatim preservation of {{vocab}} and <u>...</u> tags.
 */
export function sliceTextByLineRanges(
  rawText: string,
  segments: Array<{ label: string; type: ExamSection['type']; startLine: number; endLine: number }>,
): ParsedSectionDraft[] {
  const lines = rawText.replace(/\r\n/g, '\n').split('\n');
  const total = lines.length;
  if (total === 0 || segments.length === 0) return [];

  const sorted = [...segments]
    .map((seg) => ({
      ...seg,
      startLine: Math.max(1, Math.min(total, seg.startLine)),
      endLine: Math.max(1, Math.min(total, seg.endLine)),
    }))
    .filter((seg) => seg.startLine <= seg.endLine)
    .sort((a, b) => a.startLine - b.startLine);

  const drafts: ParsedSectionDraft[] = [];
  for (let i = 0; i < sorted.length; i++) {
    const seg = sorted[i];
    const resolved = resolveCanonicalLabelAndType(seg.label);
    const slice = lines
      .slice(seg.startLine - 1, seg.endLine)
      .filter((l) => !EXPLICIT_MARKER_REGEX.test(l.trim()))
      .join('\n')
      .trim();
    if (!slice) continue;

    drafts.push({
      id: `sec-${drafts.length + 1}`,
      title: resolved.label,
      type: seg.type || resolved.type,
      rawText: slice,
      vocabCount: listMarkedVocabTokens(slice).length,
      startLine: seg.startLine - 1,
      endLine: seg.endLine - 1,
      hasExplicitMarker: false,
    });
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
          source: 'user',
          surfaceForms: [surfaceForm],
          occurrences: [],
        };
        map.set(key, entry);
      } else if (!entry.surfaceForms.includes(surfaceForm)) {
        entry.surfaceForms.push(surfaceForm);
      }

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
  let left = startIdx;
  while (left > 0) {
    const ch = text[left - 1];
    if (ch === '\n' || ((ch === '.' || ch === '!' || ch === '?') && /\s/.test(text[left] || ' '))) {
      break;
    }
    left--;
  }

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
    .replace(/<\/?u>/gi, '')
    .replace(/\{\{([^{}]+?)\}\}/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Verifies AI-discovered surfaceForms against the actual section rawText using word boundaries,
 * extracting verbatim containing sentences so ZERO hallucinated words enter the vocabulary book.
 */
export function extractNamedVocabOccurrences(
  section: { id: string; title: string; rawText: string },
  candidates: Array<{ surfaceForm: string; lemma?: string }>,
  existingKeys: Set<string>,
): { items: ExtractedVocabItem[]; matchedForms: string[] } {
  const cleanText = section.rawText
    .replace(/<\/?u>/gi, '')
    .replace(/\{\{([^{}]+?)\}\}/g, '$1');

  const items: ExtractedVocabItem[] = [];
  const matchedForms: string[] = [];
  const localSeen = new Set<string>(existingKeys);

  for (const cand of candidates) {
    const form = cand.surfaceForm.trim();
    if (!form || form.length < 2 || form.length > 60) continue;
    const key = form.toLowerCase().replace(/\s+/g, ' ');
    const lemmaKey = cand.lemma?.trim().toLowerCase().replace(/\s+/g, ' ');
    if (localSeen.has(key) || (lemmaKey && localSeen.has(lemmaKey))) continue;

    // Build whole-word boundary pattern (allows spaces/hyphens/apostrophes inside multi-word phrases)
    const pattern = new RegExp(`(?<![A-Za-z])${escapeRegExp(form)}(?![A-Za-z])`, 'gi');
    const occurrences: ExtractedVocabItem['occurrences'] = [];
    const surfaceSet = new Set<string>();
    let match: RegExpExecArray | null;

    while ((match = pattern.exec(cleanText)) !== null) {
      const actualSurface = match[0];
      surfaceSet.add(actualSurface);
      const sentenceEn = findContainingSentence(
        cleanText,
        match.index,
        match.index + actualSurface.length,
      );
      if (!occurrences.some((o) => o.sentenceEn === sentenceEn)) {
        occurrences.push({
          sectionId: section.id,
          sectionTitle: section.title,
          surfaceForm: actualSurface,
          sentenceEn,
        });
      }
      // Keep at most 2 representative occurrences per section for AI-supplemented words
      if (occurrences.length >= 2) break;
    }

    if (occurrences.length === 0) continue;

    localSeen.add(key);
    if (lemmaKey) localSeen.add(lemmaKey);

    const formsArr = Array.from(surfaceSet);
    matchedForms.push(...formsArr);
    items.push({
      key,
      source: 'ai',
      surfaceForms: formsArr,
      occurrences,
    });
  }

  return { items, matchedForms };
}

/**
 * Safely wraps AI-supplemented surfaceForms with `{{...}}` in plain-text spans of an English string,
 * skipping any existing `{{...}}`, `[[...]]`, or `<u>` / `</u>` tags.
 */
export function injectVocabMarkersIntoText(text: string, surfaceForms: string[]): string {
  if (!text || surfaceForms.length === 0) return text;

  const uniqueForms = Array.from(
    new Set(surfaceForms.map((s) => s.trim()).filter((s) => s.length >= 2)),
  ).sort((a, b) => b.length - a.length);
  if (uniqueForms.length === 0) return text;

  const wordRegex = new RegExp(
    `(?<![A-Za-z])(${uniqueForms.map(escapeRegExp).join('|')})(?![A-Za-z])`,
    'gi',
  );

  // Split out protected tokens so we NEVER nest {{}} inside {{}} or break [[1]] / <u> tags
  const protectedSplit = /(\{\{[^{}]+?\}\}|\[\[\s*\d+\s*\]\]|<\/?u>)/gi;
  return text
    .split(protectedSplit)
    .map((segment) => {
      if (!segment) return '';
      if (
        (segment.startsWith('{{') && segment.endsWith('}}')) ||
        (segment.startsWith('[[') && segment.endsWith(']]')) ||
        /^<\/?u>$/i.test(segment)
      ) {
        return segment;
      }
      return segment.replace(wordRegex, '{{$1}}');
    })
    .join('');
}

/**
 * Injects `{{...}}` markers for AI-supplemented vocabulary into a parsed ExamSection's rendered English text
 * so AI-added words also get clickable amber underlines and Word Popover Cards in the Reading View.
 */
export function injectVocabMarkersIntoSection(
  section: ExamSection,
  surfaceForms: string[],
): ExamSection {
  if (surfaceForms.length === 0) return section;
  const wrap = (t: string) => injectVocabMarkersIntoText(t, surfaceForms);

  if (section.type === 'cloze') {
    return {
      ...section,
      paragraphs: section.paragraphs.map((p) => ({ ...p, en: wrap(p.en) })),
    };
  }
  if (section.type === 'reading') {
    return {
      ...section,
      paragraphs: section.paragraphs.map((p) => ({ ...p, en: wrap(p.en) })),
    };
  }
  if (section.type === 'new_type') {
    return {
      ...section,
      blocks: section.blocks.map((b) => ({ ...b, en: wrap(b.en) })),
      optionBank: section.optionBank.map((o) => ({ ...o, en: wrap(o.en) })),
    };
  }
  if (section.type === 'translation') {
    return {
      ...section,
      contextPassage: section.contextPassage?.map((p) => ({ ...p, en: wrap(p.en) })),
      items: section.items.map((it) => ({ ...it, originalEn: wrap(it.originalEn) })),
    };
  }
  if (section.type === 'writing') {
    return {
      ...section,
      tasks: section.tasks.map((task) => ({
        ...task,
        promptEn: wrap(task.promptEn),
        sampleEssay: {
          ...task.sampleEssay,
          paragraphs: task.sampleEssay.paragraphs.map((p) => ({ ...p, en: wrap(p.en) })),
        },
      })),
    };
  }
  return {
    ...section,
    paragraphs: section.paragraphs.map((p) => ({ ...p, en: wrap(p.en) })),
  };
}
