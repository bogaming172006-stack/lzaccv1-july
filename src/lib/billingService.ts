import { Transaction, Party } from '../types';

export interface BillingBill {
  id: string;
  bill_no: string;
  bill_type: string;
  total_qty: number;
  total_amount: number;
  total_weight: number;
  bill_date: string;
  customer_name: string;
  customer_address?: string;
  vehicle_number?: string;
  payment_upi?: string | null;
  driver_name?: string;
  driver_contact?: string;
  salesman_name?: string;
  phone_number?: string;
  remark?: string;
  status: string;
  created_at: string;
}

export interface BillingBillItem {
  id?: string;
  bill_id?: string;
  product_name: string;
  qty: number;
  rate?: number;
  line_total?: number;
  is_marked?: number;
  mark_text?: string | null;
}

export interface BillingDateOption {
  bill_date: string;
  count: number;
  total_amount: number;
}

export interface DeclarationSummary {
  date: string;
  totalBills: number;
  totalAmount: number;
  debitedBills: { bill: BillingBill; transaction: Transaction }[];
  debitedAmount: number;
  pendingBills: BillingBill[];
  pendingAmount: number;
}

export function getTodayKolkataDate(): string {
  try {
    return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
  } catch (e) {
    return new Date().toISOString().slice(0, 10);
  }
}

export function normalizeBillNumber(val?: string | null): string {
  if (!val) return '';
  return val
    .toString()
    .trim()
    .toUpperCase()
    .replace(/^#+/, '')
    .replace(/^(INV|BILL|INVOICE)[-\s:]*/i, '')
    .trim();
}

/**
 * Format particulars/description for a billing bill when debited.
 * Collects strictly: Order Bill, Place Date, Total Qty, and Vehicle Number.
 */
export function formatBillParticulars(bill: BillingBill): string {
  const billNo = bill.bill_no ? `Bill #${bill.bill_no}` : '';
  const dateStr = bill.bill_date || (bill.created_at ? bill.created_at.slice(0, 10) : '');
  const datePart = dateStr ? `Date: ${dateStr}` : '';
  const qtyPart = `Total Qty: ${bill.total_qty ?? 0} pcs`;
  const vehPart = `Veh No: ${bill.vehicle_number && bill.vehicle_number.trim() ? bill.vehicle_number.trim() : '-'}`;

  return [billNo, datePart, qtyPart, vehPart].filter(Boolean).join(' | ');
}

/**
 * Check if a bill has already been entered/debited in the transactions list
 */
export function findDebitedTransaction(
  bill: BillingBill,
  transactions?: Transaction[] | null
): Transaction | undefined {
  if (!bill || !bill.bill_no || !transactions || !Array.isArray(transactions)) return undefined;
  const billNoNormalized = normalizeBillNumber(bill.bill_no);
  if (!billNoNormalized) return undefined;

  return transactions.find(t => {
    if (!t || t.type !== 'DEBIT') return false;
    const txInvNormalized = normalizeBillNumber(t.invoiceNo);
    if (txInvNormalized && txInvNormalized === billNoNormalized) {
      return true;
    }
    // Check if notes explicitly mention the bill number
    if (t.notes) {
      const upperNotes = t.notes.toUpperCase();
      if (
        upperNotes.includes(bill.bill_no.toUpperCase()) ||
        upperNotes.includes(billNoNormalized)
      ) {
        return true;
      }
    }
    return false;
  });
}

/**
 * Intelligent party matcher from customer name in billing DB to existing Parties
 */
export function findMatchingParty(
  customerName?: string | null,
  parties?: Party[] | null
): Party | undefined {
  if (!customerName || !customerName.trim() || !parties || !Array.isArray(parties) || parties.length === 0) return undefined;
  const cleanTarget = customerName.trim().toLowerCase();

  // 1. Exact match
  const exact = parties.find(p => p && p.name && p.name.trim().toLowerCase() === cleanTarget);
  if (exact) return exact;

  // 2. Starts with or contains match
  const containsMatch = parties.find(p => {
    if (!p || !p.name) return false;
    const pName = p.name.trim().toLowerCase();
    return pName.includes(cleanTarget) || cleanTarget.includes(pName);
  });
  if (containsMatch) return containsMatch;

  // 3. Normalized word tokens overlap match (e.g. "Tapan Das" vs "Tapan")
  const targetWords = cleanTarget.split(/[\s,.-]+/).filter(w => w.length > 2);
  if (targetWords.length > 0) {
    const wordMatch = parties.find(p => {
      if (!p || !p.name) return false;
      const pWords = p.name.trim().toLowerCase().split(/[\s,.-]+/);
      return targetWords.some(tw => pWords.includes(tw));
    });
    if (wordMatch) return wordMatch;
  }

  return undefined;
}

// Client-side cache to minimize repeated network reads to stock database
interface CacheItem<T> {
  data: T;
  timestamp: number;
}

const clientBillsCache = new Map<string, CacheItem<{
  success: boolean;
  bills: BillingBill[];
  date: string;
  totalAmount: number;
}>>();

const clientLookupCache = new Map<string, CacheItem<{
  found: boolean;
  bill: BillingBill | null;
  matches: BillingBill[];
}>>();

let clientDatesCache: CacheItem<BillingDateOption[]> | null = null;
const clientBillItemsCache = new Map<string, CacheItem<BillingBillItem[]>>();

/**
 * Invalidate client-side stock cache
 */
export function invalidateStockCache(date?: string) {
  if (date) {
    clientBillsCache.delete(date);
  } else {
    clientBillsCache.clear();
    clientLookupCache.clear();
    clientDatesCache = null;
    clientBillItemsCache.clear();
  }
}

/**
 * Fetch bills for a given date from the billing API with client-side caching
 */
export async function fetchBillingBills(date?: string, forceRefresh = false): Promise<{
  success: boolean;
  bills: BillingBill[];
  date: string;
  totalAmount: number;
  error?: string;
  cached?: boolean;
}> {
  const targetDate = date || getTodayKolkataDate();
  const now = Date.now();
  const isToday = targetDate === getTodayKolkataDate();
  const TTL = isToday ? 2 * 60 * 1000 : 30 * 60 * 1000; // 2 min for today, 30 min for past dates

  // Check client cache if not forcing refresh
  if (!forceRefresh) {
    const cached = clientBillsCache.get(targetDate);
    if (cached && (now - cached.timestamp < TTL)) {
      return {
        ...cached.data,
        cached: true
      };
    }
  }

  try {
    const url = `/api/billing/bills?date=${encodeURIComponent(targetDate)}${forceRefresh ? '&refresh=1' : ''}`;
    const res = await fetch(url);
    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.error || `HTTP error ${res.status}`);
    }
    const data = await res.json();
    const payload = {
      success: true,
      bills: data.bills || [],
      date: data.date || targetDate,
      totalAmount: data.totalAmount || 0,
    };

    clientBillsCache.set(targetDate, {
      data: payload,
      timestamp: now
    });

    return payload;
  } catch (err: any) {
    console.error('Error in fetchBillingBills:', err);
    // Return stale cache if available on network error
    const stale = clientBillsCache.get(targetDate);
    if (stale) {
      return {
        ...stale.data,
        cached: true
      };
    }
    return {
      success: false,
      bills: [],
      date: targetDate,
      totalAmount: 0,
      error: err.message || String(err),
    };
  }
}

/**
 * Lookup bill by bill number with local cache lookup first
 */
export async function lookupBill(billNo: string): Promise<{
  found: boolean;
  bill: BillingBill | null;
  matches: BillingBill[];
}> {
  const trimmed = billNo.trim();
  if (!trimmed) {
    return { found: false, bill: null, matches: [] };
  }

  const cleanNo = normalizeBillNumber(trimmed);
  const now = Date.now();

  // 1. Check if already present in any loaded bills in client cache
  for (const entry of clientBillsCache.values()) {
    if (entry.data?.bills) {
      const localMatch = entry.data.bills.find(b => {
        const bNo = normalizeBillNumber(b.bill_no);
        return bNo === cleanNo || bNo.includes(cleanNo) || cleanNo.includes(bNo);
      });
      if (localMatch) {
        return {
          found: true,
          bill: localMatch,
          matches: [localMatch]
        };
      }
    }
  }

  // 2. Check client lookup cache
  const cached = clientLookupCache.get(cleanNo);
  if (cached && (now - cached.timestamp < 10 * 60 * 1000)) {
    return cached.data;
  }

  try {
    const res = await fetch(`/api/billing/lookup/${encodeURIComponent(trimmed)}`);
    if (!res.ok) {
      return { found: false, bill: null, matches: [] };
    }
    const data = await res.json();
    const result = {
      found: !!data.found,
      bill: data.bill || null,
      matches: data.matches || [],
    };

    clientLookupCache.set(cleanNo, {
      data: result,
      timestamp: now
    });

    return result;
  } catch (err) {
    console.error('Error looking up bill:', err);
    return { found: false, bill: null, matches: [] };
  }
}

/**
 * Fetch available dates in billing database with 10-minute client caching
 */
export async function fetchBillingDates(forceRefresh = false): Promise<BillingDateOption[]> {
  const now = Date.now();
  if (!forceRefresh && clientDatesCache && (now - clientDatesCache.timestamp < 10 * 60 * 1000)) {
    return clientDatesCache.data;
  }

  try {
    const res = await fetch('/api/billing/dates');
    if (!res.ok) return clientDatesCache?.data || [];
    const data = await res.json();
    const dates = data.dates || [];

    clientDatesCache = {
      data: dates,
      timestamp: now
    };

    return dates;
  } catch (err) {
    console.error('Error fetching billing dates:', err);
    return clientDatesCache?.data || [];
  }
}

/**
 * Computes full declaration comparison between bills and ledger transactions
 */
export function computeDeclarationSummary(
  bills?: BillingBill[] | null,
  transactions?: Transaction[] | null,
  date: string = ''
): DeclarationSummary {
  const safeBills = Array.isArray(bills) ? bills : [];
  const safeTransactions = Array.isArray(transactions) ? transactions : [];

  const debitedBills: { bill: BillingBill; transaction: Transaction }[] = [];
  const pendingBills: BillingBill[] = [];

  let totalAmount = 0;
  let debitedAmount = 0;
  let pendingAmount = 0;

  for (const bill of safeBills) {
    if (!bill) continue;
    const amt = Number(bill.total_amount) || 0;
    totalAmount += amt;

    const matchedTx = findDebitedTransaction(bill, safeTransactions);
    if (matchedTx) {
      debitedBills.push({ bill, transaction: matchedTx });
      debitedAmount += amt;
    } else {
      pendingBills.push(bill);
      pendingAmount += amt;
    }
  }

  return {
    date,
    totalBills: safeBills.length,
    totalAmount,
    debitedBills,
    debitedAmount,
    pendingBills,
    pendingAmount,
  };
}

/**
 * Fetch bill items for a given bill ID or bill number with 30-minute client cache
 */
export async function fetchBillItems(billIdOrNo?: string | null): Promise<BillingBillItem[]> {
  if (!billIdOrNo) return [];
  const cacheKey = billIdOrNo.toLowerCase();
  const now = Date.now();

  const cached = clientBillItemsCache.get(cacheKey);
  if (cached && (now - cached.timestamp < 30 * 60 * 1000)) {
    return cached.data;
  }

  try {
    const res = await fetch(`/api/billing/bills/${encodeURIComponent(billIdOrNo)}/items`);
    if (!res.ok) return [];
    const data = await res.json();
    const items = data.items || [];

    clientBillItemsCache.set(cacheKey, {
      data: items,
      timestamp: now
    });

    return items;
  } catch (err) {
    console.error('Failed to fetch bill items:', err);
    return [];
  }
}
