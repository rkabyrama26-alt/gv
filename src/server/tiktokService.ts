import type { Response } from 'express';
import { Readable } from 'node:stream';
import type { ReadableStream as NodeReadableStream } from 'node:stream/web';
import type { TikTokCategory, TikTokFeedResponse, TikTokReel } from '../shared/types.ts';
import {
  detectQueryCategories,
  parseTikTokFeedList,
  searchTikTokPool,
  type RawTikTokItem,
} from './tiktokParser.ts';

const DESKTOP_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const CATEGORY_MAP: Record<Exclude<TikTokCategory, 'all'>, number> = {
  comedy: 104,
  gaming: 105,
  sports: 112,
  music: 119,
  food: 111,
};

interface MediaEntry {
  playUrl: string;
  downloadUrl?: string;
  coverUrl?: string;
  avatarUrl?: string;
  cookie: string;
  expiresAt: number;
}

interface FeedCacheEntry {
  data: TikTokFeedResponse;
  expiresAt: number;
}

const mediaRegistry = new Map<string, MediaEntry>();
const feedCache = new Map<string, FeedCacheEntry>();
const staleFeedFallback = new Map<string, TikTokFeedResponse>();
const inFlightFeeds = new Map<string, Promise<TikTokFeedResponse>>();
let sessionCookieCache: { cookie: string; expiresAt: number } | null = null;
let inFlightCookiePromise: Promise<string> | null = null;

function pruneExpired(): void {
  const now = Date.now();
  if (mediaRegistry.size > 500) {
    for (const [key, entry] of mediaRegistry.entries()) {
      if (entry.expiresAt < now) mediaRegistry.delete(key);
    }
  }
  if (feedCache.size > 50) {
    for (const [key, entry] of feedCache.entries()) {
      if (entry.expiresAt < now) feedCache.delete(key);
    }
  }
}

async function getTikTokSessionCookie(forceRefresh = false): Promise<string> {
  if (!forceRefresh && sessionCookieCache && sessionCookieCache.expiresAt > Date.now()) {
    return sessionCookieCache.cookie;
  }

  if (inFlightCookiePromise) {
    return inFlightCookiePromise;
  }

  inFlightCookiePromise = (async () => {
    try {
      const res = await fetch('https://www.tiktok.com/explore', {
        headers: {
          'User-Agent': DESKTOP_UA,
          'Accept-Language': 'ar,en-US;q=0.9,en;q=0.8',
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        },
      });

      const setCookies =
        typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [];
      const cookie = setCookies.map((c) => c.split(';')[0]).filter(Boolean).join('; ');

      if (cookie) {
        sessionCookieCache = {
          cookie,
          expiresAt: Date.now() + 15 * 60 * 1000,
        };
      }
      return cookie;
    } finally {
      inFlightCookiePromise = null;
    }
  })();

  return inFlightCookiePromise;
}

async function fetchExploreCategoryRaw(
  categoryType: number,
  cookie: string,
  count = 15,
): Promise<RawTikTokItem[]> {
  const url = `https://www.tiktok.com/api/explore/item_list/?aid=1988&count=${count}&categoryType=${categoryType}`;
  const res = await fetch(url, {
    headers: {
      'User-Agent': DESKTOP_UA,
      Cookie: cookie,
      Referer: 'https://www.tiktok.com/explore',
      Accept: 'application/json, text/plain, */*',
    },
  });

  if (!res.ok) return [];
  const text = await res.text();
  if (!text) return [];

  try {
    const json = JSON.parse(text) as { itemList?: RawTikTokItem[] };
    return Array.isArray(json.itemList) ? json.itemList : [];
  } catch {
    return [];
  }
}

function interleaveGroups(groups: TikTokReel[][]): TikTokReel[] {
  const seen = new Set<string>();
  const out: TikTokReel[] = [];
  const maxLen = Math.max(0, ...groups.map((g) => g.length));

  for (let i = 0; i < maxLen; i += 1) {
    for (const group of groups) {
      const item = group[i];
      if (!item || seen.has(item.id)) continue;
      seen.add(item.id);
      out.push(item);
    }
  }
  return out;
}

export async function getTikTokFeed(
  category: TikTokCategory = 'all',
  forceRefresh = false,
): Promise<TikTokFeedResponse> {
  pruneExpired();

  const customServerUrl = (process.env.TIKTOK_SERVER_URL || '').trim().replace(/\/+$/, '');
  if (customServerUrl) {
    try {
      const upstreamRes = await fetch(
        `${customServerUrl}/feed?category=${encodeURIComponent(category)}`,
      );
      if (upstreamRes.ok) {
        const payload = (await upstreamRes.json()) as { items?: TikTokReel[]; hasMore?: boolean };
        if (Array.isArray(payload.items) && payload.items.length > 0) {
          return {
            category,
            items: payload.items,
            hasMore: Boolean(payload.hasMore),
            source: 'custom-tiktok-server',
          };
        }
      }
    } catch {
      // Fallback to built-in TikTok server engine below
    }
  }

  const cacheKey = `tiktok:${category}`;
  if (!forceRefresh) {
    const cached = feedCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.data;
    }
  }

  const pending = inFlightFeeds.get(cacheKey);
  if (pending && !forceRefresh) {
    return pending;
  }

  const task = (async (): Promise<TikTokFeedResponse> => {
    let cookie = await getTikTokSessionCookie(forceRefresh);
    const categoryIds =
      category === 'all' ? [120, 104, 119] : [CATEGORY_MAP[category] ?? 120];

    // Fetch sequentially to avoid TikTok's concurrent-burst empty responses on the same ttwid cookie
    const fetchSequentially = async (activeCookie: string): Promise<RawTikTokItem[][]> => {
      const groups: RawTikTokItem[][] = [];
      for (const catId of categoryIds) {
        const items = await fetchExploreCategoryRaw(catId, activeCookie, 15);
        if (items.length > 0) {
          groups.push(items);
        }
      }
      return groups;
    };

    let rawGroups = await fetchSequentially(cookie);

    if (rawGroups.length === 0) {
      cookie = await getTikTokSessionCookie(true);
      rawGroups = await fetchSequentially(cookie);
    }

    const reelGroups: TikTokReel[][] = [];
    const expiresAt = Date.now() + 2 * 60 * 60 * 1000;

    for (const rawItems of rawGroups) {
      const parsedList = parseTikTokFeedList(rawItems, category);
      const groupReels: TikTokReel[] = [];
      for (const entry of parsedList) {
        mediaRegistry.set(entry.reel.id, {
          playUrl: entry.upstreamPlayUrl,
          downloadUrl: entry.upstreamDownloadUrl,
          coverUrl: entry.upstreamCoverUrl,
          avatarUrl: entry.upstreamAvatarUrl,
          cookie,
          expiresAt,
        });
        groupReels.push(entry.reel);
      }
      reelGroups.push(groupReels);
    }

    const items = interleaveGroups(reelGroups);
    if (items.length === 0) {
      const stale = staleFeedFallback.get(cacheKey);
      if (stale) {
        return stale;
      }
      throw new Error('TikTok server returned no playable reels right now');
    }

    const response: TikTokFeedResponse = {
      category,
      items,
      hasMore: true,
      source: 'tiktok-server',
    };

    feedCache.set(cacheKey, {
      data: response,
      expiresAt: Date.now() + 5 * 60 * 1000,
    });
    staleFeedFallback.set(cacheKey, response);

    return response;
  })();

  inFlightFeeds.set(cacheKey, task);
  try {
    return await task;
  } finally {
    if (inFlightFeeds.get(cacheKey) === task) {
      inFlightFeeds.delete(cacheKey);
    }
  }
}

export async function searchTikTokReels(query: string): Promise<TikTokFeedResponse> {
  const clean = query.trim();
  if (!clean) {
    return getTikTokFeed('all', false);
  }

  const customServerUrl = (process.env.TIKTOK_SERVER_URL || '').trim().replace(/\/+$/, '');
  if (customServerUrl) {
    try {
      const upstreamRes = await fetch(
        `${customServerUrl}/search?q=${encodeURIComponent(clean)}`,
      );
      if (upstreamRes.ok) {
        const payload = (await upstreamRes.json()) as { items?: TikTokReel[]; hasMore?: boolean };
        if (Array.isArray(payload.items) && payload.items.length > 0) {
          return {
            category: 'all',
            items: payload.items,
            hasMore: Boolean(payload.hasMore),
            source: 'custom-tiktok-server',
          };
        }
      }
    } catch {
      // Fallback to built-in TikTok search below
    }
  }

  const detectedCats = detectQueryCategories(clean);
  const categoriesToScan: TikTokCategory[] = Array.from(
    new Set<TikTokCategory>([
      ...detectedCats,
      'all',
      'comedy',
      'gaming',
      'sports',
      'music',
      'food',
    ]),
  );

  const pool: TikTokReel[] = [];
  for (const cat of categoriesToScan) {
    try {
      const feed = await getTikTokFeed(cat, false);
      pool.push(...feed.items);
      // If we already scanned detected categories + 'all' and found strong matches, return fast!
      if (detectedCats.length > 0 && cat === 'all') {
        const quickMatches = searchTikTokPool(pool, clean);
        if (quickMatches.length >= 6) {
          return {
            category: 'all',
            items: quickMatches,
            hasMore: false,
            source: 'tiktok-server',
          };
        }
      }
    } catch {
      // Continue scanning remaining categories
    }
  }

  const matched = searchTikTokPool(pool, clean);
  return {
    category: 'all',
    items: matched,
    hasMore: false,
    source: 'tiktok-server',
  };
}

export async function streamTikTokVideo(
  id: string,
  rangeHeader: string | undefined,
  asDownload: boolean,
  res: Response,
): Promise<void> {
  const entry = mediaRegistry.get(id);
  if (!entry) {
    res.status(404).json({ error: 'Reel media session expired or not found' });
    return;
  }

  const fetchUpstream = async (targetUrl: string) => {
    const headers: Record<string, string> = {
      'User-Agent': DESKTOP_UA,
      Cookie: entry.cookie,
      Referer: 'https://www.tiktok.com/',
    };
    if (rangeHeader) {
      headers.Range = rangeHeader;
    }
    return fetch(targetUrl, { headers });
  };

  let upstream = await fetchUpstream(entry.playUrl);
  if (!upstream.ok && upstream.status !== 206 && entry.downloadUrl) {
    upstream = await fetchUpstream(entry.downloadUrl);
  }

  if (!upstream.ok && upstream.status !== 206) {
    res.status(upstream.status || 502).json({ error: 'Failed to stream TikTok video' });
    return;
  }

  const contentType = upstream.headers.get('content-type') || 'video/mp4';
  const contentLength = upstream.headers.get('content-length');
  const contentRange = upstream.headers.get('content-range');
  const acceptRanges = upstream.headers.get('accept-ranges') || 'bytes';

  res.status(upstream.status);
  res.setHeader('Content-Type', contentType);
  res.setHeader('Accept-Ranges', acceptRanges);
  res.setHeader('Cache-Control', 'public, max-age=1800');
  if (contentLength) res.setHeader('Content-Length', contentLength);
  if (contentRange) res.setHeader('Content-Range', contentRange);
  if (asDownload) {
    res.setHeader('Content-Disposition', `attachment; filename="dramasquare-reel-${id}.mp4"`);
    res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition, Content-Length');
  }

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

export async function proxyTikTokImage(
  id: string,
  kind: 'cover' | 'avatar',
  res: Response,
): Promise<void> {
  const entry = mediaRegistry.get(id);
  const targetUrl = kind === 'cover' ? entry?.coverUrl : entry?.avatarUrl;
  if (!entry || !targetUrl) {
    res.status(404).end();
    return;
  }

  try {
    const upstream = await fetch(targetUrl, {
      headers: {
        'User-Agent': DESKTOP_UA,
        Referer: 'https://www.tiktok.com/',
        Cookie: entry.cookie,
      },
    });
    if (!upstream.ok || !upstream.body) {
      res.status(upstream.status || 404).end();
      return;
    }

    res.status(200);
    res.setHeader('Content-Type', upstream.headers.get('content-type') || 'image/jpeg');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    const buf = Buffer.from(await upstream.arrayBuffer());
    res.send(buf);
  } catch {
    res.status(502).end();
  }
}
