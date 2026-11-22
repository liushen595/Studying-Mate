import Dexie, { type Table } from 'dexie';
import type { ExamPaper, StoredImage } from '../../types/exam';

class StudyingMateDB extends Dexie {
  papers!: Table<ExamPaper, string>;
  images!: Table<StoredImage, string>;

  constructor() {
    super('StudyingMateDB');
    this.version(1).stores({
      papers: 'id, updatedAt, createdAt, status, examType',
      images: 'id, paperId, order',
    });
  }
}

export const db = new StudyingMateDB();

export async function deletePaperWithImages(paperId: string): Promise<void> {
  await db.transaction('rw', db.papers, db.images, async () => {
    await db.images.where('paperId').equals(paperId).delete();
    await db.papers.delete(paperId);
  });
}

export async function exportAllLearningData(): Promise<string> {
  const papers = await db.papers.toArray();
  return JSON.stringify(
    {
      version: 1,
      exportedAt: new Date().toISOString(),
      app: 'Studying-Mate',
      note: '不包含 API Key，仅含试卷精读记录与生词本数据',
      papers,
    },
    null,
    2,
  );
}

export async function importLearningData(jsonText: string): Promise<number> {
  const parsed = JSON.parse(jsonText);
  const papers: ExamPaper[] = Array.isArray(parsed?.papers)
    ? parsed.papers
    : Array.isArray(parsed)
      ? parsed
      : [];
  if (papers.length === 0) {
    throw new Error('备份文件中未找到有效的试卷数据');
  }
  await db.papers.bulkPut(papers);
  return papers.length;
}

/**
 * Built-in rich Kaoyan English sample paper so the user can explore
 * every question type (Cloze, Reading, 7-choose-5, Translation Syntax Tree,
 * Word Popover Card, and Printable Vocab Book) immediately with 1 click!
 */
export function createDemoKaoyanPaper(): ExamPaper {
  const now = Date.now();
  return {
    id: 'demo-kaoyan-2024',
    title: '示例真题 · 考研英语精读全题型体验卷',
    examType: 'english_1',
    createdAt: now,
    updatedAt: now,
    status: 'completed',
    sourceMode: 'text',
    rawMarkedText:
      'Section I Use of English\n...\nText 1\n...\nPart B\n...\nPart C Translation\n...',
    analysisMeta: {
      providerName: '示例演示数据',
      modelId: 'demo-built-in',
      totalTokensUsed: 0,
    },
    sections: [
      {
        id: 'demo-cloze',
        type: 'cloze',
        title: 'Section I · 完形填空 (节选)',
        status: 'done',
        paragraphs: [
          {
            id: 'c-p1',
            en: 'In modern academic life, digital tools have become [[1]] {{ubiquitous}} that many scholars can hardly imagine conducting research without them. [[2]], this convenience does not come without subtle cognitive costs, as constant notifications may quietly {{undermine}} deep concentration.',
            zh: '在现代学术生活中，数字工具已变得如此无处不在，以至于许多学者几乎无法想象离开它们该如何开展研究。然而，这种便利并非没有隐蔽的认知代价，因为持续不断的通知可能会悄然削弱深度专注力。',
          },
        ],
        blanks: [
          {
            number: 1,
            correctOption: 'B',
            correctWord: 'so',
            answerSource: 'paper_marked',
            options: [
              { label: 'A', text: 'such', briefZh: '如此（修饰名词）' },
              { label: 'B', text: 'so', briefZh: '如此（修饰形容词）' },
              { label: 'C', text: 'very', briefZh: '非常（不与that连用）' },
              { label: 'D', text: 'too', briefZh: '太……以致不' },
            ],
          },
          {
            number: 2,
            correctOption: 'A',
            correctWord: 'However',
            answerSource: 'paper_marked',
            options: [
              { label: 'A', text: 'However', briefZh: '然而（表转折）' },
              { label: 'B', text: 'Therefore', briefZh: '因此（表因果）' },
              { label: 'C', text: 'Likewise', briefZh: '同样地（表类比）' },
              { label: 'D', text: 'Otherwise', briefZh: '否则（表条件）' },
            ],
          },
        ],
      },
      {
        id: 'demo-reading',
        type: 'reading',
        title: 'Text 1 · 传统阅读理解 (节选)',
        status: 'done',
        paragraphs: [
          {
            id: 'r-p1',
            en: 'For decades, urban planners assumed that widening highways would {{alleviate}} traffic congestion. Yet empirical studies repeatedly reveal a counterintuitive phenomenon known as induced demand: expanding road capacity merely invites more drivers onto the asphalt, restoring gridlock within a few years.',
            zh: '几十年来，城市规划者一直假定拓宽高速公路能够缓解交通拥堵。然而，实证研究屡次揭示了一种反直觉现象，即“诱发需求”：扩大道路通行能力只会吸引更多驾驶者驶上路面，几年之内拥堵便卷土重来。',
          },
          {
            id: 'r-p2',
            en: 'Consequently, progressive municipalities are beginning to {{harbor}} doubts about asphalt-first budgets, redirecting funds toward reliable rail transit and walkable neighborhoods.',
            zh: '因此，具有前瞻性的市政当局正开始对“公路优先”的预算案心存疑虑，转而将资金投向可靠的轨道交通和适宜步行的社区。',
          },
        ],
        questions: [
          {
            number: 21,
            stemEn: 'According to the passage, widening highways tends to ______.',
            stemZh: '根据文章，拓宽高速公路往往会 ______。',
            correctOption: 'C',
            answerSource: 'paper_marked',
            options: [
              { label: 'A', textEn: 'permanently eliminate urban traffic jams', textZh: '永久消除城市交通拥堵' },
              { label: 'B', textEn: 'discourage investment in public rail systems', textZh: '抑制公共交通系统的投资' },
              { label: 'C', textEn: 'trigger additional driving and recreate congestion', textZh: '诱发更多驾车出行并重新导致拥堵' },
              { label: 'D', textEn: 'reduce municipal maintenance budgets', textZh: '减少市政维护预算' },
            ],
          },
        ],
      },
      {
        id: 'demo-newtype',
        type: 'new_type',
        title: 'Part B · 新题型七选五 (节选)',
        status: 'done',
        subType: 'seven_choose_five',
        blocks: [
          {
            kind: 'paragraph',
            id: 'n-p1',
            en: 'Effective reading comprehension is rarely a passive act of decoding symbols on a page.',
            zh: '高效的阅读理解绝非被动地解码纸面符号。',
          },
          {
            kind: 'filled_slot',
            number: 41,
            selectedOption: 'E',
            answerSource: 'paper_marked',
            en: 'Instead, skilled readers actively {{interrogate}} the author’s assumptions and map logical transitions between paragraphs.',
            zh: '相反，熟练的读者会主动审视作者的前提假设，并梳理段落之间的逻辑过渡。',
          },
          {
            kind: 'paragraph',
            id: 'n-p2',
            en: 'By pausing to summarize each argument in their own words, learners dramatically improve long-term retention.',
            zh: '通过停下来用自己的话总结每个论点，学习者能显著提升长期记忆留存率。',
          },
        ],
        optionBank: [
          {
            label: 'A',
            en: 'Speed-reading apps promise to triple reading rates overnight.',
            zh: '速读软件宣称能在一夜之间将阅读速度提高三倍。',
            usedInSlot: null,
          },
          {
            label: 'E',
            en: 'Instead, skilled readers actively interrogate the author’s assumptions and map logical transitions between paragraphs.',
            zh: '相反，熟练的读者会主动审视作者的前提假设，并梳理段落之间的逻辑过渡。',
            usedInSlot: 41,
          },
        ],
      },
      {
        id: 'demo-translation',
        type: 'translation',
        title: 'Part C · 翻译题 (含句子结构可视化剖析)',
        status: 'done',
        items: [
          {
            number: 46,
            originalEn:
              'It is precisely the willingness to question {{prevailing}} orthodoxies, which often appear self-evident to contemporaries, that enables scientific inquiry to advance beyond routine accumulation of data.',
            sentenceStructure: {
              sentenceType: '强调句（It is ... that ...）+ 非限制性定语从句（which 修饰 orthodoxies）',
              backbone: {
                subject: 'the willingness to question prevailing orthodoxies',
                predicate: 'enables',
                objectOrComplement: 'scientific inquiry to advance beyond routine accumulation of data',
                backboneZh: '正是质疑主流正统观念的意愿，使科学探索能够超越常规数据积累而不断前进。',
              },
              components: [
                {
                  text: 'It is precisely ... that',
                  role: 'special_syntax',
                  roleLabelZh: '强调句型框架',
                  meaningZh: '正是……才……',
                },
                {
                  text: 'the willingness to question prevailing orthodoxies',
                  role: 'main_clause',
                  roleLabelZh: '被强调的主语核心（含不定式后置定语）',
                  meaningZh: '质疑主流正统观念的意愿',
                },
                {
                  text: 'which often appear self-evident to contemporaries',
                  role: 'attributive_clause',
                  roleLabelZh: '非限制性定语从句',
                  modifies: '修饰先行词 prevailing orthodoxies',
                  meaningZh: '这些观念在同时代人看来往往是不言自明的',
                },
                {
                  text: 'enables scientific inquiry to advance beyond routine accumulation of data',
                  role: 'main_clause',
                  roleLabelZh: '谓语 + 宾语 + 宾补（enable sb./sth. to do）',
                  meaningZh: '使科学探索得以超越常规的数据积累而向前迈进',
                },
              ],
              literalZh:
                '正是质疑主流正统观念的意愿——这些观念对同时代人来说常常显得不言自明——使得科学探索能够超越常规的数据积累而前进。',
              polishedZh:
                '在同时代人看来，主流正统观念往往不言自明；而正是敢于质疑这些观念的意愿，才推动科学探索超越日常的数据堆砌，不断向前迈进。',
              keyPoints: [
                '识别「It is ... that ...」强调句：去掉框架后句子依然完整，翻译时突出“正是……才……”。',
                '长非限制性定语从句拆译前置：先交代“主流观念往往显得不言自明”，再衔接主句，避免中文定语过长拗口。',
                'prevailing 结合语境译为“主流的、盛行的”；orthodoxies 译为“正统观念/传统定论”。',
              ],
            },
          },
        ],
      },
    ],
    vocabulary: [
      {
        id: 'ubiquitous',
        lemma: 'ubiquitous',
        surfaceForms: ['ubiquitous'],
        phoneticUk: '/juːˈbɪk.wɪ.təs/',
        phoneticUs: '/juːˈbɪk.wə.t̬əs/',
        comprehensiveMeanings: [
          { pos: 'adj.', definitions: ['无处不在的；到处存在的', '十分普遍的；司空见惯的'] },
        ],
        occurrences: [
          {
            sectionId: 'demo-cloze',
            sectionTitle: 'Section I · 完形填空 (节选)',
            surfaceForm: 'ubiquitous',
            contextMeaning: '无处不在的，随处可见的',
            isUncommonMeaning: false,
            sentenceEn:
              'In modern academic life, digital tools have become so ubiquitous that many scholars can hardly imagine conducting research without them.',
            sentenceZh: '在现代学术生活中，数字工具已变得如此无处不在，以至于许多学者几乎无法想象离开它们该如何开展研究。',
          },
        ],
        collocations: [
          { phrase: 'become ubiquitous', meaning: '变得无处不在' },
          { phrase: 'ubiquitous presence', meaning: '随处可见的存在' },
        ],
        wordFamily: ['ubiquity (n. 无处不在)', 'ubiquitously (adv.)'],
      },
      {
        id: 'undermine',
        lemma: 'undermine',
        surfaceForms: ['undermine'],
        phoneticUk: '/ˌʌn.dəˈmaɪn/',
        phoneticUs: '/ˌʌn.dɚˈmaɪn/',
        comprehensiveMeanings: [
          { pos: 'v.', definitions: ['逐渐削弱；暗中破坏；损害（信心、权威、基础等）', '（字面义）在……下面挖洞；掏空……的地基'] },
        ],
        occurrences: [
          {
            sectionId: 'demo-cloze',
            sectionTitle: 'Section I · 完形填空 (节选)',
            surfaceForm: 'undermine',
            contextMeaning: '悄然削弱，破坏（深度专注力）',
            isUncommonMeaning: false,
            sentenceEn: 'constant notifications may quietly undermine deep concentration.',
            sentenceZh: '持续不断的通知可能会悄然削弱深度专注力。',
          },
        ],
        collocations: [
          { phrase: 'undermine public trust', meaning: '削弱公众信任' },
          { phrase: 'undermine the foundation', meaning: '动摇根基' },
        ],
        confusables: [{ word: 'underline', diff: 'underline 意为“在……下划线；强调”，考研高频形近易混词' }],
      },
      {
        id: 'alleviate',
        lemma: 'alleviate',
        surfaceForms: ['alleviate'],
        phoneticUk: '/əˈliː.vi.eɪt/',
        phoneticUs: '/əˈliː.vi.eɪt/',
        comprehensiveMeanings: [
          { pos: 'v.', definitions: ['减轻；缓解；缓和（痛苦、问题、压力、拥堵等）'] },
        ],
        occurrences: [
          {
            sectionId: 'demo-reading',
            sectionTitle: 'Text 1 · 传统阅读理解 (节选)',
            surfaceForm: 'alleviate',
            contextMeaning: '缓解（交通拥堵）',
            isUncommonMeaning: false,
            sentenceEn: 'For decades, urban planners assumed that widening highways would alleviate traffic congestion.',
            sentenceZh: '几十年来，城市规划者一直假定拓宽高速公路能够缓解交通拥堵。',
          },
        ],
        collocations: [
          { phrase: 'alleviate poverty', meaning: '缓解贫困' },
          { phrase: 'alleviate symptoms', meaning: '减轻症状' },
        ],
        wordFamily: ['alleviation (n. 缓解)'],
        confusables: [{ word: 'elevate', diff: 'elevate 意为“举起；提高；提升”，注意词首字母 a- 与 e-' }],
      },
      {
        id: 'harbor',
        lemma: 'harbor',
        surfaceForms: ['harbor'],
        phoneticUk: '/ˈhɑː.bər/',
        phoneticUs: '/ˈhɑːr.bɚ/',
        comprehensiveMeanings: [
          { pos: 'v.', definitions: ['心怀；怀有（疑虑、怨恨、希望等抽象情绪）', '庇护；窝藏（逃犯等）', '停泊于港湾'] },
          { pos: 'n.', definitions: ['海港；港湾', '避难所；庇护处'] },
        ],
        occurrences: [
          {
            sectionId: 'demo-reading',
            sectionTitle: 'Text 1 · 传统阅读理解 (节选)',
            surfaceForm: 'harbor',
            contextMeaning: '心怀、怀有（疑虑）—— 考研经典熟词僻义！',
            isUncommonMeaning: true,
            sentenceEn: 'progressive municipalities are beginning to harbor doubts about asphalt-first budgets.',
            sentenceZh: '具有前瞻性的市政当局正开始对“公路优先”的预算案心存疑虑。',
          },
        ],
        collocations: [
          { phrase: 'harbor doubts / suspicions', meaning: '心存疑虑 / 怀疑' },
          { phrase: 'harbor resentment', meaning: '怀恨在心' },
        ],
      },
      {
        id: 'interrogate',
        lemma: 'interrogate',
        surfaceForms: ['interrogate'],
        phoneticUk: '/ɪnˈter.ə.ɡeɪt/',
        phoneticUs: '/ɪnˈter.ə.ɡeɪt/',
        comprehensiveMeanings: [
          { pos: 'v.', definitions: ['审问；讯问；盘问', '（学术语境）深入质疑；审视探究（文本、观点、假设等）', '（计算机）查询，检索'] },
        ],
        occurrences: [
          {
            sectionId: 'demo-newtype',
            sectionTitle: 'Part B · 新题型七选五 (节选)',
            surfaceForm: 'interrogate',
            contextMeaning: '深入审视、质询（作者的前提假设）',
            isUncommonMeaning: true,
            sentenceEn: 'Instead, skilled readers actively interrogate the author’s assumptions and map logical transitions between paragraphs.',
            sentenceZh: '相反，熟练的读者会主动审视作者的前提假设，并梳理段落之间的逻辑过渡。',
          },
        ],
        collocations: [{ phrase: 'interrogate assumptions', meaning: '审视/质询前提假设' }],
        wordFamily: ['interrogation (n. 审讯；质询)', 'interrogative (adj. 疑问的)'],
      },
      {
        id: 'prevailing',
        lemma: 'prevailing',
        surfaceForms: ['prevailing'],
        phoneticUk: '/prɪˈveɪ.lɪŋ/',
        phoneticUs: '/prɪˈveɪ.lɪŋ/',
        comprehensiveMeanings: [
          { pos: 'adj.', definitions: ['普遍的；盛行的；占主导地位的（观念、风气、趋势）', '（风向等）盛行的，常刮的'] },
        ],
        occurrences: [
          {
            sectionId: 'demo-translation',
            sectionTitle: 'Part C · 翻译题 (含句子结构可视化剖析)',
            surfaceForm: 'prevailing',
            contextMeaning: '主流的、盛行的（正统观念）',
            isUncommonMeaning: false,
            sentenceEn: 'It is precisely the willingness to question prevailing orthodoxies...',
            sentenceZh: '正是敢于质疑主流正统观念的意愿……',
          },
        ],
        collocations: [
          { phrase: 'prevailing view / orthodoxy', meaning: '主流观点 / 正统观念' },
          { phrase: 'prevailing trend', meaning: '普遍趋势' },
        ],
        wordFamily: ['prevail (v. 盛行；占上风)', 'prevalent (adj. 普遍的；流行的)'],
      },
    ],
  };
}
