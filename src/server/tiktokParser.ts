import type { TikTokCategory, TikTokReel } from '../shared/types.ts';

export interface RawTikTokItem {
  id?: string | number;
  desc?: string;
  author?: {
    id?: string;
    uniqueId?: string;
    nickname?: string;
    verified?: boolean;
    avatarThumb?: string;
    avatarMedium?: string;
    avatarLarger?: string;
  };
  video?: {
    id?: string;
    duration?: number;
    playAddr?: string;
    downloadAddr?: string;
    cover?: string;
    originCover?: string;
    dynamicCover?: string;
    PlayAddrStruct?: {
      UrlList?: string[];
    };
    bitrateInfo?: Array<{
      PlayAddr?: {
        UrlList?: string[];
      };
    }>;
  };
  stats?: {
    diggCount?: number;
    commentCount?: number;
    shareCount?: number;
    playCount?: number;
    collectCount?: number;
  };
  music?: {
    title?: string;
    authorName?: string;
  };
}

export interface ParsedTikTokItemResult {
  reel: TikTokReel;
  upstreamPlayUrl: string;
  upstreamDownloadUrl?: string;
  upstreamCoverUrl?: string;
  upstreamAvatarUrl?: string;
}

export function formatReelDuration(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(Number.isFinite(totalSeconds) ? totalSeconds : 0));
  const mins = Math.floor(safe / 60);
  const secs = safe % 60;
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

export function formatCompactCount(count: number, locale: 'ar' | 'en' = 'ar'): string {
  const safe = Math.max(0, Math.floor(Number.isFinite(count) ? count : 0));
  if (safe >= 1_000_000) {
    const val = (safe / 1_000_000).toFixed(safe >= 10_000_000 ? 0 : 1).replace(/\.0$/, '');
    return locale === 'ar' ? `${val} مليون` : `${val}M`;
  }
  if (safe >= 1_000) {
    const val = (safe / 1_000).toFixed(safe >= 10_000 ? 0 : 1).replace(/\.0$/, '');
    return locale === 'ar' ? `${val} ألف` : `${val}K`;
  }
  return String(safe);
}

export function pickBestPlayUrl(video?: RawTikTokItem['video']): string | null {
  if (!video) return null;
  const candidates: string[] = [];
  if (typeof video.playAddr === 'string' && video.playAddr.startsWith('http')) {
    candidates.push(video.playAddr);
  }
  if (Array.isArray(video.PlayAddrStruct?.UrlList)) {
    for (const u of video.PlayAddrStruct.UrlList) {
      if (typeof u === 'string' && u.startsWith('http')) candidates.push(u);
    }
  }
  if (Array.isArray(video.bitrateInfo)) {
    for (const b of video.bitrateInfo) {
      for (const u of b?.PlayAddr?.UrlList || []) {
        if (typeof u === 'string' && u.startsWith('http')) candidates.push(u);
      }
    }
  }
  if (typeof video.downloadAddr === 'string' && video.downloadAddr.startsWith('http')) {
    candidates.push(video.downloadAddr);
  }
  return candidates[0] || null;
}

export function parseTikTokItem(
  item: RawTikTokItem,
  category: TikTokCategory = 'all',
): ParsedTikTokItemResult | null {
  const id = String(item?.id || item?.video?.id || '').trim();
  if (!id || !/^[a-zA-Z0-9_-]+$/.test(id)) return null;

  const upstreamPlayUrl = pickBestPlayUrl(item.video);
  if (!upstreamPlayUrl) return null;

  const upstreamCoverUrl =
    item.video?.cover || item.video?.originCover || item.video?.dynamicCover || undefined;
  const upstreamAvatarUrl =
    item.author?.avatarThumb || item.author?.avatarMedium || item.author?.avatarLarger || undefined;

  const durationSeconds = Math.max(0, Math.round(Number(item.video?.duration || 0)));
  const handle = String(item.author?.uniqueId || item.author?.id || 'tiktok_creator').trim();
  const authorName = String(item.author?.nickname || handle).trim();
  const caption = String(item.desc || '').trim() || authorName;

  const reel: TikTokReel = {
    id,
    caption,
    authorName,
    authorHandle: handle.startsWith('@') ? handle : `@${handle}`,
    authorAvatar: upstreamAvatarUrl ? `/api/tiktok/avatar/${encodeURIComponent(id)}` : undefined,
    authorVerified: Boolean(item.author?.verified),
    coverUrl: upstreamCoverUrl ? `/api/tiktok/cover/${encodeURIComponent(id)}` : '',
    streamUrl: `/api/tiktok/stream/${encodeURIComponent(id)}`,
    durationSeconds,
    duration: formatReelDuration(durationSeconds),
    likesCount: Math.max(0, Number(item.stats?.diggCount || 0)),
    commentsCount: Math.max(0, Number(item.stats?.commentCount || 0)),
    sharesCount: Math.max(0, Number(item.stats?.shareCount || 0)),
    viewsCount: Math.max(0, Number(item.stats?.playCount || 0)),
    musicTitle: item.music?.title?.trim() || undefined,
    musicAuthor: item.music?.authorName?.trim() || undefined,
    category,
  };

  return {
    reel,
    upstreamPlayUrl,
    upstreamDownloadUrl:
      typeof item.video?.downloadAddr === 'string' && item.video.downloadAddr.startsWith('http')
        ? item.video.downloadAddr
        : undefined,
    upstreamCoverUrl,
    upstreamAvatarUrl,
  };
}

export function parseTikTokFeedList(
  items: RawTikTokItem[],
  category: TikTokCategory = 'all',
): ParsedTikTokItemResult[] {
  const seen = new Set<string>();
  const results: ParsedTikTokItemResult[] = [];
  for (const item of items) {
    const parsed = parseTikTokItem(item, category);
    if (!parsed) continue;
    if (seen.has(parsed.reel.id)) continue;
    seen.add(parsed.reel.id);
    results.push(parsed);
  }
  return results;
}

const TOPIC_SYNONYMS: Array<{ category: TikTokCategory; keywords: string[] }> = [
  {
    category: 'gaming',
    keywords: ['game', 'gaming', 'pubg', 'fifa', 'fc25', 'minecraft', 'gta', 'العاب', 'ألعاب', 'لعب', 'ببجي', 'قيمز', 'قيمنق'],
  },
  {
    category: 'sports',
    keywords: ['sport', 'sports', 'football', 'soccer', 'goal', 'messi', 'ronaldo', 'gym', 'كرة', 'رياضة', 'مباراة', 'اهداف', 'أهداف', 'قدم'],
  },
  {
    category: 'music',
    keywords: ['music', 'song', 'dance', 'remix', 'dj', 'audio', 'موسيقى', 'اغاني', 'أغاني', 'اغنية', 'أغنية', 'غناء', 'طرب'],
  },
  {
    category: 'comedy',
    keywords: ['comedy', 'funny', 'meme', 'prank', 'lol', 'ترفيه', 'كوميديا', 'ضحك', 'مقالب', 'تحشيش', 'نكت'],
  },
  {
    category: 'food',
    keywords: ['food', 'cook', 'cooking', 'recipe', 'chef', 'طعام', 'اكل', 'أكل', 'طبخ', 'وصفات', 'مطعم'],
  },
];

function normalizeReelText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[\u064B-\u065F\u0670\u0640]/g, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .trim();
}

export function detectQueryCategories(query: string): TikTokCategory[] {
  const q = normalizeReelText(query);
  if (!q) return [];
  const matched: TikTokCategory[] = [];
  for (const topic of TOPIC_SYNONYMS) {
    if (
      topic.keywords.some((kw) => {
        const nkw = normalizeReelText(kw);
        return q.includes(nkw) || nkw.includes(q);
      })
    ) {
      matched.push(topic.category);
    }
  }
  return matched;
}

export function searchTikTokPool(pool: TikTokReel[], query: string): TikTokReel[] {
  const clean = normalizeReelText(query);
  if (!clean) return pool;

  const tokens = clean.split(/\s+/).filter(Boolean);
  const topicCategories = new Set(detectQueryCategories(clean));

  const scored: Array<{ reel: TikTokReel; score: number }> = [];
  for (const reel of pool) {
    const haystack = normalizeReelText(
      [
        reel.caption,
        reel.authorName,
        reel.authorHandle,
        reel.musicTitle || '',
        reel.musicAuthor || '',
      ].join(' '),
    );

    let score = 0;
    if (haystack.includes(clean)) score += 100;
    for (const token of tokens) {
      if (haystack.includes(token)) {
        score += 25;
      } else if (token.length >= 4 && haystack.includes(token.slice(0, 3))) {
        score += 10;
      }
    }
    if (topicCategories.has(reel.category)) {
      score += 15;
    }

    if (score > 0) {
      scored.push({ reel, score });
    }
  }

  scored.sort((a, b) => b.score - a.score || b.reel.viewsCount - a.reel.viewsCount);

  const seen = new Set<string>();
  const results: TikTokReel[] = [];
  for (const entry of scored) {
    if (seen.has(entry.reel.id)) continue;
    seen.add(entry.reel.id);
    results.push(entry.reel);
  }

  // Global search guarantee: if few direct matches exist in pool, supplement with top trending global reels
  if (results.length < 8 && pool.length > 0) {
    const fallbackSorted = [...pool].sort((a, b) => b.viewsCount - a.viewsCount);
    for (const reel of fallbackSorted) {
      if (results.length >= 18) break;
      if (seen.has(reel.id)) continue;
      seen.add(reel.id);
      results.push(reel);
    }
  }

  return results;
}

