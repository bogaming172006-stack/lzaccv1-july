import React, { useState, useEffect, useRef } from 'react';
import { db, handleFirestoreError, OperationType, collection, getDocs, query, where, limit, orderBy } from '../firebase';
import { Transaction, Party } from '../types';
import { useLedger } from '../LedgerContext';
import { useAuth } from '../AuthContext';
import { format, subDays, startOfMonth, endOfMonth } from 'date-fns';
import { Search, Loader2, ArrowRight, Trash2, Printer, Calendar, TrendingDown, TrendingUp, DollarSign, X, Filter, FileSpreadsheet, Receipt, Layers, Info, ChevronDown, Check } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { getFilteredCacheItems } from '../lib/idbCache';
import { syncCollection } from '../lib/syncCache';
import { deleteTransaction, syncTransactionsToLogTable } from '../lib/transactionService';
import ThermalReceiptModal from '../components/ThermalReceiptModal';
import TransactionDetailModal from '../components/TransactionDetailModal';
import { isInvoiceTx, isInfoTx } from '../lib/invoiceClassification';
import PageHeader from '../components/ui/PageHeader';
import StatCard from '../components/ui/StatCard';
import AmountDisplay from '../components/ui/AmountDisplay';
import Badge from '../components/ui/Badge';
import { Card } from '../components/ui/Card';

const BATCH_SIZE = 25;

export default function Log() {
  const navigate = useNavigate();
  const { activeLedger } = useLedger();
  const { currentUser } = useAuth();
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [receiptTx, setReceiptTx] = useState<Transaction | null>(null);
  const [selectedDetailTx, setSelectedDetailTx] = useState<Transaction | null>(null);
  const [parties, setParties] = useState<Record<string, Party>>({});
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'ALL' | 'DEBIT' | 'CREDIT'>('ALL');
  const [entryFilter, setEntryFilter] = useState<'ALL' | 'INVOICE' | 'INFO'>('ALL');
  const [showFilterDropdown, setShowFilterDropdown] = useState(false);
  const filterDropdownRef = useRef<HTMLDivElement>(null);
  
  // Default to today's date for Day Log
  const todayStr = format(new Date(), 'yyyy-MM-dd');
  const [startDate, setStartDate] = useState(todayStr);
  const [endDate, setEndDate] = useState(todayStr);
  const [datePreset, setDatePreset] = useState<'TODAY' | 'YESTERDAY' | 'THIS_MONTH' | 'ALL' | 'CUSTOM'>('TODAY');
  const [showCustomDates, setShowCustomDates] = useState(false);
  
  const [isLoading, setIsLoading] = useState(false);
  const [displayCount, setDisplayCount] = useState(BATCH_SIZE);

  const applyDatePreset = (preset: 'TODAY' | 'YESTERDAY' | 'THIS_MONTH' | 'ALL') => {
    setDatePreset(preset);
    const now = new Date();
    if (preset === 'TODAY') {
      const t = format(now, 'yyyy-MM-dd');
      setStartDate(t);
      setEndDate(t);
      setShowCustomDates(false);
    } else if (preset === 'YESTERDAY') {
      const y = format(subDays(now, 1), 'yyyy-MM-dd');
      setStartDate(y);
      setEndDate(y);
      setShowCustomDates(false);
    } else if (preset === 'THIS_MONTH') {
      setStartDate(format(startOfMonth(now), 'yyyy-MM-dd'));
      setEndDate(format(endOfMonth(now), 'yyyy-MM-dd'));
      setShowCustomDates(false);
    } else if (preset === 'ALL') {
      setStartDate('');
      setEndDate('');
      setShowCustomDates(false);
    }
  };

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

      // Sync transactions to database table 'log'
      if (fresh.length > 0) {
        syncTransactionsToLogTable(fresh, parties).catch(e => console.warn('Sync to log table:', e));
      }
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
  }, [filter, entryFilter, search, startDate, endDate]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (filterDropdownRef.current && !filterDropdownRef.current.contains(e.target as Node)) {
        setShowFilterDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

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

  const allCount = dateAndSearchFiltered.length;
  const invoiceCount = dateAndSearchFiltered.filter(isInvoiceTx).length;
  const infoCount = dateAndSearchFiltered.filter(isInfoTx).length;

  const filteredDisplay = dateAndSearchFiltered
    .filter(tx => filter === 'ALL' || tx.type === filter)
    .filter(tx => {
      if (entryFilter === 'INVOICE') return isInvoiceTx(tx);
      if (entryFilter === 'INFO') return isInfoTx(tx);
      return true;
    });

  const summaryFiltered = dateAndSearchFiltered
    .filter(tx => {
      if (entryFilter === 'INVOICE') return isInvoiceTx(tx);
      if (entryFilter === 'INFO') return isInfoTx(tx);
      return true;
    });

  const totalDebit = summaryFiltered
    .filter(tx => tx.type === 'DEBIT')
    .reduce((sum, tx) => sum + tx.amount, 0);

  const totalCredit = summaryFiltered
    .filter(tx => tx.type === 'CREDIT')
    .reduce((sum, tx) => sum + tx.amount, 0);

  const filtered = filteredDisplay.slice(0, displayCount);
  const hasMore = displayCount < filteredDisplay.length;

  return (
    <div className="p-2 min-[400px]:p-3 sm:p-8 pt-1 min-[400px]:pt-1.5 sm:pt-8 max-w-7xl mx-auto w-full pb-20 sm:pb-8 space-y-2 sm:space-y-6">
      {/* Page Header */}
      <PageHeader
        title={activeLedger.type === 'PURCHASE' ? "Purchase Day Log" : "Day Log"}
        titleStyle={{ fontSize: '20px', lineHeight: '18px' }}
        titleClassName="!text-[20px] !leading-[18px]"
        subtitleStyle={{ fontSize: '10px', lineHeight: '18px' }}
        subtitleClassName="!text-[10px] !leading-[18px]"
        subtitle={
          (() => {
            const filterSuffix = entryFilter === 'INVOICE' 
              ? ' • Invoices only' 
              : entryFilter === 'INFO' 
              ? ' • Info entries only' 
              : '';
            
            if (datePreset === 'TODAY') 
              return `Showing today's activities • ${format(new Date(), 'dd MMMM yyyy')}${filterSuffix}`;
            if (datePreset === 'YESTERDAY') 
              return `Showing yesterday's activities • ${format(subDays(new Date(), 1), 'dd MMMM yyyy')}${filterSuffix}`;
            if (datePreset === 'THIS_MONTH') 
              return `Showing this month's activities • ${format(new Date(), 'MMMM yyyy')}${filterSuffix}`;
            if (datePreset === 'ALL') 
              return `Showing all historical entries${filterSuffix}`;
            if (startDate && endDate && startDate === endDate) 
              return `Showing entries for ${format(new Date(startDate), 'dd MMM yyyy')}${filterSuffix}`;
            if (startDate || endDate) 
              return `Showing entries from ${startDate || 'beginning'} to ${endDate || 'present'}${filterSuffix}`;
            return `Day transaction log${filterSuffix}`;
          })()
        }
      />

      {/* Main Journal Table Card */}
      <Card>
        {/* Filter Controls Bar */}
        <div 
          className="p-2 sm:p-3 border-b border-slate-100 bg-slate-50/60 space-y-2 text-[7px] leading-[11px]"
          style={{ fontSize: '7px', lineHeight: '11px' }}
        >
          {/* Top Unified Controls Row: All Tabs and Search in One Row */}
          <div className="flex flex-col xl:flex-row gap-2 items-stretch xl:items-center justify-between">
            {/* All Filter Tabs in One Row */}
            <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
              {/* Segmented Type Filter with Debit and Credit Values */}
              <div className="flex bg-slate-200/70 p-0.5 sm:p-1 rounded-lg shrink-0 overflow-x-auto">
                {(['ALL', 'DEBIT', 'CREDIT'] as const).map(tab => {
                  const isSelected = filter === tab;
                  return (
                    <button
                      key={tab}
                      id={`filter-type-${tab.toLowerCase()}-btn`}
                      type="button"
                      onClick={() => setFilter(tab)}
                      className={`inline-flex items-center justify-center gap-1.5 sm:gap-2 px-2.5 sm:px-3 py-1 sm:py-1.5 text-[11px] sm:text-xs rounded-md transition-all cursor-pointer whitespace-nowrap ${
                        isSelected 
                          ? 'bg-white text-slate-900 shadow-2xs font-semibold sm:font-bold' 
                          : 'text-slate-600 hover:text-slate-900 font-medium'
                      }`}
                    >
                      <span>
                        {tab === 'ALL' ? 'All' : tab === 'DEBIT' ? 'Debits (Dr)' : 'Credits (Cr)'}
                      </span>
                      {tab === 'ALL' && (
                        <span className="text-[10px] sm:text-[11px] font-mono font-bold text-slate-500">
                          ({allCount})
                        </span>
                      )}
                      {tab === 'DEBIT' && (
                        <span className="text-[10px] sm:text-[11px] font-mono font-bold text-rose-600">
                          ₹{totalDebit.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </span>
                      )}
                      {tab === 'CREDIT' && (
                        <span className="text-[10px] sm:text-[11px] font-mono font-bold text-emerald-600">
                          ₹{totalCredit.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>

              {/* Simple Unified Filter Icon Button & Popover */}
              <div className="relative inline-block" ref={filterDropdownRef}>
                <button
                  type="button"
                  id="filter-options-btn"
                  onClick={() => setShowFilterDropdown(prev => !prev)}
                  className={`inline-flex items-center gap-1.5 px-2.5 sm:px-3 py-1 sm:py-1.5 rounded-lg text-[11px] sm:text-xs font-semibold border transition-all cursor-pointer shadow-2xs ${
                    datePreset !== 'TODAY' || entryFilter !== 'ALL'
                      ? 'bg-blue-50 border-blue-300 text-blue-700'
                      : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
                  }`}
                  title="Filter entries by Date & Classification"
                >
                  <Filter size={13} className={datePreset !== 'TODAY' || entryFilter !== 'ALL' ? 'text-blue-600' : 'text-slate-500'} />
                  <span>Filter</span>
                  {(datePreset !== 'TODAY' || entryFilter !== 'ALL') && (
                    <span className="w-1.5 h-1.5 rounded-full bg-blue-600"></span>
                  )}
                  <span className="text-[10px] text-slate-500 font-normal hidden sm:inline">
                    {datePreset === 'TODAY' ? 'Today' : datePreset === 'YESTERDAY' ? 'Yesterday' : 'Custom'}
                    {entryFilter !== 'ALL' ? ` • ${entryFilter === 'INVOICE' ? 'Invoices' : 'Info'}` : ''}
                  </span>
                  <ChevronDown size={12} className={`text-slate-400 ml-0.5 transition-transform duration-150 ${showFilterDropdown ? 'rotate-180' : ''}`} />
                </button>

                {showFilterDropdown && (
                  <div className="absolute left-0 mt-1.5 w-64 sm:w-72 bg-white border border-slate-200 rounded-xl shadow-xl z-50 p-3 space-y-3 animate-in fade-in zoom-in-95 duration-100">
                    {/* Section 1: Date Filter */}
                    <div>
                      <div className="flex items-center justify-between mb-1.5">
                        <span className="text-[10px] uppercase font-bold text-slate-500 tracking-wider flex items-center gap-1">
                          <Calendar size={11} className="text-slate-400" />
                          <span>Date Range</span>
                        </span>
                        {datePreset !== 'TODAY' && (
                          <button
                            type="button"
                            onClick={() => applyDatePreset('TODAY')}
                            className="text-[10px] text-blue-600 hover:underline font-medium cursor-pointer"
                          >
                            Reset Date
                          </button>
                        )}
                      </div>

                      <div className="grid grid-cols-3 gap-1 bg-slate-100 p-0.5 rounded-lg">
                        <button
                          type="button"
                          onClick={() => {
                            applyDatePreset('TODAY');
                            setShowCustomDates(false);
                          }}
                          className={`py-1 rounded-md text-[10.5px] font-medium transition-all cursor-pointer text-center ${
                            datePreset === 'TODAY'
                              ? 'bg-white text-slate-900 shadow-2xs font-semibold'
                              : 'text-slate-600 hover:text-slate-900'
                          }`}
                        >
                          Today
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            applyDatePreset('YESTERDAY');
                            setShowCustomDates(false);
                          }}
                          className={`py-1 rounded-md text-[10.5px] font-medium transition-all cursor-pointer text-center ${
                            datePreset === 'YESTERDAY'
                              ? 'bg-white text-slate-900 shadow-2xs font-semibold'
                              : 'text-slate-600 hover:text-slate-900'
                          }`}
                        >
                          Yesterday
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setShowCustomDates(true);
                            setDatePreset('CUSTOM');
                          }}
                          className={`py-1 rounded-md text-[10.5px] font-medium transition-all cursor-pointer text-center ${
                            datePreset === 'CUSTOM' || showCustomDates
                              ? 'bg-blue-600 text-white shadow-2xs font-semibold'
                              : 'text-slate-600 hover:text-slate-900'
                          }`}
                        >
                          Custom
                        </button>
                      </div>

                      {(datePreset === 'CUSTOM' || showCustomDates) && (
                        <div className="mt-2 space-y-1.5 p-2 bg-blue-50/50 border border-blue-100 rounded-lg">
                          <div className="flex items-center justify-between text-[10.5px]">
                            <span className="text-slate-500 font-medium">From:</span>
                            <input
                              type="date"
                              value={startDate}
                              onChange={e => {
                                setStartDate(e.target.value);
                                setDatePreset('CUSTOM');
                              }}
                              className="bg-white border border-slate-200 rounded px-1.5 py-0.5 text-[10.5px] text-slate-800 focus:outline-none"
                            />
                          </div>
                          <div className="flex items-center justify-between text-[10.5px]">
                            <span className="text-slate-500 font-medium">To:</span>
                            <input
                              type="date"
                              value={endDate}
                              onChange={e => {
                                setEndDate(e.target.value);
                                setDatePreset('CUSTOM');
                              }}
                              className="bg-white border border-slate-200 rounded px-1.5 py-0.5 text-[10.5px] text-slate-800 focus:outline-none"
                            />
                          </div>
                        </div>
                      )}
                    </div>

                    <div className="border-t border-slate-100" />

                    {/* Section 2: Entry Classification */}
                    <div>
                      <div className="flex items-center justify-between mb-1.5">
                        <span className="text-[10px] uppercase font-bold text-slate-500 tracking-wider flex items-center gap-1">
                          <Layers size={11} className="text-slate-400" />
                          <span>Entry Type</span>
                        </span>
                        {entryFilter !== 'ALL' && (
                          <button
                            type="button"
                            onClick={() => setEntryFilter('ALL')}
                            className="text-[10px] text-blue-600 hover:underline font-medium cursor-pointer"
                          >
                            All Types
                          </button>
                        )}
                      </div>

                      <div className="space-y-1">
                        <button
                          type="button"
                          onClick={() => setEntryFilter('ALL')}
                          className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors cursor-pointer text-left ${
                            entryFilter === 'ALL'
                              ? 'bg-slate-100 text-slate-900 font-semibold'
                              : 'text-slate-700 hover:bg-slate-50'
                          }`}
                        >
                          <div className="flex items-center gap-2">
                            <Layers size={13} className="text-slate-500" />
                            <span>All Entries</span>
                          </div>
                          <div className="flex items-center gap-1.5">
                            <span className="text-[10px] px-1.5 py-0.2 rounded-full font-mono font-bold bg-slate-200/80 text-slate-700">
                              {allCount}
                            </span>
                            {entryFilter === 'ALL' && <Check size={13} className="text-slate-700" />}
                          </div>
                        </button>

                        <button
                          type="button"
                          onClick={() => setEntryFilter('INVOICE')}
                          className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors cursor-pointer text-left ${
                            entryFilter === 'INVOICE'
                              ? 'bg-blue-50 text-blue-700 font-semibold'
                              : 'text-slate-700 hover:bg-slate-50'
                          }`}
                        >
                          <div className="flex items-center gap-2">
                            <Receipt size={13} className="text-blue-600" />
                            <span>Only Invoices</span>
                          </div>
                          <div className="flex items-center gap-1.5">
                            <span className="text-[10px] px-1.5 py-0.2 rounded-full font-mono font-bold bg-blue-100 text-blue-800">
                              {invoiceCount}
                            </span>
                            {entryFilter === 'INVOICE' && <Check size={13} className="text-blue-600" />}
                          </div>
                        </button>

                        <button
                          type="button"
                          onClick={() => setEntryFilter('INFO')}
                          className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors cursor-pointer text-left ${
                            entryFilter === 'INFO'
                              ? 'bg-amber-50 text-amber-700 font-semibold'
                              : 'text-slate-700 hover:bg-slate-50'
                          }`}
                        >
                          <div className="flex items-center gap-2">
                            <Info size={13} className="text-amber-600" />
                            <span>Only Info Entries</span>
                          </div>
                          <div className="flex items-center gap-1.5">
                            <span className="text-[10px] px-1.5 py-0.2 rounded-full font-mono font-bold bg-amber-100 text-amber-800">
                              {infoCount}
                            </span>
                            {entryFilter === 'INFO' && <Check size={13} className="text-amber-600" />}
                          </div>
                        </button>
                      </div>
                    </div>

                    {(datePreset !== 'TODAY' || entryFilter !== 'ALL') && (
                      <div className="pt-2 border-t border-slate-100 flex justify-end">
                        <button
                          type="button"
                          onClick={() => {
                            applyDatePreset('TODAY');
                            setEntryFilter('ALL');
                            setShowCustomDates(false);
                          }}
                          className="text-[10.5px] text-rose-600 hover:text-rose-800 font-semibold cursor-pointer"
                        >
                          Reset All Filters
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* Search Input */}
            <div className="relative w-full xl:w-72 shrink-0">
              <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
              <input 
                type="text" 
                placeholder="Search party, invoice #, notes..." 
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="w-full pl-7 pr-7 py-1 sm:py-1.5 bg-white border border-slate-300 rounded-lg text-[11px] sm:text-xs text-slate-900 font-normal focus:border-blue-600 placeholder:text-slate-400"
              />
              {search && (
                <button
                  type="button"
                  onClick={() => setSearch('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-slate-600 rounded"
                  title="Clear search"
                >
                  <X size={12} />
                </button>
              )}
            </div>
          </div>

          {/* Active Filter Summary Pill */}
          {(datePreset !== 'TODAY' || entryFilter !== 'ALL') && (
            <div className="flex flex-wrap items-center gap-1.5 pt-1.5 border-t border-slate-100 text-[10.5px]">
              <span className="text-slate-400 font-medium">Active:</span>
              {datePreset !== 'TODAY' && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 font-medium border border-blue-200">
                  <Calendar size={10} />
                  <span>
                    {datePreset === 'YESTERDAY' ? 'Yesterday' : `${startDate} to ${endDate}`}
                  </span>
                  <button
                    type="button"
                    onClick={() => applyDatePreset('TODAY')}
                    className="hover:text-blue-900 ml-0.5"
                    title="Reset date to Today"
                  >
                    <X size={10} />
                  </button>
                </span>
              )}
              {entryFilter !== 'ALL' && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 font-medium border border-amber-200">
                  <span>{entryFilter === 'INVOICE' ? 'Only Invoices' : 'Only Info'}</span>
                  <button
                    type="button"
                    onClick={() => setEntryFilter('ALL')}
                    className="hover:text-amber-900 ml-0.5"
                    title="Reset to All Entries"
                  >
                    <X size={10} />
                  </button>
                </span>
              )}
              <button
                type="button"
                onClick={() => {
                  applyDatePreset('TODAY');
                  setEntryFilter('ALL');
                }}
                className="text-[10px] text-slate-500 hover:text-slate-800 underline ml-auto cursor-pointer"
              >
                Clear all filters
              </button>
            </div>
          )}
        </div>

        {/* Desktop Table View */}
        <div className="hidden md:block overflow-x-auto">
          <table className="w-full text-left border-collapse table-finance">
            <thead>
              <tr>
                <th className="w-36">Date</th>
                <th>Party Name</th>
                <th className="w-32 text-center">Debit / Credit Type</th>
                <th className="w-40 text-right">Before Amount</th>
                <th className="w-44 text-right">Amount</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(tx => {
                const party = parties[tx.partyId];
                const afterAmount = tx.runningBalance !== undefined ? tx.runningBalance : (party?.currentDue ?? tx.amount);
                const balanceChange = tx.type === 'DEBIT' ? tx.amount : -tx.amount;
                const beforeAmount = tx.beforeAmount !== undefined ? tx.beforeAmount : (afterAmount - balanceChange);
                return (
                  <tr 
                    key={tx.id} 
                    onClick={() => setSelectedDetailTx(tx)}
                    className="hover:bg-blue-50/40 cursor-pointer transition-colors group"
                  >
                    {/* 1st Column: Date Only */}
                    <td className="text-xs whitespace-nowrap font-medium text-slate-800">
                      <span className="font-semibold text-slate-900 block">
                        {format(new Date(tx.timestamp), 'dd MMM yyyy')}
                      </span>
                    </td>

                    {/* 2nd Column: Party Name */}
                    <td>
                      <span className="font-bold text-slate-900 text-xs sm:text-sm block">
                        {party?.name || 'Unknown Party'}
                      </span>
                      {(tx.invoiceNo || tx.notes) && (
                        <div className="flex items-center gap-1.5 mt-0.5 text-[11px] text-slate-500">
                          {tx.invoiceNo && tx.invoiceNo.trim() && tx.invoiceNo.trim() !== '-' && (
                            <span className="font-mono text-slate-700 bg-slate-100 px-1 py-0.2 rounded text-[10px]">
                              #{tx.invoiceNo.trim()}
                            </span>
                          )}
                          {tx.notes && <span className="truncate max-w-xs">{tx.notes}</span>}
                        </div>
                      )}
                    </td>

                    {/* 3rd Column: Debit or Credit Type */}
                    <td className="text-center whitespace-nowrap">
                      <span className={`text-xs font-bold ${
                        tx.type === 'DEBIT'
                          ? 'text-rose-600'
                          : 'text-emerald-600'
                      }`}>
                        {tx.type === 'DEBIT' ? 'Debit (Dr)' : 'Credit (Cr)'}
                      </span>
                    </td>

                    {/* 4th Column: Before Amount */}
                    <td className="text-right whitespace-nowrap font-mono">
                      <div className="text-xs sm:text-sm font-semibold tabular-nums text-slate-700">
                        ₹{Math.abs(beforeAmount).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </div>
                    </td>

                    {/* 5th Column: Amount */}
                    <td className="text-right whitespace-nowrap">
                      <div className="flex items-center justify-end gap-2">
                        <div className={`text-xs sm:text-sm font-bold tabular-nums ${
                          tx.type === 'DEBIT' ? 'text-rose-600' : 'text-emerald-600'
                        }`}>
                          ₹{tx.amount.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </div>
                        <div className="opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1 ml-1" onClick={e => e.stopPropagation()}>
                          <button
                            type="button"
                            onClick={() => setReceiptTx(tx)}
                            className="p-1 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded transition-colors"
                            title="Print Receipt"
                          >
                            <Printer size={13} />
                          </button>
                          {currentUser?.isAdmin && (
                            <button
                              type="button"
                              onClick={() => {
                                setDeletingTx(tx);
                                setShowDeleteConfirm(true);
                              }}
                              className="p-1 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded transition-colors"
                              title="Delete Transaction"
                            >
                              <Trash2 size={13} />
                            </button>
                          )}
                        </div>
                      </div>
                    </td>
                  </tr>
                );
              })}

              {filtered.length === 0 && (
                <tr>
                  <td colSpan={5} className="py-12 text-center">
                    <div className="max-w-xs mx-auto space-y-2">
                      <p className="text-xs font-semibold text-slate-500">
                        No {entryFilter === 'INVOICE' ? 'invoices' : entryFilter === 'INFO' ? 'info entries' : 'transactions'} matching current filters.
                      </p>
                      {(filter !== 'ALL' || entryFilter !== 'ALL' || search || datePreset !== 'TODAY') && (
                        <button
                          type="button"
                          onClick={() => {
                            setFilter('ALL');
                            setEntryFilter('ALL');
                            setSearch('');
                            applyDatePreset('TODAY');
                          }}
                          className="text-xs text-blue-600 hover:text-blue-700 font-semibold underline cursor-pointer"
                        >
                          Reset all filters
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Mobile View: Section (Date, Party Name, Type, Amount with Before) */}
        <div className="block md:hidden bg-white">
          {/* Header */}
          <div className="grid grid-cols-12 gap-1 px-2.5 py-1.5 bg-slate-100/90 border-b border-slate-200 text-[9.5px] font-bold text-slate-500 uppercase tracking-wider">
            <div className="col-span-3">Date</div>
            <div className="col-span-4">Party Name</div>
            <div className="col-span-2 text-center">Type</div>
            <div className="col-span-3 text-right">Amount</div>
          </div>

          <div className="divide-y divide-slate-100">
            {filtered.map(tx => {
              const party = parties[tx.partyId];
              const afterAmount = tx.runningBalance !== undefined ? tx.runningBalance : (party?.currentDue ?? tx.amount);
              const balanceChange = tx.type === 'DEBIT' ? tx.amount : -tx.amount;
              const beforeAmount = tx.beforeAmount !== undefined ? tx.beforeAmount : (afterAmount - balanceChange);
              return (
                <div 
                  key={tx.id} 
                  onClick={() => setSelectedDetailTx(tx)}
                  className="p-2 min-[400px]:p-2.5 hover:bg-slate-50 grid grid-cols-12 gap-1 items-center cursor-pointer transition-colors"
                >
                  {/* 1st Column: Date Only */}
                  <div className="col-span-3 min-w-0">
                    <span className="text-[10px] min-[400px]:text-[11px] font-semibold text-slate-800 block truncate">
                      {format(new Date(tx.timestamp), 'dd MMM yyyy')}
                    </span>
                  </div>

                  {/* 2nd Column: Party Name */}
                  <div className="col-span-4 min-w-0 pr-1">
                    <h4 className="font-semibold text-slate-900 text-[11px] min-[400px]:text-[11.5px] leading-tight truncate">
                      {party?.name || 'Unknown'}
                    </h4>
                    {(tx.invoiceNo || tx.notes) && (
                      <p className="text-[8.5px] text-slate-400 truncate mt-0.5 leading-tight">
                        {tx.invoiceNo ? `#${tx.invoiceNo}` : tx.notes}
                      </p>
                    )}
                  </div>

                  {/* 3rd Column: Debit or Credit Type */}
                  <div className="col-span-2 text-center">
                    <span className={`text-[10px] min-[400px]:text-[11px] font-bold ${
                      tx.type === 'DEBIT' ? 'text-rose-600' : 'text-emerald-600'
                    }`}>
                      {tx.type === 'DEBIT' ? 'Dr' : 'Cr'}
                    </span>
                  </div>

                  {/* 4th Column: Amount & Before Amount */}
                  <div className="col-span-3 text-right">
                    <div className={`text-[10.5px] min-[400px]:text-[11.5px] font-bold tabular-nums tracking-tight ${
                      tx.type === 'DEBIT' ? 'text-rose-600' : 'text-emerald-600'
                    }`}>
                      ₹{tx.amount.toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}
                    </div>
                    <span className="text-[8.5px] text-slate-400 block tabular-nums">
                      Br: ₹{Math.abs(beforeAmount).toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                    </span>
                  </div>
                </div>
              );
            })}

            {filtered.length === 0 && (
              <div className="py-12 text-center px-4">
                <p className="text-xs font-semibold text-slate-500">
                  No {entryFilter === 'INVOICE' ? 'invoices' : entryFilter === 'INFO' ? 'info entries' : 'transactions'} matching current filters.
                </p>
                {(filter !== 'ALL' || entryFilter !== 'ALL' || search || datePreset !== 'TODAY') && (
                  <button
                    type="button"
                    onClick={() => {
                      setFilter('ALL');
                      setEntryFilter('ALL');
                      setSearch('');
                      applyDatePreset('TODAY');
                    }}
                    className="text-xs text-blue-600 hover:text-blue-700 font-semibold underline mt-2 inline-block cursor-pointer"
                  >
                    Reset all filters
                  </button>
                )}
              </div>
            )}
          </div>
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

      {/* Thermal Receipt Modal */}
      {receiptTx && (
        <ThermalReceiptModal
          isOpen={true}
          onClose={() => setReceiptTx(null)}
          transaction={receiptTx}
          partyName={parties[receiptTx.partyId]?.name || 'Unknown Party'}
          partyPhone={parties[receiptTx.partyId]?.phone}
          ledgerName={activeLedger?.name || 'Ledger'}
          ledgerType={activeLedger?.type}
          isPurchaseStyle={activeLedger?.type === 'PURCHASE' || activeLedger?.type === 'LIABILITY' || activeLedger?.type === 'CAPITAL'}
        />
      )}

      {/* Transaction Detail Popup */}
      <TransactionDetailModal
        isOpen={selectedDetailTx !== null}
        onClose={() => setSelectedDetailTx(null)}
        transaction={selectedDetailTx}
        partyName={selectedDetailTx ? (parties[selectedDetailTx.partyId]?.name || 'Unknown') : ''}
        ledgerName={activeLedger?.name || 'Ledger'}
        ledgerType={activeLedger?.type}
        onOpenReceipt={(tx) => setReceiptTx(tx)}
      />
    </div>
  );
}
