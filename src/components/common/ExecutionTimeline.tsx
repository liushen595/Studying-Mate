import { useEffect, useState } from 'react';
import {
  Brain,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock,
  Loader2,
  Square,
  XCircle,
} from 'lucide-react';
import { useTaskStore } from '../../stores/useTaskStore';
import { ErrorDiagnosticCard } from './ErrorDiagnosticCard';
import type { ExecutionStepState } from '../../types/llm';

function StepItem({ step }: { step: ExecutionStepState }) {
  const isActive = step.status === 'thinking' || step.status === 'streaming';
  const [thinkingOpen, setThinkingOpen] = useState(isActive);

  useEffect(() => {
    if (step.status === 'thinking' && step.thinkingText) {
      setThinkingOpen(true);
    } else if (step.status === 'done') {
      setThinkingOpen(false);
    }
  }, [step.status, Boolean(step.thinkingText)]);

  const durationSec =
    step.startedAt && step.finishedAt
      ? ((step.finishedAt - step.startedAt) / 1000).toFixed(1)
      : null;

  return (
    <div className="rounded-xl border border-border-subtle bg-surface-subtle/60 px-3.5 py-2.5 transition">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2.5 min-w-0">
          {step.status === 'done' && (
            <CheckCircle2 className="h-4 w-4 shrink-0 text-answer" />
          )}
          {step.status === 'error' && (
            <XCircle className="h-4 w-4 shrink-0 text-danger" />
          )}
          {step.status === 'pending' && (
            <Clock className="h-4 w-4 shrink-0 text-text-muted" />
          )}
          {isActive && (
            <Loader2 className="h-4 w-4 shrink-0 animate-spin text-accent" />
          )}
          <span className="truncate text-sm font-medium text-text-primary">
            {step.label}
          </span>
        </div>

        <div className="flex items-center gap-2 text-xs text-text-muted font-mono">
          {step.status === 'thinking' && (
            <span className="rounded-full bg-accent-soft px-2 py-0.5 text-[11px] font-sans font-medium text-accent">
              深度思考中…
            </span>
          )}
          {step.status === 'streaming' && (
            <span className="rounded-full bg-answer-soft px-2 py-0.5 text-[11px] font-sans font-medium text-answer">
              流式输出中…
            </span>
          )}
          {step.ttftMs != null && <span>TTFT {step.ttftMs}ms</span>}
          {durationSec && <span>{durationSec}s</span>}
          {step.usage?.totalTokens != null && (
            <span>
              {step.usage.totalTokens.toLocaleString()} tok
              {step.usage.reasoningTokens ? ` (思 ${step.usage.reasoningTokens})` : ''}
            </span>
          )}
        </div>
      </div>

      {/* Collapsible Live Thinking Stream */}
      {step.thinkingText && (
        <div className="mt-2 border-t border-border-subtle pt-2">
          <button
            type="button"
            onClick={() => setThinkingOpen((v) => !v)}
            className="inline-flex items-center gap-1.5 text-xs font-medium text-text-secondary hover:text-text-primary"
          >
            {thinkingOpen ? (
              <ChevronDown className="h-3.5 w-3.5" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5" />
            )}
            <Brain className="h-3.5 w-3.5 text-accent" />
            <span>模型思考过程（{step.thinkingText.length} 字）</span>
          </button>
          {thinkingOpen && (
            <div className="mt-1.5 max-h-44 overflow-auto rounded-lg bg-surface p-2.5 font-mono text-xs leading-relaxed text-text-secondary whitespace-pre-wrap">
              {step.thinkingText}
            </div>
          )}
        </div>
      )}

      {/* Live streaming preview tail */}
      {step.status === 'streaming' && step.contentPreview && (
        <div className="mt-2 max-h-24 overflow-hidden rounded-lg bg-surface/70 px-2.5 py-1.5 font-mono text-[11px] text-text-muted whitespace-pre-wrap break-all">
          {step.contentPreview}
        </div>
      )}

      {/* Detailed error inspector */}
      {step.error && (
        <div className="mt-2.5">
          <ErrorDiagnosticCard error={step.error} compact />
        </div>
      )}
    </div>
  );
}

export function ExecutionTimeline() {
  const { activeTaskLabel, running, steps, abortTask, clearTask } = useTaskStore();

  if (!activeTaskLabel || steps.length === 0) return null;

  const doneCount = steps.filter((s) => s.status === 'done').length;

  return (
    <div className="island p-4 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2.5">
          {running ? (
            <Loader2 className="h-4 w-4 animate-spin text-accent" />
          ) : (
            <CheckCircle2 className="h-4 w-4 text-answer" />
          )}
          <h3 className="text-sm font-semibold text-text-primary">{activeTaskLabel}</h3>
          <span className="rounded-full bg-surface-subtle px-2 py-0.5 text-xs font-mono text-text-secondary">
            {doneCount}/{steps.length}
          </span>
        </div>

        <div className="flex items-center gap-2">
          {running ? (
            <button
              type="button"
              onClick={abortTask}
              className="inline-flex items-center gap-1 rounded-lg border border-danger/30 bg-danger-soft px-2.5 py-1 text-xs font-medium text-danger transition hover:opacity-90"
            >
              <Square className="h-3 w-3 fill-current" />
              中止任务
            </button>
          ) : (
            <button
              type="button"
              onClick={clearTask}
              className="rounded-lg px-2 py-1 text-xs text-text-muted hover:bg-surface-subtle hover:text-text-primary"
            >
              关闭面板
            </button>
          )}
        </div>
      </div>

      <div className="space-y-2">
        {steps.map((step) => (
          <StepItem key={step.id} step={step} />
        ))}
      </div>
    </div>
  );
}
