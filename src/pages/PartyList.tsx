import React, { useState, useEffect } from 'react';
import { db, handleFirestoreError, OperationType, doc, setDoc } from '../firebase';
import { Party } from '../types';
import { Search, Plus, Upload, UserPlus, X, Loader2, ChevronLeft, ChevronRight } from 'lucide-react';
import { useAuth } from '../AuthContext';
import { useLedger } from '../LedgerContext';
import { v4 as uuidv4 } from 'uuid';
import { useNavigate } from 'react-router-dom';
import { syncCollection } from '../lib/syncCache';
import { getFilteredCacheItems, setCacheItem } from '../lib/idbCache';
import { updateDashboardPartiesCount } from '../lib/transactionService';
import { formatContactWith91 } from '../lib/phoneUtils';

const getInitials = (name: string) => {
  return name ? name.charAt(0).toUpperCase() : '?';
};

const formatRelativeTime = (timestamp: number) => {
  if (!timestamp) return 'No updates';
  const now = Date.now();
  const diffMs = now - timestamp;
  
  if (diffMs < 0) return 'Just now';
  
  const diffSecs = Math.floor(diffMs / 1000);
  const diffMins = Math.floor(diffSecs / 60);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);
  const diffWeeks = Math.floor(diffDays / 7);
  const diffMonths = Math.floor(diffDays / 30.44);
  const diffYears = Math.floor(diffDays / 365.25);

  if (diffSecs < 60) {
    return 'Just now';
  } else if (diffMins < 60) {
    return `${diffMins}m ago`;
  } else if (diffHours < 24) {
    return `${diffHours}h ago`;
  } else if (diffDays === 1) {
    return '1 day ago';
  } else if (diffDays < 7) {
    return `${diffDays} days ago`;
  } else if (diffWeeks === 1) {
    return '1 week ago';
  } else if (diffWeeks < 4) {
    return `${diffWeeks} weeks ago`;
  } else if (diffMonths === 1) {
    return '1 month ago';
  } else if (diffMonths < 12) {
    return `${diffMonths} months ago`;
  } else if (diffYears === 1) {
    return '1 yr ago';
  } else {
    return `${diffYears} yrs ago`;
  }
};

const getRandomBgColor = (name: string) => {
  const colors = [
    'bg-blue-50 text-blue-700 border-blue-100',
    'bg-emerald-50 text-emerald-700 border-emerald-100',
    'bg-amber-50 text-amber-700 border-amber-100',
    'bg-purple-50 text-purple-700 border-purple-100',
    'bg-rose-50 text-rose-700 border-rose-100',
    'bg-sky-50 text-sky-700 border-sky-100',
    'bg-indigo-50 text-indigo-700 border-indigo-100'
  ];
  let sum = 0;
  const safeName = name || '';
  for (let i = 0; i < safeName.length; i++) {
    sum += safeName.charCodeAt(i);
  }
  return colors[sum % colors.length];
};

export default function PartyList() {
  const { currentUser } = useAuth();
  const { activeLedger } = useLedger();
  const navigate = useNavigate();
  const [parties, setParties] = useState<Party[]>([]);
  const [search, setSearch] = useState('');
  const [sortOrder, setSortOrder] = useState<'none' | 'asc' | 'desc'>('none');
  const [showAddModal, setShowAddModal] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const ITEMS_PER_PAGE = 10;
  
  const [addName, setAddName] = useState('');
  const [addPhone, setAddPhone] = useState('');
  const [addAddress, setAddAddress] = useState('');
  const [addEmail, setAddEmail] = useState('');
  const [addOpeningBalance, setAddOpeningBalance] = useState('');

  const [showImportModal, setShowImportModal] = useState(false);
  const [importCsvContent, setImportCsvContent] = useState('');

  // Sync and load parties from cached IndexedDB
  const syncPartiesList = async () => {
    if (!activeLedger?.id) {
      setParties([]);
      return;
    }
    setIsLoading(true);
    try {
      await syncCollection<Party>('parties', activeLedger.id, 'parties');
      const cached = await getFilteredCacheItems<Party>('parties', p => p.ledgerId === activeLedger.id);
      setParties(cached);
    } catch (err) {
      console.error("Failed to sync parties:", err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    syncPartiesList();

    const handleSync = () => {
      syncPartiesList();
    };
    window.addEventListener('database-synced', handleSync);
    return () => {
      window.removeEventListener('database-synced', handleSync);
    };
  }, [activeLedger?.id]);

  useEffect(() => {
    setCurrentPage(1);
  }, [search, sortOrder, activeLedger?.id]);

  let filteredParties = parties.filter(p => {
    const q = (search || '').trim().toLowerCase();
    if (!q) return true;
    
    // Check if query is phone-based
    const phone = p.phone || '';
    if (phone.includes(q)) return true;

    const name = (p.name || '').toLowerCase();
    
    // Split search query by spaces to support multi-term search in any order
    const terms = q.split(/\s+/).filter(Boolean);
    if (terms.length === 0) return true;

    // A party matches if all search terms are present in the name
    const matchesAllTerms = terms.every(term => name.includes(term));
    if (matchesAllTerms) return true;

    // Check initials: e.g. "mj" matches "Madan Jana"
    const initials = name.split(/\s+/).map(w => w.charAt(0)).join('');
    if (initials.includes(q)) return true;

    return false;
  });

  if (sortOrder === 'none') {
    filteredParties.sort((a, b) => (b.lastTransaction || 0) - (a.lastTransaction || 0));
  } else if (sortOrder === 'asc') {
    filteredParties.sort((a, b) => a.currentDue - b.currentDue);
  } else if (sortOrder === 'desc') {
    filteredParties.sort((a, b) => b.currentDue - a.currentDue);
  }

  const handleAddSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting) return;
    if (!activeLedger?.id) return;
    setIsSubmitting(true);
    const id = uuidv4();
    const balance = parseFloat(addOpeningBalance) || 0;
    
    const newParty: Party = {
      id,
      ledgerId: activeLedger.id,
      name: addName,
      phone: formatContactWith91(addPhone),
      address: addAddress,
      email: addEmail.trim(),
      openingBalance: balance,
      currentDue: balance,
      lastTransaction: Date.now(),
      status: 'Active'
    };

    try {
      // 1. Update local UI state optimistically & close modal immediately
      const newList = [...parties, newParty];
      setParties(newList);
      setShowAddModal(false);
      setAddName('');
      setAddPhone('');
      setAddAddress('');
      setAddEmail('');
      setAddOpeningBalance('');
      setIsSubmitting(false);

      // 2. Save in local cache & Firestore in background
      setCacheItem<Party>('parties', newParty);
      setDoc(doc(db, 'parties', id), newParty);
      updateDashboardPartiesCount(activeLedger.id, 1);
      window.dispatchEvent(new CustomEvent('database-synced'));
    } catch (e) {
      handleFirestoreError(e, OperationType.CREATE, `parties/${id}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleImportSubmit = async () => {
    if (isSubmitting) return;
    if (!activeLedger?.id) return;
    setIsSubmitting(true);
    const lines = importCsvContent.split('\n');
    let addedCount = 0;
    const importedParties: Party[] = [];

    try {
      for (const line of lines) {
        if (!line.trim()) continue;
        const parts = line.split(',');
        const nameStr = parts[0]?.trim();
        const phoneStr = parts[1]?.trim() || '';
        const balanceStr = parts[2]?.trim() || '0';
        const emailStr = parts[3]?.trim() || '';
        
        if (nameStr) {
          const id = uuidv4();
          const balance = parseFloat(balanceStr) || 0;
          const newParty: Party = {
            id,
            ledgerId: activeLedger.id,
            name: nameStr,
            phone: formatContactWith91(phoneStr),
            address: '',
            email: emailStr,
            openingBalance: balance,
            currentDue: balance,
            lastTransaction: Date.now(),
            status: 'Active'
          };
          
          importedParties.push(newParty);
          addedCount++;
          
          // Write to Firestore & Cache
          await setDoc(doc(db, 'parties', id), newParty).catch(e => console.error(e));
          await setCacheItem<Party>('parties', newParty);
        }
      }

      if (addedCount > 0) {
        setParties([...parties, ...importedParties]);
        await updateDashboardPartiesCount(activeLedger.id, addedCount);
        window.dispatchEvent(new CustomEvent('database-synced'));
      }

      setShowImportModal(false);
      setImportCsvContent('');
    } catch (err) {
      console.error("Bulk import failed:", err);
    } finally {
      setIsSubmitting(false);
    }
  };

  const totalPages = Math.ceil(filteredParties.length / ITEMS_PER_PAGE);
  const paginatedParties = filteredParties.slice(
    (currentPage - 1) * ITEMS_PER_PAGE,
    currentPage * ITEMS_PER_PAGE
  );

  if (!activeLedger) return <div className="p-8 text-center text-gray-500">Please select a ledger.</div>;

  return (
    <div className="p-4 sm:p-8 max-w-7xl mx-auto w-full pb-24 sm:pb-8">
      {/* Modals */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md overflow-hidden">
            <div className="flex justify-between items-center p-4 border-b">
              <h3 className="font-semibold text-lg text-gray-900">Add New Party</h3>
              <button type="button" onClick={() => setShowAddModal(false)} className="text-gray-400 hover:text-gray-600"><X size={20}/></button>
            </div>
            <form onSubmit={handleAddSubmit} className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Name</label>
                <input required type="text" value={addName} onChange={e => setAddName(e.target.value)} className="w-full px-3 py-2 border rounded-md focus:border-sky-500 focus:ring-1 focus:ring-sky-500" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Phone</label>
                <input type="text" value={addPhone} onChange={e => setAddPhone(e.target.value)} className="w-full px-3 py-2 border rounded-md focus:border-sky-500 focus:ring-1 focus:ring-sky-500" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Address</label>
                <input type="text" value={addAddress} onChange={e => setAddAddress(e.target.value)} className="w-full px-3 py-2 border rounded-md focus:border-sky-500 focus:ring-1 focus:ring-sky-500" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
                <input type="email" value={addEmail} onChange={e => setAddEmail(e.target.value)} className="w-full px-3 py-2 border rounded-md focus:border-sky-500 focus:ring-1 focus:ring-sky-500" placeholder="e.g. client@example.com" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Opening Balance (Positive = Due to us, Negative = Advance)</label>
                <input type="number" step="0.01" value={addOpeningBalance} onChange={e => setAddOpeningBalance(e.target.value)} className="w-full px-3 py-2 border rounded-md focus:border-sky-500 focus:ring-1 focus:ring-sky-500" />
              </div>
              <div className="pt-4 flex justify-end">
                <button type="button" disabled={isSubmitting} onClick={() => setShowAddModal(false)} className="px-4 py-2 text-gray-600 mr-2 hover:bg-gray-50 rounded-md disabled:opacity-50">Cancel</button>
                <button type="submit" disabled={isSubmitting} className="px-4 py-2 bg-sky-600 text-white rounded-md hover:bg-sky-700 disabled:bg-sky-400 disabled:cursor-not-allowed flex items-center justify-center font-sans">
                  {isSubmitting ? (
                    <>
                      <Loader2 className="animate-spin mr-2" size={16} />
                      Saving...
                    </>
                  ) : (
                    'Save Party'
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showImportModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-lg overflow-hidden">
            <div className="flex justify-between items-center p-4 border-b">
              <h3 className="font-semibold text-lg text-gray-900">Bulk Import Parties</h3>
              <button type="button" onClick={() => setShowImportModal(false)} className="text-gray-400 hover:text-gray-600"><X size={20}/></button>
            </div>
            <div className="p-6">
              <p className="text-sm text-gray-500 mb-4">Paste CSV format: <code>Name,Phone,OpeningBalance,Email</code> (one per line. Email is optional)</p>
              <textarea
                className="w-full h-48 px-3 py-2 border rounded-md focus:border-sky-500 focus:ring-1 focus:ring-sky-500 font-mono text-sm"
                value={importCsvContent}
                onChange={e => setImportCsvContent(e.target.value)}
                placeholder="John Doe,1234567890,500.00,john@example.com&#10;Jane Smith,0987654321,-200.00,jane@example.com"
              ></textarea>
              <div className="mt-4 flex justify-end">
                <button type="button" disabled={isSubmitting} onClick={() => setShowImportModal(false)} className="px-4 py-2 text-gray-600 mr-2 hover:bg-gray-50 rounded-md disabled:opacity-50">Cancel</button>
                <button type="button" disabled={isSubmitting} onClick={handleImportSubmit} className="px-4 py-2 bg-sky-600 text-white rounded-md hover:bg-sky-700 disabled:bg-sky-400 disabled:cursor-not-allowed flex items-center justify-center font-sans">
                  {isSubmitting ? (
                    <>
                      <Loader2 className="animate-spin mr-2" size={16} />
                      Importing...
                    </>
                  ) : (
                    'Import'
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Compact & Handy Header Section */}
      <div className="flex items-center justify-between mb-4 gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl sm:text-2xl font-bold text-gray-950 tracking-tight">
              Parties
            </h1>
            <span className="px-1.5 py-0.5 bg-gray-100 text-gray-600 rounded text-[10px] sm:text-xs font-semibold font-mono">
              {parties.length}
            </span>
            {isLoading && <Loader2 className="animate-spin text-gray-400 shrink-0" size={16} />}
          </div>
          <p className="text-[11px] sm:text-xs text-gray-500 mt-0.5 leading-tight truncate max-w-[180px] sm:max-w-none">
            Manage customers & suppliers in {activeLedger.name}
          </p>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {currentUser?.isAdmin && (
            <button 
              type="button" 
              onClick={() => setShowImportModal(true)} 
              className="inline-flex items-center justify-center p-1.5 sm:px-3 sm:py-1.5 bg-white border border-gray-200 text-gray-700 rounded-lg text-xs font-medium hover:bg-gray-50 transition-all active:scale-95 shadow-sm"
              title="Import Parties"
            >
              <Upload size={14} className="sm:mr-1.5" />
              <span className="hidden sm:inline">Import</span>
            </button>
          )}
          <button 
            type="button" 
            onClick={() => setShowAddModal(true)} 
            className="inline-flex items-center justify-center px-3 py-1.5 bg-sky-600 hover:bg-sky-700 text-white rounded-lg text-xs font-medium transition-all active:scale-95 shadow-sm shadow-sky-100"
          >
            <UserPlus size={14} className="mr-1" />
            <span>Add Party</span>
          </button>
        </div>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        {/* Streamlined Search and Filter Controls */}
        <div className="p-3 border-b border-gray-100 flex flex-col sm:flex-row gap-3 items-center justify-between bg-gray-50/30">
          <div className="relative w-full sm:max-w-xs md:max-w-md border border-gray-200 bg-white rounded-lg flex items-center px-2.5 shadow-xs focus-within:border-sky-500 focus-within:ring-1 focus-within:ring-sky-500/50 transition-all">
            <Search size={16} className="text-gray-400 shrink-0" />
            <input 
              type="text" 
              placeholder="Search by name or phone..." 
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full py-1.5 ml-2 bg-transparent focus:outline-none text-xs sm:text-sm text-gray-800 placeholder-gray-400"
            />
            {search && (
              <button 
                type="button" 
                onClick={() => setSearch('')} 
                className="text-gray-400 hover:text-gray-600 shrink-0"
              >
                <X size={14} />
              </button>
            )}
          </div>
          <div className="flex items-center gap-2 w-full sm:w-auto justify-between sm:justify-start shrink-0 border-t sm:border-t-0 pt-2 sm:pt-0 border-gray-50">
            <span className="text-xs text-gray-500 font-medium whitespace-nowrap">Sort:</span>
            <select
              value={sortOrder}
              onChange={e => setSortOrder(e.target.value as 'none' | 'asc' | 'desc')}
              className="border border-gray-200 rounded-lg px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-sky-500 bg-white text-gray-700 font-medium"
            >
              <option value="none">Recently Updated</option>
              <option value="asc">Due Amount (Low to High)</option>
              <option value="desc">Due Amount (High to Low)</option>
            </select>
          </div>
        </div>

        {/* Desktop View Table */}
        <div className="hidden md:block overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-white border-b text-xs uppercase tracking-wider text-gray-500">
                <th className="p-4 font-medium">Party Name</th>
                <th className="p-4 font-medium">Contact</th>
                <th className="p-4 font-medium text-right">Current Balance</th>
                <th className="p-4 font-medium text-center">Status</th>
              </tr>
            </thead>
            <tbody className="align-middle">
              {paginatedParties.map((party) => (
                <tr 
                  key={party.id} 
                  onClick={() => navigate(`/parties/${party.id}`)}
                  className="border-b border-gray-50 hover:bg-gray-50 cursor-pointer transition-colors"
                >
                  <td className="p-4">
                    <div className="font-bold text-gray-950 text-sm">{party.name}</div>
                    <div className="text-[11px] text-gray-400 font-medium mt-0.5">
                      Last update: {formatRelativeTime(party.lastTransaction)}
                    </div>
                    {party.phone && (
                      <div className="text-xs text-gray-500 lg:hidden mt-0.5 font-mono">{party.phone}</div>
                    )}
                    {currentUser?.isAdmin && (
                      <div className="text-xs text-slate-400 font-mono mt-1 select-all" onClick={(e) => e.stopPropagation()}>
                        ID: {party.id}
                      </div>
                    )}
                  </td>
                  <td className="p-4 text-sm text-gray-600 hidden lg:table-cell">{party.phone}</td>
                  <td className="p-4 text-right">
                    <div className={`font-semibold ${party.currentDue > 0 ? 'text-red-600' : party.currentDue < 0 ? 'text-green-600' : 'text-gray-600'}`}>
                      {party.currentDue > 0 ? (
                        <>-₹{Math.abs(party.currentDue).toLocaleString(undefined, {minimumFractionDigits:2})}</>
                      ) : party.currentDue < 0 ? (
                        <>₹ {Math.abs(party.currentDue).toLocaleString(undefined, {minimumFractionDigits:2})}</>
                      ) : (
                        <>₹ 0.00</>
                      )
                    }
                    </div>
                  </td>
                  <td className="p-4 text-center">
                    <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-800">
                      {party.status}
                    </span>
                  </td>
                </tr>
              ))}
              {filteredParties.length === 0 && (
                <tr>
                  <td colSpan={4} className="p-8 text-center text-sm text-gray-500">
                    No parties found matching your search.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Mobile View Card List */}
        <div className="block md:hidden divide-y divide-gray-100 bg-white">
          {paginatedParties.map((party) => {
            const bgClass = getRandomBgColor(party.name);
            return (
              <div 
                key={party.id} 
                onClick={() => navigate(`/parties/${party.id}`)}
                className="p-3.5 hover:bg-gray-50/45 active:bg-gray-50 transition-colors flex items-center justify-between gap-3 text-sm cursor-pointer"
              >
                <div className="flex items-center gap-3 min-w-0">
                  {/* Circular initials badge */}
                  <div className={`w-9 h-9 rounded-full flex items-center justify-center font-bold text-xs uppercase border shrink-0 ${bgClass}`}>
                    {getInitials(party.name)}
                  </div>

                  {/* Party Name & Phone */}
                  <div className="min-w-0">
                    <h4 className="font-semibold text-gray-950 text-xs sm:text-sm truncate">{party.name}</h4>
                    <div className="flex items-center gap-1.5 flex-wrap mt-0.5">
                      {party.phone ? (
                        <p className="text-[11px] text-gray-500 font-mono">{party.phone}</p>
                      ) : (
                        <p className="text-[11px] text-gray-400 italic">No contact</p>
                      )}
                      <span className="text-[10px] text-gray-300">•</span>
                      <p className="text-[11px] text-gray-400 font-medium">
                        {formatRelativeTime(party.lastTransaction)}
                      </p>
                    </div>
                  </div>
                </div>

                {/* Balance */}
                <div className="text-right shrink-0">
                  <span className="text-[8px] uppercase font-bold tracking-wider leading-none block mb-1 text-gray-400">
                    Balance
                  </span>
                  <div className={`font-extrabold text-xs sm:text-sm ${party.currentDue > 0 ? 'text-red-600' : party.currentDue < 0 ? 'text-emerald-600' : 'text-gray-500'}`}>
                    {party.currentDue > 0 ? (
                      <>-₹{Math.abs(party.currentDue).toLocaleString(undefined, {minimumFractionDigits: 2})}</>
                    ) : party.currentDue < 0 ? (
                      <>₹ {Math.abs(party.currentDue).toLocaleString(undefined, {minimumFractionDigits: 2})}</>
                    ) : (
                      <>₹ 0.00</>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
          {filteredParties.length === 0 && (
            <div className="p-8 text-center text-sm text-gray-500">
              No parties found matching your search.
            </div>
          )}
        </div>

        {totalPages > 1 && (
          <div className="p-4 border-t border-gray-100 flex flex-col sm:flex-row items-center justify-between bg-gray-50/50 gap-4">
            <div className="text-sm text-gray-500">
              Showing <span className="font-medium">{((currentPage - 1) * ITEMS_PER_PAGE) + 1}</span> to{' '}
              <span className="font-medium">{Math.min(currentPage * ITEMS_PER_PAGE, filteredParties.length)}</span> of{' '}
              <span className="font-medium">{filteredParties.length}</span> parties
            </div>
            <div className="flex items-center space-x-1">
              <button
                type="button"
                disabled={currentPage === 1}
                onClick={() => setCurrentPage(prev => Math.max(prev - 1, 1))}
                className="p-2 border border-gray-200 rounded-md hover:bg-white text-gray-600 disabled:opacity-50 disabled:hover:bg-transparent transition-colors"
              >
                <ChevronLeft size={16} />
              </button>
              
              {Array.from({ length: totalPages }, (_, i) => i + 1).map((page) => (
                <button
                  key={page}
                  type="button"
                  onClick={() => setCurrentPage(page)}
                  className={`px-3 py-1.5 text-sm font-medium rounded-md border transition-colors ${
                    currentPage === page
                      ? 'bg-sky-600 border-sky-600 text-white'
                      : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'
                  }`}
                >
                  {page}
                </button>
              ))}

              <button
                type="button"
                disabled={currentPage === totalPages}
                onClick={() => setCurrentPage(prev => Math.min(prev + 1, totalPages))}
                className="p-2 border border-gray-200 rounded-md hover:bg-white text-gray-600 disabled:opacity-50 disabled:hover:bg-transparent transition-colors"
              >
                <ChevronRight size={16} />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
