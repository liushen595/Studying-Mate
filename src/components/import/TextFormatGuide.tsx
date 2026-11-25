import { useState } from 'react';
import { BookOpenCheck, ChevronDown, ChevronUp, Sparkles } from 'lucide-react';

interface Props {
  onInsertSample: (sample: string) => void;
  defaultOpen?: boolean;
}

const SAMPLE_PAPER_TEMPLATE = `=== [Section I Use of English] ===
Section I Use of English
In modern academic life, digital tools have become [[1]] {{ubiquitous}} that many scholars rely on them daily.
1. [A] such  [B] so  [C] very  [D] too
[ANSWER: 1=B]

=== [Text1] ===
Text 1
For decades, urban planners assumed that widening highways would {{alleviate}} traffic congestion.
21. According to the passage, widening highways tends to ______.
[A] eliminate jams  [B] discourage rail  [C] trigger more driving  [D] cut budgets
[ANSWER: 21=C]

=== [Section II·Part B] ===
Part B
Effective reading comprehension is rarely passive. [[41]] By summarizing arguments, learners retain more.
[A] Speed-reading apps promise instant results.
[E] Instead, skilled readers actively {{interrogate}} the author's assumptions.
[ANSWER: 41=E]

=== [Section II·Part C Translation] ===
Part C
<u>(46) It is precisely the willingness to question {{prevailing}} orthodoxies that enables scientific inquiry to advance.</u>

=== [Section III·Writing·Part B] ===
Section III Writing Part B
Directions: Write an essay based on the picture below. You should start your essay with a brief description of the picture and then explain its intended meaning. Write about 160-200 words.
[图画/图表信息：画面中一名大学生站在图书馆书架前，面前写着“AI 工具”与“独立思考”两条路径，配文：“善用工具，勿失思考”。]`;

export function TextFormatGuide({ onInsertSample, defaultOpen = false }: Props) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className="rounded-2xl border border-border-subtle bg-surface-subtle/50 overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between px-4 py-3 text-left transition hover:bg-surface-subtle"
      >
        <div className="flex items-center gap-2">
          <BookOpenCheck className="h-4 w-4 text-accent" />
          <span className="text-xs font-semibold text-text-primary">
            文本格式完整录入指南（与 AI 解析提示词规则对齐）
          </span>
        </div>
        <span className="inline-flex items-center gap-1 text-xs text-text-muted">
          {open ? (
            <>
              收起 <ChevronUp className="h-3.5 w-3.5" />
            </>
          ) : (
            <>
              展开查看语法与示例 <ChevronDown className="h-3.5 w-3.5" />
            </>
          )}
        </span>
      </button>

      {open && (
        <div className="border-t border-border-subtle px-4 py-3.5 space-y-3 text-xs leading-relaxed text-text-secondary">
          <div className="grid gap-2.5 sm:grid-cols-2">
            <div className="rounded-xl bg-surface p-3 border border-border-subtle space-y-1.5">
              <div className="font-semibold text-text-primary">1. 题型切分与标准标签</div>
              <p>
                手动切分可在对应题型开头定位光标，点击快捷栏按钮直接插入 <code className="rounded bg-surface-subtle px-1 font-mono text-accent">=== [标签] ===</code> 分段标记；也可开启「交由 AI 智能切分」免手写标签：
              </p>
              <ul className="space-y-0.5 pl-4 list-disc text-[11.5px]">
                <li>完形填空：<code className="font-mono">Section I Use of English</code></li>
                <li>传统阅读：<code className="font-mono">Text1</code> / <code className="font-mono">Text2</code> / <code className="font-mono">Text3</code> / <code className="font-mono">Text4</code></li>
                <li>新题型：<code className="font-mono">Section II·Part B</code></li>
                <li>翻译题：<code className="font-mono">Section II·Part C Translation</code></li>
                <li>写作题：<code className="font-mono">Section III·Writing·Part A</code> / <code className="font-mono">Part B</code></li>
              </ul>
            </div>

            <div className="rounded-xl bg-surface p-3 border border-border-subtle space-y-1.5">
              <div className="font-semibold text-text-primary">2. 重点标记符号（AI 严格按此解析）</div>
              <ul className="space-y-1 pl-4 list-disc text-[11.5px]">
                <li>
                  <strong>生词标记</strong>：用 <code className="font-mono text-vocab">{'{{word}}'}</code> 包裹（选中单词按 <kbd className="rounded border px-1">Ctrl+M</kbd>），本地正则 100% 提取入生词本。
                </li>
                <li>
                  <strong>卷面已做/订正答案</strong>：附加 <code className="font-mono text-answer">[ANSWER: 1=B]</code>，AI 将直接沿用并标注「卷面」来源；未标则由 AI 解答。
                </li>
                <li>
                  <strong>完形/新题型空位</strong>：正文空位写 <code className="font-mono">[[1]]</code>…<code className="font-mono">[[20]]</code> 或 <code className="font-mono">[[41]]</code>…<code className="font-mono">[[45]]</code>。
                </li>
                <li>
                  <strong>Part C 翻译划线句</strong>：英语一待译长难句请用 <code className="font-mono text-accent">{'<u>(46) 完整英文句子...</u>'}</code> 包裹（阅读/完形即使误带 <code className="font-mono">{'<u>'}</code> 系统也会自动忽略）。
                </li>
                <li>
                  <strong>写作图画/图表信息</strong>：大作文可在 Directions 下补充 <code className="font-mono">[图画/图表信息：画面描述或数值]</code>，模型将据此写范文与指导。
                </li>
              </ul>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
            <span className="text-[11px] text-text-muted">
              提示：已存在的试卷也可随时返回本页增删内容、调整题型归属，并只对新增/修改部分做增量解析。
            </span>
            <button
              type="button"
              onClick={() => onInsertSample(SAMPLE_PAPER_TEMPLATE)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-accent/30 bg-accent-soft/60 px-3 py-1 text-xs font-medium text-accent hover:bg-accent-soft"
            >
              <Sparkles className="h-3.5 w-3.5" />
              填入标准格式示例
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
