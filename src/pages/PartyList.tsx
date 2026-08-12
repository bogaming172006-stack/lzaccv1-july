import React, { useState, useEffect } from 'react';
import { db, handleFirestoreError, OperationType, doc, setDoc, deleteDoc } from '../firebase';
import { Party } from '../types';
import { Search, Plus, Upload, X, Loader2, BookOpen, Edit2, Trash2 } from 'lucide-react';
import { useAuth } from '../AuthContext';
import { useLedger } from '../LedgerContext';
import { v4 as uuidv4 } from 'uuid';
import { useNavigate } from 'react-router-dom';
import { syncCollection } from '../lib/syncCache';
import { getFilteredCacheItems, setCacheItem, deleteCacheItem } from '../lib/idbCache';
import { updateDashboardPartiesCount } from '../lib/transactionService';
import { formatContactWith91 } from '../lib/phoneUtils';

export default function PartyList() {
  const { currentUser } = useAuth();
  const { activeLedger } = useLedger();
  const navigate = useNavigate();
  const [parties, setParties] = useState<Party[]>([]);
  const [search, setSearch] = useState('');
  const [itemsPerPage, setItemsPerPage] = useState<number>(10);
  const [currentPage, setCurrentPage] = useState(1);
  const [sortBy, setSortBy] = useState<'recent' | 'balance_high' | 'balance_low' | 'name_asc' | 'name_desc'>('recent');
  const [isLoading, setIsLoading] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Modals state
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingParty, setEditingParty] = useState<Party | null>(null);
  const [deletingParty, setDeletingParty] = useState<Party | null>(null);
  const [showImportModal, setShowImportModal] = useState(false);

  // Add / Edit form fields
  const [formName, setFormName] = useState('');
  const [formPhone, setFormPhone] = useState('');
  const [formAddress, setFormAddress] = useState('');
  const [formEmail, setFormEmail] = useState('');
  const [formOpeningBalance, setFormOpeningBalance] = useState('');
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
  }, [search, itemsPerPage, activeLedger?.id]);

  // Open Edit modal
  const handleOpenEdit = (party: Party, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingParty(party);
    setFormName(party.name || '');
    setFormPhone(party.phone || '');
    setFormAddress(party.address || '');
    setFormEmail(party.email || '');
    setFormOpeningBalance(party.openingBalance?.toString() || '0');
  };

  // Open Delete modal
  const handleOpenDelete = (party: Party, e: React.MouseEvent) => {
    e.stopPropagation();
    setDeletingParty(party);
  };

  // Submit Add Party
  const handleAddSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting || !activeLedger?.id) return;
    setIsSubmitting(true);
    const id = uuidv4();
    const balance = parseFloat(formOpeningBalance) || 0;
    
    const newParty: Party = {
      id,
      ledgerId: activeLedger.id,
      name: formName.trim(),
      phone: formatContactWith91(formPhone),
      address: formAddress.trim(),
      email: formEmail.trim(),
      openingBalance: balance,
      currentDue: balance,
      lastTransaction: Date.now(),
      status: 'Active'
    };

    try {
      setParties(prev => [...prev, newParty]);
      setShowAddModal(false);
      resetForm();
      setIsSubmitting(false);

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

  // Submit Edit Party
  const handleEditSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting || !editingParty || !activeLedger?.id) return;
    setIsSubmitting(true);

    const balance = parseFloat(formOpeningBalance) || 0;
    const balanceDiff = balance - (editingParty.openingBalance || 0);

    const updatedParty: Party = {
      ...editingParty,
      name: formName.trim(),
      phone: formatContactWith91(formPhone),
      address: formAddress.trim(),
      email: formEmail.trim(),
      openingBalance: balance,
      currentDue: (editingParty.currentDue || 0) + balanceDiff,
      lastTransaction: Date.now()
    };

    try {
      setParties(prev => prev.map(p => p.id === editingParty.id ? updatedParty : p));
      setEditingParty(null);
      resetForm();
      setIsSubmitting(false);

      await setCacheItem<Party>('parties', updatedParty);
      await setDoc(doc(db, 'parties', editingParty.id), updatedParty);
      window.dispatchEvent(new CustomEvent('database-synced'));
    } catch (e) {
      handleFirestoreError(e, OperationType.UPDATE, `parties/${editingParty.id}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  // Confirm Delete Party
  const handleDeleteConfirm = async () => {
    if (!deletingParty || isSubmitting || !activeLedger?.id) return;
    setIsSubmitting(true);
    const partyId = deletingParty.id;

    try {
      setParties(prev => prev.filter(p => p.id !== partyId));
      setDeletingParty(null);
      setIsSubmitting(false);

      await deleteCacheItem('parties', partyId);
      await deleteDoc(doc(db, 'parties', partyId));
      await updateDashboardPartiesCount(activeLedger.id, -1);
      window.dispatchEvent(new CustomEvent('database-synced'));
    } catch (e) {
      handleFirestoreError(e, OperationType.DELETE, `parties/${partyId}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  const resetForm = () => {
    setFormName('');
    setFormPhone('');
    setFormAddress('');
    setFormEmail('');
    setFormOpeningBalance('');
  };

  // Bulk Import Submit
  const handleImportSubmit = async () => {
    if (isSubmitting || !activeLedger?.id) return;
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
          
          await setDoc(doc(db, 'parties', id), newParty).catch(e => console.error(e));
          await setCacheItem<Party>('parties', newParty);
        }
      }

      if (addedCount > 0) {
        setParties(prev => [...prev, ...importedParties]);
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

  // Filter, Search & Sorting Logic
  const filteredParties = parties
    .filter(p => {
      const q = (search || '').trim().toLowerCase();
      if (!q) return true;
      if ((p.phone || '').toLowerCase().includes(q)) return true;
      if ((p.name || '').toLowerCase().includes(q)) return true;
      if ((p.email || '').toLowerCase().includes(q)) return true;
      return false;
    })
    .sort((a, b) => {
      if (sortBy === 'recent') {
        const timeA = a.lastTransaction || 0;
        const timeB = b.lastTransaction || 0;
        if (timeB !== timeA) return timeB - timeA;
        return (a.name || '').localeCompare(b.name || '');
      } else if (sortBy === 'balance_high') {
        const balA = a.currentDue || 0;
        const balB = b.currentDue || 0;
        if (balB !== balA) return balB - balA;
        return (a.name || '').localeCompare(b.name || '');
      } else if (sortBy === 'balance_low') {
        const balA = a.currentDue || 0;
        const balB = b.currentDue || 0;
        if (balA !== balB) return balA - balB;
        return (a.name || '').localeCompare(b.name || '');
      } else if (sortBy === 'name_asc') {
        return (a.name || '').localeCompare(b.name || '');
      } else if (sortBy === 'name_desc') {
        return (b.name || '').localeCompare(a.name || '');
      }
      return 0;
    });

  const totalPages = Math.ceil(filteredParties.length / itemsPerPage) || 1;
  const paginatedParties = filteredParties.slice(
    (currentPage - 1) * itemsPerPage,
    currentPage * itemsPerPage
  );

  const getPageNumbers = () => {
    const pages: (number | string)[] = [];
    if (totalPages <= 7) {
      for (let i = 1; i <= totalPages; i++) pages.push(i);
    } else {
      pages.push(1);
      if (currentPage > 3) pages.push('...');
      const start = Math.max(2, currentPage - 1);
      const end = Math.min(totalPages - 1, currentPage + 1);
      for (let i = start; i <= end; i++) pages.push(i);
      if (currentPage < totalPages - 2) pages.push('...');
      pages.push(totalPages);
    }
    return pages;
  };

  if (!activeLedger) {
    return <div className="p-8 text-center text-gray-500 font-normal text-sm">Please select a ledger.</div>;
  }

  return (
    <div className="p-4 sm:p-6 max-w-7xl mx-auto w-full font-sans text-gray-800">
      
      {/* Top Header & Breadcrumbs matching reference image */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between mb-6 gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-normal text-gray-900 tracking-tight">
            Manage Accounts
          </h1>
          <p className="text-xs text-gray-500 font-normal mt-0.5">
            Dashboard &gt; Accounts &gt; Manage Accounts ({activeLedger.name})
          </p>
        </div>

        <div className="flex items-center gap-2">
          {currentUser?.isAdmin && (
            <button 
              type="button" 
              onClick={() => setShowImportModal(true)} 
              className="inline-flex items-center justify-center px-3 py-1.5 bg-white border border-gray-300 text-gray-700 rounded-md text-xs font-normal hover:bg-gray-50 transition-all cursor-pointer"
            >
              <Upload size={14} className="mr-1.5 text-gray-500" />
              <span>Import</span>
            </button>
          )}
          <button 
            type="button" 
            onClick={() => { resetForm(); setShowAddModal(true); }} 
            className="inline-flex items-center justify-center px-3 py-1.5 bg-white border border-gray-300 text-gray-900 hover:bg-gray-50 rounded-md text-xs font-normal transition-all cursor-pointer shadow-2xs"
          >
            <Plus size={15} className="mr-1 text-gray-700" />
            <span>Add Account</span>
          </button>
        </div>
      </div>

      {/* Main Table Card Container */}
      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden shadow-2xs">
        
        {/* Top Control Bar: Entries per page + Sort filter + Search */}
        <div className="p-3 border-b border-gray-200 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 text-xs font-normal text-gray-700 bg-white">
          
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-1.5">
              <span>Show</span>
              <select
                value={itemsPerPage}
                onChange={e => {
                  setItemsPerPage(Number(e.target.value));
                  setCurrentPage(1);
                }}
                className="border border-gray-300 rounded px-2 py-1 bg-white focus:outline-none focus:border-sky-500 font-normal text-xs cursor-pointer text-gray-800"
              >
                <option value={10}>10</option>
                <option value={25}>25</option>
                <option value={50}>50</option>
                <option value={100}>100</option>
              </select>
              <span>entries</span>
            </div>

            <div className="flex items-center gap-1.5 border-l border-gray-200 pl-3">
              <span className="text-gray-500">Sort by:</span>
              <select
                value={sortBy}
                onChange={e => {
                  setSortBy(e.target.value as any);
                  setCurrentPage(1);
                }}
                className="border border-gray-300 rounded px-2.5 py-1 bg-white focus:outline-none focus:border-sky-500 font-normal text-xs cursor-pointer text-gray-900"
              >
                <option value="recent">Recent Activity First</option>
                <option value="balance_high">Balance: High to Low (Due)</option>
                <option value="balance_low">Balance: Low to High (Advance)</option>
                <option value="name_asc">Title: A to Z</option>
                <option value="name_desc">Title: Z to A</option>
              </select>
            </div>
          </div>

          <div className="relative w-full sm:w-64">
            <input 
              type="text" 
              placeholder="Search accounts..." 
              value={search}
              onChange={e => {
                setSearch(e.target.value);
                setCurrentPage(1);
              }}
              className="w-full pl-3 pr-8 py-1.5 border border-gray-300 rounded focus:outline-none focus:border-sky-500 text-xs font-normal text-gray-800 placeholder-gray-400"
            />
            <Search size={14} className="absolute right-2.5 top-2 text-gray-400 pointer-events-none" />
          </div>

        </div>

        {/* High-density, clean Table Grid */}
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs font-normal">
            <thead>
              <tr className="bg-white border-b border-gray-200 text-gray-900 font-normal select-none">
                <th className="p-3 border-r border-gray-200 font-normal w-12 text-center">
                  <span>ID</span>
                </th>
                <th className="p-3 border-r border-gray-200 font-normal">
                  <span>Account Number</span>
                </th>
                <th 
                  onClick={() => {
                    setSortBy(prev => prev === 'name_asc' ? 'name_desc' : 'name_asc');
                    setCurrentPage(1);
                  }}
                  className="p-3 border-r border-gray-200 font-normal cursor-pointer hover:bg-gray-50 transition-colors"
                  title="Click to sort by Title"
                >
                  <span className={sortBy.startsWith('name') ? 'font-semibold text-sky-700' : ''}>Title</span>
                </th>
                <th className="p-3 border-r border-gray-200 font-normal">
                  <span>Type</span>
                </th>
                <th className="p-3 border-r border-gray-200 font-normal">
                  <span>Group</span>
                </th>
                <th 
                  onClick={() => {
                    setSortBy(prev => prev === 'balance_high' ? 'balance_low' : 'balance_high');
                    setCurrentPage(1);
                  }}
                  className="p-3 border-r border-gray-200 font-normal text-right cursor-pointer hover:bg-gray-50 transition-colors"
                  title="Click to sort by Closing Balance"
                >
                  <span className={sortBy.startsWith('balance') ? 'font-semibold text-sky-700' : ''}>Closing</span>
                </th>
                <th className="p-3 border-r border-gray-200 font-normal text-center w-28">
                  <span>Ledger</span>
                </th>
                <th className="p-3 font-normal text-center w-24">
                  <span>Actions</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 bg-white">
              {paginatedParties.map((party, idx) => {
                const rowNum = (currentPage - 1) * itemsPerPage + idx + 1;
                const isDue = party.currentDue > 0;
                const isAdvance = party.currentDue < 0;

                return (
                  <tr 
                    key={party.id}
                    onClick={() => navigate(`/parties/${party.id}`)}
                    className="hover:bg-gray-50/80 cursor-pointer transition-colors"
                  >
                    {/* ID */}
                    <td className="p-3 border-r border-gray-200 text-center text-gray-600 font-normal">
                      {rowNum}
                    </td>

                    {/* Account Number / Phone */}
                    <td className="p-3 border-r border-gray-200 text-gray-800 font-normal">
                      {party.phone || '-'}
                    </td>

                    {/* Title / Party Name */}
                    <td className="p-3 border-r border-gray-200 text-gray-900 font-normal">
                      {party.name}
                    </td>

                    {/* Type */}
                    <td className="p-3 border-r border-gray-200 text-gray-600 font-normal">
                      Customer
                    </td>

                    {/* Group */}
                    <td className="p-3 border-r border-gray-200 text-gray-500 font-normal">
                      {party.email || party.address || '-'}
                    </td>

                    {/* Closing Balance */}
                    <td className={`p-3 border-r border-gray-200 text-right font-normal ${
                      isDue ? 'text-rose-600' : isAdvance ? 'text-emerald-600' : 'text-gray-800'
                    }`}>
                      {isDue ? (
                        <>-{Math.abs(party.currentDue).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</>
                      ) : (
                        <>{party.currentDue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</>
                      )}
                    </td>

                    {/* Ledger button matching reference image */}
                    <td className="p-2 border-r border-gray-200 text-center">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          navigate(`/parties/${party.id}`);
                        }}
                        className="inline-flex items-center gap-1 px-2.5 py-1 bg-white hover:bg-gray-100 border border-gray-300 rounded text-[11px] font-normal text-gray-800 transition-all cursor-pointer shadow-2xs"
                      >
                        <BookOpen size={12} className="text-gray-600" />
                        <span>Ledger</span>
                      </button>
                    </td>

                    {/* Actions */}
                    <td className="p-2 text-center" onClick={e => e.stopPropagation()}>
                      <div className="flex items-center justify-center gap-1">
                        <button
                          type="button"
                          onClick={(e) => handleOpenEdit(party, e)}
                          className="p-1.5 text-gray-600 hover:text-sky-600 hover:bg-sky-50 rounded border border-gray-200 transition-colors cursor-pointer"
                          title="Edit Account"
                        >
                          <Edit2 size={13} />
                        </button>
                        <button
                          type="button"
                          onClick={(e) => handleOpenDelete(party, e)}
                          className="p-1.5 text-gray-600 hover:text-rose-600 hover:bg-rose-50 rounded border border-gray-200 transition-colors cursor-pointer"
                          title="Delete Account"
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}

              {filteredParties.length === 0 && (
                <tr>
                  <td colSpan={8} className="p-8 text-center text-gray-400 font-normal text-xs">
                    No accounts or parties found matching your search.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Bottom Pagination Footer */}
        <div className="p-3 border-t border-gray-200 flex flex-col sm:flex-row items-center justify-between gap-3 bg-white text-xs font-normal text-gray-600">
          <div>
            Showing {filteredParties.length === 0 ? 0 : (currentPage - 1) * itemsPerPage + 1} to {Math.min(currentPage * itemsPerPage, filteredParties.length)} of {filteredParties.length} entries
          </div>

          <div className="flex items-center gap-1">
            <button
              type="button"
              disabled={currentPage === 1}
              onClick={() => setCurrentPage(prev => Math.max(prev - 1, 1))}
              className="px-2.5 py-1 border border-gray-300 rounded bg-white hover:bg-gray-50 disabled:opacity-40 disabled:hover:bg-white text-gray-700 font-normal transition-colors cursor-pointer"
            >
              Previous
            </button>

            {getPageNumbers().map((page, i) =>
              typeof page === 'number' ? (
                <button
                  key={page}
                  type="button"
                  onClick={() => setCurrentPage(page)}
                  className={`px-3 py-1 rounded text-xs font-normal border transition-colors cursor-pointer ${
                    currentPage === page
                      ? 'bg-black text-white border-black font-normal'
                      : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
                  }`}
                >
                  {page}
                </button>
              ) : (
                <span key={`ellipsis-${i}`} className="px-1 py-1 text-xs text-gray-400 font-normal select-none">
                  ...
                </span>
              )
            )}

            <button
              type="button"
              disabled={currentPage === totalPages || totalPages === 0}
              onClick={() => setCurrentPage(prev => Math.min(prev + 1, totalPages))}
              className="px-2.5 py-1 border border-gray-300 rounded bg-white hover:bg-gray-50 disabled:opacity-40 disabled:hover:bg-white text-gray-700 font-normal transition-colors cursor-pointer"
            >
              Next
            </button>
          </div>
        </div>

      </div>

      {/* Add Account Modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-xs">
          <div className="bg-white rounded-lg shadow-lg w-full max-w-md overflow-hidden text-xs border border-gray-200">
            <div className="flex justify-between items-center p-3.5 border-b border-gray-200 bg-gray-50">
              <h3 className="font-normal text-sm text-gray-900">Add New Account / Party</h3>
              <button type="button" onClick={() => setShowAddModal(false)} className="text-gray-400 hover:text-gray-600"><X size={16}/></button>
            </div>
            <form onSubmit={handleAddSubmit} className="p-4 space-y-3 font-normal">
              <div>
                <label className="block text-gray-700 mb-1 font-normal">Party Name / Title</label>
                <input required type="text" value={formName} onChange={e => setFormName(e.target.value)} className="w-full px-2.5 py-1.5 border border-gray-300 rounded focus:border-sky-500 focus:outline-none" />
              </div>
              <div>
                <label className="block text-gray-700 mb-1 font-normal">Account Number / Phone</label>
                <input type="text" value={formPhone} onChange={e => setFormPhone(e.target.value)} className="w-full px-2.5 py-1.5 border border-gray-300 rounded focus:border-sky-500 focus:outline-none" />
              </div>
              <div>
                <label className="block text-gray-700 mb-1 font-normal">Email</label>
                <input type="email" value={formEmail} onChange={e => setFormEmail(e.target.value)} className="w-full px-2.5 py-1.5 border border-gray-300 rounded focus:border-sky-500 focus:outline-none" placeholder="client@example.com" />
              </div>
              <div>
                <label className="block text-gray-700 mb-1 font-normal">Address / Group Notes</label>
                <input type="text" value={formAddress} onChange={e => setFormAddress(e.target.value)} className="w-full px-2.5 py-1.5 border border-gray-300 rounded focus:border-sky-500 focus:outline-none" />
              </div>
              <div>
                <label className="block text-gray-700 mb-1 font-normal">Opening Balance (Positive = Due to us, Negative = Advance)</label>
                <input type="number" step="0.01" value={formOpeningBalance} onChange={e => setFormOpeningBalance(e.target.value)} className="w-full px-2.5 py-1.5 border border-gray-300 rounded focus:border-sky-500 focus:outline-none" />
              </div>
              <div className="pt-2 flex justify-end gap-2 border-t border-gray-100">
                <button type="button" disabled={isSubmitting} onClick={() => setShowAddModal(false)} className="px-3 py-1.5 text-gray-600 hover:bg-gray-100 rounded">Cancel</button>
                <button type="submit" disabled={isSubmitting} className="px-4 py-1.5 bg-black text-white rounded hover:bg-gray-800 disabled:opacity-50 flex items-center justify-center cursor-pointer">
                  {isSubmitting ? <Loader2 className="animate-spin mr-1.5" size={14} /> : null}
                  Save Account
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit Account Modal */}
      {editingParty && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-xs">
          <div className="bg-white rounded-lg shadow-lg w-full max-w-md overflow-hidden text-xs border border-gray-200">
            <div className="flex justify-between items-center p-3.5 border-b border-gray-200 bg-gray-50">
              <h3 className="font-normal text-sm text-gray-900">Edit Account / Party</h3>
              <button type="button" onClick={() => setEditingParty(null)} className="text-gray-400 hover:text-gray-600"><X size={16}/></button>
            </div>
            <form onSubmit={handleEditSubmit} className="p-4 space-y-3 font-normal">
              <div>
                <label className="block text-gray-700 mb-1 font-normal">Party Name / Title</label>
                <input required type="text" value={formName} onChange={e => setFormName(e.target.value)} className="w-full px-2.5 py-1.5 border border-gray-300 rounded focus:border-sky-500 focus:outline-none" />
              </div>
              <div>
                <label className="block text-gray-700 mb-1 font-normal">Account Number / Phone</label>
                <input type="text" value={formPhone} onChange={e => setFormPhone(e.target.value)} className="w-full px-2.5 py-1.5 border border-gray-300 rounded focus:border-sky-500 focus:outline-none" />
              </div>
              <div>
                <label className="block text-gray-700 mb-1 font-normal">Email</label>
                <input type="email" value={formEmail} onChange={e => setFormEmail(e.target.value)} className="w-full px-2.5 py-1.5 border border-gray-300 rounded focus:border-sky-500 focus:outline-none" />
              </div>
              <div>
                <label className="block text-gray-700 mb-1 font-normal">Address / Group Notes</label>
                <input type="text" value={formAddress} onChange={e => setFormAddress(e.target.value)} className="w-full px-2.5 py-1.5 border border-gray-300 rounded focus:border-sky-500 focus:outline-none" />
              </div>
              <div>
                <label className="block text-gray-700 mb-1 font-normal">Opening Balance</label>
                <input type="number" step="0.01" value={formOpeningBalance} onChange={e => setFormOpeningBalance(e.target.value)} className="w-full px-2.5 py-1.5 border border-gray-300 rounded focus:border-sky-500 focus:outline-none" />
              </div>
              <div className="pt-2 flex justify-end gap-2 border-t border-gray-100">
                <button type="button" disabled={isSubmitting} onClick={() => setEditingParty(null)} className="px-3 py-1.5 text-gray-600 hover:bg-gray-100 rounded">Cancel</button>
                <button type="submit" disabled={isSubmitting} className="px-4 py-1.5 bg-sky-600 text-white rounded hover:bg-sky-700 disabled:opacity-50 flex items-center justify-center cursor-pointer">
                  {isSubmitting ? <Loader2 className="animate-spin mr-1.5" size={14} /> : null}
                  Update Account
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {deletingParty && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-xs">
          <div className="bg-white rounded-lg shadow-lg w-full max-w-sm overflow-hidden text-xs border border-gray-200 p-4 font-normal">
            <h3 className="text-sm font-normal text-gray-900 mb-2">Delete Account</h3>
            <p className="text-gray-600 mb-4 font-normal">
              Are you sure you want to delete <span className="font-normal text-gray-900">{deletingParty.name}</span>? This action cannot be undone.
            </p>
            <div className="flex justify-end gap-2">
              <button type="button" disabled={isSubmitting} onClick={() => setDeletingParty(null)} className="px-3 py-1.5 text-gray-600 hover:bg-gray-100 rounded">
                Cancel
              </button>
              <button type="button" disabled={isSubmitting} onClick={handleDeleteConfirm} className="px-3 py-1.5 bg-rose-600 text-white rounded hover:bg-rose-700 disabled:opacity-50 flex items-center justify-center">
                {isSubmitting ? <Loader2 className="animate-spin mr-1.5" size={14} /> : null}
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Bulk Import Modal */}
      {showImportModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-xs">
          <div className="bg-white rounded-lg shadow-lg w-full max-w-lg overflow-hidden text-xs border border-gray-200">
            <div className="flex justify-between items-center p-3.5 border-b border-gray-200 bg-gray-50">
              <h3 className="font-normal text-sm text-gray-900">Bulk Import Accounts</h3>
              <button type="button" onClick={() => setShowImportModal(false)} className="text-gray-400 hover:text-gray-600"><X size={16}/></button>
            </div>
            <div className="p-4 space-y-3 font-normal">
              <p className="text-gray-500">Paste CSV format: <code>Name,Phone,OpeningBalance,Email</code> (one per line)</p>
              <textarea
                className="w-full h-40 p-2.5 border border-gray-300 rounded font-mono focus:border-sky-500 focus:outline-none"
                value={importCsvContent}
                onChange={e => setImportCsvContent(e.target.value)}
                placeholder="John Doe,1234567890,500.00,john@example.com"
              ></textarea>
              <div className="flex justify-end gap-2 pt-2 border-t border-gray-100">
                <button type="button" disabled={isSubmitting} onClick={() => setShowImportModal(false)} className="px-3 py-1.5 text-gray-600 hover:bg-gray-100 rounded">Cancel</button>
                <button type="button" disabled={isSubmitting} onClick={handleImportSubmit} className="px-4 py-1.5 bg-sky-600 text-white rounded hover:bg-sky-700 disabled:opacity-50 flex items-center justify-center">
                  {isSubmitting ? <Loader2 className="animate-spin mr-1.5" size={14} /> : null}
                  Import Accounts
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
