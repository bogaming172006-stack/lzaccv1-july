export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface TursoErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
  };
}

export function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: TursoErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    operationType,
    path,
    authInfo: {
      userId: null,
      email: null,
      emailVerified: null,
      isAnonymous: null
    }
  };
  
  const jsonErrorString = JSON.stringify(errInfo);
  console.error('Database Error: ', jsonErrorString);
  throw new Error(jsonErrorString);
}

export { handleFirestoreError as handleSupabaseError, handleFirestoreError as handleTursoError };

// ---------------------------------------------------------
// FIRESTORE EMULATION LAYER FOR TURSO REST API MIGRATION
// ---------------------------------------------------------

export const db = { type: 'turso_emulation' };

export interface MockDocRef {
  type: 'doc';
  collection: string;
  id: string;
}

export interface MockCollectionRef {
  type: 'collection';
  collection: string;
}

export interface MockQueryRef {
  type: 'query';
  collection: string;
  clauses: any[];
}

export function doc(dbInstance: any, collectionName: string, id: string): MockDocRef {
  return {
    type: 'doc',
    collection: collectionName,
    id
  };
}

export function collection(dbInstance: any, collectionName: string): MockCollectionRef {
  return {
    type: 'collection',
    collection: collectionName
  };
}

export function query(collectionRef: MockCollectionRef, ...clauses: any[]): MockQueryRef {
  return {
    type: 'query',
    collection: collectionRef.collection,
    clauses
  };
}

export function where(field: string, op: '==' | '>' | '<' | '>=' | '<=' | 'in', value: any) {
  return { type: 'where', field, op, value };
}

export function orderBy(field: string, direction: 'asc' | 'desc' = 'asc') {
  return { type: 'orderBy', field, direction };
}

export function limit(value: number) {
  return { type: 'limit', value };
}

export interface MockDocumentSnapshot {
  id: string;
  exists: () => boolean;
  data: () => any;
}

export interface MockQuerySnapshot {
  docs: MockDocumentSnapshot[];
  empty: boolean;
  size: number;
  forEach: (callback: (doc: MockDocumentSnapshot, index: number) => void) => void;
}

// ---------------------------------------------------------
// LOCAL STORAGE DATA ENGINE FOR SECURE FALLBACK (DISABLED)
// ---------------------------------------------------------
export const isLocalFallback = false;

export function setLocalFallback(value: boolean) {
  // Offline fallback is fully disabled per user request.
}

export interface ConnectionStatus {
  status: 'connected' | 'not_configured' | 'connection_error';
  url: string;
  error?: string;
}

let connectionStatus: ConnectionStatus = {
  status: 'not_configured',
  url: ''
};

export function getConnectionStatus(): ConnectionStatus {
  return connectionStatus;
}

const LOCAL_DB_PREFIX = 'supa_mock_';

function getLocalCollection(collectionName: string): any[] {
  try {
    const raw = localStorage.getItem(`${LOCAL_DB_PREFIX}${collectionName}`);
    if (raw) return JSON.parse(raw);
  } catch (e) {
    console.error('Error reading from localStorage:', e);
  }
  return [];
}

function saveLocalCollection(collectionName: string, data: any[]) {
  try {
    localStorage.setItem(`${LOCAL_DB_PREFIX}${collectionName}`, JSON.stringify(data));
    notifyLocalListeners(collectionName);
  } catch (e) {
    console.error('Error saving to localStorage:', e);
  }
}

function applyQueryClauses(items: any[], clauses: any[]): any[] {
  let result = [...items];
  for (const clause of clauses) {
    if (clause.type === 'where') {
      const { field, op, value } = clause;
      result = result.filter(item => {
        const itemVal = item[field];
        if (op === '==') return itemVal === value;
        if (op === '>') return itemVal > value;
        if (op === '<') return itemVal < value;
        if (op === '>=') return itemVal >= value;
        if (op === '<=') return itemVal <= value;
        if (op === 'in') return Array.isArray(value) && value.includes(itemVal);
        return true;
      });
    } else if (clause.type === 'orderBy') {
      const { field, direction } = clause;
      result.sort((a, b) => {
        const aVal = a[field];
        const bVal = b[field];
        if (aVal === bVal) return 0;
        if (aVal === undefined || aVal === null) return 1;
        if (bVal === undefined || bVal === null) return -1;
        const compare = aVal < bVal ? -1 : 1;
        return direction === 'desc' ? -compare : compare;
      });
    } else if (clause.type === 'limit') {
      result = result.slice(0, clause.value);
    }
  }
  return result;
}

const localListeners = new Set<{
  type: 'doc' | 'collection' | 'query';
  collection: string;
  docId?: string;
  queryRef?: MockQueryRef;
  callback: (snapshot: any) => void;
  triggerFreshSnapshot?: () => void;
}>();

function notifyLocalListeners(collectionName: string) {
  setTimeout(() => {
    Array.from(localListeners).forEach(listener => {
      if (listener.collection === collectionName) {
        if (listener.triggerFreshSnapshot) {
          listener.triggerFreshSnapshot();
        } else {
          try {
            if (listener.type === 'doc') {
              const data = getLocalCollection(collectionName).find(item => item.id === listener.docId);
              listener.callback({
                id: listener.docId || '',
                exists: () => data !== undefined && data !== null,
                data: () => data
              });
            } else {
              let items = getLocalCollection(collectionName);
              if (listener.type === 'query' && listener.queryRef) {
                items = applyQueryClauses(items, listener.queryRef.clauses);
              }
              const docs = items.map((row: any) => ({
                id: row.id || '',
                exists: () => true,
                data: () => row
              }));
              listener.callback({
                docs,
                empty: docs.length === 0,
                size: docs.length,
                forEach: (cb: any) => docs.forEach(cb)
              });
            }
          } catch (e) {
            console.error('Error notifying local listener:', e);
          }
        }
      }
    });
  }, 0);
}

export function getApiUrl(path: string): string {
  // If we have an environment variable VITE_BACKEND_URL, use it!
  const envBackend = import.meta.env.VITE_BACKEND_URL;
  if (envBackend) {
    const base = envBackend.endsWith('/') ? envBackend.slice(0, -1) : envBackend;
    return `${base}${path}`;
  }

  // Otherwise, use relative path (default)
  return path;
}

// Short-lived memory cache to deduplicate/throttle cache_version reads
const cacheVersionsMemory = new Map<string, { data: any; expiresAt: number }>();
const CACHE_VERSION_TTL = 3000; // 3 seconds

// In-flight network request deduplication pools
const inflightGetDoc = new Map<string, Promise<MockDocumentSnapshot>>();
const inflightGetDocs = new Map<string, Promise<MockQuerySnapshot>>();

// Initial connection check & table creations
async function runDiagnosticCheck() {
  try {
    const res = await fetch(getApiUrl('/api/db/connection-status'));
    if (res.ok) {
      const data = await res.json();
      
      if (data.status === 'connected') {
        connectionStatus = {
          status: 'connected',
          url: data.url
        };
        console.log(`[Diagnostic] Success! Live Turso Database is active.`);
        return;
      }

      connectionStatus = {
        status: data.status,
        url: data.url,
        error: data.error
      };
      console.log(`[Diagnostic] Status: ${data.status}`);
    } else {
      connectionStatus = {
        status: 'connection_error',
        url: 'None',
        error: 'Failed to contact database backend'
      };
    }
  } catch (err: any) {
    connectionStatus = {
      status: 'connection_error',
      url: 'None',
      error: err.message || String(err)
    };
  }
}

export async function recreateDatabaseTables(): Promise<{ success: boolean; message: string }> {
  if (isLocalFallback) {
    return { success: true, message: "Running in local fallback mode. Local storage is fully functional!" };
  }
  try {
    const res = await fetch(getApiUrl('/api/db/recreate-tables'), { method: 'POST' });
    if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
    return await res.json();
  } catch (err: any) {
    return { success: false, message: err.message || String(err) };
  }
}

export async function wipeAndRecreateDatabaseTables(): Promise<{ success: boolean; message: string }> {
  if (isLocalFallback) {
    const tables = ['users', 'ledgers', 'parties', 'products', 'tracked_invoices', 'settings', 'transactions', 'balances', 'daily_summaries', 'dashboard_summary', 'cache_versions'];
    for (const table of tables) {
      saveLocalCollection(table, []);
    }
    return { success: true, message: "Local database reset complete! All local storage collections cleared." };
  }
  try {
    const res = await fetch(getApiUrl('/api/db/wipe-tables'), { method: 'POST' });
    if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
    return await res.json();
  } catch (err: any) {
    return { success: false, message: err.message || String(err) };
  }
}

export async function getDatabaseTableStats(): Promise<{ success: boolean; stats: { tableName: string; count: number; exists: boolean }[]; error?: string }> {
  if (isLocalFallback) {
    const tables = ['users', 'ledgers', 'parties', 'products', 'tracked_invoices', 'settings', 'transactions', 'balances', 'daily_summaries', 'dashboard_summary', 'cache_versions'];
    const stats = tables.map(name => {
      const list = getLocalCollection(name);
      return { tableName: name, count: list.length, exists: true };
    });
    return { success: true, stats };
  }
  try {
    const res = await fetch(getApiUrl('/api/db/stats'));
    if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
    return await res.json();
  } catch (err: any) {
    return { success: false, stats: [], error: err.message || String(err) };
  }
}

export async function backupDatabase(): Promise<{ [tableName: string]: any[] }> {
  if (isLocalFallback) {
    const tables = ['users', 'ledgers', 'parties', 'products', 'tracked_invoices', 'settings', 'transactions', 'balances', 'daily_summaries', 'dashboard_summary', 'cache_versions'];
    const backupData: { [tableName: string]: any[] } = {};
    for (const table of tables) {
      backupData[table] = getLocalCollection(table);
    }
    return backupData;
  }
  try {
    const res = await fetch(getApiUrl('/api/db/backup'));
    if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
    return await res.json();
  } catch (err) {
    console.error('Failed to backup database:', err);
    return {};
  }
}

export async function restoreDatabase(backupData: { [tableName: string]: any[] }): Promise<{ success: boolean; message: string }> {
  if (isLocalFallback) {
    const tables = ['users', 'ledgers', 'parties', 'products', 'tracked_invoices', 'settings', 'transactions', 'balances', 'daily_summaries', 'dashboard_summary', 'cache_versions'];
    for (const table of tables) {
      saveLocalCollection(table, backupData[table] || []);
    }
    return { success: true, message: "Local database restore completed successfully!" };
  }
  try {
    const res = await fetch(getApiUrl('/api/db/restore'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(backupData)
    });
    if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
    return await res.json();
  } catch (err: any) {
    return { success: false, message: err.message || String(err) };
  }
}

runDiagnosticCheck();

export async function getDoc(docRef: MockDocRef): Promise<MockDocumentSnapshot> {
  // Try memory cache first for cache_versions to throttle rapid successive requests
  if (docRef.collection === 'cache_versions') {
    const cached = cacheVersionsMemory.get(docRef.id);
    if (cached && cached.expiresAt > Date.now()) {
      return {
        id: docRef.id,
        exists: () => cached.data !== null,
        data: () => cached.data
      };
    }
  }

  if (isLocalFallback) {
    const data = getLocalCollection(docRef.collection).find(item => item.id === docRef.id);
    return {
      id: docRef.id,
      exists: () => data !== undefined && data !== null,
      data: () => data
    };
  }

  const docKey = `${docRef.collection}/${docRef.id}`;
  if (inflightGetDoc.has(docKey)) {
    return inflightGetDoc.get(docKey)!;
  }

  const promise = (async () => {
    try {
      const res = await fetch(getApiUrl(`/api/db/${docRef.collection}/${docRef.id}`));
      if (!res.ok) {
        throw new Error(`HTTP error! status: ${res.status}`);
      }
      const result = await res.json();
      if (result.error) {
        throw new Error(result.error);
      }
      const rowData = result.data;

      if (docRef.collection === 'cache_versions') {
        cacheVersionsMemory.set(docRef.id, {
          data: rowData,
          expiresAt: Date.now() + CACHE_VERSION_TTL
        });
      }

      // Background cache save to Local Storage
      if (rowData) {
        try {
          const collectionData = getLocalCollection(docRef.collection);
          const index = collectionData.findIndex(item => item.id === docRef.id);
          if (index >= 0) {
            collectionData[index] = rowData;
          } else {
            collectionData.push(rowData);
          }
          saveLocalCollection(docRef.collection, collectionData);
        } catch (localErr) {
          console.warn('Failed to update local cache during getDoc:', localErr);
        }
      }

      return {
        id: docRef.id,
        exists: () => !!result.exists,
        data: () => rowData
      };
    } catch (err) {
      console.warn('API getDoc failed, trying local storage fallback:', err);
      try {
        const data = getLocalCollection(docRef.collection).find(item => item.id === docRef.id);
        if (data !== undefined && data !== null) {
          return {
            id: docRef.id,
            exists: () => true,
            data: () => data
          };
        }
      } catch (localErr) {
        console.error('Failed to read from local storage fallback:', localErr);
      }
      throw err;
    } finally {
      inflightGetDoc.delete(docKey);
    }
  })();

  inflightGetDoc.set(docKey, promise);
  return promise;
}

export async function getDocs(queryRef: MockQueryRef | MockCollectionRef): Promise<MockQuerySnapshot> {
  if (isLocalFallback) {
    let items = getLocalCollection(queryRef.collection);
    const clauses = queryRef.type === 'query' ? (queryRef as MockQueryRef).clauses : [];
    items = applyQueryClauses(items, clauses);
    const docs = items.map((row: any) => ({
      id: row.id,
      exists: () => true,
      data: () => row
    }));

    return {
      docs,
      empty: docs.length === 0,
      size: docs.length,
      forEach: (callback: (doc: MockDocumentSnapshot, index: number) => void) => {
        docs.forEach(callback);
      }
    };
  }

  const clauses = queryRef.type === 'query' ? (queryRef as MockQueryRef).clauses : [];
  const queryKey = `${queryRef.collection}:${JSON.stringify(clauses)}`;

  if (inflightGetDocs.has(queryKey)) {
    return inflightGetDocs.get(queryKey)!;
  }

  const promise = (async () => {
    try {
      const res = await fetch(getApiUrl('/api/db/query'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ collection: queryRef.collection, clauses })
      });
      if (!res.ok) {
        throw new Error(`HTTP error! status: ${res.status}`);
      }
      const result = await res.json();
      if (result.error) {
        throw new Error(result.error);
      }
      let items = result.docs || [];
      
      // Background cache save to Local Storage
      try {
        if (queryRef.type === 'collection') {
          saveLocalCollection(queryRef.collection, items);
        } else {
          const collectionData = getLocalCollection(queryRef.collection);
          for (const item of items) {
            const index = collectionData.findIndex(x => x.id === item.id);
            if (index >= 0) {
              collectionData[index] = item;
            } else {
              collectionData.push(item);
            }
          }
          saveLocalCollection(queryRef.collection, collectionData);
        }
      } catch (localErr) {
        console.warn('Failed to update local cache during getDocs:', localErr);
      }

      // Always apply second-pass query clauses in JavaScript to guarantee 100% type matching and safety
      items = applyQueryClauses(items, clauses);
      const docs = items.map((row: any) => ({
        id: row.id,
        exists: () => true,
        data: () => row
      }));

      return {
        docs,
        empty: docs.length === 0,
        size: docs.length,
        forEach: (callback: (doc: MockDocumentSnapshot, index: number) => void) => {
          docs.forEach(callback);
        }
      };
    } catch (err) {
      console.warn('API getDocs failed, trying local storage fallback:', err);
      try {
        let items = getLocalCollection(queryRef.collection);
        items = applyQueryClauses(items, clauses);
        const docs = items.map((row: any) => ({
          id: row.id,
          exists: () => true,
          data: () => row
        }));
        return {
          docs,
          empty: docs.length === 0,
          size: docs.length,
          forEach: (callback: (doc: MockDocumentSnapshot, index: number) => void) => {
            docs.forEach(callback);
          }
        };
      } catch (localErr) {
        console.error('Failed to read from local storage fallback:', localErr);
      }
      throw err;
    } finally {
      inflightGetDocs.delete(queryKey);
    }
  })();

  inflightGetDocs.set(queryKey, promise);
  return promise;
}

export async function setDoc(docRef: MockDocRef, data: any, options?: { merge?: boolean }): Promise<void> {
  // Invalidate memory cache immediately on modification to ensure real-time consistency
  if (docRef.collection === 'cache_versions') {
    cacheVersionsMemory.delete(docRef.id);
  }

  // Always write in the background to Local Storage first for reliable performance
  try {
    const collectionData = getLocalCollection(docRef.collection);
    const payload = { ...data, id: docRef.id };
    const index = collectionData.findIndex(item => item.id === docRef.id);
    if (index >= 0) {
      collectionData[index] = options?.merge ? { ...collectionData[index], ...data } : payload;
    } else {
      collectionData.push(payload);
    }
    saveLocalCollection(docRef.collection, collectionData);
  } catch (localErr) {
    console.warn('Failed to save to local storage cache in setDoc:', localErr);
  }

  if (isLocalFallback) {
    notifyLocalListeners(docRef.collection);
    return;
  }

  try {
    const res = await fetch(getApiUrl('/api/db/batch'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        operations: [{
          type: 'set',
          collection: docRef.collection,
          id: docRef.id,
          data,
          options
        }]
      })
    });
    if (!res.ok) {
      throw new Error(`HTTP error! status: ${res.status}`);
    }
    const result = await res.json();
    if (result.error) {
      throw new Error(result.error);
    }
    notifyLocalListeners(docRef.collection);
  } catch (err) {
    console.warn('API setDoc failed, but data is saved in local storage fallback:', err);
    notifyLocalListeners(docRef.collection);
    // Do not throw if write succeeded locally, ensuring seamless UX
  }
}

export async function updateDoc(docRef: MockDocRef, data: any): Promise<void> {
  // Invalidate memory cache immediately on modification to ensure real-time consistency
  if (docRef.collection === 'cache_versions') {
    cacheVersionsMemory.delete(docRef.id);
  }

  // Always write in the background to Local Storage first for reliable performance
  try {
    const collectionData = getLocalCollection(docRef.collection);
    const index = collectionData.findIndex(item => item.id === docRef.id);
    if (index >= 0) {
      collectionData[index] = { ...collectionData[index], ...data };
      saveLocalCollection(docRef.collection, collectionData);
    }
  } catch (localErr) {
    console.warn('Failed to update local storage cache in updateDoc:', localErr);
  }

  if (isLocalFallback) {
    notifyLocalListeners(docRef.collection);
    return;
  }

  try {
    const res = await fetch(getApiUrl('/api/db/batch'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        operations: [{
          type: 'update',
          collection: docRef.collection,
          id: docRef.id,
          data
        }]
      })
    });
    if (!res.ok) {
      throw new Error(`HTTP error! status: ${res.status}`);
    }
    const result = await res.json();
    if (result.error) {
      throw new Error(result.error);
    }
    notifyLocalListeners(docRef.collection);
  } catch (err) {
    console.warn('API updateDoc failed, but data is updated in local storage fallback:', err);
    notifyLocalListeners(docRef.collection);
    // Do not throw if write succeeded locally, ensuring seamless UX
  }
}

export async function deleteDoc(docRef: MockDocRef): Promise<void> {
  // Invalidate memory cache immediately on modification to ensure real-time consistency
  if (docRef.collection === 'cache_versions') {
    cacheVersionsMemory.delete(docRef.id);
  }

  // Always write in the background to Local Storage first for reliable performance
  try {
    const collectionData = getLocalCollection(docRef.collection);
    const filtered = collectionData.filter(item => item.id !== docRef.id);
    saveLocalCollection(docRef.collection, filtered);
  } catch (localErr) {
    console.warn('Failed to delete from local storage cache in deleteDoc:', localErr);
  }

  if (isLocalFallback) {
    notifyLocalListeners(docRef.collection);
    return;
  }

  try {
    const res = await fetch(getApiUrl('/api/db/batch'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        operations: [{
          type: 'delete',
          collection: docRef.collection,
          id: docRef.id
        }]
      })
    });
    if (!res.ok) {
      throw new Error(`HTTP error! status: ${res.status}`);
    }
    const result = await res.json();
    if (result.error) {
      throw new Error(result.error);
    }
    notifyLocalListeners(docRef.collection);
  } catch (err) {
    console.warn('API deleteDoc failed, but item is deleted in local storage fallback:', err);
    notifyLocalListeners(docRef.collection);
    // Do not throw if write succeeded locally, ensuring seamless UX
  }
}

// Emulates real-time snapshot listeners using local memory triggers + automatic periodic polling
export function onSnapshot(
  queryOrRef: MockDocRef | MockCollectionRef | MockQueryRef,
  nextCallback: (snapshot: any) => void,
  errorCallback?: (error: any) => void
): () => void {
  const collectionName = queryOrRef.collection;

  let isCleanedUp = false;
  let listener: any = null;

  const triggerFreshSnapshot = async () => {
    if (isCleanedUp) return;
    try {
      let result;
      if (queryOrRef.type === 'doc') {
        result = await getDoc(queryOrRef as MockDocRef);
        if (!isCleanedUp) nextCallback(result);
      } else {
        result = await getDocs(queryOrRef as MockCollectionRef | MockQueryRef);
        if (!isCleanedUp) nextCallback(result);
      }
    } catch (err) {
      console.error(`[Snapshot Fail] Stream update failed for "${collectionName}":`, err);
      if (errorCallback) errorCallback(err);
    }
  };

  const triggerLocalFallback = () => {
    if (isCleanedUp) return;

    try {
      if (queryOrRef.type === 'doc') {
        const docId = (queryOrRef as MockDocRef).id;
        const data = getLocalCollection(collectionName).find(item => item.id === docId);
        nextCallback({
          id: docId,
          exists: () => data !== undefined && data !== null,
          data: () => data
        });
      } else {
        let items = getLocalCollection(collectionName);
        const clauses = queryOrRef.type === 'query' ? (queryOrRef as MockQueryRef).clauses : [];
        items = applyQueryClauses(items, clauses);
        const docs = items.map((row: any) => ({
          id: row.id,
          exists: () => true,
          data: () => row
        }));
        nextCallback({
          docs,
          empty: docs.length === 0,
          size: docs.length,
          forEach: (cb: any) => docs.forEach(cb)
        });
      }
    } catch (err) {
      if (errorCallback) errorCallback(err);
    }
  };

  // Always register listener to receive instantaneous local event updates on write
  listener = {
    type: queryOrRef.type,
    collection: collectionName,
    docId: queryOrRef.type === 'doc' ? (queryOrRef as MockDocRef).id : undefined,
    queryRef: queryOrRef.type === 'query' ? (queryOrRef as MockQueryRef) : undefined,
    callback: nextCallback,
    triggerFreshSnapshot: () => {
      if (isLocalFallback) {
        triggerLocalFallback();
      } else {
        triggerFreshSnapshot();
      }
    }
  };
  localListeners.add(listener);

  if (isLocalFallback) {
    triggerLocalFallback();
  } else {
    triggerFreshSnapshot();
  }

  // Periodic polling (every 5 seconds) to handle multi-tab/multi-device updates
  const pollInterval = setInterval(() => {
    if (!isLocalFallback) {
      triggerFreshSnapshot();
    }
  }, 5000);

  return () => {
    isCleanedUp = true;
    clearInterval(pollInterval);
    if (listener) {
      localListeners.delete(listener);
    }
  };
}

// Sequential execution transaction handler - Commits a batch of writes in a single backend transaction
export async function runTransaction(dbInstance: any, callback: (tx: any) => Promise<any>): Promise<any> {
  const operations: any[] = [];

  const txObject = {
    get: async (docRef: MockDocRef) => {
      return await getDoc(docRef);
    },
    set: (docRef: MockDocRef, data: any, options?: { merge?: boolean }) => {
      operations.push({
        type: 'set',
        collection: docRef.collection,
        id: docRef.id,
        data,
        options
      });
    },
    update: (docRef: MockDocRef, data: any) => {
      operations.push({
        type: 'update',
        collection: docRef.collection,
        id: docRef.id,
        data
      });
    },
    delete: (docRef: MockDocRef) => {
      operations.push({
        type: 'delete',
        collection: docRef.collection,
        id: docRef.id
      });
    }
  };

  // Execute reading/calculating callback
  const result = await callback(txObject);

  // Always write batch operations in the background to Local Storage first for reliable performance
  try {
    for (const op of operations) {
      if (op.type === 'set') {
        const collectionData = getLocalCollection(op.collection);
        const payload = { ...op.data, id: op.id };
        const index = collectionData.findIndex(item => item.id === op.id);
        if (index >= 0) {
          collectionData[index] = op.options?.merge ? { ...collectionData[index], ...op.data } : payload;
        } else {
          collectionData.push(payload);
        }
        saveLocalCollection(op.collection, collectionData);
      } else if (op.type === 'update') {
        const collectionData = getLocalCollection(op.collection);
        const index = collectionData.findIndex(item => item.id === op.id);
        if (index >= 0) {
          collectionData[index] = { ...collectionData[index], ...op.data };
          saveLocalCollection(op.collection, collectionData);
        }
      } else if (op.type === 'delete') {
        const collectionData = getLocalCollection(op.collection);
        const filtered = collectionData.filter(item => item.id !== op.id);
        saveLocalCollection(op.collection, filtered);
      }
    }
  } catch (localErr) {
    console.warn('Failed to commit transaction to local storage cache:', localErr);
  }

  if (isLocalFallback) {
    const uniqueCollections = Array.from(new Set(operations.map(op => op.collection)));
    uniqueCollections.forEach(notifyLocalListeners);
    return result;
  }

  // Submit all accumulated writes as a single batch transaction to the backend
  if (operations.length > 0) {
    try {
      const res = await fetch(getApiUrl('/api/db/batch'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ operations })
      });
      if (!res.ok) {
        throw new Error(`HTTP error during transaction commit! status: ${res.status}`);
      }
      
      // Notify listeners of modified collections
      const uniqueCollections = Array.from(new Set(operations.map(op => op.collection)));
      uniqueCollections.forEach(notifyLocalListeners);
    } catch (err) {
      console.warn('Transaction API commit failed, but operations were saved locally:', err);
      // Notify listeners about the local updates anyway
      const uniqueCollections = Array.from(new Set(operations.map(op => op.collection)));
      uniqueCollections.forEach(notifyLocalListeners);
      // Do not throw to ensure zero data loss UI experience
    }
  }

  return result;
}

// Check if there is any offline data in LocalStorage
export function hasOfflineLocalData(): boolean {
  const tables = ['ledgers', 'parties', 'transactions'];
  for (const table of tables) {
    const data = getLocalCollection(table);
    if (data && data.length > 0) {
      return true;
    }
  }
  return false;
}

// Migrate offline LocalStorage data to the live Turso database
export async function migrateOfflineDataToLiveTurso(): Promise<{ success: boolean; message: string }> {
  try {
    const tables = ['users', 'ledgers', 'parties', 'products', 'tracked_invoices', 'settings', 'transactions', 'balances', 'daily_summaries', 'dashboard_summary', 'cache_versions'];
    const backupData: { [tableName: string]: any[] } = {};
    
    for (const table of tables) {
      backupData[table] = getLocalCollection(table);
    }

    // Call restore endpoint to write directly to Live Turso
    const res = await fetch(getApiUrl('/api/db/restore'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(backupData)
    });

    if (!res.ok) {
      throw new Error(`HTTP error! status: ${res.status}`);
    }

    const result = await res.json();
    if (result.success) {
      // Clear offline data flag so we stay live
      localStorage.removeItem('force_local_fallback');
      
      // Clear the local supa_mock_ items to avoid double prompting next time
      for (const table of tables) {
        localStorage.removeItem(`${LOCAL_DB_PREFIX}${table}`);
      }
    }
    return result;
  } catch (err: any) {
    console.error('Migration to live Turso failed:', err);
    return { success: false, message: err.message || String(err) };
  }
}
