import React, { useState, useEffect, useRef, useMemo } from 'react';
import { db, handleFirestoreError, OperationType, collection, doc, setDoc, query, where, deleteDoc, getDocs, limit } from '../firebase';
import { useLedger } from '../LedgerContext';
import { TrackedInvoice, Transaction, Party } from '../types';
import { Trash2, CheckCircle2, Loader2, User, Calendar, X } from 'lucide-react';
import { Virtuoso, VirtuosoHandle } from 'react-virtuoso';
import { syncCollection } from '../lib/syncCache';
import { getFilteredCacheItems, setCacheItem, getCacheItem } from '../lib/idbCache';

const START_INVOICE = 6000;
const END_INVOICE = 100000;

export default function InvoiceSheets() {
  const { activeLedger } = useLedger();
  const [invoices, setInvoices] = useState<TrackedInvoice[]>([]);
  const [actualTransactions, setActualTransactions] = useState<Transaction[]>([]);
  const [parties, setParties] = useState<Record<string, Party>>({});
  const [debitInput, setDebitInput] = useState('');
  const [creditInput, setCreditInput] = useState('');
  const [alertInfo, setAlertInfo] = useState<{message: string; isError: boolean} | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const debitListRef = useRef<VirtuosoHandle>(null);
  const creditListRef = useRef<VirtuosoHandle>(null);
  const isSyncingRef = useRef<'DEBIT' | 'CREDIT' | null>(null);

  // Sync and load page dataset from local storage cache
  const loadInvoiceSheetsDataset = async () => {
    if (!activeLedger?.id) return;
    setIsLoading(true);
    try {
      // 1. Sync & Fetch Parties from local Cache
      await syncCollection<Party>('parties', activeLedger.id, 'parties');
      const cachedParties = await getFilteredCacheItems<Party>('parties', p => p.ledgerId === activeLedger.id);
      const partyMap: Record<string, Party> = {};
      cachedParties.forEach(p => {
        partyMap[p.id] = p;
      });
      setParties(partyMap);

      // 2. Sync & Fetch Tracked Invoices from local Cache
      await syncCollection<TrackedInvoice>('tracked_invoices', activeLedger.id, 'tracked_invoices');
      const cachedInvoices = await getFilteredCacheItems<TrackedInvoice>('tracked_invoices', i => i.ledgerId === activeLedger.id);
      setInvoices(cachedInvoices);

      // 3. For references: query recent transactions instead of the whole history
      const qTx = query(
        collection(db, 'transactions'), 
        where('ledgerId', '==', activeLedger.id),
        limit(200) // load only the 200 most recent items to avoid full scans
      );
      const txSnap = await getDocs(qTx);
      setActualTransactions(txSnap.docs.map(d => d.data() as Transaction));
    } catch (e) {
      console.error("Error loading invoice sheets dataset:", e);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadInvoiceSheetsDataset();

    const handleSync = () => {
      loadInvoiceSheetsDataset();
    };
    window.addEventListener('database-synced', handleSync);
    return () => {
      window.removeEventListener('database-synced', handleSync);
    };
  }, [activeLedger?.id]);

  const handleSearch = (e: React.FormEvent, type: 'DEBIT' | 'CREDIT') => {
    e.preventDefault();
    const inputVal = type === 'DEBIT' ? debitInput : creditInput;
    const trimmed = inputVal.trim();
    const numVal = parseInt(trimmed, 10);
    
    if (!isNaN(numVal) && numVal >= START_INVOICE && numVal <= END_INVOICE) {
      if (type === 'DEBIT') {
        debitListRef.current?.scrollToIndex({ index: numVal - START_INVOICE, align: 'center', behavior: 'smooth' });
      } else {
        creditListRef.current?.scrollToIndex({ index: numVal - START_INVOICE, align: 'center', behavior: 'smooth' });
      }
    }
  };

  const handleMark = async (invoiceNo: string, type: 'DEBIT' | 'CREDIT') => {
    if (!activeLedger?.id) return;
    
    const targetInvoice = invoiceNo.toLowerCase().trim();
    const existsSameTypeTracked = invoices.find(i => i.type === type && i.invoiceNo.toLowerCase() === targetInvoice);
    const existsSameTypeTx = actualTransactions.find(t => t.type === type && (t.invoiceNo?.toLowerCase() === targetInvoice || t.invoiceNo?.toLowerCase()?.endsWith(targetInvoice)));

    if (existsSameTypeTracked || existsSameTypeTx) {
      setAlertInfo({ 
        message: `Invoice ${invoiceNo} is already entered in the ${type === 'DEBIT' ? 'Debit' : 'Credit'} sheet${existsSameTypeTx ? ' via Master Entry' : ''}!`, 
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
      // 1. Update local state & Cache optimistically
      const updatedInvoices = [...invoices, newInvoice];
      setInvoices(updatedInvoices);
      await setCacheItem<TrackedInvoice>('tracked_invoices', newInvoice);

      // 2. Write to Firestore
      await setDoc(doc(db, 'tracked_invoices', newInvoice.id), newInvoice);
      
      // 3. Increment remote cache meta version
      const serverVerRef = doc(db, 'cache_versions', activeLedger.id);
      await setDoc(serverVerRef, { tracked_invoices: Date.now() }, { merge: true });

      if (isMatch) {
         setAlertInfo({ 
           message: `Match! Invoice ${invoiceNo} is now entered in BOTH Debit and Credit sheets.`, 
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
      // 1. Update local state & Cache optimistically
      setInvoices(invoices.filter(i => i.id !== id));
      
      // 2. Write to Firestore
      await deleteDoc(doc(db, 'tracked_invoices', id));

      // 3. Inform cache version manager
      const serverVerRef = doc(db, 'cache_versions', activeLedger.id);
      await setDoc(serverVerRef, { tracked_invoices: Date.now() }, { merge: true });
    } catch (e) {
      handleFirestoreError(e, OperationType.DELETE, `tracked_invoices/${id}`);
    }
  };

  if (!activeLedger) return <div className="p-8 text-center text-gray-500">Please select a ledger.</div>;

  type CombinedEntry = { id: string, source: 'tracked' | 'tx', invoiceNo: string, transaction?: Transaction };

  const { debitMap, creditMap, visibleInvoices, debitCount, creditCount } = useMemo(() => {
    const debitTracked = invoices.filter(i => i.type === 'DEBIT');
    const creditTracked = invoices.filter(i => i.type === 'CREDIT');
    const debitTx = actualTransactions.filter(t => t.type === 'DEBIT' && t.invoiceNo);
    const creditTx = actualTransactions.filter(t => t.type === 'CREDIT' && t.invoiceNo);

    const dMap = new Map<string, CombinedEntry>();
    const cMap = new Map<string, CombinedEntry>();

    const pop = (map: Map<string, CombinedEntry>, tracked: TrackedInvoice[], txs: Transaction[]) => {
      tracked.forEach(i => map.set(i.invoiceNo, { id: i.id, source: 'tracked', invoiceNo: i.invoiceNo }));
      txs.forEach(t => {
        if (t.invoiceNo) {
          map.set(t.invoiceNo, { id: t.id, source: 'tx', invoiceNo: t.invoiceNo, transaction: t });
          const match = t.invoiceNo.match(/\d+$/);
          if (match) {
            map.set(match[0], { id: t.id, source: 'tx', invoiceNo: t.invoiceNo, transaction: t });
          }
        }
      });
    };

    pop(dMap, debitTracked, debitTx);
    pop(cMap, creditTracked, creditTx);

    const list: string[] = [];
    for (let i = START_INVOICE; i <= END_INVOICE; i++) {
      list.push(i.toString());
    }
    return { debitMap: dMap, creditMap: cMap, visibleInvoices: list, debitCount: dMap.size, creditCount: cMap.size };
  }, [invoices, actualTransactions]);

  const renderRow = (index: number, invoiceNum: string, map: Map<string, CombinedEntry>, type: 'DEBIT' | 'CREDIT') => {
    const entry = map.get(invoiceNum);
    const isTracked = !!entry;
    const isTx = entry?.source === 'tx';
    const tx = entry?.transaction;
    const party = tx ? parties[tx.partyId] : null;

    return (
      <div className={`flex items-center justify-between p-3 border-b border-gray-100 ${isTracked ? (type === 'DEBIT' ? 'bg-red-50' : 'bg-emerald-50') : 'bg-white'} hover:bg-gray-50 transition-colors`}>
        <div className="flex items-center space-x-4 flex-1 select-none">
          <span className={`font-mono font-medium ${isTracked ? 'text-gray-900' : 'text-gray-400'}`}>
            {invoiceNum}
          </span>
          {isTracked && !isTx && (
            <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full flex items-center gap-1 ${type === 'DEBIT' ? 'bg-red-100 text-red-700' : 'bg-emerald-100 text-emerald-700'}`}>
               Entered
            </span>
          )}
          {isTx && tx && party && (
             <div className="hidden sm:flex ml-4 items-center gap-4 text-[10px] font-medium text-gray-600">
               <span className="flex items-center gap-1 text-gray-800"><User size={12} className="text-gray-500"/> <span className="truncate max-w-[120px]">{party.name}</span></span>
               <span className="flex items-center gap-1"><Calendar size={12} className="text-gray-500"/> {new Date(tx.timestamp).toLocaleDateString()}</span>
               <span className="flex items-center gap-1 text-gray-900"><span className="text-gray-500 font-medium">₹</span> {tx.amount.toFixed(2)}</span>
             </div>
          )}
        </div>
        {isTracked ? (
          <button disabled={isTx} onClick={() => !isTx && handleDelete(entry.id)} className={`p-1 transition-colors flex-shrink-0 ${isTx ? 'text-gray-300 cursor-not-allowed' : 'text-gray-400 hover:text-red-600'}`} aria-label={isTx ? 'Cannot delete master entry here' : 'Delete invoice'}>
            <Trash2 size={16} />
          </button>
        ) : (
          <button onClick={() => handleMark(invoiceNum, type)} className={`p-1 transition-colors flex-shrink-0 text-gray-300 hover:${type === 'DEBIT' ? 'text-red-600' : 'text-emerald-600'}`} aria-label="Mark entered">
            <CheckCircle2 size={16} />
          </button>
        )}
      </div>
    );
  };

  return (
    <div className="p-4 sm:p-8 max-w-7xl mx-auto w-full pb-24 sm:pb-8">
      <div className="mb-8 flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900 tracking-tight flex items-center gap-2">
            Invoice Sheets
            {isLoading && <Loader2 className="animate-spin text-gray-400" size={20} />}
          </h1>
          <p className="text-sm text-gray-500 mt-1">Rapid entry and tracking for Invoice Numbers ({START_INVOICE} to {END_INVOICE})</p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Debit Sheet */}
        <div className="bg-white rounded-xl shadow-sm border border-red-100 overflow-hidden flex flex-col h-[70vh]">
          <div className="p-4 border-b border-red-100 bg-red-50/50">
            <h2 className="font-semibold text-red-700 flex items-center justify-between">
              <span>Debit Sheet (Sales)</span>
              <span className="text-xs bg-red-100 px-2 py-1 rounded-full">{debitCount} entered</span>
            </h2>
          </div>
          <div className="p-4 border-b border-gray-100">
            <form onSubmit={e => handleSearch(e, 'DEBIT')} className="flex space-x-2">
              <input 
                type="number" 
                value={debitInput} 
                onChange={e => setDebitInput(e.target.value)} 
                placeholder={`Search invoice no (e.g. ${START_INVOICE})...`} 
                className="flex-1 px-3 py-2 border rounded-md focus:outline-none focus:ring-1 focus:ring-red-500 text-sm"
              />
              <button type="submit" className="px-4 py-2 bg-gray-100 text-gray-700 text-sm font-medium rounded-md hover:bg-gray-200 transition-colors">
                Find / Scroll
              </button>
            </form>
          </div>
          <div className="flex-1 bg-gray-50/30 min-h-0 relative">
            <div className="absolute inset-0">
              <Virtuoso
                ref={debitListRef}
                data={visibleInvoices}
                itemContent={(index, invoiceNum) => renderRow(index, invoiceNum, debitMap, 'DEBIT')}
                style={{ height: '100%', width: '100%' }}
                className="custom-scrollbar"
                onScroll={(e) => {
                  if (isSyncingRef.current === 'CREDIT') return;
                  isSyncingRef.current = 'DEBIT';
                  const target = e.target as HTMLElement;
                  creditListRef.current?.scrollTo({ top: target.scrollTop });
                  
                  // Reset sync lock after a short delay
                  setTimeout(() => { if (isSyncingRef.current === 'DEBIT') isSyncingRef.current = null; }, 50);
                }}
              />
            </div>
          </div>
        </div>

        {/* Credit Sheet */}
        <div className="bg-white rounded-xl shadow-sm border border-emerald-100 overflow-hidden flex flex-col h-[70vh]">
          <div className="p-4 border-b border-emerald-100 bg-emerald-50/50">
            <h2 className="font-semibold text-emerald-700 flex items-center justify-between">
              <span>Credit Sheet (Receipts)</span>
              <span className="text-xs bg-emerald-100 px-2 py-1 rounded-full">{creditCount} entered</span>
            </h2>
          </div>
          <div className="p-4 border-b border-gray-100">
            <form onSubmit={e => handleSearch(e, 'CREDIT')} className="flex space-x-2">
              <input 
                type="number" 
                value={creditInput} 
                onChange={e => setCreditInput(e.target.value)} 
                placeholder={`Search invoice no (e.g. ${START_INVOICE})...`} 
                className="flex-1 px-3 py-2 border rounded-md focus:outline-none focus:ring-1 focus:ring-emerald-500 text-sm"
              />
              <button type="submit" className="px-4 py-2 bg-gray-100 text-gray-700 text-sm font-medium rounded-md hover:bg-gray-200 transition-colors">
                Find / Scroll
              </button>
            </form>
          </div>
          <div className="flex-1 bg-gray-50/30 min-h-0 relative">
            <div className="absolute inset-0">
              <Virtuoso
                ref={creditListRef}
                data={visibleInvoices}
                itemContent={(index, invoiceNum) => renderRow(index, invoiceNum, creditMap, 'CREDIT')}
                style={{ height: '100%', width: '100%' }}
                className="custom-scrollbar"
                onScroll={(e) => {
                  if (isSyncingRef.current === 'DEBIT') return;
                  isSyncingRef.current = 'CREDIT';
                  const target = e.target as HTMLElement;
                  debitListRef.current?.scrollTo({ top: target.scrollTop });

                  setTimeout(() => { if (isSyncingRef.current === 'CREDIT') isSyncingRef.current = null; }, 50);
                }}
              />
            </div>
          </div>
        </div>
      </div>

      {alertInfo && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-sm overflow-hidden transform transition-all">
            <div className={`p-4 border-b ${alertInfo.isError ? 'border-red-100 bg-red-50' : 'border-sky-100 bg-sky-50'}`}>
              <h3 className={`font-semibold text-lg flex items-center ${alertInfo.isError ? 'text-red-700' : 'text-sky-700'}`}>
                {alertInfo.isError ? 'Duplicate Entry' : 'Invoice Matched'}
              </h3>
            </div>
            <div className="p-6">
              <p className="text-gray-700 text-sm font-medium">{alertInfo.message}</p>
            </div>
            <div className="p-4 border-t bg-gray-50 flex justify-end">
              <button 
                onClick={() => setAlertInfo(null)}
                className={`px-6 py-2 text-white rounded-md font-medium transition-colors ${alertInfo.isError ? 'bg-red-600 hover:bg-red-700' : 'bg-sky-600 hover:bg-sky-700'}`}
              >
                Okay
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
