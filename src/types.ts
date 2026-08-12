export interface User {
  id: string;
  name: string;
  pin: string;
  deviceId: string;
  lastActivity: number;
  isAdmin: boolean;
}

// Company represents a ledger/company
export interface Company {
  id: string;
  name: string;
  type: 'SALE' | 'PURCHASE' | 'CASH_BANK' | 'EXPENSE' | 'ASSET' | 'LIABILITY' | 'CAPITAL';
  createdAt?: number;
}

// Keeping Ledger as alias of Company for backward compatibility
export type Ledger = Company;

export const LEDGER_TYPE_LABELS: Record<Ledger['type'], string> = {
  SALE: 'Sales (Receivables)',
  PURCHASE: 'Purchases (Payables)',
  CASH_BANK: 'Cash & Bank (Liquidity)',
  EXPENSE: 'Expenses / Payments',
  ASSET: 'Assets / Inventory',
  LIABILITY: 'Liabilities / Loans',
  CAPITAL: 'Capital / Equity'
};

export interface Party {
  id: string;
  ledgerId: string;
  name: string;
  phone: string;
  address: string;
  openingBalance: number;
  currentDue: number;
  totalDebit?: number;
  totalCredit?: number;
  lastTransaction: number;
  status: 'Active' | 'Inactive';
  email?: string;
}

export interface Product {
  id: string;
  ledgerId: string;
  name: string;
  sku: string;
  price: number;
  stock: number;
  updatedAt?: number;
}

export interface Invoice {
  id: string;
  ledgerId: string;
  invoiceNo: string;
  partyId: string;
  type: 'DEBIT' | 'CREDIT';
  amount: number;
  timestamp: number;
  status: 'Pending' | 'Paid' | 'Tracked';
  notes?: string;
}

export interface InvoiceItem {
  id: string;
  invoiceId: string;
  productId: string;
  quantity: number;
  price: number;
  subtotal: number;
}

export interface Transaction {
  id: string;
  ledgerId: string;
  partyId: string;
  invoiceNo: string;
  type: 'DEBIT' | 'CREDIT';
  amount: number;
  notes: string;
  timestamp: number;
  runningBalance?: number;
  createdBy?: string;
  attachmentUrl?: string;
  items?: Array<{
    description: string;
    quantity?: number;
    price?: number;
    total: number;
  }>;
}

export interface DailySummary {
  id: string; // e.g. "ledgerId_YYYY-MM-DD"
  ledgerId: string;
  date: string;
  totalDebit: number;
  totalCredit: number;
  transactionCount: number;
}

export interface DashboardSummary {
  id: string; // e.g. "ledgerId"
  ledgerId: string;
  totalReceivable: number; // positive currentDue
  totalPayable: number; // negative currentDue
  totalTransactions: number;
  totalParties: number;
  lastUpdated?: number;
}

export interface Balance {
  id: string; // partyId
  partyId: string;
  ledgerId: string;
  currentDue: number;
  totalDebit: number;
  totalCredit: number;
  lastTransaction: number;
}

export interface TrackedInvoice {
  id: string;
  ledgerId: string;
  invoiceNo: string;
  type: 'DEBIT' | 'CREDIT';
  timestamp: number;
  partyId?: string;
}

export interface CacheVersions {
  id: string; // ledgerId
  ledgerId: string;
  parties: number;
  products: number;
  settings: number;
  dashboard_summary: number;
  tracked_invoices?: number;
  transactions?: number;
}
