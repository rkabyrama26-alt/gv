import React, { useEffect, useRef, useState } from 'react';
import {
  BadgeCheck,
  Heart,
  Menu,
  MessageCircle,
  Music2,
  Pause,
  Play,
  RefreshCw,
  Search,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import type { AppLocale, MediaVideo, TikTokCategory, TikTokReel } from '../shared/types.ts';
import { formatCompactCount } from '../server/tiktokParser.ts';
import { getCopy } from '../utils/i18n.ts';

const TIKTOK_CATEGORIES: TikTokCategory[] = ['all', 'comedy', 'gaming', 'sports', 'music', 'food'];

interface TikTokReelsViewProps {
  locale: AppLocale;
  reels: TikTokReel[];
  category: TikTokCategory;
  searchQuery: string;
  loading: boolean;
  error: string | null;
  onSelectCategory: (cat: TikTokCategory) => void;
  onSearchReels: (query: string) => void;
  onClearSearch: () => void;
  onRefresh: () => void;
  onOpenMenu: () => void;
}

export function tiktokReelToDownloadableVideo(reel: TikTokReel): MediaVideo {
  return {
    id: `tt_${reel.id}`,
    title: reel.caption,
    channelName: `${reel.authorName} (${reel.authorHandle})`,
    channelId: reel.authorHandle,
    channelAvatar: reel.authorAvatar,
    channelVerified: reel.authorVerified,
    thumbnail: reel.coverUrl,
    duration: reel.duration,
    durationSeconds: reel.durationSeconds,
    isLive: false,
    isShort: true,
    viewsText: `${formatCompactCount(reel.viewsCount)}`,
    viewsCount: reel.viewsCount,
    publishedText: reel.musicTitle || '',
    descriptionSnippet: reel.caption,
    streamUrl: reel.streamUrl,
    sourceType: 'tiktok',
  };
}

interface ReelSlideProps {
  reel: TikTokReel;
  index: number;
  isActive: boolean;
  isPreload: boolean;
  isMuted: boolean;
  locale: AppLocale;
  onAudioAutoBlocked: () => void;
}

function ReelSlide({
  reel,
  index,
  isActive,
  isPreload,
  isMuted,
  locale,
  onAudioAutoBlocked,
}: ReelSlideProps) {
  const t = getCopy(locale);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const feedbackTimerRef = useRef<number | null>(null);

  const [isPlaying, setIsPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [liked, setLiked] = useState(false);
  const [captionExpanded, setCaptionExpanded] = useState(false);
  const [tapFeedback, setTapFeedback] = useState<'play' | 'pause' | null>(null);
  const [streamError, setStreamError] = useState(false);

  useEffect(() => {
    const vid = videoRef.current;
    if (!vid) return;
    vid.muted = isMuted;
    if (!isMuted) {
      vid.volume = 1;
    }
  }, [isMuted]);

  useEffect(() => {
    const vid = videoRef.current;
    if (!vid) return;

    if (isActive) {
      vid.currentTime = 0;
      vid.muted = isMuted;
      if (!isMuted) vid.volume = 1;

      const playAttempt = vid.play();
      if (playAttempt && typeof playAttempt.then === 'function') {
        playAttempt
          .then(() => {
            setIsPlaying(true);
          })
          .catch(() => {
            // Browser policy blocked unmuted playback before interaction:
            // start playing muted immediately and unlock sound on first interaction.
            onAudioAutoBlocked();
            vid.muted = true;
            vid
              .play()
              .then(() => setIsPlaying(true))
              .catch(() => setIsPlaying(false));
          });
      }
    } else {
      vid.pause();
      setIsPlaying(false);
    }
  }, [isActive]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    return () => {
      if (feedbackTimerRef.current) window.clearTimeout(feedbackTimerRef.current);
    };
  }, []);

  const flashFeedback = (kind: 'play' | 'pause') => {
    setTapFeedback(kind);
    if (feedbackTimerRef.current) window.clearTimeout(feedbackTimerRef.current);
    feedbackTimerRef.current = window.setTimeout(() => setTapFeedback(null), 600);
  };

  const togglePlay = () => {
    const vid = videoRef.current;
    if (!vid) return;
    if (vid.paused) {
      vid.muted = isMuted;
      vid
        .play()
        .then(() => {
          setIsPlaying(true);
          flashFeedback('play');
        })
        .catch(() => {});
    } else {
      vid.pause();
      setIsPlaying(false);
      flashFeedback('pause');
    }
  };

  const handleVideoSurfaceTap = () => {
    const vid = videoRef.current;
    if (!vid) return;
    // Never pause when tapping the video surface; only resume if currently paused
    if (vid.paused) {
      vid.muted = isMuted;
      vid
        .play()
        .then(() => {
          setIsPlaying(true);
          flashFeedback('play');
        })
        .catch(() => {});
    }
  };

  const displayLikes = formatCompactCount(reel.likesCount + (liked ? 1 : 0), locale);
  const displayComments = formatCompactCount(reel.commentsCount, locale);

  return (
    <article
      data-reel-index={index}
      onClick={(e) => {
        const target = e.target as HTMLElement;
        if (target.closest('button, a, input')) return;
        handleVideoSurfaceTap();
      }}
      className="relative flex h-full w-full shrink-0 snap-start snap-always items-center justify-center overflow-hidden bg-black text-white select-none"
    >
      {/* Fullscreen edge-to-edge HTML5 Video (zero borders, zero letterboxing) */}
      <video
        ref={videoRef}
        src={isActive || isPreload ? reel.streamUrl : undefined}
        poster={reel.coverUrl || undefined}
        playsInline
        loop
        muted={isMuted}
        preload={isActive || isPreload ? 'auto' : 'metadata'}
        onTimeUpdate={(e) => {
          const el = e.currentTarget;
          if (el.duration > 0) {
            setProgress((el.currentTime / el.duration) * 100);
          }
        }}
        onPlay={() => setIsPlaying(true)}
        onPause={() => setIsPlaying(false)}
        onError={() => setStreamError(true)}
        className="h-full w-full object-cover"
      />

      {/* Fallback cover if stream errors */}
      {streamError && reel.coverUrl && (
        <img
          src={reel.coverUrl}
          alt={reel.caption}
          className="pointer-events-none absolute inset-0 h-full w-full object-cover"
        />
      )}

      {/* Center Play/Pause feedback (tap when paused resumes) */}
      {(tapFeedback || (!isPlaying && isActive && !streamError)) && (
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-black/50 backdrop-blur-sm">
            {tapFeedback === 'pause' || (!isPlaying && !tapFeedback) ? (
              <Play className="h-8 w-8 fill-white text-white ms-0.5" />
            ) : (
              <Pause className="h-8 w-8 fill-white text-white" />
            )}
          </div>
        </div>
      )}

      {/* Right/End Vertical Interaction Rail */}
      <div className="absolute end-3 bottom-16 z-20 flex flex-col items-center gap-3.5">
        <button
          type="button"
          onClick={togglePlay}
          aria-label={isPlaying ? t.playerPause : t.playerPlay}
          className="flex h-10 w-10 items-center justify-center rounded-full bg-black/50 text-white backdrop-blur-sm transition-colors hover:bg-black/75"
        >
          {isPlaying ? <Pause className="h-4 w-4 fill-white" /> : <Play className="h-4 w-4 fill-white ms-0.5" />}
        </button>
        <div className="relative mb-0.5">
          {reel.authorAvatar ? (
            <img
              src={reel.authorAvatar}
              alt={reel.authorName}
              className="h-11 w-11 rounded-full border-2 border-white object-cover bg-slate-800 shadow-lg"
            />
          ) : (
            <div className="flex h-11 w-11 items-center justify-center rounded-full border-2 border-white bg-red-600 text-sm font-bold text-white shadow-lg">
              {reel.authorName.slice(0, 1).toUpperCase()}
            </div>
          )}
        </div>

        <button
          type="button"
          onClick={() => setLiked((v) => !v)}
          aria-label={`${t.reelLike} ${reel.authorHandle}`}
          className="flex flex-col items-center gap-1 text-white"
        >
          <span
            className={`flex h-11 w-11 items-center justify-center rounded-full backdrop-blur-sm transition-transform active:scale-90 ${
              liked ? 'bg-red-600 text-white' : 'bg-black/45 text-white hover:bg-black/65'
            }`}
          >
            <Heart className={`h-5 w-5 ${liked ? 'fill-white' : ''}`} />
          </span>
          <span className="tabular-nums text-[11px] font-semibold drop-shadow-[0_1px_3px_rgba(0,0,0,0.95)]">
            {displayLikes}
          </span>
        </button>

        <div className="flex flex-col items-center gap-1 text-white">
          <span className="flex h-11 w-11 items-center justify-center rounded-full bg-black/45 backdrop-blur-sm">
            <MessageCircle className="h-5 w-5" />
          </span>
          <span className="tabular-nums text-[11px] font-semibold drop-shadow-[0_1px_3px_rgba(0,0,0,0.95)]">
            {displayComments}
          </span>
        </div>
      </div>

      {/* Bottom Gradient Caption + Creator Info */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 bg-gradient-to-t from-black/85 via-black/45 to-transparent px-4 pt-12 pb-4 pe-20 text-start">
        <div className="flex items-center gap-1.5">
          <span className="truncate text-sm font-bold text-white drop-shadow">{reel.authorName}</span>
          {reel.authorVerified && <BadgeCheck className="h-4 w-4 shrink-0 text-sky-400" />}
          <span className="truncate text-xs text-white/80 drop-shadow" dir="ltr">
            {reel.authorHandle}
          </span>
        </div>

        <button
          type="button"
          onClick={() => setCaptionExpanded((v) => !v)}
          className="pointer-events-auto mt-1 block w-full text-start"
        >
          <p
            className={`text-xs leading-relaxed text-white/95 drop-shadow sm:text-sm ${
              captionExpanded ? '' : 'line-clamp-2'
            }`}
          >
            {reel.caption}
          </p>
        </button>

        <div className="mt-2 flex items-center gap-2 text-[11px] text-white/90 drop-shadow">
          <Music2 className="h-3.5 w-3.5 shrink-0 animate-spin" style={{ animationDuration: '5s' }} />
          <span className="truncate">
            {reel.musicTitle
              ? reel.musicAuthor
                ? `${reel.musicTitle} — ${reel.musicAuthor}`
                : reel.musicTitle
              : t.reelOriginalSound}
          </span>
        </div>
      </div>

      {/* Edge-to-edge thin playback progress line */}
      <div dir="ltr" className="pointer-events-none absolute inset-x-0 bottom-0 z-30 h-[3px] bg-white/20">
        <div
          className="h-full bg-red-600 transition-[width] duration-150"
          style={{ width: `${Math.min(100, Math.max(0, progress))}%` }}
        />
      </div>
    </article>
  );
}

export function TikTokReelsView({
  locale,
  reels,
  category,
  searchQuery,
  loading,
  error,
  onSelectCategory,
  onSearchReels,
  onClearSearch,
  onRefresh,
  onOpenMenu,
}: TikTokReelsViewProps) {
  const t = getCopy(locale);
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  // Start unmuted by default (auto-play with sound)
  const [isMuted, setIsMuted] = useState(false);
  const [audioBlocked, setAudioBlocked] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [localSearchText, setLocalSearchText] = useState(searchQuery);

  useEffect(() => {
    setLocalSearchText(searchQuery);
  }, [searchQuery]);

  useEffect(() => {
    setActiveIndex(0);
    if (scrollerRef.current) {
      scrollerRef.current.scrollTo({ top: 0 });
    }
  }, [reels]);

  useEffect(() => {
    if (searchOpen) {
      window.setTimeout(() => searchInputRef.current?.focus(), 60);
    }
  }, [searchOpen]);

  // If browser blocked initial unmuted autoplay before gesture, unlock sound immediately on first touch/click/wheel
  useEffect(() => {
    if (!audioBlocked) return;
    const unlockSound = () => {
      setIsMuted(false);
      setAudioBlocked(false);
    };
    window.addEventListener('pointerdown', unlockSound, { once: true, passive: true });
    window.addEventListener('touchstart', unlockSound, { once: true, passive: true });
    window.addEventListener('wheel', unlockSound, { once: true, passive: true });
    return () => {
      window.removeEventListener('pointerdown', unlockSound);
      window.removeEventListener('touchstart', unlockSound);
      window.removeEventListener('wheel', unlockSound);
    };
  }, [audioBlocked]);

  useEffect(() => {
    const container = scrollerRef.current;
    if (!container || reels.length === 0) return;

    const slides = Array.from(container.querySelectorAll<HTMLElement>('[data-reel-index]'));
    if (slides.length === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting && entry.intersectionRatio >= 0.6) {
            const idx = Number(entry.target.getAttribute('data-reel-index'));
            if (Number.isFinite(idx)) {
              setActiveIndex(idx);
            }
          }
        }
      },
      { root: container, threshold: 0.6 },
    );

    slides.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [reels]);

  // Subtle keyboard ArrowUp/ArrowDown without any rendered arrow buttons
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;
      const container = scrollerRef.current;
      if (!container) return;
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        const nextIdx = Math.min(reels.length - 1, activeIndex + 1);
        container
          .querySelector<HTMLElement>(`[data-reel-index="${nextIdx}"]`)
          ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        const prevIdx = Math.max(0, activeIndex - 1);
        container
          .querySelector<HTMLElement>(`[data-reel-index="${prevIdx}"]`)
          ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [activeIndex, reels.length]);

  const handleSubmitSearch = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = localSearchText.trim();
    if (!trimmed) {
      onClearSearch();
      setSearchOpen(false);
      return;
    }
    onSearchReels(trimmed);
    setSearchOpen(false);
  };

  const activeReel = reels[activeIndex];

  return (
    <div
      data-testid="tiktok-fullscreen-stage"
      className="fixed inset-x-0 top-0 bottom-[calc(65px+env(safe-area-inset-bottom))] z-30 flex items-center justify-center overflow-hidden bg-black lg:relative lg:inset-auto lg:z-0 lg:h-[calc(100dvh-4rem)] lg:w-full"
    >
      {/* Subtle blurred cover ambient backdrop on wide desktop screens */}
      {activeReel?.coverUrl && (
        <img
          src={activeReel.coverUrl}
          alt=""
          aria-hidden="true"
          className="pointer-events-none hidden lg:block absolute inset-0 h-full w-full scale-110 object-cover opacity-35 blur-2xl"
        />
      )}

      {/* Edge-to-edge Reels Container (100% width & height on mobile, clean full-height reel on desktop) */}
      <div className="relative h-full w-full overflow-hidden bg-black lg:max-w-[460px]">
        {/* Floating Translucent Top Bar (Menu + Categories + Search + Sound) with Safe Area top offset */}
        <div className="pointer-events-none absolute inset-x-0 top-0 z-30 bg-gradient-to-b from-black/75 via-black/35 to-transparent px-3 pt-[calc(0.75rem+env(safe-area-inset-top))] pb-7">
          {searchOpen ? (
            <form
              onSubmit={handleSubmitSearch}
              className="pointer-events-auto flex items-center gap-2"
            >
              <div className="relative flex-1">
                <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/70" />
                <input
                  ref={searchInputRef}
                  type="search"
                  value={localSearchText}
                  onChange={(e) => setLocalSearchText(e.target.value)}
                  placeholder={t.reelsSearchPlaceholder}
                  aria-label={t.reelsSearchBtn}
                  className="h-10 w-full rounded-full border border-white/25 bg-black/70 ps-9 pe-3 text-sm text-white placeholder-white/60 backdrop-blur-md focus:border-white focus:outline-none"
                />
              </div>
              <button
                type="submit"
                className="h-10 shrink-0 rounded-full bg-red-600 px-4 text-xs font-bold text-white hover:bg-red-700"
              >
                {t.searchButton}
              </button>
              <button
                type="button"
                onClick={() => setSearchOpen(false)}
                aria-label={t.closeSearch}
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-black/60 text-white backdrop-blur-md hover:bg-black/80"
              >
                <X className="h-4 w-4" />
              </button>
            </form>
          ) : (
            <div className="pointer-events-auto flex items-center gap-2">
              <button
                type="button"
                onClick={onOpenMenu}
                aria-label={t.openSidebar}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-black/45 text-white backdrop-blur-md hover:bg-black/70 lg:hidden"
              >
                <Menu className="h-4 w-4" />
              </button>

              {/* Floating translucent category pills */}
              <div
                role="tablist"
                aria-label="Reels categories"
                className="flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto no-scrollbar"
              >
                {TIKTOK_CATEGORIES.map((cat) => {
                  const active = !searchQuery && category === cat;
                  return (
                    <button
                      key={cat}
                      type="button"
                      role="tab"
                      aria-selected={active}
                      onClick={() => {
                        if (searchQuery) onClearSearch();
                        onSelectCategory(cat);
                      }}
                      className={`h-8 shrink-0 whitespace-nowrap rounded-full px-3 text-xs font-semibold backdrop-blur-md transition-colors ${
                        active
                          ? 'bg-white text-black shadow-sm'
                          : 'bg-black/40 text-white/90 hover:bg-black/60'
                      }`}
                    >
                      {t.tiktokCategories[cat]}
                    </button>
                  );
                })}
              </div>

              {/* Dedicated Search Button inside Shorts */}
              <button
                type="button"
                onClick={() => setSearchOpen(true)}
                aria-label={t.reelsSearchBtn}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-black/45 text-white backdrop-blur-md hover:bg-black/70"
              >
                <Search className="h-4 w-4" />
              </button>

              {/* Mute / Unmute Toggle */}
              <button
                type="button"
                onClick={() => {
                  setAudioBlocked(false);
                  setIsMuted((m) => !m);
                }}
                aria-label={isMuted ? t.playerUnmute : t.playerMute}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-black/45 text-white backdrop-blur-md hover:bg-black/70"
              >
                {isMuted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
              </button>
            </div>
          )}

          {/* Active Search Filter Pill */}
          {searchQuery && !searchOpen && (
            <div className="pointer-events-auto mt-2 flex items-center gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-red-600/90 px-3 py-1 text-xs font-semibold text-white backdrop-blur-md">
                <Search className="h-3 w-3" />
                <span className="max-w-[180px] truncate">{searchQuery}</span>
                <button
                  type="button"
                  onClick={onClearSearch}
                  aria-label={t.reelsClearSearch}
                  className="ms-0.5 rounded-full p-0.5 hover:bg-black/25"
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            </div>
          )}
        </div>

        {/* Loading / Error / Empty / Fullscreen Vertical Swipe Scroller */}
        {loading ? (
          <div className="flex h-full w-full items-center justify-center bg-black text-white">
            <div className="flex flex-col items-center gap-3">
              <div className="h-10 w-10 animate-spin rounded-full border-3 border-white/25 border-t-red-600" />
              <p className="text-xs font-medium text-white/80">{t.loadingMore}</p>
            </div>
          </div>
        ) : error ? (
          <div className="flex h-full w-full flex-col items-center justify-center bg-black px-6 text-center text-white">
            <p className="text-sm font-semibold text-red-400">{t.errorTitle}</p>
            <p className="mt-1 text-xs text-white/70">{error}</p>
            <button
              type="button"
              onClick={onRefresh}
              className="mt-4 inline-flex items-center gap-2 rounded-full bg-red-600 px-5 py-2.5 text-xs font-semibold text-white hover:bg-red-700"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              <span>{t.retry}</span>
            </button>
          </div>
        ) : reels.length === 0 ? (
          <div className="flex h-full w-full flex-col items-center justify-center bg-black px-6 text-center text-white">
            <Search className="h-10 w-10 text-white/40" />
            <p className="mt-3 text-sm font-semibold text-white">{t.reelsSearchEmpty}</p>
            <button
              type="button"
              onClick={onClearSearch}
              className="mt-4 rounded-full bg-red-600 px-5 py-2.5 text-xs font-semibold text-white hover:bg-red-700"
            >
              {t.reelsClearSearch}
            </button>
          </div>
        ) : (
          <div
            ref={scrollerRef}
            data-testid="tiktok-reels-scroller"
            style={{ WebkitOverflowScrolling: 'touch' }}
            className="h-full w-full snap-y snap-mandatory overflow-y-auto overscroll-y-contain touch-pan-y scroll-smooth no-scrollbar"
          >
            {reels.map((reel, idx) => (
              <ReelSlide
                key={reel.id}
                reel={reel}
                index={idx}
                isActive={idx === activeIndex}
                isPreload={idx === activeIndex + 1 || idx === activeIndex + 2 || idx === activeIndex - 1}
                isMuted={isMuted}
                locale={locale}
                onAudioAutoBlocked={() => {
                  setAudioBlocked(true);
                  setIsMuted(true);
                }}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
