import type { AppLocale, MediaChannelSummary, MediaComment, MediaVideo } from '../shared/types.ts';
import { formatVideoDuration } from './mediaParser.ts';

export function normalizeUrlProtocol(url: string | undefined): string {
  const clean = String(url || '').trim();
  if (!clean) return '';
  if (clean.startsWith('//')) return `https:${clean}`;
  return clean;
}

export function extractDirectYouTubeUrlId(input: string): string | null {
  const clean = input.trim();
  if (!clean) return null;

  const patterns = [
    /(?:youtube\.com\/watch\?(?:[^#]*&)?v=|youtu\.be\/|youtube\.com\/shorts\/|youtube\.com\/live\/)([a-zA-Z0-9_-]{11})(?:[?&#/]|$)/i,
  ];
  for (const re of patterns) {
    const m = clean.match(re);
    if (m?.[1]) return m[1];
  }
  return null;
}

export function extractYouTubeVideoId(input: string): string | null {
  const clean = input.trim();
  if (!clean) return null;
  if (/^[a-zA-Z0-9_-]{11}$/.test(clean)) return clean;
  return extractDirectYouTubeUrlId(clean);
}

export function isYouTubeVideoId(id: string): boolean {
  return /^[a-zA-Z0-9_-]{11}$/.test(id.trim());
}

export function parseYouTubeDuration(
  durationText?: string,
  seconds?: number,
): { duration: string; durationSeconds: number; isLive: boolean } {
  const cleanText = String(durationText || '').trim();
  if (/^(live|مباشر|بث مباشر)$/i.test(cleanText)) {
    return { duration: cleanText, durationSeconds: 0, isLive: true };
  }

  if (typeof seconds === 'number' && Number.isFinite(seconds) && seconds > 0) {
    const safeSec = Math.floor(seconds);
    return {
      duration: cleanText || formatVideoDuration(safeSec),
      durationSeconds: safeSec,
      isLive: false,
    };
  }

  if (/^\d{1,2}(:\d{2}){1,2}$/.test(cleanText)) {
    const parts = cleanText.split(':').map((p) => Number.parseInt(p, 10) || 0);
    const totalSec =
      parts.length === 3
        ? parts[0] * 3600 + parts[1] * 60 + parts[2]
        : parts[0] * 60 + parts[1];
    return {
      duration: cleanText,
      durationSeconds: totalSec,
      isLive: false,
    };
  }

  return { duration: '0:00', durationSeconds: 0, isLive: false };
}

export function parseCompactViewsCount(raw: string | undefined): number | null {
  const clean = String(raw || '').trim();
  if (!clean) return null;

  const numMatch = clean.replace(/,/g, '').match(/(\d+(?:\.\d+)?)/);
  if (!numMatch) return null;
  const base = Number.parseFloat(numMatch[1]);
  if (!Number.isFinite(base)) return null;

  if (/مليون|\dM\b|M\b/i.test(clean)) return Math.round(base * 1_000_000);
  if (/ألف|الف|\dK\b|K\b/i.test(clean)) return Math.round(base * 1_000);
  if (/مليار|\dB\b|B\b/i.test(clean)) return Math.round(base * 1_000_000_000);
  return Math.round(base);
}

export function pickBestThumbnail(
  thumbs?: Array<{ url?: string; width?: number; height?: number }>,
  fallbackId?: string,
): string {
  if (Array.isArray(thumbs) && thumbs.length > 0) {
    const sorted = [...thumbs]
      .filter((t) => Boolean(t?.url))
      .sort((a, b) => (b.width || 0) - (a.width || 0));
    if (sorted[0]?.url) {
      return normalizeUrlProtocol(sorted[0].url);
    }
  }
  if (fallbackId && isYouTubeVideoId(fallbackId)) {
    return `https://i.ytimg.com/vi/${fallbackId}/hqdefault.jpg`;
  }
  return '';
}

function readNodeText(val: unknown): string {
  if (!val) return '';
  if (typeof val === 'string') return val.trim();
  if (typeof val === 'object') {
    const obj = val as { text?: unknown; content?: unknown; toString?: () => string };
    if (typeof obj.text === 'string') return obj.text.trim();
    if (typeof obj.content === 'string') return obj.content.trim();
    if (typeof obj.toString === 'function') {
      const str = obj.toString();
      if (str && str !== '[object Object]') return str.trim();
    }
  }
  return '';
}

function isRelativeOrRecentText(text: string): boolean {
  return /(قبل|منذ|خلال|ago|today|hour|minute|day|week|month|year|ساعة|ساعات|دقيقة|دقائق|يوم|أيام|أسبوع|أسابيع|شهر|أشهر|سنة|سنوات|اليوم)/i.test(
    text,
  );
}

function isViewsLikeText(text: string): boolean {
  return /(مشاهدة|مشاهدات|view|views|\d)/i.test(text) && !isRelativeOrRecentText(text);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function parseYouTubeVideoNode(node: any, locale: AppLocale = 'ar'): MediaVideo | null {
  if (!node || typeof node !== 'object') return null;

  // 1. Handle YouTube 2025/2026 LockupView (used in Channel Videos tab & watch_next_feed)
  if (node.type === 'LockupView' || (node.content_id && node.metadata)) {
    const id = String(node.content_id || '').trim();
    if (!isYouTubeVideoId(id)) return null;
    // Skip playlists/mixes
    if (node.content_type && String(node.content_type).toUpperCase().includes('PLAYLIST')) {
      return null;
    }

    const title = readNodeText(node.metadata?.title) || id;
    const rows: string[][] = Array.isArray(node.metadata?.metadata?.metadata_rows)
      ? node.metadata.metadata.metadata_rows.map(
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (r: any) =>
            Array.isArray(r?.metadata_parts)
              ? r.metadata_parts.map((p: unknown) => readNodeText((p as { text?: unknown })?.text ?? p)).filter(Boolean)
              : [],
        )
      : [];

    const flatParts = rows.flat();
    let channelName = '';
    let viewsText = '';
    let publishedText = '';

    for (const part of flatParts) {
      if (!publishedText && isRelativeOrRecentText(part)) {
        publishedText = part;
      } else if (!viewsText && isViewsLikeText(part)) {
        viewsText = /مشاهدة|view/i.test(part)
          ? part
          : locale === 'ar'
            ? `${part} مشاهدة`
            : `${part} views`;
      } else if (!channelName && !/^\d/.test(part)) {
        channelName = part;
      }
    }

    let overlayDuration = '';
    let isLive = false;
    const overlays = Array.isArray(node.content_image?.overlays) ? node.content_image.overlays : [];
    for (const ov of overlays) {
      if (Array.isArray(ov?.badges)) {
        for (const badge of ov.badges) {
          const bText = readNodeText(badge?.text ?? badge);
          if (bText) {
            if (/live|مباشر/i.test(bText)) isLive = true;
            overlayDuration = bText;
            break;
          }
        }
      }
      if (!overlayDuration && ov?.text) {
        overlayDuration = readNodeText(ov.text);
      }
    }

    const dur = parseYouTubeDuration(isLive ? (locale === 'ar' ? 'مباشر' : 'LIVE') : overlayDuration);
    const thumbnail = pickBestThumbnail(node.content_image?.image, id);
    const viewsCount = parseCompactViewsCount(viewsText);
    const lockupChannelAvatar = pickBestThumbnail(node.metadata?.image?.avatar?.image);
    const lockupBrowseId = String(
      node.metadata?.image?.renderer_context?.command?.payload?.browseId ||
        node.metadata?.image?.renderer_context?.endpoint?.payload?.browseId ||
        '',
    ).trim();
    const channelId =
      lockupBrowseId.startsWith('UC') || lockupBrowseId.startsWith('@') ? lockupBrowseId : '';

    return {
      id,
      title,
      channelName: channelName || (locale === 'ar' ? 'مربع الدراما' : 'Drama Square'),
      channelId,
      channelAvatar: lockupChannelAvatar || undefined,
      thumbnail,
      duration: dur.isLive ? (locale === 'ar' ? 'مباشر' : 'LIVE') : dur.duration,
      durationSeconds: dur.durationSeconds,
      isLive: dur.isLive,
      isShort: dur.durationSeconds > 0 && dur.durationSeconds <= 60,
      viewsText,
      viewsCount,
      publishedText,
      streamUrl: `/api/videos/item/${encodeURIComponent(id)}/stream.m3u8`,
      sourceType: 'video',
    };
  }

  // 2. Classic Video / CompactVideo / GridVideo / PlaylistVideo nodes
  const id = String(node.id || node.video_id || '').trim();
  if (!isYouTubeVideoId(id)) return null;

  const title = readNodeText(node.title) || id;
  const authorName =
    readNodeText(node.author?.name) ||
    readNodeText(node.channel?.name) ||
    (locale === 'ar' ? 'مربع الدراما' : 'Drama Square');
  const authorId = String(node.author?.id || node.channel?.id || '').trim();
  const channelAvatar = pickBestThumbnail(node.author?.thumbnails);
  const channelVerified = Boolean(node.author?.is_verified || node.author?.is_verified_artist);

  const rawDurText = readNodeText(node.duration?.text) || readNodeText(node.length_text);
  const rawDurSec = typeof node.duration?.seconds === 'number' ? node.duration.seconds : undefined;
  const isLiveNode = Boolean(
    node.is_live || node.badges?.some?.((b: { label?: string; text?: string }) => /live|مباشر/i.test(`${b?.label || ''} ${b?.text || ''}`)),
  );
  const dur = parseYouTubeDuration(isLiveNode ? (locale === 'ar' ? 'مباشر' : 'LIVE') : rawDurText, rawDurSec);

  const viewsText =
    readNodeText(node.short_view_count) ||
    readNodeText(node.view_count) ||
    '';
  const viewsCount = parseCompactViewsCount(readNodeText(node.view_count) || viewsText);
  const publishedText = readNodeText(node.published);
  const descriptionSnippet = readNodeText(node.description_snippet || node.description).slice(0, 160) || undefined;
  const thumbnail =
    normalizeUrlProtocol(node.best_thumbnail?.url) ||
    pickBestThumbnail(node.thumbnails, id);

  return {
    id,
    title,
    channelName: authorName,
    channelId: authorId,
    channelAvatar: channelAvatar || undefined,
    channelVerified,
    thumbnail,
    duration: dur.isLive ? (locale === 'ar' ? 'مباشر' : 'LIVE') : dur.duration,
    durationSeconds: dur.durationSeconds,
    isLive: dur.isLive,
    isShort: dur.durationSeconds > 0 && dur.durationSeconds <= 60,
    viewsText,
    viewsCount,
    publishedText,
    descriptionSnippet,
    streamUrl: `/api/videos/item/${encodeURIComponent(id)}/stream.m3u8`,
    sourceType: 'video',
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function parseYouTubeChannelSummary(node: any): MediaChannelSummary | null {
  if (!node || typeof node !== 'object') return null;
  const id = String(node.id || node.author?.id || '').trim();
  if (!id) return null;

  const name = readNodeText(node.author?.name) || readNodeText(node.title) || id;
  const subText = readNodeText(node.subscriber_count);
  const vidText = readNodeText(node.video_count);
  const avatar = pickBestThumbnail(node.author?.thumbnails || node.thumbnails);
  const verified = Boolean(node.author?.is_verified || node.author?.is_verified_artist);
  const description = readNodeText(node.description_snippet) || undefined;

  // Note: in recent YouTube search responses, subscriber_count holds "@Handle" and video_count holds subscriber count
  const handle = subText.startsWith('@') ? subText : undefined;
  const subscribersText = subText.startsWith('@') ? vidText : subText || vidText;

  return {
    id,
    name,
    handle,
    avatar: avatar || undefined,
    subscribersText: subscribersText || undefined,
    verified,
    description,
    videoCountText: subText.startsWith('@') ? undefined : vidText || undefined,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function parseYouTubeCommentNode(thread: any, idx: number): MediaComment | null {
  const c = thread?.comment || thread;
  if (!c) return null;
  const text = readNodeText(c.content);
  if (!text) return null;
  const authorName = readNodeText(c.author?.name) || 'Viewer';
  const authorAvatar = pickBestThumbnail(c.author?.thumbnails);
  const likesText = readNodeText(c.vote_count) || undefined;
  const publishedText = readNodeText(c.published_time) || undefined;
  const replyCountText = c.reply_count ? String(c.reply_count) : undefined;

  return {
    id: String(c.comment_id || `yt_c_${idx}`),
    authorName,
    authorAvatar: authorAvatar || undefined,
    text,
    likesText: likesText || '0',
    publishedText: publishedText || '',
    isCreator: Boolean(c.author_is_channel_owner),
    replyCountText,
  };
}

function normalizeArabicDigits(raw: string): string {
  return raw.replace(/[\u0660-\u0669]/g, (d) => String(d.charCodeAt(0) - 0x0660));
}

function tokenizeTitle(raw: string): string[] {
  return normalizeArabicDigits(raw)
    .toLowerCase()
    .replace(/[\u064B-\u065F\u0670\u0640]/g, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .map((w) => w.trim())
    .filter((w) => w.length >= 1 && !/^(official|video|music|audio|hd|4k|lyrics|فيديو|رسمي|موسيقى|كليب)$/.test(w));
}

function extractNumericIdentifiers(tokens: string[]): string[] {
  const nums: string[] = [];
  for (const t of tokens) {
    if (/^\d+$/.test(t)) {
      nums.push(String(Number.parseInt(t, 10)));
    } else {
      const m = t.match(/^(?:ep|episode|part|pt|ح|حلقه|ج|جزء)(\d{1,4})$/i);
      if (m?.[1]) nums.push(String(Number.parseInt(m[1], 10)));
    }
  }
  return Array.from(new Set(nums));
}

export function scoreStreamCandidateMatch(
  ytTitle: string,
  ytDurationSec: number,
  candidateTitle: string,
  candidateDurationSec: number,
): number {
  const ytTokens = tokenizeTitle(ytTitle).filter((t) => t.length >= 2 || /^\d+$/.test(t));
  const candTokens = tokenizeTitle(candidateTitle).filter((t) => t.length >= 2 || /^\d+$/.test(t));
  const ytSet = new Set(ytTokens);
  const candSet = new Set(candTokens);
  if (ytSet.size === 0 || candSet.size === 0) return 0;

  // Reject conflicting 4-digit release years (e.g., 2026 vs 2021)
  const ytYears = [...ytSet].filter((t) => /^(19|20)\d{2}$/.test(t));
  const candYears = [...candSet].filter((t) => /^(19|20)\d{2}$/.test(t));
  if (ytYears.length > 0 && candYears.length > 0) {
    const sharesYear = ytYears.some((y) => candSet.has(y));
    if (!sharesYear) return 0;
  }

  // Reject conflicting episode/part/ordinal numbers (e.g. الحلقة 5 vs الحلقة 8)
  const ytNums = extractNumericIdentifiers(ytTokens).filter((n) => !/^(19|20)\d{2}$/.test(n));
  const candNums = extractNumericIdentifiers(candTokens).filter((n) => !/^(19|20)\d{2}$/.test(n));
  if (ytNums.length > 0 && candNums.length > 0) {
    const sharesNumber = ytNums.some((n) => candNums.includes(n));
    if (!sharesNumber) return 0;
  } else if (ytNums.length !== candNums.length && (ytNums.length > 0 || candNums.length > 0)) {
    // One specifies an episode/part number while the other does not
    return 0;
  }

  let hits = 0;
  for (const token of ytSet) {
    if (candSet.has(token)) hits += 1;
  }

  const minRatio = ytDurationSec > 0 && candidateDurationSec > 0 ? 0.6 : 0.82;
  const ytCoverage = hits / ytSet.size;
  const candCoverage = hits / candSet.size;
  if (ytCoverage < minRatio || candCoverage < minRatio) return 0;

  const tokenOverlap = (ytCoverage + candCoverage) / 2;

  if (ytDurationSec > 0 && candidateDurationSec > 0) {
    const diff = Math.abs(ytDurationSec - candidateDurationSec);
    const maxAllowedDiff = Math.max(20, ytDurationSec * 0.15);
    if (diff > maxAllowedDiff) return 0;
    const durationScore = Math.max(0, 1 - diff / maxAllowedDiff);
    return tokenOverlap * 0.7 + durationScore * 0.3;
  }

  return tokenOverlap;
}

export function isAllowedYouTubeMediaHost(targetUrl: string): boolean {
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
