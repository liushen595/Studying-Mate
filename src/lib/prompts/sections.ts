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
      systemPrompt: `你是资深考研英语教研专家。请对用户提供的考研英语【Section II Reading Comprehension · Part A 传统阅读理解】（Text 1–4 之一，通常含 5 道选择题）进行逐段精准双语翻译，并整理附带的全部选择题（如有）。严格输出纯 JSON，不要附加任何说明。

核心规则：
1. **原样保留生词标记**：\`paragraphs[].en\` 必须忠实保留输入文本中的全部 \`{{...}}\` 生词花括号，不可增删。
2. **逐段忠实译文**：\`paragraphs[].zh\` 应准确、通顺、符合考研精读语境。
3. **完整收录每篇 5 道选择题并尊重卷面订正答案**：若题干/文末标注了答案（如 \`[ANSWER: 21=C]\`），必须采用并标 \`answerSource: "paper_marked"\`；若无则求解并标 \`"llm_solved"\`。若输入不含选择题，\`questions\` 返回空数组 \`[]\`。
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
      systemPrompt: `你是资深考研英语长难句与翻译教研专家。请对用户提供的考研英语【Section II Reading Comprehension · Part C 翻译题】（英语一为文章中带下划线的 5 个句子 (46)–(50)；英语二为整段翻译）进行**高度结构化的句子结构剖析与参考译文生成**，严格输出纯 JSON。

核心规则：
1. **精准定位待译划线句子（极重要！）**：
   - 若输入为考研英语一 Part C（短文中穿插了 \`<u>(46) ...</u>\` 至 \`<u>(50) ...</u>\` 划线标签，或仅标出了 \`(46)\`–\`(50)\` 题号）：\`items[]\` **只提取这 5 个待译划线句子**（去除外层 \`<u>\` 与 \`(46)\` 题号前缀，填好对应 \`number: 46..50\`）；同时将完整原文段落放入 \`contextPassage[]\`（\`contextPassage[].en\` 中请保留 \`<u>...</u>\` 标签，方便前端在上下文中高亮出划线句）。
   - 若输入为考研英语二 Part C（整段翻译，无 46–50 独立划线句）：将段落自然拆分为逐句 \`items\`（\`number\` 从 1 开始递增），每句均做结构剖析。
2. **严禁堆砌大段纯文本解析**：必须按 \`backbone\`（句子主干）+ \`components\`（3~7 个清晰分层成分块）结构化输出，便于前端直接渲染为可视化句法卡片！
3. **原样保留生词标记**：\`items[].originalEn\` 与 \`contextPassage[].en\` 必须完整保留 \`{{...}}\` 生词标记。
4. **成分片段精确对应**：\`components[].text\` 必须是原句去除 \`{{}}\` 后的真实连续片段，且按句内出现顺序排列；\`role\` 严格从以下 8 个枚举中选取：
   - \`main_clause\`（主句核心）
   - \`attributive_clause\`（定语从句）
   - \`adverbial_clause\`（状语从句）
   - \`noun_clause\`（名词性从句：主/宾/表/同位语）
   - \`non_finite\`（非谓语动词短语）
   - \`prepositional_phrase\`（介词短语修饰）
   - \`parenthetical\`（插入语）
   - \`special_syntax\`（倒装/强调/省略/形式主语/比较结构）
5. **译文与得分点**：同时给出 \`literalZh\`（结构直译）与 \`polishedZh\`（考场高分意译），\`keyPoints\` 提炼 2~3 条精炼翻译得分点或易错坑。

必须返回严格匹配以下结构的 JSON：
{
  "title": "Section II · Part C Translation",
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
      userPrompt: `题目标题：${title}\n\n原始文本：\n${rawText}`,
    };
  }

  if (type === 'writing') {
    return {
      systemPrompt: `你是资深考研英语写作阅卷组专家与名师。请对用户提供的考研英语【Section III Writing】（Part A 应用文小作文 / Part B 图画或图表大作文）输出系统的**写作指导、高分范文、提分好词、亮点好句**，严格按照指定 JSON 结构输出，严禁输出任何 JSON 以外的文字。

核心规则：
1. **精准识别 Part A 与 Part B**：
   - 若输入同时包含 Part A 和 Part B，请在 \`tasks\` 数组中分别输出 2 项；若只包含其中一篇，则输出 1 项。
   - **Part A（小作文，约 100 词）**：应用文（书信、邮件、告示、备忘录、纪要等），强调格式规范（称呼、落款、语域得体）与题目所有要点 100% 覆盖。
   - **Part B（大作文，英语一约 160–200 词 / 英语二约 150 词）**：图画/漫画作文或图表/表格作文，采用经典清晰的三段式谋篇（描述图画或核心数据趋势 → 剖析深层原因与影响 → 归纳建议与展望）。若输入包含 \`[图画/图表信息：...]\`，必须紧扣其中的画面/数据撰写 \`visualSummary\` 与范文。
2. **写作指导（\`guidance\`）**：明确文体与语域、目标字数、核心立意、分段落大纲（每段要点与建议词数）及 2~4 条考场高分技巧与避坑提示。
3. **高分范文（\`sampleEssay\`）**：语言地道自然、逻辑衔接紧密、句式富有变化（避免生僻词硬凑），提供逐段中英对照（\`paragraphs\`，保留输入中标记的 \`{{...}}\` 生词或可在范文中保持自然纯文本）、准确 \`wordCount\` 及简明总评 \`commentaryZh\`。
4. **提分好词（\`goodWords\`，6~10 个）**：精选范文与同话题高分词汇/短语搭配，注明词性/类型、中文释义、可替换的普通表达（如 \`替换 very important\`）及简短用法例句。
5. **亮点好句（\`goodSentences\`，3~5 句）**：精选可直接迁移复用的高分句型/模板句，注明句式标签（如 \`非限制性定语从句\` / \`倒装强调句\` / \`图画描写模板\`）、中英对照与套用场景说明。

必须返回严格匹配以下结构的 JSON：
{
  "title": "Section III Writing",
  "tasks": [
    {
      "part": "part_a",
      "partLabel": "Part A · 应用文（小作文）",
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
