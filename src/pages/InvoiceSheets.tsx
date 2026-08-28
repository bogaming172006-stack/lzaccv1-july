import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { db, handleFirestoreError, OperationType, collection, doc, setDoc, query, where, deleteDoc, getDocs, limit } from '../firebase';
import { useLedger } from '../LedgerContext';
import { TrackedInvoice, Transaction, Party } from '../types';
import { Trash2, CheckCircle2, Loader2, User, Calendar, X, FileSpreadsheet, Search, Check, Zap, ArrowDown, ArrowUp, Sparkles, Clock } from 'lucide-react';
import { Virtuoso, VirtuosoHandle } from 'react-virtuoso';
import { syncCollection } from '../lib/syncCache';
import { getFilteredCacheItems, setCacheItem, getCacheItem } from '../lib/idbCache';
import PageHeader from '../components/ui/PageHeader';
import Badge from '../components/ui/Badge';
import { Card } from '../components/ui/Card';

const START_INVOICE = 6000;
const END_INVOICE = 100000;

const parseInvoiceNum = (raw?: string | null): number | null => {
  if (!raw) return null;
  const matches = raw.toString().match(/\d+/g);
  if (!matches || matches.length === 0) return null;
  const lastMatch = matches[matches.length - 1];
  const num = parseInt(lastMatch, 10);
  if (!isNaN(num) && num >= START_INVOICE && num <= END_INVOICE) {
    return num;
  }
  return null;
};

export default function InvoiceSheets() {
  const { activeLedger } = useLedger();
  const [invoices, setInvoices] = useState<TrackedInvoice[]>([]);
  const [actualTransactions, setActualTransactions] = useState<Transaction[]>([]);
  const [parties, setParties] = useState<Record<string, Party>>({});
  const [debitInput, setDebitInput] = useState('');
  const [creditInput, setCreditInput] = useState('');
  const [alertInfo, setAlertInfo] = useState<{message: string; isError: boolean} | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [highlightedInvoice, setHighlightedInvoice] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'DEBIT' | 'CREDIT'>('DEBIT');

  const debitListRef = useRef<VirtuosoHandle>(null);
  const creditListRef = useRef<VirtuosoHandle>(null);
  const isSyncingRef = useRef<'DEBIT' | 'CREDIT' | null>(null);
  const hasAutoScrolledRef = useRef<boolean>(false);
  const currentVisibleIndexRef = useRef<number>(0);

  const loadInvoiceSheetsDataset = async () => {
    if (!activeLedger?.id) return;
    setIsLoading(true);
    try {
      await syncCollection<Party>('parties', activeLedger.id, 'parties');
      const cachedParties = await getFilteredCacheItems<Party>('parties', p => p.ledgerId === activeLedger.id);
      const partyMap: Record<string, Party> = {};
      cachedParties.forEach(p => {
        partyMap[p.id] = p;
      });
      setParties(partyMap);

      await syncCollection<TrackedInvoice>('tracked_invoices', activeLedger.id, 'tracked_invoices');
      const cachedInvoices = await getFilteredCacheItems<TrackedInvoice>('tracked_invoices', i => i.ledgerId === activeLedger.id);
      setInvoices(cachedInvoices);

      try {
        await syncCollection<Transaction>('transactions', activeLedger.id, 'transactions');
        const cachedTxs = await getFilteredCacheItems<Transaction>('transactions', t => t.ledgerId === activeLedger.id);
        setActualTransactions(cachedTxs);
      } catch {
        const qTx = query(
          collection(db, 'transactions'), 
          where('ledgerId', '==', activeLedger.id),
          limit(500)
        );
        const txSnap = await getDocs(qTx);
        setActualTransactions(txSnap.docs.map(d => d.data() as Transaction));
      }
    } catch (e) {
      console.error("Error loading invoice sheets dataset:", e);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    hasAutoScrolledRef.current = false;
    loadInvoiceSheetsDataset();

    const handleSync = () => {
      loadInvoiceSheetsDataset();
    };
    window.addEventListener('database-synced', handleSync);
    return () => {
      window.removeEventListener('database-synced', handleSync);
    };
  }, [activeLedger?.id]);

  type CombinedEntry = { id: string, source: 'tracked' | 'tx', invoiceNo: string, transaction?: Transaction, timestamp: number, type: 'DEBIT' | 'CREDIT' };

  const { 
    debitMap, 
    creditMap, 
    visibleInvoices, 
    debitCount, 
    creditCount,
    recentOverall,
    recentDebit,
    recentCredit
  } = useMemo(() => {
    const debitTracked = invoices.filter(i => i.type === 'DEBIT');
    const creditTracked = invoices.filter(i => i.type === 'CREDIT');
    const debitTx = actualTransactions.filter(t => t.type === 'DEBIT' && t.invoiceNo);
    const creditTx = actualTransactions.filter(t => t.type === 'CREDIT' && t.invoiceNo);

    const dMap = new Map<string, CombinedEntry>();
    const cMap = new Map<string, CombinedEntry>();

    const pop = (map: Map<string, CombinedEntry>, tracked: TrackedInvoice[], txs: Transaction[], type: 'DEBIT' | 'CREDIT') => {
      tracked.forEach(i => {
        const entry: CombinedEntry = { id: i.id, source: 'tracked', invoiceNo: i.invoiceNo, timestamp: i.timestamp || 0, type };
        map.set(i.invoiceNo, entry);
      });
      txs.forEach(t => {
        if (t.invoiceNo) {
          const entry: CombinedEntry = { id: t.id, source: 'tx', invoiceNo: t.invoiceNo, transaction: t, timestamp: t.timestamp || 0, type };
          map.set(t.invoiceNo, entry);
          const parsed = parseInvoiceNum(t.invoiceNo);
          if (parsed !== null) {
            map.set(parsed.toString(), entry);
          }
        }
      });
    };

    pop(dMap, debitTracked, debitTx, 'DEBIT');
    pop(cMap, creditTracked, creditTx, 'CREDIT');

    const allEntries: CombinedEntry[] = [];
    dMap.forEach(v => allEntries.push(v));
    cMap.forEach(v => allEntries.push(v));

    // Sort by timestamp desc to find most recent
    const validEntries = allEntries
      .filter(e => parseInvoiceNum(e.invoiceNo) !== null)
      .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));

    const recOverall = validEntries[0] || null;
    const recDebit = validEntries.find(e => e.type === 'DEBIT') || null;
    const recCredit = validEntries.find(e => e.type === 'CREDIT') || null;

    const list: string[] = [];
    for (let i = START_INVOICE; i <= END_INVOICE; i++) {
      list.push(i.toString());
    }

    return { 
      debitMap: dMap, 
      creditMap: cMap, 
      visibleInvoices: list, 
      debitCount: dMap.size, 
      creditCount: cMap.size,
      recentOverall: recOverall,
      recentDebit: recDebit,
      recentCredit: recCredit
    };
  }, [invoices, actualTransactions]);

  const scrollToInvoice = useCallback((invoiceNum: number, align: 'center' | 'start' = 'center', behavior: 'smooth' | 'auto' = 'smooth') => {
    if (invoiceNum < START_INVOICE || invoiceNum > END_INVOICE) return;
    const index = invoiceNum - START_INVOICE;
    currentVisibleIndexRef.current = index;
    setHighlightedInvoice(invoiceNum.toString());

    debitListRef.current?.scrollToIndex({ index, align, behavior });
    creditListRef.current?.scrollToIndex({ index, align, behavior });

    // Flash highlight clearance after 4 seconds
    setTimeout(() => {
      setHighlightedInvoice(prev => prev === invoiceNum.toString() ? null : prev);
    }, 4000);
  }, []);

  // Auto scroll to recent activity on load
  useEffect(() => {
    if (!hasAutoScrolledRef.current && (recentOverall || recentDebit || recentCredit)) {
      const target = recentOverall || recentDebit || recentCredit;
      if (target) {
        const num = parseInvoiceNum(target.invoiceNo);
        if (num) {
          hasAutoScrolledRef.current = true;
          currentVisibleIndexRef.current = num - START_INVOICE;
          const timer = setTimeout(() => {
            scrollToInvoice(num, 'center', 'smooth');
          }, 350);
          return () => clearTimeout(timer);
        }
      }
    }
  }, [recentOverall, recentDebit, recentCredit, scrollToInvoice]);

  // Synchronize scroll position when switching between Debit and Credit tabs
  useEffect(() => {
    const targetRef = activeTab === 'DEBIT' ? debitListRef : creditListRef;
    const timer = setTimeout(() => {
      targetRef.current?.scrollToIndex({
        index: currentVisibleIndexRef.current,
        align: 'start',
        behavior: 'auto'
      });
    }, 30);
    return () => clearTimeout(timer);
  }, [activeTab]);

  const handleSearch = (e: React.FormEvent, type: 'DEBIT' | 'CREDIT') => {
    e.preventDefault();
    const inputVal = type === 'DEBIT' ? debitInput : creditInput;
    const trimmed = inputVal.trim();
    const numVal = parseInt(trimmed, 10);
    
    if (!isNaN(numVal) && numVal >= START_INVOICE && numVal <= END_INVOICE) {
      scrollToInvoice(numVal, 'center', 'smooth');
    }
  };

  const handleMark = async (invoiceNo: string, type: 'DEBIT' | 'CREDIT') => {
    if (!activeLedger?.id) return;
    
    const targetInvoice = invoiceNo.toLowerCase().trim();
    const existsSameTypeTracked = invoices.find(i => i.type === type && i.invoiceNo.toLowerCase() === targetInvoice);
    const existsSameTypeTx = actualTransactions.find(t => t.type === type && (t.invoiceNo?.toLowerCase() === targetInvoice || t.invoiceNo?.toLowerCase()?.endsWith(targetInvoice)));

    if (existsSameTypeTracked || existsSameTypeTx) {
      setAlertInfo({ 
        message: `Invoice #${invoiceNo} is already recorded in the ${type === 'DEBIT' ? 'Debit (Sales)' : 'Credit (Receipts)'} sheet${existsSameTypeTx ? ' via journal voucher' : ''}.`, 
        isError: true 
      });
      return;
    }

    const oppositeType = type === 'DEBIT' ? 'CREDIT' : 'DEBIT';
    const existsOppositeTypeTracked = invoices.find(i => i.type === oppositeType && i.invoiceNo.toLowerCase() === targetInvoice);
    const existsOppositeTypeTx = actualTransactions.find(t => t.type === oppositeType && (t.invoiceNo?.toLowerCase() === targetInvoice || t.invoiceNo?.toLowerCase()?.endsWith(targetInvoice)));
    
    const isMatch = existsOppositeTypeTracked || existsOppositeTypeTx;

    const newInvoice: TrackedInvoice = {
      id: `${activeLedger.id}_${type}_${targetInvoice}`,
      ledgerId: activeLedger.id,
      invoiceNo: targetInvoice,
      type,
      timestamp: Date.now()
    };

    try {
      const updatedInvoices = [...invoices, newInvoice];
      setInvoices(updatedInvoices);

      setCacheItem<TrackedInvoice>('tracked_invoices', newInvoice);
      setDoc(doc(db, 'tracked_invoices', newInvoice.id), newInvoice);
      const serverVerRef = doc(db, 'cache_versions', activeLedger.id);
      setDoc(serverVerRef, { tracked_invoices: Date.now() }, { merge: true });

      if (isMatch) {
         setAlertInfo({ 
           message: `Invoice #${invoiceNo} is now successfully matched in BOTH Debit and Credit sheets!`, 
           isError: false 
         });
      }
    } catch (e) {
      handleFirestoreError(e, OperationType.CREATE, 'tracked_invoices');
    }
  };

  const handleDelete = async (id: string) => {
    if (!activeLedger?.id) return;
    try {
      setInvoices(invoices.filter(i => i.id !== id));
      await deleteDoc(doc(db, 'tracked_invoices', id));

      const serverVerRef = doc(db, 'cache_versions', activeLedger.id);
      await setDoc(serverVerRef, { tracked_invoices: Date.now() }, { merge: true });
    } catch (e) {
      handleFirestoreError(e, OperationType.DELETE, `tracked_invoices/${id}`);
    }
  };

  if (!activeLedger) return <div className="p-8 text-center text-slate-500 font-medium">Please select a ledger.</div>;

  const recentOverallNum = recentOverall ? parseInvoiceNum(recentOverall.invoiceNo) : null;
  const recentDebitNum = recentDebit ? parseInvoiceNum(recentDebit.invoiceNo) : null;
  const recentCreditNum = recentCredit ? parseInvoiceNum(recentCredit.invoiceNo) : null;

  const renderRow = (index: number, invoiceNum: string, map: Map<string, CombinedEntry>, type: 'DEBIT' | 'CREDIT') => {
    const entry = map.get(invoiceNum);
    const isTracked = !!entry;
    const isTx = entry?.source === 'tx';
    const tx = entry?.transaction;
    const party = tx ? parties[tx.partyId] : null;

    const isMostRecentOverall = recentOverallNum !== null && invoiceNum === recentOverallNum.toString();
    const isMostRecentType = (type === 'DEBIT' && recentDebitNum !== null && invoiceNum === recentDebitNum.toString()) ||
                             (type === 'CREDIT' && recentCreditNum !== null && invoiceNum === recentCreditNum.toString());
    const isExplicitlyHighlighted = highlightedInvoice === invoiceNum;

    return (
      <div className={`flex items-center justify-between px-2 sm:px-3 py-1.5 sm:py-2 transition-all text-xs ${
        type === 'DEBIT' ? 'border-b border-rose-100/70' : 'border-b border-emerald-100/70'
      } ${
        isExplicitlyHighlighted 
          ? 'bg-blue-100/80 ring-2 ring-blue-500/80 ring-inset shadow-xs' 
          : isMostRecentOverall 
            ? (type === 'DEBIT' ? 'bg-rose-200/70 border-l-4 border-l-rose-600 font-medium' : 'bg-emerald-200/70 border-l-4 border-l-emerald-600 font-medium')
            : isTracked 
              ? (type === 'DEBIT' ? 'bg-rose-100/60 hover:bg-rose-100/90' : 'bg-emerald-100/60 hover:bg-emerald-100/90') 
              : (type === 'DEBIT' ? 'bg-rose-50/30 hover:bg-rose-100/40' : 'bg-emerald-50/30 hover:bg-emerald-100/40')
      }`}>
        <div className="flex items-center space-x-1.5 sm:space-x-2.5 flex-1 select-none min-w-0 pr-1">
          <span className={`font-mono font-bold text-[11px] sm:text-xs shrink-0 ${
            isTracked 
              ? (type === 'DEBIT' ? 'text-rose-950' : 'text-emerald-950') 
              : (type === 'DEBIT' ? 'text-rose-900/45' : 'text-emerald-900/45')
          }`}>
            #{invoiceNum}
          </span>
          {isTx && tx && party && (
             <div className="flex items-center gap-1 sm:gap-2 text-[9.5px] sm:text-[11px] text-slate-600 truncate min-w-0">
               <span className="font-medium text-slate-800 truncate max-w-[70px] min-[380px]:max-w-[100px] sm:max-w-[140px]" title={party.name}>
                 {party.name}
               </span>
               <span className="text-slate-400 font-mono text-[9px] sm:text-[10px] shrink-0">
                 {new Date(tx.timestamp).toLocaleDateString([], { month: 'numeric', day: 'numeric' })}
               </span>
               <span className={`font-mono font-semibold text-[9.5px] sm:text-xs shrink-0 ${type === 'DEBIT' ? 'text-rose-700' : 'text-emerald-700'}`}>
                 ₹{tx.amount.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
               </span>
             </div>
          )}
        </div>
      </div>
    );
  };

  const renderRecentPartyName = (entry: CombinedEntry | null) => {
    if (!entry) return null;
    if (entry.source === 'tx' && entry.transaction) {
      const party = parties[entry.transaction.partyId];
      return party?.name || 'Voucher Entry';
    }
    return 'Direct Marked';
  };

  return (
    <div className="p-3 min-[400px]:p-4 sm:p-8 max-w-7xl mx-auto w-full pb-20 sm:pb-8 space-y-3.5 sm:space-y-5">
      {/* Page Header with View Tabs */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 sm:gap-3">
        <PageHeader
          title="Dual Invoice Sequence Sheets"
        />

        {/* Top Header Mode Options (Small Debit / Credit Tabs) */}
        <div className="inline-flex p-0.5 sm:p-1 bg-slate-100/90 border border-slate-200/90 rounded-lg shadow-2xs self-start sm:self-auto shrink-0">
          <button
            type="button"
            onClick={() => setActiveTab('DEBIT')}
            className={`px-2.5 sm:px-3 py-1 rounded-md text-[11px] sm:text-xs font-semibold transition-all flex items-center gap-1.5 cursor-pointer ${
              activeTab === 'DEBIT'
                ? 'bg-white text-rose-700 shadow-xs border border-rose-200/60'
                : 'text-slate-600 hover:text-rose-700'
            }`}
          >
            <span className="w-1.5 h-1.5 rounded-full bg-rose-500"></span>
            <span>Debit</span>
            <span className={`text-[9.5px] px-1.5 py-0.2 rounded-full font-bold ${
              activeTab === 'DEBIT' ? 'bg-rose-100 text-rose-800' : 'bg-slate-200/70 text-slate-600'
            }`}>
              {debitCount}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('CREDIT')}
            className={`px-2.5 sm:px-3 py-1 rounded-md text-[11px] sm:text-xs font-semibold transition-all flex items-center gap-1.5 cursor-pointer ${
              activeTab === 'CREDIT'
                ? 'bg-white text-emerald-700 shadow-xs border border-emerald-200/60'
                : 'text-slate-600 hover:text-emerald-700'
            }`}
          >
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
            <span>Credit</span>
            <span className={`text-[9.5px] px-1.5 py-0.2 rounded-full font-bold ${
              activeTab === 'CREDIT' ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-200/70 text-slate-600'
            }`}>
              {creditCount}
            </span>
          </button>
        </div>
      </div>

      {/* Invoice Sequence Column (Single Full-Page Debit or Credit View) */}
      <div className="grid grid-cols-1 gap-3.5 sm:gap-6">
        {/* Debit Sheet (Sales Billing) */}
        {activeTab === 'DEBIT' && (
          <Card className="flex flex-col h-[75vh] sm:h-[80vh] border-rose-200/90 bg-rose-50/40 shadow-xs overflow-hidden">
            <div className="p-2.5 sm:p-3 border-b border-rose-100/80 bg-rose-50/80">
              <form onSubmit={e => handleSearch(e, 'DEBIT')} className="flex gap-1.5 sm:gap-2">
                <input 
                  type="number" 
                  value={debitInput} 
                  onChange={e => setDebitInput(e.target.value)} 
                  placeholder={`Locate Debit Invoice # (e.g. ${START_INVOICE})...`} 
                  className="flex-1 px-2.5 py-1 sm:px-3 sm:py-1.5 bg-white border border-rose-200 rounded-lg text-xs font-mono text-slate-900 focus:border-rose-600 focus:ring-2 focus:ring-rose-500/20"
                />
                <button 
                  type="submit" 
                  className="px-3 py-1 sm:px-3.5 sm:py-1.5 bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold rounded-lg shadow-2xs transition-colors cursor-pointer"
                >
                  Jump
                </button>
              </form>
            </div>
            <div className="flex-1 bg-rose-50/20 min-h-0 relative">
              <div className="absolute inset-0">
                <Virtuoso
                  ref={debitListRef}
                  data={visibleInvoices}
                  initialTopMostItemIndex={currentVisibleIndexRef.current}
                  rangeChanged={(range) => {
                    currentVisibleIndexRef.current = range.startIndex;
                  }}
                  itemContent={(index, invoiceNum) => renderRow(index, invoiceNum, debitMap, 'DEBIT')}
                  style={{ height: '100%', width: '100%' }}
                  className="custom-scrollbar"
                />
              </div>
            </div>
          </Card>
        )}

        {/* Credit Sheet (Collections & Receipts) */}
        {activeTab === 'CREDIT' && (
          <Card className="flex flex-col h-[75vh] sm:h-[80vh] border-emerald-200/90 bg-emerald-50/40 shadow-xs overflow-hidden">
            <div className="p-2.5 sm:p-3 border-b border-emerald-100/80 bg-emerald-50/80">
              <form onSubmit={e => handleSearch(e, 'CREDIT')} className="flex gap-1.5 sm:gap-2">
                <input 
                  type="number" 
                  value={creditInput} 
                  onChange={e => setCreditInput(e.target.value)} 
                  placeholder={`Locate Credit Invoice # (e.g. ${START_INVOICE})...`} 
                  className="flex-1 px-2.5 py-1 sm:px-3 sm:py-1.5 bg-white border border-emerald-200 rounded-lg text-xs font-mono text-slate-900 focus:border-emerald-600 focus:ring-2 focus:ring-emerald-500/20"
                />
                <button 
                  type="submit" 
                  className="px-3 py-1 sm:px-3.5 sm:py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-lg shadow-2xs transition-colors cursor-pointer"
                >
                  Jump
                </button>
              </form>
            </div>
            <div className="flex-1 bg-emerald-50/20 min-h-0 relative">
              <div className="absolute inset-0">
                <Virtuoso
                  ref={creditListRef}
                  data={visibleInvoices}
                  initialTopMostItemIndex={currentVisibleIndexRef.current}
                  rangeChanged={(range) => {
                    currentVisibleIndexRef.current = range.startIndex;
                  }}
                  itemContent={(index, invoiceNum) => renderRow(index, invoiceNum, creditMap, 'CREDIT')}
                  style={{ height: '100%', width: '100%' }}
                  className="custom-scrollbar"
                />
              </div>
            </div>
          </Card>
        )}
      </div>

      {/* Alert Notice Modal */}
      {alertInfo && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-sm border border-slate-200 overflow-hidden text-xs">
            <div className={`p-4 border-b ${alertInfo.isError ? 'bg-rose-50 border-rose-100' : 'bg-emerald-50 border-emerald-100'}`}>
              <h3 className={`font-bold text-sm ${alertInfo.isError ? 'text-rose-800' : 'text-emerald-800'}`}>
                {alertInfo.isError ? 'Duplicate Sequence Warning' : 'Invoice Matched'}
              </h3>
            </div>
            <div className="p-5">
              <p className="text-slate-700 leading-relaxed">{alertInfo.message}</p>
            </div>
            <div className="p-4 border-t border-slate-100 bg-slate-50 flex justify-end">
              <button 
                onClick={() => setAlertInfo(null)}
                className="px-5 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-lg font-bold shadow-xs transition-colors"
              >
                Acknowledge
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

