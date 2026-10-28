import React, { useEffect, useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  Loader2, 
  PlusCircle, 
  ArrowUpRight, 
  ArrowDownRight, 
  Users, 
  Plus, 
  ChevronRight
} from 'lucide-react';
import { useLedger } from '../LedgerContext';
import { useAuth } from '../AuthContext';
import { startOfDay, endOfDay } from 'date-fns';
import { syncCollection } from '../lib/syncCache';
import { getFilteredCacheItems } from '../lib/idbCache';
import { Party, Transaction, DashboardSummary, LEDGER_TYPE_LABELS, Ledger } from '../types';

export default function Dashboard() {
  const { currentUser } = useAuth();
  const isAdmin = currentUser?.isAdmin ?? false;
  const { activeLedger, ledgers, createLedger, setActiveLedgerId } = useLedger();
  const navigate = useNavigate();

  const [allLedgerTxs, setAllLedgerTxs] = useState<Transaction[]>([]);
  const [parties, setParties] = useState<Party[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [newLedgerName, setNewLedgerName] = useState('');
  const [newLedgerType, setNewLedgerType] = useState<Ledger['type']>('SALE');
  const [createError, setCreateError] = useState<string | null>(null);
  const [isCreatingLedger, setIsCreatingLedger] = useState(false);



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
      setAllLedgerTxs(cachedTxs);
      setTransactions(cachedTxs);
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
  }, [activeLedger?.id]);

  // Top 5 Highest Outstanding Parties (currentDue > 0, sorted descending)
  const topOutstandingParties = useMemo(() => {
    return parties
      .filter(p => p.currentDue > 0)
      .sort((a, b) => b.currentDue - a.currentDue)
      .slice(0, 5);
  }, [parties]);

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
      <div className="p-4 sm:p-8 max-w-4xl mx-auto w-full pb-24 sm:pb-8 flex flex-col items-center justify-center min-h-[75vh]">
        <div className="w-full max-w-2xl bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
          <div className="p-6 sm:p-8 border-b border-slate-100 bg-slate-50/50">
            <h2 className="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight">Select or Create a Ledger</h2>
            <p className="text-xs sm:text-sm text-slate-500 mt-1">
              Welcome to the financial system. To begin managing parties and transactions, please select or create a ledger.
            </p>
          </div>

          <div className="p-6 sm:p-8 space-y-6">
            {ledgers.length > 0 && (
              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-2">Available Ledgers</label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {ledgers.map(l => (
                    <button
                      key={l.id}
                      type="button"
                      onClick={() => setActiveLedgerId(l.id)}
                      className="p-4 rounded-xl border border-slate-200 hover:border-blue-500 hover:bg-blue-50/30 transition-all text-left flex items-start justify-between cursor-pointer group"
                    >
                      <div>
                        <div className="font-bold text-sm text-slate-900 group-hover:text-blue-700">{l.name}</div>
                        <div className="text-xs text-slate-500 mt-0.5">{LEDGER_TYPE_LABELS[l.type] || l.type}</div>
                      </div>
                      <ChevronRight size={16} className="text-slate-400 group-hover:text-blue-600 group-hover:translate-x-0.5 transition-all mt-0.5" />
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="pt-4 border-t border-slate-100">
              <h3 className="text-sm font-bold text-slate-900 mb-3 flex items-center gap-1.5">
                <Plus size={16} className="text-blue-600" />
                Create New Ledger
              </h3>

              {createError && (
                <div className="mb-3 p-3 bg-rose-50 border border-rose-200 rounded-lg text-xs text-rose-700">
                  {createError}
                </div>
              )}

              <form onSubmit={handleCreateLedgerSubmit} className="space-y-3">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">Ledger Name</label>
                    <input
                      type="text"
                      required
                      placeholder="e.g. Sales Ledger"
                      value={newLedgerName}
                      onChange={e => setNewLedgerName(e.target.value)}
                      className="w-full px-3.5 py-2 bg-white border border-slate-300 rounded-lg text-sm text-slate-900 focus:outline-none focus:border-blue-600"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">Accounting Type</label>
                    <select
                      value={newLedgerType}
                      onChange={e => setNewLedgerType(e.target.value as Ledger['type'])}
                      className="w-full px-3.5 py-2 bg-white border border-slate-300 rounded-lg text-sm text-slate-900 focus:outline-none focus:border-blue-600"
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
                    className="w-full sm:w-auto px-6 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-bold text-xs rounded-lg transition-colors flex items-center justify-center gap-2 shadow-xs cursor-pointer"
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

  const isExpense = activeLedger?.type === 'EXPENSE';
  const totalOutstanding = summary?.totalReceivable ?? parties.filter(p => p.currentDue > 0).reduce((a, b) => a + b.currentDue, 0);
  const totalDebtorsCount = parties.filter(p => p.currentDue > 0).length;
  const totalAdvancePayables = summary?.totalPayable ?? parties.filter(p => p.currentDue < 0).reduce((a, b) => a + Math.abs(b.currentDue), 0);
  const totalAdvanceCount = parties.filter(p => p.currentDue < 0).length;

  // Calculate Today's Transactions
  const now = new Date();
  const todayStartTs = startOfDay(now).getTime();
  const todayEndTs = endOfDay(now).getTime();
  const todayTxs = allLedgerTxs.filter(t => t.timestamp >= todayStartTs && t.timestamp <= todayEndTs);
  const todayDebit = todayTxs.filter(t => t.type === 'DEBIT').reduce((acc, t) => acc + t.amount, 0);
  const todayCredit = todayTxs.filter(t => t.type === 'CREDIT').reduce((acc, t) => acc + t.amount, 0);
  const todayDebitCount = todayTxs.filter(t => t.type === 'DEBIT').length;
  const todayCreditCount = todayTxs.filter(t => t.type === 'CREDIT').length;

  return (
    <div className="w-full min-h-screen bg-white md:bg-[#F8FAFC] pb-16 font-customer">
      <div className="w-full min-h-screen bg-white flex flex-col relative md:max-w-5xl lg:max-w-7xl md:mx-auto md:my-4 md:rounded-2xl md:border md:border-slate-200/80 md:shadow-xs overflow-hidden">
        
        {/* Top Header */}
        <div className="p-4 sm:p-5 md:px-8 md:py-6 border-b border-slate-100 flex flex-col md:flex-row md:items-center md:justify-between gap-3">
          <div>
            <h1 className="text-xl md:text-2xl font-bold text-[#0F172A] tracking-tight">
              Financial Overview
            </h1>
            <p className="text-xs md:text-[13px] text-[#64748B] mt-0.5">
              {activeLedger.name} • {LEDGER_TYPE_LABELS[activeLedger.type] || activeLedger.type}
            </p>
          </div>

          {/* Desktop Quick Action Buttons */}
          <div className="hidden md:flex items-center gap-2.5">
            <button
              type="button"
              onClick={() => navigate('/master-entry')}
              className="bg-[#0055a5] hover:bg-blue-700 text-white px-4 py-2 rounded-xl text-xs font-semibold flex items-center gap-1.5 shadow-xs transition cursor-pointer"
            >
              <Plus size={15} />
              <span>Record Voucher</span>
            </button>
            <button
              type="button"
              onClick={() => navigate('/parties')}
              className="bg-slate-100 hover:bg-slate-200 text-slate-700 px-3.5 py-2 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer"
            >
              <Users size={15} className="text-slate-500" />
              <span>Parties ({parties.length})</span>
            </button>
            <button
              type="button"
              onClick={() => navigate('/log')}
              className="bg-slate-100 hover:bg-slate-200 text-slate-700 px-3.5 py-2 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer"
            >
              <span>Day Log →</span>
            </button>
          </div>
        </div>

        <div className="p-4 sm:p-5 md:p-8 flex-1 flex flex-col">
          {/* ========================================================================= */}
          {/* MOBILE METRICS SECTION (< md) - 100% UNCHANGED                            */}
          {/* ========================================================================= */}
          <div className="md:hidden">
            {/* Total Outstanding Banner - Sky Blue Gradient */}
            <div className="bg-gradient-to-br from-[#0284c7] via-[#0ea5e9] to-[#0369a1] text-white rounded-2xl p-4 sm:p-5 shadow-[0_4px_16px_rgba(2,132,199,0.32)] mb-4">
              <div className="text-[11.5px] font-semibold tracking-wider uppercase opacity-95 mb-2">
                {isExpense ? 'Total Expenses (Payable)' : 'Total Outstanding'} • {totalDebtorsCount} {totalDebtorsCount === 1 ? 'party' : 'parties'} with balance
              </div>
              <div className="text-[23px] sm:text-[26px] font-bold tracking-tight mb-4 flex items-baseline select-all tabular-nums">
                <span className="text-[21px] mr-0.5 font-normal">₹</span>
                <span>{totalOutstanding.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                <span className="text-[13px] font-semibold ml-1.5 tracking-wider">DR</span>
              </div>
              <div className="flex justify-between items-center gap-2.5 flex-wrap">
                <div className="bg-[rgba(2,80,130,0.55)] border border-white/20 px-3 py-1.5 rounded-full text-xs font-semibold text-[#34D399] flex items-center gap-1">
                  <span>Advance:</span>
                  <span>₹{totalAdvancePayables.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} Cr</span>
                </div>
                <button
                  type="button"
                  onClick={() => navigate('/parties')}
                  className="bg-white text-[#0284c7] hover:bg-sky-50 border-none rounded-full px-3.5 py-1.5 text-[12.5px] font-bold flex items-center gap-1.5 shadow-xs transition cursor-pointer"
                >
                  <Users size={14} className="text-[#0284c7]" />
                  <span>All Parties ({parties.length}) →</span>
                </button>
              </div>
            </div>

            {/* Today's Debit & Credit Cards */}
            <div className="grid grid-cols-2 gap-3 mb-4">
              {/* Debit Card */}
              <div className="bg-white rounded-2xl p-3.5 border border-[#E2E8F0] border-l-4 border-l-[#EF4444] shadow-xs relative">
                <div className="flex justify-between items-center mb-2">
                  <span className="text-[11px] font-bold text-[#64748B] uppercase tracking-wider flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-[#EF4444]"></span>
                    Todays Debit
                  </span>
                  <div className="w-6 h-6 rounded-md bg-[#FEE2E2] text-[#DC2626] flex items-center justify-center shrink-0">
                    <ArrowDownRight size={14} strokeWidth={2.5} />
                  </div>
                </div>
                <div className="text-[17px] font-bold text-[#0F172A] mb-2.5 tabular-nums">
                  ₹ {todayDebit.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </div>
                <div className="flex justify-between items-center text-[11.5px] text-[#64748B]">
                  <span>{todayDebitCount} {todayDebitCount === 1 ? 'voucher' : 'vouchers'}</span>
                  <button
                    type="button"
                    onClick={() => navigate('/log')}
                    className="font-semibold text-[#DC2626] hover:underline cursor-pointer"
                  >
                    Log →
                  </button>
                </div>
              </div>

              {/* Credit Card */}
              <div className="bg-white rounded-2xl p-3.5 border border-[#E2E8F0] border-l-4 border-l-[#10B981] shadow-xs relative">
                <div className="flex justify-between items-center mb-2">
                  <span className="text-[11px] font-bold text-[#64748B] uppercase tracking-wider flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-[#10B981]"></span>
                    Todays Credit
                  </span>
                  <div className="w-6 h-6 rounded-md bg-[#DCFCE7] text-[#059669] flex items-center justify-center shrink-0">
                    <ArrowUpRight size={14} strokeWidth={2.5} />
                  </div>
                </div>
                <div className="text-[17px] font-bold text-[#0F172A] mb-2.5 tabular-nums">
                  ₹ {todayCredit.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </div>
                <div className="flex justify-between items-center text-[11.5px] text-[#64748B]">
                  <span>{todayCreditCount} {todayCreditCount === 1 ? 'receipt' : 'receipts'}</span>
                  <button
                    type="button"
                    onClick={() => navigate('/log')}
                    className="font-semibold text-[#059669] hover:underline cursor-pointer"
                  >
                    Log →
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* ========================================================================= */}
          {/* DESKTOP METRICS GRID (md+) - Wide, High-End Enterprise Layout             */}
          {/* ========================================================================= */}
          <div className="hidden md:grid md:grid-cols-4 md:gap-4 mb-6">
            {/* Card 1: Total Outstanding */}
            <div className="bg-gradient-to-br from-[#0284c7] to-[#0369a1] text-white rounded-2xl p-5 shadow-sm relative overflow-hidden flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between text-sky-100 text-xs font-bold uppercase tracking-wider mb-2">
                  <span>{isExpense ? 'Total Payable' : 'Total Outstanding'}</span>
                  <span className="bg-white/20 px-2 py-0.5 rounded-full text-[11px] font-semibold">
                    {totalDebtorsCount} {totalDebtorsCount === 1 ? 'party' : 'parties'}
                  </span>
                </div>
                <div className="text-2xl lg:text-3xl font-extrabold tracking-tight tabular-nums flex items-baseline">
                  <span className="text-xl font-normal mr-1">₹</span>
                  <span>{totalOutstanding.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                  <span className="text-xs font-bold ml-1.5 opacity-90">DR</span>
                </div>
              </div>
              <div className="mt-4 pt-3 border-t border-white/15 flex items-center justify-between">
                <span className="text-[11px] text-sky-100">Debit Balance Due</span>
                <button
                  type="button"
                  onClick={() => navigate('/parties')}
                  className="text-xs font-bold text-white hover:underline cursor-pointer"
                >
                  View All Due →
                </button>
              </div>
            </div>

            {/* Card 2: Advance Payments */}
            <div className="bg-white rounded-2xl p-5 border border-slate-200 shadow-2xs relative flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between text-slate-500 text-xs font-bold uppercase tracking-wider mb-2">
                  <span className="flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
                    Advance Payments
                  </span>
                  <span className="bg-emerald-50 text-emerald-700 px-2 py-0.5 rounded-full text-[11px] font-semibold border border-emerald-100">
                    {totalAdvanceCount} {totalAdvanceCount === 1 ? 'party' : 'parties'}
                  </span>
                </div>
                <div className="text-2xl lg:text-3xl font-extrabold text-slate-900 tracking-tight tabular-nums flex items-baseline">
                  <span className="text-xl font-normal text-slate-400 mr-1">₹</span>
                  <span>{totalAdvancePayables.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                  <span className="text-xs font-bold text-emerald-600 ml-1.5">CR</span>
                </div>
              </div>
              <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between">
                <span className="text-[11px] text-slate-500">Credit Balance Held</span>
                <button
                  type="button"
                  onClick={() => navigate('/parties')}
                  className="text-xs font-bold text-emerald-600 hover:underline cursor-pointer"
                >
                  View Advance →
                </button>
              </div>
            </div>

            {/* Card 3: Today's Debit */}
            <div className="bg-white rounded-2xl p-5 border border-slate-200 border-l-4 border-l-[#EF4444] shadow-2xs relative flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between text-slate-500 text-xs font-bold uppercase tracking-wider mb-2">
                  <span className="flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-[#EF4444]"></span>
                    Todays Debit
                  </span>
                  <div className="w-6 h-6 rounded-md bg-[#FEE2E2] text-[#DC2626] flex items-center justify-center shrink-0">
                    <ArrowDownRight size={14} strokeWidth={2.5} />
                  </div>
                </div>
                <div className="text-2xl lg:text-3xl font-extrabold text-slate-900 tracking-tight tabular-nums flex items-baseline">
                  <span className="text-xl font-normal text-slate-400 mr-1">₹</span>
                  <span>{todayDebit.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                </div>
              </div>
              <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500">
                <span>{todayDebitCount} {todayDebitCount === 1 ? 'voucher' : 'vouchers'} posted</span>
                <button
                  type="button"
                  onClick={() => navigate('/log')}
                  className="font-bold text-[#DC2626] hover:underline cursor-pointer"
                >
                  Log →
                </button>
              </div>
            </div>

            {/* Card 4: Today's Credit */}
            <div className="bg-white rounded-2xl p-5 border border-slate-200 border-l-4 border-l-[#10B981] shadow-2xs relative flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between text-slate-500 text-xs font-bold uppercase tracking-wider mb-2">
                  <span className="flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-[#10B981]"></span>
                    Todays Credit
                  </span>
                  <div className="w-6 h-6 rounded-md bg-[#DCFCE7] text-[#059669] flex items-center justify-center shrink-0">
                    <ArrowUpRight size={14} strokeWidth={2.5} />
                  </div>
                </div>
                <div className="text-2xl lg:text-3xl font-extrabold text-slate-900 tracking-tight tabular-nums flex items-baseline">
                  <span className="text-xl font-normal text-slate-400 mr-1">₹</span>
                  <span>{todayCredit.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                </div>
              </div>
              <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500">
                <span>{todayCreditCount} {todayCreditCount === 1 ? 'receipt' : 'receipts'} received</span>
                <button
                  type="button"
                  onClick={() => navigate('/log')}
                  className="font-bold text-[#059669] hover:underline cursor-pointer"
                >
                  Log →
                </button>
              </div>
            </div>
          </div>

          {/* Outstanding Parties Section - Simple Clean Style */}
          <div className="bg-white rounded-2xl border border-slate-200 p-4 sm:p-5 shadow-2xs flex-1 flex flex-col">
            
            {/* Header */}
            <div className="flex items-center justify-between mb-2 pb-2.5 border-b border-slate-100">
              <h3 className="text-sm sm:text-base font-semibold text-slate-900 tracking-tight">
                Outstanding
              </h3>
              <button
                type="button"
                onClick={() => navigate('/parties')}
                className="text-xs text-blue-600 hover:text-blue-800 hover:underline cursor-pointer font-medium"
              >
                All Parties →
              </button>
            </div>

            {/* List */}
            {isLoading && parties.length === 0 ? (
              <div className="py-8 text-center text-slate-400 flex flex-col items-center justify-center gap-2">
                <Loader2 size={18} className="animate-spin text-slate-400" />
                <p className="text-xs">Loading...</p>
              </div>
            ) : topOutstandingParties.length === 0 ? (
              <div className="py-8 text-center text-slate-400 text-xs">
                No outstanding balance
              </div>
            ) : (
              <ul className="divide-y divide-slate-100 list-none p-0 m-0">
                {topOutstandingParties.map(party => (
                  <li
                    key={party.id}
                    onClick={() => navigate(`/parties/${party.id}`)}
                    className="flex items-center justify-between py-2.5 px-1 hover:bg-slate-50/80 rounded-lg cursor-pointer transition-colors"
                  >
                    <span className="text-sm font-medium text-slate-800 truncate pr-3">
                      {party.name}
                    </span>
                    <span className="text-sm font-semibold text-slate-900 tabular-nums shrink-0">
                      ₹ {party.currentDue.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

      </div>
    </div>
  );
}
