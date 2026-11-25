import React, { useState } from 'react';
import {
  Bookmark,
  BookmarkCheck,
  CheckCircle2,
  Play,
} from 'lucide-react';
import type { AppLocale, MediaVideo } from '../shared/types.ts';
import { getCopy } from '../utils/i18n.ts';

interface VideoCardProps {
  video: MediaVideo;
  locale: AppLocale;
  isSaved: boolean;
  fullWidth?: boolean;
  onWatch: (video: MediaVideo) => void;
  onToggleSave: (video: MediaVideo) => void;
  onOpenChannel?: (channelId: string) => void;
}

export function VideoCard({
  video,
  locale,
  isSaved,
  fullWidth = false,
  onWatch,
  onToggleSave,
  onOpenChannel,
}: VideoCardProps) {
  const t = getCopy(locale);
  const [imgError, setImgError] = useState(false);

  return (
    <article
      className={`group flex w-full flex-col overflow-hidden border border-slate-200 bg-white transition-colors hover:border-slate-300 dark:border-slate-800 dark:bg-slate-900 dark:hover:border-slate-700 ${
        fullWidth
          ? 'rounded-none border-x-0 shadow-xs sm:rounded-2xl sm:border-x'
          : 'rounded-2xl'
      }`}
    >
      <button
        type="button"
        onClick={() => onWatch(video)}
        aria-label={`${t.watchVideo}: ${video.title}`}
        className={`relative aspect-video w-full overflow-hidden bg-slate-900 text-start focus-visible:outline-2 focus-visible:outline-red-600 ${
          fullWidth ? 'max-h-[480px]' : ''
        }`}
      >
        {!imgError && video.thumbnail ? (
          <img
            src={video.thumbnail}
            alt={video.title}
            loading="lazy"
            referrerPolicy="no-referrer"
            onError={() => setImgError(true)}
            className="h-full w-full object-cover transition-transform duration-200 group-hover:scale-[1.02]"
          />
        ) : (
          <div className="flex h-full w-full flex-col items-center justify-center gap-2 bg-gradient-to-br from-slate-800 to-slate-950 p-4 text-center text-slate-300">
            <Play className="h-8 w-8 text-red-500" />
            <span className="line-clamp-2 text-xs font-medium">{video.title}</span>
          </div>
        )}

        <span
          className={`tabular-nums absolute bottom-2.5 end-2.5 rounded-md px-2 py-0.5 text-xs font-semibold ${
            video.isLive ? 'bg-red-600 text-white' : 'bg-slate-950/85 text-white'
          }`}
        >
          {video.isLive ? t.liveLabel : video.duration}
        </span>
      </button>

      <div className={`flex flex-1 flex-col justify-between gap-3.5 ${fullWidth ? 'p-4 sm:p-5' : 'p-3.5 sm:p-4'}`}>
        <div className="flex items-start gap-3">
          {fullWidth && (
            video.channelAvatar ? (
              <img
                src={video.channelAvatar}
                alt={video.channelName}
                loading="lazy"
                referrerPolicy="no-referrer"
                className="mt-0.5 h-10 w-10 shrink-0 rounded-full bg-slate-200 object-cover dark:bg-slate-800"
              />
            ) : (
              <div className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-red-600 text-sm font-bold text-white">
                {video.channelName.slice(0, 1).toUpperCase()}
              </div>
            )
          )}

          <div className="min-w-0 flex-1 space-y-1.5">
            <button
              type="button"
              onClick={() => onWatch(video)}
              className="block w-full text-start focus-visible:outline-2 focus-visible:outline-red-600"
            >
              <h3
                className={`line-clamp-2 font-semibold leading-snug text-slate-900 transition-colors group-hover:text-red-600 dark:text-slate-100 dark:group-hover:text-red-400 ${
                  fullWidth ? 'text-base font-bold sm:text-lg' : 'text-sm'
                }`}
              >
                {video.title}
              </h3>
            </button>

            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500 sm:text-sm dark:text-slate-400">
              {video.channelId && onOpenChannel ? (
                <button
                  type="button"
                  onClick={() => onOpenChannel(video.channelId)}
                  className="inline-flex items-center gap-1 font-medium text-slate-700 hover:text-red-600 focus-visible:outline-2 focus-visible:outline-red-600 dark:text-slate-300 dark:hover:text-red-400"
                >
                  <span className="truncate max-w-[200px] sm:max-w-xs">{video.channelName}</span>
                  {video.channelVerified && <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-slate-400" />}
                </button>
              ) : (
                <span className="inline-flex items-center gap-1 font-medium text-slate-700 dark:text-slate-300">
                  <span className="truncate max-w-[200px] sm:max-w-xs">{video.channelName}</span>
                </span>
              )}

              {video.viewsText && (
                <>
                  <span aria-hidden="true">·</span>
                  <span className="tabular-nums">{video.viewsText}</span>
                </>
              )}

              {video.publishedText && (
                <>
                  <span aria-hidden="true">·</span>
                  <span>{video.publishedText}</span>
                </>
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between gap-2 border-t border-slate-100 pt-3 dark:border-slate-800">
          <button
            type="button"
            onClick={() => onWatch(video)}
            className="inline-flex h-9 items-center gap-1.5 rounded-xl px-2.5 text-xs font-semibold text-red-600 transition-colors hover:bg-red-50 focus-visible:outline-2 focus-visible:outline-red-600 sm:px-3 sm:text-sm dark:text-red-400 dark:hover:bg-red-950/40"
          >
            <Play className="h-4 w-4" />
            <span>{t.watchVideo}</span>
          </button>

          <button
            type="button"
            onClick={() => onToggleSave(video)}
            aria-label={`${isSaved ? t.savedVideo : t.saveVideo}: ${video.title}`}
            className={`inline-flex h-9 w-9 items-center justify-center rounded-xl transition-colors focus-visible:outline-2 focus-visible:outline-red-600 ${
              isSaved
                ? 'bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900'
                : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white'
            }`}
          >
            {isSaved ? <BookmarkCheck className="h-4 w-4" /> : <Bookmark className="h-4 w-4" />}
          </button>
        </div>
      </div>
    </article>
  );
}
