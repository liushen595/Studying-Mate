import { useState } from 'react';
import {
  AlertTriangle,
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  RefreshCw,
} from 'lucide-react';
import type { LLMErrorDetail } from '../../types/llm';

interface Props {
  error: LLMErrorDetail;
  onRetry?: () => void;
  compact?: boolean;
}

export function ErrorDiagnosticCard({ error, onRetry, compact = false }: Props) {
  const [showRaw, setShowRaw] = useState(false);
  const [copied, setCopied] = useState(false);

  const badgeText =
    error.kind === 'http'
      ? `HTTP ${error.status || 'Error'}${error.statusText ? ` ${error.statusText}` : ''}`
      : error.kind === 'network_cors'
        ? 'NETWORK / CORS'
        : error.kind === 'timeout'
          ? 'TIMEOUT'
          : error.kind === 'json_parse'
            ? 'JSON 解析失败'
            : error.kind === 'aborted'
              ? '已取消'
              : '参数校验未通过';

  const handleCopy = async () => {
    const report = JSON.stringify(error, null, 2);
    await navigator.clipboard.writeText(report);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  return (
    <div className="rounded-2xl border border-danger/30 bg-danger-soft/50 p-4 text-sm text-text-primary">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex items-start gap-2.5 min-w-0">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-danger" />
          <div className="min-w-0 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center rounded-md bg-danger/15 px-2 py-0.5 font-mono text-xs font-semibold text-danger">
                {badgeText}
              </span>
              {error.providerErrorCode && (
                <span className="rounded-md bg-surface/80 px-1.5 py-0.5 font-mono text-xs text-text-secondary">
                  code: {error.providerErrorCode}
                </span>
              )}
              {error.providerErrorType && (
                <span className="rounded-md bg-surface/80 px-1.5 py-0.5 font-mono text-xs text-text-secondary">
                  {error.providerErrorType}
                </span>
              )}
            </div>
            <p className="font-medium leading-relaxed break-words text-text-primary">
              {error.message}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            onClick={handleCopy}
            className="inline-flex items-center gap-1 rounded-lg border border-border-subtle bg-surface px-2.5 py-1 text-xs font-medium text-text-secondary transition hover:text-text-primary"
          >
            {copied ? <Check className="h-3.5 w-3.5 text-answer" /> : <Copy className="h-3.5 w-3.5" />}
            {copied ? '已复制' : '复制详情'}
          </button>
          {onRetry && (
            <button
              type="button"
              onClick={onRetry}
              className="inline-flex items-center gap-1 rounded-lg bg-accent px-2.5 py-1 text-xs font-medium text-white transition hover:opacity-90"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              重试
            </button>
          )}
        </div>
      </div>

      {error.hintZh && (
        <div className="mt-3 rounded-xl border border-border-subtle bg-surface/90 px-3 py-2 text-xs leading-relaxed text-text-secondary">
          <span className="font-semibold text-text-primary">排查建议：</span>
          {error.hintZh}
        </div>
      )}

      {!compact && (
        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 font-mono text-[11px] text-text-muted">
          <span>Model: {error.modelId}</span>
          <span className="truncate max-w-full">Endpoint: {error.endpoint}</span>
          {error.requestId && <span>Request-ID: {error.requestId}</span>}
          {error.providerErrorParam && <span>Param: {error.providerErrorParam}</span>}
        </div>
      )}

      {error.rawBody && (
        <div className="mt-2.5">
          <button
            type="button"
            onClick={() => setShowRaw((v) => !v)}
            className="inline-flex items-center gap-1 text-xs font-medium text-text-secondary hover:text-text-primary"
          >
            {showRaw ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
            {showRaw ? '收起供应商原始返回体' : '查看供应商原始返回体 (Raw Response)'}
          </button>
          {showRaw && (
            <pre className="mt-2 max-h-56 overflow-auto rounded-xl border border-border-subtle bg-surface p-3 font-mono text-xs leading-relaxed text-text-secondary whitespace-pre-wrap break-all">
              {error.rawBody}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}
