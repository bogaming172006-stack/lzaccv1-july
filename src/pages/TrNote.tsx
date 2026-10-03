import React, { useState, useEffect, useRef } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { format } from 'date-fns';
import { 
  FileCheck2, 
  Search, 
  Printer, 
  Check, 
  ArrowRight, 
  CreditCard, 
  FileText, 
  PlusCircle, 
  MinusCircle, 
  Building2, 
  History, 
  Clock, 
  RefreshCw, 
  AlertCircle,
  Sparkles,
  ChevronDown,
  X,
  Receipt
} from 'lucide-react';
import { Party, Transaction } from '../types';
import { useLedger } from '../LedgerContext';
import { useAuth } from '../AuthContext';
import { createTransaction } from '../lib/transactionService';
import { getFilteredCacheItems } from '../lib/idbCache';
import { syncCollection } from '../lib/syncCache';
import { logUserActivity } from '../lib/activityLogger';
import { formatAmountInWords } from '../lib/numberToWords';
import { useLedgerTextCase, CaseIndicator } from '../lib/textCaseHelper';
import ThermalReceiptModal from '../components/ThermalReceiptModal';
import PageHeader from '../components/ui/PageHeader';
import { Card, CardHeader, CardBody } from '../components/ui/Card';
import Badge from '../components/ui/Badge';
import AmountDisplay from '../components/ui/AmountDisplay';

const NOTE_PRESETS = [
  'Discount Adjustment',
  'Rate Difference',
  'Damage / Breakage',
  'Shortage Deduction',
  'Round Off Adjustment',
  'Settlement Deduction',
  'Special Allowance',
  'Billing Correction'
];

export default function TrNote() {
  const { activeLedger } = useLedger();
  const { currentUser } = useAuth();

  // Form State
  const [type, setType] = useState<'DEBIT' | 'CREDIT'>('CREDIT');
  const [selectedParty, setSelectedParty] = useState<Party | null>(null);
  const [partySearch, setPartySearch] = useState('');
  const [isPartyDropdownOpen, setIsPartyDropdownOpen] = useState(false);
  const [note, setNote] = useState('');
  const [amount, setAmount] = useState('');
  const [customTrnNo, setCustomTrnNo] = useState('');
  const [autoOpenReceipt, setAutoOpenReceipt] = useState(true);

  // Data State
  const [parties, setParties] = useState<Party[]>([]);
  const [recentTrNotes, setRecentTrNotes] = useState<Transaction[]>([]);
  const [isLoadingParties, setIsLoadingParties] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const { isCaps, toggleManualCaps, handleTextChange, formatText } = useLedgerTextCase();

  // Thermal Receipt Modal State
  const [receiptTx, setReceiptTx] = useState<Transaction | null>(null);
  const [receiptParty, setReceiptParty] = useState<{ name: string; phone?: string }>({ name: '' });
  const [isReceiptOpen, setIsReceiptOpen] = useState(false);

  // Refs
  const partySearchRef = useRef<HTMLInputElement>(null);
  const noteRef = useRef<HTMLTextAreaElement>(null);
  const amountRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Generate next sequential TRN number starting with 00001 (e.g. TRN-00001)
  const getNextTrnNumber = (txs?: Transaction[]): string => {
    let maxSeq = 0;
    if (txs && txs.length > 0) {
      for (const t of txs) {
        const inv = (t.invoiceNo || '').trim().toUpperCase();
        // Match TRN-00001, TRN00001, or 00001
        const m = inv.match(/^TRN-?0*(\d+)$/) || inv.match(/^0*(\d{1,6})$/);
        if (m) {
          const num = parseInt(m[1], 10);
          // Only consider numbers under 100000 to avoid old timestamp numbers
          if (!isNaN(num) && num > 0 && num < 100000 && num > maxSeq) {
            maxSeq = num;
          }
        }
      }
    }

    if (activeLedger?.id) {
      try {
        const stored = localStorage.getItem(`last_trn_seq_${activeLedger.id}`);
        if (stored) {
          const storedNum = parseInt(stored, 10);
          if (!isNaN(storedNum) && storedNum > maxSeq && storedNum < 100000) {
            maxSeq = storedNum;
          }
        }
      } catch (e) {}
    }

    const nextSeq = maxSeq + 1;
    return `TRN-${String(nextSeq).padStart(5, '0')}`;
  };

  // Load parties and recent TR Notes
  const loadData = async () => {
    if (!activeLedger?.id) return;
    setIsLoadingParties(true);
    try {
      // 1. Load parties
      const cachedParties = await getFilteredCacheItems<Party>('parties', p => p.ledgerId === activeLedger.id);
      setParties(cachedParties);

      // 2. Load transactions to filter TR Notes
      const allTxs = await getFilteredCacheItems<Transaction>('transactions', t => t.ledgerId === activeLedger.id);
      
      // Auto-set next sequential TRN number starting with TRN-00001
      const nextTrn = getNextTrnNumber(allTxs);
      setCustomTrnNo(nextTrn);

      // Filter transactions that look like TR Notes (invoiceNo starts with TRN or note includes TR Note / Adjustment)
      const trTxs = allTxs
        .filter(t => {
          const inv = (t.invoiceNo || '').toLowerCase();
          const n = (t.notes || '').toLowerCase();
          return inv.startsWith('trn') || n.includes('tr note') || n.includes('adjustment');
        })
        .sort((a, b) => b.timestamp - a.timestamp)
        .slice(0, 15);

      setRecentTrNotes(trTxs);

      // Background fresh sync
      syncCollection<Party>('parties', activeLedger.id, 'parties').then(async () => {
        const freshParties = await getFilteredCacheItems<Party>('parties', p => p.ledgerId === activeLedger.id);
        setParties(freshParties);
      });
    } catch (err) {
      console.error('Error loading TR Note data:', err);
    } finally {
      setIsLoadingParties(false);
    }
  };

  useEffect(() => {
    loadData();
    setSelectedParty(null);
    setPartySearch('');
    setNote('');
    setAmount('');
    setErrorMsg(null);
    setSuccessMsg(null);

    const handleSync = () => loadData();
    window.addEventListener('database-synced', handleSync);
    return () => window.removeEventListener('database-synced', handleSync);
  }, [activeLedger?.id]);

  // Close dropdown on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsPartyDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Filter parties by search
  const filteredParties = parties.filter(p => {
    const query = partySearch.trim().toLowerCase();
    if (!query) return true;
    const nameMatch = (p.name || '').toLowerCase().includes(query);
    const phoneMatch = (p.phone || '').includes(query);
    const addrMatch = (p.address || '').toLowerCase().includes(query);
    return nameMatch || phoneMatch || addrMatch;
  });

  // Calculate projected balance
  const numAmount = parseFloat(amount) || 0;
  const currentDue = selectedParty ? selectedParty.currentDue : 0;
  const balanceAdjustment = type === 'DEBIT' ? numAmount : -numAmount;
  const projectedDue = currentDue + balanceAdjustment;

  const handleSelectParty = (party: Party) => {
    setSelectedParty(party);
    setIsPartyDropdownOpen(false);
    setPartySearch('');
    setErrorMsg(null);
    setTimeout(() => {
      noteRef.current?.focus();
    }, 50);
  };

  const handlePresetNote = (preset: string) => {
    const formattedPreset = formatText(preset);
    if (!note) {
      setNote(formattedPreset);
    } else if (!note.includes(formattedPreset)) {
      setNote(`${note.trim()}, ${formattedPreset}`);
    }
    amountRef.current?.focus();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setSuccessMsg(null);

    if (!activeLedger) {
      setErrorMsg('Please select an active ledger first.');
      return;
    }

    if (!selectedParty) {
      setErrorMsg('Please choose a party name to adjust.');
      partySearchRef.current?.focus();
      return;
    }

    if (!note.trim()) {
      setErrorMsg('Please enter a note / adjustment reason.');
      noteRef.current?.focus();
      return;
    }

    if (!amount || isNaN(numAmount) || numAmount <= 0) {
      setErrorMsg('Please enter a valid amount to adjust (greater than 0).');
      amountRef.current?.focus();
      return;
    }

    setIsSubmitting(true);

    try {
      let rawTrn = customTrnNo.trim().toUpperCase();
      let finalTrnNo = rawTrn;
      if (!finalTrnNo) {
        finalTrnNo = getNextTrnNumber();
      } else if (/^\d+$/.test(finalTrnNo)) {
        // If user typed 1 or 00001, format as TRN-00001
        finalTrnNo = `TRN-${finalTrnNo.padStart(5, '0')}`;
      } else if (!finalTrnNo.startsWith('TRN-') && finalTrnNo.startsWith('TRN')) {
        finalTrnNo = `TRN-${finalTrnNo.replace(/^TRN/i, '').padStart(5, '0')}`;
      }

      // Update sequence storage
      const mSeq = finalTrnNo.match(/^TRN-?0*(\d+)$/);
      if (mSeq && activeLedger?.id) {
        const num = parseInt(mSeq[1], 10);
        if (!isNaN(num) && num > 0 && num < 100000) {
          try {
            localStorage.setItem(`last_trn_seq_${activeLedger.id}`, String(num));
          } catch (e) {}
        }
      }

      const finalNote = note.trim();
      const formattedNoteForReceipt = `[TR NOTE] ${finalNote}`;

      const txId = uuidv4();
      const newTx: Transaction = {
        id: txId,
        partyId: selectedParty.id,
        ledgerId: activeLedger.id,
        invoiceNo: finalTrnNo,
        type,
        amount: numAmount,
        timestamp: Date.now(),
        notes: formattedNoteForReceipt
      };

      const updatedPartyDue = selectedParty.currentDue + balanceAdjustment;
      const txWithBalance: Transaction = {
        ...newTx,
        runningBalance: updatedPartyDue
      };

      // 1. Commit transaction to database and cache
      await createTransaction(newTx, selectedParty);

      // 2. Log User Activity
      await logUserActivity(
        `Recorded TR Note (${type})`,
        `₹${numAmount.toFixed(2)} adjusted for ${selectedParty.name} - Ref: ${finalTrnNo} - Note: ${finalNote}`,
        currentUser,
        activeLedger.name,
        activeLedger.id
      );

      // 3. Update local state
      setSuccessMsg(`TR Note successfully recorded! ${type === 'DEBIT' ? 'Debited' : 'Credited'} ₹${numAmount.toFixed(2)} to ${selectedParty.name}.`);
      
      // Update parties cache locally
      setSelectedParty(prev => prev ? { ...prev, currentDue: updatedPartyDue } : null);
      
      // Pre-populate receipt and open if enabled
      setReceiptTx(txWithBalance);
      setReceiptParty({
        name: selectedParty.name,
        phone: selectedParty.phone
      });

      if (autoOpenReceipt) {
        setIsReceiptOpen(true);
      }

      // Reset fields for next entry
      setAmount('');
      setNote('');
      loadData();
    } catch (err: any) {
      console.error('Error submitting TR Note:', err);
      setErrorMsg(err?.message || 'Failed to record TR Note. Please check your connection and try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleOpenReceiptForTx = (tx: Transaction) => {
    const party = parties.find(p => p.id === tx.partyId);
    setReceiptTx(tx);
    setReceiptParty({
      name: party ? party.name : 'Unknown Party',
      phone: party?.phone
    });
    setIsReceiptOpen(true);
  };

  if (!activeLedger) {
    return (
      <div className="p-8 text-center text-slate-500 font-medium">
        Please select a ledger from the top menu to record TR Notes.
      </div>
    );
  }

  return (
    <div className="p-2 min-[400px]:p-3 sm:p-8 pt-1 min-[400px]:pt-1.5 sm:pt-8 max-w-4xl mx-auto w-full pb-24 sm:pb-12 space-y-4">
      {/* Page Header */}
      <PageHeader
        title="TR Note"
        subtitle="Quick Transfer & Adjustment Note with Instant Thermal Print Receipt"
        badge={
          <Badge variant="navy" className="bg-[#0055a5]/10 text-[#0055a5] border border-[#0055a5]/20 font-bold uppercase text-[10px] tracking-wider">
            {activeLedger.name}
          </Badge>
        }
      />

      {/* Main Form Card */}
      <Card className="shadow-sm border border-slate-200 overflow-visible bg-white">
        <CardHeader
          className="bg-slate-50/90 border-b border-slate-200/80 px-4 sm:px-6 py-3.5"
          title={
            <div className="flex items-center gap-2">
              <div className="p-1.5 bg-[#0055a5] text-white rounded-lg shadow-xs">
                <FileCheck2 size={18} />
              </div>
              <div>
                <h2 className="text-sm font-bold text-slate-900">Create New TR Note</h2>
              </div>
            </div>
          }
          subtitle="Record a Debit or Credit adjustment and get a thermal receipt with company logo"
          action={
            <div className="flex items-center gap-1 text-xs text-slate-500 font-mono bg-white px-2.5 py-1 rounded-md border border-slate-200">
              <span className="text-slate-400 font-sans">Ref:</span>
              <span className="font-bold text-slate-800 uppercase">{customTrnNo}</span>
            </div>
          }
        />

        <CardBody className="p-4 sm:p-6 space-y-5">
          {errorMsg && (
            <div className="p-3 bg-rose-50 border border-rose-200 rounded-lg flex items-start gap-2.5 text-xs text-rose-800 animate-in fade-in">
              <AlertCircle size={16} className="text-rose-600 shrink-0 mt-0.5" />
              <div className="flex-1 font-medium leading-relaxed">{errorMsg}</div>
              <button onClick={() => setErrorMsg(null)} className="text-rose-400 hover:text-rose-700">
                <X size={14} />
              </button>
            </div>
          )}

          {successMsg && (
            <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-lg flex items-center justify-between gap-2.5 text-xs text-emerald-800 animate-in fade-in">
              <div className="flex items-center gap-2 font-medium">
                <Check size={16} className="text-emerald-600 shrink-0" />
                <span>{successMsg}</span>
              </div>
              {receiptTx && (
                <button
                  type="button"
                  onClick={() => setIsReceiptOpen(true)}
                  className="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded font-bold text-[11px] flex items-center gap-1 shadow-2xs transition-colors shrink-0"
                >
                  <Printer size={12} />
                  <span>View Thermal Receipt</span>
                </button>
              )}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-5">
            {/* TRN Voucher Reference Number Bar */}
            <div className="flex flex-wrap items-center justify-between gap-2 p-2.5 bg-slate-50 border border-slate-200 rounded-xl">
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold uppercase tracking-wider text-slate-600">No:</span>
                <input
                  type="text"
                  value={customTrnNo}
                  onChange={e => setCustomTrnNo(e.target.value.toUpperCase())}
                  placeholder="TRN-00001"
                  className="font-mono font-bold text-xs px-2.5 py-1 bg-white border border-slate-300 rounded-md text-slate-900 focus:outline-hidden focus:border-blue-600 focus:ring-1 focus:ring-blue-600 w-36 uppercase"
                />
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={async () => {
                    const allTxs = await getFilteredCacheItems<Transaction>('transactions', t => t.ledgerId === activeLedger.id);
                    setCustomTrnNo(getNextTrnNumber(allTxs));
                  }}
                  className="text-[11px] font-semibold text-blue-600 hover:text-blue-800 flex items-center gap-1 px-2 py-1 rounded hover:bg-blue-50 transition-colors"
                  title="Auto-calculate next sequential TRN number starting with TRN-00001"
                >
                  <span>Auto Next</span>
                </button>
                <span className="text-[10px] text-slate-400">Sequential (Starts with 00001)</span>
              </div>
            </div>

            {/* 1. CHOOSE TYPE: DEBIT OR CREDIT */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-xs font-bold uppercase tracking-wider text-slate-700 flex items-center gap-1.5">
                  <span className="w-4.5 h-4.5 rounded-full bg-slate-900 text-white flex items-center justify-center text-[10px] font-bold">1</span>
                  <span>Choose Type (Debit or Credit)</span>
                </label>
                <span className="text-[11px] text-slate-500 italic">
                  {type === 'DEBIT' ? 'Increases party balance due (Charge / Bill)' : 'Reduces party balance due (Payment / Credit note)'}
                </span>
              </div>

              <div className="grid grid-cols-2 gap-3">
                {/* DEBIT BUTTON */}
                <button
                  type="button"
                  onClick={() => setType('DEBIT')}
                  className={`p-3.5 rounded-xl border-2 transition-all flex items-center justify-between cursor-pointer ${
                    type === 'DEBIT'
                      ? 'border-rose-500 bg-rose-50/70 text-rose-950 shadow-xs ring-2 ring-rose-200/50'
                      : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50 hover:border-slate-300'
                  }`}
                >
                  <div className="flex items-center gap-2.5 text-left">
                    <div className={`p-2 rounded-lg ${type === 'DEBIT' ? 'bg-rose-500 text-white' : 'bg-slate-100 text-slate-500'}`}>
                      <MinusCircle size={18} />
                    </div>
                    <div>
                      <div className="font-bold text-sm">DEBIT (-)</div>
                      <div className="text-[11px] text-slate-500">Charge / Debit Note</div>
                    </div>
                  </div>
                  {type === 'DEBIT' && (
                    <div className="w-5 h-5 rounded-full bg-rose-500 text-white flex items-center justify-center shrink-0">
                      <Check size={12} strokeWidth={3} />
                    </div>
                  )}
                </button>

                {/* CREDIT BUTTON */}
                <button
                  type="button"
                  onClick={() => setType('CREDIT')}
                  className={`p-3.5 rounded-xl border-2 transition-all flex items-center justify-between cursor-pointer ${
                    type === 'CREDIT'
                      ? 'border-emerald-500 bg-emerald-50/70 text-emerald-950 shadow-xs ring-2 ring-emerald-200/50'
                      : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50 hover:border-slate-300'
                  }`}
                >
                  <div className="flex items-center gap-2.5 text-left">
                    <div className={`p-2 rounded-lg ${type === 'CREDIT' ? 'bg-emerald-600 text-white' : 'bg-slate-100 text-slate-500'}`}>
                      <PlusCircle size={18} />
                    </div>
                    <div>
                      <div className="font-bold text-sm">CREDIT (+)</div>
                      <div className="text-[11px] text-slate-500">Receipt / Credit Note</div>
                    </div>
                  </div>
                  {type === 'CREDIT' && (
                    <div className="w-5 h-5 rounded-full bg-emerald-600 text-white flex items-center justify-center shrink-0">
                      <Check size={12} strokeWidth={3} />
                    </div>
                  )}
                </button>
              </div>
            </div>

            {/* 2. CHOOSE PARTY NAME */}
            <div ref={dropdownRef} className="relative">
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-xs font-bold uppercase tracking-wider text-slate-700 flex items-center gap-1.5">
                  <span className="w-4.5 h-4.5 rounded-full bg-slate-900 text-white flex items-center justify-center text-[10px] font-bold">2</span>
                  <span>Choose Party Name</span>
                </label>
                {selectedParty && (
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedParty(null);
                      setIsPartyDropdownOpen(true);
                      setTimeout(() => partySearchRef.current?.focus(), 50);
                    }}
                    className="text-[11px] text-blue-600 hover:text-blue-800 font-semibold underline cursor-pointer"
                  >
                    Change Party
                  </button>
                )}
              </div>

              {selectedParty ? (
                /* Selected Party Display Card */
                <div className="p-3.5 bg-blue-50/60 border border-blue-200 rounded-xl flex items-center justify-between gap-3 shadow-2xs">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-10 h-10 rounded-lg bg-[#0055a5] text-white flex items-center justify-center font-bold text-base shrink-0 shadow-xs">
                      {selectedParty.name.charAt(0).toUpperCase()}
                    </div>
                    <div className="min-w-0">
                      <div className="font-bold text-slate-900 text-sm truncate flex items-center gap-2">
                        <span>{selectedParty.name}</span>
                        {selectedParty.phone && (
                          <span className="text-xs font-normal text-slate-500 font-mono">({selectedParty.phone})</span>
                        )}
                      </div>
                      <div className="text-xs text-slate-600 truncate flex items-center gap-2 mt-0.5">
                        <span>Current Outstanding:</span>
                        <span className={`font-bold tabular-nums ${selectedParty.currentDue > 0 ? 'text-rose-600' : selectedParty.currentDue < 0 ? 'text-emerald-600' : 'text-slate-600'}`}>
                          ₹{Math.abs(selectedParty.currentDue).toLocaleString(undefined, { minimumFractionDigits: 2 })} {selectedParty.currentDue > 0 ? 'Dr (Due)' : selectedParty.currentDue < 0 ? 'Cr (Advance)' : ''}
                        </span>
                      </div>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedParty(null);
                      setIsPartyDropdownOpen(true);
                      setTimeout(() => partySearchRef.current?.focus(), 50);
                    }}
                    className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-white rounded-lg transition-colors shrink-0"
                    title="Change Party"
                  >
                    <X size={16} />
                  </button>
                </div>
              ) : (
                /* Party Search & Selector Input */
                <div className="relative">
                  <div className="relative">
                    <input
                      ref={partySearchRef}
                      type="text"
                      value={partySearch}
                      onChange={e => {
                        setPartySearch(e.target.value);
                        setIsPartyDropdownOpen(true);
                      }}
                      onFocus={() => setIsPartyDropdownOpen(true)}
                      placeholder="Search and select party name or phone number..."
                      className="w-full pl-9 pr-8 py-2.5 text-sm bg-white border border-slate-300 rounded-lg text-slate-900 placeholder:text-slate-400 focus:border-blue-600 focus:ring-1 focus:ring-blue-600"
                    />
                    <Search size={16} className="absolute left-3 top-3 text-slate-400" />
                    <button
                      type="button"
                      onClick={() => setIsPartyDropdownOpen(!isPartyDropdownOpen)}
                      className="absolute right-2.5 top-2.5 text-slate-400 hover:text-slate-600"
                    >
                      <ChevronDown size={16} />
                    </button>
                  </div>

                  {/* Dropdown Options List */}
                  {isPartyDropdownOpen && (
                    <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-slate-200 rounded-xl shadow-xl max-h-60 overflow-y-auto z-30 divide-y divide-slate-100">
                      {filteredParties.length === 0 ? (
                        <div className="p-4 text-center text-xs text-slate-500">
                          No parties found matching "{partySearch}".
                        </div>
                      ) : (
                        filteredParties.map(party => (
                          <button
                            key={party.id}
                            type="button"
                            onClick={() => handleSelectParty(party)}
                            className="w-full p-2.5 text-left hover:bg-blue-50 transition-colors flex items-center justify-between gap-2"
                          >
                            <div className="min-w-0">
                              <div className="font-bold text-slate-900 text-xs truncate">{party.name}</div>
                              {party.phone && <div className="text-[11px] text-slate-500 font-mono">{party.phone}</div>}
                            </div>
                            <div className="text-right shrink-0">
                              <div className={`text-xs font-bold tabular-nums ${party.currentDue > 0 ? 'text-rose-600' : party.currentDue < 0 ? 'text-emerald-600' : 'text-slate-600'}`}>
                                ₹{Math.abs(party.currentDue).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                              </div>
                              <div className="text-[10px] text-slate-400 font-semibold uppercase">
                                {party.currentDue > 0 ? 'Dr (Due)' : party.currentDue < 0 ? 'Cr (Advance)' : 'Nil'}
                              </div>
                            </div>
                          </button>
                        ))
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* 3. NOTE / PARTICULARS */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-xs font-bold uppercase tracking-wider text-slate-700 flex items-center gap-1.5">
                  <span className="w-4.5 h-4.5 rounded-full bg-slate-900 text-white flex items-center justify-center text-[10px] font-bold">3</span>
                  <span>Note (Adjustment Reason)</span>
                </label>
                <div className="flex items-center gap-2">
                  <CaseIndicator isCaps={isCaps} onToggle={toggleManualCaps} />
                  <span className="text-[11px] text-slate-500 italic hidden sm:inline">Appears on receipt</span>
                </div>
              </div>

              <textarea
                ref={noteRef}
                rows={2}
                required
                value={note}
                onChange={e => handleTextChange(e, setNote)}
                placeholder="e.g. Discount given on invoice #1042, rate difference adjustment, shortage deduction..."
                className="w-full px-3.5 py-2 text-sm bg-white border border-slate-300 rounded-lg text-slate-900 placeholder:text-slate-400 focus:border-blue-600 focus:ring-1 focus:ring-blue-600 resize-none"
              />

              {/* 1-Click Quick Note Chips */}
              <div className="mt-2 flex flex-wrap gap-1.5 items-center">
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mr-1 flex items-center gap-1">
                 
                </span>
                {NOTE_PRESETS.map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    onClick={() => handlePresetNote(preset)}
                    className="px-2 py-0.5 bg-slate-100 hover:bg-blue-50 hover:text-blue-700 hover:border-blue-200 border border-slate-200/80 rounded-md text-[10.5px] text-slate-600 transition-colors cursor-pointer"
                  >
                    + {preset}
                  </button>
                ))}
              </div>
            </div>

            {/* 4. AMOUNT TO ADJUST */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-xs font-bold uppercase tracking-wider text-slate-700 flex items-center gap-1.5">
                  <span className="w-4.5 h-4.5 rounded-full bg-slate-900 text-white flex items-center justify-center text-[10px] font-bold">4</span>
                  <span>Amount to Adjust (₹)</span>
                </label>
                {numAmount > 0 && (
                  <span className="text-xs font-bold text-slate-800">
                    ₹{numAmount.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                  </span>
                )}
              </div>

              <div className="relative">
                <span className="absolute left-3.5 top-2.5 text-base font-bold text-slate-400">₹</span>
                <input
                  ref={amountRef}
                  type="number"
                  step="any"
                  min="0.01"
                  required
                  value={amount}
                  onChange={e => setAmount(e.target.value)}
                  placeholder="0.00"
                  className="w-full pl-8 pr-4 py-2.5 text-base font-bold tabular-nums bg-white border border-slate-300 rounded-lg text-slate-900 placeholder:text-slate-300 focus:border-blue-600 focus:ring-1 focus:ring-blue-600"
                />
              </div>

              {/* Live Amount in Words */}
              {amount && !isNaN(parseFloat(amount)) && parseFloat(amount) > 0 && (
                <div className="mt-1.5 px-3 py-1.5 bg-blue-50/80 border border-blue-100 rounded-lg text-[11px] text-blue-950 flex items-start gap-1.5">
                  <FileText size={13} className="text-blue-600 mt-0.5 shrink-0" />
                  <div className="min-w-0 flex-1">
                    <span className="font-semibold block text-[9.5px] uppercase tracking-wider text-blue-700">Amount in Words:</span>
                    <span className="italic font-medium text-blue-950 leading-tight block">{formatAmountInWords(amount)}</span>
                  </div>
                </div>
              )}

              {/* Live Balance Impact Preview */}
              {selectedParty && numAmount > 0 && (
                <div className="mt-3 p-3 bg-slate-50 border border-slate-200/80 rounded-xl space-y-1 text-xs">
                  <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1 flex items-center gap-1">
                    <span>Balance Projection Calculator</span>
                  </div>
                  <div className="flex justify-between text-slate-600">
                    <span>Current Outstanding:</span>
                    <span className="font-semibold tabular-nums">
                      ₹{Math.abs(currentDue).toLocaleString(undefined, { minimumFractionDigits: 2 })} {currentDue >= 0 ? 'Dr' : 'Cr'}
                    </span>
                  </div>
                  <div className="flex justify-between text-slate-600">
                    <span>Adjustment ({type}):</span>
                    <span className={`font-bold tabular-nums ${type === 'DEBIT' ? 'text-rose-600' : 'text-emerald-600'}`}>
                      {type === 'DEBIT' ? '+' : '-'}₹{numAmount.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                    </span>
                  </div>
                  <div className="pt-1.5 border-t border-slate-200 flex justify-between font-bold text-slate-900 text-sm">
                    <span>Projected Outstanding:</span>
                    <span className={`tabular-nums ${projectedDue > 0 ? 'text-rose-600' : projectedDue < 0 ? 'text-emerald-600' : 'text-slate-800'}`}>
                      ₹{Math.abs(projectedDue).toLocaleString(undefined, { minimumFractionDigits: 2 })} {projectedDue > 0 ? 'Dr (Receivable)' : projectedDue < 0 ? 'Cr (Advance)' : '(Settled)'}
                    </span>
                  </div>
                </div>
              )}
            </div>

            {/* Receipt Auto-Print Option */}
            <div className="pt-2 flex items-center justify-between border-t border-slate-100">
              <label className="flex items-center gap-2 cursor-pointer text-xs text-slate-700 font-medium select-none">
                <input
                  type="checkbox"
                  checked={autoOpenReceipt}
                  onChange={e => setAutoOpenReceipt(e.target.checked)}
                  className="w-4 h-4 text-blue-600 rounded border-slate-300 focus:ring-blue-500"
                />
                <span>Auto-open Professional Thermal Receipt with Company Logo after Submit</span>
              </label>

              <div className="flex items-center gap-1 text-[11px] text-slate-500 font-mono">
                <Receipt size={13} className="text-slate-400" />
                <span> </span>
              </div>
            </div>

            {/* 5. SUBMIT BUTTON */}
            <div className="pt-2">
              <button
                type="submit"
                disabled={isSubmitting || !selectedParty || !note.trim() || numAmount <= 0}
                className={`w-full py-3 px-4 rounded-xl text-white font-bold text-sm shadow-md transition-all flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${
                  type === 'DEBIT'
                    ? 'bg-rose-600 hover:bg-rose-700 active:scale-99'
                    : 'bg-emerald-600 hover:bg-emerald-700 active:scale-99'
                }`}
              >
                {isSubmitting ? (
                  <>
                    <RefreshCw size={16} className="animate-spin" />
                    <span>Processing TR Note...</span>
                  </>
                ) : (
                  <>
                    <Printer size={16} />
                    <span>Submit TR Note ({type}) & Print Thermal Receipt</span>
                  </>
                )}
              </button>
            </div>
          </form>
        </CardBody>
      </Card>

      {/* Recent TR Notes History Section */}
      <Card className="shadow-sm border border-slate-200 overflow-hidden bg-white">
        <CardHeader
          className="bg-slate-50/80 border-b border-slate-200 px-4 sm:px-6 py-3"
          title={
            <div className="flex items-center gap-2">
              <History size={16} className="text-slate-500" />
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700">Recent TR Notes History ({recentTrNotes.length})</h3>
            </div>
          }
          action={
            <button
              onClick={loadData}
              className="p-1 text-slate-400 hover:text-slate-600 rounded transition-colors"
              title="Refresh list"
            >
              <RefreshCw size={14} className={isLoadingParties ? 'animate-spin' : ''} />
            </button>
          }
        />

        <CardBody className="p-0">
          {recentTrNotes.length === 0 ? (
            <div className="p-6 text-center text-xs text-slate-500">
              No recent TR Notes recorded for {activeLedger.name} yet. Submit one using the form above to generate your first thermal receipt.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="bg-slate-100/70 border-b border-slate-200 text-[10px] font-bold uppercase tracking-wider text-slate-500">
                    <th className="py-2.5 px-4">Date & Time</th>
                    <th className="py-2.5 px-4">Voucher / Ref</th>
                    <th className="py-2.5 px-4">Party Name</th>
                    <th className="py-2.5 px-4">Type</th>
                    <th className="py-2.5 px-4 text-right">Amount</th>
                    <th className="py-2.5 px-4">Note</th>
                    <th className="py-2.5 px-4 text-center">Receipt</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {recentTrNotes.map(tx => {
                    const party = parties.find(p => p.id === tx.partyId);
                    const partyName = party ? party.name : 'Unknown Party';
                    return (
                      <tr key={tx.id} className="hover:bg-slate-50/80 transition-colors">
                        <td className="py-2.5 px-4 text-slate-500 whitespace-nowrap">
                          {format(new Date(tx.timestamp), 'dd MMM yyyy, hh:mm a')}
                        </td>
                        <td className="py-2.5 px-4 font-mono font-bold text-slate-800 uppercase whitespace-nowrap">
                          {tx.invoiceNo || tx.id.slice(0, 8)}
                        </td>
                        <td className="py-2.5 px-4 font-bold text-slate-900 whitespace-nowrap">
                          {partyName}
                        </td>
                        <td className="py-2.5 px-4 whitespace-nowrap">
                          <span className={`px-2 py-0.5 rounded text-[10.5px] font-bold ${
                            tx.type === 'DEBIT' ? 'bg-rose-100 text-rose-700' : 'bg-emerald-100 text-emerald-700'
                          }`}>
                            {tx.type}
                          </span>
                        </td>
                        <td className={`py-2.5 px-4 text-right font-bold tabular-nums whitespace-nowrap ${
                          tx.type === 'DEBIT' ? 'text-rose-600' : 'text-emerald-600'
                        }`}>
                          {tx.type === 'DEBIT' ? '-' : '+'}₹{tx.amount.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                        </td>
                        <td className="py-2.5 px-4 text-slate-600 max-w-xs truncate" title={tx.notes}>
                          {tx.notes || '—'}
                        </td>
                        <td className="py-2.5 px-4 text-center whitespace-nowrap">
                          <button
                            type="button"
                            onClick={() => handleOpenReceiptForTx(tx)}
                            className="inline-flex items-center gap-1 px-2.5 py-1 bg-slate-100 hover:bg-[#0055a5] hover:text-white text-slate-700 rounded-md font-bold text-[10.5px] transition-colors shadow-2xs cursor-pointer"
                            title="Print Thermal Receipt"
                          >
                            <Printer size={12} />
                            <span>Thermal Print</span>
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardBody>
      </Card>

      {/* Professional Thermal Receipt Modal with Company Logo on top ("upside") */}
      {receiptTx && (
        <ThermalReceiptModal
          isOpen={isReceiptOpen}
          onClose={() => setIsReceiptOpen(false)}
          transaction={receiptTx}
          partyName={receiptParty.name}
          partyPhone={receiptParty.phone}
          ledgerName={activeLedger.name}
          ledgerType={activeLedger.type}
          customTitle={receiptTx.type === 'DEBIT' ? 'Adjust Note' : 'Adjust Note'}
        />
      )}
    </div>
  );
}
