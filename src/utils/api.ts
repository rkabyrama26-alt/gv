import type {
  AppLocale,
  ChannelResponse,
  DurationFilter,
  SearchResponse,
  SearchType,
  ServerHealthResponse,
  SortOrder,
  SuggestResponse,
  TikTokCategory,
  TikTokFeedResponse,
  TrendingCategory,
  TrendingResponse,
  VideoDetailsResponse,
  XtreamCatalogResponse,
  XtreamMovieItem,
  XtreamServerId,
  XtreamSeriesDetails,
  XtreamTab,
} from '../shared/types.ts';
import { resolveApiUrl } from './apiConfig.ts';

async function fetchJson<T>(path: string): Promise<T> {
  const res = await fetch(resolveApiUrl(path));
  const ct = res.headers.get('content-type') || '';
  if (!res.ok) {
    const errBody = await res.json().catch(() => ({}));
    throw new Error(errBody?.error || `HTTP ${res.status}`);
  }
  if (!ct.includes('application/json')) {
    throw new Error('HTTP 404');
  }
  return (await res.json()) as T;
}

export function fetchServerHealth(): Promise<ServerHealthResponse> {
  return fetchJson<ServerHealthResponse>('/api/health');
}

export function fetchTrending(
  category: TrendingCategory,
  hl: AppLocale,
  refresh = false,
  seed?: number,
): Promise<TrendingResponse> {
  const qs = new URLSearchParams({ category, hl });
  if (refresh) qs.set('refresh', '1');
  if (typeof seed === 'number' && Number.isFinite(seed)) qs.set('seed', String(seed));
  return fetchJson<TrendingResponse>(`/api/videos/trending?${qs.toString()}`);
}

export function fetchTikTokFeed(
  category: TikTokCategory = 'all',
  refresh = false,
): Promise<TikTokFeedResponse> {
  return fetchJson<TikTokFeedResponse>(
    `/api/tiktok/feed?category=${encodeURIComponent(category)}${refresh ? '&refresh=1' : ''}`,
  );
}

export function fetchTikTokSearch(query: string): Promise<TikTokFeedResponse> {
  return fetchJson<TikTokFeedResponse>(
    `/api/tiktok/search?q=${encodeURIComponent(query.trim())}`,
  );
}

export function fetchSearch(params: {
  query: string;
  sort: SortOrder;
  type: SearchType;
  duration: DurationFilter;
  continuation?: string;
  hl: AppLocale;
}): Promise<SearchResponse> {
  const qs = new URLSearchParams({
    q: params.query,
    sort: params.sort,
    type: params.type,
    duration: params.duration,
    hl: params.hl,
  });
  if (params.continuation) {
    qs.set('continuation', params.continuation);
  }
  return fetchJson<SearchResponse>(`/api/videos/search?${qs.toString()}`);
}

export function fetchSuggestions(query: string, hl: AppLocale): Promise<SuggestResponse> {
  return fetchJson<SuggestResponse>(
    `/api/videos/suggest?q=${encodeURIComponent(query)}&hl=${encodeURIComponent(hl)}`,
  );
}

export function fetchVideoDetails(videoId: string, hl: AppLocale): Promise<VideoDetailsResponse> {
  return fetchJson<VideoDetailsResponse>(
    `/api/videos/item/${encodeURIComponent(videoId)}?hl=${encodeURIComponent(hl)}`,
  );
}

export function fetchChannelDetails(channelId: string, hl: AppLocale): Promise<ChannelResponse> {
  return fetchJson<ChannelResponse>(
    `/api/videos/channel/${encodeURIComponent(channelId)}?hl=${encodeURIComponent(hl)}`,
  );
}

export function fetchXtreamCatalog(params: {
  serverId?: XtreamServerId;
  tab: XtreamTab;
  categoryId?: string;
  query?: string;
  offset?: number;
  limit?: number;
}): Promise<XtreamCatalogResponse> {
  const qs = new URLSearchParams({
    server: params.serverId === '2' ? '2' : '1',
    tab: params.tab,
    categoryId: params.categoryId || 'all',
    offset: String(params.offset || 0),
    limit: String(params.limit || 48),
  });
  if (params.query?.trim()) {
    qs.set('q', params.query.trim());
  }
  return fetchJson<XtreamCatalogResponse>(`/api/xtream/catalog?${qs.toString()}`);
}

export function fetchXtreamSeriesDetails(
  seriesId: string,
  serverId: XtreamServerId = '1',
): Promise<XtreamSeriesDetails> {
  const suffix = serverId === '2' ? '?server=2' : '';
  return fetchJson<XtreamSeriesDetails>(`/api/xtream/series/${encodeURIComponent(seriesId)}${suffix}`);
}

export function fetchXtreamMovieDetails(
  vodId: string,
  serverId: XtreamServerId = '1',
): Promise<XtreamMovieItem> {
  const suffix = serverId === '2' ? '?server=2' : '';
  return fetchJson<XtreamMovieItem>(`/api/xtream/vod/${encodeURIComponent(vodId)}${suffix}`);
}

export async function configureXtreamServer(params: {
  serverId?: XtreamServerId;
  baseUrl: string;
  username: string;
  password: string;
}): Promise<{ configured: boolean }> {
  const res = await fetch(resolveApiUrl('/api/xtream/configure'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  if (!res.ok) {
    const errBody = await res.json().catch(() => ({}));
    throw new Error(errBody?.error || `HTTP ${res.status}`);
  }
  return (await res.json()) as { configured: boolean };
}

export interface StreamResolvePayload {
  playable: boolean;
  kind?: 'mp4' | 'hls';
  url?: string;
  title?: string;
  code?: string;
  reason?: string;
}
