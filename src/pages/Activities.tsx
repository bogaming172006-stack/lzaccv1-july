import React, { useState, useEffect } from 'react';
import { db, handleFirestoreError, OperationType, collection, getDocs } from '../firebase';
import { Transaction, Party, Ledger, LEDGER_TYPE_LABELS } from '../types';
import { useLedger } from '../LedgerContext';
import { useAuth } from '../AuthContext';
import { format } from 'date-fns';
import { Activity, Search, Loader2, ArrowRight, Trash2, Calendar, FileText } from 'lucide-react';
import { deleteTransaction } from '../lib/transactionService';

const BATCH_SIZE = 20;

const ledgerThemeMap: Record<Ledger['type'], {
  badge: string;
  topBorder: string;
  glow: string;
  textAccent: string;
  bgLight: string;
}> = {
  SALE: {
    badge: 'bg-sky-50 text-sky-700 border border-sky-100 dark:bg-sky-950/30 dark:text-sky-300 dark:border-sky-900/50',
    topBorder: 'border-t-sky-500',
    glow: 'bg-sky-500',
    textAccent: 'text-sky-700 dark:text-sky-400',
    bgLight: 'bg-sky-50/30'
  },
  PURCHASE: {
    badge: 'bg-purple-50 text-purple-700 border border-purple-100 dark:bg-purple-950/30 dark:text-purple-300 dark:border-purple-900/50',
    topBorder: 'border-t-purple-500',
    glow: 'bg-purple-500',
    textAccent: 'text-purple-700 dark:text-purple-400',
    bgLight: 'bg-purple-50/30'
  },
  CASH_BANK: {
    badge: 'bg-teal-50 text-teal-700 border border-teal-100 dark:bg-teal-950/30 dark:text-teal-300 dark:border-teal-900/50',
    topBorder: 'border-t-teal-500',
    glow: 'bg-teal-500',
    textAccent: 'text-teal-700 dark:text-teal-400',
    bgLight: 'bg-teal-50/30'
  },
  EXPENSE: {
    badge: 'bg-rose-50 text-rose-700 border border-rose-100 dark:bg-rose-950/30 dark:text-rose-300 dark:border-rose-900/50',
    topBorder: 'border-t-rose-500',
    glow: 'bg-rose-500',
    textAccent: 'text-rose-700 dark:text-rose-400',
    bgLight: 'bg-rose-50/30'
  },
  ASSET: {
    badge: 'bg-emerald-50 text-emerald-700 border border-emerald-100 dark:bg-emerald-950/30 dark:text-emerald-300 dark:border-emerald-900/50',
    topBorder: 'border-t-emerald-500',
    glow: 'bg-emerald-500',
    textAccent: 'text-emerald-700 dark:text-emerald-400',
    bgLight: 'bg-emerald-50/30'
  },
  LIABILITY: {
    badge: 'bg-amber-50 text-amber-700 border border-amber-100 dark:bg-amber-950/30 dark:text-amber-300 dark:border-amber-900/50',
    topBorder: 'border-t-amber-500',
    glow: 'bg-amber-500',
    textAccent: 'text-amber-700 dark:text-amber-400',
    bgLight: 'bg-amber-50/30'
  },
  CAPITAL: {
    badge: 'bg-indigo-50 text-indigo-700 border border-indigo-100 dark:bg-indigo-950/30 dark:text-indigo-300 dark:border-indigo-900/50',
    topBorder: 'border-t-indigo-500',
    glow: 'bg-indigo-500',
    textAccent: 'text-indigo-700 dark:text-indigo-400',
    bgLight: 'bg-indigo-50/30'
  }
};

export default function Activities() {
  const { ledgers } = useLedger();
  const { currentUser } = useAuth();
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [parties, setParties] = useState<Record<string, Party>>({});
  const [isLoading, setIsLoading] = useState(false);
  const [displayCount, setDisplayCount] = useState(BATCH_SIZE);

  // Search & Filter state
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'ALL' | 'DEBIT' | 'CREDIT'>('ALL');
  const [selectedLedgerId, setSelectedLedgerId] = useState<string>('ALL');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  // Deletion States
  const [deletingTx, setDeletingTx] = useState<Transaction | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deletePassword, setDeletePassword] = useState('');
  const [deletePasswordError, setDeletePasswordError] = useState('');

  const fetchAllData = async () => {
    setIsLoading(true);
    try {
      // 1. Fetch all parties to resolve party names across ledgers
      const partiesSnap = await getDocs(collection(db, 'parties'));
      const partiesMap: Record<string, Party> = {};
      partiesSnap.docs.forEach(doc => {
        if (doc.exists()) {
          const p = doc.data() as Party;
          partiesMap[p.id] = p;
        }
      });
      setParties(partiesMap);

      // 2. Fetch all transactions across ALL ledgers
      const txSnap = await getDocs(collection(db, 'transactions'));
      const txList: Transaction[] = [];
      txSnap.docs.forEach(doc => {
        if (doc.exists()) {
          txList.push(doc.data() as Transaction);
        }
      });
      txList.sort((a, b) => b.timestamp - a.timestamp);
      setTransactions(txList);
    } catch (err) {
      console.error("Failed to fetch global activities data:", err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchAllData();

    const handleSync = () => {
      fetchAllData();
    };
    window.addEventListener('database-synced', handleSync);
    return () => {
      window.removeEventListener('database-synced', handleSync);
    };
  }, []);

  // Recalculate display count on filter shifts
  useEffect(() => {
    setDisplayCount(BATCH_SIZE);
  }, [filter, search, selectedLedgerId, startDate, endDate]);

  const handleDeleteTx = async () => {
    if (!deletingTx) return;
    if (deletePassword !== 'greenzarthing6211') {
      setDeletePasswordError('Invalid admin password');
      return;
    }
    const party = parties[deletingTx.partyId];
    if (!party) {
      alert("Cannot delete transaction: Associated party not found.");
      return;
    }

    setIsDeleting(true);
    try {
      const success = await deleteTransaction(deletingTx, party);
      if (success) {
        setShowDeleteConfirm(false);
        setDeletingTx(null);
        setDeletePassword('');
        setDeletePasswordError('');
        await fetchAllData();
      } else {
        alert("Failed to delete transaction.");
      }
    } catch (err: any) {
      handleFirestoreError(err, OperationType.DELETE, `transactions/${deletingTx.id}`);
    } finally {
      setIsDeleting(false);
    }
  };

  // 1. Ledger-wise summaries (aggregated across all transaction data)
  const ledgerSummaries = ledgers.map(ledger => {
    const ledgerTxs = transactions.filter(t => t.ledgerId === ledger.id);
    const debitSum = ledgerTxs.filter(t => t.type === 'DEBIT').reduce((acc, t) => acc + t.amount, 0);
    const creditSum = ledgerTxs.filter(t => t.type === 'CREDIT').reduce((acc, t) => acc + t.amount, 0);
    return {
      ledger,
      debitSum,
      creditSum,
      netBalance: creditSum - debitSum,
      count: ledgerTxs.length
    };
  });

  // 2. Filter global ledger transactions
  const filteredDisplay = transactions
    .filter(tx => selectedLedgerId === 'ALL' || tx.ledgerId === selectedLedgerId)
    .filter(tx => filter === 'ALL' || tx.type === filter)
    .filter(tx => {
      if (startDate && new Date(startDate).getTime() > tx.timestamp) return false;
      if (endDate) {
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        if (end.getTime() < tx.timestamp) return false;
      }
      return true;
    })
    .filter(tx => {
      if (!search) return true;
      const lowerSearch = search.toLowerCase();
      const party = parties[tx.partyId];
      const ledger = ledgers.find(l => l.id === tx.ledgerId);
      return (tx.invoiceNo || '').toLowerCase().includes(lowerSearch) || 
             (tx.notes || '').toLowerCase().includes(lowerSearch) || 
             (party?.name || '').toLowerCase().includes(lowerSearch) ||
             (ledger?.name || '').toLowerCase().includes(lowerSearch);
    });

  // Overall totals for the currently selected search/filter results
  const totalDebit = filteredDisplay
    .filter(tx => tx.type === 'DEBIT')
    .reduce((sum, tx) => sum + tx.amount, 0);

  const totalCredit = filteredDisplay
    .filter(tx => tx.type === 'CREDIT')
    .reduce((sum, tx) => sum + tx.amount, 0);

  const filtered = filteredDisplay.slice(0, displayCount);
  const hasMore = displayCount < filteredDisplay.length;

  return (
    <div className="p-4 sm:p-8 max-w-7xl mx-auto w-full pb-24 sm:pb-8">
      {/* Header */}
      <div className="mb-8 flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900 tracking-tight flex items-center gap-2">
            <Activity className="text-sky-600" size={24} />
            All Ledger Activities
            {isLoading && <Loader2 className="animate-spin text-gray-400" size={20} />}
          </h1>
          <p className="text-sm text-gray-500 mt-1">Cross-ledger audit logs, total debit/credit breakdown, and global transaction stream</p>
        </div>
      </div>

      {/* Ledger-wise Metrics Grid */}
      <div className="mb-8">
        <h2 className="text-sm font-bold text-gray-700 uppercase tracking-wider mb-4">Ledger Overview</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {ledgerSummaries.map(({ ledger, debitSum, creditSum, netBalance, count }) => {
            const theme = ledgerThemeMap[ledger.type] || {
              badge: 'bg-gray-100 text-gray-600',
              topBorder: 'border-t-gray-450',
              glow: 'bg-gray-400',
              textAccent: 'text-gray-750',
              bgLight: 'bg-gray-50/50'
            };
            return (
              <div key={ledger.id} className={`bg-white rounded-xl shadow-sm border border-gray-200/80 border-t-4 ${theme.topBorder} p-5 hover:shadow-md transition-shadow`}>
                <div className="flex justify-between items-start mb-2">
                  <div className="flex items-center gap-2 truncate max-w-[180px]">
                    <span className={`w-2 h-2 rounded-full ${theme.glow} shrink-0`} />
                    <h3 className="font-bold text-gray-900 truncate" title={ledger.name}>{ledger.name}</h3>
                  </div>
                  <span className={`text-[10px] font-semibold px-2 py-0.5 rounded ${theme.badge}`}>
                    {LEDGER_TYPE_LABELS[ledger.type] || ledger.type}
                  </span>
                </div>
                <p className="text-xs text-gray-400 mb-4">{count} total entries</p>
                
                <div className="grid grid-cols-2 gap-2 border-t pt-3 border-gray-100 text-xs">
                  <div>
                    <span className="text-gray-400 font-medium">Total Dr:</span>
                    <div className="font-bold text-red-600 mt-0.5">
                      ₹{debitSum.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                    </div>
                  </div>
                  <div className="border-l pl-2 border-gray-100">
                    <span className="text-gray-400 font-medium">Total Cr:</span>
                    <div className="font-bold text-emerald-600 mt-0.5">
                      ₹{creditSum.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                    </div>
                  </div>
                </div>
                
                <div className="mt-4 pt-3 border-t border-gray-100 flex justify-between items-center text-xs">
                  <span className="text-gray-500 font-medium">Ledger Balance:</span>
                  <span className={`font-bold ${netBalance >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>
                    ₹{Math.abs(netBalance).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                    <span className="text-[10px] font-normal ml-0.5">
                      {netBalance >= 0 ? '(Cr)' : '(Dr)'}
                    </span>
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Global Activity Log */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-150 overflow-hidden">
        {/* Table & Filtering Header */}
        <div className="p-4 border-b border-gray-100 bg-gray-50/50 flex flex-col gap-4">
          <div className="flex flex-col gap-3">
            <div className="flex flex-col md:flex-row gap-3 items-center justify-between w-full">
              {/* Ledger selector + DR/CR toggle */}
              <div className="flex flex-col sm:flex-row gap-2 w-full md:w-auto shrink-0">
                <select
                  value={selectedLedgerId}
                  onChange={e => setSelectedLedgerId(e.target.value)}
                  className="px-3 py-1.5 border border-gray-200 rounded-md text-xs font-bold bg-white text-gray-700 focus:outline-none focus:ring-1 focus:ring-sky-500 shadow-xs"
                >
                  <option value="ALL">All Ledgers</option>
                  {ledgers.map(l => (
                    <option key={l.id} value={l.id}>{l.name}</option>
                  ))}
                </select>

                <div className="flex bg-gray-100 p-1 rounded-md shrink-0">
                  {(['ALL', 'DEBIT', 'CREDIT'] as const).map(tab => (
                    <button
                      key={tab}
                      onClick={() => setFilter(tab)}
                      className={`flex-1 sm:flex-none px-3 py-1 text-xs font-bold rounded capitalize transition-all ${
                        filter === tab ? 'bg-white text-gray-900 shadow-xs' : 'text-gray-500 hover:text-gray-750'
                      }`}
                    >
                      {tab.toLowerCase()}
                    </button>
                  ))}
                </div>
              </div>

              {/* General Search Input */}
              <div className="relative w-full md:w-72 border border-gray-200 bg-white rounded-md flex items-center px-3 shadow-xs">
                <Search size={15} className="text-gray-400 shrink-0" />
                <input 
                  type="text" 
                  placeholder="Search across all entries..." 
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  className="w-full py-1.5 ml-2 bg-transparent focus:outline-none text-xs sm:text-sm"
                />
              </div>
            </div>

            {/* Date range filters */}
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex items-center bg-white border border-gray-200 rounded-md px-2.5 py-1 shadow-xs shrink-0">
                <span className="text-[10px] sm:text-xs text-gray-400 font-semibold mr-1.5">From:</span>
                <input 
                  type="date" 
                  className="bg-transparent focus:outline-none text-xs sm:text-sm text-gray-700 w-28"
                  value={startDate}
                  onChange={e => setStartDate(e.target.value)}
                />
              </div>
              <div className="flex items-center bg-white border border-gray-200 rounded-md px-2.5 py-1 shadow-xs shrink-0">
                <span className="text-[10px] sm:text-xs text-gray-400 font-semibold mr-1.5">To:</span>
                <input 
                  type="date" 
                  className="bg-transparent focus:outline-none text-xs sm:text-sm text-gray-700 w-28"
                  value={endDate}
                  onChange={e => setEndDate(e.target.value)}
                />
              </div>
              {(startDate || endDate) && (
                <button 
                  onClick={() => { setStartDate(''); setEndDate(''); }}
                  className="text-xs text-sky-650 hover:text-sky-800 font-bold px-2 py-1 bg-sky-50 rounded-md"
                >
                  Clear Dates
                </button>
              )}
            </div>
          </div>

          {/* Global Search Totals Display */}
          <div className="grid grid-cols-3 gap-2 sm:gap-4 border-t border-gray-100 pt-3 mt-1">
            <div className="bg-red-50/50 rounded-lg p-2 sm:p-3.5 border border-red-100/50 flex flex-col justify-between">
              <span className="text-[9px] sm:text-[10px] uppercase font-bold tracking-wider text-red-700/80 truncate">Debit (Dr)</span>
              <div className="text-xs sm:text-lg font-extrabold text-red-700 mt-0.5 break-all">
                ₹{totalDebit.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}
              </div>
              <div className="hidden sm:block text-[9px] text-gray-400 mt-1">Active filters</div>
            </div>

            <div className="bg-emerald-50/50 rounded-lg p-2 sm:p-3.5 border border-emerald-100/50 flex flex-col justify-between">
              <span className="text-[9px] sm:text-[10px] uppercase font-bold tracking-wider text-emerald-700/80 truncate">Credit (Cr)</span>
              <div className="text-xs sm:text-lg font-extrabold text-emerald-700 mt-0.5 break-all">
                ₹{totalCredit.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}
              </div>
              <div className="hidden sm:block text-[9px] text-gray-400 mt-1">Active filters</div>
            </div>

            <div className={`rounded-lg p-2 sm:p-3.5 border flex flex-col justify-between ${(totalCredit - totalDebit) >= 0 ? 'bg-sky-50/50 border-sky-100/50' : 'bg-amber-50/50 border-amber-100/50'}`}>
              <span className="text-[9px] sm:text-[10px] uppercase font-bold tracking-wider text-gray-600 truncate">Net Balance</span>
              <div className={`text-xs sm:text-lg font-extrabold mt-0.5 break-all ${(totalCredit - totalDebit) >= 0 ? 'text-sky-700' : 'text-amber-700'}`}>
                ₹{Math.abs(totalCredit - totalDebit).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}
                <span className="block text-[8px] sm:inline sm:text-[10px] font-semibold sm:ml-1 text-gray-500">
                  {(totalCredit - totalDebit) >= 0 ? 'Cr' : 'Dr'}
                </span>
              </div>
              <div className="hidden sm:block text-[9px] text-gray-400 mt-1">Net movement</div>
            </div>
          </div>
        </div>

        {/* Global Transaction Table (Desktop View) */}
        <div className="hidden md:block overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-white border-b text-xs uppercase tracking-wider text-gray-500">
                <th className="p-4 font-medium">Date</th>
                <th className="p-4 font-medium">Ledger</th>
                <th className="p-4 font-medium">Party</th>
                <th className="p-4 font-medium">Details</th>
                <th className="p-4 font-medium text-right">Amount</th>
                {currentUser?.isAdmin && <th className="p-4 font-medium text-center">Actions</th>}
              </tr>
            </thead>
            <tbody>
              {filtered.map(tx => {
                const party = parties[tx.partyId];
                const ledger = ledgers.find(l => l.id === tx.ledgerId);
                return (
                  <tr key={tx.id} className="border-b border-gray-50 hover:bg-gray-50 transition-colors text-sm">
                    <td className="p-4 text-gray-500 whitespace-nowrap">
                      {format(new Date(tx.timestamp), 'dd MMM yyyy')}
                      <div className="text-xs text-gray-400 mt-0.5">{format(new Date(tx.timestamp), 'HH:mm')}</div>
                    </td>
                    <td className="p-4">
                      <div className="font-semibold text-gray-900">{ledger?.name || 'Unknown Ledger'}</div>
                      <div className="text-xs text-gray-500">{ledger ? LEDGER_TYPE_LABELS[ledger.type] : ''}</div>
                    </td>
                    <td className="p-4">
                      <div className="font-medium text-gray-900">{party?.name || 'Unknown Party'}</div>
                    </td>
                    <td className="p-4 text-gray-600">
                      <div>{tx.notes || '-'}</div>
                      {tx.invoiceNo && <div className="text-xs font-mono text-gray-400 mt-0.5">Ref: {tx.invoiceNo}</div>}
                    </td>
                    <td className="p-4 text-right">
                      <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium ${tx.type === 'DEBIT' ? 'bg-red-50 text-red-700' : 'bg-green-50 text-green-700'}`}>
                        {tx.type === 'DEBIT' ? 'Dr ' : 'Cr '}
                        ₹{tx.amount.toLocaleString(undefined, {minimumFractionDigits:2})}
                      </span>
                    </td>
                    {currentUser?.isAdmin && (
                      <td className="p-4 text-center whitespace-nowrap">
                        <button
                          onClick={() => {
                            setDeletingTx(tx);
                            setShowDeleteConfirm(true);
                          }}
                          className="text-gray-400 hover:text-red-600 transition-colors p-1 rounded hover:bg-red-50"
                          title="Delete Transaction"
                        >
                          <Trash2 size={16} />
                        </button>
                      </td>
                    )}
                  </tr>
                )
              })}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={currentUser?.isAdmin ? 6 : 5} className="p-12 text-center text-sm text-gray-500">
                    <FileText size={32} className="mx-auto mb-3 text-gray-300" />
                    No transactions found matching the specified filters across ledgers.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Global Transaction List (Mobile View) */}
        <div className="block md:hidden divide-y divide-gray-100 bg-white">
          {filtered.map(tx => {
            const party = parties[tx.partyId];
            const ledger = ledgers.find(l => l.id === tx.ledgerId);
            return (
              <div key={tx.id} className="p-3 hover:bg-gray-50/40 transition-colors flex items-center justify-between gap-3 text-sm">
                <div className="flex items-center gap-3 min-w-0">
                  {/* Compact Date Badge */}
                  <div className="flex flex-col items-center justify-center bg-gray-50 text-gray-500 rounded p-1 min-w-[38px] h-[38px] text-center border border-gray-100 shrink-0">
                    <span className="text-[8px] font-bold uppercase leading-none">{format(new Date(tx.timestamp), 'MMM')}</span>
                    <span className="text-xs font-extrabold text-gray-800 leading-tight mt-0.5">{format(new Date(tx.timestamp), 'dd')}</span>
                  </div>
                  
                  {/* Party & Info */}
                  <div className="min-w-0">
                    <h4 className="font-semibold text-gray-950 text-xs sm:text-sm truncate">{party?.name || 'Unknown'}</h4>
                    <p className="text-[11px] text-gray-500 truncate mt-0.5 flex items-center gap-1.5 flex-wrap">
                      {ledger && (
                        <span className="inline-block bg-sky-50 text-[9px] text-sky-700 font-bold px-1.5 py-0.5 rounded uppercase tracking-wider shrink-0 max-w-[100px] truncate">
                          {ledger.name}
                        </span>
                      )}
                      <span className="truncate">{tx.notes || 'No notes'}</span>
                      {tx.invoiceNo && <span className="font-mono text-gray-400">({tx.invoiceNo})</span>}
                    </p>
                  </div>
                </div>

                {/* Amount & Quick Actions */}
                <div className="flex items-center gap-2 shrink-0">
                  <div className="text-right">
                    <span className={`text-[8px] sm:text-[9px] uppercase font-bold tracking-wider leading-none block mb-0.5 ${tx.type === 'DEBIT' ? 'text-red-500' : 'text-emerald-500'}`}>
                      {tx.type === 'DEBIT' ? 'Debit (Dr)' : 'Credit (Cr)'}
                    </span>
                    <div className={`font-extrabold text-xs sm:text-sm ${tx.type === 'DEBIT' ? 'text-red-600' : 'text-emerald-600'}`}>
                      {tx.type === 'DEBIT' ? '-' : '+'}₹{tx.amount.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                    </div>
                  </div>

                  {currentUser?.isAdmin && (
                    <div className="flex items-center gap-0.5 border-l pl-2 border-gray-150">
                      <button
                        onClick={() => {
                          setDeletingTx(tx);
                          setShowDeleteConfirm(true);
                        }}
                        className="text-gray-400 hover:text-red-600 p-2 rounded-md hover:bg-red-50 active:bg-red-100 transition-colors"
                        title="Delete Transaction"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
          {filtered.length === 0 && (
            <div className="p-8 text-center text-sm text-gray-500 bg-white flex flex-col items-center">
              <FileText size={32} className="mb-2 text-gray-300" />
              No transactions found matching the specified filters across ledgers.
            </div>
          )}
        </div>

        {/* Load More */}
        {hasMore && (
          <div className="p-4 border-t border-gray-55 bg-gray-50/10 flex justify-center">
            <button
              onClick={() => setDisplayCount(prev => prev + BATCH_SIZE)}
              className="flex items-center px-4 py-2 text-xs font-semibold text-sky-600 hover:text-sky-800 transition-colors"
            >
              Load Older Transactions
              <ArrowRight size={14} className="ml-1" />
            </button>
          </div>
        )}
      </div>

      {/* Admin confirmation Modal for Global Deletion */}
      {showDeleteConfirm && deletingTx && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-fade-in">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md overflow-hidden border border-gray-100">
            <div className="flex justify-between items-center p-4 border-b">
              <h3 className="font-semibold text-lg text-red-600 flex items-center gap-2">
                <Trash2 size={20} />
                Delete Entry (Global Audit)
              </h3>
              <button 
                type="button" 
                onClick={() => { setShowDeleteConfirm(false); setDeletingTx(null); setDeletePassword(''); setDeletePasswordError(''); }} 
                className="text-gray-400 hover:text-gray-600 font-bold text-xl"
              >
                &times;
              </button>
            </div>
            <div className="p-6 space-y-4">
              <p className="text-gray-600 text-sm leading-relaxed">
                Are you sure you want to delete this transaction entry? This action is irreversible. All related calculations, party outstanding dues, and ledger totals will be automatically recalculated.
              </p>
              
              <div className="bg-gray-50 p-4 rounded-lg space-y-2 border border-gray-100 text-sm">
                <div className="flex justify-between text-gray-500">
                  <span>Ledger:</span>
                  <span className="font-medium text-gray-900">{ledgers.find(l => l.id === deletingTx.ledgerId)?.name || 'Unknown'}</span>
                </div>
                <div className="flex justify-between text-gray-500">
                  <span>Party:</span>
                  <span className="font-medium text-gray-900">{parties[deletingTx.partyId]?.name || 'Unknown'}</span>
                </div>
                <div className="flex justify-between text-gray-500">
                  <span>Type:</span>
                  <span className={`font-semibold ${deletingTx.type === 'DEBIT' ? 'text-red-600' : 'text-green-600'}`}>
                    {deletingTx.type}
                  </span>
                </div>
                <div className="flex justify-between text-gray-500">
                  <span>Amount:</span>
                  <span className="font-bold text-gray-900">₹{deletingTx.amount.toLocaleString(undefined, {minimumFractionDigits: 2})}</span>
                </div>
                {deletingTx.notes && (
                  <div className="flex justify-between text-gray-500">
                    <span>Notes:</span>
                    <span className="font-medium text-gray-900 max-w-[200px] truncate">{deletingTx.notes}</span>
                  </div>
                )}
              </div>

              <div className="space-y-1.5 pt-2">
                <label className="block text-xs font-bold uppercase tracking-wider text-gray-500">
                  Admin Password
                </label>
                <input
                  type="password"
                  placeholder="Enter Admin Password to confirm"
                  value={deletePassword}
                  onChange={(e) => {
                    setDeletePassword(e.target.value);
                    setDeletePasswordError('');
                  }}
                  className="w-full px-3 py-2 border border-gray-250 rounded-md focus:outline-none focus:ring-1 focus:ring-red-500 focus:border-red-500 text-sm"
                />
                {deletePasswordError && (
                  <p className="text-xs text-red-600 font-semibold mt-0.5">
                    {deletePasswordError}
                  </p>
                )}
              </div>
            </div>
            <div className="p-4 bg-gray-50 border-t flex justify-end space-x-2">
              <button
                type="button"
                onClick={() => { setShowDeleteConfirm(false); setDeletingTx(null); setDeletePassword(''); setDeletePasswordError(''); }}
                className="px-4 py-2 border rounded-md text-gray-700 hover:bg-gray-50 font-medium text-sm transition-all"
                disabled={isDeleting}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleDeleteTx}
                className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-md font-medium text-sm transition-all flex items-center justify-center"
                disabled={isDeleting}
              >
                {isDeleting ? (
                  <>
                    <Loader2 size={16} className="animate-spin mr-2" />
                    Deleting...
                  </>
                ) : (
                  'Yes, Delete Entry'
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
