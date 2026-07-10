import { db, getDocs, collection, query, where } from '../firebase';
import { bulkSetCacheItems } from './idbCache';

export async function syncCollection<T extends { id: string }>(
  collectionName: string,
  ledgerId: string,
  storeKey: 'parties' | 'products' | 'settings' | 'dashboard_summary' | 'tracked_invoices' | 'transactions'
): Promise<T[]> {
  try {
    // Always query fresh documents from the database for the active ledger
    const q = query(collection(db, collectionName), where('ledgerId', '==', ledgerId));
    const snapshot = await getDocs(q);
    const freshItems = snapshot.docs.map(doc => {
      const data = doc.data() as any;
      return { id: doc.id, ...data } as T;
    });
    
    // Warm the in-memory cache for faster reads
    await bulkSetCacheItems<T>(storeKey, freshItems);
    
    return freshItems;
  } catch (error) {
    console.error(`Sync failure on collection ${collectionName}:`, error);
    throw error;
  }
}
