import { useMemo, useState } from 'react';
import {
  ArrowLeft,
  Download,
  Eye,
  EyeOff,
  FileText,
  Printer,
  Search,
  Sparkles,
  Volume2,
} from 'lucide-react';
import type { VocabEntry } from '../../types/exam';

type PrintLayoutMode = 'complete' | 'compact' | 'dictation';

interface Props {
  title: string;
  vocabulary: VocabEntry[];
  highlightedVocabId?: string | null;
  onJumpToSection?: (sectionId: string) => void;
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
    // ignore
  }
}

function downloadTextFile(filename: string, content: string, mime = 'text/plain;charset=utf-8') {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function VocabBookView({
  title,
  vocabulary,
  highlightedVocabId,
  onJumpToSection,
}: Props) {
  const [query, setQuery] = useState('');
  const [sectionFilter, setSectionFilter] = useState<string>('all');
  const [sourceFilter, setSourceFilter] = useState<'all' | 'user' | 'ai'>('all');
  const [sortBy, setSortBy] = useState<'order' | 'alpha'>('order');
  const [recallMode, setRecallMode] = useState(false);
  const [revealedIds, setRevealedIds] = useState<Set<string>>(new Set());
  const [printMode, setPrintMode] = useState<PrintLayoutMode>('complete');
  const [showPrintMenu, setShowPrintMenu] = useState(false);

  const hasAiSupplemented = useMemo(
    () => vocabulary.some((v) => v.source === 'ai'),
    [vocabulary],
  );

  const sectionOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const v of vocabulary) {
      for (const occ of v.occurrences) {
        if (!map.has(occ.sectionId)) {
          map.set(occ.sectionId, occ.sectionTitle);
        }
      }
    }
    return Array.from(map.entries());
  }, [vocabulary]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = vocabulary.filter((v) => {
      if (sourceFilter === 'ai' && v.source !== 'ai') return false;
      if (sourceFilter === 'user' && v.source === 'ai') return false;
      if (sectionFilter !== 'all') {
        const hasSec = v.occurrences.some((o) => o.sectionId === sectionFilter);
        if (!hasSec) return false;
      }
      if (!q) return true;
      const inWord =
        v.lemma.toLowerCase().includes(q) ||
        v.surfaceForms.some((f) => f.toLowerCase().includes(q));
      const inMeaning =
        v.comprehensiveMeanings.some((m) =>
          m.definitions.some((d) => d.toLowerCase().includes(q)),
        ) || v.occurrences.some((o) => o.contextMeaning.toLowerCase().includes(q));
      return inWord || inMeaning;
    });

    if (sortBy === 'alpha') {
      list = [...list].sort((a, b) => a.lemma.localeCompare(b.lemma));
    }
    return list;
  }, [vocabulary, query, sectionFilter, sourceFilter, sortBy]);

  // Pair vocabulary entries into atomic 2-card rows for zero-cutoff 2-column A4 PDF printing
  const pairedPrintRows = useMemo(() => {
    const rows: Array<[VocabEntry, VocabEntry | null]> = [];
    for (let i = 0; i < filtered.length; i += 2) {
      rows.push([filtered[i], filtered[i + 1] ?? null]);
    }
    return rows;
  }, [filtered]);

  const toggleReveal = (id: string) => {
    setRevealedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handlePrintPdf = (mode: PrintLayoutMode) => {
    setPrintMode(mode);
    setShowPrintMenu(false);
    // Wait two animation frames + micro-delay so React flushes the dedicated print sheet before window.print()
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        setTimeout(() => {
          window.print();
        }, 60);
      });
    });
  };

  const handleExportMarkdown = () => {
    const lines: string[] = [
      `# ${title} · 生词本（共 ${filtered.length} 词）`,
      '',
      `> 导出时间：${new Date().toLocaleString()}`,
      '',
    ];
    for (const v of filtered) {
      lines.push(`## ${v.lemma}  ${v.phoneticUk || ''} ${v.phoneticUs || ''}`.trim());
      if (v.occurrences[0]) {
        lines.push(
          `- **本文语境义**：${v.occurrences[0].contextMeaning}${
            v.occurrences[0].isUncommonMeaning ? '（熟词僻义）' : ''
          }`,
        );
      }
      for (const m of v.comprehensiveMeanings) {
        lines.push(`- **${m.pos}** ${m.definitions.join('；')}`);
      }
      if (v.collocations.length > 0) {
        lines.push(
          `- **常见搭配**：${v.collocations.map((c) => `\`${c.phrase}\` ${c.meaning}`).join(' ｜ ')}`,
        );
      }
      if (v.occurrences[0]?.sentenceEn) {
        lines.push(`- **原句**：${v.occurrences[0].sentenceEn}`);
        if (v.occurrences[0].sentenceZh) {
          lines.push(`  - ${v.occurrences[0].sentenceZh}`);
        }
      }
      lines.push('');
    }
    downloadTextFile(`${title}-生词本.md`, lines.join('\n'), 'text/markdown;charset=utf-8');
  };

  const handleExportAnkiTsv = () => {
    const rows = filtered.map((v) => {
      const front = `${v.lemma} ${v.phoneticUs || v.phoneticUk || ''}`.trim();
      const ctx = v.occurrences[0] ? `[语境] ${v.occurrences[0].contextMeaning}<br>` : '';
      const all = v.comprehensiveMeanings
        .map((m) => `<b>${m.pos}</b> ${m.definitions.join('；')}`)
        .join('<br>');
      const ex = v.occurrences[0]?.sentenceEn
        ? `<br><small>${v.occurrences[0].sentenceEn}</small>`
        : '';
      const back = `${ctx}${all}${ex}`.replace(/\t/g, ' ').replace(/\r?\n/g, ' ');
      return `${front.replace(/\t/g, ' ')}\t${back}`;
    });
    downloadTextFile(`${title}-Anki词卡.tsv`, rows.join('\n'), 'text/tab-separated-values;charset=utf-8');
  };

  return (
    <div className="space-y-4">
      {/* Toolbar Island (Hidden when printing) */}
      <div className="no-print island p-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2.5 flex-1 min-w-[220px]">
          <div className="relative flex-1 min-w-[180px] max-w-xs">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="搜索单词或中文释义..."
              className="w-full rounded-xl border border-border-subtle bg-surface-subtle py-2 pl-9 pr-3 text-sm text-text-primary placeholder:text-text-muted focus:border-accent focus:outline-none"
            />
          </div>

          {sectionOptions.length > 1 && (
            <select
              value={sectionFilter}
              onChange={(e) => setSectionFilter(e.target.value)}
              className="rounded-xl border border-border-subtle bg-surface-subtle px-3 py-2 text-xs font-medium text-text-primary focus:border-accent focus:outline-none"
            >
              <option value="all">全部题型（{vocabulary.length}）</option>
              {sectionOptions.map(([id, secTitle]) => (
                <option key={id} value={id}>
                  {secTitle}
                </option>
              ))}
            </select>
          )}

          {hasAiSupplemented && (
            <select
              value={sourceFilter}
              onChange={(e) => setSourceFilter(e.target.value as 'all' | 'user' | 'ai')}
              className="rounded-xl border border-border-subtle bg-surface-subtle px-3 py-2 text-xs font-medium text-text-primary focus:border-accent focus:outline-none"
            >
              <option value="all">全部来源（{vocabulary.length}）</option>
              <option value="user">
                手标生词（{vocabulary.filter((v) => v.source !== 'ai').length}）
              </option>
              <option value="ai">
                AI 补充（{vocabulary.filter((v) => v.source === 'ai').length}）
              </option>
            </select>
          )}

          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as 'order' | 'alpha')}
            className="rounded-xl border border-border-subtle bg-surface-subtle px-3 py-2 text-xs font-medium text-text-primary focus:border-accent focus:outline-none"
          >
            <option value="order">按文中出现顺序</option>
            <option value="alpha">按字母 A–Z</option>
          </select>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => {
              setRecallMode((v) => !v);
              setRevealedIds(new Set());
            }}
            className={`inline-flex items-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-medium transition ${
              recallMode
                ? 'border-vocab/40 bg-vocab-soft text-vocab'
                : 'border-border-subtle bg-surface-subtle text-text-secondary hover:text-text-primary'
            }`}
          >
            {recallMode ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
            {recallMode ? '背词自测中（点击卡片显示）' : '背词遮挡模式'}
          </button>

          <button
            type="button"
            onClick={handleExportMarkdown}
            className="inline-flex items-center gap-1.5 rounded-xl border border-border-subtle bg-surface-subtle px-3 py-2 text-xs font-medium text-text-secondary transition hover:text-text-primary"
            title="导出 Markdown"
          >
            <FileText className="h-3.5 w-3.5" />
            MD
          </button>

          <button
            type="button"
            onClick={handleExportAnkiTsv}
            className="inline-flex items-center gap-1.5 rounded-xl border border-border-subtle bg-surface-subtle px-3 py-2 text-xs font-medium text-text-secondary transition hover:text-text-primary"
            title="导出 Anki 制卡 TSV"
          >
            <Download className="h-3.5 w-3.5" />
            Anki
          </button>

          {/* Print / Export PDF Menu */}
          <div className="relative">
            <button
              type="button"
              onClick={() => setShowPrintMenu((v) => !v)}
              className="inline-flex items-center gap-1.5 rounded-xl bg-accent px-3.5 py-2 text-xs font-medium text-white shadow-xs transition hover:opacity-92"
            >
              <Printer className="h-3.5 w-3.5" />
              打印 / 导出 PDF
            </button>

            {showPrintMenu && (
              <div className="absolute right-0 mt-2 z-30 w-64 island-popover p-2 space-y-1">
                <button
                  type="button"
                  onClick={() => handlePrintPdf('complete')}
                  className="w-full rounded-xl px-3 py-2 text-left transition hover:bg-surface-subtle"
                >
                  <div className="text-xs font-semibold text-text-primary">完整精读版 PDF</div>
                  <div className="text-[11px] text-text-muted">A4 单栏防截断 · 释义 + 搭配 + 原句</div>
                </button>
                <button
                  type="button"
                  onClick={() => handlePrintPdf('compact')}
                  className="w-full rounded-xl px-3 py-2 text-left transition hover:bg-surface-subtle"
                >
                  <div className="text-xs font-semibold text-text-primary">紧凑双栏背词版 PDF</div>
                  <div className="text-[11px] text-text-muted">A4 双栏整行防截断 · 高密度省纸</div>
                </button>
                <button
                  type="button"
                  onClick={() => handlePrintPdf('dictation')}
                  className="w-full rounded-xl px-3 py-2 text-left transition hover:bg-surface-subtle"
                >
                  <div className="text-xs font-semibold text-text-primary">默写自测版 PDF</div>
                  <div className="text-[11px] text-text-muted">双栏隐藏中文释义，留出默写横线</div>
                </button>
                <div className="border-t border-border-subtle px-3 pt-1.5 pb-1 text-[10.5px] text-text-muted">
                  已启用 A4 防跨页截断排版，请在打印窗口选择「另存为 PDF」。
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ==================== SCREEN VIEW (Interactive, hidden in PDF print) ==================== */}
      {filtered.length === 0 ? (
        <div className="no-print island p-10 text-center text-sm text-text-muted">
          {vocabulary.length === 0
            ? '本套试卷尚未标记 {{生词}}，或生词本仍在生成中。'
            : '没有找到匹配的生词。'}
        </div>
      ) : (
        <div className="no-print grid gap-3.5 grid-cols-1">
          {filtered.map((entry, index) => {
            const isHighlighted = highlightedVocabId === entry.id;
            const isHidden = recallMode && !revealedIds.has(entry.id);

            return (
              <article
                key={entry.id}
                id={`vocab-card-${entry.id}`}
                onClick={() => {
                  if (recallMode) toggleReveal(entry.id);
                }}
                className={`island p-4 sm:p-5 transition ${
                  recallMode ? 'cursor-pointer' : ''
                } ${isHighlighted ? 'ring-2 ring-vocab' : ''}`}
              >
                {/* Word Header */}
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="flex flex-wrap items-baseline gap-2.5">
                    <span className="font-mono text-xs text-text-muted">
                      {String(index + 1).padStart(2, '0')}
                    </span>
                    <h3 className="font-serif text-xl font-bold text-text-primary">
                      {entry.lemma}
                    </h3>
                    {entry.source === 'ai' && (
                      <span className="rounded-md bg-accent-soft px-1.5 py-0.5 text-[10.5px] font-medium text-accent">
                        AI 补充
                      </span>
                    )}
                    {entry.surfaceForms.filter(
                      (f) => f.toLowerCase() !== entry.lemma.toLowerCase(),
                    ).length > 0 && (
                      <span className="rounded-md bg-surface-subtle px-2 py-0.5 text-xs text-text-muted">
                        文中形态:{' '}
                        {entry.surfaceForms
                          .filter((f) => f.toLowerCase() !== entry.lemma.toLowerCase())
                          .join(', ')}
                      </span>
                    )}
                    <div className="flex items-center gap-2 text-xs text-text-muted">
                      {entry.phoneticUk && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            speakWord(entry.lemma, 'en-GB');
                          }}
                          className="inline-flex items-center gap-1 hover:text-accent"
                        >
                          <span>UK {entry.phoneticUk}</span>
                          <Volume2 className="h-3.5 w-3.5" />
                        </button>
                      )}
                      {entry.phoneticUs && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            speakWord(entry.lemma, 'en-US');
                          }}
                          className="inline-flex items-center gap-1 hover:text-accent"
                        >
                          <span>US {entry.phoneticUs}</span>
                          <Volume2 className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                  </div>

                  {entry.occurrences[0] && onJumpToSection && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onJumpToSection(entry.occurrences[0].sectionId);
                      }}
                      className="inline-flex items-center gap-1 rounded-lg bg-surface-subtle px-2.5 py-1 text-xs text-text-secondary hover:text-accent"
                    >
                      <ArrowLeft className="h-3 w-3" />
                      {entry.occurrences[0].sectionTitle}
                    </button>
                  )}
                </div>

                {/* Body Content (Blurred in Recall mode) */}
                <div
                  className={`mt-3 space-y-3 transition ${
                    isHidden ? 'blur-sm select-none opacity-40' : ''
                  }`}
                >
                  {/* Context Meaning */}
                  {entry.occurrences.length > 0 && (
                    <div className="rounded-xl border border-vocab/25 bg-vocab-soft/60 px-3.5 py-2.5 space-y-1">
                      {entry.occurrences.map((occ, i) => (
                        <div key={i} className="flex flex-wrap items-center gap-2 text-sm">
                          <span className="inline-flex items-center gap-1 text-xs font-semibold text-vocab">
                            <Sparkles className="h-3.5 w-3.5" />
                            本文语境义
                          </span>
                          <span className="font-medium text-text-primary">
                            {occ.contextMeaning}
                          </span>
                          {occ.isUncommonMeaning && (
                            <span className="rounded-full bg-vocab/20 px-2 py-0.5 text-[10px] font-semibold text-vocab">
                              熟词僻义
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Comprehensive Meanings */}
                  <div className="space-y-1.5">
                    {entry.comprehensiveMeanings.map((m, idx) => (
                      <div key={idx} className="flex items-start gap-2 text-sm leading-relaxed">
                        <span className="mt-0.5 shrink-0 rounded bg-surface-subtle px-1.5 py-0.5 font-mono text-xs font-semibold text-accent">
                          {m.pos}
                        </span>
                        <span className="text-text-primary">{m.definitions.join('；')}</span>
                      </div>
                    ))}
                  </div>

                  {/* Collocations & Confusables */}
                  <div className="space-y-2">
                    {entry.collocations.length > 0 && (
                      <div className="flex flex-wrap gap-2 text-xs">
                        {entry.collocations.map((c, i) => (
                          <span
                            key={i}
                            className="rounded-lg border border-border-subtle bg-surface-subtle px-2.5 py-1 text-text-secondary"
                          >
                            <strong className="font-medium text-text-primary">{c.phrase}</strong>{' '}
                            {c.meaning}
                          </span>
                        ))}
                      </div>
                    )}

                    {entry.wordFamily && entry.wordFamily.length > 0 && (
                      <div className="text-xs text-text-muted">
                        <span className="font-medium text-text-secondary">词族拓展：</span>
                        {entry.wordFamily.join(' · ')}
                      </div>
                    )}

                    {entry.confusables && entry.confusables.length > 0 && (
                      <div className="text-xs text-text-secondary">
                        <span className="font-semibold text-text-primary">易混辨析：</span>
                        {entry.confusables.map((c) => `${c.word}（${c.diff}）`).join('；')}
                      </div>
                    )}

                    {/* Original Sentence Excerpt */}
                    {entry.occurrences[0]?.sentenceEn && (
                      <div className="rounded-xl bg-surface-subtle/70 px-3.5 py-2.5 text-xs space-y-1 border-l-2 border-border-strong">
                        <p className="font-serif text-[13.5px] leading-relaxed text-text-primary">
                          {entry.occurrences[0].sentenceEn}
                        </p>
                        {entry.occurrences[0].sentenceZh && (
                          <p className="text-text-secondary leading-relaxed">
                            {entry.occurrences[0].sentenceZh}
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}

      {/* ==================== DEDICATED PRINT / PDF SHEET (Zero Flex/Grid Card Cutoff) ==================== */}
      {filtered.length > 0 && (
        <div className="hidden print-only print-sheet">
          <div className="print-header">
            <h1 style={{ fontSize: '15pt', fontWeight: 700, margin: 0, color: '#111827' }}>
              {title} · 生词本（{filtered.length} 词）
            </h1>
            <p style={{ fontSize: '8.5pt', color: '#6b7280', margin: '3px 0 0 0' }}>
              Studying-Mate 导出 ·{' '}
              {printMode === 'dictation'
                ? '默写自测版'
                : printMode === 'compact'
                  ? '紧凑双栏背词版'
                  : '完整精读版'}{' '}
              · {new Date().toLocaleDateString()}
            </p>
          </div>

          {printMode === 'complete' ? (
            <div className="print-list-1col">
              {filtered.map((entry, index) => (
                <article key={`print-${entry.id}`} className="print-vocab-card">
                  <div style={{ display: 'block' }}>
                    <span
                      style={{
                        fontFamily: 'monospace',
                        fontSize: '8.5pt',
                        color: '#6b7280',
                        marginRight: '6px',
                      }}
                    >
                      {String(index + 1).padStart(2, '0')}
                    </span>
                    <span className="print-word-title">{entry.lemma}</span>
                    {entry.source === 'ai' && (
                      <span
                        style={{
                          marginLeft: '6px',
                          fontSize: '7.5pt',
                          color: '#2563eb',
                          background: '#eff6ff',
                          padding: '1px 5px',
                          borderRadius: '4px',
                        }}
                      >
                        AI补充
                      </span>
                    )}
                    {entry.surfaceForms.filter(
                      (f) => f.toLowerCase() !== entry.lemma.toLowerCase(),
                    ).length > 0 && (
                      <span style={{ marginLeft: '7px', fontSize: '8pt', color: '#6b7280' }}>
                        [原文:{' '}
                        {entry.surfaceForms
                          .filter((f) => f.toLowerCase() !== entry.lemma.toLowerCase())
                          .join(', ')}
                        ]
                      </span>
                    )}
                    {(entry.phoneticUk || entry.phoneticUs) && (
                      <span style={{ marginLeft: '8px', fontSize: '8.5pt', color: '#4b5563' }}>
                        {entry.phoneticUk ? `UK ${entry.phoneticUk}` : ''}
                        {entry.phoneticUk && entry.phoneticUs ? '  ' : ''}
                        {entry.phoneticUs ? `US ${entry.phoneticUs}` : ''}
                      </span>
                    )}
                  </div>

                  {entry.occurrences.length > 0 && (
                    <div className="print-context-box">
                      {entry.occurrences.slice(0, 2).map((occ, i) => (
                        <div key={i}>
                          <strong style={{ color: '#b45309' }}>本文语境义：</strong>
                          <span style={{ color: '#111827', fontWeight: 500 }}>
                            {occ.contextMeaning}
                          </span>
                          {occ.isUncommonMeaning && (
                            <span
                              style={{
                                marginLeft: '5px',
                                fontSize: '7.5pt',
                                color: '#b45309',
                                fontWeight: 600,
                              }}
                            >
                              [熟词僻义]
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                  )}

                  <div style={{ marginTop: '5px' }}>
                    {entry.comprehensiveMeanings.map((m, idx) => (
                      <div key={idx} style={{ fontSize: '9pt', marginTop: '2px', color: '#111827' }}>
                        <strong
                          style={{
                            fontFamily: 'monospace',
                            color: '#1d4ed8',
                            marginRight: '5px',
                          }}
                        >
                          {m.pos}
                        </strong>
                        <span>{m.definitions.join('；')}</span>
                      </div>
                    ))}
                  </div>

                  {entry.collocations.length > 0 && (
                    <div style={{ marginTop: '4px', fontSize: '8.3pt', color: '#374151' }}>
                      <strong>常见搭配：</strong>
                      {entry.collocations.map((c) => `${c.phrase} (${c.meaning})`).join(' ｜ ')}
                    </div>
                  )}

                  {entry.wordFamily && entry.wordFamily.length > 0 && (
                    <div style={{ marginTop: '2px', fontSize: '8.2pt', color: '#4b5563' }}>
                      <strong>词族拓展：</strong>
                      {entry.wordFamily.join(' · ')}
                    </div>
                  )}

                  {entry.confusables && entry.confusables.length > 0 && (
                    <div style={{ marginTop: '2px', fontSize: '8.2pt', color: '#4b5563' }}>
                      <strong>易混辨析：</strong>
                      {entry.confusables.map((c) => `${c.word}（${c.diff}）`).join('；')}
                    </div>
                  )}

                  {entry.occurrences[0]?.sentenceEn && (
                    <div className="print-sentence-box">
                      <div
                        style={{
                          fontFamily: 'Georgia, "Times New Roman", serif',
                          color: '#111827',
                        }}
                      >
                        {entry.occurrences[0].sentenceEn}
                      </div>
                      {entry.occurrences[0].sentenceZh && (
                        <div style={{ color: '#4b5563', marginTop: '2px' }}>
                          {entry.occurrences[0].sentenceZh}
                        </div>
                      )}
                    </div>
                  )}
                </article>
              ))}
            </div>
          ) : (
            <div className="print-list-2col">
              {pairedPrintRows.map(([left, right], rowIdx) => (
                <div key={`print-row-${rowIdx}`} className="print-pair-row">
                  <div className="print-pair-table">
                    {[left, right].map((entry, colIdx) => (
                      <div
                        key={colIdx}
                        className={`print-pair-cell ${
                          colIdx === 0 ? 'print-pair-cell-left' : 'print-pair-cell-right'
                        }`}
                      >
                        {entry && (
                          <article className="print-vocab-card print-vocab-card-compact">
                            <div>
                              <span
                                style={{
                                  fontFamily: 'monospace',
                                  fontSize: '8pt',
                                  color: '#6b7280',
                                  marginRight: '5px',
                                }}
                              >
                                {String(rowIdx * 2 + colIdx + 1).padStart(2, '0')}
                              </span>
                              <span className="print-word-title print-word-title-sm">
                                {entry.lemma}
                              </span>
                              {(entry.phoneticUs || entry.phoneticUk) && (
                                <span
                                  style={{
                                    marginLeft: '6px',
                                    fontSize: '7.8pt',
                                    color: '#4b5563',
                                  }}
                                >
                                  {entry.phoneticUs || entry.phoneticUk}
                                </span>
                              )}
                            </div>

                            {printMode === 'dictation' ? (
                              <div className="print-dictation-line">默写释义：</div>
                            ) : (
                              <>
                                {entry.occurrences[0] && (
                                  <div className="print-context-box">
                                    <strong style={{ color: '#b45309' }}>语境：</strong>
                                    <span style={{ color: '#111827' }}>
                                      {entry.occurrences[0].contextMeaning}
                                    </span>
                                    {entry.occurrences[0].isUncommonMeaning && (
                                      <span
                                        style={{
                                          marginLeft: '4px',
                                          fontSize: '7.2pt',
                                          color: '#b45309',
                                          fontWeight: 600,
                                        }}
                                      >
                                        [熟词僻义]
                                      </span>
                                    )}
                                  </div>
                                )}
                                <div style={{ marginTop: '4px' }}>
                                  {entry.comprehensiveMeanings.map((m, idx) => (
                                    <div
                                      key={idx}
                                      style={{
                                        fontSize: '8.3pt',
                                        marginTop: '1.5px',
                                        lineHeight: 1.38,
                                        color: '#111827',
                                      }}
                                    >
                                      <strong
                                        style={{
                                          fontFamily: 'monospace',
                                          color: '#1d4ed8',
                                          marginRight: '4px',
                                        }}
                                      >
                                        {m.pos}
                                      </strong>
                                      <span>{m.definitions.join('；')}</span>
                                    </div>
                                  ))}
                                </div>
                              </>
                            )}
                          </article>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
