import type { Request, Response } from 'express';
import { execFile, spawn, type ChildProcess } from 'node:child_process';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { Readable } from 'node:stream';
import type { ReadableStream as NodeReadableStream } from 'node:stream/web';
import { promisify } from 'node:util';
import type {
  XtreamCatalogResponse,
  XtreamCategory,
  XtreamMovieItem,
  XtreamServerId,
  XtreamSeriesDetails,
  XtreamSeriesItem,
  XtreamTab,
} from '../shared/types.ts';
import {
  buildXtreamStreamBasePath,
  filterAndRankXtreamItems,
  isSafeXtreamImageUrl,
  isValidXtreamNumericId,
  parseClockDurationToSeconds,
  parseXtreamCategories,
  parseXtreamMoviesList,
  parseXtreamSeriesInfo,
  parseXtreamSeriesList,
  type RawXtreamCategory,
  type RawXtreamSeries,
  type RawXtreamSeriesInfoResponse,
  type RawXtreamVod,
} from './xtreamParser.ts';
import { sanitizeDownloadFilename } from './mediaParser.ts';

const execFileAsync = promisify(execFile);

const DESKTOP_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36';
const IPTV_STREAM_UA = 'VLC/3.0.18 LibVLC/3.0.18';

interface XtreamConfig {
  baseUrl: string;
  host: string;
  username: string;
  password: string;
}

const runtimeXtreamConfigs: Record<XtreamServerId, XtreamConfig | null> = {
  '1': null,
  '2': null,
};

export function normalizeXtreamServerId(raw: unknown): XtreamServerId {
  return String(raw || '').trim() === '2' ? '2' : '1';
}

function parseXtreamConfigValues(rawBase: string, username: string, password: string): XtreamConfig | null {
  const cleanBase = rawBase.trim().replace(/\/+$/, '');
  const cleanUser = username.trim();
  const cleanPass = password.trim();
  if (!cleanBase || !cleanUser || !cleanPass) return null;

  try {
    const parsed = new URL(cleanBase);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    if (!parsed.hostname) return null;
    return {
      baseUrl: `${parsed.protocol}//${parsed.host}`,
      host: parsed.hostname.toLowerCase(),
      username: cleanUser,
      password: cleanPass,
    };
  } catch {
    return null;
  }
}

function getEnvXtreamConfig(serverId: XtreamServerId): XtreamConfig | null {
  if (serverId === '2') {
    return parseXtreamConfigValues(
      process.env.XTREAM2_BASE_URL || '',
      process.env.XTREAM2_USERNAME || '',
      process.env.XTREAM2_PASSWORD || '',
    );
  }
  return parseXtreamConfigValues(
    process.env.XTREAM_BASE_URL || '',
    process.env.XTREAM_USERNAME || '',
    process.env.XTREAM_PASSWORD || '',
  );
}

function getXtreamConfig(serverId: XtreamServerId = '1'): XtreamConfig | null {
  return getEnvXtreamConfig(serverId) || runtimeXtreamConfigs[serverId];
}

export async function configureXtreamRuntime(
  baseUrl: string,
  username: string,
  password: string,
  serverId: XtreamServerId = '1',
): Promise<{ ok: boolean; status: number; error?: string }> {
  if (getEnvXtreamConfig(serverId) || runtimeXtreamConfigs[serverId]) {
    return { ok: false, status: 409, error: 'Xtream server is already configured' };
  }
  const candidate = parseXtreamConfigValues(baseUrl, username, password);
  if (!candidate) {
    return { ok: false, status: 400, error: 'Invalid Xtream server URL or credentials' };
  }

  try {
    const res = await fetchXtreamApiJson<{ user_info?: { auth?: number; status?: string } }>(
      candidate,
      'get_series_categories',
      {},
      10000,
    );
    if (!Array.isArray(res) && res?.user_info?.auth === 0) {
      return { ok: false, status: 401, error: 'Invalid Xtream username or password' };
    }
    runtimeXtreamConfigs[serverId] = candidate;
    const prefix = `xtream:${serverId}:`;
    for (const k of xtreamCache.keys()) {
      if (k.startsWith(prefix)) xtreamCache.delete(k);
    }
    return { ok: true, status: 200 };
  } catch {
    return { ok: false, status: 502, error: 'Could not reach Xtream server' };
  }
}

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

const xtreamCache = new Map<string, CacheEntry<unknown>>();
const seriesExtensionMap = new Map<string, string>();
const seriesDurationMap = new Map<string, number>();
const movieExtensionMap = new Map<string, string>();
const movieDurationMap = new Map<string, number>();
let xtreamWarmStarted = false;

export function warmXtreamEngine(): void {
  if (xtreamWarmStarted) return;
  xtreamWarmStarted = true;
  if (getXtreamConfig('1')) {
    void getXtreamCatalog({ serverId: '1', tab: 'series', categoryId: 'all', offset: 0, limit: 24 }).catch(() => {});
  }
  if (getXtreamConfig('2')) {
    void getXtreamCatalog({ serverId: '2', tab: 'series', categoryId: 'all', offset: 0, limit: 24 }).catch(() => {});
  }
}

function getCached<T>(key: string): T | null {
  const entry = xtreamCache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    xtreamCache.delete(key);
    return null;
  }
  return entry.value as T;
}

function setCached<T>(key: string, value: T, ttlMs = 15 * 60 * 1000): void {
  if (xtreamCache.size > 500) {
    const oldest = xtreamCache.keys().next().value;
    if (oldest) xtreamCache.delete(oldest);
  }
  xtreamCache.set(key, { value, expiresAt: Date.now() + ttlMs });
}

const lastGoodSeriesCats: Record<XtreamServerId, XtreamCategory[]> = { '1': [], '2': [] };
const lastGoodVodCats: Record<XtreamServerId, XtreamCategory[]> = { '1': [], '2': [] };
const lastGoodSeries: Record<XtreamServerId, XtreamSeriesItem[]> = { '1': [], '2': [] };
const lastGoodMovies: Record<XtreamServerId, XtreamMovieItem[]> = { '1': [], '2': [] };

async function fetchXtreamApiJson<T>(
  cfg: XtreamConfig,
  action: string,
  extraParams: Record<string, string> = {},
  timeoutMs = 20000,
): Promise<T> {
  const url = new URL(`${cfg.baseUrl}/player_api.php`);
  url.searchParams.set('username', cfg.username);
  url.searchParams.set('password', cfg.password);
  url.searchParams.set('action', action);
  for (const [k, v] of Object.entries(extraParams)) {
    if (v) url.searchParams.set(k, v);
  }

  let lastErr: unknown = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const res = await fetch(url.toString(), {
        headers: { 'User-Agent': DESKTOP_UA, Accept: 'application/json' },
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!res.ok) {
        throw new Error(`Xtream API HTTP ${res.status}`);
      }
      return (await res.json()) as T;
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error('Xtream API fetch failed');
}

async function getSeriesCategories(cfg: XtreamConfig, serverId: XtreamServerId): Promise<XtreamCategory[]> {
  const key = `xtream:${serverId}:series:cats`;
  const cached = getCached<XtreamCategory[]>(key);
  if (cached) return cached;

  try {
    const raw = await fetchXtreamApiJson<RawXtreamCategory[]>(cfg, 'get_series_categories', {}, 20000);
    const parsed = parseXtreamCategories(raw);
    if (parsed.length > 0) {
      lastGoodSeriesCats[serverId] = parsed;
      setCached(key, parsed, 30 * 60 * 1000);
    }
    return parsed.length > 0 ? parsed : lastGoodSeriesCats[serverId];
  } catch (err) {
    if (lastGoodSeriesCats[serverId].length > 0) return lastGoodSeriesCats[serverId];
    throw err;
  }
}

async function getVodCategories(cfg: XtreamConfig, serverId: XtreamServerId): Promise<XtreamCategory[]> {
  const key = `xtream:${serverId}:vod:cats`;
  const cached = getCached<XtreamCategory[]>(key);
  if (cached) return cached;

  try {
    const raw = await fetchXtreamApiJson<RawXtreamCategory[]>(cfg, 'get_vod_categories', {}, 20000);
    const parsed = parseXtreamCategories(raw);
    if (parsed.length > 0) {
      lastGoodVodCats[serverId] = parsed;
      setCached(key, parsed, 30 * 60 * 1000);
    }
    return parsed.length > 0 ? parsed : lastGoodVodCats[serverId];
  } catch (err) {
    if (lastGoodVodCats[serverId].length > 0) return lastGoodVodCats[serverId];
    throw err;
  }
}

async function getAllSeries(cfg: XtreamConfig, serverId: XtreamServerId): Promise<XtreamSeriesItem[]> {
  const key = `xtream:${serverId}:series:all`;
  const cached = getCached<XtreamSeriesItem[]>(key);
  if (cached) return cached;

  try {
    const raw = await fetchXtreamApiJson<RawXtreamSeries[]>(cfg, 'get_series', {}, 45000);
    const parsed = parseXtreamSeriesList(raw, cfg.host);
    if (parsed.length > 0) {
      lastGoodSeries[serverId] = parsed;
      setCached(key, parsed, 15 * 60 * 1000);
    }
    return parsed.length > 0 ? parsed : lastGoodSeries[serverId];
  } catch (err) {
    if (lastGoodSeries[serverId].length > 0) return lastGoodSeries[serverId];
    throw err;
  }
}

async function getAllMovies(cfg: XtreamConfig, serverId: XtreamServerId): Promise<XtreamMovieItem[]> {
  const key = `xtream:${serverId}:vod:all`;
  const cached = getCached<XtreamMovieItem[]>(key);
  if (cached) return cached;

  try {
    const raw = await fetchXtreamApiJson<RawXtreamVod[]>(cfg, 'get_vod_streams', {}, 60000);
    const parsed = parseXtreamMoviesList(raw, cfg.host, serverId);
    for (const m of parsed) {
      movieExtensionMap.set(`${serverId}:${m.id}`, m.containerExtension);
      if (m.durationSeconds && m.durationSeconds > 0) {
        movieDurationMap.set(`${serverId}:${m.id}`, m.durationSeconds);
      }
    }
    if (parsed.length > 0) {
      lastGoodMovies[serverId] = parsed;
      setCached(key, parsed, 15 * 60 * 1000);
    }
    return parsed.length > 0 ? parsed : lastGoodMovies[serverId];
  } catch (err) {
    if (lastGoodMovies[serverId].length > 0) return lastGoodMovies[serverId];
    throw err;
  }
}

export async function getXtreamCatalog(params: {
  serverId?: XtreamServerId;
  tab: XtreamTab;
  categoryId?: string;
  query?: string;
  offset?: number;
  limit?: number;
}): Promise<XtreamCatalogResponse> {
  const serverId = normalizeXtreamServerId(params.serverId);
  const cfg = getXtreamConfig(serverId);
  const tab: XtreamTab = params.tab === 'movies' ? 'movies' : 'series';
  const categoryId = (params.categoryId || 'all').trim() || 'all';
  const query = (params.query || '').trim();
  const offset = Math.max(0, Math.floor(params.offset || 0));
  const limit = Math.min(80, Math.max(12, Math.floor(params.limit || 48)));

  if (!cfg) {
    return {
      serverId,
      tab,
      categoryId,
      query,
      categories: [],
      series: [],
      movies: [],
      total: 0,
      hasMore: false,
      configured: false,
    };
  }

  if (tab === 'series') {
    const [categories, allSeries] = await Promise.all([
      getSeriesCategories(cfg, serverId),
      getAllSeries(cfg, serverId),
    ]);
    const filtered = filterAndRankXtreamItems(allSeries, categoryId, query);
    const slice = filtered.slice(offset, offset + limit);
    return {
      serverId,
      tab: 'series',
      categoryId,
      query,
      categories,
      series: slice,
      movies: [],
      total: filtered.length,
      hasMore: offset + slice.length < filtered.length,
      configured: true,
    };
  }

  const [categories, allMovies] = await Promise.all([
    getVodCategories(cfg, serverId),
    getAllMovies(cfg, serverId),
  ]);
  const filtered = filterAndRankXtreamItems(allMovies, categoryId, query);
  const slice = filtered.slice(offset, offset + limit);
  return {
    serverId,
    tab: 'movies',
    categoryId,
    query,
    categories,
    series: [],
    movies: slice,
    total: filtered.length,
    hasMore: offset + slice.length < filtered.length,
    configured: true,
  };
}

export async function getXtreamSeriesDetails(
  seriesId: string,
  serverId: XtreamServerId = '1',
): Promise<XtreamSeriesDetails | null> {
  const cleanServer = normalizeXtreamServerId(serverId);
  if (!isValidXtreamNumericId(seriesId)) return null;
  const cfg = getXtreamConfig(cleanServer);
  if (!cfg) return null;

  const key = `xtream:${cleanServer}:series:info:${seriesId}`;
  const cached = getCached<XtreamSeriesDetails>(key);
  if (cached) return cached;

  const raw = await fetchXtreamApiJson<RawXtreamSeriesInfoResponse>(
    cfg,
    'get_series_info',
    { series_id: seriesId },
    15000,
  );
  const parsed = parseXtreamSeriesInfo(seriesId, raw, cfg.host, cleanServer);
  if (!parsed) return null;

  for (const s of parsed.seasons) {
    for (const ep of s.episodes) {
      seriesExtensionMap.set(`${cleanServer}:${ep.id}`, ep.containerExtension);
      if (ep.durationSeconds && ep.durationSeconds > 0) {
        seriesDurationMap.set(`${cleanServer}:${ep.id}`, ep.durationSeconds);
      }
    }
  }

  setCached(key, parsed, 15 * 60 * 1000);
  return parsed;
}

export async function getXtreamMovieDetails(
  vodId: string,
  serverId: XtreamServerId = '1',
): Promise<XtreamMovieItem | null> {
  const cleanServer = normalizeXtreamServerId(serverId);
  if (!isValidXtreamNumericId(vodId)) return null;
  const cfg = getXtreamConfig(cleanServer);
  if (!cfg) return null;

  const key = `xtream:${cleanServer}:vod:info:${vodId}`;
  const cached = getCached<XtreamMovieItem>(key);
  if (cached) return cached;

  interface RawVodInfo {
    info?: {
      name?: string;
      movie_image?: string;
      cover_big?: string;
      plot?: string;
      genre?: string;
      rating?: string | number;
      duration?: string;
      duration_secs?: string | number;
    };
    movie_data?: {
      stream_id?: string | number;
      name?: string;
      category_id?: string | number;
      container_extension?: string;
      added?: string | number;
    };
  }

  const raw = await fetchXtreamApiJson<RawVodInfo>(cfg, 'get_vod_info', { vod_id: vodId }, 12000).catch(
    () => null,
  );
  if (!raw?.movie_data && !raw?.info) {
    const list = await getAllMovies(cfg, cleanServer).catch(() => [] as XtreamMovieItem[]);
    return list.find((m) => m.id === vodId) || null;
  }

  const ext =
    String(raw.movie_data?.container_extension || movieExtensionMap.get(`${cleanServer}:${vodId}`) || 'mp4')
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '') || 'mp4';
  movieExtensionMap.set(`${cleanServer}:${vodId}`, ext);

  const ratingNum = Number.parseFloat(String(raw.info?.rating ?? ''));
  const durSecs =
    parseClockDurationToSeconds(raw.info?.duration_secs) ||
    parseClockDurationToSeconds(raw.info?.duration) ||
    movieDurationMap.get(`${cleanServer}:${vodId}`);
  if (durSecs && durSecs > 0) {
    movieDurationMap.set(`${cleanServer}:${vodId}`, durSecs);
  }
  const movie: XtreamMovieItem = {
    id: vodId,
    name: String(raw.info?.name || raw.movie_data?.name || vodId).trim(),
    cover:
      formatPosterFallback(
        String(raw.info?.cover_big || raw.info?.movie_image || '').trim(),
        cfg.host,
      ) ||
      (await getAllMovies(cfg, cleanServer).catch(() => [])).find((m) => m.id === vodId)?.cover ||
      '',
    rating: Number.isFinite(ratingNum) && ratingNum > 0 ? ratingNum.toFixed(1) : undefined,
    categoryId: String(raw.movie_data?.category_id ?? '').trim(),
    containerExtension: ext,
    addedAt: raw.movie_data?.added ? String(raw.movie_data.added) : undefined,
    streamUrl: buildXtreamStreamBasePath('movie', vodId, cleanServer),
    duration: String(raw.info?.duration || '').trim() || undefined,
    durationSeconds: durSecs,
    plot: String(raw.info?.plot || '').trim() || undefined,
    genre: String(raw.info?.genre || '').trim() || undefined,
  };

  setCached(key, movie, 15 * 60 * 1000);
  return movie;
}

function formatPosterFallback(rawUrl: string, host: string): string {
  if (!rawUrl) return '';
  if (rawUrl.startsWith('https://')) return rawUrl;
  if (rawUrl.startsWith('http://') && isSafeXtreamImageUrl(rawUrl, host)) {
    return `/api/xtream/image?u=${encodeURIComponent(rawUrl)}`;
  }
  return '';
}

const STREAM_CHUNK_BYTES = 768 * 1024;
const RELAY_BLOCK_BYTES = 512 * 1024;

const cdnUrlCache = new Map<string, { url: string; expiresAt: number }>();
const totalSizeCache = new Map<string, { totalSize: number; expiresAt: number }>();
const codecSummaryCache = new Map<
  string,
  { vcodec: string; acodec: string; durationSeconds?: number; expiresAt: number }
>();

interface RelayMediaEntry {
  key: string;
  serverId: XtreamServerId;
  kind: 'movie' | 'series';
  id: string;
  ext: string;
  cfg: XtreamConfig;
  targetUrl: string;
  totalSize: number | null;
  headBuf: Buffer | null;
  tailBuf: Buffer | null;
  tailStart: number;
  expiresAt: number;
}

const relayEntries = new Map<string, RelayMediaEntry>();
let relayServer: http.Server | null = null;
let relayPort: number | null = null;
let relayInitPromise: Promise<number> | null = null;

interface ActiveConsumerState {
  playbackKey: string;
  isRemux: boolean;
  abort: () => void;
}

// Level 1: Per-server active consumer registry (cancels superseded playback/seek/remux consumer without killing sibling byte-ranges)
const activeConsumerState: Record<XtreamServerId, ActiveConsumerState | null> = {
  '1': null,
  '2': null,
};

// Level 2: Per-server serialized upstream HTTP socket gate (at most 1 upstream CDN connection per server)
const activeUpstreamAbort: Record<XtreamServerId, (() => void) | null> = { '1': null, '2': null };
const lastUpstreamDoneAt: Record<XtreamServerId, number> = { '1': 0, '2': 0 };
const upstreamSlotQueues: Record<XtreamServerId, Promise<void>> = {
  '1': Promise.resolve(),
  '2': Promise.resolve(),
};

function delayMs(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function registerActiveStreamConsumer(
  serverId: XtreamServerId,
  playbackKey: string,
  isRemux: boolean,
  abortFn: () => void,
): () => void {
  const prev = activeConsumerState[serverId];
  if (prev && prev.abort !== abortFn) {
    // Cancel previous consumer if: (a) new consumer is a remux/seek stream, (b) playback moved to a different item,
    // or (c) previous consumer was an ffmpeg remux stream being replaced by a direct stream.
    // Never kill sibling direct HTTP 206 byte-range requests belonging to the SAME active video!
    if (isRemux || prev.isRemux || prev.playbackKey !== playbackKey) {
      try {
        prev.abort();
      } catch {
        // ignore previous consumer abort errors
      }
      activeConsumerState[serverId] = { playbackKey, isRemux, abort: abortFn };
    }
  } else {
    activeConsumerState[serverId] = { playbackKey, isRemux, abort: abortFn };
  }

  return () => {
    const cur = activeConsumerState[serverId];
    if (cur && cur.abort === abortFn) {
      activeConsumerState[serverId] = null;
    }
  };
}

function onClientDisconnect(
  req: http.IncomingMessage | Request,
  res: http.ServerResponse | Response,
  handler: () => void,
): () => void {
  let fired = false;
  const onClose = () => {
    if (fired) return;
    if (!res.writableFinished) {
      fired = true;
      handler();
    }
  };
  res.once('close', onClose);
  req.once('aborted', onClose);
  return () => {
    res.off('close', onClose);
    req.off('aborted', onClose);
  };
}

async function runUpstreamFetchSlot<T>(
  serverId: XtreamServerId,
  task: (setAbort: (abortFn: (() => void) | null) => void) => Promise<T>,
  options: { preemptPrevious?: boolean } = {},
): Promise<T> {
  let abortedPrevious = false;
  if (options.preemptPrevious) {
    const prevUpstream = activeUpstreamAbort[serverId];
    if (prevUpstream) {
      abortedPrevious = true;
      try {
        prevUpstream();
      } catch {
        // ignore previous upstream abort errors
      }
      activeUpstreamAbort[serverId] = null;
    }
  }

  let releaseGate!: () => void;
  const gateReleased = new Promise<void>((resolve) => {
    releaseGate = resolve;
  });
  const previousGate = upstreamSlotQueues[serverId];
  upstreamSlotQueues[serverId] = previousGate.then(() => gateReleased, () => gateReleased);

  await previousGate.catch(() => {});
  if (abortedPrevious) {
    // Allow max_connections=1 CDN TCP socket to close cleanly before opening next socket
    await delayMs(280);
  } else {
    const elapsedSinceDone = Date.now() - lastUpstreamDoneAt[serverId];
    if (elapsedSinceDone >= 0 && elapsedSinceDone < 90) {
      await delayMs(90 - elapsedSinceDone);
    }
  }

  let ownAbort: (() => void) | null = null;
  const setAbort = (abortFn: (() => void) | null) => {
    ownAbort = abortFn;
    activeUpstreamAbort[serverId] = abortFn;
  };

  try {
    return await task(setAbort);
  } finally {
    if (ownAbort && activeUpstreamAbort[serverId] === ownAbort) {
      activeUpstreamAbort[serverId] = null;
    } else if (!ownAbort) {
      activeUpstreamAbort[serverId] = null;
    }
    lastUpstreamDoneAt[serverId] = Date.now();
    releaseGate();
  }
}

async function resolveStreamExtension(
  cfg: XtreamConfig,
  serverId: XtreamServerId,
  kind: 'movie' | 'series',
  id: string,
): Promise<string> {
  const mapKey = `${serverId}:${id}`;
  if (kind === 'series') {
    return seriesExtensionMap.get(mapKey) || 'mp4';
  }
  const known = movieExtensionMap.get(mapKey);
  if (known) return known;
  const info = await getXtreamMovieDetails(id, serverId).catch(() => null);
  return info?.containerExtension || 'mp4';
}

async function resolveDirectCdnTarget(
  cfg: XtreamConfig,
  serverId: XtreamServerId,
  kind: 'movie' | 'series',
  id: string,
  ext: string,
  forceRefresh = false,
  insideUpstreamSlot = false,
): Promise<{ url: string; ext: string }> {
  const cacheKey = `${serverId}:${kind}:${id}:${ext}`;
  if (!forceRefresh) {
    const cached = cdnUrlCache.get(cacheKey);
    if (cached && Date.now() < cached.expiresAt) {
      return { url: cached.url, ext };
    }
  } else {
    cdnUrlCache.delete(cacheKey);
  }

  const executeProbe = async (): Promise<{ url: string; ext: string }> => {
    if (!forceRefresh) {
      const cached = cdnUrlCache.get(cacheKey);
      if (cached && Date.now() < cached.expiresAt) {
        return { url: cached.url, ext };
      }
    }

    const upstreamPath = kind === 'series' ? 'series' : 'movie';
    let activeExt = ext;
    let panelUrl = `${cfg.baseUrl}/${upstreamPath}/${encodeURIComponent(cfg.username)}/${encodeURIComponent(cfg.password)}/${encodeURIComponent(id)}.${activeExt}`;

    const probeRedirect = async (target: string) => {
      const res = await fetch(target, {
        method: 'GET',
        redirect: 'manual',
        headers: { 'User-Agent': IPTV_STREAM_UA, Range: 'bytes=0-0' },
        signal: AbortSignal.timeout(8000),
      });
      const loc = res.headers.get('location');
      try {
        await res.body?.cancel();
      } catch {
        // ignore
      }
      return { res, loc };
    };

    let { res, loc } = await probeRedirect(panelUrl);
    if (
      res.status === 404 &&
      kind === 'series' &&
      !seriesExtensionMap.has(`${serverId}:${id}`) &&
      activeExt !== 'mkv'
    ) {
      activeExt = 'mkv';
      panelUrl = `${cfg.baseUrl}/series/${encodeURIComponent(cfg.username)}/${encodeURIComponent(cfg.password)}/${encodeURIComponent(id)}.mkv`;
      const alt = await probeRedirect(panelUrl);
      if (alt.res.ok || alt.res.status === 302 || alt.res.status === 301 || alt.res.status === 206) {
        seriesExtensionMap.set(`${serverId}:${id}`, 'mkv');
        res = alt.res;
        loc = alt.loc;
      }
    }

    let finalUrl = panelUrl;
    if (loc && (res.status === 301 || res.status === 302 || res.status === 307 || res.status === 308)) {
      // Preserve explicit :80 port verbatim if edge server checks exact Location string
      finalUrl = /^https?:\/\//i.test(loc) ? loc : new URL(loc, panelUrl).toString();
    }

    cdnUrlCache.set(cacheKey, {
      url: finalUrl,
      expiresAt: Date.now() + 20 * 1000,
    });
    return { url: finalUrl, ext: activeExt };
  };

  if (insideUpstreamSlot) {
    return await executeProbe();
  }
  return await runUpstreamFetchSlot(serverId, async () => executeProbe());
}

function parseRelayRangeHeader(
  rangeHeader: string | undefined,
  totalSize: number | null,
): { start: number; end: number | null; isBounded: boolean } {
  if (!rangeHeader) {
    return { start: 0, end: totalSize ? totalSize - 1 : null, isBounded: false };
  }
  const match = rangeHeader.match(/bytes=(\d+)-(\d*)/i);
  if (!match) {
    return { start: 0, end: totalSize ? totalSize - 1 : null, isBounded: false };
  }
  const start = Math.max(0, Number.parseInt(match[1], 10) || 0);
  if (match[2]) {
    const reqEnd = Number.parseInt(match[2], 10);
    if (Number.isFinite(reqEnd) && reqEnd >= start) {
      const clampedEnd = totalSize !== null ? Math.min(reqEnd, totalSize - 1) : reqEnd;
      return { start, end: Math.max(start, clampedEnd), isBounded: true };
    }
  }
  return {
    start,
    end: totalSize !== null ? totalSize - 1 : null,
    isBounded: false,
  };
}

function extractTotalSizeFromContentRange(contentRange: string | null): number | null {
  if (!contentRange) return null;
  const match = contentRange.match(/bytes\s+\d+-\d+\/(\d+)/i);
  if (!match) return null;
  const total = Number.parseInt(match[1], 10);
  return Number.isFinite(total) && total > 0 ? total : null;
}

function getOrUpdateRelayEntry(params: {
  serverId: XtreamServerId;
  kind: 'movie' | 'series';
  id: string;
  ext: string;
  cfg: XtreamConfig;
  targetUrl: string;
}): RelayMediaEntry {
  const key = `${params.serverId}:${params.kind}:${params.id}:${params.ext}`;
  const existing = relayEntries.get(key);
  if (existing && Date.now() < existing.expiresAt) {
    existing.targetUrl = params.targetUrl;
    existing.cfg = params.cfg;
    existing.expiresAt = Date.now() + 20 * 60 * 1000;
    const cachedSize = totalSizeCache.get(key);
    if (cachedSize && Date.now() < cachedSize.expiresAt) {
      existing.totalSize = cachedSize.totalSize;
    }
    return existing;
  }

  if (relayEntries.size > 24) {
    const oldest = relayEntries.keys().next().value;
    if (oldest) relayEntries.delete(oldest);
  }

  const cachedSize = totalSizeCache.get(key);
  const created: RelayMediaEntry = {
    key,
    serverId: params.serverId,
    kind: params.kind,
    id: params.id,
    ext: params.ext,
    cfg: params.cfg,
    targetUrl: params.targetUrl,
    totalSize: cachedSize && Date.now() < cachedSize.expiresAt ? cachedSize.totalSize : null,
    headBuf: null,
    tailBuf: null,
    tailStart: 0,
    expiresAt: Date.now() + 20 * 60 * 1000,
  };
  relayEntries.set(key, created);
  return created;
}


async function handleRelayRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  try {
    const reqUrl = new URL(req.url || '/', 'http://127.0.0.1');
    const match = reqUrl.pathname.match(/^\/relay\/(1|2)\/(movie|series)\/(\d+)$/);
    if (!match) {
      res.statusCode = 404;
      res.end();
      return;
    }

    const serverId = match[1] as XtreamServerId;
    const kind = match[2] as 'movie' | 'series';
    const id = match[3];
    const ext = reqUrl.searchParams.get('ext') || 'mp4';
    const cfg = getXtreamConfig(serverId);
    if (!cfg) {
      res.statusCode = 503;
      res.end();
      return;
    }

    const cdnKey = `${serverId}:${kind}:${id}:${ext}`;
    const targetUrl =
      cdnUrlCache.get(cdnKey)?.url ||
      `${cfg.baseUrl}/${kind === 'series' ? 'series' : 'movie'}/${encodeURIComponent(cfg.username)}/${encodeURIComponent(cfg.password)}/${encodeURIComponent(id)}.${ext}`;
    const entry = getOrUpdateRelayEntry({ serverId, kind, id, ext, cfg, targetUrl });

    if (req.method === 'HEAD') {
      if (entry.totalSize === null) {
        await runUpstreamFetchSlot(serverId, async (setAbort) => {
          const ac = new AbortController();
          setAbort(() => ac.abort());
          try {
            const probe = await fetch(entry.targetUrl, {
              headers: { 'User-Agent': IPTV_STREAM_UA, Range: 'bytes=0-0' },
              redirect: 'follow',
              signal: ac.signal,
            });
            const tot = extractTotalSizeFromContentRange(probe.headers.get('content-range'));
            if (tot !== null) {
              entry.totalSize = tot;
              totalSizeCache.set(entry.key, { totalSize: tot, expiresAt: Date.now() + 15 * 60 * 1000 });
            }
            await probe.body?.cancel();
          } catch {
            // ignore
          }
        });
      }
      res.statusCode = 200;
      res.setHeader('Accept-Ranges', 'bytes');
      res.setHeader('Content-Type', ext === 'mkv' ? 'video/x-matroska' : 'video/mp4');
      if (entry.totalSize !== null) {
        res.setHeader('Content-Length', String(entry.totalSize));
      }
      res.end();
      return;
    }

    const rawRange = typeof req.headers.range === 'string' ? req.headers.range : undefined;
    const parsedRange = parseRelayRangeHeader(rawRange, entry.totalSize);
    const { start } = parsedRange;

    // 1) Serve cached tail bytes instantaneously from RAM (< 1ms)
    if (
      entry.totalSize !== null &&
      entry.tailBuf &&
      start >= entry.tailStart &&
      start < entry.totalSize
    ) {
      const sliceStart = start - entry.tailStart;
      const sliceEnd =
        parsedRange.end !== null
          ? Math.min(entry.tailBuf.length, parsedRange.end - entry.tailStart + 1)
          : entry.tailBuf.length;
      const chunk = entry.tailBuf.subarray(sliceStart, sliceEnd);
      res.statusCode = 206;
      res.setHeader('Accept-Ranges', 'bytes');
      res.setHeader('Content-Type', ext === 'mkv' ? 'video/x-matroska' : 'video/mp4');
      res.setHeader('Content-Length', String(chunk.length));
      res.setHeader(
        'Content-Range',
        `bytes ${start}-${start + chunk.length - 1}/${entry.totalSize}`,
      );
      res.end(chunk);
      return;
    }

    // 2) Serve cached head bytes instantaneously; if caller stays open past headBuf, continue upstream seamlessly
    if (
      entry.totalSize !== null &&
      entry.headBuf &&
      start < entry.headBuf.length
    ) {
      const requestedEnd =
        parsedRange.end !== null ? Math.min(parsedRange.end, entry.totalSize - 1) : entry.totalSize - 1;
      const chunkEnd = Math.min(requestedEnd, entry.headBuf.length - 1);
      const headSlice = entry.headBuf.subarray(start, chunkEnd + 1);
      const contentLen = requestedEnd - start + 1;

      res.statusCode = 206;
      res.setHeader('Accept-Ranges', 'bytes');
      res.setHeader('Content-Type', ext === 'mkv' ? 'video/x-matroska' : 'video/mp4');
      res.setHeader('Content-Length', String(contentLen));
      res.setHeader('Content-Range', `bytes ${start}-${requestedEnd}/${entry.totalSize}`);
      res.write(headSlice);

      if (chunkEnd >= requestedEnd) {
        res.end();
        return;
      }

      // Brief grace period: ffprobe / ffmpeg -ss seeks close header socket immediately after reading ~64-128KB
      await delayMs(45);
      if (req.destroyed || res.destroyed || res.writableEnded) {
        return;
      }

      const nextStart = chunkEnd + 1;
      const rangeStr = parsedRange.isBounded ? `bytes=${nextStart}-${requestedEnd}` : `bytes=${nextStart}-`;
      await streamRelayRangeFromUpstream(entry, rangeStr, nextStart, false, req, res);
      return;
    }

    // 3) Upstream serialized Range fetch (open-ended bytes=${start}- for streaming/media reads)
    const isNearTail =
      entry.totalSize !== null &&
      !entry.tailBuf &&
      start >= Math.max(0, entry.totalSize - RELAY_BLOCK_BYTES);

    const upstreamStart = isNearTail
      ? Math.max(0, (entry.totalSize as number) - RELAY_BLOCK_BYTES)
      : start;
    const rangeStr =
      parsedRange.isBounded && parsedRange.end !== null && !isNearTail
        ? `bytes=${upstreamStart}-${parsedRange.end}`
        : `bytes=${upstreamStart}-`;

    await streamRelayRangeFromUpstream(
      entry,
      rangeStr,
      upstreamStart,
      true,
      req,
      res,
      start - upstreamStart,
    );
  } catch {
    if (!res.headersSent) {
      res.statusCode = 502;
    }
    if (!res.writableEnded) res.end();
  }
}

async function streamRelayRangeFromUpstream(
  entry: RelayMediaEntry,
  rangeStr: string,
  upstreamStart: number,
  writeHttpHeaders: boolean,
  req: http.IncomingMessage,
  res: http.ServerResponse,
  discardLeadingBytes = 0,
): Promise<void> {
  const isCapturingHead = upstreamStart === 0 && !entry.headBuf;
  const isCapturingTail =
    entry.totalSize !== null &&
    !entry.tailBuf &&
    upstreamStart >= Math.max(0, entry.totalSize - RELAY_BLOCK_BYTES);

  await runUpstreamFetchSlot(entry.serverId, async (setAbort) => {
    if (req.destroyed || res.destroyed || res.writableEnded) return;

    let currentUrl = entry.targetUrl;
    let upstream: globalThis.Response | null = null;

    for (let attempt = 0; attempt < 4; attempt += 1) {
      if (req.destroyed || res.destroyed || res.writableEnded) return;
      if (attempt > 0) {
        const waitMs = attempt === 1 ? 300 : attempt === 2 ? 700 : 1200;
        await delayMs(waitMs);
        if (req.destroyed || res.destroyed || res.writableEnded) return;
        const refreshed = await resolveDirectCdnTarget(
          entry.cfg,
          entry.serverId,
          entry.kind,
          entry.id,
          entry.ext,
          true,
          true,
        ).catch(() => null);
        if (refreshed?.url) {
          currentUrl = refreshed.url;
          entry.targetUrl = refreshed.url;
        }
      }

      const controller = new AbortController();
      setAbort(() => controller.abort());
      const detachDisconnect = onClientDisconnect(req, res, () => controller.abort());

      try {
        const candidate = await fetch(currentUrl, {
          headers: {
            'User-Agent': IPTV_STREAM_UA,
            Range: rangeStr,
          },
          redirect: 'follow',
          signal: controller.signal,
        });

        if (candidate.ok || candidate.status === 206) {
          const tot = extractTotalSizeFromContentRange(candidate.headers.get('content-range'));
          if (tot !== null) {
            entry.totalSize = tot;
            totalSizeCache.set(entry.key, { totalSize: tot, expiresAt: Date.now() + 15 * 60 * 1000 });
          }
          upstream = candidate;

          if (!upstream.body) {
            if (writeHttpHeaders && !res.headersSent) {
              res.statusCode = 204;
            }
            res.end();
            detachDisconnect();
            return;
          }

          if (writeHttpHeaders && !res.headersSent) {
            const clientStart = upstreamStart + Math.max(0, discardLeadingBytes);
            const total = entry.totalSize;
            if (total !== null && upstream.status === 206) {
              res.statusCode = 206;
              res.setHeader('Content-Range', `bytes ${clientStart}-${total - 1}/${total}`);
              res.setHeader('Content-Length', String(Math.max(0, total - clientStart)));
            } else {
              res.statusCode = upstream.status;
              const upLen = upstream.headers.get('content-length');
              if (upLen && discardLeadingBytes === 0) {
                res.setHeader('Content-Length', upLen);
              }
            }
            res.setHeader('Accept-Ranges', 'bytes');
            res.setHeader('Content-Type', entry.ext === 'mkv' ? 'video/x-matroska' : 'video/mp4');
          }

          const headChunks: Buffer[] = [];
          let headBytes = 0;
          const tailChunks: Buffer[] = [];
          let tailBytes = 0;
          let skipped = 0;

          await new Promise<void>((resolvePipe) => {
            const nodeStream = Readable.fromWeb(upstream!.body as unknown as NodeReadableStream);
            const stopPipe = () => {
              controller.abort();
              nodeStream.destroy();
              resolvePipe();
            };
            const detachPipeClose = onClientDisconnect(req, res, stopPipe);

            nodeStream.on('data', (rawChunk: Buffer | Uint8Array) => {
              const buf = Buffer.isBuffer(rawChunk) ? rawChunk : Buffer.from(rawChunk);
              if (isCapturingHead && headBytes < RELAY_BLOCK_BYTES) {
                const need = RELAY_BLOCK_BYTES - headBytes;
                headChunks.push(buf.subarray(0, need));
                headBytes += Math.min(buf.length, need);
                if (headBytes >= RELAY_BLOCK_BYTES) {
                  entry.headBuf = Buffer.concat(headChunks);
                }
              }
              if (isCapturingTail && tailBytes < RELAY_BLOCK_BYTES) {
                const need = RELAY_BLOCK_BYTES - tailBytes;
                tailChunks.push(buf.subarray(0, need));
                tailBytes += Math.min(buf.length, need);
                if (
                  entry.totalSize !== null &&
                  upstreamStart + tailBytes >= entry.totalSize
                ) {
                  entry.tailBuf = Buffer.concat(tailChunks);
                  entry.tailStart = upstreamStart;
                }
              }

              let out = buf;
              if (skipped < discardLeadingBytes) {
                const remSkip = discardLeadingBytes - skipped;
                if (buf.length <= remSkip) {
                  skipped += buf.length;
                  return;
                }
                skipped += remSkip;
                out = buf.subarray(remSkip);
              }
              if (!res.destroyed && !res.writableEnded) {
                res.write(out);
              }
            });

            nodeStream.on('end', () => {
              if (isCapturingHead && !entry.headBuf && headBytes > 0) {
                entry.headBuf = Buffer.concat(headChunks);
              }
              if (isCapturingTail && !entry.tailBuf && tailBytes > 0 && entry.totalSize !== null) {
                entry.tailBuf = Buffer.concat(tailChunks);
                entry.tailStart = upstreamStart;
              }
              if (!res.writableEnded) res.end();
              detachPipeClose();
              resolvePipe();
            });
            nodeStream.on('error', () => {
              if (!res.writableEnded) res.end();
              detachPipeClose();
              resolvePipe();
            });
            nodeStream.on('close', () => {
              detachPipeClose();
              resolvePipe();
            });
          });

          detachDisconnect();
          return;
        }

        const status = candidate.status;
        try {
          await candidate.body?.cancel();
        } catch {
          // ignore
        }
        if (
          status !== 403 &&
          status !== 401 &&
          status !== 406 &&
          status !== 410 &&
          status !== 429 &&
          status !== 503
        ) {
          if (writeHttpHeaders && !res.headersSent) res.statusCode = status || 502;
          if (!res.writableEnded) res.end();
          detachDisconnect();
          return;
        }
        cdnUrlCache.delete(entry.key);
      } catch {
        if (controller.signal.aborted || req.destroyed || res.destroyed) {
          detachDisconnect();
          return;
        }
      }
      detachDisconnect();
    }

    if (writeHttpHeaders && !res.headersSent) {
      res.statusCode = 502;
    }
    if (!res.writableEnded) res.end();
  });
}

async function ensureXtreamRelayPort(): Promise<number> {
  if (relayPort !== null && relayServer?.listening) return relayPort;
  if (relayInitPromise) return relayInitPromise;

  relayInitPromise = new Promise<number>((resolve, reject) => {
    const srv = http.createServer((req, res) => {
      void handleRelayRequest(req, res);
    });
    srv.on('error', (err) => {
      relayInitPromise = null;
      reject(err);
    });
    srv.listen(0, '127.0.0.1', () => {
      relayServer = srv;
      const addr = srv.address() as AddressInfo | null;
      relayPort = addr?.port || 0;
      resolve(relayPort);
    });
  });

  return relayInitPromise;
}

async function probeCodecSummaryCached(
  cacheKey: string,
  probeUrl: string,
): Promise<{ vcodec: string; acodec: string; durationSeconds?: number; ranProbe: boolean }> {
  const cached = codecSummaryCache.get(cacheKey);
  if (cached && Date.now() < cached.expiresAt) {
    return {
      vcodec: cached.vcodec,
      acodec: cached.acodec,
      durationSeconds: cached.durationSeconds,
      ranProbe: false,
    };
  }

  try {
    const { stdout } = await execFileAsync(
      'ffprobe',
      [
        '-v',
        'error',
        '-probesize',
        '500000',
        '-analyzeduration',
        '500000',
        '-user_agent',
        IPTV_STREAM_UA,
        '-show_entries',
        'format=duration:stream=codec_type,codec_name',
        '-of',
        'default=noprint_wrappers=1',
        probeUrl,
      ],
      { timeout: 6500 },
    );
    let vcodec = '';
    let acodec = '';
    let durationSeconds: number | undefined;
    const lines = stdout.split(/\r?\n/).map((l) => l.trim());
    for (let i = 0; i < lines.length; i += 1) {
      if (lines[i].startsWith('duration=')) {
        const parsedDur = Number.parseFloat(lines[i].slice('duration='.length));
        if (Number.isFinite(parsedDur) && parsedDur > 0) {
          durationSeconds = Math.floor(parsedDur);
        }
      }
      if (i < lines.length - 1 && lines[i].startsWith('codec_name=')) {
        const name = lines[i].slice('codec_name='.length).toLowerCase();
        const typeLine = lines[i + 1] || '';
        if (typeLine === 'codec_type=video' && !vcodec) vcodec = name;
        if (typeLine === 'codec_type=audio' && !acodec) acodec = name;
      }
    }
    if (vcodec || acodec) {
      codecSummaryCache.set(cacheKey, {
        vcodec,
        acodec,
        durationSeconds,
        expiresAt: Date.now() + 30 * 60 * 1000,
      });
    }
    return { vcodec, acodec, durationSeconds, ranProbe: true };
  } catch {
    return { vcodec: '', acodec: '', durationSeconds: undefined, ranProbe: true };
  }
}

export async function getXtreamMediaMeta(
  kind: 'movie' | 'series',
  id: string,
  serverId: XtreamServerId = '1',
): Promise<{ durationSeconds?: number } | null> {
  const cleanServer = normalizeXtreamServerId(serverId);
  if (!isValidXtreamNumericId(id)) return null;
  const cfg = getXtreamConfig(cleanServer);
  if (!cfg) return null;

  const prefix = `${cleanServer}:${kind}:${id}:`;
  for (const [k, v] of codecSummaryCache.entries()) {
    if (k.startsWith(prefix) && Date.now() < v.expiresAt && v.durationSeconds && v.durationSeconds > 0) {
      return { durationSeconds: v.durationSeconds };
    }
  }

  if (kind === 'series') {
    const cachedEpDur = seriesDurationMap.get(`${cleanServer}:${id}`);
    if (cachedEpDur && cachedEpDur > 0) {
      return { durationSeconds: cachedEpDur };
    }
  } else {
    const cachedMovDur = movieDurationMap.get(`${cleanServer}:${id}`);
    if (cachedMovDur && cachedMovDur > 0) {
      return { durationSeconds: cachedMovDur };
    }
    const details = await getXtreamMovieDetails(id, cleanServer).catch(() => null);
    if (details?.durationSeconds && details.durationSeconds > 0) {
      return { durationSeconds: details.durationSeconds };
    }
  }

  // Do NOT probe the media CDN concurrently during player startup (prevents max_connections=1 403 races).
  return {};
}

function parseClientByteRange(
  rangeHeader: string | undefined,
  knownTotalSize: number | null,
): { start: number; end: number } {
  let start = 0;
  let requestedEnd: number | null = null;

  if (rangeHeader) {
    const match = rangeHeader.match(/bytes=(\d+)-(\d*)/i);
    if (match) {
      start = Math.max(0, Number.parseInt(match[1], 10) || 0);
      if (match[2]) {
        const parsedEnd = Number.parseInt(match[2], 10);
        if (Number.isFinite(parsedEnd) && parsedEnd >= start) {
          requestedEnd = parsedEnd;
        }
      }
    }
  }

  let end =
    requestedEnd !== null
      ? Math.min(requestedEnd, start + STREAM_CHUNK_BYTES - 1)
      : start + STREAM_CHUNK_BYTES - 1;

  if (knownTotalSize !== null && knownTotalSize > 0) {
    if (start >= knownTotalSize) {
      start = Math.max(0, knownTotalSize - 1);
    }
    end = Math.min(end, knownTotalSize - 1);
  }
  return { start, end: Math.max(start, end) };
}

export async function streamXtreamMedia(
  kind: 'movie' | 'series',
  id: string,
  req: Request,
  res: Response,
  serverId: XtreamServerId = '1',
): Promise<void> {
  const cleanServer = normalizeXtreamServerId(serverId);
  if (!isValidXtreamNumericId(id)) {
    res.status(400).json({ error: 'Invalid Xtream media ID' });
    return;
  }

  const cfg = getXtreamConfig(cleanServer);
  if (!cfg) {
    res.status(503).json({ error: 'Xtream server is not configured' });
    return;
  }

  const initialExt = await resolveStreamExtension(cfg, cleanServer, kind, id);
  const upstreamPath = kind === 'series' ? 'series' : 'movie';
  const buildPanelUrl = (extName: string) =>
    `${cfg.baseUrl}/${upstreamPath}/${encodeURIComponent(cfg.username)}/${encodeURIComponent(cfg.password)}/${encodeURIComponent(id)}.${extName}`;

  const forceRemux = req.query.remux === '1' || req.query.remux === 'true';
  const lowBandwidth = req.query.low === '1' || req.query.low === 'true';
  const asDownload = req.query.download === '1' || req.query.download === 'true';
  const rawName = typeof req.query.name === 'string' ? req.query.name.trim() : '';
  const downloadFilename = sanitizeDownloadFilename(rawName, `${kind}-${id}`);
  const asciiFallback = `dramasquare-${kind}-${id}.mp4`;
  const startRaw = Number.parseFloat(String(req.query.start || '0'));
  const startSeconds = Number.isFinite(startRaw) && startRaw > 0 ? Math.min(86400, Math.floor(startRaw)) : 0;

  let activeExt = initialExt;
  let directTargetUrl: string | null = null;
  const targetInfo = await resolveDirectCdnTarget(cfg, cleanServer, kind, id, initialExt, false).catch(() => null);
  if (targetInfo) {
    activeExt = targetInfo.ext;
    directTargetUrl = targetInfo.url;
  }
  const panelUrl = buildPanelUrl(activeExt);
  const fastTargetUrl = directTargetUrl || panelUrl;

  const needsRemuxOrTranscode =
    forceRemux || lowBandwidth || !['mp4', 'm4v', 'webm', 'mov'].includes(activeExt.toLowerCase());

  const playbackKey = `${cleanServer}:${kind}:${id}`;
  if (needsRemuxOrTranscode) {
    let consumerAborted = false;
    let activeFfmpeg: ChildProcess | null = null;
    const cancelConsumer = () => {
      consumerAborted = true;
      if (activeFfmpeg && !activeFfmpeg.killed) {
        activeFfmpeg.kill('SIGKILL');
      }
    };
    const unregister = registerActiveStreamConsumer(cleanServer, playbackKey, true, cancelConsumer);
    const detachDisconnect = onClientDisconnect(req, res, cancelConsumer);

    try {
      const port = await ensureXtreamRelayPort();
      getOrUpdateRelayEntry({
        serverId: cleanServer,
        kind,
        id,
        ext: activeExt,
        cfg,
        targetUrl: fastTargetUrl,
      });
      const relayUrl = `http://127.0.0.1:${port}/relay/${cleanServer}/${kind}/${encodeURIComponent(id)}?ext=${encodeURIComponent(activeExt)}`;

      const codecKey = `${cleanServer}:${kind}:${id}:${activeExt}`;
      const cachedCodec = codecSummaryCache.get(codecKey);
      let codecs =
        lowBandwidth && (!cachedCodec || Date.now() >= cachedCodec.expiresAt)
          ? { vcodec: '', acodec: '', durationSeconds: undefined, ranProbe: false }
          : await probeCodecSummaryCached(codecKey, relayUrl);
      if (!lowBandwidth && !codecs.vcodec && !consumerAborted && !req.destroyed) {
        await delayMs(260);
        if (!consumerAborted && !req.destroyed) {
          codecs = await probeCodecSummaryCached(codecKey, relayUrl);
        }
      }
      if (consumerAborted || res.writableEnded || req.destroyed) {
        if (!res.headersSent && !res.writableEnded) {
          res.status(499).end();
        } else if (!res.writableEnded) {
          res.end();
        }
        return;
      }

      const vArgs = lowBandwidth
        ? [
            '-c:v',
            'libx264',
            '-preset',
            'ultrafast',
            '-tune',
            'zerolatency',
            '-crf',
            '27',
            '-maxrate',
            '750k',
            '-bufsize',
            '1500k',
            '-vf',
            "scale='min(854,iw)':-2",
            '-pix_fmt',
            'yuv420p',
          ]
        : codecs.vcodec === 'h264'
          ? ['-c:v', 'copy']
          : [
              '-c:v',
              'libx264',
              '-preset',
              'ultrafast',
              '-tune',
              'zerolatency',
              '-crf',
              '24',
              '-vf',
              "scale='min(1280,iw)':-2",
              '-pix_fmt',
              'yuv420p',
            ];
      const aArgs = lowBandwidth
        ? ['-c:a', 'aac', '-ac', '2', '-b:a', '96k']
        : codecs.acodec === 'aac'
          ? ['-c:a', 'copy']
          : ['-c:a', 'aac', '-ac', '2', '-b:a', '128k'];

      const ssArgs = startSeconds > 0 ? ['-ss', String(startSeconds)] : [];
      const knownDur =
        codecs.durationSeconds ||
        (kind === 'movie'
          ? movieDurationMap.get(`${cleanServer}:${id}`)
          : seriesDurationMap.get(`${cleanServer}:${id}`));

      for (let attempt = 0; attempt < 3; attempt += 1) {
        if (consumerAborted || res.writableEnded || req.destroyed) {
          if (!res.headersSent && !res.writableEnded) res.status(499).end();
          return;
        }
        if (attempt > 0) {
          await delayMs(attempt === 1 ? 350 : 800);
          if (consumerAborted || res.writableEnded || req.destroyed) {
            if (!res.headersSent && !res.writableEnded) res.status(499).end();
            return;
          }
          const refreshed = await resolveDirectCdnTarget(
            cfg,
            cleanServer,
            kind,
            id,
            activeExt,
            true,
          ).catch(() => null);
          if (refreshed?.url) {
            getOrUpdateRelayEntry({
              serverId: cleanServer,
              kind,
              id,
              ext: activeExt,
              cfg,
              targetUrl: refreshed.url,
            });
          }
        }

        const attemptResult = await new Promise<'ok' | 'aborted' | 'retry'>((resolveAttempt) => {
          let settled = false;
          let sentHeaders = false;

          const finish = (outcome: 'ok' | 'aborted' | 'retry') => {
            if (settled) return;
            settled = true;
            resolveAttempt(outcome);
          };

          const proc = spawn('ffmpeg', [
            '-hide_banner',
            '-loglevel',
            'error',
            '-fflags',
            '+nobuffer',
            '-probesize',
            '1000000',
            '-analyzeduration',
            '1000000',
            ...ssArgs,
            '-i',
            relayUrl,
            '-map',
            '0:v:0?',
            '-map',
            '0:a:0?',
            ...vArgs,
            ...aArgs,
            '-movflags',
            'frag_keyframe+empty_moov+default_base_moof',
            '-flush_packets',
            '1',
            '-f',
            'mp4',
            'pipe:1',
          ]);
          activeFfmpeg = proc;

          proc.stdout?.on('data', (chunk: Buffer) => {
            if (consumerAborted || res.writableEnded) return;
            if (!sentHeaders) {
              sentHeaders = true;
              if (knownDur) {
                res.setHeader('X-Stream-Duration-Seconds', String(knownDur));
              }
              res.status(200);
              res.setHeader('Content-Type', 'video/mp4');
              res.setHeader('Cache-Control', 'no-store');
              if (asDownload) {
                res.setHeader(
                  'Content-Disposition',
                  `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encodeURIComponent(downloadFilename)}`,
                );
                res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition, Content-Length');
              }
            }
            res.write(chunk);
          });

          proc.on('error', () => {
            if (consumerAborted) {
              finish('aborted');
            } else if (!sentHeaders) {
              finish('retry');
            } else {
              if (!res.writableEnded) res.end();
              finish('ok');
            }
          });

          proc.on('close', (code) => {
            if (activeFfmpeg === proc) activeFfmpeg = null;
            if (consumerAborted) {
              finish('aborted');
            } else if (!sentHeaders && code !== 0) {
              finish('retry');
            } else {
              if (!sentHeaders && !res.headersSent) {
                res.status(502).json({ error: 'Upstream media stream unavailable' });
              } else if (!res.writableEnded) {
                res.end();
              }
              finish('ok');
            }
          });
        });

        if (attemptResult === 'aborted') {
          if (!res.headersSent && !res.writableEnded) {
            res.status(499).end();
          } else if (!res.writableEnded) {
            res.end();
          }
          return;
        }
        if (attemptResult === 'ok') {
          return;
        }
      }

      if (!res.headersSent && !res.writableEnded) {
        res.status(502).json({ error: 'Upstream media stream unavailable' });
      } else if (!res.writableEnded) {
        res.end();
      }
      return;
    } finally {
      detachDisconnect();
      unregister();
    }
  }

  // Bounded HTTP 206 byte-range passthrough for direct MP4 playback, or full stream for ?download=1
  const cacheKey = `${cleanServer}:${kind}:${id}:${activeExt}`;
  const rawRangeHeader = typeof req.headers.range === 'string' ? req.headers.range : undefined;
  let upstreamUrl = fastTargetUrl;
  let consumerCancelled = false;
  let activeDirectAbort: (() => void) | null = null;
  const cancelDirectConsumer = () => {
    consumerCancelled = true;
    activeDirectAbort?.();
  };
  const unregisterConsumer = registerActiveStreamConsumer(
    cleanServer,
    playbackKey,
    false,
    cancelDirectConsumer,
  );
  const detachDisconnect = onClientDisconnect(req, res, cancelDirectConsumer);

  try {
    await runUpstreamFetchSlot(cleanServer, async (setAbort) => {
      if (consumerCancelled || res.writableEnded || req.destroyed) {
        if (!res.headersSent && !res.writableEnded) res.status(499).end();
        return;
      }

      let upstream: globalThis.Response | null = null;
      for (let attempt = 0; attempt < 4; attempt += 1) {
        if (consumerCancelled || res.writableEnded || req.destroyed) {
          if (!res.headersSent && !res.writableEnded) res.status(499).end();
          return;
        }

        if (attempt > 0) {
          await delayMs(attempt === 1 ? 300 : attempt === 2 ? 700 : 1200);
          if (consumerCancelled || res.writableEnded || req.destroyed) {
            if (!res.headersSent && !res.writableEnded) res.status(499).end();
            return;
          }
          const refreshed = await resolveDirectCdnTarget(
            cfg,
            cleanServer,
            kind,
            id,
            activeExt,
            true,
            true,
          ).catch(() => null);
          if (refreshed?.url) upstreamUrl = refreshed.url;
        }

        const cachedSize = totalSizeCache.get(cacheKey);
        const knownTotalSize =
          cachedSize && Date.now() < cachedSize.expiresAt ? cachedSize.totalSize : null;
        const { start, end } = parseClientByteRange(rawRangeHeader, knownTotalSize);
        const controller = new AbortController();
        const abortFetch = () => controller.abort();
        activeDirectAbort = abortFetch;
        setAbort(abortFetch);

        const fetchHeaders: Record<string, string> = {
          'User-Agent': IPTV_STREAM_UA,
        };
        if (!(asDownload && !rawRangeHeader)) {
          fetchHeaders.Range = `bytes=${start}-${end}`;
        }

        try {
          const candidate = await fetch(upstreamUrl, {
            headers: fetchHeaders,
            redirect: 'follow',
            signal: controller.signal,
          });

          if (candidate.ok || candidate.status === 206) {
            upstream = candidate;
            const totalSize = extractTotalSizeFromContentRange(candidate.headers.get('content-range'));
            if (totalSize !== null) {
              totalSizeCache.set(cacheKey, {
                totalSize,
                expiresAt: Date.now() + 10 * 60 * 1000,
              });
            }
            break;
          }

          cdnUrlCache.delete(cacheKey);
          try {
            await candidate.body?.cancel();
          } catch {
            // ignore
          }

          if (
            candidate.status !== 403 &&
            candidate.status !== 401 &&
            candidate.status !== 406 &&
            candidate.status !== 410 &&
            candidate.status !== 429 &&
            candidate.status !== 503
          ) {
            if (!res.headersSent && !res.writableEnded) {
              res.status(candidate.status || 502).end();
            } else if (!res.writableEnded) {
              res.end();
            }
            return;
          }
        } catch (err) {
          cdnUrlCache.delete(cacheKey);
          if (controller.signal.aborted || consumerCancelled || req.destroyed) {
            if (!res.headersSent && !res.writableEnded) res.status(499).end();
            return;
          }
          if (attempt === 3) {
            if (!res.headersSent && !res.writableEnded) {
              res.status(502).json({ error: err instanceof Error ? err.message : 'Upstream error' });
            } else if (!res.writableEnded) {
              res.end();
            }
            return;
          }
        }
      }

      if (!upstream || consumerCancelled || res.writableEnded || req.destroyed) {
        if (!res.headersSent && !res.writableEnded) {
          res.status(consumerCancelled ? 499 : 503).end();
        } else if (!res.writableEnded) {
          res.end();
        }
        return;
      }

      res.status(upstream.status);
      const ct = upstream.headers.get('content-type') || 'video/mp4';
      res.setHeader('Content-Type', ct.includes('octet-stream') ? 'video/mp4' : ct);
      res.setHeader('Accept-Ranges', 'bytes');
      res.setHeader('Cache-Control', 'no-store');
      if (asDownload) {
        res.setHeader(
          'Content-Disposition',
          `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encodeURIComponent(downloadFilename)}`,
        );
        res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition, Content-Length');
      }
      const len = upstream.headers.get('content-length');
      const range = upstream.headers.get('content-range');
      if (len) res.setHeader('Content-Length', len);
      if (range) res.setHeader('Content-Range', range);

      if (!upstream.body) {
        res.end();
        return;
      }

      await new Promise<void>((resolvePipe) => {
        const nodeStream = Readable.fromWeb(upstream!.body as unknown as NodeReadableStream);
        const cleanupPipe = () => {
          nodeStream.destroy();
          resolvePipe();
        };
        activeDirectAbort = cleanupPipe;
        setAbort(cleanupPipe);
        const detachPipeClose = onClientDisconnect(req, res, cleanupPipe);
        nodeStream.on('error', () => {
          if (!res.headersSent) res.status(502);
          if (!res.writableEnded) res.end();
          detachPipeClose();
          resolvePipe();
        });
        nodeStream.on('end', () => {
          if (!res.writableEnded) res.end();
          detachPipeClose();
          resolvePipe();
        });
        nodeStream.on('close', () => {
          detachPipeClose();
          resolvePipe();
        });
        nodeStream.pipe(res);
      });
    });
  } finally {
    detachDisconnect();
    unregisterConsumer();
  }
}

export async function proxyXtreamImage(targetUrl: string, res: Response): Promise<void> {
  const cfg1 = getXtreamConfig('1');
  const cfg2 = getXtreamConfig('2');
  const allowed =
    isSafeXtreamImageUrl(targetUrl, cfg1?.host || '') ||
    (cfg2 ? isSafeXtreamImageUrl(targetUrl, cfg2.host) : false);

  if (!allowed) {
    res.status(403).json({ error: 'Forbidden image host' });
    return;
  }

  try {
    const upstream = await fetch(targetUrl, {
      headers: { 'User-Agent': DESKTOP_UA },
      signal: AbortSignal.timeout(7000),
    });
    if (!upstream.ok || !upstream.body) {
      res.status(upstream.status || 404).end();
      return;
    }
    const ct = upstream.headers.get('content-type') || 'image/jpeg';
    if (!ct.startsWith('image/')) {
      res.status(415).end();
      return;
    }
    res.status(200);
    res.setHeader('Content-Type', ct);
    res.setHeader('Cache-Control', 'public, max-age=86400');
    const nodeStream = Readable.fromWeb(upstream.body as unknown as NodeReadableStream);
    nodeStream.pipe(res);
  } catch {
    if (!res.headersSent) res.status(502).end();
  }
}
