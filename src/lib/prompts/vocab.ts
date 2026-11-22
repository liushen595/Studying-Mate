import { z } from 'zod';

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
  surfaceForms: string[];
  occurrences: Array<{
    sectionId: string;
    sectionTitle: string;
    surfaceForm: string;
    sentenceEn: string;
  }>;
}

export function buildVocabBatchPrompt(items: ExtractedVocabItem[]) {
  const systemPrompt = `你是权威英汉词典编纂专家兼考研英语词汇名师。用户会提供一份从考研英语试卷中提取的生词清单（包含原文词形与所在英文原句），请为每一个生词生成全面且精准的词典级 JSON 数据。严禁输出 JSON 以外的任何文字。

核心要求：
1. **必须提供全面释义（重中之重）**：\`comprehensiveMeanings\` 绝不能只给当前文章里的单一含义！必须全面覆盖该词在考研英语大纲与通用英语中的主要词性及全部核心义项（多义词需列出多个义项，涵盖熟词僻义）。
2. **精准给出本文语境义**：在 \`occurrences[].contextMeaning\` 中明确指出该词在对应原句中的准确含义；若属于考研高频「熟词僻义」，将 \`isUncommonMeaning\` 设为 \`true\`，并给出该原句的流畅中文译文 \`sentenceZh\`。
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
