import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  BellRing,
  Bookmark,
  Clapperboard,
  Compass,
  History,
  RefreshCw,
  Search,
  Trash2,
} from 'lucide-react';
import type {
  AppLocale,
  ChannelResponse,
  DurationFilter,
  MediaVideo,
  SearchResponse,
  SearchType,
  SortOrder,
  SubscribedChannel,
  TrendingCategory,
  VideoDetailsResponse,
  XtreamServerId,
  XtreamTab,
} from './shared/types.ts';
import { extractDirectVideoUrlId } from './server/mediaParser.ts';
import {
  fetchChannelDetails,
  fetchSearch,
  fetchTrending,
  fetchVideoDetails,
} from './utils/api.ts';
import { getCopy } from './utils/i18n.ts';
import { loadYouTubeIframeApi } from './utils/youtubeIframeLoader.ts';
import {
  clearWatchHistory,
  loadRecentSearches,
  loadSavedVideos,
  loadSubscriptions,
  loadWatchHistory,
  loadXtreamServer,
  pushRecentSearch,
  pushWatchHistory,
  saveXtreamServer,
  toggleChannelSubscription,
  toggleSavedVideo,
} from './utils/storage.ts';
import { TopBar } from './components/TopBar.tsx';
import { Sidebar, type ActiveView } from './components/Sidebar.tsx';
import { VideoCard } from './components/VideoCard.tsx';
import { VideoWatchView } from './components/VideoWatchView.tsx';
import { ChannelView } from './components/ChannelView.tsx';
import { SeriesView } from './components/SeriesView.tsx';

const CATEGORIES: TrendingCategory[] = ['all', 'tech', 'music', 'gaming', 'education', 'news'];

export default function App() {
  const [locale, setLocale] = useState<AppLocale>('ar');
  const [theme, setTheme] = useState<'light' | 'dark'>('light');
  const [activeView, setActiveView] = useState<ActiveView>('discover');
  const [previousView, setPreviousView] = useState<ActiveView>('discover');
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // Discover / All feed state
  const [category, setCategory] = useState<TrendingCategory>('all');
  const [trendingItems, setTrendingItems] = useState<MediaVideo[]>([]);
  const [trendingLoading, setTrendingLoading] = useState(true);
  const [trendingError, setTrendingError] = useState<string | null>(null);

  // Search state
  const [searchInput, setSearchInput] = useState('');
  const [activeQuery, setActiveQuery] = useState('');
  const [sortOrder, setSortOrder] = useState<SortOrder>('relevance');
  const [searchType, setSearchType] = useState<SearchType>('all');
  const [durationFilter, setDurationFilter] = useState<DurationFilter>('any');
  const [searchResult, setSearchResult] = useState<SearchResponse | null>(null);
  const [searchLoading, setSearchLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  // Watch state
  const [selectedVideo, setSelectedVideo] = useState<MediaVideo | null>(null);
  const [videoDetails, setVideoDetails] = useState<VideoDetailsResponse | null>(null);
  const [videoLoading, setVideoLoading] = useState(false);
  const [videoError, setVideoError] = useState<string | null>(null);

  // Channel state
  const [channelData, setChannelData] = useState<ChannelResponse | null>(null);
  const [channelLoading, setChannelLoading] = useState(false);
  const [channelError, setChannelError] = useState<string | null>(null);

  // Series & Movies (Xtream) state (persisted across restarts)
  const [xtreamServer, setXtreamServer] = useState<XtreamServerId>(() => loadXtreamServer());
  const [seriesTab, setSeriesTab] = useState<XtreamTab>('series');
  const [seriesCategoryId, setSeriesCategoryId] = useState<string>('all');
  const [seriesQueryInput, setSeriesQueryInput] = useState<string>('');
  const [seriesQuery, setSeriesQuery] = useState<string>('');
  const [selectedSeriesId, setSelectedSeriesId] = useState<string | null>(null);

  // Persisted user collections
  const [subscriptions, setSubscriptions] = useState<SubscribedChannel[]>(() => loadSubscriptions());
  const [savedVideos, setSavedVideos] = useState<MediaVideo[]>(() => loadSavedVideos());
  const [watchHistory, setWatchHistory] = useState<MediaVideo[]>(() => loadWatchHistory());
  const [recentSearches, setRecentSearches] = useState<string[]>(() => loadRecentSearches());

  const t = getCopy(locale);

  const savedIds = useMemo(() => new Set(savedVideos.map((v) => v.id)), [savedVideos]);
  const subscribedIds = useMemo(() => new Set(subscriptions.map((c) => c.id)), [subscriptions]);

  useEffect(() => {
    document.documentElement.lang = locale;
    document.documentElement.dir = locale === 'ar' ? 'rtl' : 'ltr';
  }, [locale]);

  useEffect(() => {
    if (theme === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [theme]);

  useEffect(() => {
    void loadYouTubeIframeApi().catch(() => {});
  }, []);

  const loadTrending = useCallback(async (cat: TrendingCategory, hl: AppLocale, refresh = false) => {
    setTrendingLoading(true);
    setTrendingError(null);
    try {
      const seed = refresh ? Date.now() : undefined;
      const data = await fetchTrending(cat, hl, refresh, seed);
      setTrendingItems(data.items);
    } catch (err) {
      setTrendingError(err instanceof Error ? err.message : 'Failed to load trending feed');
    } finally {
      setTrendingLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadTrending(category, locale, true);
  }, [category, locale, loadTrending]);

  const executeSearch = useCallback(
    async (
      query: string,
      opts?: { sort?: SortOrder; type?: SearchType; duration?: DurationFilter },
    ) => {
      const clean = query.trim();
      if (!clean) return;

      const directId = extractDirectVideoUrlId(clean);
      if (directId) {
        const placeholder: MediaVideo = {
          id: directId,
          title: clean,
          channelName: locale === 'ar' ? 'مربع الدراما' : 'Drama Square',
          channelId: '',
          thumbnail: '',
          duration: '0:00',
          durationSeconds: 0,
          isLive: false,
          isShort: false,
          viewsText: '',
          viewsCount: null,
          publishedText: '',
          streamUrl: `/api/videos/item/${encodeURIComponent(directId)}/stream.m3u8`,
          sourceType: 'video',
        };
        setPreviousView(activeView === 'watch' ? previousView : activeView);
        setSelectedVideo(placeholder);
        setActiveView('watch');
        setVideoLoading(true);
        setVideoError(null);
        try {
          const details = await fetchVideoDetails(directId, locale);
          if (details) {
            setVideoDetails(details);
            setSelectedVideo(details.video);
            setWatchHistory((prev) => pushWatchHistory(prev, details.video));
          }
        } catch (err) {
          setVideoError(err instanceof Error ? err.message : 'Failed to load video');
        } finally {
          setVideoLoading(false);
        }
        return;
      }

      const sort = opts?.sort ?? sortOrder;
      const type = opts?.type ?? searchType;
      const duration = opts?.duration ?? durationFilter;

      setActiveQuery(clean);
      setActiveView('search');
      setSearchLoading(true);
      setSearchError(null);
      setRecentSearches((prev) => pushRecentSearch(prev, clean));

      try {
        const data = await fetchSearch({
          query: clean,
          sort,
          type,
          duration,
          hl: locale,
        });
        setSearchResult(data);
      } catch (err) {
        setSearchError(err instanceof Error ? err.message : 'Search failed');
      } finally {
        setSearchLoading(false);
      }
    },
    [activeView, durationFilter, locale, previousView, searchType, sortOrder],
  );

  const handleLoadMoreSearch = async () => {
    if (!searchResult?.continuation || loadingMore) return;
    setLoadingMore(true);
    try {
      const more = await fetchSearch({
        query: activeQuery,
        sort: sortOrder,
        type: searchType,
        duration: durationFilter,
        continuation: searchResult.continuation,
        hl: locale,
      });
      setSearchResult((prev) => {
        if (!prev) return more;
        const existingIds = new Set(prev.items.map((i) => i.id));
        const merged = [...prev.items, ...more.items.filter((i) => !existingIds.has(i.id))];
        return {
          ...prev,
          items: merged,
          continuation: more.continuation,
        };
      });
    } catch {
      // keep existing results
    } finally {
      setLoadingMore(false);
    }
  };

  const handleWatchXtreamMedia = (
    video: MediaVideo,
    related: MediaVideo[],
    description?: string,
  ) => {
    if (activeView !== 'watch') {
      setPreviousView(activeView);
    }
    setSelectedVideo(video);
    setVideoDetails({
      video: {
        ...video,
        description: description || video.descriptionSnippet || video.title,
        subscribersText: '',
      },
      related,
      comments: [],
      source: 'media-server',
    });
    setVideoLoading(false);
    setVideoError(null);
    setActiveView('watch');
    setWatchHistory((prev) => pushWatchHistory(prev, video));
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleUpdateXtreamMediaDetails = useCallback(
    (videoId: string, durationSeconds?: number, description?: string) => {
      setSelectedVideo((prev) => {
        if (!prev || prev.id !== videoId) return prev;
        return {
          ...prev,
          durationSeconds:
            durationSeconds && durationSeconds > 0 ? durationSeconds : prev.durationSeconds,
          descriptionSnippet: description || prev.descriptionSnippet,
        };
      });
      setVideoDetails((prev) => {
        if (!prev || prev.video.id !== videoId) return prev;
        return {
          ...prev,
          video: {
            ...prev.video,
            durationSeconds:
              durationSeconds && durationSeconds > 0 ? durationSeconds : prev.video.durationSeconds,
            description: description || prev.video.description,
          },
        };
      });
    },
    [],
  );

  const handleWatchVideo = async (video: MediaVideo) => {
    if (video.streamUrl.startsWith('/api/xtream/')) {
      const siblingList = selectedVideo && videoDetails?.related
        ? [
            selectedVideo,
            ...videoDetails.related.filter((item) => item.id !== video.id),
          ].filter((item) => item.id !== video.id && item.streamUrl.startsWith('/api/xtream/'))
        : [];
      handleWatchXtreamMedia(video, siblingList, video.descriptionSnippet || video.title);
      return;
    }

    if (activeView !== 'watch') {
      setPreviousView(activeView);
    }
    setSelectedVideo(video);
    setVideoDetails(null);
    setActiveView('watch');
    setVideoError(null);
    setWatchHistory((prev) => pushWatchHistory(prev, video));
    window.scrollTo({ top: 0, behavior: 'smooth' });

    setVideoLoading(true);
    try {
      const details = await fetchVideoDetails(video.id, locale);
      if (details) {
        setVideoDetails(details);
        setSelectedVideo({
          ...video,
          ...details.video,
          duration: video.duration !== '0:00' ? video.duration : details.video.duration,
        });
      }
    } catch (err) {
      setVideoError(err instanceof Error ? err.message : 'Failed to load video details');
    } finally {
      setVideoLoading(false);
    }
  };

  const handleOpenChannel = async (channelId: string) => {
    if (!channelId) return;
    if (activeView !== 'channel') {
      setPreviousView(activeView);
    }
    setChannelData(null);
    setChannelError(null);
    setChannelLoading(true);
    setActiveView('channel');
    window.scrollTo({ top: 0, behavior: 'smooth' });

    try {
      const data = await fetchChannelDetails(channelId, locale);
      setChannelData(data);
    } catch (err) {
      setChannelError(err instanceof Error ? err.message : 'Failed to load channel');
    } finally {
      setChannelLoading(false);
    }
  };

  const handleToggleSave = (video: MediaVideo) => {
    setSavedVideos((prev) => toggleSavedVideo(prev, video));
  };

  const handleToggleSubscribe = (channel: {
    id: string;
    name: string;
    avatar?: string;
    subscribersText?: string;
  }) => {
    setSubscriptions((prev) => toggleChannelSubscription(prev, channel));
  };

  const renderFullWidthSkeleton = () => (
    <div className="flex flex-col gap-7 sm:gap-8">
      {Array.from({ length: 4 }).map((_, idx) => (
        <div
          key={idx}
          className="overflow-hidden border border-slate-200 bg-white sm:rounded-2xl dark:border-slate-800 dark:bg-slate-900"
        >
          <div className="aspect-video max-h-[480px] w-full animate-pulse bg-slate-200 dark:bg-slate-800" />
          <div className="space-y-3 p-4 sm:p-5">
            <div className="h-5 w-4/5 animate-pulse rounded bg-slate-200 dark:bg-slate-800" />
            <div className="h-4 w-1/2 animate-pulse rounded bg-slate-200 dark:bg-slate-800" />
          </div>
        </div>
      ))}
    </div>
  );

  const renderSkeletonGrid = () => (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {Array.from({ length: 8 }).map((_, idx) => (
        <div
          key={idx}
          className="overflow-hidden rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900"
        >
          <div className="aspect-video w-full animate-pulse bg-slate-200 dark:bg-slate-800" />
          <div className="space-y-2.5 p-4">
            <div className="h-4 w-5/6 animate-pulse rounded bg-slate-200 dark:bg-slate-800" />
            <div className="h-3.5 w-1/2 animate-pulse rounded bg-slate-200 dark:bg-slate-800" />
          </div>
        </div>
      ))}
    </div>
  );

  const mobileBottomTabs: Array<{
    id: ActiveView;
    label: string;
    icon: React.ComponentType<{ className?: string }>;
    badge?: number;
  }> = [
    { id: 'discover', label: t.navDiscover, icon: Compass },
    { id: 'series', label: t.navSeries, icon: Clapperboard },
    { id: 'subscriptions', label: t.navSubscriptions, icon: BellRing, badge: subscriptions.length },
    { id: 'saved', label: t.navSaved, icon: Bookmark, badge: savedVideos.length },
  ];

  const isSeriesSearchMode = activeView === 'series';

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      <TopBar
        locale={locale}
        searchInput={isSeriesSearchMode ? seriesQueryInput : searchInput}
        recentSearches={recentSearches}
        isSidebarOpen={sidebarOpen}
        searchPlaceholder={isSeriesSearchMode ? t.seriesSearchPlaceholder : t.searchPlaceholder}
        disableSuggestions={isSeriesSearchMode}
        onToggleSidebar={() => setSidebarOpen((v) => !v)}
        onSearchInputChange={(val) => {
          if (isSeriesSearchMode) {
            setSeriesQueryInput(val);
            if (!val.trim()) {
              setSeriesQuery('');
            }
          } else {
            setSearchInput(val);
          }
        }}
        onSubmitSearch={(q) => {
          if (isSeriesSearchMode) {
            setSelectedSeriesId(null);
            setSeriesQueryInput(q);
            setSeriesQuery(q);
          } else {
            void executeSearch(q);
          }
        }}
        onClearSearch={() => {
          if (isSeriesSearchMode) {
            setSeriesQueryInput('');
            setSeriesQuery('');
          } else {
            setSearchInput('');
          }
        }}
        onGoHome={() => {
          setActiveView('discover');
          void loadTrending(category, locale, true);
        }}
      />

      <div className="flex">
        <Sidebar
          locale={locale}
          theme={theme}
          activeView={activeView}
          xtreamServer={xtreamServer}
          subscriptionsCount={subscriptions.length}
          savedCount={savedVideos.length}
          historyCount={watchHistory.length}
          recentSearches={recentSearches}
          isOpenMobile={sidebarOpen}
          onCloseMobile={() => setSidebarOpen(false)}
          onSelectView={(view) => {
            setActiveView(view);
            if (view === 'discover') {
              void loadTrending(category, locale, true);
            }
          }}
          onSelectXtreamServer={(nextServer) => {
            saveXtreamServer(nextServer);
            if (nextServer !== xtreamServer) {
              setXtreamServer(nextServer);
              setSeriesCategoryId('all');
              setSeriesQueryInput('');
              setSeriesQuery('');
              setSelectedSeriesId(null);
            }
            setActiveView('series');
          }}
          onQuickSearch={(q) => {
            setSearchInput(q);
            void executeSearch(q);
          }}
          onToggleLocale={() => setLocale((l) => (l === 'ar' ? 'en' : 'ar'))}
          onToggleTheme={() => setTheme((th) => (th === 'light' ? 'dark' : 'light'))}
        />

        <main
          className={
            activeView === 'watch'
              ? 'min-w-0 flex-1 px-0 pt-0 pb-24 sm:p-5 sm:pb-24 lg:p-8 lg:pb-10'
              : activeView === 'discover'
                ? 'min-w-0 flex-1 px-0 pt-3 pb-28 sm:p-5 sm:pb-28 lg:p-8 lg:pb-10'
                : 'min-w-0 flex-1 p-3 pb-24 sm:p-4 sm:pb-24 lg:p-8 lg:pb-8'
          }
        >
          <div className="mx-auto max-w-[1440px]">
            {/* 1. HOME / DISCOVER VIEW: Clean Category Strip + Refresh + Full-Width Video Cards */}
            {activeView === 'discover' && (
              <div className="space-y-5 sm:space-y-6">
                {/* Compact Category Filter Strip + Refresh Action */}
                <div className="flex items-center justify-between gap-2 px-3 pb-1 sm:px-0">
                  <div
                    role="tablist"
                    aria-label="Categories"
                    className="flex min-w-0 flex-1 items-center gap-2 overflow-x-auto no-scrollbar"
                  >
                    {CATEGORIES.map((cat) => {
                      const active = category === cat;
                      return (
                        <button
                          key={cat}
                          type="button"
                          role="tab"
                          aria-selected={active}
                          onClick={() => {
                            if (active) {
                              void loadTrending(cat, locale, true);
                            } else {
                              setCategory(cat);
                            }
                          }}
                          className={`h-9 shrink-0 whitespace-nowrap rounded-xl px-4 text-xs font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-red-600 ${
                            active
                              ? 'bg-red-600 text-white shadow-xs'
                              : 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-100 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800'
                          }`}
                        >
                          {t.categories[cat]}
                        </button>
                      );
                    })}
                  </div>

                  <button
                    type="button"
                    onClick={() => void loadTrending(category, locale, true)}
                    disabled={trendingLoading}
                    aria-label={t.refreshFeed}
                    title={t.refreshFeed}
                    data-testid="refresh-feed-button"
                    className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-100 disabled:opacity-60 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
                  >
                    <RefreshCw className={`h-3.5 w-3.5 ${trendingLoading ? 'animate-spin' : ''}`} />
                    <span className="hidden sm:inline">{t.refreshFeed}</span>
                  </button>
                </div>

                {trendingLoading ? (
                  renderFullWidthSkeleton()
                ) : trendingError ? (
                  <div className="mx-3 rounded-2xl border border-red-200 bg-white p-6 text-center sm:mx-0 sm:p-8 dark:border-red-900/50 dark:bg-slate-900">
                    <p className="text-base font-semibold text-red-600 dark:text-red-400">
                      {t.errorTitle}
                    </p>
                    <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">{trendingError}</p>
                    <button
                      type="button"
                      onClick={() => void loadTrending(category, locale, true)}
                      className="mt-4 rounded-xl bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700"
                    >
                      {t.retry}
                    </button>
                  </div>
                ) : (
                  <div
                    data-testid="home-fullwidth-feed"
                    className="flex flex-col gap-7 sm:gap-8"
                  >
                    {trendingItems.map((video) => (
                      <VideoCard
                        key={video.id}
                        video={video}
                        locale={locale}
                        fullWidth
                        isSaved={savedIds.has(video.id)}
                        onWatch={(v) => void handleWatchVideo(v)}
                        onToggleSave={handleToggleSave}
                        onOpenChannel={(cid) => void handleOpenChannel(cid)}
                      />
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* 2. SERIES & MOVIES (XTREAM) VIEW */}
            {activeView === 'series' && (
              <SeriesView
                locale={locale}
                serverId={xtreamServer}
                tab={seriesTab}
                categoryId={seriesCategoryId}
                query={seriesQuery}
                selectedSeriesId={selectedSeriesId}
                onChangeTab={setSeriesTab}
                onChangeCategoryId={setSeriesCategoryId}
                onChangeQuery={(nextQ) => {
                  setSeriesQueryInput(nextQ);
                  setSeriesQuery(nextQ);
                }}
                onSelectSeriesId={setSelectedSeriesId}
                onPlayMedia={handleWatchXtreamMedia}
                onUpdateMediaDetails={handleUpdateXtreamMediaDetails}
              />
            )}

            {/* 4. SEARCH RESULTS VIEW */}
            {activeView === 'search' && (
              <div className="space-y-5 sm:space-y-6">
                {!activeQuery ? (
                  <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center sm:p-12 dark:border-slate-800 dark:bg-slate-900">
                    <Search className="mx-auto h-10 w-10 text-slate-400" />
                    <h1 className="mt-4 text-lg font-bold text-slate-900 dark:text-white">
                      {t.searchEmptyTitle}
                    </h1>
                    <p className="mx-auto mt-1 max-w-md text-sm text-slate-600 dark:text-slate-400">
                      {t.searchEmptyBody}
                    </p>
                  </div>
                ) : (
                  <>
                    <div className="flex flex-wrap items-end justify-between gap-4 border-b border-slate-200 pb-4 dark:border-slate-800">
                      <div>
                        <h1 className="text-lg font-bold text-slate-900 sm:text-xl dark:text-white">
                          {t.searchHeading}{' '}
                          <span className="text-red-600 dark:text-red-400">"{activeQuery}"</span>
                        </h1>
                        {searchResult && !searchLoading && (
                          <p className="mt-1 tabular-nums text-xs text-slate-500 dark:text-slate-400">
                            {searchResult.estimatedResults.toLocaleString()} {t.resultsCount}
                          </p>
                        )}
                      </div>

                      <div className="flex flex-wrap items-center gap-2 sm:gap-3">
                        <div className="flex items-center gap-1.5">
                          <label htmlFor="sort-select" className="text-xs font-medium text-slate-500 dark:text-slate-400">
                            {t.sortLabel}
                          </label>
                          <select
                            id="sort-select"
                            value={sortOrder}
                            onChange={(e) => {
                              const next = e.target.value as SortOrder;
                              setSortOrder(next);
                              void executeSearch(activeQuery, { sort: next });
                            }}
                            className="h-9 rounded-lg border border-slate-200 bg-white px-2 text-xs font-medium text-slate-800 sm:px-2.5 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
                          >
                            <option value="relevance">{t.sorts.relevance}</option>
                            <option value="date">{t.sorts.date}</option>
                            <option value="views">{t.sorts.views}</option>
                            <option value="rating">{t.sorts.rating}</option>
                          </select>
                        </div>

                        <div className="flex items-center gap-1.5">
                          <label htmlFor="type-select" className="text-xs font-medium text-slate-500 dark:text-slate-400">
                            {t.typeLabel}
                          </label>
                          <select
                            id="type-select"
                            value={searchType}
                            onChange={(e) => {
                              const next = e.target.value as SearchType;
                              setSearchType(next);
                              void executeSearch(activeQuery, { type: next });
                            }}
                            className="h-9 rounded-lg border border-slate-200 bg-white px-2 text-xs font-medium text-slate-800 sm:px-2.5 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
                          >
                            <option value="all">{t.types.all}</option>
                            <option value="video">{t.types.video}</option>
                            <option value="live">{t.types.live}</option>
                            <option value="short">{t.types.short}</option>
                          </select>
                        </div>

                        <div className="flex items-center gap-1.5">
                          <label htmlFor="duration-select" className="text-xs font-medium text-slate-500 dark:text-slate-400">
                            {t.durationLabel}
                          </label>
                          <select
                            id="duration-select"
                            value={durationFilter}
                            onChange={(e) => {
                              const next = e.target.value as DurationFilter;
                              setDurationFilter(next);
                              void executeSearch(activeQuery, { duration: next });
                            }}
                            className="h-9 rounded-lg border border-slate-200 bg-white px-2 text-xs font-medium text-slate-800 sm:px-2.5 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
                          >
                            <option value="any">{t.durations.any}</option>
                            <option value="short">{t.durations.short}</option>
                            <option value="medium">{t.durations.medium}</option>
                            <option value="long">{t.durations.long}</option>
                          </select>
                        </div>
                      </div>
                    </div>

                    {searchLoading ? (
                      renderSkeletonGrid()
                    ) : searchError ? (
                      <div className="rounded-2xl border border-red-200 bg-white p-6 text-center sm:p-8 dark:border-red-900/50 dark:bg-slate-900">
                        <p className="text-base font-semibold text-red-600 dark:text-red-400">
                          {t.errorTitle}
                        </p>
                        <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">{searchError}</p>
                        <button
                          type="button"
                          onClick={() => void executeSearch(activeQuery)}
                          className="mt-4 rounded-xl bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700"
                        >
                          {t.retry}
                        </button>
                      </div>
                    ) : searchResult && searchResult.items.length === 0 && searchResult.channels.length === 0 ? (
                      <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center sm:p-12 dark:border-slate-800 dark:bg-slate-900">
                        <p className="text-base font-bold text-slate-900 dark:text-white">
                          {t.noResultsTitle}
                        </p>
                        <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
                          {t.noResultsBody}
                        </p>
                      </div>
                    ) : (
                      <>
                        {searchResult && searchResult.channels.length > 0 && (
                          <section className="space-y-3">
                            <h2 className="text-sm font-bold text-slate-700 dark:text-slate-300">
                              {t.channelsSection}
                            </h2>
                            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
                              {searchResult.channels.slice(0, 12).map((ch) => (
                                <button
                                  key={ch.id}
                                  type="button"
                                  onClick={() => void handleOpenChannel(ch.id)}
                                  className="flex items-center gap-3.5 rounded-2xl border border-slate-200 bg-white p-3.5 text-start transition-colors hover:border-slate-300 dark:border-slate-800 dark:bg-slate-900 dark:hover:border-slate-700"
                                >
                                  {ch.avatar ? (
                                    <img
                                      src={ch.avatar}
                                      alt={ch.name}
                                      referrerPolicy="no-referrer"
                                      className="h-12 w-12 shrink-0 rounded-full object-cover bg-slate-200 dark:bg-slate-800"
                                    />
                                  ) : (
                                    <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-red-600 font-bold text-white">
                                      {ch.name.slice(0, 1).toUpperCase()}
                                    </div>
                                  )}
                                  <div className="min-w-0 flex-1">
                                    <p className="truncate text-sm font-bold text-slate-900 dark:text-white">
                                      {ch.name}
                                    </p>
                                    {ch.subscribersText && (
                                      <p className="truncate text-xs text-slate-500 dark:text-slate-400">
                                        {ch.subscribersText}
                                      </p>
                                    )}
                                  </div>
                                  <span className="shrink-0 text-xs font-semibold text-red-600 dark:text-red-400">
                                    {t.viewChannel}
                                  </span>
                                </button>
                              ))}
                            </div>
                          </section>
                        )}

                        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                          {(searchResult?.items || []).map((video) => (
                            <VideoCard
                              key={video.id}
                              video={video}
                              locale={locale}
                              isSaved={savedIds.has(video.id)}
                              onWatch={(v) => void handleWatchVideo(v)}
                              onToggleSave={handleToggleSave}
                              onOpenChannel={(cid) => void handleOpenChannel(cid)}
                            />
                          ))}
                        </div>

                        {searchResult?.continuation && (
                          <div className="flex justify-center pt-4">
                            <button
                              type="button"
                              onClick={() => void handleLoadMoreSearch()}
                              disabled={loadingMore}
                              className="inline-flex h-10 items-center rounded-xl border border-slate-300 bg-white px-6 text-sm font-semibold text-slate-800 transition-colors hover:bg-slate-100 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800"
                            >
                              {loadingMore ? t.loadingMore : t.loadMore}
                            </button>
                          </div>
                        )}
                      </>
                    )}
                  </>
                )}
              </div>
            )}

            {/* 5. WATCH VIDEO VIEW */}
            {activeView === 'watch' && (
              <VideoWatchView
                locale={locale}
                details={videoDetails}
                loading={videoLoading}
                error={videoError}
                fallbackVideo={selectedVideo}
                savedIds={savedIds}
                subscribedIds={subscribedIds}
                onBack={() => setActiveView(previousView === 'watch' ? 'discover' : previousView)}
                onSelectVideo={(v) => void handleWatchVideo(v)}
                onToggleSave={handleToggleSave}
                onToggleSubscribe={handleToggleSubscribe}
                onOpenChannel={(cid) => void handleOpenChannel(cid)}
              />
            )}

            {/* 6. CHANNEL VIEW */}
            {activeView === 'channel' && (
              <ChannelView
                locale={locale}
                data={channelData}
                loading={channelLoading}
                error={channelError}
                savedIds={savedIds}
                subscribedIds={subscribedIds}
                onBack={() => setActiveView(previousView === 'channel' ? 'discover' : previousView)}
                onWatch={(v) => void handleWatchVideo(v)}
                onToggleSave={handleToggleSave}
                onToggleSubscribe={handleToggleSubscribe}
              />
            )}

            {/* 7. SUBSCRIPTIONS VIEW */}
            {activeView === 'subscriptions' && (
              <div className="space-y-6">
                <h1 className="text-xl font-bold text-slate-900 sm:text-2xl dark:text-white">
                  {t.subscriptionsHeading}
                </h1>
                {subscriptions.length === 0 ? (
                  <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center sm:p-12 dark:border-slate-800 dark:bg-slate-900">
                    <BellRing className="mx-auto h-10 w-10 text-slate-400" />
                    <h2 className="mt-4 text-base font-bold text-slate-900 dark:text-white">
                      {t.subscriptionsEmptyTitle}
                    </h2>
                    <p className="mx-auto mt-1 max-w-md text-sm text-slate-600 dark:text-slate-400">
                      {t.subscriptionsEmptyBody}
                    </p>
                    <button
                      type="button"
                      onClick={() => setActiveView('discover')}
                      className="mt-5 rounded-xl bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700"
                    >
                      {t.exploreTrending}
                    </button>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    {subscriptions.map((ch) => (
                      <div
                        key={ch.id}
                        className="flex items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900"
                      >
                        <button
                          type="button"
                          onClick={() => {
                            if (ch.id && !ch.id.startsWith('@')) {
                              void handleOpenChannel(ch.id);
                            } else {
                              setSearchInput(ch.name);
                              void executeSearch(ch.name);
                            }
                          }}
                          className="flex min-w-0 flex-1 items-center gap-3 text-start"
                        >
                          {ch.avatar ? (
                            <img
                              src={ch.avatar}
                              alt={ch.name}
                              referrerPolicy="no-referrer"
                              className="h-12 w-12 shrink-0 rounded-full object-cover bg-slate-200 dark:bg-slate-800"
                            />
                          ) : (
                            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-red-600 text-base font-bold text-white">
                              {ch.name.slice(0, 1).toUpperCase()}
                            </div>
                          )}
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-bold text-slate-900 dark:text-white">
                              {ch.name}
                            </p>
                            {ch.subscribersText && (
                              <p className="truncate tabular-nums text-xs text-slate-500 dark:text-slate-400">
                                {ch.subscribersText}
                              </p>
                            )}
                          </div>
                        </button>
                        <button
                          type="button"
                          onClick={() => handleToggleSubscribe(ch)}
                          className="inline-flex h-9 shrink-0 items-center rounded-xl border border-slate-200 px-3 text-xs font-semibold text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                        >
                          {t.unsubscribe}
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* 8. SAVED / WATCH LATER VIEW */}
            {activeView === 'saved' && (
              <div className="space-y-6">
                <h1 className="text-xl font-bold text-slate-900 sm:text-2xl dark:text-white">
                  {t.savedHeading}
                </h1>
                {savedVideos.length === 0 ? (
                  <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center sm:p-12 dark:border-slate-800 dark:bg-slate-900">
                    <Bookmark className="mx-auto h-10 w-10 text-slate-400" />
                    <h2 className="mt-4 text-base font-bold text-slate-900 dark:text-white">
                      {t.savedEmptyTitle}
                    </h2>
                    <p className="mx-auto mt-1 max-w-md text-sm text-slate-600 dark:text-slate-400">
                      {t.savedEmptyBody}
                    </p>
                    <button
                      type="button"
                      onClick={() => setActiveView('discover')}
                      className="mt-5 rounded-xl bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700"
                    >
                      {t.exploreTrending}
                    </button>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                    {savedVideos.map((video) => (
                      <VideoCard
                        key={video.id}
                        video={video}
                        locale={locale}
                        isSaved={true}
                        onWatch={(v) => void handleWatchVideo(v)}
                        onToggleSave={handleToggleSave}
                        onOpenChannel={(cid) => void handleOpenChannel(cid)}
                      />
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* 9. WATCH HISTORY VIEW */}
            {activeView === 'history' && (
              <div className="space-y-6">
                <div className="flex items-center justify-between gap-4">
                  <h1 className="text-xl font-bold text-slate-900 sm:text-2xl dark:text-white">
                    {t.historyHeading}
                  </h1>
                  {watchHistory.length > 0 && (
                    <button
                      type="button"
                      onClick={() => setWatchHistory(clearWatchHistory())}
                      className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      <span>{t.clearHistory}</span>
                    </button>
                  )}
                </div>

                {watchHistory.length === 0 ? (
                  <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center sm:p-12 dark:border-slate-800 dark:bg-slate-900">
                    <History className="mx-auto h-10 w-10 text-slate-400" />
                    <h2 className="mt-4 text-base font-bold text-slate-900 dark:text-white">
                      {t.historyEmptyTitle}
                    </h2>
                    <p className="mx-auto mt-1 max-w-md text-sm text-slate-600 dark:text-slate-400">
                      {t.historyEmptyBody}
                    </p>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                    {watchHistory.map((video) => (
                      <VideoCard
                        key={video.id}
                        video={video}
                        locale={locale}
                        isSaved={savedIds.has(video.id)}
                        onWatch={(v) => void handleWatchVideo(v)}
                        onToggleSave={handleToggleSave}
                        onOpenChannel={(cid) => void handleOpenChannel(cid)}
                      />
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </main>
      </div>

      {/* Mobile App Bottom Navigation Bar */}
      <nav
        aria-label="Mobile navigation"
        className="fixed inset-x-0 bottom-0 z-40 border-t border-slate-200 bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-md dark:border-slate-800 dark:bg-slate-950/95 lg:hidden"
      >
        <div className="grid h-16 grid-cols-4">
          {mobileBottomTabs.map((tab) => {
            const Icon = tab.icon;
            const active = activeView === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => {
                  setActiveView(tab.id);
                  if (tab.id === 'discover') {
                    void loadTrending(category, locale, true);
                  }
                  window.scrollTo({ top: 0, behavior: 'smooth' });
                }}
                className={`relative flex flex-col items-center justify-center gap-1 text-[11px] font-semibold transition-colors ${
                  active
                    ? 'text-red-600 dark:text-red-400'
                    : 'text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white'
                }`}
              >
                <span className="relative">
                  <Icon className="h-5 w-5" />
                  {typeof tab.badge === 'number' && tab.badge > 0 && (
                    <span className="absolute -top-1.5 -end-2.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-red-600 px-1 text-[9px] font-bold text-white tabular-nums">
                      {tab.badge}
                    </span>
                  )}
                </span>
                <span className="truncate max-w-full px-1">{tab.label}</span>
              </button>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
