const API_BASE_STORAGE_KEY = 'dramasquare_api_base_v1';

export function normalizeApiBaseUrl(raw: string | null | undefined): string {
  const clean = (raw || '').trim();
  if (!clean) return '';
  try {
    const parsed = new URL(clean);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return '';
    }
    return parsed.origin + parsed.pathname.replace(/\/+$/, '');
  } catch {
    return '';
  }
}

export function getConfiguredApiBaseUrl(): string {
  const viteMeta = import.meta as unknown as { env?: Record<string, string | undefined> };
  const fromEnv = normalizeApiBaseUrl(viteMeta.env?.VITE_API_BASE_URL);
  if (fromEnv) return fromEnv;

  if (typeof window === 'undefined') return '';
  try {
    const params = new URLSearchParams(window.location.search);
    const fromQuery = normalizeApiBaseUrl(params.get('api'));
    if (fromQuery) {
      window.localStorage.setItem(API_BASE_STORAGE_KEY, fromQuery);
      return fromQuery;
    }
    const fromStorage = normalizeApiBaseUrl(window.localStorage.getItem(API_BASE_STORAGE_KEY));
    if (fromStorage) return fromStorage;
  } catch {
    // ignore storage/url errors
  }
  return '';
}

export function saveConfiguredApiBaseUrl(rawUrl: string): string {
  const normalized = normalizeApiBaseUrl(rawUrl);
  if (typeof window !== 'undefined') {
    try {
      if (normalized) {
        window.localStorage.setItem(API_BASE_STORAGE_KEY, normalized);
      } else {
        window.localStorage.removeItem(API_BASE_STORAGE_KEY);
      }
    } catch {
      // ignore storage errors
    }
  }
  return normalized;
}

export function resolveApiUrl(path: string, configuredBase?: string): string {
  const base =
    configuredBase !== undefined
      ? normalizeApiBaseUrl(configuredBase)
      : getConfiguredApiBaseUrl();
  if (!base) return path;
  if (/^https?:\/\//i.test(path)) return path;
  const cleanPath = path.startsWith('/') ? path : `/${path}`;
  return `${base}${cleanPath}`;
}

export function isStaticHostEnvironment(hostname?: string): boolean {
  const host =
    hostname !== undefined
      ? hostname.toLowerCase()
      : typeof window !== 'undefined'
        ? window.location.hostname.toLowerCase()
        : '';
  return (
    host.endsWith('.github.io') ||
    host === 'github.io' ||
    host.endsWith('.pages.dev') ||
    host.endsWith('.netlify.app')
  );
}
