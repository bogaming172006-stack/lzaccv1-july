import React, { useState, useEffect } from 'react';
import { db, handleFirestoreError, OperationType, collection, getDocs, query, where, limit, orderBy } from '../firebase';
import { Transaction, Party } from '../types';
import { useLedger } from '../LedgerContext';
import { useAuth } from '../AuthContext';
import { format } from 'date-fns';
import { Search, Loader2, ArrowRight, Trash2, Printer, Calendar, TrendingDown, TrendingUp, DollarSign, X } from 'lucide-react';
import { getFilteredCacheItems } from '../lib/idbCache';
import { syncCollection } from '../lib/syncCache';
import { deleteTransaction } from '../lib/transactionService';
import ThermalReceiptModal from '../components/ThermalReceiptModal';
import TransactionDetailModal from '../components/TransactionDetailModal';
import PageHeader from '../components/ui/PageHeader';
import StatCard from '../components/ui/StatCard';
import AmountDisplay from '../components/ui/AmountDisplay';
import Badge from '../components/ui/Badge';
import { Card } from '../components/ui/Card';

const BATCH_SIZE = 25;

export default function Log() {
  const { activeLedger } = useLedger();
  const { currentUser } = useAuth();
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [receiptTx, setReceiptTx] = useState<Transaction | null>(null);
  const [selectedDetailTx, setSelectedDetailTx] = useState<Transaction | null>(null);
  const [parties, setParties] = useState<Record<string, Party>>({});
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'ALL' | 'DEBIT' | 'CREDIT'>('ALL');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [displayCount, setDisplayCount] = useState(BATCH_SIZE);

  // Deletion States
  const [deletingTx, setDeletingTx] = useState<Transaction | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deletePassword, setDeletePassword] = useState('');
  const [deletePasswordError, setDeletePasswordError] = useState('');

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
      const cached = await getFilteredCacheItems<Transaction>('transactions', t => t.ledgerId === activeLedger.id);
      cached.sort((a, b) => b.timestamp - a.timestamp);
      setTransactions(cached);

      await syncCollection<Transaction>('transactions', activeLedger.id, 'transactions');
      
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

  if (!activeLedger) return <div className="p-8 text-center text-slate-500 font-medium">Please select a ledger.</div>;

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
    <div className="p-4 sm:p-8 max-w-7xl mx-auto w-full pb-24 sm:pb-8 space-y-6">
      {/* Page Header */}
      <PageHeader
        title={activeLedger.type === 'PURCHASE' ? "Purchase Day Log" : "Day Log"}
        subtitle={`Chronological transaction register and activity log for ${activeLedger.name}`}
      />

      {/* Filter Totals Metric Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <StatCard
          title="Period Debit (Dr)"
          value={<AmountDisplay amount={totalDebit} type="DEBIT" size="xl" />}
          subtitle="Total debits in filtered scope"
          icon={TrendingDown}
          iconColor="text-rose-600"
          iconBg="bg-rose-50"
        />

        <StatCard
          title="Period Credit (Cr)"
          value={<AmountDisplay amount={totalCredit} type="CREDIT" size="xl" />}
          subtitle="Total credits in filtered scope"
          icon={TrendingUp}
          iconColor="text-emerald-600"
          iconBg="bg-emerald-50"
        />
      </div>

      {/* Main Journal Table Card */}
      <Card>
        {/* Filter Controls Bar */}
        <div className="p-4 border-b border-slate-100 bg-slate-50/60 space-y-3">
          <div className="flex flex-col lg:flex-row gap-3 items-stretch lg:items-center justify-between">
            {/* Segmented Type Filter */}
            <div className="flex bg-slate-200/70 p-1 rounded-lg shrink-0">
              {(['ALL', 'DEBIT', 'CREDIT'] as const).map(tab => (
                <button
                  key={tab}
                  onClick={() => setFilter(tab)}
                  className={`px-4 py-1.5 text-xs font-bold rounded-md transition-all ${
                    filter === tab 
                      ? 'bg-white text-slate-900 shadow-xs' 
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {tab === 'ALL' ? 'All Vouchers' : tab === 'DEBIT' ? 'Debits (Dr)' : 'Credits (Cr)'}
                </button>
              ))}
            </div>

            {/* Search Input */}
            <div className="relative w-full lg:w-80">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input 
                type="text" 
                placeholder="Search party name, invoice #, notes..." 
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="w-full pl-8 pr-3 py-1.5 bg-white border border-slate-300 rounded-lg text-xs text-slate-900 focus:border-blue-600"
              />
            </div>
          </div>

          {/* Date Pickers */}
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <div className="flex items-center bg-white border border-slate-300 rounded-lg px-2.5 py-1 text-xs">
              <span className="text-slate-400 font-bold uppercase tracking-wider text-[10px] mr-2">From:</span>
              <input 
                type="date" 
                className="font-mono text-slate-700 bg-transparent focus:outline-none"
                value={startDate}
                onChange={e => setStartDate(e.target.value)}
              />
            </div>
            <div className="flex items-center bg-white border border-slate-300 rounded-lg px-2.5 py-1 text-xs">
              <span className="text-slate-400 font-bold uppercase tracking-wider text-[10px] mr-2">To:</span>
              <input 
                type="date" 
                className="font-mono text-slate-700 bg-transparent focus:outline-none"
                value={endDate}
                onChange={e => setEndDate(e.target.value)}
              />
            </div>
            {(startDate || endDate) && (
              <button 
                onClick={() => { setStartDate(''); setEndDate(''); }}
                className="text-xs text-slate-600 hover:text-slate-900 font-bold px-2.5 py-1 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors"
              >
                Clear Dates
              </button>
            )}
          </div>
        </div>

        {/* Desktop Table View */}
        <div className="hidden md:block overflow-x-auto">
          <table className="w-full text-left border-collapse table-finance">
            <thead>
              <tr>
                <th className="w-40">Date & Time</th>
                <th className="w-48">Party Account</th>
                <th>Particulars / Notes</th>
                <th className="w-36 text-right">Debit (Dr)</th>
                <th className="w-36 text-right">Credit (Cr)</th>
                {currentUser?.isAdmin && <th className="w-20 text-center">Actions</th>}
              </tr>
            </thead>
            <tbody>
              {filtered.map(tx => {
                const party = parties[tx.partyId];
                return (
                  <tr 
                    key={tx.id} 
                    onClick={() => setSelectedDetailTx(tx)}
                    className="hover:bg-blue-50/40 cursor-pointer transition-colors"
                  >
                    <td className="text-xs text-slate-600 whitespace-nowrap">
                      {format(new Date(tx.timestamp), 'dd MMM yyyy, HH:mm')}
                    </td>
                    <td>
                      <span className="font-bold text-slate-900 text-xs sm:text-sm block">
                        {party?.name || 'Unknown Party'}
                      </span>
                      {party?.phone && (
                        <span className="text-[11px] text-slate-400">
                          {party.phone}
                        </span>
                      )}
                    </td>
                    <td>
                      <span className="font-medium text-slate-700 text-xs block">
                        {tx.notes || '-'}
                      </span>
                      {tx.invoiceNo && (
                        <span className="text-[11px] font-semibold text-blue-700 bg-blue-50 px-1.5 py-0.2 rounded inline-block mt-0.5">
                          Inv #{tx.invoiceNo}
                        </span>
                      )}
                    </td>
                    <td className="text-right tabular-nums text-xs">
                      {tx.type === 'DEBIT' ? (
                        <span className="font-bold text-rose-600">
                          ₹{tx.amount.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                        </span>
                      ) : (
                        <span className="text-slate-400">-</span>
                      )}
                    </td>
                    <td className="text-right tabular-nums text-xs">
                      {tx.type === 'CREDIT' ? (
                        <span className="font-bold text-emerald-600">
                          ₹{tx.amount.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                        </span>
                      ) : (
                        <span className="text-slate-400">-</span>
                      )}
                    </td>
                    {currentUser?.isAdmin && (
                      <td className="text-center" onClick={e => e.stopPropagation()}>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setDeletingTx(tx);
                            setShowDeleteConfirm(true);
                          }}
                          className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded transition-colors"
                          title="Delete Transaction"
                        >
                          <Trash2 size={14} />
                        </button>
                      </td>
                    )}
                  </tr>
                );
              })}

              {filtered.length === 0 && (
                <tr>
                  <td colSpan={currentUser?.isAdmin ? 6 : 5} className="py-12 text-center text-xs font-semibold text-slate-400">
                    No transactions matching current filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Mobile View */}
        <div className="block md:hidden divide-y divide-slate-100 bg-white">
          {filtered.map(tx => {
            const party = parties[tx.partyId];
            return (
              <div 
                key={tx.id} 
                onClick={() => setSelectedDetailTx(tx)}
                className="p-3.5 hover:bg-slate-50 flex items-center justify-between gap-3 cursor-pointer"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5 text-[11px] text-slate-400 font-mono">
                    <span>{format(new Date(tx.timestamp), 'dd MMM, HH:mm')}</span>
                    {tx.invoiceNo && <span className="text-blue-700 bg-blue-50 px-1 rounded">#{tx.invoiceNo}</span>}
                  </div>
                  <h4 className="font-bold text-slate-900 text-xs sm:text-sm mt-0.5 truncate">
                    {party?.name || 'Unknown'}
                  </h4>
                  <p className="text-[11px] text-slate-500 truncate">{tx.notes || 'General entry'}</p>
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
          })}
        </div>

        {/* Load More Button */}
        {hasMore && (
          <div className="p-4 border-t border-slate-100 bg-slate-50/60 flex justify-center">
            <button
              onClick={() => setDisplayCount(prev => prev + BATCH_SIZE)}
              className="inline-flex items-center px-4 py-2 bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 text-xs font-bold rounded-lg shadow-xs transition-colors"
            >
              Load Older Vouchers ({filteredDisplay.length - displayCount} remaining)
              <ArrowRight size={14} className="ml-1.5 text-slate-400" />
            </button>
          </div>
        )}
      </Card>

      {/* Delete Confirmation Modal */}
      {showDeleteConfirm && deletingTx && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-md border border-slate-200 overflow-hidden p-6 space-y-4">
            <h3 className="font-bold text-rose-600 text-base flex items-center gap-2">
              <Trash2 size={18} />
              Delete Ledger Voucher
            </h3>
            <p className="text-xs text-slate-600">
              Are you sure you want to delete this voucher from the ledger? All outstanding balances will be updated.
            </p>
            
            <div className="space-y-1.5 pt-1">
              <label className="block text-xs font-bold uppercase tracking-wider text-slate-700">Admin Password</label>
              <input
                type="password"
                placeholder="Enter admin password"
                value={deletePassword}
                onChange={e => { setDeletePassword(e.target.value); setDeletePasswordError(''); }}
                className="w-full px-3.5 py-2 border border-slate-300 rounded-lg text-xs font-mono focus:border-rose-600"
              />
              {deletePasswordError && (
                <p className="text-xs text-rose-600 font-semibold mt-1">{deletePasswordError}</p>
              )}
            </div>

            <div className="pt-2 flex justify-end gap-2">
              <button 
                type="button" 
                onClick={() => { setShowDeleteConfirm(false); setDeletingTx(null); setDeletePassword(''); }} 
                className="px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-lg"
              >
                Cancel
              </button>
              <button 
                type="button" 
                onClick={handleDeleteTx} 
                disabled={isDeleting} 
                className="px-5 py-2 bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold rounded-lg shadow-xs"
              >
                {isDeleting ? 'Deleting...' : 'Confirm Delete'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Transaction Detail Popup */}
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
