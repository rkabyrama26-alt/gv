import React, { useEffect, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Bell,
  BellRing,
  Bookmark,
  BookmarkCheck,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  MessageSquare,
  Play,
  ThumbsUp,
  UserRound,
} from 'lucide-react';
import type {
  AppLocale,
  MediaComment,
  MediaVideo,
  VideoDetailsResponse,
} from '../shared/types.ts';
import { getCopy } from '../utils/i18n.ts';
import { buildWatchInlineMeta } from '../utils/playerControls.ts';
import { DramaVideoPlayer } from './DramaVideoPlayer.tsx';

interface VideoWatchViewProps {
  locale: AppLocale;
  details: VideoDetailsResponse | null;
  loading: boolean;
  error: string | null;
  fallbackVideo: MediaVideo | null;
  savedIds: Set<string>;
  subscribedIds: Set<string>;
  onBack: () => void;
  onSelectVideo: (video: MediaVideo) => void;
  onToggleSave: (video: MediaVideo) => void;
  onToggleSubscribe: (channel: {
    id: string;
    name: string;
    avatar?: string;
    subscribersText?: string;
  }) => void;
  onOpenChannel: (channelId: string) => void;
}

export function VideoWatchView({
  locale,
  details,
  loading,
  error,
  fallbackVideo,
  savedIds,
  subscribedIds,
  onBack,
  onSelectVideo,
  onToggleSave,
  onToggleSubscribe,
  onOpenChannel,
}: VideoWatchViewProps) {
  const t = getCopy(locale);
  const [descExpanded, setDescExpanded] = useState(false);
  const [theaterMode, setTheaterMode] = useState(false);
  const [commentsOpen, setCommentsOpen] = useState(false);
  const [liked, setLiked] = useState(false);
  const [brokenThumbs, setBrokenThumbs] = useState<Set<string>>(() => new Set());

  const activeVideo = details?.video || fallbackVideo;
  const BackArrow = locale === 'ar' ? ArrowRight : ArrowLeft;

  useEffect(() => {
    setCommentsOpen(false);
    setDescExpanded(false);
    setLiked(false);
  }, [activeVideo?.id]);

  if (error && !activeVideo) {
    return (
      <div className="mx-3 mt-3 rounded-2xl border border-red-200 bg-white p-6 text-center sm:mx-0 sm:mt-0 sm:p-8 dark:border-red-900/50 dark:bg-slate-900">
        <p className="text-base font-semibold text-red-600 dark:text-red-400">{t.errorTitle}</p>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">{error}</p>
        <div className="mt-4 flex flex-wrap justify-center gap-3">
          <button
            type="button"
            onClick={onBack}
            className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            {t.backToList}
          </button>
        </div>
      </div>
    );
  }

  if (!activeVideo) {
    return null;
  }

  const isSaved = savedIds.has(activeVideo.id);
  const isXtreamStream = activeVideo.streamUrl.startsWith('/api/xtream/');
  const channelKey = activeVideo.channelId || activeVideo.channelName;
  const isSubscribed = subscribedIds.has(channelKey);
  const allComments: MediaComment[] = details?.comments || [];
  const relatedList: MediaVideo[] = details?.related || [];
  const topComment = allComments[0];

  const inlineMetaItems = buildWatchInlineMeta({
    channelName: undefined,
    viewsText: activeVideo.viewsText,
    publishedText: details?.video?.uploadDateText || activeVideo.publishedText,
  });

  const markBrokenThumb = (id: string) => {
    setBrokenThumbs((prev) => {
      if (prev.has(id)) return prev;
      const next = new Set(prev);
      next.add(id);
      return next;
    });
  };

  const playerNode = (
    <DramaVideoPlayer
      videoId={activeVideo.id}
      streamUrl={activeVideo.streamUrl}
      title={activeVideo.title}
      thumbnail={activeVideo.thumbnail}
      knownDurationSeconds={activeVideo.durationSeconds}
      locale={locale}
      theaterMode={theaterMode}
      onToggleTheater={() => setTheaterMode((v) => !v)}
      onBack={onBack}
    />
  );

  return (
    <div data-testid="watch-view-root" className="space-y-3 sm:space-y-5">
      {/* Slim Desktop Back Breadcrumb (Mobile uses flush player + player top-bar Back) */}
      <div className="hidden items-center justify-between gap-3 sm:flex">
        <button
          type="button"
          onClick={onBack}
          data-testid="watch-desktop-back"
          className="inline-flex h-9 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3.5 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-red-600 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
        >
          <BackArrow className="h-4 w-4" />
          <span>{t.backToList}</span>
        </button>
      </div>

      {theaterMode && <div className="w-full">{playerNode}</div>}

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-12 xl:gap-6">
        {/* Main Player + Compact Info + Quick Actions + Comments Preview */}
        <div className="min-w-0 space-y-3.5 sm:space-y-4 xl:col-span-8">
          {!theaterMode && playerNode}

          {/* Title, Inline Metadata & Expandable Description */}
          <div data-testid="watch-info-block" className="space-y-3 px-3.5 sm:px-0">
            <div className="space-y-1.5">
              <h1 className="text-balance text-[17px] font-bold leading-snug text-slate-900 sm:text-xl lg:text-2xl dark:text-white">
                {activeVideo.title}
              </h1>

              {(inlineMetaItems.length > 0 || Boolean(details?.video?.description)) && (
                <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-slate-500 sm:text-[13px] dark:text-slate-400">
                  {inlineMetaItems.map((item, idx) => (
                    <React.Fragment key={`${item}-${idx}`}>
                      {idx > 0 && <span aria-hidden="true">·</span>}
                      <span className="tabular-nums">{item}</span>
                    </React.Fragment>
                  ))}
                  {details?.video?.description && (
                    <>
                      {inlineMetaItems.length > 0 && <span aria-hidden="true">·</span>}
                      <button
                        type="button"
                        onClick={() => setDescExpanded((v) => !v)}
                        data-testid="watch-more-toggle"
                        aria-expanded={descExpanded}
                        className="font-semibold text-slate-900 hover:text-red-600 focus-visible:outline-2 focus-visible:outline-red-600 dark:text-slate-100 dark:hover:text-red-400"
                      >
                        {descExpanded ? t.showLess : `... ${t.moreInline}`}
                      </button>
                    </>
                  )}
                </div>
              )}
            </div>

            {descExpanded && details?.video?.description && (
              <div
                data-testid="watch-description-panel"
                className="rounded-xl border border-slate-200/80 bg-slate-100/85 p-3.5 text-sm leading-relaxed text-slate-700 dark:border-slate-800 dark:bg-slate-900/90 dark:text-slate-300"
              >
                <p className="whitespace-pre-line break-words">{details.video.description}</p>
              </div>
            )}

            {/* Channel Identity + Primary Subscribe Action */}
            <div className="flex items-center justify-between gap-3 pt-0.5">
              <div className="flex min-w-0 items-center gap-2.5 sm:gap-3">
                {activeVideo.channelAvatar ? (
                  <img
                    src={activeVideo.channelAvatar}
                    alt={activeVideo.channelName}
                    referrerPolicy="no-referrer"
                    className="h-9 w-9 shrink-0 rounded-full bg-slate-200 object-cover sm:h-10 sm:w-10 dark:bg-slate-800"
                  />
                ) : (
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-red-600 text-sm font-bold text-white sm:h-10 sm:w-10">
                    {activeVideo.channelName.slice(0, 1).toUpperCase()}
                  </div>
                )}

                <div className="min-w-0">
                  {activeVideo.channelId ? (
                    <button
                      type="button"
                      onClick={() => onOpenChannel(activeVideo.channelId)}
                      className="inline-flex max-w-full items-center gap-1 text-sm font-bold text-slate-900 hover:text-red-600 focus-visible:outline-2 focus-visible:outline-red-600 dark:text-white dark:hover:text-red-400"
                    >
                      <span className="truncate">{activeVideo.channelName}</span>
                      {activeVideo.channelVerified && (
                        <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                      )}
                    </button>
                  ) : (
                    <p className="truncate text-sm font-bold text-slate-900 dark:text-white">
                      {activeVideo.channelName}
                    </p>
                  )}

                  {details?.video?.subscribersText && (
                    <p className="truncate tabular-nums text-[11px] text-slate-500 sm:text-xs dark:text-slate-400">
                      {details.video.subscribersText}
                    </p>
                  )}
                </div>
              </div>

              {!isXtreamStream && (
                <button
                  type="button"
                  onClick={() =>
                    onToggleSubscribe({
                      id: channelKey,
                      name: activeVideo.channelName,
                      avatar: activeVideo.channelAvatar,
                      subscribersText: details?.video?.subscribersText,
                    })
                  }
                  data-testid="watch-subscribe-button"
                  className={`inline-flex h-9 shrink-0 items-center gap-1.5 rounded-xl px-4 text-xs font-semibold whitespace-nowrap transition-colors focus-visible:outline-2 focus-visible:outline-red-600 ${
                    isSubscribed
                      ? 'border border-slate-200 bg-slate-100 text-slate-900 hover:bg-slate-200 dark:border-slate-700 dark:bg-slate-800 dark:text-white dark:hover:bg-slate-700'
                      : 'bg-red-600 text-white hover:bg-red-700'
                  }`}
                >
                  {isSubscribed ? <BellRing className="h-3.5 w-3.5" /> : <Bell className="h-3.5 w-3.5" />}
                  <span>{isSubscribed ? t.subscribed : t.subscribe}</span>
                </button>
              )}
            </div>

            {/* Horizontal Quick Action Strip (Like, Save, View Channel) */}
            <div
              data-testid="watch-actions-strip"
              className="flex items-center gap-1.5 overflow-x-auto pt-0.5 no-scrollbar sm:gap-2"
            >
              <button
                type="button"
                onClick={() => setLiked((v) => !v)}
                aria-pressed={liked}
                data-testid="watch-like-button"
                className={`inline-flex h-9 shrink-0 items-center gap-1.5 rounded-xl border px-3 text-xs font-semibold whitespace-nowrap transition-colors focus-visible:outline-2 focus-visible:outline-red-600 sm:px-3.5 ${
                  liked
                    ? 'border-red-500/40 bg-red-600/10 text-red-600 dark:border-red-500/40 dark:bg-red-500/15 dark:text-red-400'
                    : 'border-slate-200 bg-slate-100/90 text-slate-800 hover:bg-slate-200/80 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800'
                }`}
              >
                <ThumbsUp className={`h-3.5 w-3.5 ${liked ? 'fill-current' : ''}`} />
                <span className="tabular-nums">
                  {details?.video?.likesText || (liked ? t.likedVideo : t.likeVideo)}
                </span>
              </button>

              <button
                type="button"
                onClick={() => onToggleSave(activeVideo)}
                aria-pressed={isSaved}
                data-testid="watch-save-button"
                className={`inline-flex h-9 shrink-0 items-center gap-1.5 rounded-xl border px-3 text-xs font-semibold whitespace-nowrap transition-colors focus-visible:outline-2 focus-visible:outline-red-600 sm:px-3.5 ${
                  isSaved
                    ? 'border-slate-900 bg-slate-900 text-white dark:border-slate-100 dark:bg-slate-100 dark:text-slate-900'
                    : 'border-slate-200 bg-slate-100/90 text-slate-800 hover:bg-slate-200/80 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800'
                }`}
              >
                {isSaved ? <BookmarkCheck className="h-3.5 w-3.5" /> : <Bookmark className="h-3.5 w-3.5" />}
                <span>{isSaved ? t.savedVideo : t.saveVideo}</span>
              </button>

              {activeVideo.channelId && (
                <button
                  type="button"
                  onClick={() => onOpenChannel(activeVideo.channelId)}
                  className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-xl border border-slate-200 bg-slate-100/90 px-3 text-xs font-semibold whitespace-nowrap text-slate-800 transition-colors hover:bg-slate-200/80 focus-visible:outline-2 focus-visible:outline-red-600 sm:px-3.5 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
                >
                  <UserRound className="h-3.5 w-3.5" />
                  <span>{t.viewChannel}</span>
                </button>
              )}
            </div>

            {loading && !details?.video?.description && (
              <div className="space-y-2 pt-1">
                <div className="h-3.5 w-3/4 animate-pulse rounded bg-slate-200 dark:bg-slate-800" />
                <div className="h-3.5 w-1/2 animate-pulse rounded bg-slate-200 dark:bg-slate-800" />
              </div>
            )}

            {/* Compact Comments Preview Card (Tap to Expand) */}
            {(!isXtreamStream || allComments.length > 0) && (
              <section
                aria-label={t.commentsHeading}
                className="overflow-hidden rounded-2xl border border-slate-200/90 bg-slate-100/85 dark:border-slate-800 dark:bg-slate-900/90"
              >
                <button
                  type="button"
                  onClick={() => setCommentsOpen((v) => !v)}
                  aria-expanded={commentsOpen}
                  data-testid="comments-toggle-button"
                  className="w-full space-y-2 p-3 text-start transition-colors hover:bg-slate-200/50 sm:p-3.5 dark:hover:bg-slate-800/60"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <MessageSquare className="h-4 w-4 shrink-0 text-red-600 dark:text-red-400" />
                      <span className="text-sm font-bold text-slate-900 dark:text-white">
                        {t.commentsHeading}
                      </span>
                      {!loading && (
                        <span className="tabular-nums text-xs font-semibold text-slate-500 dark:text-slate-400">
                          {allComments.length}
                        </span>
                      )}
                    </div>

                    <span className="inline-flex items-center gap-1 text-xs font-medium text-slate-500 dark:text-slate-400">
                      <span className="hidden sm:inline">
                        {commentsOpen ? t.commentsHidePrompt : t.commentsTogglePrompt}
                      </span>
                      {commentsOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                    </span>
                  </div>

                  {!commentsOpen && (
                    <div className="flex items-center gap-2.5 rounded-xl bg-white/90 px-3 py-2 text-xs text-slate-600 dark:bg-slate-950/75 dark:text-slate-300">
                      {topComment?.authorAvatar ? (
                        <img
                          src={topComment.authorAvatar}
                          alt={topComment.authorName}
                          referrerPolicy="no-referrer"
                          className="h-6 w-6 shrink-0 rounded-full object-cover"
                        />
                      ) : (
                        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-red-600 text-[10px] font-bold text-white">
                          {topComment
                            ? topComment.authorName.replace(/^@/, '').slice(0, 1).toUpperCase()
                            : activeVideo.channelName.slice(0, 1).toUpperCase()}
                        </span>
                      )}
                      <span className="min-w-0 flex-1 truncate">
                        {loading
                          ? t.loadingMore
                          : topComment
                            ? `${topComment.authorName}: ${topComment.text}`
                            : t.commentsTogglePrompt}
                      </span>
                    </div>
                  )}
                </button>

                {commentsOpen && (
                  <div
                    data-testid="comments-list-panel"
                    className="space-y-4 border-t border-slate-200/80 bg-white/80 p-3.5 sm:p-4 dark:border-slate-800 dark:bg-slate-950/40"
                  >
                    {loading ? (
                      <div className="space-y-3">
                        {Array.from({ length: 3 }).map((_, i) => (
                          <div key={i} className="flex gap-3">
                            <div className="h-8 w-8 shrink-0 animate-pulse rounded-full bg-slate-200 dark:bg-slate-800" />
                            <div className="flex-1 space-y-2">
                              <div className="h-3 w-1/3 animate-pulse rounded bg-slate-200 dark:bg-slate-800" />
                              <div className="h-3 w-5/6 animate-pulse rounded bg-slate-200 dark:bg-slate-800" />
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : allComments.length === 0 ? (
                      <p className="py-3 text-center text-sm text-slate-500 dark:text-slate-400">
                        {t.commentsEmpty}
                      </p>
                    ) : (
                      <div className="space-y-4 divide-y divide-slate-200/70 dark:divide-slate-800">
                        {allComments.map((comment) => (
                          <article key={comment.id} className="flex gap-3 pt-4 first:pt-0">
                            {comment.authorAvatar ? (
                              <img
                                src={comment.authorAvatar}
                                alt={comment.authorName}
                                loading="lazy"
                                referrerPolicy="no-referrer"
                                className="h-8 w-8 shrink-0 rounded-full bg-slate-200 object-cover dark:bg-slate-800"
                              />
                            ) : (
                              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-800 text-xs font-bold text-white dark:bg-slate-700">
                                {comment.authorName.replace(/^@/, '').slice(0, 1).toUpperCase()}
                              </div>
                            )}

                            <div className="min-w-0 flex-1 space-y-1">
                              <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
                                <span className="font-semibold text-slate-900 dark:text-white">
                                  {comment.authorName}
                                </span>
                                {comment.isCreator && (
                                  <span className="font-semibold text-red-600 dark:text-red-400">
                                    · {t.creatorBadge}
                                  </span>
                                )}
                                {comment.publishedText && (
                                  <>
                                    <span aria-hidden="true" className="text-slate-400">·</span>
                                    <span className="text-slate-500 dark:text-slate-400">
                                      {comment.publishedText}
                                    </span>
                                  </>
                                )}
                              </div>

                              <p className="whitespace-pre-line break-words text-sm leading-relaxed text-slate-700 dark:text-slate-300">
                                {comment.text}
                              </p>

                              <div className="flex items-center gap-3 pt-0.5 text-xs tabular-nums text-slate-500 dark:text-slate-400">
                                <span className="inline-flex items-center gap-1">
                                  <ThumbsUp className="h-3 w-3" />
                                  <span>{comment.likesText || '0'}</span>
                                </span>
                                {comment.replyCountText && (
                                  <>
                                    <span aria-hidden="true">·</span>
                                    <span>
                                      {comment.replyCountText} {locale === 'ar' ? 'ردود' : 'replies'}
                                    </span>
                                  </>
                                )}
                              </div>
                            </div>
                          </article>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </section>
            )}
          </div>

          {/* Mobile & Tablet Full-Bleed Related Videos Feed (Matches Reference Rhythm) */}
          <section
            aria-label={activeVideo.id.startsWith('xtream_ep_') ? t.nextEpisodes : t.relatedVideos}
            data-testid="watch-related-mobile"
            className="space-y-4 border-t border-slate-200/80 pt-3 xl:hidden dark:border-slate-800"
          >
            <h2 className="px-3.5 text-sm font-bold text-slate-900 sm:px-0 sm:text-base dark:text-white">
              {activeVideo.id.startsWith('xtream_ep_') ? t.nextEpisodes : t.relatedVideos}
            </h2>

            {loading ? (
              <div className="space-y-5">
                {Array.from({ length: 4 }).map((_, idx) => (
                  <div key={idx} className="space-y-2.5">
                    <div className="aspect-video w-full animate-pulse bg-slate-200 sm:rounded-2xl dark:bg-slate-800" />
                    <div className="flex gap-3 px-3.5 sm:px-0">
                      <div className="h-9 w-9 shrink-0 animate-pulse rounded-full bg-slate-200 dark:bg-slate-800" />
                      <div className="flex-1 space-y-2">
                        <div className="h-4 w-5/6 animate-pulse rounded bg-slate-200 dark:bg-slate-800" />
                        <div className="h-3 w-1/2 animate-pulse rounded bg-slate-200 dark:bg-slate-800" />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="space-y-5">
                {relatedList.map((rel) => {
                  const thumbMissing = !rel.thumbnail || brokenThumbs.has(rel.id);
                  return (
                    <article key={rel.id} className="group">
                      <button
                        type="button"
                        onClick={() => onSelectVideo(rel)}
                        className="block w-full text-start focus-visible:outline-2 focus-visible:outline-red-600"
                      >
                        <div className="relative aspect-video w-full overflow-hidden bg-slate-900 sm:rounded-2xl">
                          {!thumbMissing ? (
                            <img
                              src={rel.thumbnail}
                              alt={rel.title}
                              loading="lazy"
                              referrerPolicy="no-referrer"
                              onError={() => markBrokenThumb(rel.id)}
                              className="h-full w-full object-cover transition-transform duration-200 group-hover:scale-[1.02]"
                            />
                          ) : (
                            <div className="flex h-full w-full flex-col items-center justify-center gap-2 bg-gradient-to-br from-slate-800 to-slate-950 p-4 text-center text-slate-300">
                              <Play className="h-8 w-8 text-red-500" />
                              <span className="line-clamp-2 text-xs font-medium">{rel.title}</span>
                            </div>
                          )}

                          <span
                            className={`tabular-nums absolute bottom-2 end-2 rounded-md px-1.5 py-0.5 text-[11px] font-semibold ${
                              rel.isLive ? 'bg-red-600 text-white' : 'bg-slate-950/85 text-white'
                            }`}
                          >
                            {rel.isLive ? t.liveLabel : rel.duration}
                          </span>
                        </div>
                      </button>

                      <div className="flex items-start gap-3 px-3.5 pt-2.5 sm:px-0">
                        {rel.channelAvatar ? (
                          <img
                            src={rel.channelAvatar}
                            alt={rel.channelName}
                            loading="lazy"
                            referrerPolicy="no-referrer"
                            className="mt-0.5 h-9 w-9 shrink-0 rounded-full bg-slate-200 object-cover dark:bg-slate-800"
                          />
                        ) : (
                          <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-slate-800 text-xs font-bold text-white dark:bg-slate-700">
                            {rel.channelName.slice(0, 1).toUpperCase()}
                          </div>
                        )}

                        <div className="min-w-0 flex-1 space-y-1">
                          <button
                            type="button"
                            onClick={() => onSelectVideo(rel)}
                            className="block w-full text-start focus-visible:outline-2 focus-visible:outline-red-600"
                          >
                            <h3 className="line-clamp-2 text-sm font-bold leading-snug text-slate-900 group-hover:text-red-600 dark:text-slate-100 dark:group-hover:text-red-400">
                              {rel.title}
                            </h3>
                          </button>

                          <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-slate-500 dark:text-slate-400">
                            {rel.channelId ? (
                              <button
                                type="button"
                                onClick={() => onOpenChannel(rel.channelId)}
                                className="truncate max-w-[180px] font-medium hover:text-red-600 dark:hover:text-red-400"
                              >
                                {rel.channelName}
                              </button>
                            ) : (
                              <span className="truncate max-w-[180px] font-medium">{rel.channelName}</span>
                            )}
                            {rel.viewsText && (
                              <>
                                <span aria-hidden="true">·</span>
                                <span className="tabular-nums">{rel.viewsText}</span>
                              </>
                            )}
                            {rel.publishedText && (
                              <>
                                <span aria-hidden="true">·</span>
                                <span>{rel.publishedText}</span>
                              </>
                            )}
                          </div>
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </section>
        </div>

        {/* Desktop Sidebar Related Videos Column */}
        <aside
          data-testid="watch-related-desktop"
          className="hidden min-w-0 space-y-3 xl:col-span-4 xl:block"
        >
          <h2 className="text-base font-bold text-slate-900 dark:text-white">
            {activeVideo.id.startsWith('xtream_ep_') ? t.nextEpisodes : t.relatedVideos}
          </h2>

          {loading ? (
            <div className="space-y-3">
              {Array.from({ length: 6 }).map((_, idx) => (
                <div
                  key={idx}
                  className="flex gap-3 rounded-xl border border-slate-200 bg-white p-2 dark:border-slate-800 dark:bg-slate-900"
                >
                  <div className="aspect-video w-40 shrink-0 animate-pulse rounded-lg bg-slate-200 dark:bg-slate-800" />
                  <div className="flex-1 space-y-2 py-1">
                    <div className="h-3.5 w-full animate-pulse rounded bg-slate-200 dark:bg-slate-800" />
                    <div className="h-3 w-2/3 animate-pulse rounded bg-slate-200 dark:bg-slate-800" />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="space-y-2.5">
              {relatedList.map((rel) => {
                const thumbMissing = !rel.thumbnail || brokenThumbs.has(rel.id);
                return (
                  <div
                    key={rel.id}
                    className="flex items-stretch gap-2 rounded-xl border border-slate-200/80 bg-white p-2 transition-colors hover:border-slate-300 dark:border-slate-800 dark:bg-slate-900 dark:hover:border-slate-700"
                  >
                    <button
                      type="button"
                      onClick={() => onSelectVideo(rel)}
                      className="group flex min-w-0 flex-1 gap-3 text-start focus-visible:outline-2 focus-visible:outline-red-600"
                    >
                      <div className="relative aspect-video w-40 shrink-0 overflow-hidden rounded-lg bg-slate-900">
                        {!thumbMissing ? (
                          <img
                            src={rel.thumbnail}
                            alt={rel.title}
                            loading="lazy"
                            referrerPolicy="no-referrer"
                            onError={() => markBrokenThumb(rel.id)}
                            className="h-full w-full object-cover transition-transform duration-200 group-hover:scale-[1.03]"
                          />
                        ) : (
                          <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-slate-800 to-slate-950">
                            <Play className="h-5 w-5 text-red-500" />
                          </div>
                        )}
                        <span
                          className={`tabular-nums absolute bottom-1 end-1 rounded px-1 py-0.5 text-[11px] font-medium ${
                            rel.isLive ? 'bg-red-600 text-white' : 'bg-slate-950/85 text-white'
                          }`}
                        >
                          {rel.isLive ? t.liveLabel : rel.duration}
                        </span>
                      </div>
                      <div className="min-w-0 flex-1 space-y-1">
                        <p className="line-clamp-2 text-xs font-semibold leading-snug text-slate-900 group-hover:text-red-600 dark:text-slate-100 dark:group-hover:text-red-400">
                          {rel.title}
                        </p>
                        <p className="truncate text-[11px] font-medium text-slate-500 dark:text-slate-400">
                          {rel.channelName}
                        </p>
                        {(rel.viewsText || rel.publishedText) && (
                          <p className="truncate tabular-nums text-[11px] text-slate-400 dark:text-slate-500">
                            {[rel.viewsText, rel.publishedText].filter(Boolean).join(' · ')}
                          </p>
                        )}
                      </div>
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}

