import type { Request, Response } from 'express';
import { execFile, spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import type { ReadableStream as NodeReadableStream } from 'node:stream/web';
import { promisify } from 'node:util';
import vm from 'node:vm';
import { Innertube, Log, Platform, type Types } from 'youtubei.js';
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
import {
  buildFallbackSearchQueries,
  extractDirectVideoUrlId,
  extractMediaId,
  formatSubscribersText,
  isAllowedStreamHost,
  normalizeGlobalQuery,
  parseMediaChannel,
  parseMediaVideo,
  pickDownloadVariantUrl,
  prioritizeFreshRawVideos,
  rankSearchChannels,
  rewriteM3u8Manifest,
  rotateFreshBatches,
  sanitizeDownloadFilename,
  stripHtmlTags,
  type RawDailymotionUser,
  type RawDailymotionVideo,
} from './mediaParser.ts';
import {
  isYouTubeVideoId,
  parseYouTubeChannelSummary,
  parseYouTubeCommentNode,
  parseYouTubeVideoNode,
  pickBestThumbnail,
  scoreStreamCandidateMatch,
} from './youtubeParser.ts';
import {
  findMatchingLiveBroadcasts,
  getLiveChannelById,
  listKnownLiveChannels,
  matchLiveBroadcastStream,
  parseM3uLivePlaylist,
  type LiveChannelEntry,
} from './liveMatcher.ts';
import {
  appendPoTokenToStreamUrl,
  detectYouTubeClientFromUrl,
  getClientHeadersForStreamUrl,
  getPoTokenSession,
  YOUTUBE_CLIENT_SIGNATURES,
  type YouTubeClientKey,
} from './poTokenProvider.ts';

const execFileAsync = promisify(execFile);

// Keep youtubei.js parser logs silent so JIT schema drift warnings never pollute server logs
Log.setLevel(Log.Level.NONE);

// Register JS evaluator required by youtubei.js for player signature & n-parameter deciphering
Platform.shim.eval = async (
  data: Types.BuildScriptResult,
  env: Record<string, Types.VMPrimative>,
) => {
  const properties: string[] = [];
  if (env.n) properties.push(`n: exportedVars.nFunction(${JSON.stringify(String(env.n))})`);
  if (env.sig) properties.push(`sig: exportedVars.sigFunction(${JSON.stringify(String(env.sig))})`);
  const code = `${data.output}\nreturn { ${properties.join(', ')} };`;
  return vm.runInNewContext(`(function(){${code}})()`);
};

const DM_API_BASE = 'https://api.dailymotion.com';
const DESKTOP_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const VR_UA =
  'com.google.android.apps.youtube.vr.oculus/1.60.19 (Linux; U; Android 12L; eureka-user Build/SQ3A.220605.009.A1) gzip';

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

const DM_USER_FIELDS = [
  'id',
  'screenname',
  'username',
  'avatar_120_url',
  'avatar_360_url',
  'cover_250_url',
  'description',
  'followers_total',
  'videos_total',
  'verified',
].join(',');

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

export interface StreamResolutionResult {
  playable: boolean;
  kind?: 'mp4' | 'hls' | 'mux';
  url?: string;
  upstreamUrl?: string;
  audioUrl?: string;
  clientKey?: YouTubeClientKey;
  dmId?: string;
  title?: string;
  code?: string;
  reason?: string;
}

const cache = new Map<string, CacheEntry<unknown>>();
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const searchContinuationStore = new Map<string, { searchObj: any; expiresAt: number }>();
const CACHE_TTL_MS = 5 * 60 * 1000;

function getCached<T>(key: string): T | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    cache.delete(key);
    return null;
  }
  return entry.value as T;
}

function setCached<T>(key: string, value: T, ttlMs = CACHE_TTL_MS): void {
  if (cache.size > 400) {
    const oldest = cache.keys().next().value;
    if (oldest) cache.delete(oldest);
  }
  cache.set(key, { value, expiresAt: Date.now() + ttlMs });
}

export function getMediaCacheStats(): { entries: number } {
  return { entries: cache.size };
}

let warmStarted = false;
export function warmMediaEngine(): void {
  if (warmStarted) return;
  warmStarted = true;
  void Promise.allSettled([
    getYoutubeCatalogClient('ar'),
    getPoTokenSession(),
    getLiveDirectoryEntries(),
  ]);
}

function isLikelyLiveHint(titleHint: string): boolean {
  const clean = titleHint.trim();
  if (!clean) return false;
  return /(\blive\b|\bstream\b|بث\s*مباشر|مباشر|قناة)/i.test(clean);
}

const catalogClientPromises = new Map<string, Promise<Innertube>>();
const playerClientPromises = new Map<string, Promise<Innertube>>();

function hasPlausibleYouTubeCookies(): boolean {
  const raw = process.env.YT_COOKIES?.trim() || '';
  if (!raw || raw.length < 20) return false;
  if (raw.startsWith('# Netscape')) {
    return raw.includes('\t');
  }
  return raw.includes('=') && (raw.includes('SID') || raw.includes(';'));
}

function getYouTubeCookieHeader(): string | undefined {
  if (!hasPlausibleYouTubeCookies()) return undefined;
  const raw = process.env.YT_COOKIES?.trim() || '';
  if (!raw.startsWith('# Netscape')) return raw;
  const pairs: string[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const cols = trimmed.split('\t');
    if (cols.length >= 7 && cols[5] && cols[6] !== undefined) {
      pairs.push(`${cols[5]}=${cols[6]}`);
    }
  }
  return pairs.length > 0 ? pairs.join('; ') : undefined;
}



function getRegionForLocale(hl: AppLocale): string {
  if (hl === 'ar') {
    const raw = (process.env.YOUTUBE_COUNTRY || 'IQ').trim().toUpperCase();
    return /^[A-Z]{2}$/.test(raw) ? raw : 'IQ';
  }
  return 'US';
}

function resetYoutubeCatalogClient(hl: AppLocale): void {
  catalogClientPromises.delete(`cat:${hl}`);
}

function createFreshCatalogClient(lang: 'ar' | 'en', location: string): Promise<Innertube> {
  return Innertube.create({
    retrieve_player: false,
    lang,
    location,
    generate_session_locally: true,
  });
}

function getYoutubeCatalogClient(hl: AppLocale): Promise<Innertube> {
  const key = `cat:${hl}`;
  const existing = catalogClientPromises.get(key);
  if (existing) return existing;

  const created = createFreshCatalogClient(
    hl === 'en' ? 'en' : 'ar',
    getRegionForLocale(hl),
  ).catch((err) => {
    catalogClientPromises.delete(key);
    throw err;
  });

  catalogClientPromises.set(key, created);
  return created;
}

async function runWithCatalogClient<T>(
  hl: AppLocale,
  fn: (yt: Innertube) => Promise<T>,
  shouldRetryEmpty?: (result: T) => boolean,
): Promise<T> {
  try {
    const client = await getYoutubeCatalogClient(hl);
    const result = await fn(client);
    if (!shouldRetryEmpty || !shouldRetryEmpty(result)) {
      return result;
    }
  } catch {
    // Fall through to reset & retry
  }

  resetYoutubeCatalogClient(hl);
  try {
    const client = await getYoutubeCatalogClient(hl);
    const retried = await fn(client);
    if (!shouldRetryEmpty || !shouldRetryEmpty(retried)) {
      return retried;
    }
  } catch {
    // Fall through to clean US/en locale fallback (avoids YouTube browse 400 on some IQ/ar sessions)
  }

  const fallbackClient = await getYoutubeCatalogClient('en');
  return await fn(fallbackClient);
}

async function getYoutubePlayerClient(hl: AppLocale): Promise<Innertube> {
  const poSession = await getPoTokenSession();
  const bucket = Math.floor(poSession.expiresAt / (60 * 60 * 1000));
  const key = `play:${hl}:${bucket}`;
  const existing = playerClientPromises.get(key);
  if (existing) return existing;

  const created = Innertube.create({
    retrieve_player: true,
    lang: hl === 'en' ? 'en' : 'ar',
    location: getRegionForLocale(hl),
    visitor_data: poSession.visitorData,
    po_token: poSession.sessionPoToken,
    generate_session_locally: true,
    cookie: getYouTubeCookieHeader(),
  }).catch((err) => {
    playerClientPromises.delete(key);
    throw err;
  });

  playerClientPromises.set(key, created);
  return created;
}

async function fetchDailymotionJson<T>(pathAndQuery: string, timeoutMs = 8000): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${DM_API_BASE}${pathAndQuery}`, {
      headers: { 'User-Agent': DESKTOP_UA, Accept: 'application/json' },
      signal: controller.signal,
    });
    if (!res.ok) {
      throw new Error(`Media API HTTP ${res.status}`);
    }
    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

const SPAM_AD_PATTERN = /شقة للبيع|مزرعة للبيع|عقارات للبيع|ارض للبيع|فيلا للبيع/i;

function filterCleanRawVideos(list: RawDailymotionVideo[]): RawDailymotionVideo[] {
  return list.filter((item) => {
    const title = String(item?.title || '').trim();
    const id = String(item?.id || '').trim();
    const status = String((item as RawDailymotionVideo & { status?: string })?.status || '').toLowerCase();
    const duration = Number(item?.duration || 0);
    const isLive = Boolean(item?.onair || item?.mode === 'live');
    if (!id || !title) return false;
    if (status && status !== 'published') return false;
    if (!isLive && duration > 0 && duration < 15) return false;
    if (SPAM_AD_PATTERN.test(title)) return false;
    return true;
  });
}

async function filterPlayableDailymotionRaw(
  list: RawDailymotionVideo[],
  maxCheck = 32,
): Promise<RawDailymotionVideo[]> {
  const head = list.slice(0, maxCheck);
  if (head.length === 0) return [];
  const checks = await Promise.all(
    head.map((raw) =>
      fetchDailymotionMasterInfo(String(raw.id || ''))
        .then((info) => Boolean(info?.masterUrl))
        .catch(() => false),
    ),
  );
  return head.filter((_raw, idx) => checks[idx]);
}

async function buildPlayableLiveCards(
  candidates: Array<{ id: string; label: string; titleAr: string; url: string; logo?: string }>,
  hl: AppLocale,
  maxCount = 4,
): Promise<MediaVideo[]> {
  const checked = await Promise.all(
    candidates.slice(0, maxCount + 2).map(async (ch): Promise<MediaVideo | null> => {
      const probe = await probeHlsLiveUrl(ch.url).catch(() => null);
      if (!probe) return null;
      return {
        id: ch.id,
        title: hl === 'ar' ? ch.titleAr : `${ch.label} Live Stream`,
        channelName: ch.label,
        channelId: ch.id,
        channelAvatar: ch.logo || undefined,
        channelVerified: true,
        thumbnail: ch.logo || '',
        duration: hl === 'ar' ? 'مباشر' : 'LIVE',
        durationSeconds: 0,
        isLive: true,
        isShort: false,
        viewsText: hl === 'ar' ? 'بث مباشر الآن' : 'Streaming Live',
        viewsCount: null,
        publishedText: hl === 'ar' ? 'مباشر' : 'Live',
        streamUrl: `/api/videos/item/${encodeURIComponent(ch.id)}/stream.m3u8`,
        sourceType: 'video',
      };
    }),
  );
  return checked.filter((item): item is MediaVideo => item !== null).slice(0, maxCount);
}

let trendingRotationCounter = 0;

function extractVideosFromSearchPayload(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  searchRes: any,
  hl: AppLocale,
): MediaVideo[] {
  const out: MediaVideo[] = [];
  const seen = new Set<string>();

  const pushNode = (node: unknown) => {
    const parsed = parseYouTubeVideoNode(node, hl);
    if (!parsed || seen.has(parsed.id) || SPAM_AD_PATTERN.test(parsed.title)) return;
    seen.add(parsed.id);
    out.push(parsed);
  };

  if (Array.isArray(searchRes?.videos)) {
    for (const v of searchRes.videos) {
      pushNode(v);
    }
  }

  const visitResultNode = (node: unknown, depth = 0) => {
    if (!node || typeof node !== 'object' || depth > 4) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const obj = node as any;
    const t = String(obj.type || '');
    if (t === 'Channel' || t === 'ChannelCard') return;
    if (t === 'Video' || t === 'CompactVideo' || t === 'GridVideo' || t === 'LockupView') {
      pushNode(obj);
      return;
    }
    const nestedLists = [obj.content?.items, obj.items, obj.videos, obj.contents];
    for (const list of nestedLists) {
      if (Array.isArray(list)) {
        for (const child of list) {
          visitResultNode(child, depth + 1);
        }
      }
    }
  };

  if (Array.isArray(searchRes?.results)) {
    for (const r of searchRes.results) {
      visitResultNode(r, 0);
    }
  }

  return out;
}

function extractChannelsFromSearchPayload(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  searchRes: any,
): MediaChannelSummary[] {
  const out: MediaChannelSummary[] = [];
  const seen = new Set<string>();

  const pushCh = (node: unknown) => {
    const parsed = parseYouTubeChannelSummary(node);
    if (!parsed || seen.has(parsed.id)) return;
    seen.add(parsed.id);
    out.push(parsed);
  };

  if (Array.isArray(searchRes?.channels)) {
    for (const c of searchRes.channels) {
      pushCh(c);
    }
  }
  if (Array.isArray(searchRes?.results)) {
    for (const r of searchRes.results) {
      if (r?.type === 'Channel' || r?.type === 'ChannelCard') {
        pushCh(r);
      }
    }
  }
  return out;
}

function buildYouTubeTrendingQueries(
  category: TrendingCategory,
  hl: AppLocale,
  seed: number,
): string[] {
  if (hl === 'ar') {
    switch (category) {
      case 'tech':
        return ['مراجعة هواتف ذكية 2026', 'الذكاء الاصطناعي والبرمجة 2026', 'تقنية وموبايلات جديد 2026'];
      case 'music':
        return ['اغاني عربية جديدة 2026', 'فيديو كليب عربي جديد 2026', 'اغاني عراقية جديدة 2026'];
      case 'gaming':
        return ['ببجي موبايل قيمبلاي 2026', 'العاب فيديو جديدة 2026', 'تحديث ببجي الجديد 2026'];
      case 'education':
        return ['فيلم وثائقي علمي عربي 2026', 'تاريخ وحضارات وثائقي', 'شرح برمجة وتعلم 2026'];
      case 'news':
        return ['اخبار العراق اليوم', 'اخبار العالم اليوم عاجل', 'نشرة الاخبار اليوم'];
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
          pool[(s + 6) % pool.length],
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

export async function getTrendingMediaVideos(
  category: TrendingCategory = 'all',
  hl: AppLocale = 'ar',
  options?: { refresh?: boolean; seed?: number },
): Promise<TrendingResponse> {
  const refresh = Boolean(options?.refresh);
  const cacheKey = `feed:trending:yt:v4:${category}:${hl}`;

  if (!refresh) {
    const cached = getCached<TrendingResponse>(cacheKey);
    if (cached) return cached;
  }

  trendingRotationCounter += 1;
  const activeSeed =
    typeof options?.seed === 'number' && Number.isFinite(options.seed)
      ? Math.abs(Math.floor(options.seed))
      : trendingRotationCounter;

  const limit = category === 'all' ? 40 : 32;
  const queries = buildYouTubeTrendingQueries(category, hl, activeSeed);
  const uploadWindow = category === 'news' ? 'today' : 'week';

  const [ytBatches, liveDir] = await Promise.all([
    Promise.all(
      queries.map((q) =>
        runWithCatalogClient(hl, async (yt) => {
          const primary = await yt.search(q, {
            type: 'video',
            upload_date: uploadWindow,
            prioritize: 'relevance',
          });
          let list = extractVideosFromSearchPayload(primary, hl);
          if (list.length < 4) {
            const broader = await yt.search(q, {
              type: 'video',
              upload_date: 'month',
              prioritize: 'relevance',
            });
            list = extractVideosFromSearchPayload(broader, hl);
          }
          return list;
        }).catch(() => [] as MediaVideo[]),
      ),
    ),
    category === 'news'
      ? getLiveDirectoryEntries().catch(() => [] as LiveChannelEntry[])
      : Promise.resolve([] as LiveChannelEntry[]),
  ]);

  const rotated = rotateFreshBatches(ytBatches, activeSeed);
  const items: MediaVideo[] = [];
  const seen = new Set<string>();

  if (category === 'news') {
    const liveChannels = listKnownLiveChannels(liveDir).slice(0, 6);
    const liveCards = await buildPlayableLiveCards(liveChannels, hl, 4);
    for (const c of liveCards) {
      if (!seen.has(c.id)) {
        seen.add(c.id);
        items.push(c);
      }
    }
  }

  const maxBatchLen = Math.max(0, ...rotated.map((b) => b.length));
  for (let i = 0; i < maxBatchLen && items.length < limit; i += 1) {
    for (const batch of rotated) {
      const vid = batch[i];
      if (!vid || seen.has(vid.id)) continue;
      if (category === 'all' && vid.isLive) continue;
      seen.add(vid.id);
      items.push(vid);
      if (items.length >= limit) break;
    }
  }

  const payload: TrendingResponse = {
    category,
    items,
    source: 'media-server',
    hl,
  };
  if (items.length > 0) {
    setCached(cacheKey, payload, 2 * 60 * 1000);
  }
  return payload;
}

function storeSearchContinuation(searchObj: unknown): string | null {
  if (!searchObj || !(searchObj as { has_continuation?: boolean }).has_continuation) {
    return null;
  }
  if (searchContinuationStore.size > 120) {
    const oldestKey = searchContinuationStore.keys().next().value;
    if (oldestKey) searchContinuationStore.delete(oldestKey);
  }
  const token = `ytc_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  searchContinuationStore.set(token, {
    searchObj,
    expiresAt: Date.now() + 15 * 60 * 1000,
  });
  return token;
}

function buildYouTubeSearchFilters(
  sort: SortOrder,
  type: SearchType,
  duration: DurationFilter,
): {
  type?: 'all' | 'video' | 'shorts';
  duration?: 'under_three_mins' | 'three_to_twenty_mins' | 'over_twenty_mins';
  upload_date?: 'week';
  prioritize?: 'relevance' | 'popularity';
  features?: Array<'live'>;
} {
  const ytType: 'all' | 'video' | 'shorts' =
    type === 'short' ? 'shorts' : type === 'all' && duration === 'any' && sort === 'relevance' ? 'all' : 'video';

  const ytDuration =
    type === 'short' || duration === 'short'
      ? ('under_three_mins' as const)
      : duration === 'medium'
        ? ('three_to_twenty_mins' as const)
        : duration === 'long'
          ? ('over_twenty_mins' as const)
          : undefined;

  return {
    type: ytType,
    ...(ytDuration ? { duration: ytDuration } : {}),
    ...(sort === 'date' ? { upload_date: 'week' as const } : {}),
    ...(sort === 'views' || sort === 'rating'
      ? { prioritize: 'popularity' as const }
      : { prioritize: 'relevance' as const }),
    ...(type === 'live' ? { features: ['live'] as Array<'live'> } : {}),
  };
}

export async function searchMediaVideos(params: {
  query: string;
  sort?: SortOrder;
  type?: SearchType;
  duration?: DurationFilter;
  continuation?: string;
  hl?: AppLocale;
}): Promise<SearchResponse> {
  const query = params.query.trim();
  const sort: SortOrder = params.sort || 'relevance';
  const type: SearchType = params.type || 'all';
  const duration: DurationFilter = params.duration || 'any';
  const hl: AppLocale = params.hl === 'en' ? 'en' : 'ar';

  if (params.continuation && params.continuation.startsWith('ytc_')) {
    const stored = searchContinuationStore.get(params.continuation);
    if (stored && stored.expiresAt > Date.now()) {
      searchContinuationStore.delete(params.continuation);
      try {
        const nextSearch = await stored.searchObj.getContinuation();
        const items = extractVideosFromSearchPayload(nextSearch, hl);
        const nextToken = storeSearchContinuation(nextSearch);
        return {
          query,
          sort,
          type,
          duration,
          estimatedResults: items.length,
          items,
          channels: [],
          continuation: nextToken,
          source: 'media-server',
          hl,
        };
      } catch {
        // return empty continuation safely
      }
    }
    return {
      query,
      sort,
      type,
      duration,
      estimatedResults: 0,
      items: [],
      channels: [],
      continuation: null,
      source: 'media-server',
      hl,
    };
  }

  const cacheKey = `search:yt:v3:${query}:${sort}:${type}:${duration}:${hl}`;
  const cached = getCached<SearchResponse>(cacheKey);
  if (cached) return cached;

  const channelMap = new Map<string, MediaChannelSummary>();
  const videoMap = new Map<string, MediaVideo>();
  let continuation: string | null = null;
  let estimatedResults = 0;

  // Handle direct pasted URL or explicit video ID cleanly
  const directId =
    extractDirectVideoUrlId(query) ||
    (/^live_[a-z0-9_]{2,40}$/i.test(query) || isYouTubeVideoId(query) || /^x[a-z0-9]{4,12}$/i.test(query)
      ? query
      : null);
  if (directId) {
    const exact = await getMediaVideoDetails(directId, hl).catch(() => null);
    if (exact?.video) {
      videoMap.set(exact.video.id, exact.video);
    }
  }

  // Handle Live TV broadcast queries (e.g. الحدث مباشر, MBC العراق مباشر, etc.)
  const liveEntries = await getLiveDirectoryEntries().catch(() => [] as LiveChannelEntry[]);
  const matchedLive =
    type === 'live' && !query
      ? listKnownLiveChannels(liveEntries).slice(0, 8)
      : type === 'all' || type === 'live'
        ? findMatchingLiveBroadcasts(query, liveEntries, 4)
        : [];

  const liveCardsPromise =
    matchedLive.length > 0
      ? buildPlayableLiveCards(matchedLive, hl, 4)
      : type === 'live'
        ? buildPlayableLiveCards(listKnownLiveChannels(liveEntries), hl, 6)
        : Promise.resolve([] as MediaVideo[]);

  // Real YouTube Search API (videos + channels + filters)
  const searchFilters = buildYouTubeSearchFilters(sort, type, duration);

  const [liveCards, ytSearchOutcome] = await Promise.all([
    liveCardsPromise,
    query
      ? runWithCatalogClient(hl, async (yt) => {
          const [mainRes, channelRes] = await Promise.all([
            yt.search(query, searchFilters),
            type === 'all'
              ? yt.search(query, { type: 'channel' }).catch(() => null)
              : Promise.resolve(null),
          ]);
          return { mainRes, channelRes };
        }).catch(() => null)
      : Promise.resolve(null),
  ]);

  for (const liveVid of liveCards) {
    if (!videoMap.has(liveVid.id)) {
      videoMap.set(liveVid.id, liveVid);
    }
  }

  if (ytSearchOutcome?.mainRes) {
    const { mainRes, channelRes } = ytSearchOutcome;

    const inlineChannels = extractChannelsFromSearchPayload(mainRes);
    const dedicatedChannels = channelRes ? extractChannelsFromSearchPayload(channelRes) : [];
    for (const ch of rankSearchChannels(query, inlineChannels, dedicatedChannels, 12)) {
      channelMap.set(ch.id, ch);
    }

    const ytVideos = extractVideosFromSearchPayload(mainRes, hl);
    for (const vid of ytVideos) {
      if (!videoMap.has(vid.id)) {
        videoMap.set(vid.id, vid);
      }
    }

    continuation = storeSearchContinuation(mainRes);
    estimatedResults = Math.max(
      Number((mainRes as { estimated_results?: number })?.estimated_results || 0),
      videoMap.size + channelMap.size,
    );
  }

  const items = Array.from(videoMap.values());
  const channels = Array.from(channelMap.values());

  const response: SearchResponse = {
    query,
    sort,
    type,
    duration,
    estimatedResults: Math.max(estimatedResults, items.length + channels.length),
    items,
    channels,
    continuation,
    source: 'media-server',
    hl,
  };

  if (items.length > 0 || channels.length > 0) {
    setCached(cacheKey, response);
  }
  return response;
}

export async function getSuggestQueries(query: string, hl: AppLocale = 'ar'): Promise<SuggestResponse> {
  const clean = query.trim();
  if (!clean) {
    return { query: '', suggestions: [], source: 'media-suggest' };
  }

  const cacheKey = `yt:suggest:${clean}:${hl}`;
  const cached = getCached<SuggestResponse>(cacheKey);
  if (cached) return cached;

  try {
    const res = await fetch(
      `https://suggestqueries.google.com/complete/search?client=firefox&ds=yt&hl=${hl}&q=${encodeURIComponent(clean)}`,
      { headers: { 'User-Agent': DESKTOP_UA } },
    );
    if (!res.ok) throw new Error('Suggest failed');
    const json = (await res.json()) as [string, string[]];
    const suggestions = Array.isArray(json?.[1]) ? json[1].slice(0, 8) : [];
    const payload: SuggestResponse = {
      query: clean,
      suggestions,
      source: 'media-suggest',
    };
    setCached(cacheKey, payload, 10 * 60 * 1000);
    return payload;
  } catch {
    return {
      query: clean,
      suggestions: [],
      source: 'media-suggest',
    };
  }
}

function readUnknownText(val: unknown): string {
  if (!val) return '';
  if (typeof val === 'string') return val.trim();
  if (typeof val === 'object') {
    const obj = val as { text?: unknown; content?: unknown; toString?: () => string };
    if (typeof obj.text === 'string') return obj.text.trim();
    if (typeof obj.content === 'string') return obj.content.trim();
    if (typeof obj.toString === 'function') {
      const s = obj.toString();
      if (s && s !== '[object Object]') return s.trim();
    }
  }
  return '';
}

export async function getMediaVideoDetails(
  idOrUrl: string,
  hl: AppLocale = 'ar',
): Promise<VideoDetailsResponse | null> {
  const id = extractMediaId(idOrUrl);
  if (!id) return null;

  const cacheKey = `media:video:${id}:${hl}`;
  const cached = getCached<VideoDetailsResponse>(cacheKey);
  if (cached) return cached;

  // Live broadcast ID (live_al_hadath, etc.)
  if (id.startsWith('live_')) {
    const liveEntries = await getLiveDirectoryEntries().catch(() => [] as LiveChannelEntry[]);
    const known = getLiveChannelById(id, liveEntries);
    if (!known) return null;
    const relatedLive = await buildPlayableLiveCards(
      listKnownLiveChannels(liveEntries).filter((c) => c.id !== id),
      hl,
      8,
    );
    const details: VideoDetailsResponse = {
      video: {
        id: known.id,
        title: hl === 'ar' ? known.titleAr : `${known.label} Live Stream`,
        channelName: known.label,
        channelId: known.id,
        channelAvatar: known.logo || undefined,
        channelVerified: true,
        thumbnail: known.logo || '',
        duration: hl === 'ar' ? 'مباشر' : 'LIVE',
        durationSeconds: 0,
        isLive: true,
        isShort: false,
        viewsText: hl === 'ar' ? 'بث مباشر الآن' : 'Streaming Live',
        viewsCount: null,
        publishedText: hl === 'ar' ? 'مباشر' : 'Live',
        descriptionSnippet: hl === 'ar' ? known.titleAr : `${known.label} Live Broadcast`,
        streamUrl: `/api/videos/item/${encodeURIComponent(known.id)}/stream.m3u8`,
        sourceType: 'video',
        description: hl === 'ar' ? known.titleAr : `${known.label} Live Broadcast`,
        subscribersText: '',
      },
      related: relatedLive,
      comments: [],
      source: 'media-server',
    };
    setCached(cacheKey, details, 3 * 60 * 1000);
    return details;
  }

  // Primary playable Dailymotion IDs
  if (!isYouTubeVideoId(id)) {
    const [rawVideo, rawRelated] = await Promise.all([
      fetchDailymotionJson<RawDailymotionVideo>(
        `/video/${encodeURIComponent(id)}?fields=${encodeURIComponent(DM_VIDEO_FIELDS)}`,
      ),
      fetchDailymotionJson<{ list?: RawDailymotionVideo[] }>(
        `/video/${encodeURIComponent(id)}/related?fields=${encodeURIComponent(DM_VIDEO_FIELDS)}&limit=16`,
      ).catch(() => ({ list: [] })),
    ]);

    const base = parseMediaVideo(rawVideo, hl);
    if (!base) return null;

    let cleanRelated = filterCleanRawVideos(rawRelated.list || []).filter((r) => r.id !== base.id);
    if (cleanRelated.length < 4) {
      const topicQuery = normalizeGlobalQuery(base.title).split(/\s+/).slice(0, 3).join(' ');
      if (topicQuery) {
        const extra = await fetchDailymotionJson<{ list?: RawDailymotionVideo[] }>(
          `/videos?fields=${encodeURIComponent(DM_VIDEO_FIELDS)}&limit=12&sort=relevance&search=${encodeURIComponent(topicQuery)}`,
          5000,
        ).catch(() => ({ list: [] }));
        cleanRelated = [
          ...cleanRelated,
          ...filterCleanRawVideos(extra.list || []).filter((r) => r.id !== base.id),
        ];
      }
    }

    const playableRelated = await filterPlayableDailymotionRaw(cleanRelated, 14);
    const related: MediaVideo[] = [];
    const seenRel = new Set<string>([base.id]);
    for (const rel of playableRelated) {
      const parsedRel = parseMediaVideo(rel, hl);
      if (parsedRel && !seenRel.has(parsedRel.id)) {
        seenRel.add(parsedRel.id);
        related.push(parsedRel);
      }
    }

    const likesCount = Number(rawVideo.likes_total || 0);
    const details: VideoDetailsResponse = {
      video: {
        ...base,
        description: stripHtmlTags(rawVideo.description) || base.title,
        subscribersText: formatSubscribersText(rawVideo['owner.followers_total'], hl),
        likesText: likesCount > 0 ? likesCount.toLocaleString() : undefined,
        uploadDateText: base.publishedText,
      },
      related,
      comments: [],
      source: 'media-server',
    };
    setCached(cacheKey, details);
    return details;
  }

  const [info, commentsPage] = await Promise.all([
    runWithCatalogClient(hl, (yt) => yt.getInfo(id)),
    runWithCatalogClient(hl, (yt) => yt.getComments(id)).catch(() => null),
  ]);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pInfo = info.primary_info as any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sInfo = info.secondary_info as any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const bInfo = info.basic_info as any;

  const title = readUnknownText(pInfo?.title) || String(bInfo?.title || '').trim() || id;
  const channelName =
    String(sInfo?.owner?.author?.name || bInfo?.author || '').trim() ||
    (hl === 'ar' ? 'مربع الدراما' : 'Drama Square');
  const channelId = String(sInfo?.owner?.author?.id || bInfo?.channel_id || '').trim();
  const channelAvatar = pickBestThumbnail(sInfo?.owner?.author?.thumbnails);
  const channelVerified = Boolean(sInfo?.owner?.author?.is_verified || sInfo?.owner?.author?.is_verified_artist);
  const subscribersText = readUnknownText(sInfo?.owner?.subscriber_count);
  const description = readUnknownText(sInfo?.description) || readUnknownText(bInfo?.short_description) || title;

  const viewsText =
    readUnknownText(pInfo?.view_count?.view_count) ||
    readUnknownText(pInfo?.view_count?.short_view_count) ||
    (typeof bInfo?.view_count === 'number'
      ? hl === 'ar'
        ? `${bInfo.view_count.toLocaleString()} مشاهدة`
        : `${bInfo.view_count.toLocaleString()} views`
      : '');
  const publishedText = readUnknownText(pInfo?.published);

  // Extract likes from primary_info menu buttons or basic_info
  let likesNum = typeof bInfo?.like_count === 'number' ? bInfo.like_count : 0;
  const topButtons = Array.isArray(pInfo?.menu?.top_level_buttons) ? pInfo.menu.top_level_buttons : [];
  for (const btn of topButtons) {
    if (typeof btn?.like_count === 'number' && btn.like_count > 0) {
      likesNum = btn.like_count;
      break;
    }
  }

  const durationSeconds = typeof bInfo?.duration === 'number' && bInfo.duration > 0 ? Math.floor(bInfo.duration) : 0;
  const isLive = Boolean(bInfo?.is_live);
  const thumbnail = pickBestThumbnail(bInfo?.thumbnail, id);

  // Populate related strictly from YouTube's authentic watch_next_feed
  const related: MediaVideo[] = [];
  const seenRel = new Set<string>([id]);
  if (Array.isArray(info.watch_next_feed)) {
    for (const relNode of info.watch_next_feed) {
      const parsedRel = parseYouTubeVideoNode(relNode, hl);
      if (parsedRel && !seenRel.has(parsedRel.id) && !SPAM_AD_PATTERN.test(parsedRel.title)) {
        seenRel.add(parsedRel.id);
        related.push(parsedRel);
        if (related.length >= 16) break;
      }
    }
  }

  const comments: MediaComment[] = [];
  if (commentsPage?.contents) {
    let idx = 0;
    for (const thread of commentsPage.contents) {
      const parsedC = parseYouTubeCommentNode(thread, idx);
      idx += 1;
      if (parsedC) {
        comments.push(parsedC);
        if (comments.length >= 30) break;
      }
    }
  }

  const details: VideoDetailsResponse = {
    video: {
      id,
      title,
      channelName,
      channelId,
      channelAvatar: channelAvatar || undefined,
      channelVerified,
      thumbnail,
      duration: isLive ? (hl === 'ar' ? 'مباشر' : 'LIVE') : durationSeconds > 0 ? formatDurationSimple(durationSeconds) : '0:00',
      durationSeconds,
      isLive,
      isShort: durationSeconds > 0 && durationSeconds <= 60,
      viewsText,
      viewsCount: typeof bInfo?.view_count === 'number' ? bInfo.view_count : null,
      publishedText,
      descriptionSnippet: description.slice(0, 160),
      streamUrl: `/api/videos/item/${encodeURIComponent(id)}/stream.m3u8`,
      sourceType: 'video',
      description,
      subscribersText: subscribersText || '',
      likesText: likesNum > 0 ? likesNum.toLocaleString() : undefined,
      uploadDateText: publishedText || undefined,
    },
    related,
    comments,
    source: 'media-server',
  };

  setCached(cacheKey, details);
  return details;
}

function formatDurationSimple(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(safe / 3600);
  const m = Math.floor((safe % 3600) / 60);
  const s = safe % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

export async function getMediaChannelDetails(
  channelId: string,
  hl: AppLocale = 'ar',
): Promise<ChannelResponse | null> {
  const cleanId = channelId.trim();
  if (!cleanId) return null;

  const cacheKey = `media:channel:yt:${cleanId}:${hl}`;
  const cached = getCached<ChannelResponse>(cacheKey);
  if (cached) return cached;

  // Handle YouTube UC... channels or @handles: fetch authentic channel feed strictly from YouTube
  if (cleanId.startsWith('UC') || cleanId.startsWith('@')) {
    const { ch, videosTab, liveTab, shortsTab } = await runWithCatalogClient(
      hl,
      async (yt) => {
        let targetBrowseId = cleanId;
        if (cleanId.startsWith('@')) {
          const resolvedNav = await yt
            .resolveURL(`https://www.youtube.com/${cleanId}`)
            .catch(() => null);
          const browseId = resolvedNav?.payload?.browseId;
          if (typeof browseId === 'string' && browseId.startsWith('UC')) {
            targetBrowseId = browseId;
          } else {
            const chSearch = await yt.search(cleanId, { type: 'channel' }).catch(() => null);
            const candidates = chSearch ? extractChannelsFromSearchPayload(chSearch) : [];
            const handleLower = cleanId.toLowerCase();
            const exact =
              candidates.find((c) => c.handle?.toLowerCase() === handleLower) || candidates[0];
            if (exact?.id?.startsWith('UC')) {
              targetBrowseId = exact.id;
            }
          }
        }
        const channelObj = await yt.getChannel(targetBrowseId);
        const [vTab, lTab] = await Promise.all([
          channelObj.getVideos().catch(() => null),
          channelObj.getLiveStreams().catch(() => null),
        ]);
        const hasPrimary = Boolean(vTab?.videos?.length || lTab?.videos?.length);
        const sTab = hasPrimary ? null : await channelObj.getShorts().catch(() => null);
        return { ch: channelObj, videosTab: vTab, liveTab: lTab, shortsTab: sTab };
      },
      (res) =>
        !(
          res.videosTab?.videos?.length ||
          res.liveTab?.videos?.length ||
          res.shortsTab?.videos?.length ||
          res.ch.videos?.length
        ),
    );

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const meta = ch.metadata as any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const header = ch.header as any;

    const canonicalChannelId = String(meta?.external_id || cleanId);
    const name = String(meta?.title || cleanId).trim();
    const avatar = pickBestThumbnail(meta?.avatar);
    const banner =
      pickBestThumbnail(header?.content?.banner?.image) ||
      pickBestThumbnail(header?.banner);

    let subscribersText = '';
    const rows = header?.content?.metadata?.metadata_rows || [];
    for (const row of rows) {
      for (const part of row?.metadata_parts || []) {
        const txt = readUnknownText(part?.text ?? part);
        if (/مشترك|subscriber/i.test(txt)) {
          subscribersText = txt;
          break;
        }
      }
      if (subscribersText) break;
    }

    // Strictly use the channel's own Videos / Live / Shorts tabs first so external featured playlists never mix in
    const tabVideos = videosTab?.videos || [];
    const tabLive = liveTab?.videos || [];
    const tabShorts = shortsTab?.videos || [];
    const rawNodes =
      tabVideos.length > 0 || tabLive.length > 0
        ? [...tabVideos, ...tabLive]
        : tabShorts.length > 0
          ? tabShorts
          : (ch.videos || []).filter((n: unknown) => {
              const aid = String((n as { author?: { id?: string } })?.author?.id || '').trim();
              return !aid || aid === canonicalChannelId;
            });

    const videos: MediaVideo[] = [];
    const seenIds = new Set<string>();
    for (const rawNode of rawNodes) {
      const parsed = parseYouTubeVideoNode(rawNode, hl);
      if (!parsed || seenIds.has(parsed.id)) continue;
      seenIds.add(parsed.id);
      videos.push({
        ...parsed,
        channelId: canonicalChannelId,
        channelName: name,
        channelAvatar: avatar || parsed.channelAvatar,
      });
    }

    const payload: ChannelResponse = {
      channel: {
        id: canonicalChannelId,
        name,
        avatar: avatar || undefined,
        banner: banner || undefined,
        subscribersText: subscribersText || undefined,
        description: String(meta?.description || '').trim() || undefined,
      },
      videos,
      source: 'media-server',
    };
    if (videos.length > 0) {
      setCached(cacheKey, payload);
    }
    return payload;
  }

  // Authentic Dailymotion channel videos verified playable
  if (cleanId.startsWith('live_')) {
    const liveEntries = await getLiveDirectoryEntries().catch(() => [] as LiveChannelEntry[]);
    const known = getLiveChannelById(cleanId, liveEntries);
    if (!known) return null;
    const liveCard = await buildPlayableLiveCards([known], hl, 1);
    return {
      channel: {
        id: known.id,
        name: known.label,
        avatar: known.logo || undefined,
        verified: true,
        description: hl === 'ar' ? known.titleAr : `${known.label} Live Broadcast`,
      },
      videos: liveCard,
      source: 'media-server',
    };
  }

  const [rawUser, rawVideos] = await Promise.all([
    fetchDailymotionJson<RawDailymotionUser>(
      `/user/${encodeURIComponent(cleanId)}?fields=${encodeURIComponent(DM_USER_FIELDS)}`,
    ),
    fetchDailymotionJson<{ list?: RawDailymotionVideo[] }>(
      `/user/${encodeURIComponent(cleanId)}/videos?fields=${encodeURIComponent(DM_VIDEO_FIELDS)}&sort=recent&limit=28`,
    ).catch(() => ({ list: [] })),
  ]);

  const channel = parseMediaChannel(rawUser, hl);
  if (!channel) return null;

  const playableRaw = await filterPlayableDailymotionRaw(filterCleanRawVideos(rawVideos.list || []), 24);
  const videos: MediaVideo[] = [];
  for (const raw of playableRaw) {
    const parsed = parseMediaVideo(raw, hl);
    if (parsed) {
      videos.push({
        ...parsed,
        channelName: parsed.channelName || channel.name,
        channelId: cleanId,
      });
    }
  }

  const payload: ChannelResponse = {
    channel: {
      ...channel,
      banner: rawUser.cover_250_url || undefined,
    },
    videos,
    source: 'media-server',
  };

  setCached(cacheKey, payload);
  return payload;
}

interface DirectYouTubeStreamCandidate {
  kind: 'mp4' | 'hls' | 'mux';
  upstreamUrl: string;
  audioUrl?: string;
  clientKey: YouTubeClientKey;
  title?: string;
}

async function tryResolveDirectYouTubeStream(
  id: string,
  hl: AppLocale,
): Promise<{
  stream: DirectYouTubeStreamCandidate | null;
  sawLoginRequired: boolean;
}> {
  const poSession = await getPoTokenSession(id);
  let sawLoginRequired = false;
  let sts: number | undefined;

  const hasCookies = hasPlausibleYouTubeCookies();
  try {
    const ytPlayer = await getYoutubePlayerClient(hl);
    sts = ytPlayer.session.player?.signature_timestamp;
    const clientOrder: YouTubeClientKey[] = hasCookies
      ? ['ANDROID_VR', 'ANDROID', 'IOS', 'TV', 'MWEB', 'WEB']
      : ['ANDROID_VR', 'IOS', 'TV'];
    for (const clientType of clientOrder) {
      const pot =
        clientType === 'WEB' || clientType === 'MWEB'
          ? poSession.contentPoToken
          : poSession.sessionPoToken;
      try {
        const info = await ytPlayer.getBasicInfo(id, { client: clientType, po_token: pot });
        if (info.playability_status?.status !== 'OK') {
          if (info.playability_status?.status === 'LOGIN_REQUIRED') {
            sawLoginRequired = true;
            if (!hasCookies) {
              break;
            }
          }
          continue;
        }

        const hls = info.streaming_data?.hls_manifest_url;
        if (hls) {
          return {
            stream: {
              kind: 'hls',
              upstreamUrl: hls,
              clientKey: clientType,
              title: info.basic_info?.title,
            },
            sawLoginRequired,
          };
        }

        const muxedFormats = [...(info.streaming_data?.formats || [])]
          .filter((f) => f.has_video && f.has_audio)
          .sort((a, b) => (b.height || 0) - (a.height || 0));

        for (const fmt of muxedFormats) {
          let rawUrl = '';
          try {
            rawUrl = (await fmt.decipher(ytPlayer.session.player)) || '';
          } catch {
            rawUrl = fmt.url || '';
          }
          if (rawUrl) {
            return {
              stream: {
                kind: 'mp4',
                upstreamUrl: appendPoTokenToStreamUrl(
                  rawUrl,
                  clientType === 'WEB' || clientType === 'MWEB' ? pot : undefined,
                ),
                clientKey: clientType,
                title: info.basic_info?.title,
              },
              sawLoginRequired,
            };
          }
        }

        // Check adaptive video + audio pairs (for clients returning separate streams)
        const adaptive = [...(info.streaming_data?.adaptive_formats || [])];
        const bestVideo = adaptive
          .filter((f) => f.has_video && !f.has_audio && (f.mime_type || '').includes('video/mp4'))
          .sort((a, b) => {
            const aPref = (a.height || 0) <= 720 ? 1 : 0;
            const bPref = (b.height || 0) <= 720 ? 1 : 0;
            if (aPref !== bPref) return bPref - aPref;
            return (b.height || 0) - (a.height || 0);
          })[0];
        const bestAudio = adaptive
          .filter((f) => f.has_audio && !f.has_video && (f.mime_type || '').includes('audio/mp4'))
          .sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0))[0];

        if (bestVideo && bestAudio) {
          const [vRaw, aRaw] = await Promise.all([
            bestVideo.decipher(ytPlayer.session.player).catch(() => bestVideo.url || ''),
            bestAudio.decipher(ytPlayer.session.player).catch(() => bestAudio.url || ''),
          ]);
          if (vRaw && aRaw) {
            return {
              stream: {
                kind: 'mux',
                upstreamUrl: appendPoTokenToStreamUrl(
                  vRaw,
                  clientType === 'WEB' || clientType === 'MWEB' ? pot : undefined,
                ),
                audioUrl: appendPoTokenToStreamUrl(
                  aRaw,
                  clientType === 'WEB' || clientType === 'MWEB' ? pot : undefined,
                ),
                clientKey: clientType,
                title: info.basic_info?.title,
              },
              sawLoginRequired,
            };
          }
        }
      } catch {
        // try next clientType
      }
    }
  } catch {
    // Continue to direct Innertube signed client attempt
  }

  if (sawLoginRequired && !hasCookies) {
    return { stream: null, sawLoginRequired };
  }

  // Secondary direct check with signed ANDROID_VR / ANDROID / IOS client profiles + PO Token + STS
  const fallbackProfiles: YouTubeClientKey[] = ['ANDROID_VR', 'ANDROID', 'IOS'];
  const cookieHeader = getYouTubeCookieHeader();
  for (const profileKey of fallbackProfiles) {
    const sig = YOUTUBE_CLIENT_SIGNATURES[profileKey];
    try {
      const pr = await fetch('https://www.youtube.com/youtubei/v1/player?prettyPrint=false', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': sig.userAgent,
          'X-YouTube-Client-Name': sig.clientNameId,
          'X-YouTube-Client-Version': sig.clientVersion,
          'X-Goog-Visitor-Id': poSession.visitorData,
          ...(cookieHeader ? { Cookie: cookieHeader } : {}),
        },
        body: JSON.stringify({
          context: {
            client: {
              clientName: sig.clientName,
              clientVersion: sig.clientVersion,
              deviceMake: sig.deviceMake,
              deviceModel: sig.deviceModel,
              androidSdkVersion: sig.androidSdkVersion,
              osName: sig.osName,
              osVersion: sig.osVersion,
              visitorData: poSession.visitorData,
              hl,
              gl: getRegionForLocale(hl),
            },
          },
          ...(sts ? { playbackContext: { contentPlaybackContext: { signatureTimestamp: sts } } } : {}),
          videoId: id,
          serviceIntegrityDimensions: { poToken: poSession.sessionPoToken },
          contentCheckOk: true,
          racyOk: true,
        }),
        signal: AbortSignal.timeout(3500),
      });

      if (!pr.ok) continue;
      const pj = (await pr.json()) as {
        playabilityStatus?: { status?: string };
        videoDetails?: { title?: string };
        streamingData?: {
          hlsManifestUrl?: string;
          formats?: Array<{ url?: string; mimeType?: string; height?: number }>;
          adaptiveFormats?: Array<{ url?: string; mimeType?: string; height?: number; bitrate?: number }>;
        };
      };
      if (pj.playabilityStatus?.status === 'LOGIN_REQUIRED') {
        sawLoginRequired = true;
      }
      if (pj.playabilityStatus?.status === 'OK') {
        if (pj.streamingData?.hlsManifestUrl) {
          return {
            stream: {
              kind: 'hls',
              upstreamUrl: pj.streamingData.hlsManifestUrl,
              clientKey: profileKey,
              title: pj.videoDetails?.title,
            },
            sawLoginRequired,
          };
        }
        const mp4 = (pj.streamingData?.formats || [])
          .filter((f) => Boolean(f.url) && (f.mimeType || '').includes('video/mp4'))
          .sort((a, b) => (b.height || 0) - (a.height || 0))[0];
        if (mp4?.url) {
          return {
            stream: {
              kind: 'mp4',
              upstreamUrl: mp4.url,
              clientKey: profileKey,
              title: pj.videoDetails?.title,
            },
            sawLoginRequired,
          };
        }
        const vAd = (pj.streamingData?.adaptiveFormats || [])
          .filter((f) => Boolean(f.url) && (f.mimeType || '').includes('video/mp4'))
          .sort((a, b) => (b.height || 0) - (a.height || 0))[0];
        const aAd = (pj.streamingData?.adaptiveFormats || [])
          .filter((f) => Boolean(f.url) && (f.mimeType || '').includes('audio/mp4'))
          .sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0))[0];
        if (vAd?.url && aAd?.url) {
          return {
            stream: {
              kind: 'mux',
              upstreamUrl: vAd.url,
              audioUrl: aAd.url,
              clientKey: profileKey,
              title: pj.videoDetails?.title,
            },
            sawLoginRequired,
          };
        }
      }
    } catch {
      // try next profile
    }
  }

  return { stream: null, sawLoginRequired };
}

const verifiedLiveHosts = new Set<string>();

function registerVerifiedHost(rawUrl: string): void {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return;
    const host = parsed.hostname.toLowerCase();
    if (!host) return;
    if (verifiedLiveHosts.size > 500) {
      verifiedLiveHosts.clear();
    }
    verifiedLiveHosts.add(host);
  } catch {
    // ignore invalid URL
  }
}

function registerManifestChildHosts(manifestText: string, baseUrl: string): void {
  for (const rawLine of manifestText.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    if (line.startsWith('#')) {
      const matches = line.matchAll(/URI="([^"]+)"/g);
      for (const m of matches) {
        try {
          registerVerifiedHost(new URL(m[1], baseUrl).toString());
        } catch {
          // ignore
        }
      }
      continue;
    }
    try {
      registerVerifiedHost(new URL(line, baseUrl).toString());
    } catch {
      // ignore
    }
  }
}

function isVerifiedLiveHost(targetUrl: string): boolean {
  try {
    const parsed = new URL(targetUrl);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
    return verifiedLiveHosts.has(parsed.hostname.toLowerCase());
  } catch {
    return false;
  }
}

function resolveRefererForUrl(targetUrl: string): string | null {
  try {
    const host = new URL(targetUrl).hostname.toLowerCase();
    if (host === 'googlevideo.com' || host.endsWith('.googlevideo.com')) {
      return 'https://www.youtube.com/';
    }
    if (
      host === 'dmcdn.net' ||
      host.endsWith('.dmcdn.net') ||
      host === 'dailymotion.com' ||
      host.endsWith('.dailymotion.com') ||
      host === 'dm-event.net' ||
      host.endsWith('.dm-event.net')
    ) {
      return 'https://www.dailymotion.com/';
    }
  } catch {
    // ignore
  }
  return null;
}

async function getLiveDirectoryEntries(): Promise<LiveChannelEntry[]> {
  const cacheKey = 'feed:live-directory:v1';
  const cached = getCached<LiveChannelEntry[]>(cacheKey);
  if (cached) return cached;

  const sources = [
    'https://iptv-org.github.io/iptv/countries/iq.m3u',
    'https://iptv-org.github.io/iptv/languages/ara.m3u',
  ];

  const collected: LiveChannelEntry[] = [];
  await Promise.all(
    sources.map(async (src) => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 3500);
      try {
        const res = await fetch(src, {
          headers: { 'User-Agent': DESKTOP_UA },
          signal: controller.signal,
        });
        if (res.ok) {
          const txt = await res.text();
          collected.push(...parseM3uLivePlaylist(txt));
        }
      } catch {
        // non-blocking fallback to built-in curated live directory
      } finally {
        clearTimeout(timer);
      }
    }),
  );

  setCached(cacheKey, collected, 30 * 60 * 1000);
  return collected;
}

async function canPlayHlsDirectly(targetUrl: string): Promise<boolean> {
  if (!targetUrl.startsWith('https://')) return false;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 3500);
  try {
    const res = await fetch(targetUrl, {
      headers: {
        'User-Agent': DESKTOP_UA,
        Origin: 'http://localhost:3000',
        Accept: 'application/vnd.apple.mpegurl, */*',
      },
      signal: controller.signal,
    });
    const allowed = res.ok && Boolean(res.headers.get('access-control-allow-origin'));
    try {
      await res.body?.cancel();
    } catch {
      // ignore cancel errors
    }
    return allowed;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

async function probeHlsLiveUrl(
  targetUrl: string,
  title?: string,
): Promise<{ kind: 'hls'; upstreamUrl: string; directCorsAllowed: boolean; title?: string } | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 4500);
  try {
    const probe = await fetch(targetUrl, {
      headers: {
        'User-Agent': DESKTOP_UA,
        Origin: 'http://localhost:3000',
        Accept: 'application/vnd.apple.mpegurl, */*',
      },
      signal: controller.signal,
    });
    if (!probe.ok) return null;
    const finalUrl = probe.url || targetUrl;
    const directCorsAllowed =
      finalUrl.startsWith('https://') &&
      Boolean(probe.headers.get('access-control-allow-origin'));
    registerVerifiedHost(targetUrl);
    registerVerifiedHost(finalUrl);
    const preview = await probe.text().catch(() => '');
    if (preview) {
      registerManifestChildHosts(preview, finalUrl);
    }
    return {
      kind: 'hls',
      upstreamUrl: finalUrl,
      directCorsAllowed,
      title,
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function resolveLiveBroadcastStream(
  id: string,
  hl: AppLocale,
  titleHint?: string,
): Promise<{ kind: 'hls'; upstreamUrl: string; directCorsAllowed: boolean; title?: string } | null> {
  const dynamicEntries = await getLiveDirectoryEntries().catch(() => [] as LiveChannelEntry[]);

  if (id.startsWith('live_')) {
    const known = getLiveChannelById(id, dynamicEntries);
    if (!known) return null;
    return probeHlsLiveUrl(known.url, titleHint || (hl === 'ar' ? known.titleAr : known.label));
  }

  const cleanHint = (titleHint || '').trim();
  let matched = cleanHint
    ? matchLiveBroadcastStream(cleanHint, '', false, dynamicEntries)
    : null;
  let resolvedTitle = cleanHint;

  if (!matched) {
    const details = await getMediaVideoDetails(id, hl).catch(() => null);
    if (details?.video) {
      resolvedTitle = details.video.title || cleanHint;
      matched = matchLiveBroadcastStream(
        details.video.title,
        details.video.channelName,
        Boolean(details.video.isLive),
        dynamicEntries,
      );
    }
  }

  if (!matched) return null;
  return probeHlsLiveUrl(matched.url, resolvedTitle || matched.label);
}

let ytDlpInstallPromise: Promise<string | null> | null = null;
const YTDLP_CACHE_BIN = path.join(process.cwd(), '.cache', 'bin', 'yt-dlp');
const YTDLP_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

async function ensureYtDlpBinary(): Promise<string | null> {
  const candidates = [
    process.env.YT_DLP_PATH?.trim() || '',
    YTDLP_CACHE_BIN,
    '/tmp/yt-dlp',
    '/usr/local/bin/yt-dlp',
    '/usr/bin/yt-dlp',
  ].filter(Boolean);

  for (const binPath of candidates) {
    try {
      await fs.access(binPath, fs.constants.X_OK);
      const stat = await fs.stat(binPath);
      if (binPath === YTDLP_CACHE_BIN && Date.now() - stat.mtimeMs > YTDLP_MAX_AGE_MS) {
        break;
      }
      return binPath;
    } catch {
      // check next path
    }
  }

  if (ytDlpInstallPromise) return ytDlpInstallPromise;

  ytDlpInstallPromise = (async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 18000);
    try {
      const res = await fetch(
        'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp',
        { headers: { 'User-Agent': DESKTOP_UA }, signal: controller.signal },
      );
      if (!res.ok) return null;
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length < 100_000) return null;

      try {
        await fs.mkdir(path.dirname(YTDLP_CACHE_BIN), { recursive: true });
        await fs.writeFile(YTDLP_CACHE_BIN, buf);
        await fs.chmod(YTDLP_CACHE_BIN, 0o755);
        return YTDLP_CACHE_BIN;
      } catch {
        const tmpPath = '/tmp/yt-dlp';
        await fs.writeFile(tmpPath, buf);
        await fs.chmod(tmpPath, 0o755);
        return tmpPath;
      }
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
      ytDlpInstallPromise = null;
    }
  })();

  return ytDlpInstallPromise;
}

async function tryResolveViaYtDlp(id: string): Promise<DirectYouTubeStreamCandidate | null> {
  const binPath = await ensureYtDlpBinary();
  if (!binPath) return null;

  const poSession = await getPoTokenSession(id);
  const hasCookies = hasPlausibleYouTubeCookies();
  const extractorArg = [
    hasCookies
      ? 'youtube:player_client=android_vr,android,ios,mweb,tv'
      : 'youtube:player_client=android_vr,ios,tv',
    `po_token=mweb.gvs+${poSession.contentPoToken},web.gvs+${poSession.contentPoToken},ios.gvs+${poSession.sessionPoToken},android.gvs+${poSession.sessionPoToken},android_vr.gvs+${poSession.sessionPoToken}`,
    `visitor_data=${poSession.visitorData}`,
  ].join(';');

  const args = [
    '--js-runtimes',
    'node',
    '--no-playlist',
    '--no-warnings',
    '--skip-download',
    '-f',
    'bv*[ext=mp4][height<=720]+ba[ext=m4a]/b[ext=mp4]/b',
    '--extractor-args',
    extractorArg,
    '-J',
  ];

  let tempCookiePath: string | null = null;
  if (hasCookies) {
    const rawCookies = process.env.YT_COOKIES?.trim() || '';
    if (rawCookies.startsWith('# Netscape')) {
      tempCookiePath = path.join(os.tmpdir(), `yt-cookies-${process.pid}.txt`);
      await fs.writeFile(tempCookiePath, rawCookies, 'utf8').catch(() => {});
      args.push('--cookies', tempCookiePath);
    } else {
      args.push('--add-header', `Cookie:${rawCookies}`);
    }
  }

  args.push(`https://www.youtube.com/watch?v=${id}`);

  try {
    const { stdout } = await execFileAsync(binPath, args, {
      timeout: hasCookies ? 14000 : 8000,
      maxBuffer: 8 * 1024 * 1024,
    });
    const parsed = JSON.parse(stdout) as {
      title?: string;
      is_live?: boolean;
      manifest_url?: string;
      url?: string;
      requested_formats?: Array<{ url?: string; vcodec?: string; acodec?: string }>;
      formats?: Array<{
        url?: string;
        manifest_url?: string;
        ext?: string;
        vcodec?: string;
        acodec?: string;
        height?: number;
        protocol?: string;
      }>;
    };

    if (parsed.is_live && parsed.manifest_url) {
      registerVerifiedHost(parsed.manifest_url);
      return {
        kind: 'hls',
        upstreamUrl: parsed.manifest_url,
        clientKey: detectYouTubeClientFromUrl(parsed.manifest_url, 'IOS'),
        title: parsed.title,
      };
    }

    if (Array.isArray(parsed.requested_formats) && parsed.requested_formats.length >= 2) {
      const vPart = parsed.requested_formats.find((f) => f.url && f.vcodec && f.vcodec !== 'none');
      const aPart = parsed.requested_formats.find((f) => f.url && f.acodec && f.acodec !== 'none' && (!f.vcodec || f.vcodec === 'none'));
      if (vPart?.url && aPart?.url) {
        return {
          kind: 'mux',
          upstreamUrl: vPart.url,
          audioUrl: aPart.url,
          clientKey: detectYouTubeClientFromUrl(vPart.url, 'ANDROID_VR'),
          title: parsed.title,
        };
      }
    }

    const formats = Array.isArray(parsed.formats) ? parsed.formats : [];
    const muxedMp4 = formats
      .filter(
        (f) =>
          Boolean(f.url) &&
          f.vcodec &&
          f.vcodec !== 'none' &&
          f.acodec &&
          f.acodec !== 'none' &&
          f.protocol !== 'm3u8_native' &&
          f.protocol !== 'm3u8',
      )
      .sort((a, b) => {
        const aMp4 = a.ext === 'mp4' ? 1 : 0;
        const bMp4 = b.ext === 'mp4' ? 1 : 0;
        if (aMp4 !== bMp4) return bMp4 - aMp4;
        return (b.height || 0) - (a.height || 0);
      })[0];

    if (muxedMp4?.url) {
      return {
        kind: 'mp4',
        upstreamUrl: muxedMp4.url,
        clientKey: detectYouTubeClientFromUrl(muxedMp4.url, 'ANDROID'),
        title: parsed.title,
      };
    }

    const hlsFormat = formats.find(
      (f) =>
        Boolean(f.manifest_url || f.url) &&
        (f.protocol === 'm3u8' || f.protocol === 'm3u8_native' || (f.url || '').includes('.m3u8')),
    );
    const hlsUrl = hlsFormat?.manifest_url || hlsFormat?.url || parsed.manifest_url;
    if (hlsUrl) {
      registerVerifiedHost(hlsUrl);
      return {
        kind: 'hls',
        upstreamUrl: hlsUrl,
        clientKey: detectYouTubeClientFromUrl(hlsUrl, 'IOS'),
        title: parsed.title,
      };
    }
  } catch {
    // fallback below
  } finally {
    if (tempCookiePath) {
      await fs.unlink(tempCookiePath).catch(() => {});
    }
  }

  return null;
}

async function tryResolveIndependentMirror(
  id: string,
  hl: AppLocale,
  titleHint?: string,
): Promise<{ dmId: string; title: string } | null> {
  let title = (titleHint || '').trim();
  let durationSeconds = 0;

  const details = await getMediaVideoDetails(id, hl).catch(() => null);
  if (details?.video?.title && details.video.title !== id) {
    title = details.video.title;
    durationSeconds = details.video.durationSeconds || 0;
  }

  if (!title || title === id) return null;

  try {
    const cleanSearchTitle = normalizeGlobalQuery(title).slice(0, 75) || title.slice(0, 75);
    const dmRes = await fetchDailymotionJson<{ list?: RawDailymotionVideo[] }>(
      `/videos?fields=id,title,duration&limit=10&sort=relevance&search=${encodeURIComponent(cleanSearchTitle)}`,
      6000,
    );
    const candidates: Array<{ id: string; score: number; title: string }> = [];
    for (const cand of filterCleanRawVideos(dmRes.list || [])) {
      const cid = String(cand.id || '').trim();
      const cTitle = String(cand.title || '').trim();
      const cDur = Number(cand.duration || 0);
      if (!cid || !cTitle || cid === id) continue;
      const score = scoreStreamCandidateMatch(title, durationSeconds, cTitle, cDur);
      if (score >= 0.86) {
        candidates.push({ id: cid, score, title: cTitle });
      }
    }

    candidates.sort((a, b) => b.score - a.score);
    for (const cand of candidates.slice(0, 3)) {
      const info = await fetchDailymotionMasterInfo(cand.id).catch(() => null);
      if (info?.masterUrl) {
        return { dmId: cand.id, title: cand.title || title };
      }
    }
  } catch {
    // ignore mirror error
  }

  return null;
}

export async function resolveVideoPlayback(
  idOrUrl: string,
  hl: AppLocale = 'ar',
  options?: { titleHint?: string },
): Promise<StreamResolutionResult> {
  const cleanId = extractMediaId(idOrUrl);
  const titleHint = (options?.titleHint || '').trim();

  if (!cleanId) {
    return {
      playable: false,
      code: 'INVALID_ID',
      reason: hl === 'ar' ? 'معرّف الفيديو غير صالح' : 'Invalid video ID',
    };
  }

  if (cleanId.startsWith('live_')) {
    const cacheKey = `livestream:direct:${cleanId}`;
    const cached = getCached<StreamResolutionResult>(cacheKey);
    if (cached) return cached;

    const liveStream = await resolveLiveBroadcastStream(cleanId, hl, titleHint);
    if (liveStream) {
      const resolved: StreamResolutionResult = {
        playable: true,
        kind: 'hls',
        url: `/api/videos/item/${encodeURIComponent(cleanId)}/stream.m3u8`,
        upstreamUrl: liveStream.upstreamUrl,
        title: liveStream.title || titleHint,
      };
      setCached(cacheKey, resolved, 5 * 60 * 1000);
      return resolved;
    }

    return {
      playable: false,
      code: 'STREAM_UNAVAILABLE',
      reason: hl === 'ar' ? 'البث المباشر غير متاح حالياً.' : 'Live stream unavailable.',
    };
  }

  if (!isYouTubeVideoId(cleanId)) {
    const dmCacheKey = `dmstream:direct:${cleanId}`;
    const dmCached = getCached<StreamResolutionResult>(dmCacheKey);
    if (dmCached) return dmCached;

    const dmInfo = await fetchDailymotionMasterInfo(cleanId).catch(() => null);
    if (dmInfo?.masterUrl) {
      const resolved: StreamResolutionResult = {
        playable: true,
        kind: 'hls',
        url: `/api/videos/item/${encodeURIComponent(cleanId)}/stream.m3u8`,
        upstreamUrl: dmInfo.masterUrl,
        dmId: cleanId,
        title: dmInfo.title,
      };
      setCached(dmCacheKey, resolved, 10 * 60 * 1000);
      return resolved;
    }

    const failDm: StreamResolutionResult = {
      playable: false,
      code: 'STREAM_UNAVAILABLE',
      reason:
        hl === 'ar'
          ? 'هذا الفيديو غير متاح للتشغيل حالياً من المصدر.'
          : 'This video stream is currently unavailable from source.',
    };
    setCached(dmCacheKey, failDm, 2 * 60 * 1000);
    return failDm;
  }

  const cacheKey = `ytstream:direct:${cleanId}`;
  const cached = getCached<StreamResolutionResult>(cacheKey);
  if (cached) return cached;

  if (isLikelyLiveHint(titleHint)) {
    const liveStream = await resolveLiveBroadcastStream(cleanId, hl, titleHint);
    if (liveStream) {
      const resolved: StreamResolutionResult = {
        playable: true,
        kind: 'hls',
        url: `/api/videos/item/${encodeURIComponent(cleanId)}/stream.m3u8`,
        upstreamUrl: liveStream.upstreamUrl,
        title: liveStream.title || titleHint,
      };
      setCached(cacheKey, resolved, 15 * 60 * 1000);
      return resolved;
    }
  }

  const { stream: direct, sawLoginRequired } = await tryResolveDirectYouTubeStream(cleanId, hl);
  if (direct) {
    registerVerifiedHost(direct.upstreamUrl);
    const directUrl =
      direct.kind === 'mp4' || direct.kind === 'mux'
        ? `/api/videos/item/${encodeURIComponent(cleanId)}/media.mp4`
        : `/api/videos/item/${encodeURIComponent(cleanId)}/stream.m3u8`;
    const resolved: StreamResolutionResult = {
      playable: true,
      kind: direct.kind,
      url: directUrl,
      upstreamUrl: direct.upstreamUrl,
      audioUrl: direct.audioUrl,
      clientKey: direct.clientKey,
      title: direct.title || titleHint,
    };
    setCached(cacheKey, resolved, 20 * 60 * 1000);
    return resolved;
  }

  const ytDlpResolved =
    sawLoginRequired && !hasPlausibleYouTubeCookies() ? null : await tryResolveViaYtDlp(cleanId);
  if (ytDlpResolved) {
    registerVerifiedHost(ytDlpResolved.upstreamUrl);
    const directUrl =
      ytDlpResolved.kind === 'mp4' || ytDlpResolved.kind === 'mux'
        ? `/api/videos/item/${encodeURIComponent(cleanId)}/media.mp4`
        : `/api/videos/item/${encodeURIComponent(cleanId)}/stream.m3u8`;
    const resolved: StreamResolutionResult = {
      playable: true,
      kind: ytDlpResolved.kind,
      url: directUrl,
      upstreamUrl: ytDlpResolved.upstreamUrl,
      audioUrl: ytDlpResolved.audioUrl,
      clientKey: ytDlpResolved.clientKey,
      title: ytDlpResolved.title || titleHint,
    };
    setCached(cacheKey, resolved, 20 * 60 * 1000);
    return resolved;
  }

  const mirror = await tryResolveIndependentMirror(cleanId, hl, titleHint);
  if (mirror) {
    const dmInfo = await fetchDailymotionMasterInfo(mirror.dmId).catch(() => null);
    if (dmInfo?.masterUrl) {
      const resolved: StreamResolutionResult = {
        playable: true,
        kind: 'hls',
        url: `/api/videos/item/${encodeURIComponent(cleanId)}/stream.m3u8`,
        upstreamUrl: dmInfo.masterUrl,
        dmId: mirror.dmId,
        title: mirror.title,
      };
      setCached(cacheKey, resolved, 20 * 60 * 1000);
      return resolved;
    }
  }

  const failedResult: StreamResolutionResult = {
    playable: false,
    code: sawLoginRequired ? 'YT_STREAM_AUTH_REQUIRED' : 'STREAM_UNAVAILABLE',
    reason:
      hl === 'ar'
        ? 'هذا الفيديو غير متاح للتشغيل حالياً من المصدر.'
        : 'This video stream is currently unavailable from source.',
  };
  setCached(cacheKey, failedResult, 2 * 60 * 1000);
  return failedResult;
}

async function fetchDailymotionMasterInfo(
  dmId: string,
): Promise<{ masterUrl: string; title?: string } | null> {
  const cleanDmId = dmId.trim();
  if (!cleanDmId) return null;

  const cacheKey = `dm:master:${cleanDmId}`;
  const cached = getCached<{ masterUrl: string; title?: string } | null>(cacheKey);
  if (cached !== null) return cached;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 4500);
  try {
    const metaRes = await fetch(
      `https://www.dailymotion.com/player/metadata/video/${encodeURIComponent(cleanDmId)}?embedder=https%3A%2F%2Fwww.dailymotion.com%2F`,
      {
        headers: {
          'User-Agent': DESKTOP_UA,
          Referer: 'https://www.dailymotion.com/',
          Origin: 'https://www.dailymotion.com',
        },
        signal: controller.signal,
      },
    );
    if (!metaRes.ok) {
      setCached(cacheKey, null, 2 * 60 * 1000);
      return null;
    }

    const meta = (await metaRes.json()) as {
      title?: string;
      qualities?: Record<string, Array<{ type?: string; url?: string }>>;
    };
    const qualities = meta.qualities || {};
    const candidateList =
      qualities.auto ||
      qualities['1080'] ||
      qualities['720'] ||
      qualities['480'] ||
      qualities['380'] ||
      Object.values(qualities).flat();

    const masterUrl = candidateList.find((q) => q?.url)?.url;
    if (!masterUrl) {
      setCached(cacheKey, null, 2 * 60 * 1000);
      return null;
    }
    const result = { masterUrl, title: meta.title };
    setCached(cacheKey, result, 5 * 60 * 1000);
    return result;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function streamVideoMasterManifest(id: string, res: Response): Promise<void> {
  const resolved = await resolveVideoPlayback(id, 'ar');
  if (!resolved.playable) {
    const errStatus =
      resolved.code === 'YT_STREAM_AUTH_REQUIRED'
        ? 403
        : resolved.code === 'STREAM_UNAVAILABLE'
          ? 404
          : 503;
    res.status(errStatus).json({ error: resolved.reason || 'Stream unavailable', code: resolved.code });
    return;
  }

  if (resolved.kind === 'hls' && resolved.upstreamUrl) {
    const headers: Record<string, string> = {
      'User-Agent': DESKTOP_UA,
      Accept: 'application/vnd.apple.mpegurl, */*',
    };
    const referer = resolveRefererForUrl(resolved.upstreamUrl);
    if (referer) headers.Referer = referer;

    const upstream = await fetch(resolved.upstreamUrl, { headers });
    if (!upstream.ok) {
      res.status(upstream.status || 502).json({ error: 'Failed to load HLS playlist' });
      return;
    }
    const finalManifestUrl = upstream.url || resolved.upstreamUrl;
    registerVerifiedHost(finalManifestUrl);
    const text = await upstream.text();
    registerManifestChildHosts(text, finalManifestUrl);
    const rewritten = rewriteM3u8Manifest(text, finalManifestUrl, '/api/videos/hls');
    res.status(200);
    res.setHeader('Content-Type', 'application/vnd.apple.mpegurl; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache');
    res.send(rewritten);
    return;
  }

  const dmId = resolved.dmId || (!isYouTubeVideoId(id) ? id : '');
  if (!dmId) {
    res.status(404).json({ error: 'HLS manifest unavailable for this video' });
    return;
  }

  const dmInfo = await fetchDailymotionMasterInfo(dmId);
  if (!dmInfo) {
    res.status(404).json({ error: 'Playable stream unavailable for this video' });
    return;
  }

  const masterRes = await fetch(dmInfo.masterUrl, {
    headers: {
      'User-Agent': DESKTOP_UA,
      Referer: 'https://www.dailymotion.com/',
    },
  });

  if (!masterRes.ok) {
    res.status(masterRes.status || 502).json({ error: 'Failed to fetch stream playlist' });
    return;
  }

  const manifestText = await masterRes.text();
  const rewritten = rewriteM3u8Manifest(manifestText, masterRes.url || dmInfo.masterUrl, '/api/videos/hls');

  res.status(200);
  res.setHeader('Content-Type', 'application/vnd.apple.mpegurl; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache');
  res.send(rewritten);
}

export async function streamDirectVideoMp4(
  id: string,
  req: Request,
  res: Response,
): Promise<void> {
  const resolved = await resolveVideoPlayback(id, 'ar');
  if (!resolved.playable || !resolved.upstreamUrl || (resolved.kind !== 'mp4' && resolved.kind !== 'mux')) {
    const errStatus =
      resolved.code === 'YT_STREAM_AUTH_REQUIRED'
        ? 403
        : resolved.code === 'STREAM_UNAVAILABLE'
          ? 404
          : 503;
    res.status(errStatus).json({ error: resolved.reason || 'Direct MP4 stream unavailable', code: resolved.code });
    return;
  }

  const clientHeaders = getClientHeadersForStreamUrl(resolved.upstreamUrl, resolved.clientKey || 'ANDROID');

  if (resolved.kind === 'mux' && resolved.audioUrl) {
    res.status(200);
    res.setHeader('Content-Type', 'video/mp4');
    res.setHeader('Cache-Control', 'no-store');

    const headerLines = Object.entries(clientHeaders)
      .map(([k, v]) => `${k}: ${v}`)
      .join('\r\n') + '\r\n';

    const ffmpeg = spawn('ffmpeg', [
      '-hide_banner',
      '-loglevel',
      'error',
      '-headers',
      headerLines,
      '-i',
      resolved.upstreamUrl,
      '-headers',
      headerLines,
      '-i',
      resolved.audioUrl,
      '-c',
      'copy',
      '-movflags',
      'frag_keyframe+empty_moov+default_base_moof',
      '-f',
      'mp4',
      'pipe:1',
    ]);

    req.on('close', () => {
      if (!ffmpeg.killed) ffmpeg.kill('SIGKILL');
    });

    ffmpeg.stdout.pipe(res);
    ffmpeg.on('error', () => {
      if (!res.headersSent) res.status(500).json({ error: 'FFmpeg muxer failed' });
      else if (!res.writableEnded) res.end();
    });
    ffmpeg.on('close', (code) => {
      if (code !== 0 && !res.headersSent) res.status(502).json({ error: 'Stream mux failed' });
      else if (!res.writableEnded) res.end();
    });
    return;
  }

  const headers: Record<string, string> = { ...clientHeaders };
  if (typeof req.headers.range === 'string') {
    headers.Range = req.headers.range;
  }

  const upstream = await fetch(resolved.upstreamUrl, { headers });
  if (!upstream.ok && upstream.status !== 206) {
    res.status(upstream.status || 502).end();
    return;
  }

  res.status(upstream.status);
  res.setHeader('Content-Type', upstream.headers.get('content-type') || 'video/mp4');
  res.setHeader('Accept-Ranges', 'bytes');
  const len = upstream.headers.get('content-length');
  const range = upstream.headers.get('content-range');
  if (len) res.setHeader('Content-Length', len);
  if (range) res.setHeader('Content-Range', range);

  if (!upstream.body) {
    res.end();
    return;
  }

  const nodeStream = Readable.fromWeb(upstream.body as unknown as NodeReadableStream);
  nodeStream.on('error', () => {
    if (!res.headersSent) res.status(502);
    res.end();
  });
  nodeStream.pipe(res);
}

export async function proxyHlsResource(
  targetUrl: string,
  rangeHeader: string | undefined,
  res: Response,
): Promise<void> {
  if (!isAllowedStreamHost(targetUrl) && !isVerifiedLiveHost(targetUrl)) {
    res.status(403).json({ error: 'Forbidden stream host' });
    return;
  }

  const headers: Record<string, string> = {
    'User-Agent': DESKTOP_UA,
  };
  const referer = resolveRefererForUrl(targetUrl);
  if (referer) {
    headers.Referer = referer;
  }
  if (rangeHeader) {
    headers.Range = rangeHeader;
  }

  const upstream = await fetch(targetUrl, { headers });
  if (!upstream.ok && upstream.status !== 206) {
    res.status(upstream.status || 502).end();
    return;
  }

  if (upstream.url) {
    registerVerifiedHost(upstream.url);
  }

  const ct = upstream.headers.get('content-type') || '';
  const isPlaylist =
    targetUrl.includes('.m3u8') || ct.includes('mpegurl') || ct.includes('x-mpegurl');

  if (isPlaylist) {
    const finalManifestUrl = upstream.url || targetUrl;
    const text = await upstream.text();
    registerManifestChildHosts(text, finalManifestUrl);
    const rewritten = rewriteM3u8Manifest(text, finalManifestUrl, '/api/videos/hls');
    res.status(200);
    res.setHeader('Content-Type', 'application/vnd.apple.mpegurl; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache');
    res.send(rewritten);
    return;
  }

  res.status(upstream.status);
  if (ct) res.setHeader('Content-Type', ct);
  const contentLength = upstream.headers.get('content-length');
  const contentRange = upstream.headers.get('content-range');
  if (contentLength) res.setHeader('Content-Length', contentLength);
  if (contentRange) res.setHeader('Content-Range', contentRange);
  res.setHeader('Cache-Control', 'public, max-age=600');

  if (!upstream.body) {
    res.end();
    return;
  }

  const nodeStream = Readable.fromWeb(upstream.body as unknown as NodeReadableStream);
  nodeStream.on('error', () => {
    if (!res.headersSent) res.status(502);
    res.end();
  });
  nodeStream.pipe(res);
}

export async function downloadVideoAsMp4(
  id: string,
  req: Request,
  res: Response,
): Promise<void> {
  const cleanId = extractMediaId(id);
  const probeOnly = req.query.probe === '1' || req.query.probe === 'true';
  if (!cleanId) {
    res.status(400).json({ error: 'Invalid video ID' });
    return;
  }

  const resolved = await resolveVideoPlayback(cleanId, 'ar');
  if (!resolved.playable) {
    if (probeOnly) {
      res.status(200).json({
        downloadable: false,
        code: resolved.code,
        reason: resolved.reason || 'Download unavailable without YT_COOKIES',
      });
      return;
    }
    res.status(503).json({
      error: resolved.reason || 'Download unavailable without YT_COOKIES',
      code: resolved.code,
    });
    return;
  }

  const filename = sanitizeDownloadFilename(resolved.title || '', cleanId);
  const asciiFallback = `dramasquare-${cleanId}.mp4`;

  if (probeOnly) {
    res.status(200).json({
      downloadable: true,
      kind: resolved.kind,
      filename,
    });
    return;
  }

  // Muxed adaptive video + audio MP4 download via FFmpeg
  if (resolved.kind === 'mux' && resolved.upstreamUrl && resolved.audioUrl) {
    res.status(200);
    res.setHeader('Content-Type', 'video/mp4');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
    );
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition, Content-Length');

    const videoHeaders = getClientHeadersForStreamUrl(resolved.upstreamUrl, resolved.clientKey || 'ANDROID');
    const audioHeaders = getClientHeadersForStreamUrl(resolved.audioUrl, resolved.clientKey || 'ANDROID');
    const vHeaderLines = Object.entries(videoHeaders).map(([k, v]) => `${k}: ${v}`).join('\r\n') + '\r\n';
    const aHeaderLines = Object.entries(audioHeaders).map(([k, v]) => `${k}: ${v}`).join('\r\n') + '\r\n';

    const ffmpeg = spawn('ffmpeg', [
      '-hide_banner',
      '-loglevel',
      'error',
      '-headers',
      vHeaderLines,
      '-i',
      resolved.upstreamUrl,
      '-headers',
      aHeaderLines,
      '-i',
      resolved.audioUrl,
      '-c',
      'copy',
      '-movflags',
      'frag_keyframe+empty_moov+default_base_moof',
      '-f',
      'mp4',
      'pipe:1',
    ]);

    req.on('close', () => {
      if (!ffmpeg.killed) ffmpeg.kill('SIGKILL');
    });

    ffmpeg.stdout.pipe(res);
    ffmpeg.on('error', () => {
      if (!res.headersSent) res.status(500).json({ error: 'FFmpeg muxer failed to start' });
      else if (!res.writableEnded) res.end();
    });
    ffmpeg.on('close', (code) => {
      if (code !== 0 && !res.headersSent) res.status(502).json({ error: 'Failed to prepare MP4 download' });
      else if (!res.writableEnded) res.end();
    });
    return;
  }

  // Direct progressive MP4 from YouTube -> stream directly with Content-Length using matching client User-Agent
  if (resolved.kind === 'mp4' && resolved.upstreamUrl) {
    const upstream = await fetch(resolved.upstreamUrl, {
      headers: getClientHeadersForStreamUrl(resolved.upstreamUrl, resolved.clientKey || 'ANDROID'),
    });
    if (!upstream.ok || !upstream.body) {
      res.status(upstream.status || 502).json({ error: 'MP4 upstream stream unavailable' });
      return;
    }

    res.status(200);
    res.setHeader('Content-Type', 'video/mp4');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
    );
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition, Content-Length');
    const len = upstream.headers.get('content-length');
    if (len) res.setHeader('Content-Length', len);

    const nodeStream = Readable.fromWeb(upstream.body as unknown as NodeReadableStream);
    nodeStream.on('error', () => {
      if (!res.writableEnded) res.end();
    });
    nodeStream.pipe(res);
    return;
  }

  // HLS -> MP4 remux via FFmpeg
  let inputUrl = resolved.upstreamUrl || '';
  if (!inputUrl && resolved.dmId) {
    const dmInfo = await fetchDailymotionMasterInfo(resolved.dmId);
    if (!dmInfo) {
      res.status(404).json({ error: 'Downloadable stream unavailable' });
      return;
    }
    inputUrl = dmInfo.masterUrl;
    try {
      const masterRes = await fetch(dmInfo.masterUrl, {
        headers: {
          'User-Agent': DESKTOP_UA,
          Referer: 'https://www.dailymotion.com/',
        },
      });
      if (masterRes.ok) {
        const masterText = await masterRes.text();
        const picked = pickDownloadVariantUrl(masterText, masterRes.url || dmInfo.masterUrl, 480);
        if (picked) inputUrl = picked;
      }
    } catch {
      // keep masterUrl
    }
  }

  if (!inputUrl) {
    res.status(404).json({ error: 'Downloadable stream unavailable' });
    return;
  }

  res.status(200);
  res.setHeader('Content-Type', 'video/mp4');
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
  );
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition, Content-Length');

  const ffmpegReferer = resolveRefererForUrl(inputUrl);
  const ffmpegHeaders = ffmpegReferer
    ? `Referer: ${ffmpegReferer}\r\nUser-Agent: ${DESKTOP_UA}\r\n`
    : `User-Agent: ${DESKTOP_UA}\r\n`;

  const ffmpeg = spawn('ffmpeg', [
    '-hide_banner',
    '-loglevel',
    'error',
    '-headers',
    ffmpegHeaders,
    '-i',
    inputUrl,
    '-c',
    'copy',
    '-bsf:a',
    'aac_adtstoasc',
    '-movflags',
    'frag_keyframe+empty_moov+default_base_moof',
    '-f',
    'mp4',
    'pipe:1',
  ]);

  let clientClosed = false;
  req.on('close', () => {
    clientClosed = true;
    if (!ffmpeg.killed) {
      ffmpeg.kill('SIGKILL');
    }
  });

  ffmpeg.stdout.pipe(res);

  ffmpeg.stderr.on('data', (chunk: Buffer) => {
    const msg = chunk.toString().trim();
    if (msg && !clientClosed) {
      console.error(`[downloadVideoAsMp4:${cleanId}]`, msg);
    }
  });

  ffmpeg.on('error', () => {
    if (!res.headersSent) {
      res.status(500).json({ error: 'FFmpeg remuxer failed to start' });
    } else if (!res.writableEnded) {
      res.end();
    }
  });

  ffmpeg.on('close', (code) => {
    if (code !== 0 && !res.headersSent) {
      res.status(502).json({ error: 'Failed to prepare MP4 download' });
    } else if (!res.writableEnded) {
      res.end();
    }
  });
}
