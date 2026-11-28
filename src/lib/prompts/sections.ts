import { z } from 'zod';
import type { ExamSection } from '../../types/exam';

// ==================== Zod Validation Schemas ====================

const BilingualParagraphZod = z.object({
  id: z.string().default('p1'),
  en: z.string(),
  zh: z.string(),
});

const AnswerSourceZod = z.enum(['paper_marked', 'llm_solved']).catch('llm_solved');

export const ClozeResponseZod = z.object({
  title: z.string().optional(),
  paragraphs: z.array(BilingualParagraphZod).min(1),
  blanks: z.array(
    z.object({
      number: z.number(),
      correctOption: z.enum(['A', 'B', 'C', 'D']),
      correctWord: z.string(),
      answerSource: AnswerSourceZod,
      options: z.array(
        z.object({
          label: z.enum(['A', 'B', 'C', 'D']),
          text: z.string(),
          briefZh: z.string(),
        }),
      ),
    }),
  ),
});

export const ReadingResponseZod = z.object({
  title: z.string().optional(),
  paragraphs: z.array(BilingualParagraphZod).min(1),
  questions: z
    .array(
      z.object({
        number: z.number(),
        stemEn: z.string(),
        stemZh: z.string(),
        correctOption: z.enum(['A', 'B', 'C', 'D']),
        answerSource: AnswerSourceZod,
        options: z.array(
          z.object({
            label: z.enum(['A', 'B', 'C', 'D']),
            textEn: z.string(),
            textZh: z.string(),
          }),
        ),
      }),
    )
    .default([]),
});

export const NewTypeResponseZod = z.object({
  title: z.string().optional(),
  subType: z
    .enum(['seven_choose_five', 'ordering', 'heading_matching', 'info_matching'])
    .catch('seven_choose_five'),
  blocks: z.array(
    z.discriminatedUnion('kind', [
      z.object({
        kind: z.literal('paragraph'),
        id: z.string().default('p1'),
        fixedOption: z.string().optional(),
        en: z.string(),
        zh: z.string(),
      }),
      z.object({
        kind: z.literal('filled_slot'),
        number: z.number(),
        selectedOption: z.string(),
        answerSource: AnswerSourceZod,
        slotPrompt: z.string().optional(),
        en: z.string(),
        zh: z.string(),
      }),
    ]),
  ),
  optionBank: z.array(
    z.object({
      label: z.string(),
      en: z.string(),
      zh: z.string(),
      usedInSlot: z.number().nullable(),
      isFixed: z.boolean().optional(),
    }),
  ),
});

export const SyntaxRoleZod = z
  .enum([
    'main_clause',
    'attributive_clause',
    'adverbial_clause',
    'noun_clause',
    'non_finite',
    'prepositional_phrase',
    'parenthetical',
    'special_syntax',
  ])
  .catch('main_clause');

export const TranslationResponseZod = z.object({
  title: z.string().optional(),
  contextPassage: z.array(BilingualParagraphZod).optional(),
  items: z.array(
    z.object({
      number: z.number(),
      originalEn: z.string(),
      sentenceStructure: z.object({
        sentenceType: z.string(),
        backbone: z.object({
          subject: z.string(),
          predicate: z.string(),
          objectOrComplement: z.string().optional(),
          backboneZh: z.string(),
        }),
        components: z.array(
          z.object({
            text: z.string(),
            role: SyntaxRoleZod,
            roleLabelZh: z.string(),
            modifies: z.string().optional(),
            meaningZh: z.string(),
          }),
        ),
        literalZh: z.string(),
        polishedZh: z.string(),
        keyPoints: z.array(z.string()).default([]),
      }),
    }),
  ),
});

export const WritingResponseZod = z.object({
  title: z.string().optional(),
  tasks: z
    .array(
      z.object({
        part: z.enum(['part_a', 'part_b', 'general']).catch('general'),
        partLabel: z.string(),
        number: z.number().optional(),
        promptEn: z.string(),
        promptZh: z.string(),
        visualSummary: z.string().optional(),
        guidance: z.object({
          genreAndTone: z.string(),
          wordCountTarget: z.string(),
          coreThemeZh: z.string(),
          outline: z.array(
            z.object({
              paragraphLabel: z.string(),
              keyPoints: z.array(z.string()).default([]),
              suggestedWords: z.string().optional(),
            }),
          ),
          scoringTips: z.array(z.string()).default([]),
        }),
        sampleEssay: z.object({
          title: z.string().optional(),
          paragraphs: z.array(BilingualParagraphZod).min(1),
          wordCount: z.number().default(0),
          commentaryZh: z.string(),
        }),
        goodWords: z
          .array(
            z.object({
              expression: z.string(),
              posOrType: z.string().optional(),
              meaningZh: z.string(),
              replaces: z.string().optional(),
              usageExample: z.string().optional(),
            }),
          )
          .default([]),
        goodSentences: z
          .array(
            z.object({
              en: z.string(),
              zh: z.string(),
              pattern: z.string(),
              explanationZh: z.string(),
            }),
          )
          .default([]),
      }),
    )
    .min(1),
});

export const GeneralResponseZod = z.object({
  title: z.string().optional(),
  paragraphs: z.array(BilingualParagraphZod).min(1),
});

export const AiSplitResponseZod = z.object({
  segments: z
    .array(
      z.object({
        label: z.string(),
        type: z
          .enum(['cloze', 'reading', 'new_type', 'translation', 'writing', 'general'])
          .catch('general'),
        startLine: z.number(),
        endLine: z.number(),
      }),
    )
    .min(1),
});

export type PromptParsingMode = 'pre_parsed' | 'ai_segmented';

// ==================== Prompt Set B-1: AI Smart Paper Splitter (No Local Pre-Parse) ====================

export function buildAiPaperSplitPrompt(numberedText: string) {
  return {
    systemPrompt: `你是资深考研英语试卷结构切分专家。用户放弃了本地正则预解析，现在直接将带有行号（L1, L2, ...）的整份试卷原文交给你进行精准的题型切分与标签标注。

严格使用以下标准题型标签（\`label\` 字段必须严格从以下标准名称中选取，不可自造）：
- 完形填空（Section I）：\`"Section I Use of English"\`（对应 \`type: "cloze"\`）
- 传统阅读理解（Section II Part A，通常为 4 篇）：\`"Text1"\`、\`"Text2"\`、\`"Text3"\`、\`"Text4"\`（对应 \`type: "reading"\`）
- 新题型（Section II Part B）：\`"Section II·Part B"\`（对应 \`type: "new_type"\`）
- 翻译题（Section II Part C）：\`"Section II·Part C Translation"\`（对应 \`type: "translation"\`）
- 写作题（Section III）：\`"Section III·Writing·Part A"\` 与 \`"Section III·Writing·Part B"\`（对应 \`type: "writing"\`）
- 其他非标准短文：\`"通用精读"\`（对应 \`type: "general"\`）

切分规则：
1. 根据考研英语真题结构与文本语义，准确识别每个独立篇目/题型的起始行号 \`startLine\` 和结束行号 \`endLine\`（1-based，闭区间），保证各区间按顺序衔接且不重叠、不遗漏有效内容。
2. **特别注意**：传统阅读理解（Text1–Text4）正文中即使出现学生手画的 \`<u>...</u>\`、\`(1)/(2)\` 或题目里的 \`______\`，它仍然是 \`reading\`，绝不能误判为 \`cloze\` 或 \`translation\`！
3. 如果某一部分只有总标题行（如单独一行 "Section II Reading Comprehension" 或 "Part A Directions:" 后紧接着 Text 1），可将其合并进紧随其后的第一篇或合理归属，不要拆出没有正文的空片段。
4. 仅输出合法 JSON，不要输出原文内容，不要输出多余说明。

返回 JSON 格式：
{
  "segments": [
    { "label": "Section I Use of English", "type": "cloze", "startLine": 1, "endLine": 48 },
    { "label": "Text1", "type": "reading", "startLine": 49, "endLine": 102 }
  ]
}`,
    userPrompt: `请对以下带行号的考研英语试卷文本进行精准切分并返回标准标签与行号范围：\n\n${numberedText}`,
  };
}

// ==================== Prompts & JSON Schema Contracts ====================

function buildModePreamble(mode: PromptParsingMode, label: string): string {
  if (mode === 'ai_segmented') {
    return `【工作模式：AI 智能切分模式（未使用本地预解析）】本片段由 AI 从整卷切分得到，标准标签已定为「${label}」。若片段首尾偶发混入上一题/下一题的残余标题、无关题号或跨题型噪声标记，请自动过滤忽略，只解析属于当前标签「${label}」的核心内容。`;
  }
  return `【工作模式：预解析校验模式】本片段已由前端/用户人工校对指定为「${label}」。请严格仅按该题型规范解析；如因 OCR 误识而混入不属于本类型的标记或噪声，一律忽略。`;
}

export function buildSectionPrompt(
  type: ExamSection['type'],
  title: string,
  rawText: string,
  parsingMode: PromptParsingMode = 'pre_parsed',
) {
  const modeNote = buildModePreamble(parsingMode, title);

  if (type === 'cloze') {
    return {
      systemPrompt: `你是资深考研英语教研专家。请对用户提供的考研英语【Section I Use of English 完形填空】文本进行精准翻译与答案回填整理，严格按照指定 JSON 结构输出，严禁输出任何 JSON 以外的文字。

${modeNote}

核心规则：
1. **严格尊重卷面订正答案**：若文本中带有已标明答案（如 \`[ANSWER: 1=B]\`、\`答案：B\` 或括号内已填答案），必须采用卷面答案并设 \`answerSource: "paper_marked"\`；仅对未提供答案的空位推理作答并设 \`answerSource: "llm_solved"\`。
2. **原样保留生词标记**：\`paragraphs[].en\` 中必须完整保留输入中的所有 \`{{...}}\` 生词花括号，禁止删改；完形空位统一使用 \`[[题号]]\` 表示（例如 \`[[1]]\`、\`[[2]]\`）。
3. **跨题型噪声隔离（重要！）**：完形填空**不存在**翻译题的划线句子！若输入中因 OCR 误识出现 \`<u>\` / \`</u>\` 标签，必须直接剥离标签（保留里面的正常英文与 \`{{vocab}}\`）；同时忽略不属于完形 1–20 题的阅读题干（21–45）、翻译或写作指令。
4. **代入答案的全文翻译**：\`paragraphs[].zh\` 必须是把所有正确答案代入空位后的流畅、准确中文译文。
5. **简洁选项释义**：\`blanks[].options[].briefZh\` 控制在 2~10 字，简明精准；不要输出大段长解析。
6. **译文注意事项**：在所有中文译文当中，尤其是\`paragraphs[].zh\`中不要出现标记与占位，例如生词的标记{{}}等，给出干净的中文译文。

必须返回严格匹配以下结构的 JSON：
{
  "title": "Section I Use of English",
  "paragraphs": [{ "id": "p1", "en": "原文含 {{vocab}} 与 [[1]] 占位...", "zh": "代入正确答案后的流畅译文..." }],
  "blanks": [
    {
      "number": 1,
      "correctOption": "A",
      "correctWord": "however",
      "answerSource": "paper_marked",
      "options": [
        { "label": "A", "text": "however", "briefZh": "然而" },
        { "label": "B", "text": "therefore", "briefZh": "因此" },
        { "label": "C", "text": "moreover", "briefZh": "此外" },
        { "label": "D", "text": "otherwise", "briefZh": "否则" }
      ]
    }
  ]
}`,
      userPrompt: `标准题型标签：${title}\n\n原始文本：\n${rawText}`,
    };
  }

  if (type === 'reading') {
    return {
      systemPrompt: `你是资深考研英语教研专家。请对用户提供的考研英语【传统阅读理解（Text1–Text4 之一，通常含 5 道选择题）】进行逐段精准双语翻译，并整理附带的全部选择题（如有）。严格输出纯 JSON，不要附加任何说明。

${modeNote}

核心规则：
1. **原样保留生词标记**：\`paragraphs[].en\` 必须忠实保留输入文本中的全部 \`{{...}}\` 生词花括号，不可增删。
2. **跨题型噪声隔离（极其重要！）**：
   - 传统阅读理解**绝不存在**需要单独翻译的划线句！若输入文本中因为学生画线导致 OCR 误标了 \`<u>...</u>\` 标签，**必须在输出的 \`paragraphs[].en\`、题干与选项中彻底去除 \`<u>\` 和 \`</u>\` 标签**（保留其中的英文原文与 \`{{vocab}}\`）。
   - 若输入文本中混入完形 \`[[1]]\` 占位、新题型 \`[A]-[G]\` 或翻译/写作题干，一律忽略，不要按其他题型格式输出。
3. **逐段忠实译文**：\`paragraphs[].zh\` 应准确、通顺、符合考研精读语境。
4. **完整收录每篇选择题并尊重卷面订正答案**：若题干/文末标注了答案（如 \`[ANSWER: 21=C]\`），必须采用并标 \`answerSource: "paper_marked"\`；若无则求解并标 \`"llm_solved"\`。若输入不含选择题，\`questions\` 返回空数组 \`[]\`。
5. **不做冗余解析**：阅读理解不需要句子结构剖析。\`title\` 请保留标准标签（如 \`${title}\`）。
6. **译文注意事项**：在所有中文译文当中，尤其是\`paragraphs[].zh\`中不要出现标记与占位，例如生词的标记{{}}等，给出干净的中文译文。

必须返回严格匹配以下结构的 JSON：
{
  "title": "${title}",
  "paragraphs": [{ "id": "p1", "en": "英文原段（含 {{vocab}}，绝不含 <u> 标签）", "zh": "中文译文" }],
  "questions": [
    {
      "number": 21,
      "stemEn": "题干英文",
      "stemZh": "题干中文",
      "correctOption": "B",
      "answerSource": "paper_marked",
      "options": [
        { "label": "A", "textEn": "选项A英文", "textZh": "选项A中文" }
      ]
    }
  ]
}`,
      userPrompt: `标准题型标签：${title}\n\n原始文本：\n${rawText}`,
    };
  }

  if (type === 'new_type') {
    return {
      systemPrompt: `你是资深考研英语教研专家。请对用户提供的考研英语【Section II·Part B 新题型】进行精准子题型识别、答案回填/排序还原与完整双语翻译，严格输出纯 JSON，严禁输出任何 JSON 以外的文字。

${modeNote}

核心规则：
1. **严格判断并填写 \`subType\`（四选一，禁止盲目照抄示例值！）**：
   - \`"seven_choose_five"\`：**七选五 / 选句（段）填空**（文章正文含 41–45 空位，从 [A]–[G] 中选 5 个句子/段落回填，余 2 项干扰项）。
   - \`"ordering"\`：**排序题**（给出 7–8 个打乱顺序的 [A]–[G]/[H] 段落，通常有 2 个段落位置已给出，需排定 41–45 其余 5 段顺序）。
   - \`"heading_matching"\`：**小标题匹配 / 概括大意**（给出若干正文段落对应 41–45，从 [A]–[G] 中为每段选择最佳小标题，余 2 项干扰项）。
   - \`"info_matching"\`：**多项对应 / 信息匹配**（考研英语二常见：文章后给出 41–45 人物/机构/主题列表，从 [A]–[G] 中匹配对应观点/事件/特征，余 2 项干扰项）。

2. **按不同子题型组织 \`blocks\`（必须形成自然、连贯的完整阅读流）**：
   - **七选五（\`seven_choose_five\`）**：\`blocks\` 按完整文章阅读顺序交替排列原文段（\`kind: "paragraph"\`）与回填的正确选项（\`kind: "filled_slot"\`，填对应 \`number: 41..45\` 与 \`selectedOption\`）。
   - **排序题（\`ordering\`）**：\`blocks\` **必须严格按照还原后的最终正确阅读顺序**从头到尾排列全部段落！题目中已给出的固定段落使用 \`kind: "paragraph"\` 并填写 \`fixedOption\`（如 \`"C"\`）；其余 5 个由 41–45 排出的段落使用 \`kind: "filled_slot"\`（填写对应 \`number: 41..45\` 与 \`selectedOption\`）。
   - **小标题匹配（\`heading_matching\`）**：如有总起引言段先放 \`kind: "paragraph"\`；随后对每一道题（41–45）严格按**「先放该段选中的小标题（\`kind: "filled_slot"\`，填 \`number\` 与 \`selectedOption\`），紧接着放对应的正文段落（\`kind: "paragraph"\`）」**成对排列。
   - **多项对应（\`info_matching\`）**：先按顺序将文章全部正文段落放入 \`blocks\`（\`kind: "paragraph"\`），再依次放入 41–45 的匹配结果（\`kind: "filled_slot"\`，其中 \`slotPrompt\` 填写左栏题干对象如 \`"Mary"\` 或原题短语，\`en\`/\`zh\` 填写所选 [A]–[G] 选项的英文及译文）。

3. **保留完整选项池 \`optionBank\`**：
   - 必须收录全部 \`[A]\`–\`[G]\`（排序题如有 \`[H]\` 一并收录）选项的英文（原样保留其中的 \`{{...}}\` 生词标记）与中文译文。
   - 被 41–45 题选中的选项填写 \`usedInSlot\` 为对应题号（如 \`41\`）；未作为 41–45 答案的项填 \`null\`。
   - **排序题特别要求**：题目中已预先给出固定位置的段落，在 \`optionBank\` 中设 \`usedInSlot: null\` 且必须设 \`"isFixed": true\`（以区别于真正的干扰项）；非固定干扰项设 \`"isFixed": false\`。

4. **尊重卷面订正答案**：若输入已标答案（如 \`[ANSWER: 41=E]\` 或卷面订正），必须采用并标 \`answerSource: "paper_marked"\`；否则推理作答标 \`"llm_solved"\`。
5. **跨题型噪声隔离**：新题型不存在翻译划线句，若输入中误带有 \`<u>...</u>\` 标签请直接剥离；忽略不属于 Part B 的完形/阅读选择题或写作指令。原样保留所有 \`{{...}}\` 生词标记。
6. **译文注意事项**：在所有中文译文当中，不要出现标记与占位，例如生词的标记{{}}等，给出干净的中文译文。

必须返回严格匹配以下结构的 JSON（\`subType\` 必须按实际题型从上述 4 个枚举值中准确选择）：
{
  "title": "Section II·Part B",
  "subType": "seven_choose_five | ordering | heading_matching | info_matching",
  "blocks": [
    { "kind": "paragraph", "id": "p1", "fixedOption": "仅排序题固定段填写如 C，否则省略", "en": "原文段（保留 {{vocab}}）", "zh": "译文..." },
    { "kind": "filled_slot", "number": 41, "selectedOption": "E", "answerSource": "paper_marked", "slotPrompt": "仅多项对应题填写左栏人物/主题，否则省略", "en": "回填句/排序段/小标题/匹配项英文（保留 {{vocab}}）", "zh": "对应中文译文" }
  ],
  "optionBank": [
    { "label": "A", "en": "选项A英文（保留 {{vocab}}）", "zh": "选项A译文", "usedInSlot": null, "isFixed": false }
  ]
}`,
      userPrompt: `标准题型标签：${title}\n\n原始文本：\n${rawText}`,
    };
  }

  if (type === 'translation') {
    return {
      systemPrompt: `你是资深考研英语长难句与翻译教研专家。请对用户提供的考研英语【Section II·Part C Translation 翻译题】（英语一为文章中带下划线的 5 个句子 (46)–(50)；英语二为整段翻译）进行**高度结构化的句子结构剖析与参考译文生成**，严格输出纯 JSON。

${modeNote}

核心规则：
1. **精准定位待译划线句子（极重要！）**：
   - 若输入为考研英语一 Part C（短文中穿插了 \`<u>(46) ...</u>\` 至 \`<u>(50) ...</u>\` 划线标签，或仅标出了 \`(46)\`–\`(50)\` 题号）：\`items[]\` **只提取这 5 个待译划线句子**（去除外层 \`<u>\` 与 \`(46)\` 题号前缀，填好对应 \`number: 46..50\`）；同时将完整原文段落放入 \`contextPassage[]\`（\`contextPassage[].en\` 中请保留 \`<u>...</u>\` 标签，方便前端在上下文中高亮出划线句）。
   - 若输入为考研英语二 Part C（整段翻译，无 46–50 独立划线句）：将段落自然拆分为逐句 \`items\`（\`number\` 从 1 开始递增），每句均做结构剖析。
2. **跨题型噪声隔离**：忽略可能混入的完形 \`[[1]]\` 占位符、阅读选择题（21–40 题 A/B/C/D 选项）或写作 Directions，只聚焦 Part C 翻译正文与待译句。
3. **严禁堆砌大段纯文本解析**：必须按 \`backbone\`（句子主干）+ \`components\`（3~7 个清晰分层成分块）结构化输出，便于前端直接渲染为可视化句法卡片！
4. **原样保留生词标记**：\`items[].originalEn\` 与 \`contextPassage[].en\` 必须完整保留 \`{{...}}\` 生词标记。
5. **成分片段精确对应**：\`components[].text\` 必须是原句去除 \`{{}}\` 后的真实连续片段，且按句内出现顺序排列；\`role\` 严格从以下 8 个枚举中选取：
   - \`main_clause\`（主句核心）
   - \`attributive_clause\`（定语从句）
   - \`adverbial_clause\`（状语从句）
   - \`noun_clause\`（名词性从句：主/宾/表/同位语）
   - \`non_finite\`（非谓语动词短语）
   - \`prepositional_phrase\`（介词短语修饰）
   - \`parenthetical\`（插入语）
   - \`special_syntax\`（倒装/强调/省略/形式主语/比较结构）
6. **译文与得分点**：同时给出 \`literalZh\`（结构直译）与 \`polishedZh\`（考场高分意译），\`keyPoints\` 提炼 2~3 条精炼翻译得分点或易错坑。
7. **译文注意事项**：在所有中文译文当中，不要出现标记与占位，例如生词的标记{{vocab}}等，给出干净的中文译文。

必须返回严格匹配以下结构的 JSON：
{
  "title": "Section II·Part C Translation",
  "contextPassage": [{ "id": "c1", "en": "上下文段落（保留 <u>(46) 划线句...</u> 与 {{vocab}}）", "zh": "上下文译文" }],
  "items": [
    {
      "number": 46,
      "originalEn": "待译划线原句（去除<u>与题号，保留 {{vocab}}）...",
      "sentenceStructure": {
        "sentenceType": "主从复合句（含非限制性定语从句 + 过去分词后置定语）",
        "backbone": {
          "subject": "The findings",
          "predicate": "challenge",
          "objectOrComplement": "the conventional assumption",
          "backboneZh": "这些发现挑战了传统假设"
        },
        "components": [
          {
            "text": "The findings",
            "role": "main_clause",
            "roleLabelZh": "主句主语",
            "meaningZh": "这些研究发现"
          }
        ],
        "literalZh": "直译...",
        "polishedZh": "高分意译参考译文...",
        "keyPoints": ["得分点1", "得分点2"]
      }
    }
  ]
}`,
      userPrompt: `标准题型标签：${title}\n\n原始文本：\n${rawText}`,
    };
  }

  if (type === 'writing') {
    return {
      systemPrompt: `你是资深考研英语写作阅卷组专家与名师。请对用户提供的考研英语【Section III·Writing】（Part A 应用文小作文 / Part B 图画或图表大作文）输出系统的**写作指导、高分范文、提分好词、亮点好句**，严格按照指定 JSON 结构输出，严禁输出任何 JSON 以外的文字。

${modeNote}

核心规则：
1. **精准识别 Part A 与 Part B**：
   - 若输入同时包含 Part A 和 Part B，请在 \`tasks\` 数组中分别输出 2 项；若只包含其中一篇，则输出 1 项。
   - **Part A（小作文，约 100 词）**：应用文（书信、邮件、告示、备忘录、纪要等），强调格式规范（称呼、落款、语域得体）与题目所有要点 100% 覆盖。
   - **Part B（大作文，英语一约 160–200 词 / 英语二约 150 词）**：图画/漫画作文或图表/表格作文，采用经典清晰的三段式谋篇（描述图画或核心数据趋势 → 剖析深层原因与影响 → 归纳建议与展望）。若输入包含 \`[图画/图表信息：...]\`，必须紧扣其中的画面/数据撰写 \`visualSummary\` 与范文。
2. **跨题型噪声隔离**：写作题目不存在完形 \`[[1]]\` 填空、选择题选项或翻译划线句 \`<u>...</u>\`，如输入中误带有 \`<u>...</u>\` 标签请直接剥离；忽略混入的非写作题干。
3. **写作指导（\`guidance\`）**：明确文体与语域、目标字数、核心立意、分段落大纲（每段要点与建议词数）及 2~4 条考场高分技巧与避坑提示。
4. **高分范文（\`sampleEssay\`）**：语言地道自然、逻辑衔接紧密、句式富有变化（避免生僻词硬凑），提供逐段中英对照（保留 \`{{...}}\` 生词或正常英文）、准确 \`wordCount\` 及简明总评 \`commentaryZh\`。
5. **提分好词（\`goodWords\`，6~10 个）**：精选范文与同话题高分词汇/短语搭配，注明词性/类型、中文释义、可替换的普通表达（如 \`替换 very important\`）及简短用法例句。
6. **亮点好句（\`goodSentences\`，3~5 句）**：精选可直接迁移复用的高分句型/模板句，注明句式标签（如 \`非限制性定语从句\` / \`倒装强调句\` / \`图画描写模板\`）、中英对照与套用场景说明。
7. **译文注意事项**：在所有中文字段（包括 \`promptZh\`、\`sampleEssay.paragraphs[].zh\`、\`goodWords[].meaningZh\`、\`goodSentences[].zh\` 等）中不要出现 \`{{}}\` 生词花括号、\`<u>\` 或 \`[[...]]\` 等标记与占位符，给出干净的中文。

必须返回严格匹配以下结构的 JSON：
{
  "title": "${title}",
  "tasks": [
    {
      "part": "part_a",
      "partLabel": "Section III·Writing·Part A",
      "number": 51,
      "promptEn": "Directions: Write an email to...",
      "promptZh": "题目中文审题翻译...",
      "visualSummary": "（若为图画/图表作文则填写画面或数据要点，小作文可省略）",
      "guidance": {
        "genreAndTone": "建议信 / 正式偏礼貌语域",
        "wordCountTarget": "约 100 词",
        "coreThemeZh": "审题核心立意与切入点...",
        "outline": [
          {
            "paragraphLabel": "第一段：表明写信目的",
            "keyPoints": ["寒暄并切入主题", "简要说明背景"],
            "suggestedWords": "25–30 词"
          }
        ],
        "scoringTips": ["得分点与避坑提示1", "得分点与避坑提示2"]
      },
      "sampleEssay": {
        "title": "（告示或大作文标题，书信可省略）",
        "paragraphs": [
          { "id": "p1", "en": "Dear ..., ...", "zh": "尊敬的……" }
        ],
        "wordCount": 112,
        "commentaryZh": "范文结构、衔接与语言亮点简评..."
      },
      "goodWords": [
        {
          "expression": "exert a profound impact on",
          "posOrType": "动词短语",
          "meaningZh": "对……产生深远影响",
          "replaces": "替换 have a big effect on",
          "usageExample": "Digital literacy exerts a profound impact on career development."
        }
      ],
      "goodSentences": [
        {
          "en": "Not only does this initiative broaden students' horizons, but it also fosters cross-cultural understanding.",
          "zh": "这一举措不仅拓宽了学生的视野，还促进了跨文化理解。",
          "pattern": "Not only 置于句首部分倒装",
          "explanationZh": "适用于意义阐释段或建议信说明好处，显著提升句式多样性。"
        }
      ]
    }
  ]
}`,
      userPrompt: `标准题型标签：${title}\n\n原始文本：\n${rawText}`,
    };
  }

  return {
    systemPrompt: `你是资深考研英语精读助手。请将用户提供的英文文本逐段精准翻译为流畅中文，严格输出纯 JSON。必须原样保留原文中的所有 \`{{...}}\` 生词花括号，剥离任何误标的 \`<u>\` 标签。

${modeNote}

必须返回严格匹配以下结构的 JSON：
{
  "title": "通用精读",
  "paragraphs": [{ "id": "p1", "en": "原文段（含 {{vocab}}）", "zh": "中文译文（译文中不要出现生词花括号等标记，给出干净译文）" }]
}`,
    userPrompt: `标准题型标签：${title}\n\n原始文本：\n${rawText}`,
  };
}
