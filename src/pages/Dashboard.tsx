import React, { useEffect, useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  Loader2, 
  PlusCircle, 
  ArrowUpRight, 
  ArrowDownRight, 
  Users, 
  Search, 
  X, 
  Plus, 
  Phone, 
  MapPin,
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

  // Customer List Search and Filter in Dashboard
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [filterTab, setFilterTab] = useState<'all' | 'due' | 'advance'>('all');

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

  // Filter parties based on search query and tabs
  const filteredParties = useMemo(() => {
    let list = [...parties];

    // Filter by tab
    if (filterTab === 'due') {
      list = list.filter(p => p.currentDue > 0);
    } else if (filterTab === 'advance') {
      list = list.filter(p => p.currentDue < 0);
    }

    // Filter by search
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      list = list.filter(p => 
        p.name.toLowerCase().includes(q) ||
        (p.phone && p.phone.toLowerCase().includes(q)) ||
        (p.address && p.address.toLowerCase().includes(q))
      );
    }

    // Sort by largest balance first
    return list.sort((a, b) => Math.abs(b.currentDue) - Math.abs(a.currentDue));
  }, [parties, filterTab, searchQuery]);

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
    <div className="w-full max-w-xl md:max-w-2xl mx-auto p-4 sm:p-5 bg-white min-h-screen pb-20 font-customer">
      
      {/* Top Header */}
      <div className="mb-4">
        <h1 className="text-xl font-bold text-[#0F172A] tracking-tight">
          Financial Overview
        </h1>
        <p className="text-[13px] text-[#64748B] mt-0.5">
          {activeLedger.name} • {LEDGER_TYPE_LABELS[activeLedger.type] || activeLedger.type}
        </p>
      </div>

      {/* Total Outstanding Banner */}
      <div className="bg-gradient-to-br from-[#0056B3] to-[#004494] text-white rounded-2xl p-4 sm:p-5 shadow-[0_4px_14px_rgba(0,86,179,0.28)] mb-4">
        <div className="text-[11.5px] font-semibold tracking-wider uppercase opacity-90 mb-2">
          {isExpense ? 'Total Expenses (Payable)' : 'Total Outstanding'} • {totalDebtorsCount} {totalDebtorsCount === 1 ? 'party' : 'parties'} with balance
        </div>
        <div className="text-[23px] sm:text-[26px] font-bold tracking-tight mb-4 flex items-baseline select-all tabular-nums">
          <span className="text-[21px] mr-0.5 font-normal">₹</span>
          <span>{totalOutstanding.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
          <span className="text-[13px] font-semibold ml-1.5 tracking-wider">DR</span>
        </div>
        <div className="flex justify-between items-center gap-2.5 flex-wrap">
          <div className="bg-[rgba(0,42,94,0.65)] border border-white/15 px-3 py-1.5 rounded-full text-xs font-semibold text-[#34D399] flex items-center gap-1">
            <span>Advance:</span>
            <span>₹{totalAdvancePayables.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} Cr</span>
          </div>
          <button
            type="button"
            onClick={() => navigate('/parties')}
            className="bg-white text-[#0056B3] hover:bg-blue-50 border-none rounded-full px-3.5 py-1.5 text-[12.5px] font-bold flex items-center gap-1.5 shadow-xs transition cursor-pointer"
          >
            <Users size={14} className="text-[#0056B3]" />
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

      {/* Customer Parties Section */}
      <div className="bg-white rounded-2xl border border-slate-200 p-3 sm:p-4 shadow-2xs">
        
        {/* Section Header & Tabs */}
        <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
          <div className="flex items-center gap-2">
            <h3 className="font-bold text-sm text-slate-900 tracking-tight">Customer Accounts</h3>
            <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">
              {filteredParties.length}
            </span>
          </div>

          {/* Filter Tabs */}
          <div className="flex items-center gap-1 bg-slate-100 p-0.5 rounded-lg text-[11px]">
            <button
              type="button"
              onClick={() => setFilterTab('all')}
              className={`px-2.5 py-1 rounded-md font-semibold transition cursor-pointer ${
                filterTab === 'all'
                  ? 'bg-white text-slate-900 shadow-2xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              All ({parties.length})
            </button>
            <button
              type="button"
              onClick={() => setFilterTab('due')}
              className={`px-2.5 py-1 rounded-md font-semibold transition cursor-pointer ${
                filterTab === 'due'
                  ? 'bg-white text-rose-700 shadow-2xs'
                  : 'text-slate-600 hover:text-rose-600'
              }`}
            >
              Due ({totalDebtorsCount})
            </button>
            <button
              type="button"
              onClick={() => setFilterTab('advance')}
              className={`px-2.5 py-1 rounded-md font-semibold transition cursor-pointer ${
                filterTab === 'advance'
                  ? 'bg-white text-emerald-700 shadow-2xs'
                  : 'text-slate-600 hover:text-emerald-600'
              }`}
            >
              Advance ({totalAdvanceCount})
            </button>
          </div>
        </div>

        {/* Search Box */}
        <div className="flex items-center bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 gap-2 mb-3">
          <Search size={14} className="text-slate-400 shrink-0" />
          <input
            type="text"
            placeholder="Search party by name, phone or address..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="border-none outline-none bg-transparent w-full text-xs text-slate-900 placeholder:text-slate-400"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery('')}
              className="text-slate-400 hover:text-slate-600 cursor-pointer"
            >
              <X size={13} />
            </button>
          )}
        </div>

        {/* Customer Accounts List */}
        {isLoading && parties.length === 0 ? (
          <div className="py-8 text-center text-slate-400 flex flex-col items-center justify-center gap-1">
            <Loader2 size={18} className="animate-spin text-blue-600" />
            <p className="text-xs">Loading ledger accounts...</p>
          </div>
        ) : filteredParties.length === 0 ? (
          <div className="py-8 text-center text-slate-400 px-4">
            <Users size={22} className="mx-auto mb-1.5 text-slate-300" />
            <p className="text-xs font-semibold text-slate-700">No matching parties found</p>
            <p className="text-[11px] text-slate-400 mt-0.5">
              {searchQuery ? 'Try searching with another keyword.' : 'Add your first customer in Parties section.'}
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-slate-100 list-none p-0 m-0">
            {filteredParties.map(party => {
              const isDue = party.currentDue > 0;
              const isAdvance = party.currentDue < 0;

              return (
                <li
                  key={party.id}
                  onClick={() => navigate(`/party/${party.id}`)}
                  className="flex items-center justify-between py-2.5 px-2 hover:bg-slate-50/80 rounded-lg cursor-pointer transition-colors group"
                >
                  <div className="min-w-0 pr-3 flex-1">
                    <h4 className="text-[13px] font-bold text-slate-900 leading-tight group-hover:text-blue-600 transition-colors truncate">
                      {party.name}
                    </h4>
                    <div className="flex items-center gap-2 text-[11px] text-slate-400 mt-0.5 truncate">
                      {party.phone && <span>{party.phone}</span>}
                      {party.phone && party.address && <span>•</span>}
                      {party.address && <span className="truncate">{party.address}</span>}
                      {!party.phone && !party.address && <span>No contact info</span>}
                    </div>
                  </div>

                  <div className="text-right shrink-0">
                    <div className={`font-mono font-bold text-[13px] tabular-nums ${
                      isDue ? 'text-rose-600' : isAdvance ? 'text-emerald-600' : 'text-slate-500'
                    }`}>
                      ₹ {Math.abs(party.currentDue).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </div>
                    <span className={`text-[9.5px] font-bold px-1.5 py-0.2 rounded inline-block mt-0.5 ${
                      isDue 
                        ? 'bg-rose-50 text-rose-700 border border-rose-200' 
                        : isAdvance 
                        ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' 
                        : 'bg-slate-100 text-slate-600'
                    }`}>
                      {isDue ? 'DUE (DR)' : isAdvance ? 'ADVANCE (CR)' : 'SETTLED'}
                    </span>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

    </div>
  );
}
