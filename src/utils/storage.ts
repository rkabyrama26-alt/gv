import type { DownloadedVideo, MediaVideo, SubscribedChannel } from '../shared/types.ts';

const SAVED_KEY = 'dramasquare_saved_videos_v1';
const DOWNLOADS_KEY = 'dramasquare_downloads_v1';
const HISTORY_KEY = 'dramasquare_watch_history_v1';
const SEARCH_HISTORY_KEY = 'dramasquare_recent_searches_v1';
const SUBSCRIPTIONS_KEY = 'dramasquare_subscriptions_v1';

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function writeJson<T>(key: string, value: T): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // ignore quota errors
  }
}

function isIndependentMediaRecord(v: Partial<MediaVideo> | null | undefined): v is MediaVideo {
  if (!v || !v.id || !v.streamUrl) return false;
  return (
    v.streamUrl.startsWith('/api/videos/') ||
    v.streamUrl.startsWith('/api/tiktok/') ||
    v.streamUrl.startsWith('/api/xtream/')
  );
}

export function loadSavedVideos(): MediaVideo[] {
  return readJson<MediaVideo[]>(SAVED_KEY, []).filter(isIndependentMediaRecord);
}

export function toggleSavedVideo(list: MediaVideo[], video: MediaVideo): MediaVideo[] {
  const exists = list.some((v) => v.id === video.id);
  const next = exists ? list.filter((v) => v.id !== video.id) : [video, ...list];
  writeJson(SAVED_KEY, next);
  return next;
}

export function loadDownloadedVideos(): DownloadedVideo[] {
  return readJson<DownloadedVideo[]>(DOWNLOADS_KEY, []).filter(isIndependentMediaRecord);
}

export function toggleDownloadedVideo(
  list: DownloadedVideo[],
  video: MediaVideo,
): DownloadedVideo[] {
  const exists = list.some((v) => v.id === video.id);
  const next = exists
    ? list.filter((v) => v.id !== video.id)
    : [{ ...video, downloadedAt: Date.now() }, ...list];
  writeJson(DOWNLOADS_KEY, next);
  return next;
}

export function upsertDownloadedVideo(
  list: DownloadedVideo[],
  video: MediaVideo,
  meta: { sizeBytes: number; offlineReady: boolean },
): DownloadedVideo[] {
  const record: DownloadedVideo = {
    ...video,
    downloadedAt: Date.now(),
    sizeBytes: meta.sizeBytes,
    offlineReady: meta.offlineReady,
  };
  const next = [record, ...list.filter((v) => v.id !== video.id)];
  writeJson(DOWNLOADS_KEY, next);
  return next;
}

export function removeDownloadedVideo(list: DownloadedVideo[], videoId: string): DownloadedVideo[] {
  const next = list.filter((v) => v.id !== videoId);
  writeJson(DOWNLOADS_KEY, next);
  return next;
}

export function loadWatchHistory(): MediaVideo[] {
  return readJson<MediaVideo[]>(HISTORY_KEY, []).filter(isIndependentMediaRecord);
}

export function pushWatchHistory(list: MediaVideo[], video: MediaVideo): MediaVideo[] {
  const filtered = list.filter((v) => v.id !== video.id);
  const next = [video, ...filtered].slice(0, 40);
  writeJson(HISTORY_KEY, next);
  return next;
}

export function clearWatchHistory(): MediaVideo[] {
  writeJson(HISTORY_KEY, []);
  return [];
}

export function loadRecentSearches(): string[] {
  return readJson<string[]>(SEARCH_HISTORY_KEY, []);
}

export function pushRecentSearch(list: string[], query: string): string[] {
  const clean = query.trim();
  if (!clean) return list;
  const next = [clean, ...list.filter((item) => item !== clean)].slice(0, 8);
  writeJson(SEARCH_HISTORY_KEY, next);
  return next;
}

export function loadSubscriptions(): SubscribedChannel[] {
  return readJson<SubscribedChannel[]>(SUBSCRIPTIONS_KEY, []);
}

export function toggleChannelSubscription(
  list: SubscribedChannel[],
  channel: { id: string; name: string; avatar?: string; subscribersText?: string },
): SubscribedChannel[] {
  const keyId = channel.id || channel.name;
  const exists = list.some((c) => c.id === keyId);
  const next = exists
    ? list.filter((c) => c.id !== keyId)
    : [
        {
          id: keyId,
          name: channel.name,
          avatar: channel.avatar,
          subscribersText: channel.subscribersText,
          subscribedAt: Date.now(),
        },
        ...list,
      ];
  writeJson(SUBSCRIPTIONS_KEY, next);
  return next;
}
