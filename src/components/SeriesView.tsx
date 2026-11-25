import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Clapperboard,
  Film,
  Play,
  Star,
  Tv,
  X,
} from 'lucide-react';
import type {
  AppLocale,
  MediaVideo,
  XtreamCategory,
  XtreamEpisode,
  XtreamMovieItem,
  XtreamServerId,
  XtreamSeriesDetails,
  XtreamSeriesItem,
  XtreamTab,
} from '../shared/types.ts';
import {
  configureXtreamServer,
  fetchXtreamCatalog,
  fetchXtreamMovieDetails,
  fetchXtreamSeriesDetails,
} from '../utils/api.ts';
import { getCopy } from '../utils/i18n.ts';
import { parseClockDurationToSeconds } from '../server/xtreamParser.ts';

interface SeriesViewProps {
  locale: AppLocale;
  serverId: XtreamServerId;
  tab: XtreamTab;
  categoryId: string;
  query: string;
  selectedSeriesId: string | null;
  onChangeTab: (tab: XtreamTab) => void;
  onChangeCategoryId: (categoryId: string) => void;
  onChangeQuery: (query: string) => void;
  onSelectSeriesId: (seriesId: string | null) => void;
  onPlayMedia: (video: MediaVideo, related: MediaVideo[], description?: string) => void;
  onUpdateMediaDetails?: (videoId: string, durationSeconds?: number, description?: string) => void;
}

function buildEpisodeMediaVideo(
  ep: XtreamEpisode,
  series: XtreamSeriesDetails['series'],
  locale: AppLocale,
): MediaVideo {
  const t = getCopy(locale);
  const seasonLabel = `${t.seasonNumber} ${ep.seasonNum}`;
  const epLabel = `${t.episodeNumber} ${ep.episodeNum}`;
  const displayTitle =
    ep.title && !ep.title.toLowerCase().includes(series.name.toLowerCase())
      ? `${series.name} · ${seasonLabel} · ${epLabel} - ${ep.title}`
      : `${series.name} · ${seasonLabel} · ${epLabel}`;

  return {
    id: `xtream_ep_${ep.id}`,
    title: displayTitle,
    channelName: series.name,
    channelId: '',
    channelAvatar: series.cover || undefined,
    thumbnail: ep.thumbnail || series.cover || series.backdrop || '',
    duration: ep.duration || '0:00',
    durationSeconds: ep.durationSeconds || 0,
    isLive: false,
    isShort: false,
    viewsText: `${seasonLabel} · ${epLabel}`,
    viewsCount: null,
    publishedText: series.releaseDate || series.genre || '',
    descriptionSnippet: ep.plot || series.plot || displayTitle,
    streamUrl: ep.streamUrl,
    sourceType: 'video',
  };
}

function buildMovieMediaVideo(movie: XtreamMovieItem, locale: AppLocale): MediaVideo {
  const t = getCopy(locale);
  const durSecs = movie.durationSeconds || parseClockDurationToSeconds(movie.duration) || 0;
  return {
    id: `xtream_vod_${movie.id}`,
    title: movie.name,
    channelName: movie.genre || t.moviesTab,
    channelId: '',
    channelAvatar: movie.cover || undefined,
    thumbnail: movie.cover || '',
    duration: movie.duration || '0:00',
    durationSeconds: durSecs,
    isLive: false,
    isShort: false,
    viewsText: movie.rating ? `★ ${movie.rating}` : t.moviesTab,
    viewsCount: null,
    publishedText: movie.genre || '',
    descriptionSnippet: movie.plot || movie.name,
    streamUrl: movie.streamUrl,
    sourceType: 'video',
  };
}

function PosterArtwork({
  src,
  alt,
  fallbackIcon,
}: {
  src?: string;
  alt: string;
  fallbackIcon: 'tv' | 'film';
}) {
  const [failed, setFailed] = useState(false);

  if (!src || failed) {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-2 bg-gradient-to-br from-slate-800 to-slate-950 p-4 text-center text-slate-300">
        {fallbackIcon === 'film' ? (
          <Film className="h-9 w-9 text-red-500" />
        ) : (
          <Tv className="h-9 w-9 text-red-500" />
        )}
        <span className="line-clamp-2 text-xs font-medium">{alt}</span>
      </div>
    );
  }

  return (
    <img
      src={src}
      alt={alt}
      loading="lazy"
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
      className="h-full w-full object-cover object-top transition-transform duration-200 group-hover:scale-[1.03]"
    />
  );
}

export function SeriesView({
  locale,
  serverId,
  tab,
  categoryId,
  query,
  selectedSeriesId,
  onChangeTab,
  onChangeCategoryId,
  onChangeQuery,
  onSelectSeriesId,
  onPlayMedia,
  onUpdateMediaDetails,
}: SeriesViewProps) {
  const t = getCopy(locale);
  const BackArrow = locale === 'ar' ? ArrowRight : ArrowLeft;

  const [categories, setCategories] = useState<XtreamCategory[]>([]);
  const [seriesList, setSeriesList] = useState<XtreamSeriesItem[]>([]);
  const [moviesList, setMoviesList] = useState<XtreamMovieItem[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [configured, setConfigured] = useState(true);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [seriesDetails, setSeriesDetails] = useState<XtreamSeriesDetails | null>(null);
  const [seriesLoading, setSeriesLoading] = useState(false);
  const [seriesError, setSeriesError] = useState<string | null>(null);
  const [activeSeasonNum, setActiveSeasonNum] = useState<number>(1);
  const [setupBaseUrl, setSetupBaseUrl] = useState('');
  const [setupUsername, setSetupUsername] = useState('');
  const [setupPassword, setSetupPassword] = useState('');
  const [setupSubmitting, setSetupSubmitting] = useState(false);
  const [setupError, setSetupError] = useState<string | null>(null);

  const loadCatalog = useCallback(
    async (offset = 0, append = false) => {
      if (append) {
        setLoadingMore(true);
      } else {
        setLoading(true);
      }
      setError(null);

      try {
        const res = await fetchXtreamCatalog({
          serverId,
          tab,
          categoryId,
          query,
          offset,
          limit: 48,
        });
        setConfigured(res.configured);
        setCategories(res.categories);
        setTotalCount(res.total);
        setHasMore(res.hasMore);

        if (tab === 'series') {
          setSeriesList((prev) => (append ? [...prev, ...res.series] : res.series));
          if (!append) setMoviesList([]);
        } else {
          setMoviesList((prev) => (append ? [...prev, ...res.movies] : res.movies));
          if (!append) setSeriesList([]);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : t.errorTitle);
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [categoryId, query, serverId, t.errorTitle, tab],
  );

  useEffect(() => {
    if (!selectedSeriesId) {
      void loadCatalog(0, false);
    }
  }, [loadCatalog, selectedSeriesId]);

  useEffect(() => {
    if (!selectedSeriesId) {
      setSeriesDetails(null);
      setSeriesError(null);
      return;
    }

    let cancelled = false;
    setSeriesLoading(true);
    setSeriesError(null);
    void fetchXtreamSeriesDetails(selectedSeriesId, serverId)
      .then((res) => {
        if (cancelled) return;
        setSeriesDetails(res);
        if (res.seasons.length > 0) {
          setActiveSeasonNum(res.seasons[0].seasonNumber);
        }
      })
      .catch((err) => {
        if (cancelled) return;
        setSeriesError(err instanceof Error ? err.message : t.errorTitle);
      })
      .finally(() => {
        if (!cancelled) setSeriesLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [selectedSeriesId, serverId, t.errorTitle]);

  const handlePlayEpisode = (ep: XtreamEpisode, allSeasonEpisodes: XtreamEpisode[]) => {
    if (!seriesDetails) return;
    const activeMedia = buildEpisodeMediaVideo(ep, seriesDetails.series, locale);
    const relatedMedia = allSeasonEpisodes
      .filter((item) => item.id !== ep.id)
      .map((item) => buildEpisodeMediaVideo(item, seriesDetails.series, locale));
    onPlayMedia(activeMedia, relatedMedia, ep.plot || seriesDetails.series.plot);
  };

  const handleOpenMovie = (movie: XtreamMovieItem) => {
    const movieVideo = buildMovieMediaVideo(movie, locale);
    const relatedMovies = moviesList
      .filter((m) => m.id !== movie.id)
      .slice(0, 12)
      .map((m) => buildMovieMediaVideo(m, locale));
    onPlayMedia(movieVideo, relatedMovies, movie.plot);

    void fetchXtreamMovieDetails(movie.id, serverId)
      .then((detailed) => {
        if (detailed?.durationSeconds || detailed?.plot) {
          onUpdateMediaDetails?.(movieVideo.id, detailed.durationSeconds, detailed.plot);
        }
      })
      .catch(() => {});
  };

  const handleSubmitSetup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!setupBaseUrl.trim() || !setupUsername.trim() || !setupPassword.trim()) return;
    setSetupSubmitting(true);
    setSetupError(null);
    try {
      await configureXtreamServer({
        serverId,
        baseUrl: setupBaseUrl.trim(),
        username: setupUsername.trim(),
        password: setupPassword.trim(),
      });
      await loadCatalog(0, false);
    } catch (err) {
      setSetupError(err instanceof Error ? err.message : t.errorTitle);
    } finally {
      setSetupSubmitting(false);
    }
  };

  const currentSeason = useMemo(() => {
    if (!seriesDetails?.seasons.length) return null;
    return (
      seriesDetails.seasons.find((s) => s.seasonNumber === activeSeasonNum) ||
      seriesDetails.seasons[0]
    );
  }, [activeSeasonNum, seriesDetails]);

  if (selectedSeriesId) {
    const firstEpisode = currentSeason?.episodes?.[0] || seriesDetails?.seasons?.[0]?.episodes?.[0];
    const firstEpisodeSeasonList = currentSeason?.episodes || seriesDetails?.seasons?.[0]?.episodes || [];

    return (
      <div className="space-y-5 sm:space-y-6" data-testid="series-details-view">
        <button
          type="button"
          onClick={() => onSelectSeriesId(null)}
          data-testid="series-detail-back"
          className="inline-flex h-10 items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-red-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
        >
          <BackArrow className="h-4 w-4" />
          <span>{t.backToList}</span>
        </button>

        {seriesLoading ? (
          <div className="space-y-5">
            <div className="h-56 w-full animate-pulse rounded-2xl bg-slate-200 dark:bg-slate-800" />
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              {Array.from({ length: 6 }).map((_, i) => (
                <div
                  key={i}
                  className="h-24 w-full animate-pulse rounded-2xl bg-slate-200 dark:bg-slate-800"
                />
              ))}
            </div>
          </div>
        ) : seriesError || !seriesDetails ? (
          <div className="rounded-2xl border border-red-200 bg-white p-6 text-center sm:p-8 dark:border-red-900/50 dark:bg-slate-900">
            <p className="text-base font-semibold text-red-600 dark:text-red-400">
              {t.errorTitle}
            </p>
            <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
              {seriesError || t.xtreamEmptyTitle}
            </p>
          </div>
        ) : (
          <>
            {/* Series Cinema Overview */}
            <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
              {seriesDetails.series.backdrop && (
                <div className="relative h-36 w-full overflow-hidden bg-slate-900 sm:h-52">
                  <img
                    src={seriesDetails.series.backdrop}
                    alt={seriesDetails.series.name}
                    referrerPolicy="no-referrer"
                    className="h-full w-full object-cover opacity-85"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/30 to-transparent" />
                </div>
              )}

              <div className="flex flex-col gap-5 p-4 sm:flex-row sm:items-start sm:p-6">
                <div className="h-48 w-32 shrink-0 overflow-hidden rounded-xl border border-slate-200 bg-slate-900 shadow-sm sm:h-52 sm:w-36 dark:border-slate-700">
                  <PosterArtwork
                    src={seriesDetails.series.cover}
                    alt={seriesDetails.series.name}
                    fallbackIcon="tv"
                  />
                </div>

                <div className="min-w-0 flex-1 space-y-3">
                  <h1 className="text-balance text-xl font-bold text-slate-900 sm:text-2xl dark:text-white">
                    {seriesDetails.series.name}
                  </h1>

                  {/* Unboxed Clean Metadata */}
                  <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs font-medium text-slate-500 sm:text-sm dark:text-slate-400">
                    {seriesDetails.series.rating && (
                      <span className="inline-flex items-center gap-1 font-semibold text-amber-600 tabular-nums dark:text-amber-400">
                        <Star className="h-3.5 w-3.5 fill-amber-500 text-amber-500" />
                        <span>{seriesDetails.series.rating}</span>
                      </span>
                    )}
                    {seriesDetails.series.rating && (seriesDetails.series.releaseDate || seriesDetails.series.genre) && (
                      <span aria-hidden="true">·</span>
                    )}
                    {seriesDetails.series.releaseDate && (
                      <span className="tabular-nums">{seriesDetails.series.releaseDate}</span>
                    )}
                    {seriesDetails.series.releaseDate && seriesDetails.series.genre && (
                      <span aria-hidden="true">·</span>
                    )}
                    {seriesDetails.series.genre && <span>{seriesDetails.series.genre}</span>}
                  </div>

                  {seriesDetails.series.plot && (
                    <p className="max-w-3xl text-sm leading-relaxed text-slate-600 dark:text-slate-300">
                      {seriesDetails.series.plot}
                    </p>
                  )}

                  {seriesDetails.series.cast && (
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      {seriesDetails.series.cast}
                    </p>
                  )}

                  {firstEpisode && (
                    <div className="pt-1">
                      <button
                        type="button"
                        onClick={() => handlePlayEpisode(firstEpisode, firstEpisodeSeasonList)}
                        className="inline-flex h-10 items-center gap-2 whitespace-nowrap rounded-xl bg-red-600 px-5 text-sm font-semibold text-white shadow-xs transition-colors hover:bg-red-700 focus-visible:outline-2 focus-visible:outline-red-600"
                      >
                        <Play className="h-4 w-4 fill-white" />
                        <span>{t.playEpisode} {firstEpisode.episodeNum}</span>
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Season Selector + YouTube Playlist Style Episodes */}
            {seriesDetails.seasons.length > 0 && (
              <div className="space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <h2 className="text-base font-bold text-slate-900 sm:text-lg dark:text-white">
                    {t.seasonsLabel}
                  </h2>

                  <div
                    role="tablist"
                    aria-label={t.seasonsLabel}
                    className="flex flex-wrap items-center gap-2"
                  >
                    {seriesDetails.seasons.map((season) => {
                      const active = currentSeason?.seasonNumber === season.seasonNumber;
                      return (
                        <button
                          key={season.seasonNumber}
                          type="button"
                          role="tab"
                          aria-selected={active}
                          onClick={() => setActiveSeasonNum(season.seasonNumber)}
                          className={`h-9 shrink-0 whitespace-nowrap rounded-xl px-4 text-xs font-semibold transition-colors ${
                            active
                              ? 'bg-red-600 text-white shadow-xs'
                              : 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-100 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800'
                          }`}
                        >
                          {t.seasonNumber} {season.seasonNumber} · {season.episodes.length}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Episodes Grid matching Video Watch Playlist cards */}
                <div
                  data-testid="series-episodes-list"
                  className="grid grid-cols-1 gap-3 md:grid-cols-2"
                >
                  {(currentSeason?.episodes || []).map((ep) => (
                    <button
                      key={ep.id}
                      type="button"
                      data-testid={`episode-item-${ep.id}`}
                      onClick={() => handlePlayEpisode(ep, currentSeason?.episodes || [])}
                      className="group flex items-center gap-3.5 rounded-2xl border border-slate-200 bg-white p-3 text-start transition-colors hover:border-slate-300 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-red-600 dark:border-slate-800 dark:bg-slate-900 dark:hover:border-slate-700 dark:hover:bg-slate-800/70"
                    >
                      <div className="relative flex aspect-video w-32 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-slate-900 sm:w-36">
                        {ep.thumbnail || seriesDetails.series.cover ? (
                          <img
                            src={ep.thumbnail || seriesDetails.series.cover}
                            alt={ep.title}
                            loading="lazy"
                            referrerPolicy="no-referrer"
                            className="h-full w-full object-cover opacity-90 transition-transform duration-200 group-hover:scale-105"
                          />
                        ) : (
                          <Play className="h-6 w-6 text-red-500" />
                        )}
                        <span className="absolute flex h-9 w-9 items-center justify-center rounded-full bg-red-600/90 text-white shadow transition-transform group-hover:scale-105">
                          <Play className="h-4 w-4 fill-white ms-0.5" />
                        </span>
                        {ep.duration && (
                          <span className="tabular-nums absolute bottom-1 end-1 rounded bg-slate-950/85 px-1.5 py-0.5 text-[10px] font-medium text-white">
                            {ep.duration}
                          </span>
                        )}
                      </div>

                      <div className="min-w-0 flex-1 space-y-1">
                        <p className="text-xs font-bold text-red-600 tabular-nums dark:text-red-400">
                          {t.episodeNumber} {ep.episodeNum}
                        </p>
                        <p className="line-clamp-2 text-sm font-semibold leading-snug text-slate-900 group-hover:text-red-600 dark:text-slate-100 dark:group-hover:text-red-400">
                          {ep.title}
                        </p>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-5 sm:space-y-6" data-testid="series-catalog-view">
      {/* Clean YouTube-matched Single-Row Filter Strip (Search is cleanly in the Top Bar above) */}
      <div className="flex flex-wrap items-center gap-2.5">
        <div
          role="tablist"
          aria-label={t.seriesHeading}
          className="inline-flex h-9 shrink-0 items-center rounded-xl border border-slate-200 bg-white p-0.5 dark:border-slate-800 dark:bg-slate-900"
        >
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'series'}
            data-testid="xtream-tab-series"
            onClick={() => {
              onChangeTab('series');
              onChangeCategoryId('all');
            }}
            className={`inline-flex h-8 items-center gap-1.5 whitespace-nowrap rounded-lg px-3.5 text-xs font-semibold transition-colors ${
              tab === 'series'
                ? 'bg-red-600 text-white shadow-xs'
                : 'text-slate-700 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white'
            }`}
          >
            <Tv className="h-3.5 w-3.5" />
            <span>{t.seriesTab}</span>
          </button>

          <button
            type="button"
            role="tab"
            aria-selected={tab === 'movies'}
            data-testid="xtream-tab-movies"
            onClick={() => {
              onChangeTab('movies');
              onChangeCategoryId('all');
            }}
            className={`inline-flex h-8 items-center gap-1.5 whitespace-nowrap rounded-lg px-3.5 text-xs font-semibold transition-colors ${
              tab === 'movies'
                ? 'bg-red-600 text-white shadow-xs'
                : 'text-slate-700 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white'
            }`}
          >
            <Film className="h-3.5 w-3.5" />
            <span>{t.moviesTab}</span>
          </button>
        </div>

        {/* Scrollable Category Strip */}
        {categories.length > 0 && (
          <div
            role="tablist"
            aria-label="Categories"
            className="flex min-w-0 flex-1 items-center gap-2 overflow-x-auto no-scrollbar"
          >
            <button
              type="button"
              role="tab"
              aria-selected={categoryId === 'all'}
              onClick={() => onChangeCategoryId('all')}
              className={`h-9 shrink-0 whitespace-nowrap rounded-xl px-4 text-xs font-semibold transition-colors ${
                categoryId === 'all'
                  ? 'bg-red-600 text-white shadow-xs'
                  : 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-100 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800'
              }`}
            >
              {t.allCategories}
            </button>

            {categories.slice(0, 40).map((cat) => {
              const active = categoryId === cat.id;
              return (
                <button
                  key={cat.id}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => onChangeCategoryId(cat.id)}
                  className={`h-9 shrink-0 whitespace-nowrap rounded-xl px-4 text-xs font-semibold transition-colors ${
                    active
                      ? 'bg-red-600 text-white shadow-xs'
                      : 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-100 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800'
                  }`}
                >
                  {cat.name}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Active Search Summary Banner (clean unboxed bar matching YouTube Search view) */}
      {query.trim() && (
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 pb-3 dark:border-slate-800">
          <div className="flex flex-wrap items-baseline gap-2">
            <h1 className="text-sm font-bold text-slate-900 sm:text-base dark:text-white">
              {t.searchHeading}{' '}
              <span className="text-red-600 dark:text-red-400">"{query.trim()}"</span>
            </h1>
            {!loading && (
              <span className="tabular-nums text-xs text-slate-500 dark:text-slate-400">
                · {totalCount.toLocaleString()} {t.resultsCount}
              </span>
            )}
          </div>
          <button
            type="button"
            onClick={() => onChangeQuery('')}
            className="inline-flex h-8 items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-100 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            <X className="h-3.5 w-3.5" />
            <span>{t.clearSearch}</span>
          </button>
        </div>
      )}

      {/* Results Content */}
      {!configured ? (
        <div className="mx-auto max-w-lg rounded-2xl border border-slate-200 bg-white p-6 sm:p-8 dark:border-slate-800 dark:bg-slate-900">
          <div className="text-center">
            <Clapperboard className="mx-auto h-10 w-10 text-red-600" />
            <h2 className="mt-3 text-base font-bold text-slate-900 sm:text-lg dark:text-white">
              {t.xtreamSetupTitle}
            </h2>
            <p className="mt-1 text-xs text-slate-500 sm:text-sm dark:text-slate-400">
              {t.xtreamUnconfigured}
            </p>
          </div>
          <form onSubmit={(e) => void handleSubmitSetup(e)} className="mt-5 space-y-3">
            <div>
              <label htmlFor="xtream-url" className="mb-1 block text-xs font-semibold text-slate-700 dark:text-slate-300">
                {t.xtreamSetupBaseUrl}
              </label>
              <input
                id="xtream-url"
                type="url"
                required
                dir="ltr"
                value={setupBaseUrl}
                onChange={(e) => setSetupBaseUrl(e.target.value)}
                placeholder="http://example.com"
                className="h-10 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm text-slate-900 focus:border-red-500 focus:bg-white focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
              />
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label htmlFor="xtream-user" className="mb-1 block text-xs font-semibold text-slate-700 dark:text-slate-300">
                  {t.xtreamSetupUsername}
                </label>
                <input
                  id="xtream-user"
                  type="text"
                  required
                  dir="ltr"
                  value={setupUsername}
                  onChange={(e) => setSetupUsername(e.target.value)}
                  className="h-10 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm text-slate-900 focus:border-red-500 focus:bg-white focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                />
              </div>
              <div>
                <label htmlFor="xtream-pass" className="mb-1 block text-xs font-semibold text-slate-700 dark:text-slate-300">
                  {t.xtreamSetupPassword}
                </label>
                <input
                  id="xtream-pass"
                  type="password"
                  required
                  dir="ltr"
                  value={setupPassword}
                  onChange={(e) => setSetupPassword(e.target.value)}
                  className="h-10 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm text-slate-900 focus:border-red-500 focus:bg-white focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                />
              </div>
            </div>
            {setupError && (
              <p className="text-xs font-semibold text-red-600 dark:text-red-400">{setupError}</p>
            )}
            <button
              type="submit"
              disabled={setupSubmitting}
              className="mt-2 inline-flex h-10 w-full items-center justify-center rounded-xl bg-red-600 px-4 text-sm font-semibold text-white transition-colors hover:bg-red-700 disabled:opacity-60"
            >
              {setupSubmitting ? t.xtreamSetupConnecting : t.xtreamSetupSubmit}
            </button>
          </form>
        </div>
      ) : loading ? (
        <div className="grid grid-cols-2 gap-3.5 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5">
          {Array.from({ length: 10 }).map((_, idx) => (
            <div
              key={idx}
              className="overflow-hidden rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900"
            >
              <div className="aspect-[2/3] w-full animate-pulse bg-slate-200 dark:bg-slate-800" />
              <div className="space-y-2 p-3.5">
                <div className="h-4 w-4/5 animate-pulse rounded bg-slate-200 dark:bg-slate-800" />
                <div className="h-3 w-1/2 animate-pulse rounded bg-slate-200 dark:bg-slate-800" />
              </div>
            </div>
          ))}
        </div>
      ) : error ? (
        <div className="rounded-2xl border border-red-200 bg-white p-6 text-center sm:p-8 dark:border-red-900/50 dark:bg-slate-900">
          <p className="text-base font-semibold text-red-600 dark:text-red-400">{t.errorTitle}</p>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">{error}</p>
          <button
            type="button"
            onClick={() => void loadCatalog(0, false)}
            className="mt-4 rounded-xl bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700"
          >
            {t.retry}
          </button>
        </div>
      ) : (tab === 'series' ? seriesList.length === 0 : moviesList.length === 0) ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center sm:p-12 dark:border-slate-800 dark:bg-slate-900">
          <Clapperboard className="mx-auto h-10 w-10 text-slate-400" />
          <p className="mt-4 text-base font-bold text-slate-900 dark:text-white">
            {t.xtreamEmptyTitle}
          </p>
          <p className="mx-auto mt-1 max-w-md text-sm text-slate-600 dark:text-slate-400">
            {t.xtreamEmptyBody}
          </p>
        </div>
      ) : (
        <>
          {tab === 'series' ? (
            <div
              data-testid="xtream-series-grid"
              className="grid grid-cols-2 gap-3.5 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5"
            >
              {seriesList.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  data-testid={`series-card-${item.id}`}
                  onClick={() => onSelectSeriesId(item.id)}
                  className="group flex flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white text-start transition-colors hover:border-slate-300 focus-visible:outline-2 focus-visible:outline-red-600 dark:border-slate-800 dark:bg-slate-900 dark:hover:border-slate-700"
                >
                  <div className="relative aspect-[2/3] w-full overflow-hidden bg-slate-900">
                    <PosterArtwork src={item.cover} alt={item.name} fallbackIcon="tv" />
                    <div className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-black/75 to-transparent" />
                    <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/0 transition-colors group-hover:bg-black/25">
                      <span className="flex h-11 w-11 scale-90 items-center justify-center rounded-full bg-red-600 text-white opacity-0 shadow-lg transition-all group-hover:scale-100 group-hover:opacity-100">
                        <Play className="h-5 w-5 fill-white ms-0.5" />
                      </span>
                    </div>
                    {item.rating && (
                      <span className="tabular-nums absolute bottom-2 end-2 inline-flex items-center gap-1 rounded-md bg-slate-950/85 px-2 py-0.5 text-[11px] font-semibold text-white">
                        <Star className="h-3 w-3 fill-amber-400 text-amber-400" />
                        <span>{item.rating}</span>
                      </span>
                    )}
                  </div>

                  <div className="flex flex-1 flex-col justify-between gap-2.5 p-3.5">
                    <div className="space-y-1">
                      <h2 className="line-clamp-2 text-xs font-bold leading-snug text-slate-900 transition-colors group-hover:text-red-600 sm:text-sm dark:text-slate-100 dark:group-hover:text-red-400">
                        {item.name}
                      </h2>
                      <p className="truncate text-xs text-slate-500 dark:text-slate-400">
                        {[t.seriesTab, item.genre].filter(Boolean).join(' · ')}
                      </p>
                    </div>

                    <div className="flex items-center justify-between border-t border-slate-100 pt-2.5 text-xs font-semibold text-red-600 dark:border-slate-800 dark:text-red-400">
                      <span className="inline-flex items-center gap-1.5">
                        <Play className="h-3.5 w-3.5" />
                        <span>{t.watchVideo}</span>
                      </span>
                      {item.releaseDate && (
                        <span className="tabular-nums text-[11px] font-normal text-slate-400">
                          {item.releaseDate}
                        </span>
                      )}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          ) : (
            <div
              data-testid="xtream-movies-grid"
              className="grid grid-cols-2 gap-3.5 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5"
            >
              {moviesList.map((movie) => (
                  <button
                    key={movie.id}
                    type="button"
                    data-testid={`movie-card-${movie.id}`}
                    onClick={() => handleOpenMovie(movie)}
                    className="group flex flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white text-start transition-colors hover:border-slate-300 focus-visible:outline-2 focus-visible:outline-red-600 dark:border-slate-800 dark:bg-slate-900 dark:hover:border-slate-700"
                  >
                    <div className="relative aspect-[2/3] w-full overflow-hidden bg-slate-900">
                      <PosterArtwork src={movie.cover} alt={movie.name} fallbackIcon="film" />
                      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-black/75 to-transparent" />
                      <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/0 transition-colors group-hover:bg-black/25">
                        <span className="flex h-11 w-11 scale-90 items-center justify-center rounded-full bg-red-600 text-white opacity-0 shadow-lg transition-all group-hover:scale-100 group-hover:opacity-100">
                          <Play className="h-5 w-5 fill-white ms-0.5" />
                        </span>
                      </div>
                      {movie.rating && (
                        <span className="tabular-nums absolute bottom-2 end-2 inline-flex items-center gap-1 rounded-md bg-slate-950/85 px-2 py-0.5 text-[11px] font-semibold text-white">
                          <Star className="h-3 w-3 fill-amber-400 text-amber-400" />
                          <span>{movie.rating}</span>
                        </span>
                      )}
                    </div>

                    <div className="flex flex-1 flex-col justify-between gap-2.5 p-3.5">
                      <div className="space-y-1">
                        <h2 className="line-clamp-2 text-xs font-bold leading-snug text-slate-900 transition-colors group-hover:text-red-600 sm:text-sm dark:text-slate-100 dark:group-hover:text-red-400">
                          {movie.name}
                        </h2>
                        <p className="truncate text-xs text-slate-500 dark:text-slate-400">
                          {[t.moviesTab, movie.genre].filter(Boolean).join(' · ')}
                        </p>
                      </div>

                      <div className="flex items-center justify-between border-t border-slate-100 pt-2.5 text-xs font-semibold text-red-600 dark:border-slate-800 dark:text-red-400">
                        <span className="inline-flex items-center gap-1.5">
                          <Play className="h-3.5 w-3.5" />
                          <span>{t.watchVideo}</span>
                        </span>
                      </div>
                    </div>
                  </button>
              ))}
            </div>
          )}

          {hasMore && (
            <div className="flex justify-center pt-3">
              <button
                type="button"
                disabled={loadingMore}
                onClick={() =>
                  void loadCatalog(tab === 'series' ? seriesList.length : moviesList.length, true)
                }
                className="inline-flex h-10 items-center rounded-xl border border-slate-300 bg-white px-6 text-sm font-semibold text-slate-800 transition-colors hover:bg-slate-100 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800"
              >
                {loadingMore ? t.loadingMore : t.loadMoreSeries}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
