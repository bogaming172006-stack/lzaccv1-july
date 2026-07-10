import { Party, Transaction, DashboardSummary, Product, CacheVersions } from '../types';
import { db, doc, getDoc } from '../firebase';

// Simple in-memory storage for non-persistent caching
const memoryCache = new Map<string, Map<string, any>>();

function getStore(storeName: string): Map<string, any> {
  let store = memoryCache.get(storeName);
  if (!store) {
    store = new Map<string, any>();
    memoryCache.set(storeName, store);
  }
  return store;
}

export async function getCacheItem<T>(storeName: string, id: string): Promise<T | null> {
  const store = getStore(storeName);
  if (store.has(id)) {
    return store.get(id) as T;
  }
  try {
    const snap = await getDoc(doc(db, storeName, id));
    if (snap.exists()) {
      const data = snap.data() as T;
      store.set(id, data);
      return data;
    }
  } catch (err) {
    console.error(`Error fetching real-time database item for ${storeName}/${id}:`, err);
  }
  return null;
}

export async function setCacheItem<T>(storeName: string, item: T): Promise<void> {
  const store = getStore(storeName);
  if (item && typeof item === 'object' && 'id' in item) {
    store.set((item as any).id, item);
  }
}

export async function bulkSetCacheItems<T>(storeName: string, items: T[]): Promise<void> {
  const store = getStore(storeName);
  items.forEach(item => {
    if (item && typeof item === 'object' && 'id' in item) {
      store.set((item as any).id, item);
    }
  });
}

export async function clearCacheStore(storeName: string): Promise<void> {
  const store = getStore(storeName);
  store.clear();
}

export async function getAllCacheItems<T>(storeName: string): Promise<T[]> {
  const store = getStore(storeName);
  return Array.from(store.values()) as T[];
}

export async function getFilteredCacheItems<T>(
  storeName: string,
  filterFn: (item: T) => boolean
): Promise<T[]> {
  const items = await getAllCacheItems<T>(storeName);
  return items.filter(filterFn);
}

export async function getCacheVersion(ledgerId: string): Promise<CacheVersions | null> {
  const store = getStore('cache_versions');
  return store.get(ledgerId) || null;
}

export async function setCacheVersion(version: CacheVersions): Promise<void> {
  const store = getStore('cache_versions');
  store.set(version.id, version);
}

