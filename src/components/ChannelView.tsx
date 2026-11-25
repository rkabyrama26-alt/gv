import React from 'react';
import { ArrowLeft, ArrowRight, Bell, BellRing } from 'lucide-react';
import type { AppLocale, ChannelResponse, MediaVideo } from '../shared/types.ts';
import { getCopy } from '../utils/i18n.ts';
import { VideoCard } from './VideoCard.tsx';

interface ChannelViewProps {
  locale: AppLocale;
  data: ChannelResponse | null;
  loading: boolean;
  error: string | null;
  savedIds: Set<string>;
  subscribedIds: Set<string>;
  onBack: () => void;
  onWatch: (video: MediaVideo) => void;
  onToggleSave: (video: MediaVideo) => void;
  onToggleSubscribe: (channel: {
    id: string;
    name: string;
    avatar?: string;
    subscribersText?: string;
  }) => void;
}

export function ChannelView({
  locale,
  data,
  loading,
  error,
  savedIds,
  subscribedIds,
  onBack,
  onWatch,
  onToggleSave,
  onToggleSubscribe,
}: ChannelViewProps) {
  const t = getCopy(locale);
  const BackArrow = locale === 'ar' ? ArrowRight : ArrowLeft;
  const isSubscribed = data ? subscribedIds.has(data.channel.id) : false;

  return (
    <div className="space-y-6">
      <button
        type="button"
        onClick={onBack}
        className="inline-flex h-10 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3.5 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
      >
        <BackArrow className="h-4 w-4" />
        <span>{t.backToList}</span>
      </button>

      {loading && (
        <div className="space-y-4">
          <div className="h-36 w-full animate-pulse rounded-xl bg-slate-200 dark:bg-slate-800" />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="aspect-video animate-pulse rounded-xl bg-slate-200 dark:bg-slate-800" />
            ))}
          </div>
        </div>
      )}

      {error && !loading && (
        <div className="rounded-xl border border-red-200 bg-white p-6 text-center sm:p-8 dark:border-red-900/50 dark:bg-slate-900">
          <p className="text-sm font-semibold text-red-600 dark:text-red-400">{error}</p>
        </div>
      )}

      {data && !loading && (
        <>
          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
            {data.channel.banner && (
              <div className="h-28 w-full overflow-hidden bg-slate-900 sm:h-44">
                <img
                  src={data.channel.banner}
                  alt={data.channel.name}
                  referrerPolicy="no-referrer"
                  className="h-full w-full object-cover"
                />
              </div>
            )}
            <div className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-6">
              <div className="flex min-w-0 items-center gap-3.5 sm:gap-4">
                {data.channel.avatar ? (
                  <img
                    src={data.channel.avatar}
                    alt={data.channel.name}
                    referrerPolicy="no-referrer"
                    className="h-14 w-14 shrink-0 rounded-full object-cover bg-slate-200 sm:h-16 sm:w-16 dark:bg-slate-800"
                  />
                ) : (
                  <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-red-600 text-xl font-bold text-white sm:h-16 sm:w-16">
                    {data.channel.name.slice(0, 1).toUpperCase()}
                  </div>
                )}
                <div className="min-w-0">
                  <h1 className="truncate text-lg font-bold text-slate-900 sm:text-xl dark:text-white">
                    {data.channel.name}
                  </h1>
                  {data.channel.subscribersText && (
                    <p className="mt-0.5 tabular-nums text-xs text-slate-500 sm:text-sm dark:text-slate-400">
                      {data.channel.subscribersText}
                    </p>
                  )}
                  {data.channel.description && (
                    <p className="mt-1.5 line-clamp-2 max-w-2xl text-xs text-slate-600 dark:text-slate-400">
                      {data.channel.description}
                    </p>
                  )}
                </div>
              </div>

              <button
                type="button"
                onClick={() =>
                  onToggleSubscribe({
                    id: data.channel.id,
                    name: data.channel.name,
                    avatar: data.channel.avatar,
                    subscribersText: data.channel.subscribersText,
                  })
                }
                className={`inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-lg px-5 text-sm font-semibold transition-colors ${
                  isSubscribed
                    ? 'border border-slate-300 bg-slate-100 text-slate-900 hover:bg-slate-200 dark:border-slate-700 dark:bg-slate-800 dark:text-white dark:hover:bg-slate-700'
                    : 'bg-red-600 text-white hover:bg-red-700'
                }`}
              >
                {isSubscribed ? <BellRing className="h-4 w-4" /> : <Bell className="h-4 w-4" />}
                <span>{isSubscribed ? t.subscribed : t.subscribe}</span>
              </button>
            </div>
          </div>

          <section className="space-y-4">
            <h2 className="text-lg font-bold text-slate-900 dark:text-white">{t.channelVideos}</h2>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {data.videos.map((video) => (
                <VideoCard
                  key={video.id}
                  video={video}
                  locale={locale}
                  isSaved={savedIds.has(video.id)}
                  onWatch={onWatch}
                  onToggleSave={onToggleSave}
                />
              ))}
            </div>
          </section>
        </>
      )}
    </div>
  );
}
