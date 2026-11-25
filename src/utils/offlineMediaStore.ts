import type { MediaVideo } from '../shared/types.ts';
import { buildDirectDownloadUrl } from './shareVideo.ts';

const DB_NAME = 'dramasquare_offline_media_v1';
const DB_VERSION = 1;
const STORE_NAME = 'mediaFiles';

interface StoredMediaRecord {
  id: string;
  videoBlob: Blob;
  thumbnailBlob?: Blob;
  mimeType: string;
  sizeBytes: number;
  downloadedAt: number;
}

export interface OfflineMediaPlayback {
  videoUrl: string;
  thumbnailUrl?: string;
  sizeBytes: number;
}

export interface DownloadProgressInfo {
  loadedBytes: number;
  totalBytes: number | null;
  percent: number | null;
}

function openOfflineDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB is unavailable'));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('Failed to open offline storage'));
  });
}

async function putOfflineRecord(record: StoredMediaRecord): Promise<void> {
  const db = await openOfflineDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(record);
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error || new Error('Failed to store offline media'));
    };
  });
}

async function getOfflineRecord(id: string): Promise<StoredMediaRecord | null> {
  try {
    const db = await openOfflineDb();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const req = tx.objectStore(STORE_NAME).get(id);
      req.onsuccess = () => {
        db.close();
        resolve((req.result as StoredMediaRecord | undefined) || null);
      };
      req.onerror = () => {
        db.close();
        reject(req.error);
      };
    });
  } catch {
    return null;
  }
}

export async function deleteOfflineVideoBlob(id: string): Promise<void> {
  try {
    const db = await openOfflineDb();
    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).delete(id);
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => {
        db.close();
        resolve();
      };
    });
  } catch {
    // ignore cleanup failures
  }
}

export async function listOfflineVideoIds(): Promise<Set<string>> {
  try {
    const db = await openOfflineDb();
    return await new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const req = tx.objectStore(STORE_NAME).getAllKeys();
      req.onsuccess = () => {
        db.close();
        const keys = Array.isArray(req.result) ? req.result.map(String) : [];
        resolve(new Set(keys));
      };
      req.onerror = () => {
        db.close();
        resolve(new Set());
      };
    });
  } catch {
    return new Set();
  }
}

export async function getOfflineVideoMedia(id: string): Promise<OfflineMediaPlayback | null> {
  const record = await getOfflineRecord(id);
  if (!record || !(record.videoBlob instanceof Blob) || record.videoBlob.size === 0) {
    return null;
  }
  const videoUrl = URL.createObjectURL(record.videoBlob);
  const thumbnailUrl =
    record.thumbnailBlob instanceof Blob && record.thumbnailBlob.size > 0
      ? URL.createObjectURL(record.thumbnailBlob)
      : undefined;
  return {
    videoUrl,
    thumbnailUrl,
    sizeBytes: record.sizeBytes || record.videoBlob.size,
  };
}

async function fetchThumbnailBlob(thumbnailUrl: string): Promise<Blob | undefined> {
  if (!thumbnailUrl) return undefined;
  try {
    const res = await fetch(thumbnailUrl);
    if (!res.ok) return undefined;
    const blob = await res.blob();
    return blob.size > 0 ? blob : undefined;
  } catch {
    return undefined;
  }
}

export async function downloadAndSaveVideoOffline(
  video: MediaVideo,
  onProgress?: (info: DownloadProgressInfo) => void,
  signal?: AbortSignal,
): Promise<{ sizeBytes: number }> {
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const downloadUrl = buildDirectDownloadUrl(video, origin);

  const response = await fetch(downloadUrl, { signal });
  if (!response.ok) {
    throw new Error(`Download failed (${response.status})`);
  }

  const contentLengthHeader = response.headers.get('content-length');
  const totalBytes = contentLengthHeader ? Number.parseInt(contentLengthHeader, 10) || null : null;

  let videoBlob: Blob;

  if (response.body) {
    const reader = response.body.getReader();
    const chunks: Uint8Array<ArrayBuffer>[] = [];
    let loadedBytes = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        const copy = new Uint8Array(value.byteLength);
        copy.set(value);
        chunks.push(copy);
        loadedBytes += value.byteLength;
        onProgress?.({
          loadedBytes,
          totalBytes,
          percent: totalBytes ? Math.min(99, Math.round((loadedBytes / totalBytes) * 100)) : null,
        });
      }
    }

    videoBlob = new Blob(chunks, { type: response.headers.get('content-type') || 'video/mp4' });
  } else {
    videoBlob = await response.blob();
  }

  if (videoBlob.size === 0) {
    throw new Error('Downloaded file is empty');
  }

  onProgress?.({
    loadedBytes: videoBlob.size,
    totalBytes: videoBlob.size,
    percent: 100,
  });

  const thumbnailBlob = await fetchThumbnailBlob(video.thumbnail);

  await putOfflineRecord({
    id: video.id,
    videoBlob,
    thumbnailBlob,
    mimeType: videoBlob.type || 'video/mp4',
    sizeBytes: videoBlob.size,
    downloadedAt: Date.now(),
  });

  return { sizeBytes: videoBlob.size };
}
