import React, { useState, useEffect } from 'react';
import { db, handleFirestoreError, OperationType, collection, getDocs, query, where, limit, orderBy } from '../firebase';
import { Transaction, Party } from '../types';
import { useLedger } from '../LedgerContext';
import { useAuth } from '../AuthContext';
import { format, startOfDay, endOfDay, subDays } from 'date-fns';
import { Search, Loader2, ArrowRight, Trash2, Printer, User } from 'lucide-react';
import { getFilteredCacheItems } from '../lib/idbCache';
import { syncCollection } from '../lib/syncCache';
import { deleteTransaction } from '../lib/transactionService';
import ThermalReceiptModal from '../components/ThermalReceiptModal';
import TransactionDetailModal from '../components/TransactionDetailModal';

const BATCH_SIZE = 20;
const todayStr = format(new Date(), 'yyyy-MM-dd');

export default function Log() {
  const { activeLedger } = useLedger();
  const { currentUser } = useAuth();
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [receiptTx, setReceiptTx] = useState<Transaction | null>(null);
  const [selectedDetailTx, setSelectedDetailTx] = useState<Transaction | null>(null);
  const [parties, setParties] = useState<Record<string, Party>>({});
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'ALL' | 'DEBIT' | 'CREDIT'>('ALL');
  const [startDate, setStartDate] = useState(todayStr);
  const [endDate, setEndDate] = useState(todayStr);
  const [isLoading, setIsLoading] = useState(false);
  const [displayCount, setDisplayCount] = useState(BATCH_SIZE);

  // Deletion States
  const [deletingTx, setDeletingTx] = useState<Transaction | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deletePassword, setDeletePassword] = useState('');
  const [deletePasswordError, setDeletePasswordError] = useState('');

  // Sync parties from local cash
  const loadPartiesFromCache = async () => {
    if (!activeLedger?.id) return;
    const cached = await getFilteredCacheItems<Party>('parties', p => p.ledgerId === activeLedger.id);
    const pDict: Record<string, Party> = {};
    cached.forEach(p => {
      pDict[p.id] = p;
    });
    setParties(pDict);
  };

  const fetchTransactions = async () => {
    if (!activeLedger?.id) return;
    setIsLoading(true);

    try {
      // 1. Optimistic fast load from local cache
      const cached = await getFilteredCacheItems<Transaction>('transactions', t => t.ledgerId === activeLedger.id);
      cached.sort((a, b) => b.timestamp - a.timestamp);
      setTransactions(cached);

      // 2. Sync transactions in background
      await syncCollection<Transaction>('transactions', activeLedger.id, 'transactions');
      
      // 3. Load latest update
      const fresh = await getFilteredCacheItems<Transaction>('transactions', t => t.ledgerId === activeLedger.id);
      fresh.sort((a, b) => b.timestamp - a.timestamp);
      setTransactions(fresh);
    } catch (err) {
      console.error("Log fetchTransactions failure: ", err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (activeLedger?.id) {
      loadPartiesFromCache();
      fetchTransactions();
      setDisplayCount(BATCH_SIZE);
    } else {
      setTransactions([]);
      setParties({});
    }

    const handleSync = () => {
      if (activeLedger?.id) {
        loadPartiesFromCache();
        fetchTransactions();
      }
    };
    window.addEventListener('database-synced', handleSync);
    return () => {
      window.removeEventListener('database-synced', handleSync);
    };
  }, [activeLedger?.id]);

  useEffect(() => {
    setDisplayCount(BATCH_SIZE);
  }, [filter, search, startDate, endDate]);

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
        await fetchTransactions();
      } else {
        alert("Failed to delete transaction.");
      }
    } catch (err: any) {
      handleFirestoreError(err, OperationType.DELETE, `transactions/${deletingTx.id}`);
    } finally {
      setIsDeleting(false);
    }
  };

  if (!activeLedger) return <div className="p-8 text-center text-gray-500">Please select a ledger.</div>;

  // Filter global ledger list on client-side
  const filteredDisplay = transactions
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
      return (tx.invoiceNo || '').toLowerCase().includes(lowerSearch) || 
             (tx.notes || '').toLowerCase().includes(lowerSearch) || 
             (party?.name || '').toLowerCase().includes(lowerSearch);
    });

  // Calculate totals matching date and search filters (independent of tab selection so user always gets the full picture)
  const dateAndSearchFiltered = transactions
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
      return (tx.invoiceNo || '').toLowerCase().includes(lowerSearch) || 
             (tx.notes || '').toLowerCase().includes(lowerSearch) || 
             (party?.name || '').toLowerCase().includes(lowerSearch);
    });

  const totalDebit = dateAndSearchFiltered
    .filter(tx => tx.type === 'DEBIT')
    .reduce((sum, tx) => sum + tx.amount, 0);

  const totalCredit = dateAndSearchFiltered
    .filter(tx => tx.type === 'CREDIT')
    .reduce((sum, tx) => sum + tx.amount, 0);

  const filtered = filteredDisplay.slice(0, displayCount);
  const hasMore = displayCount < filteredDisplay.length;

  return (
    <div className="p-4 sm:p-8 max-w-7xl mx-auto w-full pb-24 sm:pb-8">
      <div className="mb-8 flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900 tracking-tight flex items-center gap-2">
            Day Log
            {isLoading && <Loader2 className="animate-spin text-gray-400" size={20} />}
          </h1>
          <p className="text-sm text-gray-500 mt-1">Review all global transactions for {activeLedger.name}</p>
        </div>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="p-4 border-b border-gray-100 bg-gray-50/50 flex flex-col gap-4">
          <div className="flex flex-col gap-3">
            <div className="flex flex-col md:flex-row gap-3 items-center justify-between w-full">
              <div className="flex bg-gray-100 p-1 rounded-md w-full md:w-auto shrink-0">
                {(['ALL', 'DEBIT', 'CREDIT'] as const).map(tab => (
                  <button
                    key={tab}
                    onClick={() => setFilter(tab)}
                    className={`flex-1 md:flex-none px-4 py-1.5 text-xs font-bold rounded capitalize transition-all ${
                      filter === tab ? 'bg-white text-gray-900 shadow-xs' : 'text-gray-500 hover:text-gray-750'
                    }`}
                  >
                    {tab.toLowerCase()}
                  </button>
                ))}
              </div>

              <div className="relative w-full md:w-72 border border-gray-200 bg-white rounded-md flex items-center px-3 shadow-xs">
                <Search size={15} className="text-gray-400 shrink-0" />
                <input 
                  type="text" 
                  placeholder="Search invoice, notes, party..." 
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  className="w-full py-1.5 ml-2 bg-transparent focus:outline-none text-xs sm:text-sm"
                />
              </div>
            </div>
            
            <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-gray-100">
              <div className="flex bg-gray-100 p-1 rounded-md shrink-0 gap-1 text-xs font-bold">
                <button
                  type="button"
                  onClick={() => {
                    setStartDate(todayStr);
                    setEndDate(todayStr);
                  }}
                  className={`px-2.5 py-1 rounded transition-all cursor-pointer ${
                    startDate === todayStr && endDate === todayStr
                      ? 'bg-sky-600 text-white shadow-xs'
                      : 'text-gray-600 hover:text-gray-900 hover:bg-white/60'
                  }`}
                >
                  Today
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setStartDate(format(subDays(new Date(), 6), 'yyyy-MM-dd'));
                    setEndDate(todayStr);
                  }}
                  className={`px-2.5 py-1 rounded transition-all cursor-pointer ${
                    startDate === format(subDays(new Date(), 6), 'yyyy-MM-dd') && endDate === todayStr
                      ? 'bg-sky-600 text-white shadow-xs'
                      : 'text-gray-600 hover:text-gray-900 hover:bg-white/60'
                  }`}
                >
                  7 Days
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setStartDate(format(subDays(new Date(), 29), 'yyyy-MM-dd'));
                    setEndDate(todayStr);
                  }}
                  className={`px-2.5 py-1 rounded transition-all cursor-pointer ${
                    startDate === format(subDays(new Date(), 29), 'yyyy-MM-dd') && endDate === todayStr
                      ? 'bg-sky-600 text-white shadow-xs'
                      : 'text-gray-600 hover:text-gray-900 hover:bg-white/60'
                  }`}
                >
                  30 Days
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setStartDate('');
                    setEndDate('');
                  }}
                  className={`px-2.5 py-1 rounded transition-all cursor-pointer ${
                    !startDate && !endDate
                      ? 'bg-sky-600 text-white shadow-xs'
                      : 'text-gray-600 hover:text-gray-900 hover:bg-white/60'
                  }`}
                >
                  All Time
                </button>
              </div>

              <div className="flex items-center gap-2">
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
              </div>
            </div>
          </div>

          {/* Filtered Totals Summary Cards */}
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

        {/* Responsive Transaction List */}
        <div className="hidden md:block overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-white border-b text-xs uppercase tracking-wider text-gray-500">
                <th className="p-4 font-medium">Date</th>
                <th className="p-4 font-medium">Party</th>
                <th className="p-4 font-medium">Details</th>
                <th className="p-4 font-medium text-right">Amount</th>
                {currentUser?.isAdmin && <th className="p-4 font-medium">Entry By</th>}
                {currentUser?.isAdmin && <th className="p-4 font-medium text-center">Actions</th>}
              </tr>
            </thead>
            <tbody>
              {filtered.map(tx => {
                 const party = parties[tx.partyId];
                 return (
                   <tr 
                     key={tx.id} 
                     onClick={() => setSelectedDetailTx(tx)}
                     className="border-b border-gray-50 hover:bg-gray-50 transition-colors text-sm cursor-pointer"
                   >
                     <td className="p-4 text-gray-500 whitespace-nowrap">
                       {format(new Date(tx.timestamp), 'dd MMM yyyy')}
                       <div className="text-xs text-gray-400 mt-0.5">{format(new Date(tx.timestamp), 'HH:mm')}</div>
                     </td>
                     <td className="p-4">
                       <div className="font-medium text-gray-900">{party?.name || 'Unknown'}</div>
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
                       <td className="p-4 whitespace-nowrap">
                         <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-700 bg-slate-100 px-2.5 py-1 rounded-md border border-slate-200">
                           <User size={12} className="text-slate-400" />
                           {tx.createdBy || 'Admin'}
                         </span>
                       </td>
                     )}
                     {currentUser?.isAdmin && (
                       <td className="p-4 text-center whitespace-nowrap">
                         <button
                           onClick={(e) => {
                             e.stopPropagation();
                             setDeletingTx(tx);
                             setShowDeleteConfirm(true);
                           }}
                           className="text-gray-400 hover:text-red-600 transition-colors p-1.5 rounded hover:bg-red-50"
                           title="Delete Transaction"
                         >
                           <Trash2 size={15} />
                         </button>
                       </td>
                     )}
                   </tr>
                 )
               })}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={currentUser?.isAdmin ? 6 : 4} className="p-8 text-center text-sm text-gray-500">
                    No transactions loaded matching current filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Mobile View Card List */}
        <div className="block md:hidden divide-y divide-gray-100 bg-white">
          {filtered.map(tx => {
            const party = parties[tx.partyId];
            return (
              <div 
                key={tx.id} 
                onClick={() => setSelectedDetailTx(tx)}
                className="p-3 hover:bg-gray-50/40 transition-colors flex items-center justify-between gap-3 text-sm cursor-pointer"
              >
                <div className="flex items-center gap-3 min-w-0">
                  {/* Compact Date Badge */}
                  <div className="flex flex-col items-center justify-center bg-gray-50 text-gray-500 rounded p-1 min-w-[38px] h-[38px] text-center border border-gray-100 shrink-0">
                    <span className="text-[8px] font-bold uppercase leading-none">{format(new Date(tx.timestamp), 'MMM')}</span>
                    <span className="text-xs font-extrabold text-gray-800 leading-tight mt-0.5">{format(new Date(tx.timestamp), 'dd')}</span>
                  </div>
                  
                  {/* Party & Info */}
                  <div className="min-w-0">
                    <h4 className="font-semibold text-gray-950 text-xs sm:text-sm truncate">{party?.name || 'Unknown'}</h4>
                    <p className="text-[11px] text-gray-500 truncate mt-0.5 flex items-center gap-1.5">
                      <span className="truncate">{tx.notes || 'No notes'}</span>
                      {tx.invoiceNo && <span className="font-mono text-gray-400">({tx.invoiceNo})</span>}
                    </p>
                    {currentUser?.isAdmin && (
                      <div className="mt-1">
                        <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-slate-700 bg-slate-100 px-1.5 py-0.5 rounded border border-slate-200">
                          <User size={10} className="text-slate-400" />
                          By: {tx.createdBy || 'Admin'}
                        </span>
                      </div>
                    )}
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

                  {/* Icon Actions with slightly larger touch target box */}
                  {currentUser?.isAdmin && (
                    <div className="flex items-center gap-0.5 border-l pl-2 border-gray-150">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
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
            <div className="p-8 text-center text-sm text-gray-500 bg-white">
              No transactions loaded matching current filters.
            </div>
          )}
        </div>

        {/* Load More Trigger */}
        {hasMore && (
          <div className="p-4 border-t border-gray-50 bg-gray-50/10 flex justify-center">
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

      {showDeleteConfirm && deletingTx && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-fade-in">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md overflow-hidden border border-gray-100">
            <div className="flex justify-between items-center p-4 border-b">
              <h3 className="font-semibold text-lg text-red-600 flex items-center gap-2">
                <Trash2 size={20} />
                Delete Entry
              </h3>
              <button 
                type="button" 
                onClick={() => { setShowDeleteConfirm(false); setDeletingTx(null); setDeletePassword(''); setDeletePasswordError(''); }} 
                className="text-gray-400 hover:text-gray-600 font-bold text-xl"
              >
                ×
              </button>
            </div>
            <div className="p-6 space-y-4">
              <p className="text-gray-600 text-sm leading-relaxed">
                Are you sure you want to delete this transaction entry? This action is irreversible. All related calculations, party outstanding dues, and daily logs will be automatically recalculated.
              </p>
              
              <div className="bg-gray-50 p-4 rounded-lg space-y-2 border border-gray-100 text-sm">
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
                {deletingTx.invoiceNo && (
                  <div className="flex justify-between text-gray-500">
                    <span>Reference:</span>
                    <span className="font-mono text-gray-900">{deletingTx.invoiceNo}</span>
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
      {receiptTx && (
        <ThermalReceiptModal
          isOpen={true}
          onClose={() => setReceiptTx(null)}
          transaction={receiptTx}
          partyName={parties[receiptTx.partyId]?.name || 'Unknown'}
          partyPhone={parties[receiptTx.partyId]?.phone}
          ledgerName={activeLedger?.name || 'Ledger'}
          isPurchaseStyle={activeLedger?.type === 'PURCHASE' || activeLedger?.type === 'LIABILITY' || activeLedger?.type === 'CAPITAL'}
        />
      )}

      {/* Transaction Detail Popup Modal */}
      <TransactionDetailModal
        isOpen={selectedDetailTx !== null}
        onClose={() => setSelectedDetailTx(null)}
        transaction={selectedDetailTx}
        partyName={selectedDetailTx ? (parties[selectedDetailTx.partyId]?.name || 'Unknown') : ''}
        ledgerName={activeLedger?.name || 'Ledger'}
      />
    </div>
  );
}
