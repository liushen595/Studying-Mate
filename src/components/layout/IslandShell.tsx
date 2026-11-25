import { useEffect, useState } from 'react';
import { Link, NavLink, useLocation } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  BookOpen,
  BookMarked,
  FilePlus2,
  FolderOpen,
  Menu,
  Monitor,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  Settings,
  Sun,
  X,
} from 'lucide-react';
import { db } from '../../lib/db';
import { useSettingsStore, type ThemeMode } from '../../stores/useSettingsStore';

export function IslandShell({ children }: { children: React.ReactNode }) {
  const { theme, setTheme, sidebarCollapsed, toggleSidebar, getAnalysisProvider } =
    useSettingsStore();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const location = useLocation();

  const recentPapers = useLiveQuery(
    () => db.papers.orderBy('updatedAt').reverse().limit(12).toArray(),
    [],
  );

  // Apply system/light/dark theme cleanly
  useEffect(() => {
    const root = document.documentElement;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');

    const apply = () => {
      const isDark = theme === 'dark' || (theme === 'system' && mq.matches);
      root.classList.toggle('dark', isDark);
    };

    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, [theme]);

  useEffect(() => {
    setMobileMenuOpen(false);
  }, [location.pathname, location.search]);

  const activeProvider = getAnalysisProvider();
  const hasApiKey = Boolean(activeProvider?.apiKey.trim());

  const cycleTheme = () => {
    const order: ThemeMode[] = ['system', 'light', 'dark'];
    const next = order[(order.indexOf(theme) + 1) % order.length];
    setTheme(next);
  };

  const ThemeIcon = theme === 'dark' ? Moon : theme === 'light' ? Sun : Monitor;
  const themeLabel = theme === 'dark' ? '深色' : theme === 'light' ? '浅色' : '跟随系统';

  const sidebarContent = (
    <div className="flex h-full flex-col justify-between p-3.5">
      <div className="space-y-4 overflow-y-auto pr-0.5">
        {/* Brand */}
        <div className="flex items-center justify-between px-1">
          <Link to="/" className="flex items-center gap-2.5 group">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-accent text-white shadow-sm">
              <BookOpen className="h-4.5 w-4.5" />
            </div>
            {!sidebarCollapsed && (
              <div className="leading-tight">
                <div className="text-sm font-semibold tracking-tight text-text-primary">
                  Studying-Mate
                </div>
                <div className="text-[11px] text-text-muted">考研英语 AI 精读</div>
              </div>
            )}
          </Link>

          <button
            type="button"
            onClick={toggleSidebar}
            title={sidebarCollapsed ? '展开侧栏' : '收起侧栏'}
            className="hidden lg:inline-flex h-8 w-8 items-center justify-center rounded-lg text-text-muted transition hover:bg-surface-subtle hover:text-text-primary"
          >
            {sidebarCollapsed ? (
              <PanelLeftOpen className="h-4 w-4" />
            ) : (
              <PanelLeftClose className="h-4 w-4" />
            )}
          </button>
        </div>

        {/* Primary CTA */}
        <Link
          to="/import"
          className={`flex items-center justify-center gap-2 rounded-xl bg-accent px-3 py-2.5 text-sm font-medium text-white shadow-xs transition hover:opacity-92 ${
            sidebarCollapsed ? 'px-0' : ''
          }`}
          title="导入新试卷"
        >
          <FilePlus2 className="h-4 w-4 shrink-0" />
          {!sidebarCollapsed && <span>导入新试卷</span>}
        </Link>

        {/* Primary Navigation */}
        <nav className="space-y-1">
          <NavLink
            to="/"
            end
            className={({ isActive }) =>
              `flex items-center gap-2.5 rounded-xl px-3 py-2 text-sm font-medium transition ${
                isActive
                  ? 'bg-accent-soft text-accent'
                  : 'text-text-secondary hover:bg-surface-subtle hover:text-text-primary'
              }`
            }
          >
            <FolderOpen className="h-4 w-4 shrink-0" />
            {!sidebarCollapsed && <span>我的试卷库</span>}
          </NavLink>

          <NavLink
            to="/vocab"
            className={({ isActive }) =>
              `flex items-center gap-2.5 rounded-xl px-3 py-2 text-sm font-medium transition ${
                isActive
                  ? 'bg-accent-soft text-accent'
                  : 'text-text-secondary hover:bg-surface-subtle hover:text-text-primary'
              }`
            }
          >
            <BookMarked className="h-4 w-4 shrink-0" />
            {!sidebarCollapsed && <span>全部生词本</span>}
          </NavLink>
        </nav>

        {/* Recent Papers */}
        {!sidebarCollapsed && recentPapers && recentPapers.length > 0 && (
          <div className="pt-2">
            <div className="mb-1.5 px-3 text-[11px] font-medium uppercase tracking-wider text-text-muted">
              最近精读
            </div>
            <div className="space-y-0.5">
              {recentPapers.map((paper) => (
                <NavLink
                  key={paper.id}
                  to={`/paper/${paper.id}`}
                  className={({ isActive }) =>
                    `flex items-center justify-between gap-2 rounded-xl px-3 py-1.5 text-xs transition ${
                      isActive
                        ? 'bg-surface-subtle font-medium text-text-primary'
                        : 'text-text-secondary hover:bg-surface-subtle/70 hover:text-text-primary'
                    }`
                  }
                >
                  <span className="truncate">{paper.title}</span>
                  <span
                    className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                      paper.status === 'completed'
                        ? 'bg-answer'
                        : paper.status === 'ocr_draft'
                          ? 'bg-vocab'
                          : paper.status === 'partial_error'
                            ? 'bg-danger'
                            : 'bg-accent animate-pulse'
                    }`}
                  />
                </NavLink>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Bottom Controls */}
      <div className="space-y-1.5 border-t border-border-subtle pt-3">
        <NavLink
          to="/settings"
          className={({ isActive }) =>
            `flex items-center justify-between gap-2 rounded-xl px-3 py-2 text-sm font-medium transition ${
              isActive
                ? 'bg-accent-soft text-accent'
                : 'text-text-secondary hover:bg-surface-subtle hover:text-text-primary'
            }`
          }
          title="设置"
        >
          <span className="flex items-center gap-2.5 min-w-0">
            <Settings className="h-4 w-4 shrink-0" />
            {!sidebarCollapsed && <span className="truncate">设置</span>}
          </span>
          {!sidebarCollapsed && (
            <span
              className={`h-2 w-2 shrink-0 rounded-full ${
                hasApiKey ? 'bg-answer' : 'bg-vocab'
              }`}
              title={hasApiKey ? `当前：${activeProvider.modelId}` : '尚未配置 API Key'}
            />
          )}
        </NavLink>

        <button
          type="button"
          onClick={cycleTheme}
          title={`切换主题（当前：${themeLabel}）`}
          className="flex w-full items-center justify-between gap-2 rounded-xl px-3 py-2 text-sm font-medium text-text-secondary transition hover:bg-surface-subtle hover:text-text-primary"
        >
          <span className="flex items-center gap-2.5">
            <ThemeIcon className="h-4 w-4 shrink-0" />
            {!sidebarCollapsed && <span>外观 · {themeLabel}</span>}
          </span>
        </button>
      </div>
    </div>
  );

  return (
    <div className="print-root-shell min-h-screen bg-canvas text-text-primary">
      {/* Mobile Topbar */}
      <header className="no-print sticky top-0 z-30 flex items-center justify-between border-b border-border-subtle bg-surface/90 px-4 py-3 backdrop-blur-md lg:hidden">
        <Link to="/" className="flex items-center gap-2 font-semibold text-sm">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-accent text-white">
            <BookOpen className="h-4 w-4" />
          </div>
          Studying-Mate
        </Link>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={cycleTheme}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-text-secondary hover:bg-surface-subtle"
            aria-label="切换主题"
          >
            <ThemeIcon className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => setMobileMenuOpen((v) => !v)}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-text-secondary hover:bg-surface-subtle"
            aria-label="菜单"
          >
            {mobileMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>
      </header>

      {/* Mobile Drawer */}
      {mobileMenuOpen && (
        <div className="no-print fixed inset-0 z-40 flex lg:hidden">
          <div
            className="fixed inset-0 bg-black/40 backdrop-blur-xs"
            onClick={() => setMobileMenuOpen(false)}
          />
          <aside className="relative z-50 m-3 w-64 island overflow-hidden">
            {sidebarContent}
          </aside>
        </div>
      )}

      {/* Desktop Island Layout */}
      <div className="print-block-root mx-auto flex max-w-[1600px] gap-4 p-3 sm:p-4">
        <aside
          className={`no-print hidden lg:block shrink-0 sticky top-4 h-[calc(100vh-2rem)] island transition-all duration-200 ${
            sidebarCollapsed ? 'w-[68px]' : 'w-[252px]'
          }`}
        >
          {sidebarContent}
        </aside>

        <main className="min-w-0 flex-1 print-container">{children}</main>
      </div>
    </div>
  );
}
