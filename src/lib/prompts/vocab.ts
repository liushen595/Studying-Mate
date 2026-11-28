import { z } from 'zod';
import type { ExamSection, VocabExtractDensity } from '../../types/exam';

export const AutoVocabExtractResponseZod = z.object({
  words: z
    .array(
      z.object({
        surfaceForm: z.string(),
        lemma: z.string().optional(),
        reason: z.string().optional(),
      }),
    )
    .default([]),
});

export const VocabBatchResponseZod = z.object({
  entries: z.array(
    z.object({
      id: z.string(),
      lemma: z.string(),
      surfaceForms: z.array(z.string()).default([]),
      phoneticUk: z.string().default(''),
      phoneticUs: z.string().default(''),
      comprehensiveMeanings: z
        .array(
          z.object({
            pos: z.string(),
            definitions: z.array(z.string()),
          }),
        )
        .default([]),
      occurrences: z
        .array(
          z.object({
            sectionId: z.string(),
            sectionTitle: z.string(),
            surfaceForm: z.string(),
            contextMeaning: z.string(),
            isUncommonMeaning: z.boolean().optional(),
            sentenceEn: z.string(),
            sentenceZh: z.string(),
          }),
        )
        .default([]),
      collocations: z
        .array(
          z.object({
            phrase: z.string(),
            meaning: z.string(),
          }),
        )
        .default([]),
      wordFamily: z.array(z.string()).optional(),
      confusables: z
        .array(
          z.object({
            word: z.string(),
            diff: z.string(),
          }),
        )
        .optional(),
    }),
  ),
});

export interface ExtractedVocabItem {
  key: string;
  source: 'user' | 'ai';
  surfaceForms: string[];
  occurrences: Array<{
    sectionId: string;
    sectionTitle: string;
    surfaceForm: string;
    sentenceEn: string;
  }>;
}

const DENSITY_GUIDANCE: Record<VocabExtractDensity, { label: string; range: string; shortRange: string }> = {
  concise: {
    label: '精简核心',
    range: '4–7 个',
    shortRange: '2–4 个',
  },
  balanced: {
    label: '适中均衡（推荐）',
    range: '7–12 个',
    shortRange: '3–6 个',
  },
  comprehensive: {
    label: '全面深挖',
    range: '12–18 个',
    shortRange: '5–9 个',
  },
};

/**
 * Unified prompt for BOTH:
 * 1) Pure auto-summarization when user marked 0 words (`userMarkedWords = []`)
 * 2) Smart augmentation on top of user's red-pen / manual `{{...}}` words (`userMarkedWords.length > 0`)
 */
export function buildAutoVocabDiscoveryPrompt(params: {
  sectionTitle: string;
  sectionType: ExamSection['type'];
  rawText: string;
  userMarkedWords: string[];
  density: VocabExtractDensity;
}) {
  const { sectionTitle, sectionType, rawText, userMarkedWords, density } = params;
  const spec = DENSITY_GUIDANCE[density] || DENSITY_GUIDANCE.balanced;
  const isShortSection = sectionType === 'translation' || sectionType === 'writing';
  const targetRange = isShortSection ? spec.shortRange : spec.range;
  const hasUserWords = userMarkedWords.length > 0;

  // Strip markup so the model reads clean text and extracts exact verbatim surface forms
  const cleanText = rawText
    .replace(/<\/?u>/gi, '')
    .replace(/\{\{([^{}]+?)\}\}/g, '$1')
    .replace(/\[ANSWER:[^\]]*\]/gi, '')
    .trim();

  const systemPrompt = `你是资深考研英语（英语一 / 英语二）词汇教研专家。你的任务是通读用户提供的试卷片段，**自动甄选并补充**最值得背诵的考研核心生词、高价值短语搭配与「熟词僻义」，严格输出纯 JSON，严禁输出 JSON 以外的任何文字。

本提示词同时覆盖「零标注自动总结」与「在用户手标生词基础上智能补充」两种场景，请严格遵守以下规则：
1. **严格去重、不重复用户已标词汇**：
   - 输入中会提供「用户已标记生词列表」（可能为空数组 \`[]\`）。
   - 若列表为空：请独立总结本段最核心的考研生词。
   - 若列表非空：用户已经框选了部分生词，**严禁重复输出列表中已有的词或其同词元变形**（如用户已标 \`undermining\`，则不要再输出 \`undermine\` / \`undermined\`）；只输出需要**额外补充**的高价值遗漏词汇。
2. **精准对齐考研英语难度与高价值选词标准**：
   - **优先选取**：① 考研大纲高频核心实词（动词、形容词、名词、副词）；② 超纲但学术阅读常见的高价值词；③ **熟词僻义**（表面看似简单但在本文语境中作特殊含义，如 \`harbor\` 作“心怀”、\`address\` 作“解决”、\`novel\` 作“新颖的”、\`yield\` 作“产生/屈服”等）；④ 考研高频固定短语/动词搭配（2–3 词以内，如 \`account for\`、\`stem from\`）。
   - **严禁选取**：① 中小学及极基础高频词（如 \`people\`, \`important\`, \`however\`, \`country\`, \`develop\`, \`study\` 等，除非在本文明显考到熟词僻义）；② 纯人名、地名、机构名缩写（如 \`London\`, \`Obama\`, \`NASA\`）；③ 数字、题号或试卷模板套话（\`Directions\`, \`Section\`, \`Answer Sheet\`, \`Text\`, \`following\`, \`passage\` 等）。
3. **\`surfaceForm\` 必须 100% 原文逐字精确匹配（极其重要！）**：
   - \`surfaceForm\` 必须是下方英文原文中**真实、原样连续出现**的单词或短语（保留原文词形，不要自行还原为原文未出现的原型！例如原文是 \`alleviating\`，\`surfaceForm\` 必须写 \`"alleviating"\`，而 \`lemma\` 写 \`"alleviate"\`）。
   - 这样前端才能自动在精读视图中精准定位并加上生词下划线与点词卡片！
4. **科学控量（当前密度档位：${spec.label}）**：
   - 本片段建议补充 **${targetRange}** 个最具提分价值的词汇/短语。
   - 若用户已标记词汇已经覆盖了大部分难点，或片段本身极短（如简短写作题目），宁缺毋滥，只需补充真正有价值的遗漏词（可少于建议数量，甚至返回空数组 \`[]\`）。

必须返回严格匹配以下结构的 JSON：
{
  "words": [
    {
      "surfaceForm": "原文中逐字出现的词形或短语（如 undermining）",
      "lemma": "词元原型（如 undermine）",
      "reason": "极简入选理由（如 考研核心高频词 / 熟词僻义：心怀）"
    }
  ]
}`;

  const userPrompt = `当前模块：${sectionTitle}（题型：${sectionType}）
当前模式：${hasUserWords ? `在用户已标 ${userMarkedWords.length} 个生词的基础上智能补充` : '用户未标记生词，自动总结本段核心考研生词'}
用户已标记生词列表：${JSON.stringify(userMarkedWords)}

英文原文：
${cleanText}`;

  return { systemPrompt, userPrompt };
}

export function buildVocabBatchPrompt(items: ExtractedVocabItem[]) {
  const systemPrompt = `你是权威英汉词典编纂专家兼考研英语词汇名师。用户会提供一份从考研英语试卷中提取的生词清单（包含原文词形与所在英文原句），请为每一个生词生成全面且精准的词典级 JSON 数据。严禁输出 JSON 以外的任何文字。

核心要求：
1. **必须提供全面释义（重中之重）**：\`comprehensiveMeanings\` 绝不能只给当前文章里的单一含义！必须全面覆盖该词在考研英语大纲与通用英语中的主要词性及全部核心义项（多义词需列出多个义项，涵盖熟词僻义）。
2. **精准给出本文语境义**：在 \`occurrences[].contextMeaning\` 中明确指出该词在对应原句中的准确含义；若属于考研高频「熟词僻义」，将 \`isUncommonMeaning\` 设为 \`true\`，并给出该原句的流畅中文译文 \`sentenceZh\`（所有中文字段不要包含 \`{{}}\`、\`<u>\` 或 \`[[...]]\` 等标记与占位符）。
3. **词元还原与标准音标**：将复数、过去式、分词、比较级等变形还原为原型 \`lemma\`，提供标准 IPA 英式（\`phoneticUk\`）与美式（\`phoneticUs\`）音标（短语可留空或给核心词音标）。
4. **高价值拓展**：\`collocations\` 提供 2~3 个考研高频固定搭配；\`wordFamily\` 列出常见同根衍生词；仅在确实存在高辨析价值形近/近义词时填写 \`confusables\`。
5. **零遗漏保证**：输出的 \`entries\` 必须覆盖输入清单中的每一个生词，\`id\` 保持与输入中的 \`key\` 一致。

必须返回严格匹配以下结构的 JSON：
{
  "entries": [
    {
      "id": "undermine",
      "lemma": "undermine",
      "surfaceForms": ["undermining"],
      "phoneticUk": "/ˌʌndəˈmaɪn/",
      "phoneticUs": "/ˌʌndərˈmaɪn/",
      "comprehensiveMeanings": [
        { "pos": "v.", "definitions": ["逐渐削弱；暗中破坏；损害", "（字面义）在……下面挖洞；侵蚀……的基础"] }
      ],
      "occurrences": [
        {
          "sectionId": "sec-1",
          "sectionTitle": "Text 1",
          "surfaceForm": "undermining",
          "contextMeaning": "逐渐削弱，破坏（信任/根基）",
          "isUncommonMeaning": false,
          "sentenceEn": "原句...",
          "sentenceZh": "原句中文翻译..."
        }
      ],
      "collocations": [
        { "phrase": "undermine public trust", "meaning": "削弱公众信任" }
      ],
      "wordFamily": ["undermined (adj.)"],
      "confusables": [{ "word": "underline", "diff": "underline 意为“在……下划线；强调”，勿混淆" }]
    }
  ]
}`;

  const payload = items.map((item) => ({
    key: item.key,
    surfaceForms: item.surfaceForms,
    occurrences: item.occurrences,
  }));

  const userPrompt = `请为以下 ${items.length} 个考研英语生词生成全面释义与语境分析 JSON：\n${JSON.stringify(payload, null, 2)}`;

  return { systemPrompt, userPrompt };
}
