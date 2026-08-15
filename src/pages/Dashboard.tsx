import React, { useEffect, useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  TrendingUp, 
  TrendingDown, 
  Loader2, 
  BookOpen, 
  PlusCircle, 
  FolderPlus, 
  ArrowUpRight, 
  ArrowDownRight, 
  Calendar, 
  Wallet, 
  Users, 
  CreditCard,
  FileSpreadsheet,
  FileText,
  Building2,
  CheckCircle2,
  Clock,
  ArrowRight
} from 'lucide-react';
import { useLedger } from '../LedgerContext';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { format, subMonths, startOfMonth, endOfMonth, startOfDay, endOfDay, parseISO } from 'date-fns';
import { syncCollection } from '../lib/syncCache';
import { getFilteredCacheItems } from '../lib/idbCache';
import CompanyLogo from '../components/CompanyLogo';
import PageHeader from '../components/ui/PageHeader';
import StatCard from '../components/ui/StatCard';
import Badge from '../components/ui/Badge';
import AmountDisplay from '../components/ui/AmountDisplay';
import { Card, CardHeader, CardBody } from '../components/ui/Card';
import { Party, Transaction, DashboardSummary, LEDGER_TYPE_LABELS, Ledger } from '../types';

export default function Dashboard() {
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

  // Generate 12-month column chart data for all months
  const chartData = useMemo(() => {
    const data = [];
    const now = new Date();
    // 12 months rolling (from 11 months ago up to current month)
    for (let i = 11; i >= 0; i--) {
      const monthDate = subMonths(now, i);
      const start = startOfMonth(monthDate).getTime();
      const end = endOfMonth(monthDate).getTime();
      
      const monthTxs = allLedgerTxs.filter(t => t.timestamp >= start && t.timestamp <= end);
      const debit = monthTxs.filter(t => t.type === 'DEBIT').reduce((acc, t) => acc + (t.amount || 0), 0);
      const credit = monthTxs.filter(t => t.type === 'CREDIT').reduce((acc, t) => acc + (t.amount || 0), 0);
      const txCount = monthTxs.length;
      
      data.push({
        name: format(monthDate, 'MMM'),
        fullMonth: format(monthDate, 'MMMM yyyy'),
        debit,
        credit,
        net: debit - credit,
        txCount
      });
    }
    return data;
  }, [allLedgerTxs]);

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
          <div className="p-8 bg-slate-900 border-b border-slate-800 text-center sm:text-left flex flex-col sm:flex-row items-center gap-6">
            <div className="w-16 h-16 bg-blue-600 rounded-2xl flex items-center justify-center text-white shadow-lg shrink-0">
              <Building2 size={32} />
            </div>
            <div>
              <div className="flex flex-col sm:flex-row sm:items-center gap-2 justify-center sm:justify-start">
                <span className="text-xs font-bold uppercase text-slate-400 tracking-wider">Corporate ERP Portal</span>
                <CompanyLogo className="h-7 w-auto self-center sm:self-auto" variant="white" />
              </div>
              <p className="text-slate-300 mt-2 text-xs sm:text-sm leading-relaxed">
                Welcome to Greenzar Food & Beverage enterprise financial system. To begin managing parties, transactions, and audit reports, please select or create a ledger.
              </p>
            </div>
          </div>

          <div className="p-8 space-y-8">
            {ledgers.length > 0 && (
              <div>
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700 mb-3 flex items-center gap-2">
                  <FolderPlus size={16} className="text-blue-600" />
                  Select an Existing Ledger
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {ledgers.map(l => (
                    <button
                      key={l.id}
                      onClick={() => setActiveLedgerId(l.id)}
                      className="flex items-center justify-between p-4 bg-slate-50 hover:bg-blue-50 hover:border-blue-300 border border-slate-200 rounded-xl transition-all text-left group"
                    >
                      <div className="overflow-hidden mr-3">
                        <p className="font-bold text-slate-900 truncate group-hover:text-blue-900 text-sm">{l.name}</p>
                        <p className="text-xs text-slate-500 mt-0.5 uppercase">{LEDGER_TYPE_LABELS[l.type] || l.type}</p>
                      </div>
                      <span className="text-xs font-bold text-blue-600 bg-blue-100/60 px-3 py-1 rounded-md group-hover:bg-blue-600 group-hover:text-white transition-all shrink-0">
                        Open Book
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div>
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700 mb-3 flex items-center gap-2">
                <PlusCircle size={16} className="text-emerald-600" />
                Create a New Ledger Book
              </h3>
              
              <form onSubmit={handleCreateLedgerSubmit} className="space-y-4 bg-slate-50/70 p-5 border border-slate-200 rounded-xl">
                {createError && (
                  <div className="p-3 text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-lg font-medium">
                    {createError}
                  </div>
                )}
                
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">Ledger Name</label>
                    <input
                      type="text"
                      required
                      placeholder="e.g. Sales Ledger 2026"
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
                    className="w-full sm:w-auto px-6 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-bold text-xs rounded-lg transition-colors flex items-center justify-center gap-2 shadow-xs"
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

  const totalOutstanding = summary?.totalReceivable ?? parties.filter(p => p.currentDue > 0).reduce((a, b) => a + b.currentDue, 0);
  const totalDebtorsCount = parties.filter(p => p.currentDue > 0).length;
  const totalAdvancePayables = summary?.totalPayable ?? parties.filter(p => p.currentDue < 0).reduce((a, b) => a + Math.abs(b.currentDue), 0);
  
  // Calculate Today's Transactions
  const now = new Date();
  const todayStartTs = startOfDay(now).getTime();
  const todayEndTs = endOfDay(now).getTime();
  const todayTxs = allLedgerTxs.filter(t => t.timestamp >= todayStartTs && t.timestamp <= todayEndTs);
  const todayDebit = todayTxs.filter(t => t.type === 'DEBIT').reduce((acc, t) => acc + t.amount, 0);
  const todayCredit = todayTxs.filter(t => t.type === 'CREDIT').reduce((acc, t) => acc + t.amount, 0);
  const todayDebitCount = todayTxs.filter(t => t.type === 'DEBIT').length;
  const todayCreditCount = todayTxs.filter(t => t.type === 'CREDIT').length;

  const debitColor = '#e11d48'; // Clear Red for Debit
  const creditColor = '#059669'; // Clear Green for Credit

  return (
    <div className="p-4 sm:p-8 max-w-7xl mx-auto w-full pb-24 sm:pb-8 space-y-6">
      
      {/* Page Header */}
      <PageHeader
        title="Financial Overview"
        subtitle={`Real-time corporate accounting summary for ${activeLedger.name}`}
      />

      {/* ========================================================================= */}
      {/* HERO FINANCIAL METRICS: BIG TOTAL OUTSTANDING + TODAY'S CREDIT & DEBIT   */}
      {/* ========================================================================= */}
      <div className="space-y-4">
        
        {/* 1. Big Card: Total Party Outstanding - Exact Sapphire Blue Theme */}
        <div className="bg-[#0055a5] rounded-2xl p-6 sm:p-8 text-white shadow-md relative overflow-hidden border border-[#004b91]">
          {/* Subtle Background Accent */}
          <div className="absolute top-0 right-0 w-80 h-80 bg-white/5 rounded-full blur-2xl -mr-16 -mt-16 pointer-events-none" />

          <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-6">
            <div className="space-y-2.5">
              <div className="flex items-center gap-2">
                <span className="px-2.5 py-1 rounded-md bg-white/20 text-white text-[11px] font-bold uppercase tracking-wider border border-white/20">
                  Total Outstanding
                </span>
                <span className="text-xs text-blue-100 font-medium">
                  • {totalDebtorsCount} {totalDebtorsCount === 1 ? 'party' : 'parties'} with balance dues
                </span>
              </div>

              {/* Big High-Impact Amount */}
              <div className="pt-1">
                <span className="text-3xl sm:text-5xl font-extrabold tracking-tight tabular-nums text-white flex items-baseline gap-1 select-all font-sans">
                  <span className="text-2xl sm:text-4xl text-blue-100 font-normal">₹</span>
                  <span>
                    {totalOutstanding.toLocaleString('en-IN', {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2
                    })}
                  </span>
                  <span className="ml-2.5 text-xs sm:text-sm font-bold uppercase px-2.5 py-1 rounded-md bg-[#ff2d55] text-white tracking-wide shadow-xs">
                    DR
                  </span>
                </span>
              </div>

              <p className="text-xs text-blue-100/90 font-medium">
                Cumulative receivable balance dues across all active parties in {activeLedger.name}
              </p>
            </div>

            <div className="flex flex-row md:flex-col items-center md:items-end gap-3 shrink-0">
              <button
                onClick={() => navigate('/parties')}
                className="w-full sm:w-auto px-5 py-2.5 bg-white text-[#0055a5] hover:bg-blue-50 font-bold text-xs rounded-xl shadow-sm transition-all flex items-center justify-center gap-2"
              >
                <Users size={16} className="text-[#0055a5]" />
                <span>View All Parties ({parties.length})</span>
                <ArrowRight size={14} className="text-[#0055a5] ml-0.5" />
              </button>

              {totalAdvancePayables > 0 && (
                <div className="text-[11px] text-white bg-white/15 px-3 py-1.5 rounded-lg border border-white/20 flex items-center gap-1.5">
                  <span>Advance payables:</span>
                  <span className="font-bold text-emerald-300">
                    ₹{totalAdvancePayables.toLocaleString('en-IN', { minimumFractionDigits: 2 })} Cr
                  </span>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* 2. Side-by-Side: Today's Credit & Today's Debit */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          
          {/* Card A: Todays Credit */}
          <div className="bg-white rounded-xl border border-slate-200 border-l-4 border-l-emerald-500 p-5 shadow-xs hover:shadow-sm transition-all">
            <div className="flex items-start justify-between">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
                  <p className="text-xs font-bold uppercase tracking-wider text-slate-600 font-sans">
                    Todays Credit
                  </p>
                </div>
                <div className="text-2xl sm:text-3xl font-extrabold text-emerald-600 tracking-tight font-sans select-all pt-0.5">
                  <AmountDisplay 
                    amount={todayCredit} 
                    type="CREDIT" 
                    showDrCr={false} 
                    size="3xl" 
                  />
                </div>
              </div>

              <div className="p-3 rounded-xl bg-emerald-50 text-emerald-600 shrink-0 border border-emerald-100">
                <ArrowUpRight size={24} />
              </div>
            </div>

            <div className="mt-3 pt-3 border-t border-slate-100 flex items-center justify-between text-xs text-slate-600">
              <span className="font-medium">
                {todayCreditCount} {todayCreditCount === 1 ? 'credit entry' : 'credit entries'} received today
              </span>
              <button
                onClick={() => navigate('/log')}
                className="text-emerald-700 hover:text-emerald-900 font-bold transition-colors"
              >
                Journal →
              </button>
            </div>
          </div>

          {/* Card B: Todays Debit */}
          <div className="bg-white rounded-xl border border-slate-200 border-l-4 border-l-rose-500 p-5 shadow-xs hover:shadow-sm transition-all">
            <div className="flex items-start justify-between">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-rose-500"></span>
                  <p className="text-xs font-bold uppercase tracking-wider text-slate-600 font-sans">
                    Todays Debit
                  </p>
                </div>
                <div className="text-2xl sm:text-3xl font-extrabold text-rose-600 tracking-tight font-sans select-all pt-0.5">
                  <AmountDisplay 
                    amount={todayDebit} 
                    type="DEBIT" 
                    showDrCr={false} 
                    size="3xl" 
                  />
                </div>
              </div>

              <div className="p-3 rounded-xl bg-rose-50 text-rose-600 shrink-0 border border-rose-100">
                <ArrowDownRight size={24} />
              </div>
            </div>

            <div className="mt-3 pt-3 border-t border-slate-100 flex items-center justify-between text-xs text-slate-600">
              <span className="font-medium">
                {todayDebitCount} {todayDebitCount === 1 ? 'debit voucher' : 'debit vouchers'} billed today
              </span>
              <button
                onClick={() => navigate('/log')}
                className="text-rose-700 hover:text-rose-900 font-bold transition-colors"
              >
                Journal →
              </button>
            </div>
          </div>

        </div>

      </div>

      {/* Main Charts & Activity Row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* 12-Month Cashflow Column Chart (2 Cols) */}
        <Card className="lg:col-span-2">
          <CardHeader
            title="12-Month Transaction History"
            subtitle="Annual monthly debit vs credit breakdown (12 Column Overview)"
            action={
              <div className="flex items-center gap-4 text-xs font-semibold">
                <div className="flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-sm bg-rose-600"></span>
                  <span className="text-slate-700">Debit (Dr)</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-sm bg-emerald-600"></span>
                  <span className="text-slate-700">Credit (Cr)</span>
                </div>
              </div>
            }
          />

          <CardBody>
            <div className="h-[270px] sm:h-[310px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData} margin={{ top: 15, right: 10, left: 10, bottom: 5 }} barGap={3} barCategoryGap="20%">
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                  <XAxis 
                    dataKey="name" 
                    axisLine={{ stroke: '#e2e8f0' }} 
                    tickLine={false} 
                    tick={{ fontSize: 11, fill: '#64748b', fontWeight: 600 }} 
                    dy={6} 
                  />
                  <YAxis 
                    width={75}
                    axisLine={false} 
                    tickLine={false} 
                    tick={{ fontSize: 11, fill: '#64748b', fontWeight: 500 }} 
                    tickFormatter={(value) => `₹${value >= 100000 ? (value / 100000).toFixed(1) + 'L' : value >= 1000 ? (value / 1000).toFixed(0) + 'k' : value}`} 
                  />
                  <Tooltip 
                    cursor={{ fill: 'rgba(241, 245, 249, 0.6)' }}
                    content={({ active, payload, label }) => {
                      if (active && payload && payload.length) {
                        const data = payload[0].payload;
                        return (
                          <div className="bg-slate-900 text-white p-3 rounded-xl shadow-xl border border-slate-800 text-xs space-y-2 min-w-[170px]">
                            <div className="font-bold border-b border-slate-800 pb-1 text-slate-200 flex items-center justify-between">
                              <span>{data.fullMonth}</span>
                              <span className="text-[10px] font-normal text-slate-400">{data.txCount} entries</span>
                            </div>
                            <div className="flex items-center justify-between gap-3">
                              <span className="flex items-center gap-1.5 text-rose-400 font-semibold">
                                <span className="w-2 h-2 rounded-xs bg-rose-500"></span>
                                Debit (Dr):
                              </span>
                              <span className="font-bold tabular-nums">
                                ₹{Number(data.debit).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                              </span>
                            </div>
                            <div className="flex items-center justify-between gap-3">
                              <span className="flex items-center gap-1.5 text-emerald-400 font-semibold">
                                <span className="w-2 h-2 rounded-xs bg-emerald-500"></span>
                                Credit (Cr):
                              </span>
                              <span className="font-bold tabular-nums">
                                ₹{Number(data.credit).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                              </span>
                            </div>
                            <div className="pt-1 border-t border-slate-800 flex items-center justify-between text-[11px]">
                              <span className="text-slate-400 font-medium">Net Monthly Flow:</span>
                              <span className={`font-bold tabular-nums ${data.net >= 0 ? 'text-rose-400' : 'text-emerald-400'}`}>
                                ₹{Math.abs(data.net).toLocaleString('en-IN', { minimumFractionDigits: 2 })} {data.net >= 0 ? 'Dr' : 'Cr'}
                              </span>
                            </div>
                          </div>
                        );
                      }
                      return null;
                    }}
                  />
                  <Bar 
                    dataKey="debit" 
                    name="Debit (Dr)" 
                    fill={debitColor} 
                    radius={[4, 4, 0, 0]} 
                    maxBarSize={28}
                  />
                  <Bar 
                    dataKey="credit" 
                    name="Credit (Cr)" 
                    fill={creditColor} 
                    radius={[4, 4, 0, 0]} 
                    maxBarSize={28}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardBody>
        </Card>

        {/* Recent Transactions Feed (1 Col) */}
        <Card className="flex flex-col">
          <CardHeader
            title="Recent Ledger Entries"
            subtitle={`${transactions.length} entries in period`}
            action={
              <button
                onClick={() => navigate('/log')}
                className="text-xs font-bold text-blue-600 hover:text-blue-800 transition-colors"
              >
                Journal →
              </button>
            }
          />

          <div className="flex-1 overflow-y-auto max-h-[300px] divide-y divide-slate-100 p-0">
            {transactions.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-center text-slate-400 py-12 px-4">
                <FileText className="mx-auto mb-2 text-slate-300" size={28} />
                <p className="text-xs font-semibold">No recent transactions recorded</p>
                <p className="text-[11px] text-slate-400 mt-1">Record a debit or credit entry in Master Entry</p>
              </div>
            ) : (
              transactions.sort((a, b) => b.timestamp - a.timestamp).slice(0, 8).map(tx => {
                const party = parties.find(p => p.id === tx.partyId);
                return (
                  <div 
                    key={tx.id} 
                    onClick={() => party && navigate(`/parties/${party.id}`)}
                    className="p-3.5 hover:bg-slate-50 transition-colors flex items-center justify-between gap-3 cursor-pointer"
                  >
                    <div className="flex items-center min-w-0">
                      <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 mr-3 border ${
                        tx.type === 'DEBIT' 
                          ? 'bg-rose-50 border-rose-200 text-rose-600' 
                          : 'bg-emerald-50 border-emerald-200 text-emerald-600'
                      }`}>
                        {tx.type === 'DEBIT' ? <ArrowDownRight size={16} /> : <ArrowUpRight size={16} />}
                      </div>
                      <div className="min-w-0">
                        <p className="text-xs font-bold text-slate-900 truncate">{party?.name || 'Unknown Party'}</p>
                        <div className="flex items-center gap-1.5 text-[11px] text-slate-500 mt-0.5">
                          <span>{format(tx.timestamp, 'dd MMM, HH:mm')}</span>
                          {tx.invoiceNo && (
                            <>
                              <span>•</span>
                              <span className="text-slate-700 font-medium">Inv #{tx.invoiceNo}</span>
                            </>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="text-right shrink-0">
                      <AmountDisplay 
                        amount={tx.amount} 
                        type={tx.type} 
                        showDrCr={true} 
                        size="sm" 
                      />
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </Card>
      </div>

    </div>
  );
}
