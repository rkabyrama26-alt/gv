import type {
  AppLocale,
  ChannelResponse,
  DurationFilter,
  MediaChannelSummary,
  MediaComment,
  MediaVideo,
  SearchResponse,
  SearchType,
  SortOrder,
  SuggestResponse,
  TrendingCategory,
  TrendingResponse,
  VideoDetailsResponse,
} from '../shared/types.ts';
import { formatVideoDuration } from '../server/mediaParser.ts';
import { extractYouTubeVideoId, isYouTubeVideoId } from '../server/youtubeParser.ts';

const PIPED_API_BASES = ['https://api.piped.private.coffee'];

export interface RawPipedStreamItem {
  url?: string;
  type?: string;
  title?: string;
  thumbnail?: string;
  uploaderName?: string;
  uploaderUrl?: string;
  uploaderAvatar?: string | null;
  uploadedDate?: string | null;
  shortDescription?: string | null;
  duration?: number;
  views?: number;
  uploaded?: number;
  uploaderVerified?: boolean;
  isShort?: boolean;
  livestream?: boolean;
}

export interface RawPipedChannelSearchItem {
  url?: string;
  type?: string;
  name?: string;
  thumbnail?: string;
  description?: string;
  subscribers?: number;
  videos?: number;
  verified?: boolean;
}

export interface RawPipedStreamDetails {
  title?: string;
  description?: string;
  uploadDate?: string;
  uploader?: string;
  uploaderUrl?: string;
  uploaderAvatar?: string | null;
  thumbnailUrl?: string;
  hls?: string | false | null;
  uploaderVerified?: boolean;
  duration?: number;
  views?: number;
  likes?: number;
  uploaderSubscriberCount?: number;
  uploaded?: number;
  livestream?: boolean;
  videoStreams?: Array<{
    url?: string;
    mimeType?: string;
    quality?: string;
    videoOnly?: boolean;
  }>;
  relatedStreams?: RawPipedStreamItem[];
}

export interface RawPipedComment {
  author?: string;
  thumbnail?: string | null;
  commentId?: string;
  commentText?: string;
  commentedTime?: string;
  likeCount?: number;
  replyCount?: number;
  channelOwner?: boolean;
}

function getFreshQueries(category: TrendingCategory, hl: AppLocale, seed: number): string[] {
  if (hl === 'ar') {
    switch (category) {
      case 'tech':
        return ['مراجعة هواتف ذكية 2026', 'الذكاء الاصطناعي والبرمجة 2026'];
      case 'music':
        return ['اغاني عربية جديدة 2026', 'اغاني عراقية جديدة 2026'];
      case 'gaming':
        return ['ببجي موبايل قيمبلاي 2026', 'العاب فيديو جديدة 2026'];
      case 'education':
        return ['فيلم وثائقي علمي عربي 2026', 'شرح برمجة وتعلم 2026'];
      case 'news':
        return ['اخبار العراق اليوم', 'اخبار العالم اليوم عاجل'];
      case 'all':
      default: {
        const pool = [
          'مسلسلات عربية جديدة 2026',
          'برامج عراقية جديدة 2026',
          'ترند العرب اليوم 2026',
          'اغاني عربية جديدة 2026',
          'ملخص مباريات اليوم اهداف',
          'مراجعة هواتف ذكية 2026',
          'وثائقي عربي جديد 2026',
          'ببجي موبايل 2026',
        ];
        const s = Math.abs(seed);
        return [
          pool[s % pool.length],
          pool[(s + 2) % pool.length],
          pool[(s + 4) % pool.length],
        ];
      }
    }
  }

  switch (category) {
    case 'tech':
      return ['smartphone tech review 2026', 'ai technology news 2026'];
    case 'music':
      return ['new official music video 2026', 'top music hits 2026'];
    case 'gaming':
      return ['new game walkthrough 2026', 'gaming highlights 2026'];
    case 'education':
      return ['science documentary 2026', 'coding tutorial 2026'];
    case 'news':
      return ['world breaking news today', 'live news headlines today'];
    case 'all':
    default: {
      const pool = [
        'trending videos today 2026',
        'new movie trailers 2026',
        'official music video 2026',
        'tech review 2026',
        'sports highlights today',
        'documentary film 2026',
      ];
      const s = Math.abs(seed);
      return [
        pool[s % pool.length],
        pool[(s + 2) % pool.length],
        pool[(s + 4) % pool.length],
      ];
    }
  }
}

export function extractPipedVideoId(urlOrId: string | undefined): string {
  const clean = String(urlOrId || '').trim();
  if (!clean) return '';
  if (isYouTubeVideoId(clean)) return clean;
  const watchMatch = clean.match(/[?&]v=([a-zA-Z0-9_-]{11})/) || clean.match(/\/shorts\/([a-zA-Z0-9_-]{11})/);
  if (watchMatch?.[1]) return watchMatch[1];
  return extractYouTubeVideoId(clean) || '';
}

export function extractPipedChannelId(urlOrId: string | undefined): string {
  const clean = String(urlOrId || '').trim();
  if (!clean) return '';
  if (clean.startsWith('UC') || clean.startsWith('@')) return clean;
  const m = clean.match(/\/channel\/(UC[a-zA-Z0-9_-]+)/) || clean.match(/(\/@[a-zA-Z0-9_.-]+)/);
  if (m?.[1]) return m[1].replace(/^\//, '');
  return '';
}

export function unwrapPipedImageUrl(rawUrl: string | null | undefined, videoFallbackId?: string): string {
  const clean = String(rawUrl || '').trim();
  if (clean) {
    try {
      const parsed = new URL(clean);
      const upstreamHost = parsed.searchParams.get('host');
      if (upstreamHost && /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(upstreamHost)) {
        if (upstreamHost.includes('i.ytimg.com') && videoFallbackId && isYouTubeVideoId(videoFallbackId)) {
          return `https://i.ytimg.com/vi/${videoFallbackId}/hqdefault.jpg`;
        }
        parsed.searchParams.delete('host');
        parsed.searchParams.delete('v');
        const qs = parsed.searchParams.toString();
        return `https://${upstreamHost}${parsed.pathname}${qs ? `?${qs}` : ''}`;
      }
      if (!parsed.hostname.includes('proxy.piped')) {
        return clean;
      }
    } catch {
      // fallback below
    }
  }
  if (videoFallbackId && isYouTubeVideoId(videoFallbackId)) {
    return `https://i.ytimg.com/vi/${videoFallbackId}/hqdefault.jpg`;
  }
  return '';
}

export function formatPipedCompactNumber(num: number | null | undefined, hl: AppLocale): string {
  if (typeof num !== 'number' || !Number.isFinite(num) || num < 0) return '';
  if (hl === 'ar') {
    if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(1).replace(/\.0$/, '')} مليون`;
    if (num >= 1_000) return `${(num / 1_000).toFixed(1).replace(/\.0$/, '')} ألف`;
    return num.toLocaleString();
  }
  if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
  if (num >= 1_000) return `${(num / 1_000).toFixed(1).replace(/\.0$/, '')}K`;
  return num.toLocaleString();
}

export function formatPipedRelativeDate(raw: string | null | undefined, hl: AppLocale): string {
  const clean = String(raw || '').trim();
  if (!clean) return '';
  if (hl === 'en') return clean;
  const m = clean.match(/(\d+)\s+(second|minute|hour|day|week|month|year|sec|min|hr|wk|mo|yr)s?\s+ago/i);
  if (!m) {
    if (/^\d{4}-\d{2}-\d{2}/.test(clean)) return clean.slice(0, 10);
    return clean;
  }
  const count = Number.parseInt(m[1], 10);
  const unit = m[2].toLowerCase();
  const unitMap: Record<string, string> = {
    second: count === 1 ? 'ثانية' : 'ثوانٍ',
    sec: count === 1 ? 'ثانية' : 'ثوانٍ',
    minute: count === 1 ? 'دقيقة' : 'دقائق',
    min: count === 1 ? 'دقيقة' : 'دقائق',
    hour: count === 1 ? 'ساعة' : 'ساعات',
    hr: count === 1 ? 'ساعة' : 'ساعات',
    day: count === 1 ? 'يوم' : 'أيام',
    week: count === 1 ? 'أسبوع' : 'أسابيع',
    wk: count === 1 ? 'أسبوع' : 'أسابيع',
    month: count === 1 ? 'شهر' : 'أشهر',
    mo: count === 1 ? 'شهر' : 'أشهر',
    year: count === 1 ? 'سنة' : 'سنوات',
    yr: count === 1 ? 'سنة' : 'سنوات',
  };
  return `قبل ${count} ${unitMap[unit] || unit}`;
}

function stripPipedHtml(raw: string | undefined): string {
  return String(raw || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .trim();
}

export function parsePipedVideoItem(raw: RawPipedStreamItem, hl: AppLocale): MediaVideo | null {
  if (!raw || (raw.type && raw.type !== 'stream')) return null;
  const id = extractPipedVideoId(raw.url);
  const title = String(raw.title || '').trim();
  if (!id || !title) return null;

  const durRaw = typeof raw.duration === 'number' ? raw.duration : 0;
  const isLive =
    Boolean(raw.livestream) ||
    (durRaw < 0 && (!raw.uploadedDate || /\b(live|stream)\b|مباشر|بث\s*مباشر/i.test(title)));
  const durationSeconds = !isLive && durRaw > 0 ? Math.floor(durRaw) : 0;
  const duration = isLive
    ? hl === 'ar'
      ? 'مباشر'
      : 'LIVE'
    : durationSeconds > 0
      ? formatVideoDuration(durationSeconds)
      : '0:00';

  const viewsCount = typeof raw.views === 'number' && Number.isFinite(raw.views) && raw.views >= 0 ? raw.views : null;
  const viewsCompact = viewsCount !== null ? formatPipedCompactNumber(viewsCount, hl) : '';
  const viewsText = viewsCompact
    ? hl === 'ar'
      ? `${viewsCompact} مشاهدة`
      : `${viewsCompact} views`
    : '';

  return {
    id,
    title,
    channelName: String(raw.uploaderName || '').trim() || (hl === 'ar' ? 'مربع الدراما' : 'Drama Square'),
    channelId: extractPipedChannelId(raw.uploaderUrl),
    channelAvatar: unwrapPipedImageUrl(raw.uploaderAvatar) || undefined,
    channelVerified: Boolean(raw.uploaderVerified),
    thumbnail: unwrapPipedImageUrl(raw.thumbnail, id),
    duration,
    durationSeconds,
    isLive,
    isShort: Boolean(raw.isShort) || (durationSeconds > 0 && durationSeconds <= 60),
    viewsText,
    viewsCount,
    publishedText: formatPipedRelativeDate(raw.uploadedDate, hl),
    descriptionSnippet: String(raw.shortDescription || '').trim() || undefined,
    streamUrl: `/api/videos/item/${encodeURIComponent(id)}/stream.m3u8`,
    sourceType: 'video',
  };
}

async function fetchPipedJson<T>(path: string, timeoutMs = 8000): Promise<T> {
  let lastError: Error | null = null;
  for (const base of PIPED_API_BASES) {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(`${base}${path}`, { signal: controller.signal });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      return (await res.json()) as T;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error('Piped fetch failed');
    } finally {
      window.clearTimeout(timer);
    }
  }
  throw lastError || new Error('Feed unavailable');
}

export async function fetchYouTubeTrendingDirect(
  category: TrendingCategory,
  hl: AppLocale,
  seed?: number,
): Promise<TrendingResponse> {
  const activeSeed =
    typeof seed === 'number' && Number.isFinite(seed) ? Math.abs(Math.floor(seed)) : Math.floor(Date.now() / 60000);
  const queries = getFreshQueries(category, hl, activeSeed);

  const [searchBatches, trendingList] = await Promise.all([
    Promise.all(
      queries.map((q) =>
        fetchPipedJson<{ items?: RawPipedStreamItem[] }>(
          `/search?q=${encodeURIComponent(q)}&filter=videos`,
        )
          .then((d) => (d.items || []).map((it) => parsePipedVideoItem(it, hl)).filter((v): v is MediaVideo => v !== null))
          .catch(() => [] as MediaVideo[]),
      ),
    ),
    category === 'all' || category === 'news'
      ? fetchPipedJson<RawPipedStreamItem[]>(`/trending?region=${hl === 'ar' ? 'IQ' : 'US'}`)
          .then((list) => (Array.isArray(list) ? list : []).map((it) => parsePipedVideoItem(it, hl)).filter((v): v is MediaVideo => v !== null))
          .catch(() => [] as MediaVideo[])
      : Promise.resolve([] as MediaVideo[]),
  ]);

  const items: MediaVideo[] = [];
  const seen = new Set<string>();
  const allBatches = [...searchBatches, trendingList];
  const maxLen = Math.max(0, ...allBatches.map((b) => b.length));

  for (let i = 0; i < maxLen && items.length < 36; i += 1) {
    for (const batch of allBatches) {
      const vid = batch[i];
      if (!vid || seen.has(vid.id)) continue;
      if (category === 'all' && vid.isLive) continue;
      seen.add(vid.id);
      items.push(vid);
      if (items.length >= 36) break;
    }
  }

  if (items.length === 0) {
    throw new Error('Could not load YouTube feed');
  }

  return {
    items,
    category,
    hl,
    source: 'media-server',
  };
}

export async function fetchYouTubeSearchDirect(params: {
  query: string;
  sort: SortOrder;
  type: SearchType;
  duration: DurationFilter;
  continuation?: string;
  hl: AppLocale;
}): Promise<SearchResponse> {
  const q = params.query.trim();
  const filter = params.type === 'short' ? 'videos' : 'videos';

  if (params.continuation) {
    const data = await fetchPipedJson<{ items?: RawPipedStreamItem[]; nextpage?: string | null }>(
      `/nextpage/search?nextpage=${encodeURIComponent(params.continuation)}&q=${encodeURIComponent(q)}&filter=${filter}`,
    );
    const items = (data.items || [])
      .map((it) => parsePipedVideoItem(it, params.hl))
      .filter((v): v is MediaVideo => v !== null);
    return {
      query: q,
      sort: params.sort,
      type: params.type,
      duration: params.duration,
      estimatedResults: items.length,
      items,
      channels: [],
      continuation: data.nextpage || null,
      hl: params.hl,
      source: 'media-server',
    };
  }

  const [videoData, channelData] = await Promise.all([
    fetchPipedJson<{ items?: RawPipedStreamItem[]; nextpage?: string | null }>(
      `/search?q=${encodeURIComponent(q)}&filter=${filter}`,
    ),
    params.type === 'all'
      ? fetchPipedJson<{ items?: RawPipedChannelSearchItem[] }>(
          `/search?q=${encodeURIComponent(q)}&filter=channels`,
        ).catch(() => ({ items: [] as RawPipedChannelSearchItem[] }))
      : Promise.resolve({ items: [] as RawPipedChannelSearchItem[] }),
  ]);

  let items = (videoData.items || [])
    .map((it) => parsePipedVideoItem(it, params.hl))
    .filter((v): v is MediaVideo => v !== null);

  if (params.type === 'live') {
    items = items.filter((v) => v.isLive);
  } else if (params.type === 'short' || params.duration === 'short') {
    items = items.filter((v) => !v.isLive && v.durationSeconds > 0 && v.durationSeconds < 240);
  } else if (params.duration === 'medium') {
    items = items.filter((v) => v.durationSeconds >= 240 && v.durationSeconds <= 1200);
  } else if (params.duration === 'long') {
    items = items.filter((v) => v.durationSeconds > 1200);
  }

  if (params.sort === 'views') {
    items = [...items].sort((a, b) => (b.viewsCount || 0) - (a.viewsCount || 0));
  }

  const channels: MediaChannelSummary[] = (channelData.items || [])
    .filter((c) => c.type === 'channel' && extractPipedChannelId(c.url) && c.name)
    .slice(0, 8)
    .map((c) => {
      const subs = formatPipedCompactNumber(c.subscribers, params.hl);
      return {
        id: extractPipedChannelId(c.url),
        name: String(c.name || '').trim(),
        avatar: unwrapPipedImageUrl(c.thumbnail) || undefined,
        subscribersText: subs
          ? `${subs} ${params.hl === 'ar' ? 'مشترك' : 'subscribers'}`
          : undefined,
      };
    });

  return {
    query: q,
    sort: params.sort,
    type: params.type,
    duration: params.duration,
    estimatedResults: items.length + channels.length,
    items,
    channels,
    continuation: videoData.nextpage || null,
    hl: params.hl,
    source: 'media-server',
  };
}

export async function fetchYouTubeSuggestDirect(query: string): Promise<SuggestResponse> {
  const q = query.trim();
  if (!q) return { query: '', suggestions: [], source: 'media-suggest' };
  const list = await fetchPipedJson<string[]>(`/suggestions?query=${encodeURIComponent(q)}`, 4000).catch(() => []);
  return {
    query: q,
    suggestions: Array.isArray(list) ? list.slice(0, 8) : [],
    source: 'media-suggest',
  };
}

export async function fetchYouTubeVideoDetailsDirect(
  videoId: string,
  hl: AppLocale,
): Promise<VideoDetailsResponse> {
  const id = extractPipedVideoId(videoId) || videoId.trim();
  const [info, commentsRes] = await Promise.all([
    fetchPipedJson<RawPipedStreamDetails>(`/streams/${encodeURIComponent(id)}`),
    fetchPipedJson<{ comments?: RawPipedComment[] }>(`/comments/${encodeURIComponent(id)}`, 5000).catch(
      () => ({ comments: [] as RawPipedComment[] }),
    ),
  ]);

  const isLive = Boolean(info.livestream);
  const durationSeconds = !isLive && typeof info.duration === 'number' && info.duration > 0 ? Math.floor(info.duration) : 0;
  const viewsCompact = formatPipedCompactNumber(info.views, hl);
  const subsCompact = formatPipedCompactNumber(info.uploaderSubscriberCount, hl);

  const related = (info.relatedStreams || [])
    .map((it) => parsePipedVideoItem(it, hl))
    .filter((v): v is MediaVideo => v !== null && v.id !== id)
    .slice(0, 16);

  const comments: MediaComment[] = (commentsRes.comments || [])
    .filter((c) => Boolean(c.commentText?.trim()))
    .slice(0, 30)
    .map((c, idx) => ({
      id: c.commentId || `c_${idx}`,
      authorName: String(c.author || 'User').trim(),
      authorAvatar: unwrapPipedImageUrl(c.thumbnail) || undefined,
      text: stripPipedHtml(c.commentText),
      publishedText: formatPipedRelativeDate(c.commentedTime, hl),
      likesText:
        typeof c.likeCount === 'number' && c.likeCount > 0
          ? formatPipedCompactNumber(c.likeCount, hl)
          : '0',
      replyCountText: typeof c.replyCount === 'number' && c.replyCount > 0 ? String(c.replyCount) : undefined,
      isCreator: Boolean(c.channelOwner),
    }));

  const cleanDesc = stripPipedHtml(info.description) || String(info.title || id);

  return {
    video: {
      id,
      title: String(info.title || id).trim(),
      channelName: String(info.uploader || '').trim() || (hl === 'ar' ? 'مربع الدراما' : 'Drama Square'),
      channelId: extractPipedChannelId(info.uploaderUrl),
      channelAvatar: unwrapPipedImageUrl(info.uploaderAvatar) || undefined,
      channelVerified: Boolean(info.uploaderVerified),
      thumbnail: unwrapPipedImageUrl(info.thumbnailUrl, id),
      duration: isLive ? (hl === 'ar' ? 'مباشر' : 'LIVE') : durationSeconds > 0 ? formatVideoDuration(durationSeconds) : '0:00',
      durationSeconds,
      isLive,
      isShort: durationSeconds > 0 && durationSeconds <= 60,
      viewsText: viewsCompact ? (hl === 'ar' ? `${viewsCompact} مشاهدة` : `${viewsCompact} views`) : '',
      viewsCount: typeof info.views === 'number' ? info.views : null,
      publishedText: formatPipedRelativeDate(info.uploadDate, hl),
      descriptionSnippet: cleanDesc.slice(0, 160),
      streamUrl: `/api/videos/item/${encodeURIComponent(id)}/stream.m3u8`,
      sourceType: 'video',
      description: cleanDesc,
      subscribersText: subsCompact ? `${subsCompact} ${hl === 'ar' ? 'مشترك' : 'subscribers'}` : '',
      likesText: typeof info.likes === 'number' && info.likes > 0 ? info.likes.toLocaleString() : undefined,
      uploadDateText: info.uploadDate ? info.uploadDate.slice(0, 10) : undefined,
    },
    related,
    comments,
    source: 'media-server',
  };
}

export async function fetchYouTubeChannelDetailsDirect(
  channelId: string,
  hl: AppLocale,
): Promise<ChannelResponse> {
  const cleanId = extractPipedChannelId(channelId) || channelId.trim();
  const data = await fetchPipedJson<{
    id?: string;
    name?: string;
    avatarUrl?: string;
    bannerUrl?: string;
    description?: string;
    subscriberCount?: number;
    verified?: boolean;
    relatedStreams?: RawPipedStreamItem[];
  }>(`/channel/${encodeURIComponent(cleanId)}`);

  let videos = (data.relatedStreams || [])
    .map((it) => parsePipedVideoItem(it, hl))
    .filter((v): v is MediaVideo => v !== null);

  if (videos.length === 0 && data.name) {
    const searchRes = await fetchPipedJson<{ items?: RawPipedStreamItem[] }>(
      `/search?q=${encodeURIComponent(data.name)}&filter=videos`,
    ).catch(() => ({ items: [] as RawPipedStreamItem[] }));
    const parsed = (searchRes.items || [])
      .map((it) => parsePipedVideoItem(it, hl))
      .filter((v): v is MediaVideo => v !== null);
    const exact = parsed.filter((v) => v.channelId === cleanId);
    videos = exact.length > 0 ? exact : parsed.slice(0, 16);
  }

  const subsCompact = formatPipedCompactNumber(data.subscriberCount, hl);

  return {
    channel: {
      id: data.id || cleanId,
      name: String(data.name || cleanId).trim(),
      avatar: unwrapPipedImageUrl(data.avatarUrl) || undefined,
      banner: unwrapPipedImageUrl(data.bannerUrl) || undefined,
      description: stripPipedHtml(data.description) || undefined,
      subscribersText: subsCompact ? `${subsCompact} ${hl === 'ar' ? 'مشترك' : 'subscribers'}` : undefined,
      verified: Boolean(data.verified),
    },
    videos,
    source: 'media-server',
  };
}

export async function resolveYouTubeDirectStreamFallback(
  videoId: string,
): Promise<{ url: string; kind: 'mp4' | 'hls' } | null> {
  const id = extractPipedVideoId(videoId);
  if (!id) return null;
  try {
    const info = await fetchPipedJson<RawPipedStreamDetails>(`/streams/${encodeURIComponent(id)}`, 6000);
    if (typeof info.hls === 'string' && /^https?:\/\//i.test(info.hls)) {
      return { url: info.hls, kind: 'hls' };
    }
    const muxedMp4 = (info.videoStreams || []).find(
      (s) => !s.videoOnly && Boolean(s.url) && (s.mimeType || '').includes('mp4'),
    );
    if (muxedMp4?.url) {
      return { url: muxedMp4.url, kind: 'mp4' };
    }
  } catch {
    // ignore fallback resolution error
  }
  return null;
}
