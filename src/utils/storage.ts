import { HolidayItem, ProjectModel } from '../types/schedule';

const IDB_NAME = 'npi_schedule_storage_v1';
const IDB_VERSION = 1;
const STORE_NAME = 'kv';

export const STORAGE_KEY_PROJECTS = 'npi_schedule_projects_v2';
export const STORAGE_KEY_HOLIDAYS = 'npi_schedule_holidays_v2';
export const STORAGE_KEY_TW_SEED = 'npi_tw_holidays_seeded_2023_2033_v1';
export const STORAGE_KEY_FACTORY_CLEANUP = 'npi_clear_sample_factory_off_v1';
export const STORAGE_KEY_SAMPLE_PROJECTS_CLEANUP = 'npi_clear_default_sample_projects_v1';

export interface StorageDiagnostics {
  backend: 'IndexedDB + 本機快取' | 'localStorage 本機快取';
  persisted: boolean | null;
  usageBytes: number | null;
  quotaBytes: number | null;
  projectsSizeBytes: number;
  holidaysSizeBytes: number;
}

function openDatabase(): Promise<IDBDatabase | null> {
  if (typeof window === 'undefined' || !('indexedDB' in window)) {
    return Promise.resolve(null);
  }
  return new Promise((resolve) => {
    try {
      const request = window.indexedDB.open(IDB_NAME, IDB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME);
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
      request.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

async function idbGet<T>(key: string): Promise<T | undefined> {
  const db = await openDatabase();
  if (!db) return undefined;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.get(key);
      req.onsuccess = () => resolve(req.result as T | undefined);
      req.onerror = () => resolve(undefined);
      tx.oncomplete = () => db.close();
      tx.onerror = () => db.close();
    } catch {
      db.close();
      resolve(undefined);
    }
  });
}

async function idbSet<T>(key: string, value: T): Promise<boolean> {
  const db = await openDatabase();
  if (!db) return false;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      store.put(value, key);
      tx.oncomplete = () => {
        db.close();
        resolve(true);
      };
      tx.onerror = () => {
        db.close();
        resolve(false);
      };
      tx.onabort = () => {
        db.close();
        resolve(false);
      };
    } catch {
      db.close();
      resolve(false);
    }
  });
}

export async function requestPersistentStorage(): Promise<boolean | null> {
  try {
    if (typeof navigator === 'undefined' || !navigator.storage?.persist) {
      return null;
    }
    const already = navigator.storage.persisted
      ? await navigator.storage.persisted()
      : false;
    if (already) return true;
    return await navigator.storage.persist();
  } catch {
    return null;
  }
}

export async function loadPersistedProjects(): Promise<unknown[] | null> {
  const fromIdb = await idbGet<unknown[]>(STORAGE_KEY_PROJECTS);
  if (Array.isArray(fromIdb)) {
    return fromIdb;
  }
  return null;
}

export async function loadPersistedHolidays(): Promise<HolidayItem[] | null> {
  const fromIdb = await idbGet<HolidayItem[]>(STORAGE_KEY_HOLIDAYS);
  if (Array.isArray(fromIdb)) {
    return fromIdb;
  }
  return null;
}

export async function savePersistedProjects(
  projects: ProjectModel[]
): Promise<{ idbSaved: boolean; localSaved: boolean }> {
  const idbSaved = await idbSet(STORAGE_KEY_PROJECTS, projects);
  let localSaved = false;
  try {
    localStorage.setItem(STORAGE_KEY_PROJECTS, JSON.stringify(projects));
    localSaved = true;
  } catch {
    // localStorage may hit ~5MB limit when there are many projects;
    // IndexedDB holds hundreds of MBs to GBs safely.
    localSaved = false;
  }
  return { idbSaved, localSaved };
}

export async function savePersistedHolidays(
  holidays: HolidayItem[]
): Promise<{ idbSaved: boolean; localSaved: boolean }> {
  const idbSaved = await idbSet(STORAGE_KEY_HOLIDAYS, holidays);
  let localSaved = false;
  try {
    localStorage.setItem(STORAGE_KEY_HOLIDAYS, JSON.stringify(holidays));
    localSaved = true;
  } catch {
    localSaved = false;
  }
  return { idbSaved, localSaved };
}

export async function getStorageDiagnostics(
  projects: ProjectModel[],
  holidays: HolidayItem[]
): Promise<StorageDiagnostics> {
  const hasIdb = typeof window !== 'undefined' && 'indexedDB' in window;
  let persisted: boolean | null = null;
  let usageBytes: number | null = null;
  let quotaBytes: number | null = null;

  try {
    if (typeof navigator !== 'undefined' && navigator.storage) {
      if (navigator.storage.persisted) {
        persisted = await navigator.storage.persisted();
      }
      if (navigator.storage.estimate) {
        const est = await navigator.storage.estimate();
        usageBytes = typeof est.usage === 'number' ? est.usage : null;
        quotaBytes = typeof est.quota === 'number' ? est.quota : null;
      }
    }
  } catch {
    // ignore estimate errors
  }

  const encoder = new TextEncoder();
  const projectsSizeBytes = encoder.encode(JSON.stringify(projects)).length;
  const holidaysSizeBytes = encoder.encode(JSON.stringify(holidays)).length;

  return {
    backend: hasIdb ? 'IndexedDB + 本機快取' : 'localStorage 本機快取',
    persisted,
    usageBytes,
    quotaBytes,
    projectsSizeBytes,
    holidaysSizeBytes,
  };
}

export function formatBytesHuman(bytes: number | null): string {
  if (bytes === null || !Number.isFinite(bytes)) return '未知';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}
