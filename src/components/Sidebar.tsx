import React, { useState } from 'react';
import {
  BellRing,
  Bookmark,
  ChevronDown,
  Compass,
  Globe,
  History,
  Moon,
  Search,
  Server,
  Sun,
  Video,
  X,
} from 'lucide-react';
import type { AppLocale, XtreamServerId } from '../shared/types.ts';
import { getCopy } from '../utils/i18n.ts';

export type ActiveView =
  | 'discover'
  | 'series'
  | 'subscriptions'
  | 'search'
  | 'watch'
  | 'channel'
  | 'saved'
  | 'history';

interface SidebarProps {
  locale: AppLocale;
  theme: 'light' | 'dark';
  activeView: ActiveView;
  xtreamServer: XtreamServerId;
  subscriptionsCount: number;
  savedCount: number;
  historyCount: number;
  recentSearches: string[];
  isOpenMobile: boolean;
  onCloseMobile: () => void;
  onSelectView: (view: ActiveView) => void;
  onSelectXtreamServer: (serverId: XtreamServerId) => void;
  onQuickSearch: (query: string) => void;
  onToggleLocale: () => void;
  onToggleTheme: () => void;
}

export function Sidebar({
  locale,
  theme,
  activeView,
  xtreamServer,
  subscriptionsCount,
  savedCount,
  historyCount,
  recentSearches,
  isOpenMobile,
  onCloseMobile,
  onSelectView,
  onSelectXtreamServer,
  onQuickSearch,
  onToggleLocale,
  onToggleTheme,
}: SidebarProps) {
  const t = getCopy(locale);
  const [serversMenuOpen, setServersMenuOpen] = useState(activeView === 'series');

  const navItems: Array<{
    id: ActiveView;
    label: string;
    icon: React.ComponentType<{ className?: string }>;
    count?: number;
  }> = [
    { id: 'discover', label: t.navDiscover, icon: Compass },
    { id: 'series', label: t.navSeries, icon: Video },
    { id: 'subscriptions', label: t.navSubscriptions, icon: BellRing, count: subscriptionsCount },
    { id: 'search', label: t.navSearch, icon: Search },
    { id: 'saved', label: t.navSaved, icon: Bookmark, count: savedCount },
    { id: 'history', label: t.navHistory, icon: History, count: historyCount },
  ];

  const navContent = (
    <div className="flex h-full flex-col justify-between gap-3 p-2.5 lg:gap-6 lg:p-4">
      <div className="space-y-3 lg:space-y-6">
        <nav aria-label="Main navigation" className="space-y-0.5 lg:space-y-1">
          {navItems.map((item) => {
            const Icon = item.icon;
            const active = activeView === item.id;
            if (item.id === 'series') {
              return (
                <div key={item.id} className="space-y-1">
                  <button
                    type="button"
                    data-testid="sidebar-series-toggle"
                    aria-expanded={serversMenuOpen}
                    aria-current={active ? 'page' : undefined}
                    onClick={() => setServersMenuOpen((prev) => !prev)}
                    className={`flex h-9 w-full items-center justify-between gap-2.5 rounded-xl px-2.5 text-[13px] font-medium whitespace-nowrap transition-colors focus-visible:outline-2 focus-visible:outline-red-600 lg:h-11 lg:gap-3 lg:px-3 lg:text-sm ${
                      active
                        ? 'bg-red-600 text-white'
                        : 'text-slate-700 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white'
                    }`}
                  >
                    <span className="flex items-center gap-2.5 lg:gap-3">
                      <Icon className="h-4 w-4 shrink-0" />
                      <span>{item.label}</span>
                    </span>
                    <ChevronDown
                      className={`h-4 w-4 shrink-0 transition-transform duration-150 ${
                        serversMenuOpen ? 'rotate-180' : ''
                      }`}
                    />
                  </button>

                  {serversMenuOpen && (
                    <div
                      data-testid="sidebar-xtream-servers"
                      className="space-y-1 border-s-2 border-slate-200 ps-3 ms-3 dark:border-slate-800"
                    >
                      {(
                        [
                          { id: '1' as XtreamServerId, label: t.xtreamServer1 },
                          { id: '2' as XtreamServerId, label: t.xtreamServer2 },
                        ] as const
                      ).map((srv) => {
                        const isSrvActive = activeView === 'series' && xtreamServer === srv.id;
                        return (
                          <button
                            key={srv.id}
                            type="button"
                            data-testid={`xtream-server-${srv.id}-button`}
                            onClick={() => {
                              onSelectXtreamServer(srv.id);
                              onCloseMobile();
                            }}
                            className={`flex h-8 w-full items-center gap-2 rounded-lg px-2.5 text-xs font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-red-600 lg:h-9 ${
                              isSrvActive
                                ? 'bg-red-50 text-red-600 dark:bg-red-950/50 dark:text-red-400'
                                : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white'
                            }`}
                          >
                            <Server className="h-3.5 w-3.5 shrink-0" />
                            <span>{srv.label}</span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            }

            return (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  onSelectView(item.id);
                  onCloseMobile();
                }}
                aria-current={active ? 'page' : undefined}
                className={`flex h-9 w-full items-center justify-between gap-2.5 rounded-xl px-2.5 text-[13px] font-medium whitespace-nowrap transition-colors focus-visible:outline-2 focus-visible:outline-red-600 lg:h-11 lg:gap-3 lg:px-3 lg:text-sm ${
                  active
                    ? 'bg-red-600 text-white'
                    : 'text-slate-700 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white'
                }`}
              >
                <span className="flex items-center gap-2.5 lg:gap-3">
                  <Icon className="h-4 w-4 shrink-0" />
                  <span>{item.label}</span>
                </span>
                {typeof item.count === 'number' && item.count > 0 && (
                  <span
                    className={`tabular-nums text-xs ${
                      active ? 'text-white/90' : 'text-slate-500 dark:text-slate-400'
                    }`}
                  >
                    {item.count}
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        {recentSearches.length > 0 && (
          <div className="border-t border-slate-200 pt-2.5 lg:pt-4 dark:border-slate-800">
            <h2 className="mb-1.5 px-2.5 text-[11px] font-semibold text-slate-500 lg:mb-2 lg:px-3 lg:text-xs dark:text-slate-400">
              {locale === 'ar' ? 'عمليات بحث سابقة' : 'Recent Searches'}
            </h2>
            <div className="space-y-0.5 lg:space-y-1">
              {recentSearches.slice(0, 5).map((q) => (
                <button
                  key={q}
                  type="button"
                  onClick={() => {
                    onQuickSearch(q);
                    onCloseMobile();
                  }}
                  className="flex h-8 w-full items-center gap-2 rounded-lg px-2.5 text-start text-xs text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900 lg:h-9 lg:gap-2.5 lg:px-3 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100"
                >
                  <Search className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                  <span className="truncate">{q}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Language & Theme / Color controls inside the 3-lines menu */}
      <div className="space-y-1.5 border-t border-slate-200 pt-2.5 lg:space-y-2 lg:pt-4 dark:border-slate-800">
        <p className="px-2.5 text-[11px] font-semibold text-slate-500 lg:px-3 lg:text-xs dark:text-slate-400">
          {t.appearanceLabel}
        </p>

        <button
          type="button"
          onClick={onToggleLocale}
          aria-label={t.toggleLang}
          className="flex h-9 w-full items-center justify-between gap-2.5 rounded-xl border border-slate-200 bg-slate-50 px-2.5 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-red-600 lg:h-10 lg:gap-3 lg:px-3 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
        >
          <span className="flex items-center gap-2 lg:gap-2.5">
            <Globe className="h-4 w-4 shrink-0 text-slate-500 dark:text-slate-400" />
            <span>{t.languageLabel}</span>
          </span>
        </button>

        <button
          type="button"
          onClick={onToggleTheme}
          aria-label={t.toggleTheme}
          className="flex h-9 w-full items-center justify-between gap-2.5 rounded-xl border border-slate-200 bg-slate-50 px-2.5 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-red-600 lg:h-10 lg:gap-3 lg:px-3 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
        >
          <span className="flex items-center gap-2 lg:gap-2.5">
            {theme === 'dark' ? (
              <Sun className="h-4 w-4 shrink-0 text-amber-400" />
            ) : (
              <Moon className="h-4 w-4 shrink-0 text-slate-500" />
            )}
            <span>{theme === 'dark' ? t.lightModeLabel : t.darkModeLabel}</span>
          </span>
        </button>
      </div>
    </div>
  );

  return (
    <>
      <aside className="hidden w-60 shrink-0 border-e border-slate-200 bg-white lg:block dark:border-slate-800 dark:bg-slate-950">
        <div className="sticky top-16 h-[calc(100vh-4rem)] overflow-y-auto">{navContent}</div>
      </aside>

      {isOpenMobile && (
        <div className="fixed inset-0 z-50 flex lg:hidden">
          <button
            type="button"
            aria-label={t.closeSidebar}
            onClick={onCloseMobile}
            className="fixed inset-0 bg-slate-950/50 backdrop-blur-xs"
          />
          <aside
            data-testid="mobile-sidebar-drawer"
            className="relative z-10 flex h-full w-56 max-w-[65vw] flex-col bg-white pt-[env(safe-area-inset-top)] shadow-xl dark:bg-slate-950"
          >
            <div className="flex h-14 items-center justify-between border-b border-slate-200 bg-white px-3 text-slate-900 dark:border-slate-800 dark:bg-slate-950 dark:text-white">
              <div className="flex items-center">
                <img
                  src="https://i.ibb.co/8n7Gv1Xp/image-c5368aaf-cutout.webp"
                  alt={t.brand}
                  className="h-10 w-auto max-w-[130px] object-contain"
                />
              </div>
              <button
                type="button"
                onClick={onCloseMobile}
                aria-label={t.closeSidebar}
                className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto">{navContent}</div>
          </aside>
        </div>
      )}
    </>
  );
}
