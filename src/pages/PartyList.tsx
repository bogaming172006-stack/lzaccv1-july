import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { db, handleFirestoreError, OperationType, doc, setDoc } from '../firebase';
import { Party } from '../types';
import { 
  UserPlus, 
  Search, 
  ChevronLeft, 
  ChevronRight, 
  Upload, 
  Loader2, 
  X, 
  Phone, 
  Mail, 
  MapPin, 
  Users, 
  TrendingDown, 
  TrendingUp, 
  ArrowRight,
  Filter,
  FileSpreadsheet,
  Download,
  CheckCircle2,
  Copy,
  Check
} from 'lucide-react';
import { v4 as uuidv4 } from 'uuid';
import { useAuth } from '../AuthContext';
import { useLedger } from '../LedgerContext';
import { syncCollection } from '../lib/syncCache';
import { getFilteredCacheItems, setCacheItem } from '../lib/idbCache';
import { updateDashboardPartiesCount } from '../lib/transactionService';
import { formatContactWith91 } from '../lib/phoneUtils';
import BulkImportPartiesModal from '../components/BulkImportPartiesModal';
import PageHeader from '../components/ui/PageHeader';
import StatCard from '../components/ui/StatCard';
import AmountDisplay from '../components/ui/AmountDisplay';
import Badge from '../components/ui/Badge';
import { Card, CardHeader, CardBody } from '../components/ui/Card';

const ITEMS_PER_PAGE = 20;

export default function PartyList() {
  const { activeLedger } = useLedger();
  const { currentUser } = useAuth();
  const navigate = useNavigate();
  const [parties, setParties] = useState<Party[]>([]);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'DUE' | 'ADVANCE' | 'INACTIVE'>('ALL');
  const [sortOrder, setSortOrder] = useState<'recent' | 'name' | 'due_desc' | 'due_asc'>('recent');
  const [currentPage, setCurrentPage] = useState(1);
  const [isLoading, setIsLoading] = useState(false);

  // Add Party Form State
  const [showAddModal, setShowAddModal] = useState(false);
  const [addName, setAddName] = useState('');
  const [addPhone, setAddPhone] = useState('');
  const [addAddress, setAddAddress] = useState('');
  const [addEmail, setAddEmail] = useState('');
  const [addOpeningBalance, setAddOpeningBalance] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Bulk Import State
  const [showImportModal, setShowImportModal] = useState(false);
  const [importSuccessMsg, setImportSuccessMsg] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const handleCopyPartyId = (e: React.MouseEvent, partyId: string) => {
    e.stopPropagation();
    navigator.clipboard.writeText(partyId);
    setCopiedId(partyId);
    setTimeout(() => {
      setCopiedId(null);
    }, 2000);
  };

  // 1. Initial Load & Background Sync
  const loadParties = async () => {
    if (!activeLedger?.id) return;
    setIsLoading(true);
    try {
      // Load cached items
      const cached = await getFilteredCacheItems<Party>('parties', p => p.ledgerId === activeLedger.id);
      setParties(cached);

      // Background sync from remote database
      await syncCollection<Party>('parties', activeLedger.id, 'parties');
      const fresh = await getFilteredCacheItems<Party>('parties', p => p.ledgerId === activeLedger.id);
      setParties(fresh);
    } catch (e) {
      console.error("Failed to load parties:", e);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadParties();

    const handleSync = () => {
      loadParties();
    };
    window.addEventListener('database-synced', handleSync);
    return () => {
      window.removeEventListener('database-synced', handleSync);
    };
  }, [activeLedger?.id]);

  // Reset page when filter or search changes
  useEffect(() => {
    setCurrentPage(1);
  }, [search, statusFilter, sortOrder]);

  // 2. Filter & Sort
  const filteredParties = parties
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
        (p.name || '').toLowerCase().includes(q) ||
        (p.phone || '').includes(q) ||
        (p.email || '').toLowerCase().includes(q) ||
        (p.address || '').toLowerCase().includes(q) ||
        (p.id || '').toLowerCase().includes(q)
      );
    })
    .sort((a, b) => {
      if (sortOrder === 'name') {
        return a.name.localeCompare(b.name);
      }
      if (sortOrder === 'due_desc') {
        return b.currentDue - a.currentDue;
      }
      if (sortOrder === 'due_asc') {
        return a.currentDue - b.currentDue;
      }
      // 'recent' by lastTransaction
      return (b.lastTransaction || 0) - (a.lastTransaction || 0);
    });

  // 3. Add Party Handler
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
      phone: formatContactWith91(addPhone),
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

  // 4. Bulk CSV / Excel Import Callback
  const handleImportSuccess = (importedCount: number) => {
    loadParties();
    setImportSuccessMsg(`Successfully imported ${importedCount} party account${importedCount === 1 ? '' : 's'}!`);
    setTimeout(() => {
      setImportSuccessMsg(null);
    }, 4000);
  };

  const totalPages = Math.ceil(filteredParties.length / ITEMS_PER_PAGE);
  const paginatedParties = filteredParties.slice(
    (currentPage - 1) * ITEMS_PER_PAGE,
    currentPage * ITEMS_PER_PAGE
  );

  const totalReceivable = parties.filter(p => p.currentDue > 0).reduce((acc, p) => acc + p.currentDue, 0);
  const totalPayable = parties.filter(p => p.currentDue < 0).reduce((acc, p) => acc + Math.abs(p.currentDue), 0);

  const isPurchase = activeLedger?.type === 'PURCHASE';
  const isExpense = activeLedger?.type === 'EXPENSE';

  if (!activeLedger) {
    return <div className="p-8 text-center text-slate-500 font-medium">Please select a ledger.</div>;
  }

  return (
    <div className="p-2 min-[400px]:p-3 sm:p-8 pt-1 min-[400px]:pt-1.5 sm:pt-8 max-w-7xl mx-auto w-full pb-20 sm:pb-8 space-y-2 sm:space-y-6">
      
      {/* Import Success Banner */}
      {importSuccessMsg && (
        <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-xs text-emerald-800 font-semibold flex items-center justify-between shadow-2xs animate-in fade-in">
          <div className="flex items-center gap-2">
            <CheckCircle2 size={16} className="text-emerald-600 shrink-0" />
            <span>{importSuccessMsg}</span>
          </div>
          <button 
            type="button" 
            onClick={() => setImportSuccessMsg(null)}
            className="text-emerald-600 hover:text-emerald-800 p-1"
          >
            <X size={14} />
          </button>
        </div>
      )}

      {/* Page Header */}
      <div className="flex flex-row items-center justify-between gap-1.5 sm:gap-4">
        <div>
          <div className="flex items-center gap-1.5 sm:gap-3 flex-wrap">
            <h1 className="text-sm min-[400px]:text-base sm:text-3xl font-semibold sm:font-bold text-slate-900 tracking-tight">
              {isExpense ? "Expense Accounts & Payees" : isPurchase ? "Purchases Parties" : "Party Ledgers"}
            </h1>
          </div>
        </div>

        <div className="flex items-center gap-1 sm:gap-3 shrink-0">
          {currentUser?.isAdmin && (
            <button
              type="button"
              onClick={() => setShowImportModal(true)}
              className="inline-flex items-center justify-center px-2 sm:px-3 py-1 sm:py-1.5 text-blue-700 bg-blue-50 hover:bg-blue-100/80 border border-blue-200/80 rounded-md sm:rounded-xl text-[11px] sm:text-xs font-bold transition shadow-2xs"
              title="Bulk import party names and contacts from CSV or Excel files"
            >
              <Upload size={13} className="mr-1 text-blue-600" />
              <span>Import CSV / Excel</span>
            </button>
          )}

          <button
            type="button"
            onClick={() => setShowAddModal(true)}
            className="inline-flex items-center justify-center gap-0.5 sm:gap-1 text-[10.5px] sm:text-sm font-semibold text-white bg-[#0055a5] hover:bg-blue-800 transition py-1 sm:py-1.5 px-2.5 sm:px-3.5 rounded-md sm:rounded-xl shadow-2xs"
          >
            <UserPlus size={14} />
            <span>Add <span className="hidden min-[380px]:inline">New </span>{isExpense ? 'Expense Head' : isPurchase ? 'Vendor' : 'Party'}</span>
          </button>
        </div>
      </div>

      {/* 3 Metric Cards */}
      <div className="grid grid-cols-3 gap-1.5 sm:gap-4">
        
        {/* Card 1: TOTAL REGISTERED PARTIES */}
        <div className={`bg-white rounded-lg sm:rounded-2xl border ${isExpense ? 'border-rose-200' : isPurchase ? 'border-purple-200' : 'border-slate-200'} p-1.5 min-[400px]:p-2.5 sm:p-6 shadow-2xs flex flex-col justify-between`}>
          <span className="text-[8px] min-[400px]:text-[9px] sm:text-[11px] font-normal uppercase tracking-wider text-slate-500 truncate">
            {isExpense ? "Expense Heads" : "Parties"}
          </span>
          <div className="mt-0.5 sm:mt-3">
            <div className={`text-xs min-[400px]:text-sm sm:text-4xl font-normal sm:font-bold ${isExpense ? 'text-rose-700' : isPurchase ? 'text-purple-800' : 'text-[#0055a5]'} tracking-tight`}>
              {parties.length}
            </div>
          </div>
        </div>

        {/* Card 2: TOTAL RECEIVABLES (DUES) / EXPENSES PAYABLE */}
        <div className="bg-white rounded-lg sm:rounded-2xl border border-slate-200 p-1.5 min-[400px]:p-2.5 sm:p-6 shadow-2xs flex flex-col justify-between">
          <span className="text-[8px] min-[400px]:text-[9px] sm:text-[11px] font-normal uppercase tracking-wider text-slate-500 truncate">
            {isExpense ? "Total Expenses (Payable)" : "Receivables"}
          </span>
          <div className="mt-0.5 sm:mt-3">
            <div className="text-[10px] min-[400px]:text-xs sm:text-3xl font-normal sm:font-bold text-rose-600 tracking-tight tabular-nums flex items-baseline gap-0.5">
              <span>₹{totalReceivable.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
              <span className="text-[8px] min-[400px]:text-[9px] sm:text-xs font-normal sm:font-bold uppercase text-rose-600">DR</span>
            </div>
          </div>
        </div>

        {/* Card 3: TOTAL PAYABLES (ADVANCES) */}
        <div className="bg-white rounded-lg sm:rounded-2xl border border-slate-200 p-1.5 min-[400px]:p-2.5 sm:p-6 shadow-2xs flex flex-col justify-between">
          <span className="text-[8px] min-[400px]:text-[9px] sm:text-[11px] font-normal uppercase tracking-wider text-slate-500 truncate">
            {isExpense ? "Settled / Credit" : "Payables"}
          </span>
          <div className="mt-0.5 sm:mt-3">
            <div className="text-[10px] min-[400px]:text-xs sm:text-3xl font-normal sm:font-bold text-emerald-600 tracking-tight tabular-nums flex items-baseline gap-0.5">
              <span>₹{totalPayable.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
              <span className="text-[8px] min-[400px]:text-[9px] sm:text-xs font-normal sm:font-bold uppercase text-emerald-600">CR</span>
            </div>
          </div>
        </div>

      </div>

      {/* Main Table Container */}
      <div className="bg-white rounded-xl sm:rounded-2xl border border-slate-200 shadow-2xs overflow-hidden">
        
        {/* Search & Filter Toolbar */}
        <div className="p-2 sm:p-5 border-b border-slate-100 flex flex-col lg:flex-row gap-2 sm:gap-4 items-stretch lg:items-center justify-between">
          
          {/* Search Field */}
          <div className="relative flex-1 max-w-md">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder="Search party name, phone..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full pl-7.5 pr-7 py-1 sm:py-2 bg-white border border-slate-200 hover:border-slate-300 rounded-md sm:rounded-lg text-[11px] min-[400px]:text-[11.5px] sm:text-sm font-normal text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-[#0055a5] transition-colors"
            />
            {search && (
              <button
                onClick={() => setSearch('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
              >
                <X size={13} />
              </button>
            )}
          </div>

          {/* Underline Tabs & Sort Dropdown */}
          <div className="flex items-center justify-between lg:justify-end gap-2 sm:gap-5">
            {/* Status Tabs */}
            <div className="flex items-center space-x-2 min-[400px]:space-x-3 sm:space-x-6 text-[10.5px] min-[400px]:text-[11px] sm:text-sm overflow-x-auto">
              <button
                type="button"
                onClick={() => setStatusFilter('ALL')}
                className={`py-0.5 sm:py-1 whitespace-nowrap transition-all ${
                  statusFilter === 'ALL'
                    ? 'border-b-2 border-[#0055a5] text-[#0055a5] font-medium sm:font-semibold'
                    : 'text-slate-500 hover:text-slate-900 font-normal'
                }`}
              >
                All ({parties.length})
              </button>
              <button
                type="button"
                onClick={() => setStatusFilter('DUE')}
                className={`py-0.5 sm:py-1 whitespace-nowrap transition-all ${
                  statusFilter === 'DUE'
                    ? 'border-b-2 border-[#0055a5] text-[#0055a5] font-medium sm:font-semibold'
                    : 'text-slate-500 hover:text-slate-900 font-normal'
                }`}
              >
                Debtors ({parties.filter(p => p.currentDue > 0).length})
              </button>
              <button
                type="button"
                onClick={() => setStatusFilter('ADVANCE')}
                className={`py-0.5 sm:py-1 whitespace-nowrap transition-all ${
                  statusFilter === 'ADVANCE'
                    ? 'border-b-2 border-[#0055a5] text-[#0055a5] font-medium sm:font-semibold'
                    : 'text-slate-500 hover:text-slate-900 font-normal'
                }`}
              >
                Creditors ({parties.filter(p => p.currentDue < 0).length})
              </button>
            </div>

            {/* Sort Select */}
            <select
              value={sortOrder}
              onChange={e => setSortOrder(e.target.value as any)}
              className="bg-white border border-slate-200 hover:border-slate-300 rounded-md sm:rounded-lg px-2 py-0.5 sm:py-1.5 text-[10px] min-[400px]:text-[10.5px] sm:text-sm text-slate-600 font-normal sm:font-medium focus:outline-none focus:border-[#0055a5] transition-colors cursor-pointer shrink-0"
            >
              <option value="recent">Recent</option>
              <option value="name">Name (A-Z)</option>
              <option value="due_desc">Due: High-Low</option>
              <option value="due_asc">Due: Low-High</option>
            </select>
          </div>
        </div>

        {/* Accounting Table (Desktop) */}
        <div className="hidden md:block overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-200 bg-white text-[11px] font-semibold uppercase text-slate-700 tracking-wider">
                <th className="py-3.5 px-4 w-5/12">Party Name & Information</th>
                <th className="py-3.5 px-4 w-3/12">Contact Phone</th>
                <th className="py-3.5 px-4 w-2/12 text-right">Current Ledger Balance</th>
                {currentUser?.isAdmin && (
                  <th className="py-3.5 px-4 w-1/12 text-center">Status</th>
                )}
                <th className="py-3.5 px-4 w-12 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-xs">
              {paginatedParties.map((party) => {
                return (
                  <tr 
                    key={party.id} 
                    onClick={() => navigate(`/parties/${party.id}`)}
                    className="hover:bg-slate-50/60 cursor-pointer transition-colors"
                  >
                    <td className="py-4 px-4">
                      <div className="flex items-center gap-3.5">
                        <div className="w-10 h-10 rounded-xl bg-blue-50/80 border border-blue-100 text-[#0055a5] flex items-center justify-center font-bold text-xs uppercase shrink-0">
                          {party.name.substring(0, 2).toUpperCase()}
                        </div>
                        <div className="min-w-0">
                          <span className="font-bold text-slate-900 text-sm block truncate hover:text-[#0055a5] transition-colors">
                            {party.name}
                          </span>
                          {party.address && (
                            <span className="text-xs text-slate-500 block truncate max-w-sm mt-0.5">
                              {party.address}
                            </span>
                          )}
                          {party.email && (
                            <span className="text-xs text-slate-400 block truncate max-w-sm">
                              {party.email}
                            </span>
                          )}
                          {currentUser?.isAdmin && (
                            <div 
                              onClick={(e) => handleCopyPartyId(e, party.id)}
                              className="inline-flex items-center gap-1.5 px-2 py-0.5 mt-1 rounded bg-slate-100/90 hover:bg-slate-200/90 text-slate-600 hover:text-slate-900 border border-slate-200/80 text-[10px] font-mono cursor-pointer transition select-all group max-w-fit"
                              title="Click to copy database Document ID"
                            >
                              <span className="text-slate-400 font-sans font-bold text-[8.5px] uppercase tracking-wider">ID:</span>
                              <span className="truncate max-w-[160px] sm:max-w-[220px]">{party.id}</span>
                              {copiedId === party.id ? (
                                <Check size={11} className="text-emerald-600 shrink-0" />
                              ) : (
                                <Copy size={11} className="text-slate-400 group-hover:text-slate-600 shrink-0" />
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    </td>

                    <td className="py-4 px-4">
                      {party.phone ? (
                        <span className="text-xs text-slate-800 font-medium font-sans">
                          {party.phone}
                        </span>
                      ) : (
                        <span className="text-xs text-slate-400 italic">No contact</span>
                      )}
                    </td>

                    <td className="py-4 px-4 text-right">
                      <div className="font-bold text-xs sm:text-sm tabular-nums inline-flex items-baseline gap-1">
                        <span className={party.currentDue > 0 ? "text-rose-600" : party.currentDue < 0 ? "text-emerald-600" : "text-slate-900"}>
                          ₹{Math.abs(party.currentDue).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </span>
                        <span className={`text-[10px] font-bold uppercase ${party.currentDue > 0 ? "text-rose-600" : party.currentDue < 0 ? "text-emerald-600" : "text-slate-500"}`}>
                          {party.currentDue > 0 ? 'DR' : party.currentDue < 0 ? 'CR' : ''}
                        </span>
                      </div>
                    </td>

                    {currentUser?.isAdmin && (
                      <td className="py-4 px-4 text-center">
                        <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-600 uppercase tracking-wide">
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
                          {party.status || 'ACTIVE'}
                        </span>
                      </td>
                    )}

                    <td className="py-4 px-4 text-right">
                      <span className="inline-flex items-center justify-center w-7 h-7 text-slate-400 hover:text-slate-700 transition-colors">
                        <ChevronRight size={16} />
                      </span>
                    </td>
                  </tr>
                );
              })}

              {filteredParties.length === 0 && (
                <tr>
                  <td colSpan={currentUser?.isAdmin ? 5 : 4} className="py-12 text-center text-slate-500 text-sm font-medium">
                    <div className="max-w-xs mx-auto space-y-3">
                      <p>No parties found in this ledger.</p>
                      <div className="flex items-center justify-center gap-2">
                        <button
                          type="button"
                          onClick={() => setShowImportModal(true)}
                          className="px-3 py-1.5 bg-blue-50 text-blue-700 hover:bg-blue-100 rounded-lg text-xs font-bold transition flex items-center gap-1.5"
                        >
                          <Upload size={13} />
                          <span>Import CSV / Excel</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => setShowAddModal(true)}
                          className="px-3 py-1.5 bg-[#0055a5] text-white hover:bg-blue-800 rounded-lg text-xs font-bold transition flex items-center gap-1.5"
                        >
                          <UserPlus size={13} />
                          <span>Add Party</span>
                        </button>
                      </div>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Mobile View: High Density Compact List */}
        <div className="block md:hidden divide-y divide-slate-100 bg-white">
          {paginatedParties.map((party) => (
            <div 
              key={party.id} 
              onClick={() => navigate(`/parties/${party.id}`)}
              className="p-2 min-[400px]:p-2.5 hover:bg-slate-50 transition-colors flex items-center justify-between gap-2 cursor-pointer"
            >
              <div className="flex items-center gap-2 min-w-0">
                <div className="w-7 h-7 rounded-md bg-blue-50/80 border border-blue-100 text-[#0055a5] flex items-center justify-center font-normal text-[11px] shrink-0 uppercase">
                  {party.name.substring(0, 2).toUpperCase()}
                </div>
                <div className="min-w-0">
                  <h4 className="font-normal text-slate-800 text-[11.5px] min-[400px]:text-xs truncate">{party.name}</h4>
                  <p className="text-[9.5px] min-[400px]:text-[10px] text-slate-400 mt-0.5 truncate">{party.phone || 'No phone'}</p>
                  {currentUser?.isAdmin && (
                    <div 
                      onClick={(e) => handleCopyPartyId(e, party.id)}
                      className="inline-flex items-center gap-1 px-1.5 py-0.5 mt-0.5 rounded bg-slate-100 text-slate-600 text-[9px] font-mono cursor-pointer transition select-all max-w-fit"
                      title="Click to copy party ID"
                    >
                      <span className="text-slate-400 font-sans text-[8px] font-bold">ID:</span>
                      <span className="truncate max-w-[100px]">{party.id}</span>
                      {copiedId === party.id ? (
                        <Check size={9} className="text-emerald-600 shrink-0" />
                      ) : (
                        <Copy size={9} className="text-slate-400 shrink-0" />
                      )}
                    </div>
                  )}
                </div>
              </div>

              <div className="text-right shrink-0">
                <div className="font-normal text-[11.5px] min-[400px]:text-xs tabular-nums">
                  <span className={party.currentDue > 0 ? "text-rose-600" : party.currentDue < 0 ? "text-emerald-600" : "text-slate-700"}>
                    ₹{Math.abs(party.currentDue).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                  </span>
                  <span className={`text-[9px] ml-0.5 uppercase ${party.currentDue > 0 ? "text-rose-600" : party.currentDue < 0 ? "text-emerald-600" : "text-slate-500"}`}>
                    {party.currentDue > 0 ? 'DR' : party.currentDue < 0 ? 'CR' : ''}
                  </span>
                </div>
                {currentUser?.isAdmin && (
                  <span className="inline-flex items-center gap-1 text-[9px] font-normal text-emerald-600 uppercase mt-0.5">
                    <span className="w-1 h-1 rounded-full bg-emerald-500"></span>
                    {party.status || 'ACTIVE'}
                  </span>
                )}
              </div>
            </div>
          ))}

          {filteredParties.length === 0 && (
            <div className="p-6 text-center text-slate-400 text-xs font-medium">
              No parties found matching your search or filters.
            </div>
          )}
        </div>

        {/* Footer: Pagination and count */}
        <div className="p-4 sm:p-5 border-t border-slate-100 flex flex-col sm:flex-row items-center justify-between gap-3 bg-white text-xs text-slate-500 font-medium">
          <div>
            Showing {filteredParties.length > 0 ? ((currentPage - 1) * ITEMS_PER_PAGE) + 1 : 0} to {Math.min(currentPage * ITEMS_PER_PAGE, filteredParties.length)} of {filteredParties.length} entries
          </div>

          <div className="flex items-center space-x-1.5">
            <button
              type="button"
              disabled={currentPage === 1}
              onClick={() => setCurrentPage(prev => Math.max(prev - 1, 1))}
              className="p-1.5 border border-slate-200 rounded-lg bg-white hover:bg-slate-50 text-slate-600 disabled:opacity-30 transition-colors"
            >
              <ChevronLeft size={16} />
            </button>
            
            {Array.from({ length: Math.max(totalPages, 1) }, (_, i) => i + 1).map((page) => (
              <button
                key={page}
                type="button"
                onClick={() => setCurrentPage(page)}
                className={`w-8 h-8 flex items-center justify-center text-xs font-semibold rounded-lg border transition-colors ${
                  currentPage === page
                    ? 'bg-blue-50/80 border-blue-200 text-[#0055a5]'
                    : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
                }`}
              >
                {page}
              </button>
            ))}

            <button
              type="button"
              disabled={currentPage === totalPages || totalPages === 0}
              onClick={() => setCurrentPage(prev => Math.min(prev + 1, totalPages))}
              className="p-1.5 border border-slate-200 rounded-lg bg-white hover:bg-slate-50 text-slate-600 disabled:opacity-30 transition-colors"
            >
              <ChevronRight size={16} />
            </button>
          </div>
        </div>

      </div>

      {/* Add Party Modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-150">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-md border border-slate-200 overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center bg-slate-50">
              <div className="flex items-center gap-2">
                <div className="p-1.5 bg-blue-50 text-blue-600 rounded-lg">
                  <UserPlus size={18} />
                </div>
                <div>
                  <h3 className="font-bold text-slate-900 text-sm">Add New Party Account</h3>
                  <p className="text-xs text-slate-500">Register a new customer or vendor in {activeLedger.name}</p>
                </div>
              </div>
              <button 
                type="button" 
                onClick={() => setShowAddModal(false)} 
                className="text-slate-400 hover:text-slate-600 p-1"
              >
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleAddSubmit} className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-700 mb-1.5">
                  Party / Company Name <span className="text-rose-500">*</span>
                </label>
                <input 
                  required 
                  type="text" 
                  value={addName} 
                  onChange={e => setAddName(e.target.value)} 
                  className="w-full px-3.5 py-2 text-sm bg-white border border-slate-300 rounded-lg text-slate-900 focus:border-blue-600" 
                  placeholder="e.g. Royal Bengal Foods" 
                />
              </div>

              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-700 mb-1.5">
                  Contact Phone Number
                </label>
                <input 
                  type="text" 
                  value={addPhone} 
                  onChange={e => setAddPhone(e.target.value)} 
                  className="w-full px-3.5 py-2 text-sm bg-white border border-slate-300 rounded-lg text-slate-900 font-mono focus:border-blue-600" 
                  placeholder="e.g. 9876543210" 
                />
              </div>

              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-700 mb-1.5">
                  Business Address
                </label>
                <input 
                  type="text" 
                  value={addAddress} 
                  onChange={e => setAddAddress(e.target.value)} 
                  className="w-full px-3.5 py-2 text-sm bg-white border border-slate-300 rounded-lg text-slate-900 focus:border-blue-600" 
                  placeholder="e.g. Plot 42, Food Park, Kolkata" 
                />
              </div>

              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-700 mb-1.5">
                  Email Address
                </label>
                <input 
                  type="email" 
                  value={addEmail} 
                  onChange={e => setAddEmail(e.target.value)} 
                  className="w-full px-3.5 py-2 text-sm bg-white border border-slate-300 rounded-lg text-slate-900 focus:border-blue-600" 
                  placeholder="e.g. accounts@royalbengalfoods.com" 
                />
              </div>

              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-700 mb-1.5">
                  Opening Balance (₹)
                </label>
                <input 
                  type="number" 
                  step="0.01" 
                  value={addOpeningBalance} 
                  onChange={e => setAddOpeningBalance(e.target.value)} 
                  className="w-full px-3.5 py-2 text-sm bg-white border border-slate-300 rounded-lg text-slate-900 font-mono focus:border-blue-600" 
                  placeholder="0.00 (Positive = Due Dr, Negative = Advance Cr)" 
                />
                <p className="text-[11px] text-slate-500 mt-1">
                  Enter positive value if party owes money (Debit Dr), negative for advance (Credit Cr).
                </p>
              </div>

              <div className="pt-4 border-t border-slate-100 flex items-center justify-end gap-2.5">
                <button 
                  type="button" 
                  disabled={isSubmitting} 
                  onClick={() => setShowAddModal(false)} 
                  className="px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
                >
                  Cancel
                </button>
                <button 
                  type="submit" 
                  disabled={isSubmitting} 
                  className="px-5 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded-lg shadow-xs transition-colors flex items-center gap-2 disabled:opacity-50"
                >
                  {isSubmitting ? (
                    <>
                      <Loader2 className="animate-spin" size={14} />
                      Saving...
                    </>
                  ) : (
                    'Save Party Account'
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Bulk CSV / Excel Import Modal */}
      <BulkImportPartiesModal
        isOpen={showImportModal}
        onClose={() => setShowImportModal(false)}
        ledgerId={activeLedger.id}
        ledgerName={activeLedger.name}
        ledgerType={activeLedger.type}
        existingParties={parties}
        onSuccess={handleImportSuccess}
      />

    </div>
  );
}
