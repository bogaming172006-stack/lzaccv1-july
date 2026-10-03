import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  FileText, 
  Calendar, 
  RefreshCw, 
  CheckCircle2, 
  AlertTriangle, 
  Clock, 
  Search, 
  ArrowRight, 
  Copy, 
  Printer, 
  ExternalLink,
  ChevronRight,
  Sparkles,
  Info,
  Check,
  Package,
  Loader2,
  X,
  Eye,
  Phone,
  MapPin,
  Truck,
  PlusCircle,
  AlertCircle
} from 'lucide-react';
import { useLedger } from '../LedgerContext';
import { Party, Transaction } from '../types';
import { getFilteredCacheItems } from '../lib/idbCache';
import { syncCollection } from '../lib/syncCache';
import { db, collection, getDocs } from '../firebase';
import { 
  BillingBill, 
  BillingBillItem,
  fetchBillingBills, 
  fetchBillingDates, 
  fetchBillItems,
  computeDeclarationSummary,
  getTodayKolkataDate,
  findMatchingParty,
  BillingDateOption,
  formatBillParticulars
} from '../lib/billingService';

export default function BillingDeclaration() {
  const navigate = useNavigate();
  const { activeLedger } = useLedger();
  const [parties, setParties] = useState<Party[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);

  const [selectedDate, setSelectedDate] = useState<string>(() => getTodayKolkataDate());
  const [bills, setBills] = useState<BillingBill[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [lastRefreshedAt, setLastRefreshedAt] = useState<Date>(new Date());
  const [availableDates, setAvailableDates] = useState<BillingDateOption[]>([]);
  const [orderStatusFilter, setOrderStatusFilter] = useState<'DELIVERED_OR_APPROVED' | 'DELIVERED' | 'APPROVED' | 'PENDING' | 'OTHER' | 'ALL'>('DELIVERED_OR_APPROVED');
  const [activeTab, setActiveTab] = useState<'pending' | 'all' | 'debited'>('pending');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [copiedSummary, setCopiedSummary] = useState<boolean>(false);
  const [selectedOrderDetails, setSelectedOrderDetails] = useState<{
    bill: BillingBill;
    isDebited: boolean;
    matchedTx?: any;
  } | null>(null);
  const [orderItems, setOrderItems] = useState<BillingBillItem[]>([]);
  const [isLoadingItems, setIsLoadingItems] = useState<boolean>(false);

  useEffect(() => {
    if (!selectedOrderDetails?.bill) {
      setOrderItems([]);
      setIsLoadingItems(false);
      return;
    }
    let isCancelled = false;
    setIsLoadingItems(true);
    const billIdOrNo = selectedOrderDetails.bill.id || selectedOrderDetails.bill.bill_no;
    fetchBillItems(billIdOrNo)
      .then(items => {
        if (!isCancelled) {
          setOrderItems(items || []);
          setIsLoadingItems(false);
        }
      })
      .catch(err => {
        console.error('Error fetching order items:', err);
        if (!isCancelled) {
          setOrderItems([]);
          setIsLoadingItems(false);
        }
      });
    return () => {
      isCancelled = true;
    };
  }, [selectedOrderDetails?.bill?.id, selectedOrderDetails?.bill?.bill_no]);

  // Load available dates on mount
  useEffect(() => {
    fetchBillingDates().then(dates => setAvailableDates(dates));
  }, []);

  // Load parties and transactions from cache / sync
  useEffect(() => {
    let isCancelled = false;
    const loadData = async () => {
      try {
        const cachedParties = await getFilteredCacheItems<Party>('parties', p => !activeLedger?.id || p.ledgerId === activeLedger.id);
        if (!isCancelled) setParties(cachedParties);
        
        const cachedTxs = await getFilteredCacheItems<Transaction>('transactions', t => !activeLedger?.id || t.ledgerId === activeLedger.id);
        if (!isCancelled) setTransactions(cachedTxs);

        if (activeLedger?.id) {
          await syncCollection<Party>('parties', activeLedger.id, 'parties');
          await syncCollection<Transaction>('transactions', activeLedger.id, 'transactions');
          
          const freshParties = await getFilteredCacheItems<Party>('parties', p => p.ledgerId === activeLedger.id);
          if (!isCancelled) setParties(freshParties);

          const freshTxs = await getFilteredCacheItems<Transaction>('transactions', t => t.ledgerId === activeLedger.id);
          if (!isCancelled) setTransactions(freshTxs);
        } else {
          const pSnap = await getDocs(collection(db, 'parties'));
          const pList: Party[] = [];
          pSnap.forEach(d => { if (d.exists()) pList.push(d.data() as Party); });
          if (!isCancelled) setParties(pList);

          const tSnap = await getDocs(collection(db, 'transactions'));
          const tList: Transaction[] = [];
          tSnap.forEach(d => { if (d.exists()) tList.push(d.data() as Transaction); });
          if (!isCancelled) setTransactions(tList);
        }
      } catch (err) {
        console.error("BillingDeclaration: Failed to load parties and transactions", err);
      }
    };
    loadData();

    const handleSync = () => {
      loadData();
    };
    window.addEventListener('database-synced', handleSync);
    return () => {
      isCancelled = true;
      window.removeEventListener('database-synced', handleSync);
    };
  }, [activeLedger?.id]);

  // Fetch bills whenever selectedDate changes
  const loadBills = useCallback(async (dateToFetch: string) => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetchBillingBills(dateToFetch);
      if (res.success) {
        setBills(res.bills);
        setLastRefreshedAt(new Date());
      } else {
        setError(res.error || 'Failed to fetch bills from billing database');
      }
    } catch (err: any) {
      setError(err.message || 'Network error fetching bills');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadBills(selectedDate);
  }, [selectedDate, loadBills]);

  // Filter by Order Status: If DELIVERED or APPROVED then only this order are showing in their order details
  const statusFilteredBills = useMemo(() => {
    if (orderStatusFilter === 'DELIVERED_OR_APPROVED') {
      return bills.filter(b => {
        const s = (b.status || '').toUpperCase().trim();
        return s === 'DELIVERED' || s === 'APPROVED';
      });
    }
    if (orderStatusFilter === 'DELIVERED') {
      return bills.filter(b => (b.status || '').toUpperCase().trim() === 'DELIVERED');
    }
    if (orderStatusFilter === 'APPROVED') {
      return bills.filter(b => (b.status || '').toUpperCase().trim() === 'APPROVED');
    }
    if (orderStatusFilter === 'PENDING') {
      return bills.filter(b => (b.status || '').toUpperCase().trim() === 'PENDING');
    }
    if (orderStatusFilter === 'OTHER') {
      return bills.filter(b => {
        const s = (b.status || '').toUpperCase().trim();
        return s !== 'DELIVERED' && s !== 'APPROVED' && s !== 'PENDING';
      });
    }
    return bills;
  }, [bills, orderStatusFilter]);

  // Compute summary metrics against current ledger transactions for status-filtered bills
  const summary = useMemo(() => {
    return computeDeclarationSummary(statusFilteredBills, transactions, selectedDate);
  }, [statusFilteredBills, transactions, selectedDate]);

  // Filtered bills based on active tab and search query
  const filteredBills = useMemo(() => {
    let list: { bill: BillingBill; isDebited: boolean; matchedTx?: any }[] = [];

    const pending = summary?.pendingBills || [];
    const debited = summary?.debitedBills || [];

    if (activeTab === 'pending') {
      list = pending.map(b => ({ bill: b, isDebited: false }));
    } else if (activeTab === 'debited') {
      list = debited.map(d => ({ bill: d.bill, isDebited: true, matchedTx: d.transaction }));
    } else {
      list = statusFilteredBills.map(b => {
        const debitedEntry = debited.find(d => d.bill.id === b.id);
        return {
          bill: b,
          isDebited: !!debitedEntry,
          matchedTx: debitedEntry?.transaction
        };
      });
    }

    if (!searchQuery.trim()) return list;

    const q = searchQuery.toLowerCase().trim();
    return list.filter(item => {
      const b = item.bill;
      return (
        b.bill_no.toLowerCase().includes(q) ||
        (b.customer_name && b.customer_name.toLowerCase().includes(q)) ||
        (b.salesman_name && b.salesman_name.toLowerCase().includes(q)) ||
        (b.driver_name && b.driver_name.toLowerCase().includes(q)) ||
        (b.status && b.status.toLowerCase().includes(q)) ||
        String(b.total_amount).includes(q)
      );
    });
  }, [statusFilteredBills, summary, activeTab, searchQuery]);

  // Handler to debit a specific bill
  const handleDebitBill = (bill: BillingBill) => {
    // Attempt to match party from customer name
    const matchedParty = findMatchingParty(bill.customer_name, parties);

    // Navigate to MasterEntry with pre-filled state
    navigate('/master-entry', {
      state: {
        fromBillingDeclaration: true,
        billNo: bill.bill_no,
        amount: String(bill.total_amount),
        partyId: matchedParty ? matchedParty.id : undefined,
        partyName: bill.customer_name,
        notes: formatBillParticulars(bill),
        date: bill.bill_date || selectedDate,
        voucherType: 'DEBIT'
      }
    });
  };

  // Quick date pickers
  const todayStr = getTodayKolkataDate();
  const yesterdayStr = (() => {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    try {
      return d.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
    } catch {
      return d.toISOString().slice(0, 10);
    }
  })();

  // Copy WhatsApp / Text Declaration Summary
  const handleCopyDeclaration = () => {
    const lines = [
      `*GREENZAR BILLING DECLARATION*`,
      `📅 Date: ${selectedDate}`,
      `🏢 Ledger: ${activeLedger?.name || 'Primary Ledger'}`,
      `---------------------------------`,
      `📦 *Total Bills Created:* ${summary.totalBills} (₹${summary.totalAmount.toLocaleString('en-IN', { minimumFractionDigits: 2 })})`,
      `✅ *Debited in Ledger:* ${summary.debitedBills.length} (₹${summary.debitedAmount.toLocaleString('en-IN', { minimumFractionDigits: 2 })})`,
      `⚠️ *Pending Debit:* ${summary.pendingBills.length} (₹${summary.pendingAmount.toLocaleString('en-IN', { minimumFractionDigits: 2 })})`,
      `---------------------------------`
    ];

    if (summary.pendingBills.length > 0) {
      lines.push(`*PENDING BILLS TO DEBIT:*`);
      summary.pendingBills.forEach((b, i) => {
        lines.push(`${i + 1}. #${b.bill_no} - ${b.customer_name}: ₹${Number(b.total_amount).toLocaleString('en-IN')}`);
      });
    } else {
      lines.push(`All ${summary.totalBills} bills are verified & debited in the ledger!`);
    }

    const text = lines.join('\n');
    navigator.clipboard.writeText(text).then(() => {
      setCopiedSummary(true);
      setTimeout(() => setCopiedSummary(false), 2500);
    });
  };

  const handlePrint = () => {
    window.print();
  };

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto space-y-4 animate-in fade-in duration-200">
      
      {/* Top Header Bar - Simple text, no background color, no borders */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-2">
        <div>
          <div className="flex items-center gap-2">
            <FileText size={20} className="text-[#0055a5] shrink-0" />
            <div>
              <h1 className="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight">
                Bill Declaration & Audit
              </h1>
              <p className="text-xs sm:text-sm text-slate-500">
                Verify today's billing stock database entries against debits in {activeLedger?.name || 'the ledger'}
              </p>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3 text-xs">
          {/* Quick Date Buttons - Simple text */}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setSelectedDate(todayStr)}
              className={`font-medium transition-colors cursor-pointer ${
                selectedDate === todayStr 
                  ? 'text-blue-700 font-bold underline' 
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Today
            </button>
            <span className="text-slate-300">•</span>
            <button
              type="button"
              onClick={() => setSelectedDate(yesterdayStr)}
              className={`font-medium transition-colors cursor-pointer ${
                selectedDate === yesterdayStr 
                  ? 'text-blue-700 font-bold underline' 
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Yesterday
            </button>
          </div>

          {/* Date Picker Input - Plain text */}
          <input
            type="date"
            value={selectedDate}
            onChange={e => e.target.value && setSelectedDate(e.target.value)}
            className="px-1 py-0.5 text-xs sm:text-sm bg-transparent text-slate-800 font-mono focus:outline-none"
          />

          {/* Action Tools - Plain text buttons */}
          <button
            type="button"
            onClick={() => loadBills(selectedDate)}
            disabled={isLoading}
            className="text-slate-600 hover:text-slate-900 transition-colors flex items-center gap-1 text-xs cursor-pointer"
            title="Refresh bills from billing database"
          >
            <RefreshCw size={13} className={isLoading ? 'animate-spin text-blue-600' : ''} />
            <span>Sync</span>
          </button>

          <button
            type="button"
            onClick={handleCopyDeclaration}
            className="text-slate-600 hover:text-slate-900 text-xs font-medium transition-colors flex items-center gap-1 cursor-pointer"
            title="Copy declaration summary for WhatsApp"
          >
            {copiedSummary ? <Check size={13} className="text-emerald-600" /> : <Copy size={13} />}
            <span>{copiedSummary ? 'Copied' : 'Share'}</span>
          </button>

          <button
            type="button"
            onClick={handlePrint}
            className="text-slate-600 hover:text-slate-900 text-xs transition-colors hidden sm:flex items-center gap-1 cursor-pointer"
            title="Print declaration report"
          >
            <Printer size={13} />
            <span>Print</span>
          </button>
        </div>
      </div>

      {/* KPI Summary - Simple text display, no background colors, no card borders */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 py-1">
        {/* Total Bills */}
        <div className="space-y-0.5">
          <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
            Total Bills Created
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-xl sm:text-2xl font-bold text-slate-900 font-mono">
              {summary.totalBills}
            </span>
            <span className="text-xs sm:text-sm font-semibold text-slate-600 font-mono">
              ₹{summary.totalAmount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
            </span>
          </div>
          <div className="text-[10px] text-slate-400">
            For {selectedDate === todayStr ? "Today's Date" : selectedDate}
          </div>
        </div>

        {/* Debited in Ledger */}
        <div className="space-y-0.5">
          <div className="text-[11px] font-bold uppercase tracking-wider text-emerald-700">
            Debited in Ledger
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-xl sm:text-2xl font-bold text-emerald-700 font-mono">
              {summary.debitedBills.length}
            </span>
            <span className="text-xs sm:text-sm font-semibold text-emerald-700 font-mono">
              ₹{summary.debitedAmount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
            </span>
          </div>
          <div className="text-[10px] text-emerald-600">
            {summary.totalBills > 0 ? Math.round((summary.debitedBills.length / summary.totalBills) * 100) : 0}% Reconciled
          </div>
        </div>

        {/* Pending Entry */}
        <div className="space-y-0.5">
          <div className="text-[11px] font-bold uppercase tracking-wider text-amber-800">
            Pending / Not Debited
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-xl sm:text-2xl font-bold font-mono text-amber-900">
              {summary.pendingBills.length}
            </span>
            <span className="text-xs sm:text-sm font-semibold font-mono text-amber-900">
              ₹{summary.pendingAmount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
            </span>
          </div>
          <div className="text-[10px] text-amber-700 font-medium">
            {summary.pendingBills.length > 0 ? 'Bills generated but not debited yet' : 'All generated bills are debited'}
          </div>
        </div>
      </div>

      {/* Reminder Banner - Simple text line, no background box, no borders */}
      {summary.pendingBills.length > 0 && (
        <div className="py-1 text-xs text-amber-900 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2">
          <div className="flex items-center gap-1.5">
            <AlertTriangle className="text-amber-600 shrink-0" size={14} />
            <span className="font-semibold">
              Reminder: {summary.pendingBills.length} {summary.pendingBills.length === 1 ? 'bill' : 'bills'} (₹{summary.pendingAmount.toLocaleString('en-IN')}) generated today are NOT debited in the ledger yet!
            </span>
          </div>
          <button
            type="button"
            onClick={() => {
              if (summary.pendingBills.length > 0) {
                handleDebitBill(summary.pendingBills[0]);
              }
            }}
            className="text-amber-800 hover:text-amber-950 font-bold underline flex items-center gap-1 cursor-pointer"
          >
            <span>Debit Next Bill</span>
            <ArrowRight size={12} />
          </button>
        </div>
      )}

      {/* Reconciled Banner - Simple text, no background box, no borders */}
      {summary.totalBills > 0 && summary.pendingBills.length === 0 && (
        <div className="py-1 text-xs text-emerald-800 flex items-center gap-1.5">
          <CheckCircle2 className="text-emerald-600 shrink-0" size={14} />
          <span className="font-semibold">
            Complete Reconciliation! All {summary.totalBills} bills created on {selectedDate} have been debited in the ledger.
          </span>
        </div>
      )}

      {/* Filters Control Bar - Simple text layout, no background color, no borders */}
      <div className="py-2 flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3 text-xs">
        {/* Step 1: Filter Date */}
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[10px] sm:text-xs font-bold uppercase text-slate-500 tracking-wider">
            1. Date Filter:
          </span>
          <button
            type="button"
            onClick={() => setSelectedDate(todayStr)}
            className={`font-semibold transition-colors cursor-pointer ${
              selectedDate === todayStr
                ? 'text-[#0055a5] underline font-bold'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Today
          </button>
          <span className="text-slate-300">•</span>
          <button
            type="button"
            onClick={() => setSelectedDate(yesterdayStr)}
            className={`font-semibold transition-colors cursor-pointer ${
              selectedDate === yesterdayStr
                ? 'text-[#0055a5] underline font-bold'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Yesterday
          </button>
          <span className="text-slate-300">•</span>
          <input
            type="date"
            value={selectedDate}
            onChange={e => e.target.value && setSelectedDate(e.target.value)}
            className="bg-transparent text-xs text-slate-800 font-mono focus:outline-none"
          />
        </div>

        {/* Step 2: Filter Order Status */}
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[10px] sm:text-xs font-bold uppercase text-slate-500 tracking-wider">
            2. Order Status:
          </span>
          <div className="inline-flex items-center gap-2">
            <button
              type="button"
              onClick={() => setOrderStatusFilter('ALL')}
              className={`text-xs font-semibold transition-colors cursor-pointer ${
                orderStatusFilter === 'ALL'
                  ? 'text-slate-900 font-bold underline'
                  : 'text-slate-500 hover:text-slate-900'
              }`}
            >
              All ({bills.length})
            </button>
            <span className="text-slate-300">•</span>
            <button
              type="button"
              onClick={() => setOrderStatusFilter('DELIVERED_OR_APPROVED')}
              className={`text-xs font-bold transition-colors cursor-pointer ${
                orderStatusFilter === 'DELIVERED_OR_APPROVED'
                  ? 'text-blue-700 underline'
                  : 'text-slate-500 hover:text-slate-900'
              }`}
              title="Show only Delivered or Approved orders"
            >
              Delivered & Approved ({bills.filter(b => {
                const s = (b.status || '').toUpperCase().trim();
                return s === 'DELIVERED' || s === 'APPROVED';
              }).length})
            </button>
          </div>
        </div>
      </div>

      {/* Filter Tabs & Search Bar - Simple text layout, no background color, no borders */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 pt-1">
        <div className="flex items-center gap-3 overflow-x-auto text-xs sm:text-sm">
          <button
            type="button"
            onClick={() => setActiveTab('pending')}
            className={`font-semibold transition-colors whitespace-nowrap cursor-pointer ${
              activeTab === 'pending'
                ? 'text-amber-800 font-bold underline'
                : 'text-slate-500 hover:text-slate-900'
            }`}
          >
            Pending Debit ({summary.pendingBills.length})
          </button>

          <span className="text-slate-300">•</span>

          <button
            type="button"
            onClick={() => setActiveTab('all')}
            className={`font-semibold transition-colors whitespace-nowrap cursor-pointer ${
              activeTab === 'all'
                ? 'text-[#0055a5] font-bold underline'
                : 'text-slate-500 hover:text-slate-900'
            }`}
          >
            All Bills ({summary.totalBills})
          </button>

          <span className="text-slate-300">•</span>

          <button
            type="button"
            onClick={() => setActiveTab('debited')}
            className={`font-semibold transition-colors whitespace-nowrap cursor-pointer ${
              activeTab === 'debited'
                ? 'text-emerald-700 font-bold underline'
                : 'text-slate-500 hover:text-slate-900'
            }`}
          >
            Debited in Ledger ({summary.debitedBills.length})
          </button>
        </div>

        {/* Search Input - Simple text input */}
        <div className="relative sm:w-72">
          <Search className="absolute left-1 top-1/2 -translate-y-1/2 text-slate-400" size={14} />
          <input
            type="text"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="Search bill #, party, amount..."
            className="w-full pl-6 pr-2 py-1 text-xs sm:text-sm bg-transparent text-slate-900 placeholder:text-slate-400 focus:outline-none border-0"
          />
        </div>
      </div>

      {/* Bill List - Simple text list and text rows, no background color, no borders */}
      <div className="overflow-hidden">
        {isLoading ? (
          <div className="py-12 text-center text-slate-500 space-y-2">
            <div className="animate-spin rounded-full h-6 w-6 border-2 border-blue-600 border-t-transparent mx-auto"></div>
            <p className="text-xs sm:text-sm font-medium">Fetching bills from billing database...</p>
          </div>
        ) : error ? (
          <div className="py-8 text-center text-rose-600 space-y-2">
            <AlertTriangle className="mx-auto" size={24} />
            <p className="font-semibold text-sm">Failed to load billing records</p>
            <p className="text-xs text-rose-500 font-mono">{error}</p>
            <button
              type="button"
              onClick={() => loadBills(selectedDate)}
              className="mt-2 text-rose-700 text-xs font-semibold underline cursor-pointer"
            >
              Retry Connection
            </button>
          </div>
        ) : filteredBills.length === 0 ? (
          <div className="py-12 px-2 text-center text-slate-400 space-y-1">
            <p className="font-semibold text-sm text-slate-600">
              {bills.length === 0 
                ? `No bills were created on ${selectedDate}` 
                : activeTab === 'pending'
                  ? 'Great job! No pending bills left to debit for this date.'
                  : 'No matching bills found.'}
            </p>
            <p className="text-xs text-slate-400 max-w-sm mx-auto">
              {bills.length === 0 
                ? 'Try selecting a different date from the date selector above.' 
                : 'All matching items are displayed above.'}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs sm:text-sm border-collapse">
              <thead>
                <tr className="text-slate-400 uppercase tracking-wider text-[10px] sm:text-xs">
                  <th className="py-2 pr-3 font-semibold">Bill No</th>
                  <th className="py-2 px-3 font-semibold">Customer / Party</th>
                  <th className="py-2 px-3 font-semibold">Bill Date</th>
                  <th className="py-2 px-3 font-semibold text-right">Amount (₹)</th>
                  <th className="py-2 px-3 font-semibold">Billing Status</th>
                  <th className="py-2 px-3 font-semibold">Ledger Entry Status</th>
                  <th className="py-2 pl-3 font-semibold text-right">Action</th>
                </tr>
              </thead>
              <tbody className="font-normal text-xs sm:text-sm">
                {filteredBills.map(({ bill, isDebited, matchedTx }) => {
                  return (
                    <tr 
                      key={bill.id} 
                      className="cursor-pointer hover:text-slate-900 transition-colors"
                      onClick={() => setSelectedOrderDetails({ bill, isDebited, matchedTx })}
                    >
                      {/* Bill No */}
                      <td className="py-2 pr-3 font-mono font-bold text-slate-900">
                        <div className="flex items-center gap-1.5">
                          <span className="text-slate-900">
                            #{bill.bill_no}
                          </span>
                          {bill.bill_type && (
                            <span className="text-[10px] text-slate-400 font-sans uppercase font-normal">
                              ({bill.bill_type.replace('_', ' ')})
                            </span>
                          )}
                        </div>
                      </td>

                      {/* Customer / Party */}
                      <td className="py-2 px-3">
                        <div className="font-semibold text-slate-900">
                          {bill.customer_name || 'Anonymous Customer'}
                        </div>
                        <div className="text-[11px] text-slate-400 flex items-center gap-2 mt-0.5">
                          {bill.phone_number && <span>Ph: {bill.phone_number}</span>}
                          {bill.driver_name && <span>Driver: {bill.driver_name}</span>}
                          {bill.vehicle_number && <span>Veh: {bill.vehicle_number}</span>}
                        </div>
                      </td>

                      {/* Bill Date */}
                      <td className="py-2 px-3 text-slate-600 font-mono text-xs">
                        {bill.bill_date || selectedDate}
                      </td>

                      {/* Amount */}
                      <td className="py-2 px-3 text-right font-mono font-bold text-slate-900 text-sm">
                        ₹{Number(bill.total_amount).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                      </td>

                      {/* Billing Status - Simple text, no background color, no border */}
                      <td className="py-2 px-3">
                        <span className={`text-xs font-medium uppercase tracking-wider ${
                          bill.status === 'DELIVERED' || bill.status === 'APPROVED'
                            ? 'text-emerald-700'
                            : bill.status === 'CANCELLED'
                              ? 'text-rose-700'
                              : 'text-slate-700'
                        }`}>
                          {bill.status || 'CREATED'}
                        </span>
                      </td>

                      {/* Ledger Status - Simple text, no background color, no border */}
                      <td className="py-2 px-3">
                        {isDebited ? (
                          <div className="space-y-0.5">
                            <span className="text-emerald-700 font-medium text-xs">
                              Debited in Ledger
                            </span>
                            {matchedTx && (
                              <div className="text-[10.5px] text-slate-400">
                                Voucher: #{matchedTx.invoiceNo || matchedTx.id?.slice(0, 6)} • ₹{matchedTx.amount?.toFixed(2)}
                              </div>
                            )}
                          </div>
                        ) : (
                          <span className="text-rose-600 font-medium text-xs">
                            Not Debited Yet
                          </span>
                        )}
                      </td>

                      {/* Action - Simple text links without button background or borders */}
                      <td className="py-2 pl-3 text-right" onClick={e => e.stopPropagation()}>
                        <div className="flex items-center justify-end gap-3">
                          <button
                            type="button"
                            onClick={() => setSelectedOrderDetails({ bill, isDebited, matchedTx })}
                            className="text-xs text-slate-500 hover:text-slate-900 font-medium cursor-pointer"
                            title="View full order details"
                          >
                            Details
                          </button>
                          {isDebited ? (
                            <span className="text-xs text-slate-400 font-medium">
                              Recorded
                            </span>
                          ) : (
                            <button
                              type="button"
                              onClick={() => handleDebitBill(bill)}
                              className="text-xs font-semibold text-[#0055a5] hover:underline cursor-pointer"
                              title="Auto-fill this bill into Master Entry"
                            >
                              Debit Now
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Footer info - Simple text, no background color, no border */}
        <div className="py-2 flex flex-col sm:flex-row items-center justify-between text-[11px] text-slate-400 gap-2">
          <div>
            Showing {filteredBills.length} of {bills.length} bills from Turso Stock Database
          </div>
          <div>
            Last checked: {lastRefreshedAt.toLocaleTimeString()}
          </div>
        </div>
      </div>

      {/* ========================================================================= */}
      {/* ORDER DETAILS MODAL                                                       */}
      {/* ========================================================================= */}
      {selectedOrderDetails && (
        <div 
          className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-150"
          onClick={() => setSelectedOrderDetails(null)}
        >
          <div 
            className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-lg overflow-hidden animate-in zoom-in-95 duration-150"
            onClick={e => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="px-4 py-3 sm:px-5 sm:py-3.5 border-b border-slate-100 flex items-center justify-between bg-slate-50/70">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-blue-50 border border-blue-200 text-[#0055a5] flex items-center justify-center font-bold">
                  <Package size={16} />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-sm sm:text-base font-bold text-slate-900 tracking-tight">
                      Order Details #{selectedOrderDetails.bill.bill_no}
                    </h3>
                    <span className={`px-2 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider ${
                      selectedOrderDetails.bill.status === 'DELIVERED' || selectedOrderDetails.bill.status === 'APPROVED'
                        ? 'bg-blue-50 text-blue-700 border border-blue-200'
                        : selectedOrderDetails.bill.status === 'CANCELLED'
                          ? 'bg-rose-50 text-rose-700 border border-rose-200'
                          : 'bg-slate-100 text-slate-700 border border-slate-200'
                    }`}>
                      {selectedOrderDetails.bill.status || 'CREATED'}
                    </span>
                  </div>
                  <p className="text-[10.5px] text-slate-500 mt-0.5">
                    Filter Date: <span className="font-mono text-slate-700">{selectedDate}</span> • Status: <span className="font-semibold text-slate-700">{selectedOrderDetails.bill.status || 'CREATED'}</span>
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setSelectedOrderDetails(null)}
                className="w-7 h-7 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 flex items-center justify-center transition-colors cursor-pointer"
              >
                <X size={16} />
              </button>
            </div>

            {/* Modal Body - Simple text, no background color, no borders */}
            <div className="p-4 sm:p-5 space-y-3 max-h-[75vh] overflow-y-auto text-xs text-slate-700">
              {/* Customer / Party */}
              <div className="space-y-1">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <span className="text-[10px] uppercase font-semibold text-slate-400">
                      Customer / Party
                    </span>
                    <h4 className="text-sm font-bold text-slate-900">
                      {selectedOrderDetails.bill.customer_name || 'Anonymous Customer'}
                    </h4>
                  </div>
                  {(() => {
                    const match = findMatchingParty(selectedOrderDetails.bill.customer_name, parties);
                    return match ? (
                      <span className="text-[10px] font-medium text-emerald-700">
                        ✓ Matched: {match.name}
                      </span>
                    ) : null;
                  })()}
                </div>

                <div className="text-[11px] text-slate-600 space-y-0.5">
                  {selectedOrderDetails.bill.phone_number && (
                    <div className="flex items-center gap-1.5">
                      <span className="text-slate-400">Phone:</span>
                      <span>{selectedOrderDetails.bill.phone_number}</span>
                    </div>
                  )}
                  {selectedOrderDetails.bill.customer_address && (
                    <div className="flex items-center gap-1.5">
                      <span className="text-slate-400">Address:</span>
                      <span className="truncate">{selectedOrderDetails.bill.customer_address}</span>
                    </div>
                  )}
                </div>
              </div>

              {/* Financial & Order Specs - Simple text */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-1 text-xs">
                <div>
                  <span className="text-[10px] uppercase font-medium text-slate-400 block">Order Amount</span>
                  <span className="text-sm sm:text-base font-bold text-slate-900 font-mono">
                    ₹{Number(selectedOrderDetails.bill.total_amount).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                  </span>
                </div>
                <div>
                  <span className="text-[10px] uppercase font-medium text-slate-400 block">Total Qty</span>
                  <span className="text-sm sm:text-base font-semibold text-slate-800">
                    {selectedOrderDetails.bill.total_qty || 0} pcs
                  </span>
                </div>
                <div>
                  <span className="text-[10px] uppercase font-medium text-slate-400 block">Total Weight</span>
                  <span className="text-sm sm:text-base font-semibold text-slate-800">
                    {selectedOrderDetails.bill.total_weight ? `${selectedOrderDetails.bill.total_weight} kg` : 'N/A'}
                  </span>
                </div>
                <div>
                  <span className="text-[10px] uppercase font-medium text-slate-400 block">Bill Type</span>
                  <span className="text-sm sm:text-base font-semibold text-slate-800 uppercase">
                    {selectedOrderDetails.bill.bill_type ? selectedOrderDetails.bill.bill_type.replace('_', ' ') : 'Standard'}
                  </span>
                </div>
              </div>

              {/* Order Items Breakdown (Name, Qty, Rate, Amount) */}
              <div className="pt-2">
                <div className="flex items-center justify-between pb-1.5 border-b border-slate-100">
                  <div className="flex items-center gap-1.5">
                    <Package size={13} className="text-[#0055a5]" />
                    <span className="text-[10px] uppercase font-bold tracking-wider text-slate-600">
                      Ordered Items {orderItems.length > 0 ? `(${orderItems.length})` : ''}
                    </span>
                  </div>
                  {orderItems.length > 0 && (
                    <span className="text-[10px] text-slate-400 font-medium">
                      Total: {orderItems.reduce((acc, it) => acc + (Number(it.qty) || 0), 0)} pcs
                    </span>
                  )}
                </div>

                {isLoadingItems ? (
                  <div className="py-4 text-center text-slate-400 flex items-center justify-center gap-1.5 text-xs">
                    <Loader2 size={13} className="animate-spin text-[#0055a5]" />
                    <span>Loading ordered items...</span>
                  </div>
                ) : orderItems.length === 0 ? (
                  <div className="py-3 text-center text-slate-400 text-[11px] italic bg-slate-50/50 rounded-lg my-1">
                    No individual item details found for this bill.
                  </div>
                ) : (
                  <div className="overflow-x-auto mt-1 border border-slate-100 rounded-lg">
                    <table className="w-full text-left text-xs">
                      <thead>
                        <tr className="text-[9px] uppercase font-semibold text-slate-400 bg-slate-50/60 border-b border-slate-100">
                          <th className="py-1.5 px-2 w-7">#</th>
                          <th className="py-1.5 px-2">Item Name</th>
                          <th className="py-1.5 px-2 text-center w-16">Qty</th>
                          <th className="py-1.5 px-2 text-right w-20">Rate</th>
                          <th className="py-1.5 px-2 text-right w-24">Amount</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 text-[11px]">
                        {orderItems.map((item, idx) => {
                          const itemQty = Number(item.qty) || 0;
                          const itemRate = Number(item.rate) || 0;
                          const itemTotal = Number(item.line_total) || (itemQty * itemRate);
                          return (
                            <tr key={item.id || idx} className="hover:bg-slate-50/50">
                              <td className="py-1.5 px-2 text-slate-400 text-[10px] tabular-nums">
                                {idx + 1}
                              </td>
                              <td className="py-1.5 px-2 font-medium text-slate-900">
                                {item.product_name}
                                {item.mark_text && (
                                  <span className="ml-1 text-[8.5px] text-amber-600">({item.mark_text})</span>
                                )}
                              </td>
                              <td className="py-1.5 px-2 text-center font-bold text-slate-800 tabular-nums">
                                {itemQty}
                              </td>
                              <td className="py-1.5 px-2 text-right text-slate-500 tabular-nums">
                                ₹{itemRate.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                              </td>
                              <td className="py-1.5 px-2 text-right font-bold text-slate-900 tabular-nums">
                                ₹{itemTotal.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                      <tfoot>
                        <tr className="border-t border-slate-200 font-bold text-slate-900 bg-slate-50/70 text-[11px]">
                          <td colSpan={2} className="py-1.5 px-2 text-[10px] uppercase text-slate-500">
                            Total
                          </td>
                          <td className="py-1.5 px-2 text-center tabular-nums text-slate-900">
                            {orderItems.reduce((acc, it) => acc + (Number(it.qty) || 0), 0)} pcs
                          </td>
                          <td className="py-1.5 px-2"></td>
                          <td className="py-1.5 px-2 text-right tabular-nums text-slate-900">
                            ₹{orderItems.reduce((acc, it) => acc + (Number(it.line_total) || (Number(it.qty || 0) * Number(it.rate || 0))), 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          </td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                )}
              </div>

              {/* Transport & Dispatch Details - Simple text */}
              <div className="space-y-1 pt-1 text-[11px]">
                <span className="text-[10px] uppercase font-semibold text-slate-400 block">
                  Logistics & Transport
                </span>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  <div>
                    <span className="text-slate-400 text-[10px] block">Vehicle No:</span>
                    <span className="font-semibold text-slate-800">{selectedOrderDetails.bill.vehicle_number || '—'}</span>
                  </div>
                  <div>
                    <span className="text-slate-400 text-[10px] block">Driver:</span>
                    <span className="font-semibold text-slate-800">{selectedOrderDetails.bill.driver_name || '—'}</span>
                  </div>
                  <div>
                    <span className="text-slate-400 text-[10px] block">Driver Contact:</span>
                    <span className="font-semibold text-slate-800">{selectedOrderDetails.bill.driver_contact || '—'}</span>
                  </div>
                  <div>
                    <span className="text-slate-400 text-[10px] block">Salesman:</span>
                    <span className="font-semibold text-slate-800">{selectedOrderDetails.bill.salesman_name || '—'}</span>
                  </div>
                  <div>
                    <span className="text-slate-400 text-[10px] block">UPI / Ref:</span>
                    <span className="font-mono text-slate-800">{selectedOrderDetails.bill.payment_upi || '—'}</span>
                  </div>
                  <div>
                    <span className="text-slate-400 text-[10px] block">Order Date:</span>
                    <span className="font-mono text-slate-800">{selectedOrderDetails.bill.bill_date || selectedDate}</span>
                  </div>
                </div>

                {selectedOrderDetails.bill.remark && (
                  <div className="pt-1">
                    <span className="text-slate-400 text-[10px] block">Remark / Notes:</span>
                    <p className="text-slate-700 italic text-[11px]">{selectedOrderDetails.bill.remark}</p>
                  </div>
                )}
              </div>

              {/* Ledger Debit Status - Simple text */}
              <div className="pt-2 flex items-center justify-between gap-3 text-xs">
                <div>
                  <p className={`font-semibold text-xs sm:text-sm ${selectedOrderDetails.isDebited ? 'text-emerald-700' : 'text-slate-800'}`}>
                    {selectedOrderDetails.isDebited ? 'Debited in Ledger' : 'Pending Ledger Debit'}
                  </p>
                  <p className="text-[10.5px] text-slate-500 mt-0.5">
                    {selectedOrderDetails.isDebited 
                      ? 'This stock order has been verified and debited in your ledger.' 
                      : 'Click Debit Now to prefill and record this bill into Master Entry.'}
                  </p>
                </div>

                {!selectedOrderDetails.isDebited ? (
                  <button
                    type="button"
                    onClick={() => {
                      const b = selectedOrderDetails.bill;
                      setSelectedOrderDetails(null);
                      handleDebitBill(b);
                    }}
                    className="px-3 py-1.5 bg-[#0055a5] hover:bg-blue-800 text-white rounded-md text-xs font-semibold shadow-xs transition-colors shrink-0 flex items-center gap-1 cursor-pointer"
                  >
                    <PlusCircle size={13} />
                    <span>Debit Now</span>
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedOrderDetails(null);
                      navigate('/log');
                    }}
                    className="px-3 py-1.5 text-emerald-800 hover:text-emerald-950 hover:bg-emerald-50 rounded-md text-xs font-semibold transition-colors shrink-0 cursor-pointer"
                  >
                    View in Log
                  </button>
                )}
              </div>
            </div>

            {/* Modal Footer */}
            <div className="px-4 py-3 bg-slate-50 border-t border-slate-100 flex items-center justify-between text-xs">
              <span className="text-slate-400 text-[10.5px]">
                Created: {selectedOrderDetails.bill.created_at ? new Date(selectedOrderDetails.bill.created_at).toLocaleString() : 'N/A'}
              </span>
              <button
                type="button"
                onClick={() => setSelectedOrderDetails(null)}
                className="px-3.5 py-1.5 bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 font-semibold rounded-lg shadow-2xs transition-colors cursor-pointer"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
