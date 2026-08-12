import React, { useEffect, useState, useMemo } from 'react';
import { db, handleFirestoreError, OperationType, collection, query, where, getDocs, limit, orderBy } from '../firebase';
import { Party, Transaction, DashboardSummary, LEDGER_TYPE_LABELS, Ledger } from '../types';
import { 
  FileUp, 
  TrendingUp, 
  TrendingDown, 
  Clock, 
  Loader2, 
  BookOpen, 
  PlusCircle, 
  FolderPlus, 
  ArrowUpRight, 
  ArrowDownRight, 
  Calendar, 
  DollarSign, 
  Wallet, 
  ChevronRight 
} from 'lucide-react';
import { useLedger } from '../LedgerContext';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { format, subDays, startOfDay, endOfDay, parseISO } from 'date-fns';
import { syncCollection } from '../lib/syncCache';
import { getFilteredCacheItems } from '../lib/idbCache';
import CompanyLogo from '../components/CompanyLogo';

// Professional ledger-themed color maps for UI accent continuity
const themeMap: Record<Ledger['type'], {
  gradient: string;
  badgeBg: string;
  glow: string;
}> = {
  SALE: {
    gradient: 'from-slate-900 via-slate-850 to-sky-950',
    badgeBg: 'bg-sky-50 dark:bg-sky-950/40 text-sky-700 dark:text-sky-300 border-sky-100 dark:border-sky-900/50',
    glow: 'bg-sky-500'
  },
  PURCHASE: {
    gradient: 'from-slate-900 via-slate-850 to-purple-950',
    badgeBg: 'bg-purple-50 dark:bg-purple-950/40 text-purple-700 dark:text-purple-300 border-purple-100 dark:border-purple-900/50',
    glow: 'bg-purple-500'
  },
  CASH_BANK: {
    gradient: 'from-slate-900 via-slate-850 to-teal-950',
    badgeBg: 'bg-teal-50 dark:bg-teal-950/40 text-teal-700 dark:text-teal-300 border-teal-100 dark:border-teal-900/50',
    glow: 'bg-teal-500'
  },
  EXPENSE: {
    gradient: 'from-slate-900 via-slate-850 to-rose-950',
    badgeBg: 'bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 border-rose-100 dark:border-rose-900/50',
    glow: 'bg-rose-500'
  },
  ASSET: {
    gradient: 'from-slate-900 via-slate-850 to-emerald-950',
    badgeBg: 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border-emerald-100 dark:border-emerald-900/50',
    glow: 'bg-emerald-500'
  },
  LIABILITY: {
    gradient: 'from-slate-900 via-slate-850 to-amber-950',
    badgeBg: 'bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 border-amber-100 dark:border-amber-900/50',
    glow: 'bg-amber-500'
  },
  CAPITAL: {
    gradient: 'from-slate-900 via-slate-850 to-indigo-950',
    badgeBg: 'bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300 border-indigo-100 dark:border-indigo-900/50',
    glow: 'bg-indigo-500'
  }
};

export default function Dashboard() {
  const { activeLedger, ledgers, createLedger, setActiveLedgerId } = useLedger();
  const [parties, setParties] = useState<Party[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [newLedgerName, setNewLedgerName] = useState('');
  const [newLedgerType, setNewLedgerType] = useState<Ledger['type']>('SALE');
  const [createError, setCreateError] = useState<string | null>(null);
  const [isCreatingLedger, setIsCreatingLedger] = useState(false);

  // Simple Range Presets for Professional Mobile UX
  const [rangePreset, setRangePreset] = useState<'7D' | '30D' | 'CUSTOM'>('7D');
  const [filterStartDate, setFilterStartDate] = useState(format(subDays(new Date(), 6), 'yyyy-MM-dd'));
  const [filterEndDate, setFilterEndDate] = useState(format(new Date(), 'yyyy-MM-dd'));

  // Mobile list tabs to avoid long vertical scrolling
  const [partyTab, setPartyTab] = useState<'dues' | 'advances'>('dues');

  // Triggered when preset changes
  useEffect(() => {
    if (rangePreset === '7D') {
      setFilterStartDate(format(subDays(new Date(), 6), 'yyyy-MM-dd'));
      setFilterEndDate(format(new Date(), 'yyyy-MM-dd'));
    } else if (rangePreset === '30D') {
      setFilterStartDate(format(subDays(new Date(), 29), 'yyyy-MM-dd'));
      setFilterEndDate(format(new Date(), 'yyyy-MM-dd'));
    }
  }, [rangePreset]);

  // Load and Sync Local Cache
  const syncDashboardData = async () => {
    if (!activeLedger?.id) return;
    setIsLoading(true);
    try {
      // 1. Sync parties cache
      await syncCollection<Party>('parties', activeLedger.id, 'parties');
      const cachedParties = await getFilteredCacheItems<Party>('parties', p => p.ledgerId === activeLedger.id);
      setParties(cachedParties);

      // 2. Sync dashboard summary cache
      await syncCollection<DashboardSummary>('dashboard_summary', activeLedger.id, 'dashboard_summary');
      const cachedSummaries = await getFilteredCacheItems<DashboardSummary>('dashboard_summary', s => s.ledgerId === activeLedger.id);
      if (cachedSummaries.length > 0) {
        setSummary(cachedSummaries[0]);
      } else {
        setSummary({
          id: activeLedger.id,
          ledgerId: activeLedger.id,
          totalReceivable: cachedParties.filter(p => p.currentDue > 0).reduce((a, b) => a + b.currentDue, 0),
          totalPayable: cachedParties.filter(p => p.currentDue < 0).reduce((a, b) => a + Math.abs(b.currentDue), 0),
          totalTransactions: 0,
          totalParties: cachedParties.length
        });
      }

      // 3. Index-free transactions caching and filtering
      await syncCollection<Transaction>('transactions', activeLedger.id, 'transactions');
      const cachedTxs = await getFilteredCacheItems<Transaction>('transactions', t => t.ledgerId === activeLedger.id);
      
      const startTs = startOfDay(parseISO(filterStartDate)).getTime();
      const endTs = endOfDay(parseISO(filterEndDate)).getTime();
      
      const rangeTxs = cachedTxs.filter(t => t.timestamp >= startTs && t.timestamp <= endTs);
      setTransactions(rangeTxs);
    } catch (e) {
      console.error("Dashboard cache retrieval failed:", e);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    syncDashboardData();

    const handleSync = () => {
      syncDashboardData();
    };
    window.addEventListener('database-synced', handleSync);
    return () => {
      window.removeEventListener('database-synced', handleSync);
    };
  }, [activeLedger?.id, filterStartDate, filterEndDate]);

  // Generate 7-day trend chart from the queried transactions scope with safe numeric validation
  const chartData = useMemo(() => {
    const data = [];
    for (let i = 6; i >= 0; i--) {
      const date = subDays(new Date(), i);
      const start = startOfDay(date).getTime();
      const end = endOfDay(date).getTime();
      
      const dayTxs = transactions.filter(t => {
        const amt = Number(t.amount);
        return t.timestamp >= start && t.timestamp <= end && isFinite(amt) && amt < 1e11;
      });
      const debit = dayTxs.filter(t => t.type === 'DEBIT').reduce((acc, t) => acc + (Number(t.amount) || 0), 0);
      const credit = dayTxs.filter(t => t.type === 'CREDIT').reduce((acc, t) => acc + (Number(t.amount) || 0), 0);
      
      data.push({
        name: format(date, 'MMM dd'),
        debit,
        credit
      });
    }
    return data;
  }, [transactions]);

  if (!activeLedger) {
    const handleCreateLedgerSubmit = async (e: React.FormEvent) => {
      e.preventDefault();
      if (!newLedgerName.trim()) {
        setCreateError('Please enter a name for the ledger.');
        return;
      }
      setIsCreatingLedger(true);
      setCreateError(null);
      try {
        await createLedger(newLedgerName.trim(), newLedgerType);
        setNewLedgerName('');
      } catch (err: any) {
        setCreateError(err.message || String(err));
      } finally {
        setIsCreatingLedger(false);
      }
    };

    return (
      <div className="p-4 sm:p-8 max-w-4xl mx-auto w-full pb-24 sm:pb-8 flex flex-col items-center justify-center min-h-[70vh]">
        <div className="w-full max-w-2xl bg-white rounded-2xl shadow-xl border border-gray-100 overflow-hidden">
          {/* Header */}
          <div className="p-8 bg-gradient-to-br from-sky-50 to-indigo-50 border-b border-gray-100 text-center sm:text-left flex flex-col sm:flex-row items-center gap-6">
            <div className="w-16 h-16 bg-sky-600 rounded-2xl flex items-center justify-center text-white shadow-lg shadow-sky-500/25 flex-shrink-0 animate-pulse">
              <BookOpen size={32} />
            </div>
            <div>
              <div className="flex flex-col sm:flex-row sm:items-center gap-1.5 justify-center sm:justify-start">
                <span className="text-sm font-semibold uppercase text-gray-500 tracking-wider">Welcome to</span>
                <CompanyLogo className="h-16 w-auto -mt-1 self-center sm:self-auto" variant="color" />
              </div>
              <p className="text-gray-600 mt-1.5 text-sm leading-relaxed">
                Connect and manage your finances securely. To begin tracking parties, products, and transaction sheets in your live database, please select or create a ledger.
              </p>
            </div>
          </div>

          <div className="p-8 space-y-8">
            {/* 1. Select Existing Ledger if any */}
            {ledgers.length > 0 && (
              <div>
                <h3 className="text-sm font-extrabold uppercase tracking-wider text-gray-400 mb-3 flex items-center gap-2">
                  <FolderPlus size={16} className="text-sky-500" />
                  Select an Existing Ledger
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {ledgers.map(l => (
                    <button
                      key={l.id}
                      onClick={() => setActiveLedgerId(l.id)}
                      className="flex items-center justify-between p-4 bg-gray-50 hover:bg-sky-50/80 hover:border-sky-300 border border-gray-200/80 rounded-xl transition-all duration-150 text-left group animate-fade-in"
                    >
                      <div className="overflow-hidden mr-3">
                        <p className="font-bold text-gray-900 truncate group-hover:text-sky-950 text-sm">{l.name}</p>
                        <p className="text-xs text-gray-500 mt-1 uppercase tracking-tight">{LEDGER_TYPE_LABELS[l.type] || l.type}</p>
                      </div>
                      <span className="text-xs font-bold text-sky-600 bg-sky-100/50 px-2.5 py-1 rounded-full group-hover:bg-sky-600 group-hover:text-white transition-all">
                        Activate
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* 2. Create New Ledger Form */}
            <div>
              <h3 className="text-sm font-extrabold uppercase tracking-wider text-gray-400 mb-3 flex items-center gap-2">
                <PlusCircle size={16} className="text-emerald-500" />
                Create a New Ledger
              </h3>
              
              <form onSubmit={handleCreateLedgerSubmit} className="space-y-4 bg-gray-50/50 p-5 border border-gray-100 rounded-xl">
                {createError && (
                  <div className="p-3 text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg">
                    {createError}
                  </div>
                )}
                
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider mb-1">Ledger Name</label>
                    <input
                      type="text"
                      required
                      placeholder="e.g. Main Sales Ledger 2026"
                      value={newLedgerName}
                      onChange={e => setNewLedgerName(e.target.value)}
                      className="w-full px-4 py-2 bg-white border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-sky-500/50 focus:border-sky-500 transition-colors"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider mb-1">Accounting Type</label>
                    <select
                      value={newLedgerType}
                      onChange={e => setNewLedgerType(e.target.value as Ledger['type'])}
                      className="w-full px-4 py-2 bg-white border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-sky-500/50 focus:border-sky-500 transition-colors"
                    >
                      {Object.entries(LEDGER_TYPE_LABELS).map(([key, label]) => (
                        <option key={key} value={key}>{label}</option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="flex justify-end pt-2">
                  <button
                    type="submit"
                    disabled={isCreatingLedger}
                    className="w-full sm:w-auto px-6 py-2.5 bg-sky-600 hover:bg-sky-700 disabled:opacity-50 text-white font-semibold text-sm rounded-lg transition-colors flex items-center justify-center gap-2"
                  >
                    {isCreatingLedger ? (
                      <>
                        <Loader2 className="animate-spin" size={16} />
                        Creating Ledger...
                      </>
                    ) : (
                      <>
                        <PlusCircle size={16} />
                        Create & Open Ledger
                      </>
                    )}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Calculate totals safely from parties & filtered transactions
  const totalReceivable = summary?.totalReceivable ?? parties.filter(p => p.currentDue > 0).reduce((a, b) => a + (Number(b.currentDue) || 0), 0);
  const totalPayable = summary?.totalPayable ?? parties.filter(p => p.currentDue < 0).reduce((a, b) => a + Math.abs(Number(b.currentDue) || 0), 0);
  const netBalance = totalReceivable - totalPayable;
  
  const periodDebit = transactions.filter(t => t.type === 'DEBIT').reduce((acc, t) => {
    const amt = Number(t.amount);
    return acc + (isFinite(amt) && amt < 1e11 ? amt : 0);
  }, 0);

  const periodCredit = transactions.filter(t => t.type === 'CREDIT').reduce((acc, t) => {
    const amt = Number(t.amount);
    return acc + (isFinite(amt) && amt < 1e11 ? amt : 0);
  }, 0);

  const formatCompactCurrency = (val: number) => {
    if (!isFinite(val) || isNaN(val)) return '₹0';
    const absVal = Math.abs(val);
    if (absVal >= 1e7) return `₹${(val / 1e7).toFixed(2)} Cr`;
    if (absVal >= 1e5) return `₹${(val / 1e5).toFixed(2)} L`;
    if (absVal >= 1e3) return `₹${(val / 1e3).toFixed(1)}k`;
    return `₹${val.toFixed(2)}`;
  };

  const isToday = filterStartDate === format(new Date(), 'yyyy-MM-dd') && filterEndDate === format(new Date(), 'yyyy-MM-dd');
  const isPurchaseStyle = activeLedger?.type === 'PURCHASE' || activeLedger?.type === 'LIABILITY' || activeLedger?.type === 'CAPITAL';
  
  let debitColor = '#ef4444';
  let creditColor = '#10b981';
  if (activeLedger) {
    switch (activeLedger.type) {
      case 'SALE':
        debitColor = '#0ea5e9'; // sky-500
        creditColor = '#10b981'; // emerald-500
        break;
      case 'PURCHASE':
        debitColor = '#8b5cf6'; // purple-500
        creditColor = '#f59e0b'; // amber-500
        break;
      case 'CASH_BANK':
        debitColor = '#0d9488'; // teal-600
        creditColor = '#10b981';
        break;
      case 'EXPENSE':
        debitColor = '#f43f5e'; // rose-500
        creditColor = '#f97316';
        break;
      case 'ASSET':
        debitColor = '#10b981';
        creditColor = '#6366f1';
        break;
      case 'LIABILITY':
        debitColor = '#d97706';
        creditColor = '#f43f5e';
        break;
      case 'CAPITAL':
        debitColor = '#6366f1';
        creditColor = '#fbbf24';
        break;
    }
  }

  const currentTheme = themeMap[activeLedger.type] || themeMap.SALE;

  return (
    <div className="p-4 sm:p-8 max-w-7xl mx-auto w-full pb-24 sm:pb-8">
      {/* Header and Professional Filter Bar */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-6 sm:mb-8 gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-xl sm:text-2xl font-black text-gray-950 dark:text-white tracking-tight flex items-center gap-2">
              Dashboard
            </h1>
            {isLoading && <Loader2 className="animate-spin text-gray-400" size={16} />}
            <span className={`text-[10px] font-bold uppercase px-2.5 py-0.5 rounded-full border ${currentTheme.badgeBg}`}>
              {LEDGER_TYPE_LABELS[activeLedger.type] || activeLedger.type}
            </span>
          </div>
          <p className="text-xs sm:text-sm text-gray-500 mt-1 font-medium">Overview of {activeLedger.name}</p>
        </div>
        
        {/* Compact Segmented Controller & Date Range Selector */}
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 w-full md:w-auto">
          {/* Preset Buttons */}
          <div className="flex items-center bg-gray-100 dark:bg-gray-800 p-1 rounded-xl self-start w-full sm:w-auto">
            {(['7D', '30D', 'CUSTOM'] as const).map((preset) => (
              <button
                key={preset}
                type="button"
                onClick={() => setRangePreset(preset)}
                className={`flex-1 sm:flex-initial px-4 py-1.5 rounded-lg text-xs font-bold transition-all ${
                  rangePreset === preset
                    ? 'bg-white dark:bg-gray-900 text-gray-950 dark:text-white shadow-xs'
                    : 'text-gray-500 hover:text-gray-900 dark:hover:text-gray-200'
                }`}
              >
                {preset === '7D' ? '7 Days' : preset === '30D' ? '30 Days' : 'Custom'}
              </button>
            ))}
          </div>

          {/* Date Inputs - ONLY expands elegantly when 'CUSTOM' is selected */}
          {rangePreset === 'CUSTOM' && (
            <div className="flex items-center gap-2 bg-white dark:bg-gray-900 px-3 py-1.5 rounded-xl border border-gray-200 dark:border-gray-800 shadow-xs animate-fade-in text-xs w-full sm:w-auto justify-between">
              <Calendar size={14} className="text-gray-400 shrink-0" />
              <input 
                type="date" 
                value={filterStartDate}
                onChange={(e) => {
                  setFilterStartDate(e.target.value);
                  setRangePreset('CUSTOM');
                }}
                className="bg-transparent border-none outline-none cursor-pointer focus:ring-0 text-gray-700 dark:text-gray-200 text-xs p-0 w-24"
              />
              <span className="text-gray-300">-</span>
              <input 
                type="date" 
                value={filterEndDate}
                onChange={(e) => {
                  setFilterEndDate(e.target.value);
                  setRangePreset('CUSTOM');
                }}
                min={filterStartDate}
                className="bg-transparent border-none outline-none cursor-pointer focus:ring-0 text-gray-700 dark:text-gray-200 text-xs p-0 w-24"
              />
            </div>
          )}
        </div>
      </div>

      {/* 
        PREMIUM WALLET SNAPSHOT CARD (Optimized for Mobile Version)
        Consolidates 3 bulky full-width cards into 1 sleek interactive wallet dashboard element.
      */}
      <div className="mb-6 sm:mb-8">
        <div className={`w-full bg-gradient-to-br ${currentTheme.gradient} text-white rounded-2xl p-5 sm:p-7 shadow-xl shadow-slate-900/10 relative overflow-hidden border border-slate-800 animate-fade-in`}>
          {/* Ambient Blur Glow backing based on current ledger accent */}
          <div className={`absolute -right-8 -top-8 w-36 h-36 rounded-full blur-3xl opacity-30 pointer-events-none ${currentTheme.glow}`}></div>
          
          <div className="relative z-10 flex flex-col justify-between h-full space-y-6">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
              <div>
                <p className="text-[10px] sm:text-xs uppercase font-extrabold tracking-widest text-slate-400 mb-1 flex items-center gap-1.5">
                  <Wallet size={12} className="text-slate-300" />
                  Net Ledger Outstanding Balance
                </p>
                <h2 className="text-2xl sm:text-4xl font-extrabold tracking-tight select-all flex items-center gap-2">
                  <span className={netBalance >= 0 ? "text-emerald-400" : "text-rose-400"}>
                    {netBalance >= 0 ? "₹" : "-₹"}{Math.abs(netBalance).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </span>
                  <span className="text-xs font-bold px-2 py-0.5 rounded bg-white/10 border border-white/10 uppercase tracking-wider text-slate-300">
                    {netBalance >= 0 ? "Net Dues (Receivable)" : "Net Payable"}
                  </span>
                </h2>
              </div>

              <div className="flex items-center gap-3 self-stretch sm:self-auto bg-white/5 p-2.5 rounded-xl border border-white/10 backdrop-blur-xs text-xs">
                <div>
                  <span className="text-[10px] uppercase font-bold text-slate-400 block">Total Dues</span>
                  <span className="font-extrabold text-rose-300">₹{totalReceivable.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                </div>
                <div className="w-px h-8 bg-white/10"></div>
                <div>
                  <span className="text-[10px] uppercase font-bold text-slate-400 block">Total Advances</span>
                  <span className="font-extrabold text-emerald-300">₹{totalPayable.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                </div>
              </div>
            </div>

            {/* Quick Stats side-by-side indicator layout */}
            <div className="grid grid-cols-2 gap-4 pt-5 border-t border-white/10">
              <div className="space-y-1">
                <span className="text-[10px] text-slate-400 font-extrabold uppercase tracking-wider block">
                  {isToday ? "Today's" : "Period"} Sales / Debit (Dr)
                </span>
                <div className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-sky-400"></span>
                  <span className="text-sm sm:text-xl font-black text-white">
                    ₹{periodDebit.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </span>
                </div>
              </div>

              <div className="space-y-1 border-l border-white/10 pl-4 sm:pl-6">
                <span className="text-[10px] text-slate-400 font-extrabold uppercase tracking-wider block">
                  {isToday ? "Today's" : "Period"} Collections / Credit (Cr)
                </span>
                <div className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-emerald-400"></span>
                  <span className="text-sm sm:text-xl font-black text-white">
                    ₹{periodCredit.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Main Charts & Activity section */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6 sm:mb-8">
        
        {/* Modern Micro-Trend Chart Container */}
        <div className="lg:col-span-2 bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-2xl overflow-hidden shadow-xs p-5 sm:p-6">
          <div className="flex justify-between items-center mb-6">
            <h2 className="text-sm sm:text-base font-extrabold text-gray-900 dark:text-white tracking-tight font-sans">
              7-Day Net Cashflow Trend
            </h2>
            <div className="flex items-center gap-3 text-xs font-semibold">
              <div className="flex items-center gap-1">
                <span className="w-2 h-2 rounded-full" style={{ backgroundColor: debitColor }}></span>
                <span className="text-gray-500">Dr</span>
              </div>
              <div className="flex items-center gap-1">
                <span className="w-2 h-2 rounded-full" style={{ backgroundColor: creditColor }}></span>
                <span className="text-gray-500">Cr</span>
              </div>
            </div>
          </div>

          <div className="h-[200px] sm:h-[260px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData} margin={{ top: 5, right: 10, left: -10, bottom: 0 }}>
                <defs>
                  <linearGradient id="colorDebit" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={debitColor} stopOpacity={0.15}/>
                    <stop offset="95%" stopColor={debitColor} stopOpacity={0}/>
                  </linearGradient>
                  <linearGradient id="colorCredit" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={creditColor} stopOpacity={0.15}/>
                    <stop offset="95%" stopColor={creditColor} stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: '#94a3b8', fontWeight: 600 }} dy={8} />
                <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: '#94a3b8', fontWeight: 600 }} tickFormatter={formatCompactCurrency} width={60} />
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                <Tooltip 
                  formatter={(value: number) => [`₹${(Number(value) || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`]}
                  contentStyle={{ borderRadius: '12px', border: '1px solid #e2e8f0', boxShadow: '0 4px 6px -1px rgba(0,0,0,0.05)', fontFamily: 'sans-serif', fontSize: '11px' }}
                />
                <Area type="monotone" dataKey="debit" stroke={debitColor} strokeWidth={2.5} fillOpacity={1} fill="url(#colorDebit)" />
                <Area type="monotone" dataKey="credit" stroke={creditColor} strokeWidth={2.5} fillOpacity={1} fill="url(#colorCredit)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Polished Activity Stream Card */}
        <div className="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-2xl overflow-hidden shadow-xs flex flex-col">
          <div className="p-5 border-b border-gray-100 dark:border-gray-800 flex justify-between items-center">
            <h2 className="text-sm sm:text-base font-extrabold text-gray-900 dark:text-white tracking-tight">
              {isToday ? "Today's" : "Period"} Activity
            </h2>
            <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest bg-gray-50 px-2 py-0.5 rounded-md">
              {transactions.length} Tx
            </span>
          </div>
          <div className="p-5 flex-1 overflow-y-auto max-h-[220px] sm:max-h-[260px] divide-y divide-gray-50 dark:divide-gray-800/60">
            {transactions.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-center text-gray-400 py-10">
                <FileUp className="mx-auto mb-2 text-gray-300" size={26} />
                <p className="text-xs font-semibold">No transactions recorded</p>
              </div>
            ) : (
              transactions.sort((a,b) => b.timestamp - a.timestamp).slice(0, 8).map(tx => {
                const party = parties.find(p => p.id === tx.partyId);
                return (
                  <div key={tx.id} className="flex justify-between items-center py-3 first:pt-0 last:pb-0 group transition-colors">
                    <div className="flex items-center min-w-0 pr-2">
                      <div className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 mr-3 ${
                        tx.type === 'DEBIT' 
                          ? 'bg-rose-50 text-rose-600 dark:bg-rose-950/30' 
                          : 'bg-emerald-50 text-emerald-600 dark:bg-emerald-950/30'
                      }`}>
                        {tx.type === 'DEBIT' ? <ArrowDownRight size={14} /> : <ArrowUpRight size={14} />}
                      </div>
                      <div className="min-w-0">
                        <p className="text-xs font-bold text-gray-900 dark:text-white truncate">{party?.name || 'Unknown Party'}</p>
                        <p className="text-[10px] text-gray-400 font-semibold truncate max-w-[140px] mt-0.5">{tx.notes || tx.invoiceNo || 'No details'}</p>
                      </div>
                    </div>
                    <div className={`text-xs font-extrabold text-right shrink-0 ${tx.type === 'DEBIT' ? 'text-rose-600' : 'text-emerald-600'}`}>
                      {tx.type === 'DEBIT' ? '-' : '+'}₹{(Number(tx.amount) || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </div>
                  </div>
                )
              })
            )}
          </div>
        </div>
      </div>

      {/* 
        TOP OUTSTANDING / ADVANCES TABBED CONTAINER
        - Mobile: Toggle switch tab to view either Outstanding or Advances, saving 100% vertical space!
        - Desktop (lg): Elegant 2-column bento box to display both details simultaneously.
      */}
      <div className="bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-2xl overflow-hidden shadow-xs">
        
        {/* Header containing the smart mobile tabs toggler */}
        <div className="p-5 border-b border-gray-100 dark:border-gray-800 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="shrink-0">
            <h2 className="text-sm sm:text-base font-extrabold text-gray-900 dark:text-white tracking-tight">Top Party Metrics</h2>
            <p className="text-[10px] sm:text-xs text-gray-400 font-medium mt-0.5">Summary of top balances across ledger books</p>
          </div>

          {/* Tab Switcher visible only on Mobile/Tablet viewports */}
          <div className="lg:hidden flex bg-gray-50 dark:bg-gray-800/50 p-1 rounded-xl w-full sm:w-auto">
            <button
              onClick={() => setPartyTab('dues')}
              type="button"
              className={`flex-1 sm:flex-initial px-4 py-1.5 rounded-lg text-xs font-bold transition-all ${
                partyTab === 'dues'
                  ? 'bg-white dark:bg-gray-900 text-red-600 dark:text-red-400 shadow-xs'
                  : 'text-gray-500 hover:text-gray-900'
              }`}
            >
              Outstanding Dues
            </button>
            <button
              onClick={() => setPartyTab('advances')}
              type="button"
              className={`flex-1 sm:flex-initial px-4 py-1.5 rounded-lg text-xs font-bold transition-all ${
                partyTab === 'advances'
                  ? 'bg-white dark:bg-gray-900 text-emerald-600 dark:text-emerald-400 shadow-xs'
                  : 'text-gray-500 hover:text-gray-900'
              }`}
            >
              Advances
            </button>
          </div>
        </div>

        {/* Dynamic List rendering responsive wrapper */}
        <div className="p-5 grid grid-cols-1 lg:grid-cols-2 gap-8 divide-y lg:divide-y-0 lg:divide-x divide-gray-100 dark:divide-gray-800/80">
          
          {/* Section A: Top Outstanding (Visible on Desktop OR when Mobile tab is 'dues') */}
          <div className={`space-y-4 pb-4 lg:pb-0 ${partyTab === 'dues' ? 'block' : 'hidden lg:block'}`}>
            <h3 className="text-xs font-extrabold uppercase text-gray-400 tracking-wider flex items-center gap-1.5 mb-3">
              <span className="w-1.5 h-1.5 rounded-full bg-red-500"></span>
              Top Outstanding (Dues)
            </h3>
            
            <div className="space-y-2.5 max-h-[220px] overflow-y-auto">
              {parties.filter(p => p.currentDue > 0).length === 0 ? (
                <div className="py-8 text-center text-xs text-gray-400 font-semibold">No outstanding balances</div>
              ) : (
                parties.filter(p => p.currentDue > 0)
                  .sort((a,b) => b.currentDue - a.currentDue)
                  .slice(0, 5)
                  .map(p => (
                    <div key={p.id} className="flex justify-between items-center py-2 border-b border-gray-50/50 dark:border-gray-800 last:border-0 hover:bg-gray-50/20 px-1 rounded transition-all">
                      <div>
                        <p className="text-xs font-bold text-gray-950 dark:text-white">{p.name}</p>
                        <p className="text-[10px] text-gray-400 mt-0.5">{p.phone || 'No phone'}</p>
                      </div>
                      <div className="text-xs font-extrabold text-red-600 bg-red-50 dark:bg-red-950/20 px-2 py-1 rounded-md">
                        -₹{p.currentDue.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                      </div>
                    </div>
                  ))
              )}
            </div>
          </div>

          {/* Section B: Top Advances (Visible on Desktop OR when Mobile tab is 'advances') */}
          <div className={`space-y-4 pt-4 lg:pt-0 lg:pl-8 ${partyTab === 'advances' ? 'block' : 'hidden lg:block'}`}>
            <h3 className="text-xs font-extrabold uppercase text-gray-400 tracking-wider flex items-center gap-1.5 mb-3">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
              Top Advances (Credits)
            </h3>
            
            <div className="space-y-2.5 max-h-[220px] overflow-y-auto">
              {parties.filter(p => p.currentDue < 0).length === 0 ? (
                <div className="py-8 text-center text-xs text-gray-400 font-semibold">No active credits or advances</div>
              ) : (
                parties.filter(p => p.currentDue < 0)
                  .sort((a,b) => a.currentDue - b.currentDue)
                  .slice(0, 5)
                  .map(p => (
                    <div key={p.id} className="flex justify-between items-center py-2 border-b border-gray-50/50 dark:border-gray-800 last:border-0 hover:bg-gray-50/20 px-1 rounded transition-all">
                      <div>
                        <p className="text-xs font-bold text-gray-950 dark:text-white">{p.name}</p>
                        <p className="text-[10px] text-gray-400 mt-0.5">{p.phone || 'No phone'}</p>
                      </div>
                      <div className="text-xs font-extrabold text-emerald-600 bg-emerald-50 dark:bg-emerald-950/20 px-2 py-1 rounded-md">
                        ₹{Math.abs(p.currentDue).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                      </div>
                    </div>
                  ))
              )}
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}
