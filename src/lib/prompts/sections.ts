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
    .enum(['seven_choose_five', 'ordering', 'heading_matching'])
    .catch('seven_choose_five'),
  blocks: z.array(
    z.discriminatedUnion('kind', [
      z.object({
        kind: z.literal('paragraph'),
        id: z.string().default('p1'),
        en: z.string(),
        zh: z.string(),
      }),
      z.object({
        kind: z.literal('filled_slot'),
        number: z.number(),
        selectedOption: z.string(),
        answerSource: AnswerSourceZod,
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

export const GeneralResponseZod = z.object({
  title: z.string().optional(),
  paragraphs: z.array(BilingualParagraphZod).min(1),
});

// ==================== Prompts & JSON Schema Contracts ====================

export function buildSectionPrompt(type: ExamSection['type'], title: string, rawText: string) {
  if (type === 'cloze') {
    return {
      systemPrompt: `你是资深考研英语教研专家。请对用户提供的考研英语【完形填空】文本进行精准翻译与答案回填整理，严格按照指定 JSON 结构输出，严禁输出任何 JSON 以外的文字。

核心规则：
1. **严格尊重卷面订正答案**：若文本中带有已标明答案（如 \`[ANSWER: 1=B]\`、\`答案：B\` 或括号内已填答案），必须采用卷面答案并设 \`answerSource: "paper_marked"\`；仅对未提供答案的空位推理作答并设 \`answerSource: "llm_solved"\`。
2. **原样保留生词标记**：\`paragraphs[].en\` 中必须完整保留输入中的所有 \`{{...}}\` 生词花括号，禁止删改；完形空位统一使用 \`[[题号]]\` 表示（例如 \`[[1]]\`、\`[[2]]\`）。
3. **代入答案的全文翻译**：\`paragraphs[].zh\` 必须是把所有正确答案代入空位后的流畅、准确中文译文。
4. **简洁选项释义**：\`blanks[].options[].briefZh\` 控制在 2~10 字，简明精准；不要输出大段长解析。

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
      userPrompt: `题目标题：${title}\n\n原始文本：\n${rawText}`,
    };
  }

  if (type === 'reading') {
    return {
      systemPrompt: `你是资深考研英语教研专家。请对用户提供的考研英语【传统阅读理解】文章进行逐段精准双语翻译，并整理附带的选择题（如有）。严格输出纯 JSON，不要附加任何说明。

核心规则：
1. **原样保留生词标记**：\`paragraphs[].en\` 必须忠实保留输入文本中的全部 \`{{...}}\` 生词花括号，不可增删。
2. **逐段忠实译文**：\`paragraphs[].zh\` 应准确、通顺、符合考研精读语境。
3. **尊重卷面订正答案**：若题干/文末标注了答案（如 \`[ANSWER: 21=C]\`），必须采用并标 \`answerSource: "paper_marked"\`；若无则求解并标 \`"llm_solved"\`。若输入不含选择题，\`questions\` 返回空数组 \`[]\`。
4. **不做冗余解析**：阅读理解不需要句子结构剖析。

必须返回严格匹配以下结构的 JSON：
{
  "title": "Text 1",
  "paragraphs": [{ "id": "p1", "en": "英文原段（含 {{vocab}}）", "zh": "中文译文" }],
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
      userPrompt: `题目标题：${title}\n\n原始文本：\n${rawText}`,
    };
  }

  if (type === 'new_type') {
    return {
      systemPrompt: `你是资深考研英语教研专家。请对用户提供的考研英语【新题型（七选五 / 排序题 / 小标题匹配）】进行答案回填与完整翻译，严格输出纯 JSON。

核心规则：
1. **将正确选项直接回填进正文顺序**：\`blocks\` 按完整文章阅读顺序排列，将原文段落（\`kind: "paragraph"\`）与回填的正确句子/小标题（\`kind: "filled_slot"\`）交替组织，形成完整连贯的全文！
2. **保留完整选项池**：\`optionBank\` 必须包含所有 \`[A]\`–\`[G]\` 选项及其译文，已选中的填写 \`usedInSlot\` 为对应题号（如 \`41\`），未选中的干扰项填 \`null\`。
3. **尊重卷面订正答案**：若输入已标答案（如 \`[ANSWER: 41=E]\`），采用并标 \`answerSource: "paper_marked"\`；否则推理作答标 \`"llm_solved"\`。
4. **原样保留 \`{{...}}\` 生词标记**，不要做句子结构解析。

必须返回严格匹配以下结构的 JSON：
{
  "title": "Part B (七选五)",
  "subType": "seven_choose_five",
  "blocks": [
    { "kind": "paragraph", "id": "p1", "en": "原文段...", "zh": "译文..." },
    { "kind": "filled_slot", "number": 41, "selectedOption": "E", "answerSource": "paper_marked", "en": "回填句英文（保留 {{vocab}}）", "zh": "回填句译文" }
  ],
  "optionBank": [
    { "label": "A", "en": "选项A英文", "zh": "选项A译文", "usedInSlot": null }
  ]
}`,
      userPrompt: `题目标题：${title}\n\n原始文本：\n${rawText}`,
    };
  }

  if (type === 'translation') {
    return {
      systemPrompt: `你是资深考研英语长难句与翻译教研专家。请对用户提供的考研英语【翻译题】（英语一划线句或英语二段落翻译）进行**高度结构化的句子结构剖析与参考译文生成**，严格输出纯 JSON。

核心规则：
1. **严禁堆砌大段纯文本解析**：必须按 \`backbone\`（句子主干）+ \`components\`（3~7 个清晰分层成分块）结构化输出，便于前端直接渲染为可视化句法卡片！
2. **原样保留生词标记**：\`items[].originalEn\` 与 \`contextPassage[].en\` 必须完整保留 \`{{...}}\` 生词标记。
3. **成分片段精确对应**：\`components[].text\` 必须是原句去除 \`{{}}\` 后的真实连续片段，且按句内出现顺序排列；\`role\` 严格从以下 8 个枚举中选取：
   - \`main_clause\`（主句核心）
   - \`attributive_clause\`（定语从句）
   - \`adverbial_clause\`（状语从句）
   - \`noun_clause\`（名词性从句：主/宾/表/同位语）
   - \`non_finite\`（非谓语动词短语）
   - \`prepositional_phrase\`（介词短语修饰）
   - \`parenthetical\`（插入语）
   - \`special_syntax\`（倒装/强调/省略/形式主语/比较结构）
4. **若是英语二整段翻译**：请将段落自然拆分为逐句 \`items\`（number 从 1 开始递增），每句均做结构剖析。
5. **译文与得分点**：同时给出 \`literalZh\`（结构直译）与 \`polishedZh\`（考场高分意译），\`keyPoints\` 提炼 2~3 条精炼翻译得分点或易错坑。

必须返回严格匹配以下结构的 JSON：
{
  "title": "Part C Translation",
  "contextPassage": [{ "id": "c1", "en": "如有上下文则填，无则省略", "zh": "上下文译文" }],
  "items": [
    {
      "number": 46,
      "originalEn": "原句含 {{vocab}}...",
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
      userPrompt: `题目标题：${title}\n\n原始文本：\n${rawText}`,
    };
  }

  return {
    systemPrompt: `你是资深考研英语精读助手。请将用户提供的英文文本逐段精准翻译为流畅中文，严格输出纯 JSON。必须原样保留原文中的所有 \`{{...}}\` 生词花括号。

必须返回严格匹配以下结构的 JSON：
{
  "title": "文章精读",
  "paragraphs": [{ "id": "p1", "en": "原文段（含 {{vocab}}）", "zh": "中文译文" }]
}`,
    userPrompt: `题目标题：${title}\n\n原始文本：\n${rawText}`,
  };
}
