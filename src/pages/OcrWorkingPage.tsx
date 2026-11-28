import { useEffect } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { ArrowLeft, Loader2, RefreshCw, ScanText } from 'lucide-react';
import { useImportSessionStore } from '../stores/useImportSessionStore';
import { useTaskStore } from '../stores/useTaskStore';
import { executeOcrSession } from '../lib/pipeline/ocr-session';
import { ExecutionTimeline } from '../components/common/ExecutionTimeline';

export function OcrWorkingPage() {
  const navigate = useNavigate();
  const { images, title, ocrForceFull, ocrReturnPath, ocrStage, setField } =
    useImportSessionStore();
  const { running, fatalError, steps } = useTaskStore();

  useEffect(() => {
    if (!running && ocrStage === 'review' && images.length > 0 && !fatalError) {
      navigate(ocrReturnPath, { replace: true });
    }
  }, [running, ocrStage, images.length, fatalError, ocrReturnPath, navigate]);

  if (images.length === 0 && !running) {
    return <Navigate to="/import" replace />;
  }

  const pendingCount = images.filter((img) => img.ocrStatus === 'pending').length;
  const doneCount = images.length - pendingCount;
  const hasError = !running && (Boolean(fatalError) || steps.some((s) => s.status === 'error'));

  const handleBackToUpload = () => {
    setField('mode', 'image');
    setField('ocrStage', 'upload');
    navigate(ocrReturnPath);
  };

  const handleRetryOcr = () => {
    void executeOcrSession({
      forceFull: ocrForceFull,
      onSuccess: (returnPath) => {
        if (window.location.pathname === '/import/ocr') {
          navigate(returnPath, { replace: true });
        }
      },
    });
  };

  return (
    <div className="space-y-4">
      <div className="island p-5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent">
            {running ? <Loader2 className="h-5 w-5 animate-spin" /> : <ScanText className="h-5 w-5" />}
          </div>
          <div className="min-w-0">
            <h1 className="truncate text-lg font-bold tracking-tight text-text-primary">
              {title.trim() || 'Stage 1 · 视觉 OCR 识图'}
            </h1>
            <p className="text-xs text-text-secondary">
              {running
                ? `正在识别试卷图片（已完成 ${doneCount}/${images.length} 页）`
                : hasError
                  ? '识别未完成，可重试或返回调整图片'
                  : '识别完成，正在进入校对工作台…'}
            </p>
          </div>
        </div>

        {!running && (
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={handleBackToUpload}
              className="inline-flex items-center gap-1.5 rounded-xl border border-border-subtle bg-surface-subtle px-3.5 py-2 text-xs font-medium text-text-secondary hover:border-accent hover:text-text-primary"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              返回图片列表
            </button>
            <button
              type="button"
              onClick={handleRetryOcr}
              className="inline-flex items-center gap-1.5 rounded-xl bg-accent px-4 py-2 text-xs font-semibold text-white shadow-xs hover:opacity-92"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              重新识别
            </button>
          </div>
        )}
      </div>

      <ExecutionTimeline />

      {images.length > 0 && (
        <div className="island p-4 space-y-3">
          <div className="flex items-center justify-between text-xs text-text-secondary">
            <span className="font-medium text-text-primary">待处理页面（共 {images.length} 页）</span>
            <span className="font-mono">
              已 OCR {doneCount} · 待识别 {pendingCount}
            </span>
          </div>
          <div className="grid gap-3 grid-cols-3 sm:grid-cols-4 md:grid-cols-6">
            {images.map((img, idx) => (
              <div
                key={img.id}
                className="relative overflow-hidden rounded-xl border border-border-subtle bg-surface-subtle"
              >
                <div className="absolute inset-x-1.5 top-1.5 z-10 flex items-center justify-between gap-1">
                  <span className="rounded-md bg-black/65 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-white">
                    P{idx + 1}
                  </span>
                  <span
                    className={`rounded-md px-1.5 py-0.5 text-[10px] font-semibold ${
                      img.ocrStatus === 'done'
                        ? 'bg-emerald-600/85 text-white'
                        : 'bg-amber-500/90 text-white'
                    }`}
                  >
                    {img.ocrStatus === 'done' ? '已 OCR' : '待识别'}
                  </span>
                </div>
                <img
                  src={img.previewUrl}
                  alt={img.name}
                  className="h-28 w-full object-cover"
                />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
