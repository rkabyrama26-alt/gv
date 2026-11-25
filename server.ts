import dotenv from 'dotenv';
dotenv.config();
if (
  !/^https?:\/\//i.test((process.env.XTREAM_BASE_URL || '').trim()) ||
  !/^https?:\/\//i.test((process.env.XTREAM2_BASE_URL || '').trim())
) {
  dotenv.config({ override: true });
}
import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import type {
  AppLocale,
  DurationFilter,
  SearchType,
  ServerHealthResponse,
  SortOrder,
  TikTokCategory,
  TrendingCategory,
  XtreamServerId,
  XtreamTab,
} from './src/shared/types.ts';
import {
  downloadVideoAsMp4,
  getMediaCacheStats,
  getMediaChannelDetails,
  getMediaVideoDetails,
  getSuggestQueries,
  getTrendingMediaVideos,
  proxyHlsResource,
  resolveVideoPlayback,
  searchMediaVideos,
  streamDirectVideoMp4,
  streamVideoMasterManifest,
  warmMediaEngine,
} from './src/server/mediaService.ts';
import {
  getTikTokFeed,
  proxyTikTokImage,
  searchTikTokReels,
  streamTikTokVideo,
} from './src/server/tiktokService.ts';
import {
  configureXtreamRuntime,
  getXtreamCatalog,
  getXtreamMediaMeta,
  getXtreamMovieDetails,
  getXtreamSeriesDetails,
  normalizeXtreamServerId,
  proxyXtreamImage,
  streamXtreamMedia,
  warmXtreamEngine,
} from './src/server/xtreamService.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PORT = Number.parseInt(process.env.PORT || '3000', 10);
const startedAt = Date.now();

const VALID_SORTS = new Set<SortOrder>(['relevance', 'date', 'views', 'rating']);
const VALID_TYPES = new Set<SearchType>(['all', 'video', 'live', 'short']);
const VALID_DURATIONS = new Set<DurationFilter>(['any', 'short', 'medium', 'long']);
const VALID_CATEGORIES = new Set<TrendingCategory>(['all', 'tech', 'music', 'gaming', 'education', 'news']);
const VALID_TIKTOK_CATEGORIES = new Set<TikTokCategory>(['all', 'comedy', 'gaming', 'sports', 'music', 'food']);

async function startServer() {
  const app = express();
  app.use(express.json());

  app.use('/api', (_req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Range');
    next();
  });

  app.get('/api/health', (_req, res) => {
    const payload: ServerHealthResponse = {
      status: 'ok',
      service: 'Drama Square Media Server',
      uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000),
      cacheEntries: getMediaCacheStats().entries,
    };
    res.json(payload);
  });

  // Independent Video Server Routes
  app.get('/api/videos/trending', async (req, res) => {
    try {
      const catRaw = String(req.query.category || 'all') as TrendingCategory;
      const hl: AppLocale = req.query.hl === 'en' ? 'en' : 'ar';
      const refresh = req.query.refresh === '1' || req.query.refresh === 'true';
      const seedRaw = Number(req.query.seed);
      const seed = Number.isFinite(seedRaw) ? seedRaw : undefined;
      const category = VALID_CATEGORIES.has(catRaw) ? catRaw : 'all';
      const data = await getTrendingMediaVideos(category, hl, { refresh, seed });
      return res.json(data);
    } catch (err) {
      return res.status(500).json({
        error: err instanceof Error ? err.message : 'Trending fetch failed',
      });
    }
  });

  app.get('/api/videos/search', async (req, res) => {
    try {
      const q = String(req.query.q || '').trim();
      const continuation = String(req.query.continuation || '').trim();
      if (!q && !continuation) {
        return res.status(400).json({
          error: 'Missing required query parameter: q',
        });
      }

      const sortRaw = String(req.query.sort || 'relevance') as SortOrder;
      const typeRaw = String(req.query.type || 'all') as SearchType;
      const durationRaw = String(req.query.duration || 'any') as DurationFilter;
      const hl: AppLocale = req.query.hl === 'en' ? 'en' : 'ar';

      const data = await searchMediaVideos({
        query: q,
        sort: VALID_SORTS.has(sortRaw) ? sortRaw : 'relevance',
        type: VALID_TYPES.has(typeRaw) ? typeRaw : 'all',
        duration: VALID_DURATIONS.has(durationRaw) ? durationRaw : 'any',
        continuation: continuation || undefined,
        hl,
      });

      return res.json(data);
    } catch (err) {
      return res.status(500).json({
        error: err instanceof Error ? err.message : 'Search failed',
      });
    }
  });

  app.get('/api/videos/suggest', async (req, res) => {
    try {
      const q = String(req.query.q || '').trim();
      const hl: AppLocale = req.query.hl === 'en' ? 'en' : 'ar';
      const data = await getSuggestQueries(q, hl);
      return res.json(data);
    } catch (err) {
      return res.status(500).json({
        error: err instanceof Error ? err.message : 'Suggest failed',
      });
    }
  });

  app.get('/api/videos/hls', async (req, res) => {
    try {
      const targetUrl = String(req.query.u || '').trim();
      const rangeHeader = typeof req.headers.range === 'string' ? req.headers.range : undefined;
      await proxyHlsResource(targetUrl, rangeHeader, res);
    } catch (err) {
      if (!res.headersSent) {
        res.status(500).json({
          error: err instanceof Error ? err.message : 'Stream proxy failed',
        });
      }
    }
  });

  app.get('/api/videos/item/:id/resolve', async (req, res) => {
    try {
      const id = String(req.params.id || '').trim();
      const hl: AppLocale = req.query.hl === 'en' ? 'en' : 'ar';
      const titleHint = String(req.query.title || '').trim();
      const resolved = await resolveVideoPlayback(id, hl, { titleHint });
      return res.json(resolved);
    } catch (err) {
      return res.json({
        playable: false,
        code: 'RESOLVE_ERROR',
        reason: err instanceof Error ? err.message : 'Stream resolution failed',
      });
    }
  });

  app.get('/api/videos/item/:id/media.mp4', async (req, res) => {
    try {
      const id = String(req.params.id || '').trim();
      await streamDirectVideoMp4(id, req, res);
    } catch (err) {
      if (!res.headersSent) {
        res.status(500).json({
          error: err instanceof Error ? err.message : 'Stream unavailable',
        });
      }
    }
  });

  app.get('/api/videos/item/:id/stream.m3u8', async (req, res) => {
    try {
      const id = String(req.params.id || '').trim();
      await streamVideoMasterManifest(id, res);
    } catch (err) {
      if (!res.headersSent) {
        res.status(500).json({
          error: err instanceof Error ? err.message : 'Stream unavailable',
        });
      }
    }
  });

  app.get('/api/videos/item/:id/download.mp4', async (req, res) => {
    try {
      const id = String(req.params.id || '').trim();
      await downloadVideoAsMp4(id, req, res);
    } catch (err) {
      if (!res.headersSent) {
        res.status(500).json({
          error: err instanceof Error ? err.message : 'MP4 download unavailable',
        });
      }
    }
  });

  app.get('/api/videos/item/:id', async (req, res) => {
    try {
      const id = String(req.params.id || '').trim();
      const hl: AppLocale = req.query.hl === 'en' ? 'en' : 'ar';
      const data = await getMediaVideoDetails(id, hl);
      if (!data) {
        return res.status(404).json({ error: 'Video not found' });
      }
      return res.json(data);
    } catch (err) {
      return res.status(500).json({
        error: err instanceof Error ? err.message : 'Video lookup failed',
      });
    }
  });

  app.get('/api/videos/channel/:id', async (req, res) => {
    try {
      const id = String(req.params.id || '').trim();
      const hl: AppLocale = req.query.hl === 'en' ? 'en' : 'ar';
      const data = await getMediaChannelDetails(id, hl);
      if (!data) {
        return res.status(404).json({ error: 'Channel not found' });
      }
      return res.json(data);
    } catch (err) {
      return res.status(500).json({
        error: err instanceof Error ? err.message : 'Channel lookup failed',
      });
    }
  });

  // Dedicated TikTok Server Routes (Feed + Search + Video/Image Proxy) for Shorts section ONLY
  app.get('/api/tiktok/feed', async (req, res) => {
    try {
      const catRaw = String(req.query.category || 'all') as TikTokCategory;
      const category = VALID_TIKTOK_CATEGORIES.has(catRaw) ? catRaw : 'all';
      const forceRefresh = req.query.refresh === '1' || req.query.refresh === 'true';
      const data = await getTikTokFeed(category, forceRefresh);
      return res.json(data);
    } catch (err) {
      return res.status(500).json({
        error: err instanceof Error ? err.message : 'TikTok server feed failed',
      });
    }
  });

  app.get('/api/tiktok/search', async (req, res) => {
    try {
      const q = String(req.query.q || '').trim();
      const data = await searchTikTokReels(q);
      return res.json(data);
    } catch (err) {
      return res.status(500).json({
        error: err instanceof Error ? err.message : 'TikTok search failed',
      });
    }
  });

  app.get('/api/tiktok/stream/:id', async (req, res) => {
    try {
      const id = String(req.params.id || '').trim();
      const rangeHeader = typeof req.headers.range === 'string' ? req.headers.range : undefined;
      const asDownload = req.query.download === '1';
      await streamTikTokVideo(id, rangeHeader, asDownload, res);
    } catch (err) {
      if (!res.headersSent) {
        res.status(500).json({
          error: err instanceof Error ? err.message : 'TikTok stream failed',
        });
      }
    }
  });

  app.get('/api/tiktok/cover/:id', async (req, res) => {
    const id = String(req.params.id || '').trim();
    await proxyTikTokImage(id, 'cover', res);
  });

  app.get('/api/tiktok/avatar/:id', async (req, res) => {
    const id = String(req.params.id || '').trim();
    await proxyTikTokImage(id, 'avatar', res);
  });

  // Xtream Series & Movies Catalog, Info, Meta, Image & Stream Proxy Routes
  app.get('/api/xtream/catalog', async (req, res) => {
    try {
      const serverId = normalizeXtreamServerId(req.query.server);
      const tab: XtreamTab = req.query.tab === 'movies' ? 'movies' : 'series';
      const categoryId = String(req.query.categoryId || 'all').trim();
      const query = String(req.query.q || '').trim();
      const offsetRaw = Number(req.query.offset);
      const limitRaw = Number(req.query.limit);
      const offset = Number.isFinite(offsetRaw) ? offsetRaw : 0;
      const limit = Number.isFinite(limitRaw) ? limitRaw : 48;
      const data = await getXtreamCatalog({ serverId, tab, categoryId, query, offset, limit });
      return res.json(data);
    } catch (err) {
      return res.status(500).json({
        error: err instanceof Error ? err.message : 'Xtream catalog fetch failed',
      });
    }
  });

  app.get('/api/xtream/series/:id', async (req, res) => {
    try {
      const serverId = normalizeXtreamServerId(req.query.server);
      const id = String(req.params.id || '').trim();
      const data = await getXtreamSeriesDetails(id, serverId);
      if (!data) {
        return res.status(404).json({ error: 'Series not found' });
      }
      return res.json(data);
    } catch (err) {
      return res.status(500).json({
        error: err instanceof Error ? err.message : 'Series details fetch failed',
      });
    }
  });

  app.get('/api/xtream/vod/:id', async (req, res) => {
    try {
      const serverId = normalizeXtreamServerId(req.query.server);
      const id = String(req.params.id || '').trim();
      const data = await getXtreamMovieDetails(id, serverId);
      if (!data) {
        return res.status(404).json({ error: 'Movie not found' });
      }
      return res.json(data);
    } catch (err) {
      return res.status(500).json({
        error: err instanceof Error ? err.message : 'Movie details fetch failed',
      });
    }
  });

  app.get('/api/xtream/meta/:kind/:id', async (req, res) => {
    try {
      const rawKind = String(req.params.kind || '').trim();
      if (rawKind !== 'movie' && rawKind !== 'series') {
        return res.status(400).json({ error: 'Invalid Xtream media kind' });
      }
      const serverId = normalizeXtreamServerId(req.query.server);
      const id = String(req.params.id || '').trim();
      const meta = await getXtreamMediaMeta(rawKind, id, serverId);
      if (!meta) {
        return res.status(404).json({ error: 'Media metadata unavailable' });
      }
      return res.json(meta);
    } catch (err) {
      return res.status(500).json({
        error: err instanceof Error ? err.message : 'Media metadata fetch failed',
      });
    }
  });

  app.get('/api/xtream/stream/:kind/:id', async (req, res) => {
    try {
      const rawKind = String(req.params.kind || '').trim();
      if (rawKind !== 'movie' && rawKind !== 'series') {
        return res.status(400).json({ error: 'Invalid Xtream stream kind' });
      }
      const serverId: XtreamServerId = normalizeXtreamServerId(req.query.server);
      const id = String(req.params.id || '').trim();
      await streamXtreamMedia(rawKind, id, req, res, serverId);
    } catch (err) {
      if (!res.headersSent) {
        res.status(500).json({
          error: err instanceof Error ? err.message : 'Xtream stream failed',
        });
      }
    }
  });

  app.post('/api/xtream/configure', async (req, res) => {
    try {
      const serverId = normalizeXtreamServerId(req.body?.serverId ?? req.query.server);
      const baseUrl = String(req.body?.baseUrl || '').trim();
      const username = String(req.body?.username || '').trim();
      const password = String(req.body?.password || '').trim();
      const result = await configureXtreamRuntime(baseUrl, username, password, serverId);
      if (!result.ok) {
        return res.status(result.status).json({ error: result.error });
      }
      return res.json({ configured: true });
    } catch (err) {
      return res.status(500).json({
        error: err instanceof Error ? err.message : 'Failed to configure Xtream server',
      });
    }
  });

  app.get('/api/xtream/image', async (req, res) => {
    const targetUrl = String(req.query.u || '').trim();
    await proxyXtreamImage(targetUrl, res);
  });

  const isProd = process.env.NODE_ENV === 'production';
  const distDir = path.resolve(__dirname, 'dist');

  if (!isProd) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else if (fs.existsSync(distDir)) {
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Drama Square Server listening on http://0.0.0.0:${PORT}`);
    warmMediaEngine();
    warmXtreamEngine();
  });
}

startServer();