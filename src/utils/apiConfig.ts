import type {
  AppLocale,
  ChannelResponse,
  DurationFilter,
  MediaVideo,
  SearchResponse,
  SearchType,
  SortOrder,
  SuggestResponse,
  TrendingCategory,
  TrendingResponse,
  VideoDetailsResponse,
} from '../shared/types.ts';
import {
  formatSubscribersText,
  parseMediaChannel,
  parseMediaVideo,
  type RawDailymotionUser,
  type RawDailymotionVideo,
} from '../server/mediaParser.ts';

const API_BASE_STORAGE_KEY = 'dramasquare_api_base_v1';
const DM_API_BASE = 'https://api.dailymotion.com';
const DM_VIDEO_FIELDS = [
  'id',
  'title',
  'description',
  'duration',
  'views_total',
  'likes_total',
  'created_time',
  'mode',
  'onair',
  'status',
  'thumbnail_720_url',
  'thumbnail_480_url',
  'thumbnail_360_url',
  'owner.id',
  'owner.screenname',
  'owner.username',
  'owner.avatar_120_url',
  'owner.followers_total',
  'owner.verified',
].join(',');

export function normalizeApiBaseUrl(raw: string | null | undefined): string {
  const clean = (raw || '').trim();
  if (!clean) return '';
  try {
    const parsed = new URL(clean);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return '';
    }
    return parsed.origin + parsed.pathname.replace(/\/+$/, '');
  } catch {
    return '';
  }
}

export function getConfiguredApiBaseUrl(): string {
  const viteMeta = import.meta as unknown as { env?: Record<string, string | undefined> };
  const fromEnv = normalizeApiBaseUrl(viteMeta.env?.VITE_API_BASE_URL);
  if (fromEnv) return fromEnv;

  if (typeof window === 'undefined') return '';
  try {
    const fromStorage = normalizeApiBaseUrl(window.localStorage.getItem(API_BASE_STORAGE_KEY));
    if (fromStorage) return fromStorage;
  } catch {
    // ignore storage errors
  }
  return '';
}

export function saveConfiguredApiBaseUrl(rawUrl: string): string {
  const normalized = normalizeApiBaseUrl(rawUrl);
  if (typeof window !== 'undefined') {
    try {
      if (normalized) {
        window.localStorage.setItem(API_BASE_STORAGE_KEY, normalized);
      } else {
        window.localStorage.removeItem(API_BASE_STORAGE_KEY);
      }
    } catch {
      // ignore storage errors
    }
  }
  return normalized;
}

export function resolveApiUrl(path: string, configuredBase?: string): string {
  const base =
    configuredBase !== undefined
      ? normalizeApiBaseUrl(configuredBase)
      : getConfiguredApiBaseUrl();
  if (!base) return path;
  if (/^https?:\/\//i.test(path)) return path;
  const cleanPath = path.startsWith('/') ? path : `/${path}`;
  return `${base}${cleanPath}`;
}

export function isStaticHostEnvironment(hostname?: string): boolean {
  const host =
    hostname !== undefined
      ? hostname.toLowerCase()
      : typeof window !== 'undefined'
        ? window.location.hostname.toLowerCase()
        : '';
  return (
    host.endsWith('.github.io') ||
    host === 'github.io' ||
    host.endsWith('.pages.dev') ||
    host.endsWith('.netlify.app')
  );
}

function getCategoryTerms(category: TrendingCategory, hl: AppLocale): string {
  if (category === 'tech') return hl === 'ar' ? 'تقنية برمجة' : 'technology';
  if (category === 'music') return hl === 'ar' ? 'موسيقى أغاني' : 'music';
  if (category === 'gaming') return hl === 'ar' ? 'ألعاب فيديو' : 'gaming';
  if (category === 'education') return hl === 'ar' ? 'تعليم وثائقي' : 'documentary';
  if (category === 'news') return hl === 'ar' ? 'أخبار' : 'news';
  return hl === 'ar' ? 'مسلسلات دراما' : 'drama series';
}

export function buildStaticTrendingApiUrl(
  category: TrendingCategory,
  hl: AppLocale,
  page = 1,
): string {
  const qs = new URLSearchParams({
    fields: DM_VIDEO_FIELDS,
    limit: '24',
    page: String(Math.max(1, page)),
    sort: category === 'all' ? 'trending' : 'recent',
  });
  if (category !== 'all') {
    qs.set('search', getCategoryTerms(category, hl));
  } else if (hl === 'ar') {
    qs.set('languages', 'ar,en');
  }
  return `${DM_API_BASE}/videos?${qs.toString()}`;
}

export function buildStaticSearchApiUrl(params: {
  query: string;
  sort: SortOrder;
  type: SearchType;
  duration: DurationFilter;
  page?: number;
}): string {
  const sortMap: Record<SortOrder, string> = {
    relevance: 'relevance',
    date: 'recent',
    views: 'visited',
    rating: 'visited-month',
  };
  const qs = new URLSearchParams({
    fields: DM_VIDEO_FIELDS,
    search: params.query.trim(),
    limit: '24',
    page: String(Math.max(1, params.page || 1)),
    sort: sortMap[params.sort] || 'relevance',
  });
  if (params.type === 'live') {
    qs.set('flags', 'onair');
  } else if (params.type === 'short' || params.duration === 'short') {
    qs.set('shorter_than', '4');
  } else if (params.duration === 'medium') {
    qs.set('longer_than', '4');
    qs.set('shorter_than', '20');
  } else if (params.duration === 'long') {
    qs.set('longer_than', '20');
  }
  return `${DM_API_BASE}/videos?${qs.toString()}`;
}

export async function fetchStaticTrendingFallback(
  category: TrendingCategory,
  hl: AppLocale,
  seed?: number,
): Promise<TrendingResponse> {
  const page = typeof seed === 'number' && Number.isFinite(seed) ? ((Math.abs(seed) % 3) + 1) : 1;
  const res = await fetch(buildStaticTrendingApiUrl(category, hl, page));
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }
  const data = (await res.json()) as { list?: RawDailymotionVideo[] };
  const items = (data.list || [])
    .map((raw) => parseMediaVideo(raw, hl))
    .filter((v): v is MediaVideo => v !== null);
  return {
    items,
    category,
    hl,
    source: 'media-server',
  };
}

export async function fetchStaticSearchFallback(params: {
  query: string;
  sort: SortOrder;
  type: SearchType;
  duration: DurationFilter;
  continuation?: string;
  hl: AppLocale;
}): Promise<SearchResponse> {
  const pageNum = params.continuation ? Math.max(2, Number.parseInt(params.continuation, 10) || 2) : 1;
  const res = await fetch(buildStaticSearchApiUrl({ ...params, page: pageNum }));
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }
  const data = (await res.json()) as { list?: RawDailymotionVideo[]; has_more?: boolean; total?: number };
  const items = (data.list || [])
    .map((raw) => parseMediaVideo(raw, params.hl))
    .filter((v): v is MediaVideo => v !== null);
  return {
    items,
    channels: [],
    continuation: data.has_more ? String(pageNum + 1) : null,
    estimatedResults: typeof data.total === 'number' ? data.total : items.length,
    query: params.query,
    sort: params.sort,
    type: params.type,
    duration: params.duration,
    hl: params.hl,
    source: 'media-server',
  };
}

export async function fetchStaticSuggestFallback(query: string): Promise<SuggestResponse> {
  const q = query.trim();
  if (!q) return { query, suggestions: [], source: 'media-suggest' };
  const url = `${DM_API_BASE}/videos?fields=title&search=${encodeURIComponent(q)}&limit=6`;
  const res = await fetch(url);
  if (!res.ok) return { query, suggestions: [], source: 'media-suggest' };
  const data = (await res.json()) as { list?: Array<{ title?: string }> };
  const seen = new Set<string>();
  const suggestions: string[] = [];
  for (const item of data.list || []) {
    const title = (item.title || '').trim();
    if (title && !seen.has(title)) {
      seen.add(title);
      suggestions.push(title);
    }
  }
  return { query, suggestions, source: 'media-suggest' };
}

export async function fetchStaticVideoDetailsFallback(
  videoId: string,
  hl: AppLocale,
): Promise<VideoDetailsResponse> {
  const res = await fetch(
    `${DM_API_BASE}/video/${encodeURIComponent(videoId)}?fields=${encodeURIComponent(DM_VIDEO_FIELDS)}`,
  );
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }
  const raw = (await res.json()) as RawDailymotionVideo;
  const parsed = parseMediaVideo(raw, hl);
  if (!parsed) {
    throw new Error('Video unavailable');
  }
  const relRes = await fetch(
    `${DM_API_BASE}/video/${encodeURIComponent(videoId)}/related?fields=${encodeURIComponent(DM_VIDEO_FIELDS)}&limit=12`,
  ).catch(() => null);
  const relJson = relRes && relRes.ok ? ((await relRes.json()) as { list?: RawDailymotionVideo[] }) : null;
  const related = (relJson?.list || [])
    .map((item) => parseMediaVideo(item, hl))
    .filter((v): v is MediaVideo => v !== null);

  return {
    video: {
      ...parsed,
      description: raw.description || parsed.descriptionSnippet || parsed.title,
      subscribersText: formatSubscribersText(raw['owner.followers_total'], hl),
    },
    related,
    comments: [],
    source: 'media-server',
  };
}

export async function fetchStaticChannelDetailsFallback(
  channelId: string,
  hl: AppLocale,
): Promise<ChannelResponse> {
  const userFields = 'id,screenname,username,avatar_120_url,avatar_360_url,cover_250_url,description,followers_total,videos_total,verified';
  const [uRes, vRes] = await Promise.all([
    fetch(`${DM_API_BASE}/user/${encodeURIComponent(channelId)}?fields=${userFields}`),
    fetch(`${DM_API_BASE}/user/${encodeURIComponent(channelId)}/videos?fields=${encodeURIComponent(DM_VIDEO_FIELDS)}&limit=24`),
  ]);
  if (!uRes.ok) throw new Error(`HTTP ${uRes.status}`);
  const rawUser = (await uRes.json()) as RawDailymotionUser;
  const channel = parseMediaChannel(rawUser, hl);
  if (!channel) throw new Error('Channel unavailable');
  const vJson = vRes.ok ? ((await vRes.json()) as { list?: RawDailymotionVideo[] }) : null;
  const videos = (vJson?.list || [])
    .map((raw) => parseMediaVideo(raw, hl))
    .filter((v): v is MediaVideo => v !== null);
  return {
    channel,
    videos,
    source: 'media-server',
  };
}
