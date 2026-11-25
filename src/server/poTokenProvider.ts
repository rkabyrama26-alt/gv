import { BotGuardClient, getChallenge } from 'bgutils-js/botguard';
import { createColdStartToken, WebPoMinter } from 'bgutils-js/webpo';
import { buildURL, getHeaders } from 'bgutils-js/utils';
import { JSDOM } from 'jsdom';
import { Innertube } from 'youtubei.js';

export type YouTubeClientKey =
  | 'ANDROID'
  | 'IOS'
  | 'ANDROID_VR'
  | 'TV'
  | 'MWEB'
  | 'WEB';

export interface YouTubeClientSignature {
  key: YouTubeClientKey;
  clientName: string;
  clientNameId: string;
  clientVersion: string;
  userAgent: string;
  origin?: string;
  referer?: string;
  deviceMake?: string;
  deviceModel?: string;
  osName?: string;
  osVersion?: string;
  androidSdkVersion?: number;
}

export const YOUTUBE_CLIENT_SIGNATURES: Record<YouTubeClientKey, YouTubeClientSignature> = {
  ANDROID: {
    key: 'ANDROID',
    clientName: 'ANDROID',
    clientNameId: '3',
    clientVersion: '21.03.36',
    userAgent:
      'com.google.android.youtube/21.03.36(Linux; U; Android 16; en_US; SM-S908E Build/TP1A.220624.014) gzip',
    deviceMake: 'samsung',
    deviceModel: 'SM-S908E',
    osName: 'Android',
    osVersion: '16',
    androidSdkVersion: 36,
  },
  IOS: {
    key: 'IOS',
    clientName: 'IOS',
    clientNameId: '5',
    clientVersion: '20.11.6',
    userAgent: 'com.google.ios.youtube/20.11.6 (iPhone10,4; U; CPU iOS 16_7_7 like Mac OS X)',
    deviceMake: 'Apple',
    deviceModel: 'iPhone10,4',
    osName: 'iOS',
    osVersion: '16.7.7.20H330',
  },
  ANDROID_VR: {
    key: 'ANDROID_VR',
    clientName: 'ANDROID_VR',
    clientNameId: '28',
    clientVersion: '1.65.10',
    userAgent:
      'com.google.android.apps.youtube.vr.oculus/1.65.10 (Linux; U; Android 12L; eureka-user Build/SQ3A.220605.009.A1) gzip',
    deviceMake: 'Oculus',
    deviceModel: 'Quest 3',
    osName: 'Android',
    osVersion: '12L',
    androidSdkVersion: 32,
  },
  TV: {
    key: 'TV',
    clientName: 'TVHTML5',
    clientNameId: '7',
    clientVersion: '7.20260311.12.00',
    userAgent: 'Mozilla/5.0 (ChromiumStylePlatform) Cobalt/Version',
    origin: 'https://www.youtube.com',
    referer: 'https://www.youtube.com/tv',
  },
  MWEB: {
    key: 'MWEB',
    clientName: 'MWEB',
    clientNameId: '2',
    clientVersion: '2.20260623.01.00',
    userAgent:
      'Mozilla/5.0 (Linux; Android 16; SM-S908E) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Mobile Safari/537.36',
    origin: 'https://m.youtube.com',
    referer: 'https://m.youtube.com/',
  },
  WEB: {
    key: 'WEB',
    clientName: 'WEB',
    clientNameId: '1',
    clientVersion: '2.20260623.01.00',
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36',
    origin: 'https://www.youtube.com',
    referer: 'https://www.youtube.com/',
  },
};

export interface PoTokenSession {
  visitorData: string;
  sessionPoToken: string;
  contentPoToken: string;
  isColdStart: boolean;
  expiresAt: number;
}

const REQUEST_KEY = 'O43z0dpjhgX20SCx4KAo';
const SESSION_TTL_MS = 3 * 60 * 60 * 1000;

interface CachedMinterState {
  visitorData: string;
  sessionPoToken: string;
  minter: WebPoMinter;
  expiresAt: number;
}

let cachedState: CachedMinterState | null = null;
let inFlightSession: Promise<CachedMinterState | null> | null = null;
let domInitialized = false;

function ensureBotGuardDom(): void {
  if (domInitialized || typeof window !== 'undefined') return;
  const dom = new JSDOM('<!doctype html><html><body></body></html>', {
    url: 'https://www.youtube.com/',
    pretendToBeVisual: true,
  });
  Object.assign(globalThis, {
    window: dom.window,
    document: dom.window.document,
    HTMLElement: dom.window.HTMLElement,
    getComputedStyle: dom.window.getComputedStyle.bind(dom.window),
    requestAnimationFrame:
      dom.window.requestAnimationFrame?.bind(dom.window) ||
      ((cb: FrameRequestCallback) => setTimeout(() => cb(Date.now()), 16)),
    matchMedia:
      dom.window.matchMedia?.bind(dom.window) ||
      (() => ({ matches: false, addListener: () => {}, removeListener: () => {} })),
  });
  domInitialized = true;
}

async function mintBotGuardState(): Promise<CachedMinterState | null> {
  try {
    ensureBotGuardDom();

    const bareClient = await Innertube.create({
      retrieve_player: false,
      generate_session_locally: true,
    });
    const visitorData = bareClient.session.context.client.visitorData || '';
    if (!visitorData) return null;

    const challenge = await getChallenge({
      requestKey: REQUEST_KEY,
      fetchFunction: fetch,
    });
    const interp =
      challenge.interpreterJavascript?.privateDoNotAccessOrElseSafeScriptWrappedValue;
    if (interp) {
      new Function(interp)();
    }

    const bg = await BotGuardClient.create({
      globalName: challenge.globalName,
      globalObject: globalThis,
      program: challenge.program,
    });

    const webPoSignalOutput: Parameters<typeof WebPoMinter.create>[1] = [];
    const bgResponse = await bg.snapshot({ webPoSignalOutput });

    const itRes = await fetch(buildURL('GenerateIT', false), {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify([REQUEST_KEY, bgResponse]),
    });
    if (!itRes.ok) return null;

    const itJson = (await itRes.json()) as [
      string | undefined,
      number | undefined,
      number | undefined,
      string | undefined,
    ];
    const [integrityToken, estimatedTtlSecs, mintRefreshThreshold, websafeFallbackToken] = itJson;
    if (!integrityToken && !websafeFallbackToken) return null;

    const minter = await WebPoMinter.create(
      { integrityToken, estimatedTtlSecs, mintRefreshThreshold, websafeFallbackToken },
      webPoSignalOutput,
    );

    const sessionPoToken = await minter.mintAsWebsafeString(visitorData);
    const ttlMs =
      typeof estimatedTtlSecs === 'number' && estimatedTtlSecs > 300
        ? Math.min(SESSION_TTL_MS, Math.floor((estimatedTtlSecs - 120) * 1000))
        : SESSION_TTL_MS;

    const state: CachedMinterState = {
      visitorData,
      sessionPoToken,
      minter,
      expiresAt: Date.now() + ttlMs,
    };
    cachedState = state;
    return state;
  } catch {
    return null;
  }
}

export async function getPoTokenSession(videoId?: string): Promise<PoTokenSession> {
  const now = Date.now();
  if (!cachedState || cachedState.expiresAt <= now) {
    if (!inFlightSession) {
      inFlightSession = mintBotGuardState().finally(() => {
        inFlightSession = null;
      });
    }
    await inFlightSession;
  }

  if (cachedState && cachedState.expiresAt > Date.now()) {
    let contentPoToken = cachedState.sessionPoToken;
    if (videoId) {
      try {
        contentPoToken = await cachedState.minter.mintAsWebsafeString(videoId);
      } catch {
        contentPoToken = cachedState.sessionPoToken;
      }
    }
    return {
      visitorData: cachedState.visitorData,
      sessionPoToken: cachedState.sessionPoToken,
      contentPoToken,
      isColdStart: false,
      expiresAt: cachedState.expiresAt,
    };
  }

  // Deterministic cold-start fallback if WAA API is temporarily unavailable
  const fallbackVisitor = `Cgt${Buffer.from(videoId || 'DramaSquare').toString('base64url').slice(0, 12)}`;
  const coldSession = createColdStartToken(fallbackVisitor);
  const coldContent = videoId ? createColdStartToken(videoId) : coldSession;
  return {
    visitorData: fallbackVisitor,
    sessionPoToken: coldSession,
    contentPoToken: coldContent,
    isColdStart: true,
    expiresAt: Date.now() + 5 * 60 * 1000,
  };
}

export function detectYouTubeClientFromUrl(
  targetUrl: string,
  fallbackClient: YouTubeClientKey = 'ANDROID',
): YouTubeClientKey {
  try {
    const parsed = new URL(targetUrl);
    const c = (parsed.searchParams.get('c') || '').trim().toUpperCase();
    if (c === 'ANDROID') return 'ANDROID';
    if (c === 'IOS') return 'IOS';
    if (c === 'ANDROID_VR') return 'ANDROID_VR';
    if (c.startsWith('TV')) return 'TV';
    if (c === 'MWEB') return 'MWEB';
    if (c === 'WEB' || c === 'WEB_EMBEDDED_PLAYER') return 'WEB';
  } catch {
    // fallback below
  }
  return fallbackClient;
}

export function getClientHeadersForStreamUrl(
  targetUrl: string,
  fallbackClient: YouTubeClientKey = 'ANDROID',
): Record<string, string> {
  const clientKey = detectYouTubeClientFromUrl(targetUrl, fallbackClient);
  const sig = YOUTUBE_CLIENT_SIGNATURES[clientKey];
  const headers: Record<string, string> = {
    'User-Agent': sig.userAgent,
  };
  if (sig.origin) headers.Origin = sig.origin;
  if (sig.referer) headers.Referer = sig.referer;
  return headers;
}

export function appendPoTokenToStreamUrl(rawUrl: string, poToken?: string): string {
  if (!poToken) return rawUrl;
  try {
    const parsed = new URL(rawUrl);
    const host = parsed.hostname.toLowerCase();
    if (host !== 'googlevideo.com' && !host.endsWith('.googlevideo.com')) {
      return rawUrl;
    }
    if (!parsed.searchParams.has('pot')) {
      parsed.searchParams.set('pot', poToken);
    }
    return parsed.toString();
  } catch {
    return rawUrl;
  }
}
