import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  BookMarked,
  BookOpen,
  Edit3,
  FilePlus2,
  Image as ImageIcon,
  Settings,
  Sparkles,
  Trash2,
} from 'lucide-react';
import {
  createDemoKaoyanPaper,
  db,
  deletePaperWithImages,
} from '../lib/db';
import { useSettingsStore } from '../stores/useSettingsStore';

export function HomePage() {
  const navigate = useNavigate();
  const { getAnalysisProvider } = useSettingsStore();
  const papers = useLiveQuery(() => db.papers.orderBy('updatedAt').reverse().toArray(), []);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const activeProvider = getAnalysisProvider();
  const hasApiKey = Boolean(activeProvider.apiKey.trim());

  const handleLoadDemo = async () => {
    const demo = createDemoKaoyanPaper();
    await db.papers.put(demo);
    navigate(`/paper/${demo.id}`);
  };

  const handleDelete = async (id: string) => {
    await deletePaperWithImages(id);
    setConfirmDeleteId(null);
  };

  return (
    <div className="space-y-4">
      {/* Welcome / Status Island */}
      <section className="island p-6 sm:p-7 flex flex-wrap items-center justify-between gap-4">
        <div className="space-y-1.5 max-w-2xl">
          <div className="inline-flex items-center gap-1.5 rounded-full bg-accent-soft px-3 py-1 text-xs font-medium text-accent">
            <Sparkles className="h-3.5 w-3.5" />
            <span>纯前端直连 · 本地隐私存储 · 考研英语专项精读</span>
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-text-primary">
            我的考研英语试卷库
          </h1>
          <p className="text-sm leading-relaxed text-text-secondary">
            支持文本粘贴（<code className="rounded bg-surface-subtle px-1 py-0.5 font-mono text-xs">{'{{生词}}'}</code>）与红笔方框拍照 OCR 校对；自动完成分题型答案回填、双语精读、翻译句子结构剖析与可打印 PDF 生词本。
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <Link
            to="/import"
            className="inline-flex items-center gap-2 rounded-xl bg-accent px-4 py-2.5 text-sm font-medium text-white shadow-xs transition hover:opacity-92"
          >
            <FilePlus2 className="h-4 w-4" />
            导入新试卷
          </Link>

          <button
            type="button"
            onClick={handleLoadDemo}
            className="inline-flex items-center gap-2 rounded-xl border border-border-subtle bg-surface-subtle px-4 py-2.5 text-sm font-medium text-text-primary transition hover:border-border-strong"
          >
            <BookOpen className="h-4 w-4 text-accent" />
            加载全题型示例卷
          </button>
        </div>
      </section>

      {/* API Key Quick Setup Banner */}
      {!hasApiKey && (
        <div className="island border-vocab/30 bg-vocab-soft/30 px-5 py-3.5 flex flex-wrap items-center justify-between gap-3">
          <div className="text-sm text-text-primary">
            <span className="font-semibold">尚未配置 LLM API Key：</span>
            <span className="text-text-secondary">
              当前默认供应商为 {activeProvider.name}（{activeProvider.modelId}）。配置 Key 后即可直接分析你的真题，或先点击上方「加载全题型示例卷」体验界面。
            </span>
          </div>
          <Link
            to="/settings"
            className="inline-flex items-center gap-1.5 rounded-xl bg-surface px-3.5 py-2 text-xs font-semibold text-text-primary border border-border-subtle hover:border-accent"
          >
            <Settings className="h-3.5 w-3.5 text-accent" />
            去配置模型与 Key
          </Link>
        </div>
      )}

      {/* Papers Grid */}
      {!papers ? (
        <div className="island p-10 text-center text-sm text-text-muted">加载试卷库中...</div>
      ) : papers.length === 0 ? (
        <div className="island p-12 text-center space-y-4">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-surface-subtle text-text-muted">
            <BookOpen className="h-6 w-6" />
          </div>
          <div className="space-y-1">
            <h2 className="text-base font-semibold text-text-primary">还没有精读记录</h2>
            <p className="text-sm text-text-secondary">
              点击「导入新试卷」粘贴带 {'{{生词}}'} 的真题或上传红笔标注照片，也可以一键加载示例卷体验全部精读功能。
            </p>
          </div>
          <div className="flex justify-center gap-3 pt-1">
            <Link
              to="/import"
              className="rounded-xl bg-accent px-4 py-2 text-sm font-medium text-white"
            >
              立即导入试卷
            </Link>
            <button
              type="button"
              onClick={handleLoadDemo}
              className="rounded-xl border border-border-subtle bg-surface-subtle px-4 py-2 text-sm font-medium text-text-primary"
            >
              查看示例卷
            </button>
          </div>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {papers.map((paper) => {
            const statusMeta =
              paper.status === 'completed'
                ? { label: '解析完成', cls: 'bg-answer-soft text-answer' }
                : paper.status === 'ocr_draft'
                  ? { label: 'OCR 待校对', cls: 'bg-vocab-soft text-vocab' }
                  : paper.status === 'partial_error'
                    ? { label: '部分失败可重试', cls: 'bg-danger-soft text-danger' }
                    : { label: '解析中', cls: 'bg-accent-soft text-accent' };

            return (
              <div
                key={paper.id}
                className="island group flex flex-col justify-between p-5 transition hover:border-border-strong"
              >
                <div className="space-y-3">
                  <div className="flex items-start justify-between gap-2">
                    <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${statusMeta.cls}`}>
                      {statusMeta.label}
                    </span>
                    <div className="flex items-center gap-1.5 text-xs text-text-muted">
                      {paper.sourceMode === 'image' && (
                        <span title="图像 OCR 导入">
                          <ImageIcon className="h-3.5 w-3.5" />
                        </span>
                      )}
                      <span>{new Date(paper.updatedAt).toLocaleDateString()}</span>
                    </div>
                  </div>

                  <Link
                    to={paper.status === 'ocr_draft' ? `/import?draft=${paper.id}` : `/paper/${paper.id}`}
                    className="block space-y-1"
                  >
                    <h2 className="text-base font-semibold text-text-primary group-hover:text-accent transition line-clamp-2">
                      {paper.title}
                    </h2>
                    <div className="flex flex-wrap gap-1.5 pt-1">
                      {paper.sections.slice(0, 4).map((sec) => (
                        <span
                          key={sec.id}
                          className="rounded-md bg-surface-subtle px-2 py-0.5 text-[11px] text-text-secondary"
                        >
                          {sec.type === 'cloze'
                            ? '完形'
                            : sec.type === 'reading'
                              ? '阅读'
                              : sec.type === 'new_type'
                                ? '新题型'
                                : sec.type === 'translation'
                                  ? '翻译'
                                  : sec.type === 'writing'
                                    ? '写作'
                                    : '精读'}
                        </span>
                      ))}
                    </div>
                  </Link>
                </div>

                <div className="mt-4 flex items-center justify-between border-t border-border-subtle pt-3 text-xs">
                  <div className="flex items-center gap-3 text-text-secondary">
                    <span className="inline-flex items-center gap-1">
                      <BookMarked className="h-3.5 w-3.5 text-vocab" />
                      {paper.vocabulary.length} 生词
                    </span>
                    {paper.analysisMeta?.modelId && (
                      <span className="truncate max-w-[130px] font-mono text-[11px] text-text-muted">
                        {paper.analysisMeta.modelId}
                      </span>
                    )}
                  </div>

                  {confirmDeleteId === paper.id ? (
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => handleDelete(paper.id)}
                        className="rounded-md bg-danger px-2 py-1 text-[11px] font-medium text-white"
                      >
                        确认删除
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmDeleteId(null)}
                        className="rounded-md bg-surface-subtle px-2 py-1 text-[11px] text-text-secondary"
                      >
                        取消
                      </button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-1">
                      <Link
                        to={`/import?paperId=${paper.id}`}
                        className="rounded-lg p-1.5 text-text-muted opacity-70 transition hover:bg-accent-soft hover:text-accent hover:opacity-100"
                        title="编辑原文 / 增量追加"
                      >
                        <Edit3 className="h-3.5 w-3.5" />
                      </Link>
                      <button
                        type="button"
                        onClick={() => setConfirmDeleteId(paper.id)}
                        className="rounded-lg p-1.5 text-text-muted opacity-70 transition hover:bg-danger-soft hover:text-danger hover:opacity-100"
                        title="删除试卷"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
