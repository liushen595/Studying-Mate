import { useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { BookMarked } from 'lucide-react';
import { db } from '../lib/db';
import type { VocabEntry } from '../types/exam';
import { VocabBookView } from '../components/vocab/VocabBookView';

export function GlobalVocabPage() {
  const papers = useLiveQuery(() => db.papers.orderBy('updatedAt').reverse().toArray(), []);

  const mergedVocab = useMemo<VocabEntry[]>(() => {
    if (!papers) return [];
    const map = new Map<string, VocabEntry>();
    for (const p of papers) {
      for (const v of p.vocabulary || []) {
        const key = (v.lemma || v.id).toLowerCase().trim();
        const taggedOccs = v.occurrences.map((o) => ({
          ...o,
          sectionId: `${p.id}::${o.sectionId}`,
          sectionTitle: `${p.title} · ${o.sectionTitle}`,
        }));
        const existing = map.get(key);
        if (!existing) {
          map.set(key, {
            ...v,
            id: key,
            occurrences: taggedOccs,
          });
        } else {
          existing.surfaceForms = Array.from(
            new Set([...existing.surfaceForms, ...v.surfaceForms]),
          );
          existing.occurrences = [...existing.occurrences, ...taggedOccs];
        }
      }
    }
    return Array.from(map.values());
  }, [papers]);

  return (
    <div className="space-y-4">
      <div className="no-print island p-5 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-vocab-soft text-vocab">
            <BookMarked className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-text-primary">全部生词汇总本</h1>
            <p className="text-xs text-text-secondary">
              自动去重汇总本地全部试卷的生词（共 {mergedVocab.length} 词），支持背词自测、打印导出 PDF 与 Anki 制卡。
            </p>
          </div>
        </div>
      </div>

      <VocabBookView title="考研英语全部生词汇总" vocabulary={mergedVocab} />
    </div>
  );
}
