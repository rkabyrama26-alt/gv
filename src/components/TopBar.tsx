import React, { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Menu, Search, X } from 'lucide-react';
import type { AppLocale } from '../shared/types.ts';
import { getCopy } from '../utils/i18n.ts';
import { fetchSuggestions } from '../utils/api.ts';

interface TopBarProps {
  locale: AppLocale;
  searchInput: string;
  recentSearches: string[];
  isSidebarOpen: boolean;
  searchPlaceholder?: string;
  disableSuggestions?: boolean;
  onToggleSidebar: () => void;
  onSearchInputChange: (value: string) => void;
  onSubmitSearch: (query: string) => void;
  onClearSearch?: () => void;
  onGoHome: () => void;
}

export function TopBar({
  locale,
  searchInput,
  recentSearches,
  isSidebarOpen,
  searchPlaceholder,
  disableSuggestions = false,
  onToggleSidebar,
  onSearchInputChange,
  onSubmitSearch,
  onClearSearch,
  onGoHome,
}: TopBarProps) {
  const t = getCopy(locale);
  const effectivePlaceholder = searchPlaceholder || t.searchPlaceholder;
  const [searchOpen, setSearchOpen] = useState(false);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const BackIcon = locale === 'ar' ? ArrowRight : ArrowLeft;

  useEffect(() => {
    if (searchOpen) {
      inputRef.current?.focus();
    }
  }, [searchOpen]);

  useEffect(() => {
    const q = searchInput.trim();
    if (!q || disableSuggestions) {
      setSuggestions([]);
      return;
    }

    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const res = await fetchSuggestions(q, locale);
        if (!cancelled) {
          setSuggestions(res.suggestions);
        }
      } catch {
        if (!cancelled) setSuggestions([]);
      }
    }, 180);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [searchInput, locale, disableSuggestions]);

  useEffect(() => {
    const handleOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  }, []);

  const displayedItems = disableSuggestions
    ? []
    : searchInput.trim()
      ? suggestions
      : recentSearches;

  const handleFormSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const chosen =
      activeIndex >= 0 && displayedItems[activeIndex] ? displayedItems[activeIndex] : searchInput;
    if (!chosen.trim()) return;
    setDropdownOpen(false);
    setActiveIndex(-1);
    setSearchOpen(false);
    onSubmitSearch(chosen.trim());
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      setDropdownOpen(false);
      setActiveIndex(-1);
      setSearchOpen(false);
      return;
    }
    if (!dropdownOpen || displayedItems.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((prev) => (prev + 1) % displayedItems.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((prev) => (prev <= 0 ? displayedItems.length - 1 : prev - 1));
    }
  };

  return (
    <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/95 pt-[env(safe-area-inset-top)] text-slate-900 backdrop-blur-sm dark:border-slate-800 dark:bg-slate-950/95 dark:text-white">
      <div className="flex h-14 items-center justify-between gap-2 px-3 sm:h-16 sm:gap-4 sm:px-5 lg:px-6">
        {!searchOpen ? (
          <>
            <button
              type="button"
              onClick={onGoHome}
              aria-label={t.brand}
              data-testid="brand-logo-button"
              className="flex shrink-0 items-center bg-transparent py-1 focus-visible:outline-2 focus-visible:outline-red-600"
            >
              <img
                src="https://i.ibb.co/8n7Gv1Xp/image-c5368aaf-cutout.webp"
                alt={t.brand}
                className="h-11 w-auto max-w-[160px] object-contain sm:h-12"
              />
            </button>

            {/* Left-side controls in RTL: Search + mobile 3-lines menu */}
            <div className="flex shrink-0 items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  setSearchOpen(true);
                  setDropdownOpen(true);
                }}
                aria-label={t.openSearch}
                data-testid="open-search-button"
                className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-slate-50 text-slate-700 transition-colors hover:border-red-300 hover:bg-slate-100 hover:text-slate-900 focus-visible:outline-2 focus-visible:outline-red-600 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200 dark:hover:border-red-500/50 dark:hover:bg-slate-800 dark:hover:text-white"
              >
                <Search className="h-4 w-4" />
              </button>

              <button
                type="button"
                onClick={onToggleSidebar}
                aria-label={isSidebarOpen ? t.closeSidebar : t.openSidebar}
                aria-expanded={isSidebarOpen}
                className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-slate-700 transition-colors hover:bg-slate-100 hover:text-slate-900 focus-visible:outline-2 focus-visible:outline-red-600 dark:text-slate-200 dark:hover:bg-slate-800 dark:hover:text-white lg:hidden"
              >
                {isSidebarOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
              </button>
            </div>
          </>
        ) : (
          /* Expanded Search Input Mode */
          <div ref={containerRef} className="relative flex w-full items-center gap-2">
            <button
              type="button"
              onClick={() => {
                setSearchOpen(false);
                setDropdownOpen(false);
              }}
              aria-label={t.closeSearch}
              className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900 focus-visible:outline-2 focus-visible:outline-red-600 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white"
            >
              <BackIcon className="h-5 w-5" />
            </button>

            <form onSubmit={handleFormSubmit} role="search" className="flex min-w-0 flex-1 items-center">
              <div className="relative flex min-w-0 flex-1 items-center">
                <input
                  ref={inputRef}
                  type="search"
                  value={searchInput}
                  onFocus={() => setDropdownOpen(true)}
                  onChange={(e) => {
                    onSearchInputChange(e.target.value);
                    setDropdownOpen(true);
                    setActiveIndex(-1);
                  }}
                  onKeyDown={handleKeyDown}
                  placeholder={effectivePlaceholder}
                  aria-label={effectivePlaceholder}
                  className="h-10 w-full min-w-0 rounded-s-xl border border-slate-200 bg-slate-50 px-3 pe-8 text-sm text-slate-900 placeholder:text-slate-400 focus:border-red-500 focus:bg-white focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-white dark:focus:bg-slate-950 [&::-webkit-search-cancel-button]:appearance-none"
                />
                {searchInput && (
                  <button
                    type="button"
                    onClick={() => {
                      if (onClearSearch) {
                        onClearSearch();
                      } else {
                        onSearchInputChange('');
                      }
                      setSuggestions([]);
                      inputRef.current?.focus();
                    }}
                    aria-label={t.clearSearch}
                    className="absolute end-1.5 inline-flex h-7 w-7 items-center justify-center rounded-md text-slate-400 hover:text-slate-700 dark:hover:text-white"
                  >
                    <X className="h-4 w-4" />
                  </button>
                )}
              </div>
              <button
                type="submit"
                aria-label={t.searchButton}
                className="inline-flex h-10 shrink-0 items-center gap-2 whitespace-nowrap rounded-e-xl border border-s-0 border-red-600 bg-red-600 px-3.5 text-sm font-medium text-white transition-colors hover:bg-red-700 focus-visible:outline-2 focus-visible:outline-red-500 sm:px-4"
              >
                <Search className="h-4 w-4" />
                <span className="hidden sm:inline">{t.searchButton}</span>
              </button>
            </form>

            {dropdownOpen && displayedItems.length > 0 && (
              <ul
                role="listbox"
                aria-label={t.searchButton}
                className="absolute inset-x-0 top-12 z-40 overflow-hidden rounded-xl border border-slate-200 bg-white py-1 shadow-lg dark:border-slate-700 dark:bg-slate-900"
              >
                {displayedItems.map((item, idx) => (
                  <li key={item}>
                    <button
                      type="button"
                      role="option"
                      aria-selected={idx === activeIndex}
                      onClick={() => {
                        onSearchInputChange(item);
                        setDropdownOpen(false);
                        setSearchOpen(false);
                        onSubmitSearch(item);
                      }}
                      className={`flex w-full items-center gap-3 px-4 py-2 text-start text-sm transition-colors ${
                        idx === activeIndex
                          ? 'bg-slate-100 text-slate-900 dark:bg-slate-800 dark:text-white'
                          : 'text-slate-700 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-slate-800/70'
                      }`}
                    >
                      <Search className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                      <span className="truncate">{item}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </header>
  );
}
