import type {
  XtreamCategory,
  XtreamEpisode,
  XtreamMovieItem,
  XtreamSeasonGroup,
  XtreamServerId,
  XtreamSeriesDetails,
  XtreamSeriesItem,
} from '../shared/types.ts';

export function isValidXtreamNumericId(id: string | undefined): boolean {
  return /^\d{1,12}$/.test(String(id || '').trim());
}

export function normalizeXtreamSearchText(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[\u064B-\u065F\u0670\u0640]/g, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isPrivateOrLocalHostname(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (!host) return true;
  if (host === 'localhost' || host === '::1' || host.endsWith('.local') || host.endsWith('.internal')) {
    return true;
  }
  const m = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (m) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    if (a === 127 || a === 10 || a === 0) return true;
    if (a === 169 && b === 254) return true;
    if (a === 192 && b === 168) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
  }
  if (/^(fe80|fc00|fd[0-9a-f]{2}):/i.test(host)) return true;
  return false;
}

const TRUSTED_IMAGE_DOMAINS = [
  'image.tmdb.org',
  'www.themoviedb.org',
  'artworks.thetvdb.com',
  'thetvdb.com',
  'imdb.com',
  'media-amazon.com',
];

export function isSafeXtreamImageUrl(rawUrl: string, configuredHost = ''): boolean {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
    const host = parsed.hostname.toLowerCase();
    if (isPrivateOrLocalHostname(host)) return false;

    const cleanConfigured = configuredHost.toLowerCase().trim();
    if (cleanConfigured && (host === cleanConfigured || host.endsWith(`.${cleanConfigured}`))) {
      return true;
    }
    return TRUSTED_IMAGE_DOMAINS.some((d) => host === d || host.endsWith(`.${d}`));
  } catch {
    return false;
  }
}

export function formatXtreamPosterUrl(rawUrl: string | undefined, configuredHost = ''): string {
  const clean = String(rawUrl || '').trim();
  if (!clean) return '';
  if (clean.startsWith('https://')) return clean;
  if (clean.startsWith('http://') && isSafeXtreamImageUrl(clean, configuredHost)) {
    return `/api/xtream/image?u=${encodeURIComponent(clean)}`;
  }
  return '';
}

export function cleanXtreamCategoryName(raw: string | undefined): string {
  return String(raw || '')
    .replace(/[\uFFFD\u2720-\u2727]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function parseClockDurationToSeconds(raw: string | number | null | undefined): number | undefined {
  if (typeof raw === 'number') {
    return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : undefined;
  }
  const clean = String(raw || '').trim();
  if (!clean) return undefined;
  if (/^\d+(\.\d+)?$/.test(clean)) {
    const secs = Math.floor(Number.parseFloat(clean));
    return secs > 0 ? secs : undefined;
  }
  const parts = clean.split(':').map((p) => Number.parseInt(p.trim(), 10));
  if (parts.some((n) => !Number.isFinite(n) || n < 0)) return undefined;
  if (parts.length === 2) {
    const total = parts[0] * 60 + parts[1];
    return total > 0 ? total : undefined;
  }
  if (parts.length === 3) {
    const total = parts[0] * 3600 + parts[1] * 60 + parts[2];
    return total > 0 ? total : undefined;
  }
  return undefined;
}

export interface RawXtreamCategory {
  category_id?: string | number;
  category_name?: string;
}

export function parseXtreamCategories(rawList: RawXtreamCategory[]): XtreamCategory[] {
  if (!Array.isArray(rawList)) return [];
  const out: XtreamCategory[] = [];
  const seen = new Set<string>();
  for (const row of rawList) {
    const id = String(row?.category_id ?? '').trim();
    const name = cleanXtreamCategoryName(row?.category_name);
    if (!id || !name || seen.has(id)) continue;
    seen.add(id);
    out.push({ id, name });
  }
  return out;
}

export interface RawXtreamSeries {
  series_id?: string | number;
  name?: string;
  cover?: string;
  plot?: string;
  cast?: string;
  director?: string;
  genre?: string;
  releaseDate?: string;
  release_date?: string;
  rating?: string | number;
  rating_5based?: string | number;
  category_id?: string | number;
  last_modified?: string | number;
}

export function parseXtreamSeriesList(
  rawList: RawXtreamSeries[],
  configuredHost = '',
): XtreamSeriesItem[] {
  if (!Array.isArray(rawList)) return [];
  const out: XtreamSeriesItem[] = [];
  const seen = new Set<string>();
  for (const row of rawList) {
    const id = String(row?.series_id ?? '').trim();
    const name = String(row?.name || '').trim();
    if (!isValidXtreamNumericId(id) || !name || seen.has(id)) continue;
    seen.add(id);
    const rawRating = String(row?.rating ?? '').trim();
    const ratingNum = Number.parseFloat(rawRating);
    out.push({
      id,
      name,
      cover: formatXtreamPosterUrl(row?.cover, configuredHost),
      rating: Number.isFinite(ratingNum) && ratingNum > 0 ? ratingNum.toFixed(1) : undefined,
      plot: String(row?.plot || '').trim() || undefined,
      genre: String(row?.genre || '').trim() || undefined,
      categoryId: String(row?.category_id ?? '').trim(),
      releaseDate: String(row?.releaseDate || row?.release_date || '').trim() || undefined,
      cast: String(row?.cast || '').trim() || undefined,
      director: String(row?.director || '').trim() || undefined,
    });
  }
  return out;
}

export interface RawXtreamVod {
  stream_id?: string | number;
  name?: string;
  stream_icon?: string;
  rating?: string | number;
  category_id?: string | number;
  container_extension?: string;
  added?: string | number;
  duration?: string;
  duration_secs?: string | number;
}

export function buildXtreamStreamBasePath(
  kind: 'movie' | 'series',
  id: string,
  serverId: XtreamServerId = '1',
): string {
  const base = `/api/xtream/stream/${kind}/${encodeURIComponent(id)}`;
  return serverId === '2' ? `${base}?server=2` : base;
}

export function parseXtreamMoviesList(
  rawList: RawXtreamVod[],
  configuredHost = '',
  serverId: XtreamServerId = '1',
): XtreamMovieItem[] {
  if (!Array.isArray(rawList)) return [];
  const out: XtreamMovieItem[] = [];
  const seen = new Set<string>();
  for (const row of rawList) {
    const id = String(row?.stream_id ?? '').trim();
    const name = String(row?.name || '').trim();
    if (!isValidXtreamNumericId(id) || !name || seen.has(id)) continue;
    seen.add(id);
    const ext = String(row?.container_extension || 'mp4')
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '') || 'mp4';
    const rawRating = String(row?.rating ?? '').trim();
    const ratingNum = Number.parseFloat(rawRating);
    const durSecs =
      parseClockDurationToSeconds(row?.duration_secs) ||
      parseClockDurationToSeconds(row?.duration);
    out.push({
      id,
      name,
      cover: formatXtreamPosterUrl(row?.stream_icon, configuredHost),
      rating: Number.isFinite(ratingNum) && ratingNum > 0 ? ratingNum.toFixed(1) : undefined,
      categoryId: String(row?.category_id ?? '').trim(),
      containerExtension: ext,
      addedAt: row?.added ? String(row.added) : undefined,
      streamUrl: buildXtreamStreamBasePath('movie', id, serverId),
      duration: String(row?.duration || '').trim() || undefined,
      durationSeconds: durSecs,
    });
  }
  return out;
}

export interface RawXtreamEpisode {
  id?: string | number;
  episode_num?: string | number;
  title?: string;
  container_extension?: string;
  season?: string | number;
  info?: {
    movie_image?: string;
    plot?: string;
    duration?: string;
    duration_secs?: number | string;
  };
}

export interface RawXtreamSeriesInfoResponse {
  info?: RawXtreamSeries & { backdrop_path?: string[] | string };
  episodes?: Record<string, RawXtreamEpisode[]>;
}

export function parseXtreamSeriesInfo(
  seriesId: string,
  raw: RawXtreamSeriesInfoResponse | null | undefined,
  configuredHost = '',
  serverId: XtreamServerId = '1',
): XtreamSeriesDetails | null {
  if (!raw || typeof raw !== 'object' || !isValidXtreamNumericId(seriesId)) return null;
  const info = raw.info || {};
  const backdropRaw = Array.isArray(info.backdrop_path)
    ? info.backdrop_path[0]
    : typeof info.backdrop_path === 'string'
      ? info.backdrop_path
      : '';

  const cover = formatXtreamPosterUrl(info.cover, configuredHost);
  const backdrop = formatXtreamPosterUrl(backdropRaw, configuredHost) || cover;
  const ratingNum = Number.parseFloat(String(info.rating ?? ''));

  const seasons: XtreamSeasonGroup[] = [];
  const epRecord = raw.episodes && typeof raw.episodes === 'object' ? raw.episodes : {};
  const sortedSeasonKeys = Object.keys(epRecord).sort(
    (a, b) => (Number.parseInt(a, 10) || 0) - (Number.parseInt(b, 10) || 0),
  );

  for (const sKey of sortedSeasonKeys) {
    const rawEpisodes = Array.isArray(epRecord[sKey]) ? epRecord[sKey] : [];
    const seasonNum = Number.parseInt(sKey, 10) || 1;
    const episodes: XtreamEpisode[] = [];

    for (const ep of rawEpisodes) {
      const epId = String(ep?.id ?? '').trim();
      if (!isValidXtreamNumericId(epId)) continue;
      const ext =
        String(ep?.container_extension || 'mp4')
          .toLowerCase()
          .replace(/[^a-z0-9]/g, '') || 'mp4';
      const epNum = Number.parseInt(String(ep?.episode_num ?? episodes.length + 1), 10) || episodes.length + 1;
      const durSecs =
        parseClockDurationToSeconds(ep?.info?.duration_secs) ||
        parseClockDurationToSeconds(ep?.info?.duration);

      episodes.push({
        id: epId,
        episodeNum: epNum,
        seasonNum,
        title: String(ep?.title || `Episode ${epNum}`).trim(),
        duration: String(ep?.info?.duration || '').trim() || undefined,
        durationSeconds: durSecs,
        streamUrl: buildXtreamStreamBasePath('series', epId, serverId),
        containerExtension: ext,
        thumbnail: formatXtreamPosterUrl(ep?.info?.movie_image, configuredHost) || cover,
        plot: String(ep?.info?.plot || '').trim() || undefined,
      });
    }

    episodes.sort((a, b) => a.episodeNum - b.episodeNum);
    if (episodes.length > 0) {
      seasons.push({ seasonNumber: seasonNum, episodes });
    }
  }

  return {
    series: {
      id: seriesId,
      name: String(info.name || seriesId).trim(),
      cover,
      backdrop: backdrop || undefined,
      rating: Number.isFinite(ratingNum) && ratingNum > 0 ? ratingNum.toFixed(1) : undefined,
      plot: String(info.plot || '').trim() || undefined,
      genre: String(info.genre || '').trim() || undefined,
      categoryId: String(info.category_id ?? '').trim(),
      releaseDate: String(info.releaseDate || info.release_date || '').trim() || undefined,
      cast: String(info.cast || '').trim() || undefined,
      director: String(info.director || '').trim() || undefined,
    },
    seasons,
    configured: true,
  };
}

export function filterAndRankXtreamItems<T extends { name: string; categoryId: string; genre?: string }>(
  items: T[],
  categoryId: string,
  query: string,
): T[] {
  let pool = items;
  if (categoryId && categoryId !== 'all') {
    pool = pool.filter((item) => item.categoryId === categoryId);
  }

  const cleanQ = normalizeXtreamSearchText(query);
  if (!cleanQ) return pool;

  const tokens = cleanQ.split(' ').filter((t) => t.length >= 1);
  if (tokens.length === 0) return pool;

  const scored: Array<{ item: T; score: number }> = [];
  for (const item of pool) {
    const normName = normalizeXtreamSearchText(item.name);
    const normGenre = normalizeXtreamSearchText(item.genre || '');
    const combined = `${normName} ${normGenre}`.trim();
    if (!tokens.every((t) => combined.includes(t))) continue;

    let score = 1;
    if (normName === cleanQ) score += 100;
    else if (normName.startsWith(cleanQ)) score += 50;
    else if (normName.includes(cleanQ)) score += 25;
    scored.push({ item, score });
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.map((s) => s.item);
}
