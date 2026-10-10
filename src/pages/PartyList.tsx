import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { db, handleFirestoreError, OperationType, doc, setDoc } from '../firebase';
import { Party, Transaction } from '../types';
import { 
  UserPlus, 
  Search, 
  ChevronRight, 
  ArrowLeft,
  Upload, 
  Loader2, 
  X, 
  Check, 
  Copy, 
  BarChart2,
  CheckCircle2,
  Phone,
  Mail,
  SlidersHorizontal,
  Sparkles,
  Plus
} from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { format, subMonths, startOfMonth, endOfMonth } from 'date-fns';
import { v4 as uuidv4 } from 'uuid';
import { useAuth } from '../AuthContext';
import { useLedger } from '../LedgerContext';
import { syncCollection } from '../lib/syncCache';
import { getFilteredCacheItems, setCacheItem } from '../lib/idbCache';
import { updateDashboardPartiesCount } from '../lib/transactionService';
import { formatContactWith91 } from '../lib/phoneUtils';
import BulkImportPartiesModal from '../components/BulkImportPartiesModal';
import { useLedgerTextCase, CaseIndicator } from '../lib/textCaseHelper';
import { 
  getAvatarColor, 
  formatCustomerCurrency, 
  DEMO_CUSTOMERS_DATA 
} from '../lib/customerTheme';

export default function PartyList() {
  const { activeLedger } = useLedger();
  const { currentUser } = useAuth();
  const navigate = useNavigate();

  const [parties, setParties] = useState<Party[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'DUE' | 'ADVANCE' | 'INACTIVE'>('ALL');
  const [sortOrder, setSortOrder] = useState<'recent' | 'name' | 'due_desc' | 'due_asc'>('recent');
  const [currency, setCurrency] = useState<string>(() => {
    const saved = localStorage.getItem('party_currency');
    return (saved && (saved === '₹' || saved === 'Rs.' || saved === '$')) ? saved : '₹';
  });
  const [showFilterDrawer, setShowFilterDrawer] = useState(false);
  const [showChart, setShowChart] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isSeeding, setIsSeeding] = useState(false);

  // Add Party Form State
  const [showAddModal, setShowAddModal] = useState(false);
  const [addName, setAddName] = useState('');
  const [addPhone, setAddPhone] = useState('');
  const [addAddress, setAddAddress] = useState('');
  const [addEmail, setAddEmail] = useState('');
  const [addOpeningBalance, setAddOpeningBalance] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { isCaps, toggleManualCaps, handleTextChange } = useLedgerTextCase();

  // Bulk Import State
  const [showImportModal, setShowImportModal] = useState(false);
  const [importSuccessMsg, setImportSuccessMsg] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [density, setDensity] = useState<'compact' | 'ultra'>(() => (localStorage.getItem('party_density') as any) || 'compact');

  const handleDensityChange = (d: 'compact' | 'ultra') => {
    setDensity(d);
    localStorage.setItem('party_density', d);
  };

  const handleCurrencyChange = (curr: string) => {
    setCurrency(curr);
    localStorage.setItem('party_currency', curr);
  };

  // Initial Load & Background Sync
  const loadParties = async () => {
    if (!activeLedger?.id) return;
    setIsLoading(true);
    try {
      const [cachedParties, cachedTxs] = await Promise.all([
        getFilteredCacheItems<Party>('parties', p => p.ledgerId === activeLedger.id),
        getFilteredCacheItems<Transaction>('transactions', t => t.ledgerId === activeLedger.id)
      ]);
      setParties(cachedParties);
      setTransactions(cachedTxs);

      // Background sync from remote database
      await Promise.all([
        syncCollection<Party>('parties', activeLedger.id, 'parties'),
        syncCollection<Transaction>('transactions', activeLedger.id, 'transactions')
      ]);
      const [freshParties, freshTxs] = await Promise.all([
        getFilteredCacheItems<Party>('parties', p => p.ledgerId === activeLedger.id),
        getFilteredCacheItems<Transaction>('transactions', t => t.ledgerId === activeLedger.id)
      ]);
      setParties(freshParties);
      setTransactions(freshTxs);
    } catch (e) {
      console.error("Failed to load parties and transactions:", e);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadParties();
    const handleSync = () => { loadParties(); };
    window.addEventListener('database-synced', handleSync);
    return () => { window.removeEventListener('database-synced', handleSync); };
  }, [activeLedger?.id]);

  // Seed Demo Customers from the user's snippet
  const handleSeedDemoCustomers = async () => {
    if (!activeLedger?.id || isSeeding) return;
    setIsSeeding(true);
    try {
      for (const item of DEMO_CUSTOMERS_DATA) {
        const partyId = uuidv4();
        const now = Date.now();
        
        let currentBalance = 0;
        const txList: Transaction[] = [];

        // Build sample transactions
        item.transactions.forEach((tx, idx) => {
          const txTimestamp = now - (tx.daysAgo * 86400000) - (tx.hoursAgo * 3600000);
          if (tx.type === 'DEBIT') {
            currentBalance += tx.amount;
          } else {
            currentBalance -= tx.amount;
          }

          const newTx: Transaction = {
            id: uuidv4(),
            ledgerId: activeLedger.id,
            partyId: partyId,
            invoiceNo: tx.notes.includes('INV-') ? tx.notes.replace('Invoice #', '') : '',
            type: tx.type,
            amount: tx.amount,
            notes: tx.notes,
            timestamp: txTimestamp,
            runningBalance: currentBalance,
            paymentMode: tx.type === 'CREDIT' ? 'Bank' : undefined
          };
          txList.push(newTx);
        });

        const newParty: Party = {
          id: partyId,
          ledgerId: activeLedger.id,
          name: item.name,
          phone: item.phone,
          email: item.email,
          address: item.address,
          openingBalance: 0,
          currentDue: currentBalance,
          lastTransaction: txList.length > 0 ? txList[0].timestamp : now,
          status: 'Active'
        };

        await setCacheItem<Party>('parties', newParty);
        await setDoc(doc(db, 'parties', partyId), newParty);

        for (const t of txList) {
          await setCacheItem<Transaction>('transactions', t);
          await setDoc(doc(db, 'transactions', t.id), t);
        }
      }

      await updateDashboardPartiesCount(activeLedger.id, DEMO_CUSTOMERS_DATA.length);
      window.dispatchEvent(new CustomEvent('database-synced'));
      await loadParties();
      setImportSuccessMsg(`Loaded 8 demo customers with complete transaction history!`);
      setTimeout(() => setImportSuccessMsg(null), 4000);
    } catch (err) {
      console.error('Failed to seed demo customers:', err);
    } finally {
      setIsSeeding(false);
    }
  };

  // Add Party Form Submit
  const handleAddSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting || !activeLedger?.id) return;
    if (!addName.trim()) return;

    setIsSubmitting(true);
    const id = uuidv4();
    const balance = parseFloat(addOpeningBalance) || 0;

    const newParty: Party = {
      id,
      ledgerId: activeLedger.id,
      name: addName.trim(),
      phone: addPhone.trim(),
      address: addAddress.trim(),
      email: addEmail.trim(),
      openingBalance: balance,
      currentDue: balance,
      lastTransaction: Date.now(),
      status: 'Active'
    };

    try {
      const newList = [newParty, ...parties];
      setParties(newList);
      setShowAddModal(false);
      setAddName('');
      setAddPhone('');
      setAddAddress('');
      setAddEmail('');
      setAddOpeningBalance('');

      await setCacheItem<Party>('parties', newParty);
      await setDoc(doc(db, 'parties', id), newParty);
      await updateDashboardPartiesCount(activeLedger.id, 1);
      window.dispatchEvent(new CustomEvent('database-synced'));
    } catch (e) {
      handleFirestoreError(e, OperationType.CREATE, `parties/${id}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  // Filtered & Sorted Customer List
  const filteredParties = useMemo(() => {
    return parties
      .filter(p => {
        if (statusFilter === 'DUE') return p.currentDue > 0;
        if (statusFilter === 'ADVANCE') return p.currentDue < 0;
        if (statusFilter === 'INACTIVE') return p.status === 'Inactive';
        return true;
      })
      .filter(p => {
        if (!search.trim()) return true;
        const q = search.toLowerCase().trim();
        return (
          p.name.toLowerCase().includes(q) ||
          (p.phone || '').toLowerCase().includes(q) ||
          (p.email || '').toLowerCase().includes(q) ||
          (p.address || '').toLowerCase().includes(q)
        );
      })
      .sort((a, b) => {
        if (sortOrder === 'name') return a.name.localeCompare(b.name);
        if (sortOrder === 'due_desc') return b.currentDue - a.currentDue;
        if (sortOrder === 'due_asc') return a.currentDue - b.currentDue;
        return (b.lastTransaction || 0) - (a.lastTransaction || 0);
      });
  }, [parties, statusFilter, search, sortOrder]);

  const totalReceivable = useMemo(() => {
    return parties.filter(p => p.currentDue > 0).reduce((acc, p) => acc + p.currentDue, 0);
  }, [parties]);

  const totalPayable = useMemo(() => {
    return parties.filter(p => p.currentDue < 0).reduce((acc, p) => acc + Math.abs(p.currentDue), 0);
  }, [parties]);

  const debtorsCount = useMemo(() => parties.filter(p => p.currentDue > 0).length, [parties]);
  const creditorsCount = useMemo(() => parties.filter(p => p.currentDue < 0).length, [parties]);

  return (
    <div className={`w-full min-h-screen bg-white sm:bg-[#F8FAFC] pb-16 font-customer ${density === 'ultra' ? 'text-[11px]' : 'text-xs'}`}>
      <div className="w-full min-h-screen bg-white flex flex-col relative sm:max-w-xl md:max-w-2xl sm:mx-auto sm:border-x sm:border-slate-100 sm:shadow-xs transition-all">
        
        {/* ========================================================================= */}
        {/* HEADER BAR                                                                */}
        {/* ========================================================================= */}
        <header className="px-3.5 py-2.5 flex items-center justify-between bg-white sticky top-0 z-20 border-b border-slate-100">
          <div className="flex items-center gap-2.5">
            <button 
              onClick={() => navigate('/')}
              className="p-1 -ml-1 text-[#0F172A] rounded-lg hover:bg-slate-100 active:opacity-60 transition cursor-pointer" 
              aria-label="Go back"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                <line x1="19" y1="12" x2="5" y2="12"></line>
                <polyline points="12 19 5 12 12 5"></polyline>
              </svg>
            </button>
            <div className="flex items-center gap-2">
              <h1 className="text-base sm:text-lg font-bold text-[#0F172A] tracking-tight">Customers</h1>
              <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-[#E2E8F0]/70 text-[#475569]">
                {parties.length}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button 
              type="button"
              onClick={() => setShowAddModal(true)}
              className="w-8 h-8 rounded-full bg-[#1A73E8] hover:bg-[#1557B0] text-white flex items-center justify-center shadow-xs transition-transform active:scale-95 cursor-pointer"
              title="Add Customer"
              aria-label="Add Customer"
            >
              <Plus size={18} strokeWidth={2.8} />
            </button>
            <button 
              onClick={() => setShowFilterDrawer(true)}
              className="p-1.5 text-[#334155] rounded-lg hover:bg-slate-100 active:opacity-60 transition cursor-pointer" 
              aria-label="Filter & Tools"
              title="Filter & Tools"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round">
                <line x1="3" y1="6" x2="21" y2="6"></line>
                <line x1="6" y1="12" x2="18" y2="12"></line>
                <line x1="10" y1="18" x2="14" y2="18"></line>
              </svg>
            </button>
          </div>
        </header>

        {/* Summary Info Card in Header Section - Exactly 2 Options */}
        <div className="px-3.5 pt-3 pb-2 bg-white">
          <div className="bg-[#F0F7FF] border border-[#E0EDFB] rounded-2xl p-3 sm:p-3.5 shadow-2xs">
            <div className="grid grid-cols-2 divide-x divide-[#D0E2F6]">
              {/* Option 1: Total Outstanding */}
              <div className="pr-3">
                <div className="flex items-center justify-between">
                  <span className="text-[11.5px] font-semibold text-[#64748B] block">
                    Total OT
                  </span>
                  <span className="text-[10px] font-bold px-1.5 py-0.2 rounded-full bg-rose-50 text-[#DC2626]">
                    {debtorsCount} {debtorsCount === 1 ? 'party' : 'parties'}
                  </span>
                </div>
                <span className="text-[18px] sm:text-[20px] font-bold text-[#DC2626] block mt-1 tabular-nums">
                  ₹{totalReceivable.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </span>
              </div>

              {/* Option 2: Total Creditors */}
              <div className="pl-3">
                <div className="flex items-center justify-between">
                  <span className="text-[11.5px] font-semibold text-[#64748B] block">
                    Total Creditors
                  </span>
                  <span className="text-[10px] font-bold px-1.5 py-0.2 rounded-full bg-emerald-50 text-[#059669]">
                    {creditorsCount} {creditorsCount === 1 ? 'party' : 'parties'}
                  </span>
                </div>
                <span className="text-[18px] sm:text-[20px] font-bold text-[#059669] block mt-1 tabular-nums">
                  ₹{totalPayable.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Import Banner Notification */}
        {importSuccessMsg && (
          <div className="mx-3.5 my-1 p-2 bg-emerald-50 border border-emerald-200 rounded-md text-[10.5px] text-emerald-800 font-semibold flex items-center justify-between shadow-xs animate-in fade-in">
            <div className="flex items-center gap-1.5">
              <CheckCircle2 size={13} className="text-emerald-600 shrink-0" />
              <span>{importSuccessMsg}</span>
            </div>
            <button 
              type="button" 
              onClick={() => setImportSuccessMsg(null)}
              className="text-emerald-600 hover:text-emerald-800 p-0.5 cursor-pointer"
            >
              <X size={11} />
            </button>
          </div>
        )}

        {/* ========================================================================= */}
        {/* SEARCH & SORT SECTION                                                     */}
        {/* ========================================================================= */}
        <div className="px-3.5 py-1.5 bg-white flex items-center gap-2">
          <div className="flex-1 flex items-center bg-[#F1F5F9] rounded-xl px-3 py-2 gap-2">
            <span className="text-[#64748B] flex items-center shrink-0">
              <Search size={15} strokeWidth={2.2} />
            </span>
            <input 
              type="text" 
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="border-none outline-none bg-transparent w-full text-xs text-[#1E293B] font-normal placeholder:text-[#94A3B8]" 
              placeholder="Search customer..." 
              autoComplete="off"
            />
            {search && (
              <button 
                onClick={() => setSearch('')}
                className="text-[#94A3B8] hover:text-[#0F172A] p-0.5 cursor-pointer"
              >
                <X size={13} />
              </button>
            )}
          </div>

          <button
            type="button"
            onClick={() => setShowFilterDrawer(true)}
            className="flex items-center gap-1.5 px-3 py-2 bg-white border border-[#E2E8F0] hover:bg-slate-50 rounded-xl text-xs font-semibold text-[#334155] shadow-2xs shrink-0 cursor-pointer transition"
          >
            <SlidersHorizontal size={14} className="text-[#64748B]" />
            <span>Sort & options</span>
          </button>
        </div>

        {/* Quick Status Filter Pills */}
        <div className="px-3.5 pb-2 pt-0.5 flex items-center gap-2 overflow-x-auto no-scrollbar">
          <button
            onClick={() => setStatusFilter('ALL')}
            className={`px-3 py-1 rounded-full text-xs font-bold whitespace-nowrap transition-colors cursor-pointer ${
              statusFilter === 'ALL'
                ? 'bg-[#0F172A] text-white'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            All ({parties.length})
          </button>
          <button
            onClick={() => setStatusFilter('DUE')}
            className={`px-3 py-1 rounded-full text-xs font-bold whitespace-nowrap transition-colors cursor-pointer ${
              statusFilter === 'DUE'
                ? 'bg-[#FEE2E2] text-[#DC2626]'
                : 'bg-slate-50 text-slate-600 hover:bg-rose-50 hover:text-rose-600'
            }`}
          >
            Debtors ({debtorsCount})
          </button>
          <button
            onClick={() => setStatusFilter('ADVANCE')}
            className={`px-3 py-1 rounded-full text-xs font-bold whitespace-nowrap transition-colors cursor-pointer ${
              statusFilter === 'ADVANCE'
                ? 'bg-[#DCFCE7] text-[#059669]'
                : 'bg-slate-50 text-slate-600 hover:bg-emerald-50 hover:text-emerald-600'
            }`}
          >
            Creditors ({creditorsCount})
          </button>
        </div>

        {/* ========================================================================= */}
        {/* COMPACT CUSTOMER LIST                                                     */}
        {/* ========================================================================= */}
        <main className="flex-1 pb-16">
          {isLoading && parties.length === 0 ? (
            <div className="py-12 text-center text-slate-400">
              <Loader2 className="animate-spin mx-auto mb-1.5 text-blue-600" size={18} />
              <p className="text-[11px] font-medium">Loading customers...</p>
            </div>
          ) : (
            <ul className="list-none m-0 p-0">
              {filteredParties.map((party) => {
                const avatar = getAvatarColor(party.name);
                const initial = party.name.trim().charAt(0).toUpperCase() || 'C';

                return (
                  <li 
                    key={party.id}
                    onClick={() => navigate(`/parties/${party.id}`)}
                    className="flex items-center px-3 py-1.5 cursor-pointer border-b border-[#F1F5F9] hover:bg-[#F8FAFC] active:bg-[#F1F5F9] transition-colors select-none"
                  >
                    {/* Circle Avatar (26px) */}
                    <div 
                      className={`w-7 h-7 rounded-full flex items-center justify-center text-[10.5px] font-bold shrink-0 mr-2.5 shadow-2xs ${avatar.className}`}
                      style={{ backgroundColor: avatar.bg, color: avatar.text }}
                    >
                      {initial}
                    </div>

                    {/* Customer Info */}
                    <div className="flex-1 min-w-0 pr-1.5">
                      <div className="text-[12px] font-bold text-[#0F172A] leading-tight mb-0.5 truncate">
                        {party.name}
                      </div>
                      <div className="text-[10px] text-[#64748B] leading-tight truncate">
                        {party.email || (party.address ? party.address : 'No email added')}
                      </div>
                      <div className="text-[10px] text-[#64748B] leading-tight truncate">
                        {party.phone || 'No phone number'}
                      </div>
                    </div>

                    {/* Balance Preview & Chevron */}
                    <div className="flex items-center gap-1 shrink-0">
                      {party.currentDue !== 0 && (
                        <div className="text-right hidden min-[320px]:block">
                          <div className={`text-[10.5px] font-bold ${party.currentDue > 0 ? 'text-rose-600' : 'text-emerald-600'}`}>
                            {party.currentDue > 0 ? '-' : '+'}{formatCustomerCurrency(party.currentDue, currency)}
                          </div>
                          <span className={`text-[8px] font-bold uppercase tracking-wider ${party.currentDue > 0 ? 'text-rose-500' : 'text-emerald-500'}`}>
                            {party.currentDue > 0 ? 'DR' : 'CR'}
                          </span>
                        </div>
                      )}
                      <div className="text-[#94A3B8] flex items-center ml-0.5 shrink-0">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="9 18 15 12 9 6"></polyline>
                        </svg>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}

          {/* Empty Search State */}
          {filteredParties.length === 0 && parties.length > 0 && (
            <div className="text-center py-10 px-3 text-[#94A3B8] text-[11px]">
              No customers found matching &quot;{search}&quot;
            </div>
          )}

          {/* Empty Ledger State (Offers 1-Click Demo Seed) */}
          {!isLoading && parties.length === 0 && (
            <div className="text-center py-10 px-4 space-y-2.5">
              <div className="w-10 h-10 rounded-full bg-blue-50 text-blue-600 flex items-center justify-center mx-auto">
                <UserPlus size={18} />
              </div>
              <div>
                <h3 className="text-xs font-bold text-slate-800">No Customers in this Ledger</h3>
                <p className="text-[10.5px] text-slate-500 mt-0.5 max-w-xs mx-auto">
                  Add your first customer to start recording ledger transactions.
                </p>
              </div>

              <div className="flex items-center justify-center pt-1">
                <button
                  type="button"
                  onClick={() => setShowAddModal(true)}
                  className="px-4 py-2 bg-[#1A73E8] hover:bg-blue-700 text-white text-xs font-bold rounded-lg transition shadow-xs flex items-center justify-center gap-1.5 cursor-pointer active:scale-95"
                >
                  <Plus size={13} />
                  <span>Add First Customer</span>
                </button>
              </div>
            </div>
          )}
        </main>

        {/* ========================================================================= */}
        {/* COMPACT FLOATING ACTION BUTTON (FAB)                                      */}
        {/* ========================================================================= */}
        <button 
          onClick={() => setShowAddModal(true)}
          className="fixed right-3 bottom-4 w-9 h-9 rounded-full bg-gradient-to-br from-[#1A73E8] to-[#0D62D9] text-white flex items-center justify-center shadow-md cursor-pointer z-20 hover:scale-105 active:scale-95 transition-transform" 
          aria-label="Add Customer"
          title="Add Customer"
        >
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="12" y1="5" x2="12" y2="19"></line>
            <line x1="5" y1="12" x2="19" y2="12"></line>
          </svg>
        </button>

        {/* ========================================================================= */}
        {/* FILTER & TOOLS MODAL / DRAWER                                             */}
        {/* ========================================================================= */}
        {showFilterDrawer && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-3 bg-slate-900/50 backdrop-blur-xs animate-in fade-in">
            <div className="bg-white rounded-xl w-full max-w-xs border border-slate-200 p-4 space-y-3 shadow-xl">
              <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                <h3 className="font-bold text-sm text-[#0F172A]">Filter & Settings</h3>
                <button 
                  onClick={() => setShowFilterDrawer(false)}
                  className="text-slate-400 hover:text-slate-600 p-0.5"
                >
                  <X size={16} />
                </button>
              </div>

              {/* Sort Order */}
              <div>
                <label className="text-[10px] font-bold text-slate-700 uppercase tracking-wider block mb-1">Sort Customers By</label>
                <select
                  value={sortOrder}
                  onChange={e => setSortOrder(e.target.value as any)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1.5 text-[11px] text-slate-700 focus:outline-none focus:border-blue-600 cursor-pointer"
                >
                  <option value="recent">Most Recent Transaction</option>
                  <option value="name">Customer Name (A-Z)</option>
                  <option value="due_desc">Due Balance: High to Low</option>
                  <option value="due_asc">Due Balance: Low to High</option>
                </select>
              </div>

              {/* Quick Actions */}
              <div className="space-y-1.5 pt-1.5 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => { setShowFilterDrawer(false); setShowImportModal(true); }}
                  className="w-full py-1.5 px-2.5 bg-slate-100 hover:bg-slate-200 rounded-lg text-[11px] font-semibold text-slate-700 flex items-center justify-center gap-1.5 transition"
                >
                  <Upload size={13} />
                  <span>Import Excel / CSV</span>
                </button>
              </div>

              <button
                type="button"
                onClick={() => setShowFilterDrawer(false)}
                className="w-full py-2 bg-[#0F172A] text-white font-bold text-[11px] rounded-lg hover:bg-slate-800 transition"
              >
                Apply & Close
              </button>
            </div>
          </div>
        )}

        {/* ========================================================================= */}
        {/* ADD CUSTOMER MODAL                                                        */}
        {/* ========================================================================= */}
        {showAddModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in">
            <div className="bg-white rounded-2xl w-full max-w-md border border-slate-200 overflow-hidden shadow-2xl">
              <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center">
                    <UserPlus size={16} />
                  </div>
                  <h3 className="font-bold text-slate-900 text-base">Add New Customer</h3>
                </div>
                <button 
                  onClick={() => setShowAddModal(false)}
                  className="text-slate-400 hover:text-slate-600 p-1"
                >
                  <X size={18} />
                </button>
              </div>

              <form onSubmit={handleAddSubmit} className="p-5 space-y-3.5">
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-xs font-bold text-slate-700">Customer Name *</label>
                    <CaseIndicator isCaps={isCaps} toggleCaps={toggleManualCaps} />
                  </div>
                  <input
                    type="text"
                    required
                    value={addName}
                    onChange={e => handleTextChange(e, setAddName)}
                    placeholder="e.g. Acme Corp"
                    className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-900 focus:outline-none focus:border-blue-600 focus:bg-white transition"
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs font-bold text-slate-700 block mb-1">Phone Number</label>
                    <input
                      type="text"
                      value={addPhone}
                      onChange={e => setAddPhone(e.target.value)}
                      placeholder="+62 812 3456 7890"
                      className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-900 focus:outline-none focus:border-blue-600 focus:bg-white transition"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-bold text-slate-700 block mb-1">Email Address</label>
                    <input
                      type="email"
                      value={addEmail}
                      onChange={e => setAddEmail(e.target.value)}
                      placeholder="contact@acme.com"
                      className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-900 focus:outline-none focus:border-blue-600 focus:bg-white transition"
                    />
                  </div>
                </div>

                <div>
                  <label className="text-xs font-bold text-slate-700 block mb-1">Address / Location</label>
                  <input
                    type="text"
                    value={addAddress}
                    onChange={e => handleTextChange(e, setAddAddress)}
                    placeholder="Street, City, Postal Code"
                    className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-900 focus:outline-none focus:border-blue-600 focus:bg-white transition"
                  />
                </div>

                <div>
                  <label className="text-xs font-bold text-slate-700 block mb-1">
                    Opening Balance ({currency})
                  </label>
                  <input
                    type="number"
                    step="any"
                    value={addOpeningBalance}
                    onChange={e => setAddOpeningBalance(e.target.value)}
                    placeholder="0"
                    className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-900 focus:outline-none focus:border-blue-600 focus:bg-white transition"
                  />
                  <p className="text-[10px] text-slate-400 mt-1">Positive for debit / dues, negative for credit / advance.</p>
                </div>

                <div className="pt-3 flex gap-2">
                  <button
                    type="button"
                    onClick={() => setShowAddModal(false)}
                    className="flex-1 py-2.5 border border-slate-200 text-slate-700 text-xs font-bold rounded-xl hover:bg-slate-50 transition"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={isSubmitting}
                    className="flex-1 py-2.5 bg-gradient-to-r from-[#1A73E8] to-[#0D62D9] text-white text-xs font-bold rounded-xl hover:opacity-95 transition shadow-md flex items-center justify-center gap-1.5"
                  >
                    {isSubmitting ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                    <span>Save Customer</span>
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* Bulk Import Modal */}
        {showImportModal && activeLedger && (
          <BulkImportPartiesModal
            isOpen={showImportModal}
            onClose={() => setShowImportModal(false)}
            ledgerId={activeLedger.id}
            ledgerName={activeLedger.name}
            ledgerType={activeLedger.type}
            existingParties={parties}
            onSuccess={count => {
              loadParties();
              setImportSuccessMsg(`Imported ${count} customers successfully!`);
              setTimeout(() => setImportSuccessMsg(null), 4000);
            }}
          />
        )}

      </div>
    </div>
  );
}
