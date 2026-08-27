import React, { useState, useEffect } from 'react';
import { db, handleFirestoreError, OperationType, collection, getDocs } from '../firebase';
import { Transaction, Party, Ledger, LEDGER_TYPE_LABELS } from '../types';
import { useLedger } from '../LedgerContext';
import { useAuth } from '../AuthContext';
import { format } from 'date-fns';
import { Activity, Search, Loader2, ArrowRight, Trash2, Calendar, TrendingDown, TrendingUp, DollarSign, Layers, Printer } from 'lucide-react';
import { deleteTransaction } from '../lib/transactionService';
import ThermalReceiptModal from '../components/ThermalReceiptModal';
import TransactionDetailModal from '../components/TransactionDetailModal';
import PageHeader from '../components/ui/PageHeader';
import StatCard from '../components/ui/StatCard';
import AmountDisplay from '../components/ui/AmountDisplay';
import Badge from '../components/ui/Badge';
import { Card } from '../components/ui/Card';

const BATCH_SIZE = 25;

export default function Activities() {
  const { ledgers } = useLedger();
  const { currentUser } = useAuth();
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [parties, setParties] = useState<Record<string, Party>>({});
  const [receiptTx, setReceiptTx] = useState<Transaction | null>(null);
  const [selectedDetailTx, setSelectedDetailTx] = useState<Transaction | null>(null);
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
      const partiesSnap = await getDocs(collection(db, 'parties'));
      const partiesMap: Record<string, Party> = {};
      partiesSnap.docs.forEach(doc => {
        if (doc.exists()) {
          const p = doc.data() as Party;
          partiesMap[p.id] = p;
        }
      });
      setParties(partiesMap);

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

  const totalDebit = filteredDisplay
    .filter(tx => tx.type === 'DEBIT')
    .reduce((sum, tx) => sum + tx.amount, 0);

  const totalCredit = filteredDisplay
    .filter(tx => tx.type === 'CREDIT')
    .reduce((sum, tx) => sum + tx.amount, 0);

  const filtered = filteredDisplay.slice(0, displayCount);
  const hasMore = displayCount < filteredDisplay.length;

  return (
    <div className="p-3 min-[400px]:p-4 sm:p-8 max-w-7xl mx-auto w-full pb-20 sm:pb-8 space-y-3.5 sm:space-y-6">
      {/* Header */}
      <PageHeader
        title="Overall Transaction"
        subtitle="Consolidated cross-ledger journal stream, departmental summaries, and complete audit trail"
      />

      {/* Ledger Portfolio Cards */}
      <div>
        <div className="flex items-center justify-between mb-2 sm:mb-3">
          <h2 className="text-xs font-bold uppercase tracking-wider text-slate-700">
            Ledger Portfolio Summaries
          </h2>
          <span className="text-[11px] sm:text-xs font-medium text-slate-500">{ledgers.length} Active General Ledgers</span>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2.5 sm:gap-4">
          {ledgerSummaries.map(({ ledger, debitSum, creditSum, netBalance, count }) => (
            <Card key={ledger.id} className="p-4 sm:p-5 hover:border-slate-300 transition-all">
              <div className="flex items-start justify-between mb-3">
                <div>
                  <h3 className="font-bold text-slate-900 text-sm">{ledger.name}</h3>
                  <span className="text-[11px] text-slate-400 font-mono mt-0.5 block">{count} recorded entries</span>
                </div>
                <Badge variant="navy" size="xs">
                  {LEDGER_TYPE_LABELS[ledger.type] || ledger.type}
                </Badge>
              </div>

              <div className="grid grid-cols-2 gap-3 pt-3 border-t border-slate-100 text-xs">
                <div>
                  <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Total Debit (Dr)</span>
                  <div className="font-bold text-rose-700 font-mono mt-0.5">
                    ₹{debitSum.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                  </div>
                </div>
                <div className="border-l border-slate-100 pl-3">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Total Credit (Cr)</span>
                  <div className="font-bold text-emerald-700 font-mono mt-0.5">
                    ₹{creditSum.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                  </div>
                </div>
              </div>

              <div className="mt-3 pt-3 border-t border-slate-100 flex items-center justify-between text-xs">
                <span className="font-medium text-slate-500">Net Ledger Balance:</span>
                <span className={`font-bold font-mono ${netBalance >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>
                  ₹{Math.abs(netBalance).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                  <span className="text-[10px] ml-1 font-normal text-slate-500">
                    {netBalance >= 0 ? '(Cr)' : '(Dr)'}
                  </span>
                </span>
              </div>
            </Card>
          ))}
        </div>
      </div>

      {/* Global Activity Stream Table */}
      <Card>
        {/* Filter Controls Bar */}
        <div className="p-4 border-b border-slate-100 bg-slate-50/60 space-y-3">
          <div className="flex flex-col lg:flex-row gap-3 items-stretch lg:items-center justify-between">
            <div className="flex flex-wrap items-center gap-2">
              <select
                value={selectedLedgerId}
                onChange={e => setSelectedLedgerId(e.target.value)}
                className="px-3 py-1.5 border border-slate-300 rounded-lg text-xs font-semibold bg-white text-slate-800 focus:border-blue-600 shadow-xs"
              >
                <option value="ALL">All Ledgers Portfolio</option>
                {ledgers.map(l => (
                  <option key={l.id} value={l.id}>{l.name}</option>
                ))}
              </select>

              <div className="flex bg-slate-200/70 p-1 rounded-lg shrink-0">
                {(['ALL', 'DEBIT', 'CREDIT'] as const).map(tab => (
                  <button
                    key={tab}
                    onClick={() => setFilter(tab)}
                    className={`px-3 py-1 text-xs font-bold rounded-md transition-all ${
                      filter === tab 
                        ? 'bg-white text-slate-900 shadow-xs' 
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    {tab === 'ALL' ? 'All' : tab === 'DEBIT' ? 'Debits (Dr)' : 'Credits (Cr)'}
                  </button>
                ))}
              </div>
            </div>

            <div className="relative w-full lg:w-72">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input 
                type="text" 
                placeholder="Search across all ledgers..." 
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
                className="text-slate-700 bg-transparent focus:outline-none text-xs"
                value={startDate}
                onChange={e => setStartDate(e.target.value)}
              />
            </div>
            <div className="flex items-center bg-white border border-slate-300 rounded-lg px-2.5 py-1 text-xs">
              <span className="text-slate-400 font-bold uppercase tracking-wider text-[10px] mr-2">To:</span>
              <input 
                type="date" 
                className="text-slate-700 bg-transparent focus:outline-none text-xs"
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

        {/* Global Totals Strip */}
        <div className="grid grid-cols-3 gap-3 p-4 bg-slate-50 border-b border-slate-200 text-xs">
          <div>
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Filtered Debits (Dr)</span>
            <div className="tabular-nums font-bold text-rose-600 text-sm sm:text-base mt-0.5">
              ₹{totalDebit.toLocaleString(undefined, { minimumFractionDigits: 2 })}
            </div>
          </div>
          <div>
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Filtered Credits (Cr)</span>
            <div className="tabular-nums font-bold text-emerald-600 text-sm sm:text-base mt-0.5">
              ₹{totalCredit.toLocaleString(undefined, { minimumFractionDigits: 2 })}
            </div>
          </div>
          <div>
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Net Movement</span>
            <div className={`tabular-nums font-bold text-sm sm:text-base mt-0.5 ${totalCredit >= totalDebit ? 'text-emerald-600' : 'text-rose-600'}`}>
              ₹{Math.abs(totalCredit - totalDebit).toLocaleString(undefined, { minimumFractionDigits: 2 })}
              <span className="text-[10px] font-normal text-slate-500 ml-1">{totalCredit >= totalDebit ? 'Cr' : 'Dr'}</span>
            </div>
          </div>
        </div>

        {/* Desktop Table View */}
        <div className="hidden md:block overflow-x-auto">
          <table className="w-full text-left border-collapse table-finance">
            <thead>
              <tr>
                <th className="w-36">Date</th>
                <th className="w-40">Ledger Book</th>
                <th className="w-44">Party Account</th>
                <th>Particulars</th>
                <th className="w-36 text-right">Amount</th>
                <th className="w-20 text-center">Receipt</th>
                {currentUser?.isAdmin && <th className="w-16 text-center">Actions</th>}
              </tr>
            </thead>
            <tbody>
              {filtered.map(tx => {
                const party = parties[tx.partyId];
                const ledger = ledgers.find(l => l.id === tx.ledgerId);
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
                      <span className="font-bold text-slate-900 text-xs block">
                        {ledger?.name || 'Unknown Ledger'}
                      </span>
                      <span className="text-[10px] text-slate-400">
                        {ledger ? LEDGER_TYPE_LABELS[ledger.type] : ''}
                      </span>
                    </td>
                    <td>
                      <span className="font-bold text-slate-900 text-xs block">
                        {party?.name || 'Unknown Party'}
                      </span>
                    </td>
                    <td>
                      <span className="text-xs text-slate-700 block">{tx.notes || '-'}</span>
                      {tx.invoiceNo && (
                        <span className="text-[10.5px] font-normal text-slate-800 inline-block mt-0.5 font-mono">
                          Inv #{tx.invoiceNo}
                        </span>
                      )}
                    </td>
                    <td className="text-right tabular-nums text-xs">
                      <span className={`font-bold ${tx.type === 'DEBIT' ? 'text-rose-600' : 'text-emerald-600'}`}>
                        {tx.type === 'DEBIT' ? 'Dr ' : 'Cr '}
                        ₹{tx.amount.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                      </span>
                    </td>
                    <td className="text-center" onClick={e => e.stopPropagation()}>
                      <button
                        type="button"
                        onClick={() => setReceiptTx(tx)}
                        className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded transition-colors"
                        title="Download / Print Receipt"
                      >
                        <Printer size={14} />
                      </button>
                    </td>
                    {currentUser?.isAdmin && (
                      <td className="text-center" onClick={e => e.stopPropagation()}>
                        <button
                          onClick={() => {
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
                  <td colSpan={currentUser?.isAdmin ? 7 : 6} className="py-12 text-center text-xs font-semibold text-slate-400">
                    No transactions matching current filters across ledgers.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Mobile View: High Density Compact List */}
        <div className="block md:hidden divide-y divide-slate-100 bg-white">
          {filtered.map(tx => {
            const party = parties[tx.partyId];
            const ledger = ledgers.find(l => l.id === tx.ledgerId);
            return (
              <div 
                key={tx.id} 
                onClick={() => setSelectedDetailTx(tx)}
                className="p-2.5 sm:p-3 hover:bg-slate-50 flex items-center justify-between gap-2.5 transition-colors cursor-pointer"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5 text-[10.5px] text-slate-400 font-mono">
                    <span>{format(new Date(tx.timestamp), 'dd MMM, HH:mm')}</span>
                    {ledger && <span className="bg-slate-100 text-slate-700 px-1 py-0.2 rounded font-semibold">{ledger.name}</span>}
                    {tx.invoiceNo && <span className="text-slate-700 font-normal font-mono">#{tx.invoiceNo}</span>}
                  </div>
                  <h4 className="font-bold text-slate-900 text-xs mt-0.5 truncate">
                    {party?.name || 'Unknown Party'}
                  </h4>
                  <p className="text-[10.5px] text-slate-500 truncate mt-0.5">{tx.notes || 'General entry'}</p>
                </div>

                <div className="text-right shrink-0 flex items-center gap-2">
                  <span className={`font-bold font-mono text-xs ${tx.type === 'DEBIT' ? 'text-rose-600' : 'text-emerald-600'}`}>
                    {tx.type === 'DEBIT' ? 'Dr ' : 'Cr '}₹{tx.amount.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                  </span>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setReceiptTx(tx);
                    }}
                    className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded"
                    title="Receipt"
                  >
                    <Printer size={13} />
                  </button>
                </div>
              </div>
            );
          })}

          {filtered.length === 0 && (
            <div className="py-10 text-center text-xs font-semibold text-slate-400">
              No transactions matching current filters across ledgers.
            </div>
          )}
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

      {/* Delete Modal */}
      {showDeleteConfirm && deletingTx && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-md border border-slate-200 overflow-hidden p-6 space-y-4">
            <h3 className="font-bold text-rose-600 text-base flex items-center gap-2">
              <Trash2 size={18} />
              Delete Cross-Ledger Entry
            </h3>
            <p className="text-xs text-slate-600">
              Are you sure you want to delete this global audit voucher? All related account dues will be recalculated.
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

      {/* Thermal Receipt Modal */}
      {receiptTx && (
        <ThermalReceiptModal
          isOpen={true}
          onClose={() => setReceiptTx(null)}
          transaction={receiptTx}
          partyName={parties[receiptTx.partyId]?.name || 'Unknown Party'}
          partyPhone={parties[receiptTx.partyId]?.phone}
          ledgerName={ledgers.find(l => l.id === receiptTx.ledgerId)?.name || 'Ledger'}
          ledgerType={ledgers.find(l => l.id === receiptTx.ledgerId)?.type}
          isPurchaseStyle={ledgers.find(l => l.id === receiptTx.ledgerId)?.type === 'PURCHASE' || ledgers.find(l => l.id === receiptTx.ledgerId)?.type === 'LIABILITY' || ledgers.find(l => l.id === receiptTx.ledgerId)?.type === 'CAPITAL'}
        />
      )}

      {/* Transaction Detail Popup */}
      <TransactionDetailModal
        isOpen={selectedDetailTx !== null}
        onClose={() => setSelectedDetailTx(null)}
        transaction={selectedDetailTx}
        partyName={selectedDetailTx ? (parties[selectedDetailTx.partyId]?.name || 'Unknown') : ''}
        ledgerName={selectedDetailTx ? ledgers.find(l => l.id === selectedDetailTx.ledgerId)?.name : undefined}
        ledgerType={selectedDetailTx ? ledgers.find(l => l.id === selectedDetailTx.ledgerId)?.type : undefined}
        onOpenReceipt={(tx) => setReceiptTx(tx)}
      />
    </div>
  );
}
