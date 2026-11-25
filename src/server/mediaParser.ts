import type { AppLocale, MediaChannelSummary, MediaVideo } from '../shared/types.ts';

export interface RawDailymotionVideo {
  id?: string;
  title?: string;
  description?: string;
  duration?: number;
  views_total?: number;
  likes_total?: number;
  created_time?: number;
  mode?: string;
  onair?: boolean;
  thumbnail_720_url?: string;
  thumbnail_480_url?: string;
  thumbnail_360_url?: string;
  'owner.id'?: string;
  'owner.screenname'?: string;
  'owner.username'?: string;
  'owner.avatar_120_url'?: string;
  'owner.followers_total'?: number;
  'owner.verified'?: boolean;
}

export interface RawDailymotionUser {
  id?: string;
  screenname?: string;
  username?: string;
  avatar_120_url?: string;
  avatar_360_url?: string;
  cover_250_url?: string;
  description?: string;
  followers_total?: number;
  videos_total?: number;
  verified?: boolean;
}

export function extractDirectVideoUrlId(input: string): string | null {
  const clean = input.trim();
  if (!clean) return null;
  const ytMatch = clean.match(
    /(?:youtube\.com\/watch\?(?:[^#]*&)?v=|youtu\.be\/|youtube\.com\/shorts\/|youtube\.com\/live\/)([a-zA-Z0-9_-]{11})(?:[?&#/]|$)/i,
  );
  if (ytMatch?.[1]) return ytMatch[1];
  const dmMatch = clean.match(/dailymotion\.com\/(?:video|embed\/video)\/([a-z0-9]+)/i);
  if (dmMatch?.[1]) return dmMatch[1];
  const daiMatch = clean.match(/dai\.ly\/([a-z0-9]+)/i);
  if (daiMatch?.[1]) return daiMatch[1];
  return null;
}

export function extractMediaId(input: string): string | null {
  const clean = input.trim();
  if (!clean) return null;
  if (/^live_[a-z0-9_]{2,40}$/i.test(clean)) return clean;
  if (/^[a-zA-Z0-9_-]{11}$/.test(clean)) return clean;
  if (/^x[a-z0-9]{4,12}$/i.test(clean)) return clean;
  return extractDirectVideoUrlId(clean);
}

export function formatVideoDuration(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(Number.isFinite(totalSeconds) ? totalSeconds : 0));
  const h = Math.floor(safe / 3600);
  const m = Math.floor((safe % 3600) / 60);
  const s = safe % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

export function formatViewsText(count: number | null | undefined, locale: AppLocale): string {
  if (typeof count !== 'number' || !Number.isFinite(count) || count < 0) return '';
  if (count >= 1_000_000) {
    const val = (count / 1_000_000).toFixed(1).replace(/\.0$/, '');
    return locale === 'ar' ? `${val} مليون مشاهدة` : `${val}M views`;
  }
  if (count >= 1_000) {
    const val = (count / 1_000).toFixed(count >= 10_000 ? 0 : 1).replace(/\.0$/, '');
    return locale === 'ar' ? `${val} ألف مشاهدة` : `${val}K views`;
  }
  return locale === 'ar' ? `${count} مشاهدة` : `${count} views`;
}

export function formatSubscribersText(count: number | null | undefined, locale: AppLocale): string {
  if (typeof count !== 'number' || !Number.isFinite(count) || count <= 0) return '';
  if (count >= 1_000_000) {
    const val = (count / 1_000_000).toFixed(1).replace(/\.0$/, '');
    return locale === 'ar' ? `${val} مليون مشترك` : `${val}M subscribers`;
  }
  if (count >= 1_000) {
    const val = (count / 1_000).toFixed(count >= 10_000 ? 0 : 1).replace(/\.0$/, '');
    return locale === 'ar' ? `${val} ألف مشترك` : `${val}K subscribers`;
  }
  return locale === 'ar' ? `${count} مشترك` : `${count} subscribers`;
}

export function formatPublishedDate(unixSeconds: number | undefined, locale: AppLocale): string {
  if (!unixSeconds || !Number.isFinite(unixSeconds)) return '';
  const diffSec = Math.max(0, Math.floor(Date.now() / 1000 - unixSeconds));
  const days = Math.floor(diffSec / 86400);
  if (days < 1) return locale === 'ar' ? 'اليوم' : 'Today';
  if (days < 30) return locale === 'ar' ? `منذ ${days} يوم` : `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return locale === 'ar' ? `منذ ${months} شهر` : `${months}mo ago`;
  const years = Math.floor(months / 12);
  return locale === 'ar' ? `منذ ${years} سنة` : `${years}y ago`;
}

export function stripHtmlTags(raw: string | undefined): string {
  if (!raw) return '';
  return raw
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function parseMediaVideo(raw: RawDailymotionVideo, locale: AppLocale = 'ar'): MediaVideo | null {
  const id = String(raw.id || '').trim();
  if (!id) return null;

  const durationSeconds = Math.max(0, Math.floor(Number(raw.duration || 0)));
  const isLive = Boolean(raw.onair || raw.mode === 'live');
  const viewsCount = typeof raw.views_total === 'number' ? raw.views_total : null;
  const thumbnail =
    raw.thumbnail_720_url || raw.thumbnail_480_url || raw.thumbnail_360_url || '';

  return {
    id,
    title: String(raw.title || '').trim() || id,
    channelName: String(raw['owner.screenname'] || raw['owner.username'] || 'مربع الدراما').trim(),
    channelId: String(raw['owner.id'] || '').trim(),
    channelAvatar: raw['owner.avatar_120_url'] || undefined,
    channelVerified: Boolean(raw['owner.verified']),
    thumbnail,
    duration: isLive ? (locale === 'ar' ? 'مباشر' : 'LIVE') : formatVideoDuration(durationSeconds),
    durationSeconds,
    isLive,
    isShort: durationSeconds > 0 && durationSeconds <= 60,
    viewsText: formatViewsText(viewsCount, locale),
    viewsCount,
    publishedText: formatPublishedDate(raw.created_time, locale),
    descriptionSnippet: stripHtmlTags(raw.description).slice(0, 160) || undefined,
    streamUrl: `/api/videos/item/${encodeURIComponent(id)}/stream.m3u8`,
    sourceType: 'video',
  };
}

export function parseMediaChannel(
  raw: RawDailymotionUser,
  locale: AppLocale = 'ar',
): MediaChannelSummary | null {
  const id = String(raw.id || '').trim();
  if (!id) return null;
  const name = String(raw.screenname || raw.username || id).trim();
  return {
    id,
    name,
    handle: raw.username ? `@${raw.username}` : undefined,
    avatar: raw.avatar_360_url || raw.avatar_120_url || undefined,
    subscribersText: formatSubscribersText(raw.followers_total, locale) || undefined,
    verified: Boolean(raw.verified),
    description: stripHtmlTags(raw.description) || undefined,
    videoCountText:
      typeof raw.videos_total === 'number'
        ? locale === 'ar'
          ? `${raw.videos_total} فيديو`
          : `${raw.videos_total} videos`
        : undefined,
  };
}

export function isAllowedStreamHost(targetUrl: string): boolean {
  try {
    const parsed = new URL(targetUrl);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return false;
    const host = parsed.hostname.toLowerCase();
    return (
      host === 'googlevideo.com' ||
      host.endsWith('.googlevideo.com') ||
      host === 'dmcdn.net' ||
      host.endsWith('.dmcdn.net') ||
      host === 'dailymotion.com' ||
      host.endsWith('.dailymotion.com') ||
      host === 'dm-event.net' ||
      host.endsWith('.dm-event.net')
    );
  } catch {
    return false;
  }
}

export function rewriteM3u8Manifest(
  manifestText: string,
  baseUrl: string,
  proxyEndpoint = '/api/videos/hls',
): string {
  const toProxied = (rawRef: string): string => {
    const abs = new URL(rawRef.trim(), baseUrl).toString();
    return `${proxyEndpoint}?u=${encodeURIComponent(abs)}`;
  };

  return manifestText
    .split(/\r?\n/)
    .map((line) => {
      const trimmed = line.trim();
      if (!trimmed) return line;

      if (trimmed.startsWith('#')) {
        // Rewrite URI="..." attributes inside tags like #EXT-X-KEY or #EXT-X-MEDIA or #EXT-X-MAP
        return line.replace(/URI="([^"]+)"/g, (_match, uri: string) => {
          return `URI="${toProxied(uri)}"`;
        });
      }

      return toProxied(trimmed);
    })
    .join('\n');
}

export function normalizeGlobalQuery(raw: string): string {
  return raw
    .replace(/[\u064B-\u065F\u0670\u0640]/g, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function buildFallbackSearchQueries(
  rawQuery: string,
  hl: AppLocale = 'ar',
): string[] {
  const original = rawQuery.trim();
  const normalized = normalizeGlobalQuery(original);
  const candidates: string[] = [];
  const seen = new Set<string>([original.toLowerCase()]);

  const pushUnique = (q: string) => {
    const clean = q.trim();
    const key = clean.toLowerCase();
    if (clean && !seen.has(key)) {
      seen.add(key);
      candidates.push(clean);
    }
  };

  if (normalized) {
    pushUnique(normalized);
  }

  const tokens = (normalized || original)
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2)
    .sort((a, b) => b.length - a.length);

  for (const token of tokens.slice(0, 3)) {
    pushUnique(token);
  }

  // Prefix fallback for partial words or rare spellings
  if (tokens[0] && tokens[0].length >= 4) {
    pushUnique(tokens[0].slice(0, 3));
  }

  // Final global safety net so search never returns an empty dead-end
  pushUnique(hl === 'en' ? 'trending world drama music' : 'دراما أفلام موسيقى');

  return candidates;
}

export function pickDownloadVariantUrl(
  masterManifest: string,
  baseUrl: string,
  preferredMaxHeight = 480,
): string | null {
  const lines = masterManifest.split(/\r?\n/);
  const variants: Array<{ url: string; height: number; bandwidth: number }> = [];

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i].trim();
    if (!line.startsWith('#EXT-X-STREAM-INF')) continue;

    let urlLine = '';
    for (let j = i + 1; j < lines.length; j += 1) {
      const candidate = lines[j].trim();
      if (!candidate) continue;
      if (candidate.startsWith('#')) continue;
      urlLine = candidate;
      i = j;
      break;
    }

    if (!urlLine) continue;
    let resolvedUrl = urlLine;
    try {
      resolvedUrl = new URL(urlLine, baseUrl).toString();
    } catch {
      continue;
    }

    const resMatch = line.match(/RESOLUTION=\d+x(\d+)/i);
    const bwMatch = line.match(/BANDWIDTH=(\d+)/i);
    const height = resMatch ? Number.parseInt(resMatch[1], 10) : 0;
    const bandwidth = bwMatch ? Number.parseInt(bwMatch[1], 10) : 0;

    variants.push({ url: resolvedUrl, height, bandwidth });
  }

  if (variants.length === 0) return null;

  const withinCap = variants
    .filter((v) => v.height > 0 && v.height <= preferredMaxHeight)
    .sort((a, b) => b.height - a.height || b.bandwidth - a.bandwidth);

  if (withinCap.length > 0) {
    return withinCap[0].url;
  }

  // Fallback to smallest available resolution/bandwidth
  const sortedAsc = [...variants].sort(
    (a, b) => (a.height || 99999) - (b.height || 99999) || a.bandwidth - b.bandwidth,
  );
  return sortedAsc[0].url;
}

export function sanitizeDownloadFilename(title: string, fallbackId: string): string {
  const clean = title
    .replace(/[\\/:*?"<>|\r\n]+/g, ' ')
    .replace(/\.mp4$/i, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60);
  const base = clean || `dramasquare-${fallbackId}`;
  return `${base}.mp4`;
}

export function prioritizeFreshRawVideos(
  batches: RawDailymotionVideo[][],
  options?: {
    maxAgeDays?: number;
    strictFresh?: boolean;
    nowSeconds?: number;
    limit?: number;
  },
): RawDailymotionVideo[] {
  const maxAgeDays = options?.maxAgeDays ?? 365;
  const strictFresh = options?.strictFresh ?? false;
  const nowSeconds = options?.nowSeconds ?? Math.floor(Date.now() / 1000);
  const limit = options?.limit ?? 60;
  const cutoff = nowSeconds - maxAgeDays * 86400;

  const interleave = (groups: RawDailymotionVideo[][]): RawDailymotionVideo[] => {
    const out: RawDailymotionVideo[] = [];
    const seen = new Set<string>();
    const maxLen = Math.max(0, ...groups.map((b) => b.length));

    for (let i = 0; i < maxLen; i += 1) {
      for (const batch of groups) {
        const item = batch[i];
        const id = String(item?.id || '').trim();
        if (!id || seen.has(id)) continue;
        seen.add(id);
        out.push(item);
      }
    }
    return out;
  };

  const freshBatches = batches.map((batch) =>
    batch.filter((item) => Number(item.created_time || 0) >= cutoff),
  );
  const olderBatches = batches.map((batch) =>
    batch.filter((item) => Number(item.created_time || 0) < cutoff),
  );

  const fresh = interleave(freshBatches);
  if (strictFresh && fresh.length >= 6) {
    return fresh.slice(0, limit);
  }

  const older = interleave(olderBatches);
  const seenFreshIds = new Set(fresh.map((item) => String(item.id || '').trim()));
  const uniqueOlder = older.filter((item) => !seenFreshIds.has(String(item.id || '').trim()));

  return [...fresh, ...uniqueOlder].slice(0, limit);
}

export function rotateFreshBatches<T>(batches: T[][], seed: number): T[][] {
  if (batches.length === 0) return [];
  const safeSeed = Math.abs(Math.floor(seed));
  const batchShift = safeSeed % batches.length;
  const reordered = [
    ...batches.slice(batchShift),
    ...batches.slice(0, batchShift),
  ];

  return reordered.map((batch, idx) => {
    if (batch.length <= 2) return batch;
    const itemShift = (safeSeed + idx) % batch.length;
    return [...batch.slice(itemShift), ...batch.slice(0, itemShift)];
  });
}

export function rankSearchChannels(
  query: string,
  primaryChannels: MediaChannelSummary[],
  secondaryChannels: MediaChannelSummary[],
  limit = 12,
): MediaChannelSummary[] {
  const normQuery = normalizeGlobalQuery(query).toLowerCase();
  const queryTokens = normQuery
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2);

  const combined: Array<{ ch: MediaChannelSummary; isPrimary: boolean; idx: number }> = [
    ...primaryChannels.map((ch, idx) => ({ ch, isPrimary: true, idx })),
    ...secondaryChannels.map((ch, idx) => ({ ch, isPrimary: false, idx })),
  ];

  const deduped = new Map<string, { ch: MediaChannelSummary; score: number; order: number }>();

  for (let i = 0; i < combined.length; i += 1) {
    const { ch, isPrimary, idx } = combined[i];
    const cleanId = String(ch.id || '').trim();
    const cleanName = String(ch.name || '').trim();
    if (!cleanId || !cleanName) continue;

    const normName = normalizeGlobalQuery(cleanName).toLowerCase();
    const normHandle = normalizeGlobalQuery(ch.handle || '').toLowerCase();
    const haystack = `${normName} ${normHandle}`.trim();
    const subs = String(ch.subscribersText || '');

    let score = isPrimary ? 25 + Math.max(0, 24 - idx * 4) : 0;
    if (normQuery) {
      if (normName === normQuery || normHandle === normQuery) {
        score += 55;
      } else if (normName.startsWith(normQuery)) {
        score += 38;
      } else if (haystack.includes(normQuery)) {
        score += 26;
      } else if (queryTokens.length > 0) {
        const matchedTokens = queryTokens.filter((t) => haystack.includes(t)).length;
        score += (matchedTokens / queryTokens.length) * 20;
      }
    }

    if (ch.verified) score += 40;
    if (/مليون|\d+(?:\.\d+)?M\b/i.test(subs)) {
      score += 30;
    } else if (/ألف|الف|\d+(?:\.\d+)?K\b/i.test(subs)) {
      score += 12;
    } else if (subs) {
      score += 3;
    }
    if (ch.avatar) score += 4;

    const dedupeKey = cleanId.toLowerCase();
    const existing = deduped.get(dedupeKey);
    if (!existing || score > existing.score) {
      deduped.set(dedupeKey, { ch, score, order: i });
    }
  }

  return Array.from(deduped.values())
    .sort((a, b) => b.score - a.score || a.order - b.order)
    .slice(0, limit)
    .map((entry) => entry.ch);
}
