import React, { useState, useEffect, useRef } from 'react';
import { db, handleFirestoreError, OperationType, collection, doc, setDoc, updateDoc, getDocs, query, orderBy, limit, where } from '../firebase';
import { Party, Transaction } from '../types';
import { useLedger } from '../LedgerContext';
import { v4 as uuidv4 } from 'uuid';
import { 
  Search, 
  Check, 
  Printer, 
  Plus, 
  Minus, 
  CreditCard, 
  Building2, 
  ArrowRight, 
  Sparkles, 
  Info,
  AlertTriangle,
  Receipt,
  FileCheck
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../AuthContext';
import { createTransaction } from '../lib/transactionService';
import { getFilteredCacheItems } from '../lib/idbCache';
import { syncCollection } from '../lib/syncCache';
import ThermalReceiptModal from '../components/ThermalReceiptModal';
import PageHeader from '../components/ui/PageHeader';
import { Card, CardHeader, CardBody } from '../components/ui/Card';
import Badge from '../components/ui/Badge';
import AmountDisplay from '../components/ui/AmountDisplay';

export default function MasterEntry() {
  const { activeLedger } = useLedger();
  const { currentUser } = useAuth();
  const navigate = useNavigate();
  const [parties, setParties] = useState<Party[]>([]);
  const [partySearch, setPartySearch] = useState('');
  const [selectedParty, setSelectedParty] = useState<Party | null>(null);
  
  const [type, setType] = useState<'DEBIT' | 'CREDIT'>('DEBIT');
  const [amount, setAmount] = useState('');
  const [separateCredit, setSeparateCredit] = useState(false);
  const [cashAmount, setCashAmount] = useState('');
  const [acAmount, setAcAmount] = useState('');
  const [invoiceNo, setInvoiceNo] = useState('');
  const [notes, setNotes] = useState('');
  
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isCheckingInvoice, setIsCheckingInvoice] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);
  const [receiptTx, setReceiptTx] = useState<Transaction | null>(null);
  const [receiptPartyName, setReceiptPartyName] = useState<string>('');
  const [receiptPartyPhone, setReceiptPartyPhone] = useState<string>('');
  const [lastSavedTx, setLastSavedTx] = useState<{ transaction: Transaction; partyName: string; partyPhone: string } | null>(null);
  const [autoPrintReceipt, setAutoPrintReceipt] = useState(false);
  const [partyLockedByInvoice, setPartyLockedByInvoice] = useState(false);
  const [lockedInvoiceDetails, setLockedInvoiceDetails] = useState<{amount?: number, date?: number, type: 'DEBIT'|'CREDIT'} | null>(null);

  const isSaleLedger = activeLedger?.type === 'SALE';

  useEffect(() => {
    const loadParties = async () => {
      if (!activeLedger?.id) return;
      try {
        const cached = await getFilteredCacheItems<Party>('parties', p => p.ledgerId === activeLedger.id);
        setParties(cached);
        
        await syncCollection<Party>('parties', activeLedger.id, 'parties');
        
        const fresh = await getFilteredCacheItems<Party>('parties', p => p.ledgerId === activeLedger.id);
        setParties(fresh);
      } catch (err) {
        console.error("MasterEntry: Failed to load parties from cache", err);
      }
    };
    loadParties();
    setInvoiceNo('');

    const handleSync = () => {
      loadParties();
    };
    window.addEventListener('database-synced', handleSync);
    return () => {
      window.removeEventListener('database-synced', handleSync);
    };
  }, [activeLedger?.id, isSaleLedger]);

  const filteredParties = parties.filter(p => {
    const q = (partySearch || '').trim().toLowerCase();
    if (!q) return true;
    
    const phone = p.phone || '';
    if (phone.includes(q)) return true;

    const name = (p.name || '').toLowerCase();
    const terms = q.split(/\s+/).filter(Boolean);
    if (terms.length === 0) return true;

    const matchesAllTerms = terms.every(term => name.includes(term));
    if (matchesAllTerms) return true;

    const initials = name.split(/\s+/).map(w => w.charAt(0)).join('');
    if (initials.includes(q)) return true;

    return false;
  });

  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      if (showConfirmModal) {
        if (e.key === 'Escape') {
          e.preventDefault();
          setShowConfirmModal(false);
          setTimeout(() => notesRef.current?.focus(), 50);
        }
        return;
      }

      if (e.key === 'F2') {
        e.preventDefault();
        handleTypeChange(type === 'DEBIT' ? 'CREDIT' : 'DEBIT');
      }
      if (e.key === 'F3' || (e.altKey && e.key.toLowerCase() === 's')) {
        e.preventDefault();
        setSeparateCredit(prev => !prev);
      }
      if (e.altKey && e.key.toLowerCase() === 'd') {
        e.preventDefault();
        handleTypeChange('DEBIT');
      }
      if (e.altKey && e.key.toLowerCase() === 'c') {
        e.preventDefault();
        handleTypeChange('CREDIT');
      }
    };
    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => window.removeEventListener('keydown', handleGlobalKeyDown);
  }, [type, separateCredit, amount, showConfirmModal]);

  const [alertInfo, setAlertInfo] = useState<{message: string; isError: boolean; title?: string} | null>(null);

  const invoiceRef = useRef<HTMLInputElement>(null);
  const partySearchRef = useRef<HTMLInputElement>(null);
  const amountRef = useRef<HTMLInputElement>(null);
  const cashAmountRef = useRef<HTMLInputElement>(null);
  const acAmountRef = useRef<HTMLInputElement>(null);
  const notesRef = useRef<HTMLTextAreaElement>(null);
  const confirmBtnRef = useRef<HTMLButtonElement>(null);

  const [searchSelectedIndex, setSearchSelectedIndex] = useState(0);

  useEffect(() => {
    if (activeLedger && invoiceRef.current) {
      setTimeout(() => invoiceRef.current?.focus(), 100);
    }
  }, [activeLedger?.id]);

  useEffect(() => {
    if (showConfirmModal && confirmBtnRef.current) {
      setTimeout(() => confirmBtnRef.current?.focus(), 100);
    }
  }, [showConfirmModal]);

  useEffect(() => {
    setSearchSelectedIndex(0);
  }, [partySearch]);

  useEffect(() => {
    if (showSuccess) {
      const timer = setTimeout(() => {
        setShowSuccess(false);
        if (invoiceRef.current) {
          invoiceRef.current.focus();
        }
      }, 2000);
      return () => clearTimeout(timer);
    }
  }, [showSuccess]);

  useEffect(() => {
    if (!showSuccess) return;
    const handleSuccessKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ' || e.key === 'Escape') {
        e.preventDefault();
        setShowSuccess(false);
        setTimeout(() => {
          invoiceRef.current?.focus();
        }, 10);
      }
    };
    window.addEventListener('keydown', handleSuccessKeyDown);
    return () => window.removeEventListener('keydown', handleSuccessKeyDown);
  }, [showSuccess]);

  const handleInvoiceKeyDown = async (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const result = await checkInvoice();
      if (result) {
        if (result === true && !selectedParty) {
          partySearchRef.current?.focus();
        } else {
          if (type === 'CREDIT' && separateCredit) {
            cashAmountRef.current?.focus();
          } else {
            amountRef.current?.focus();
          }
        }
      }
    }
  };

  const handlePartySearchKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSearchSelectedIndex(prev => Math.min(prev + 1, filteredParties.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSearchSelectedIndex(prev => Math.max(prev - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (filteredParties.length > 0 && searchSelectedIndex >= 0) {
        setSelectedParty(filteredParties[searchSelectedIndex]);
        setPartySearch('');
        setSearchSelectedIndex(0);
        setTimeout(() => {
          if (type === 'CREDIT' && separateCredit) {
            cashAmountRef.current?.focus();
          } else {
            amountRef.current?.focus();
          }
        }, 10);
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      invoiceRef.current?.focus();
    }
  };

  const handleAmountKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (e.shiftKey) {
        invoiceRef.current?.focus();
      } else {
        notesRef.current?.focus();
      }
    }
  };

  const handleCashAmountKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (e.shiftKey) {
        invoiceRef.current?.focus();
      } else {
        acAmountRef.current?.focus();
      }
    }
  };

  const handleAcAmountKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (e.shiftKey) {
        cashAmountRef.current?.focus();
      } else {
        notesRef.current?.focus();
      }
    }
  };

  const handleNotesKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (e.shiftKey) {
        if (type === 'CREDIT' && separateCredit) {
          acAmountRef.current?.focus();
        } else {
          amountRef.current?.focus();
        }
      } else {
        const isOk = type === 'CREDIT' && separateCredit
          ? ((parseFloat(cashAmount) || 0) + (parseFloat(acAmount) || 0) > 0)
          : (amount && !isNaN(Number(amount)) && Number(amount) > 0);
        if (selectedParty && isOk) {
          handlePreSubmit(e as any);
        }
      }
    }
  };

  const handleTypeChange = (newType: 'DEBIT' | 'CREDIT') => {
    setType(newType);
    if (newType === 'CREDIT') {
      if (separateCredit) {
        if (amount && !cashAmount && !acAmount) {
          setCashAmount(amount);
        }
        setTimeout(() => cashAmountRef.current?.focus(), 50);
      } else {
        setTimeout(() => amountRef.current?.focus(), 50);
      }
    } else {
      if (separateCredit && !amount && (cashAmount || acAmount)) {
        const cVal = parseFloat(cashAmount) || 0;
        const aVal = parseFloat(acAmount) || 0;
        setAmount((cVal + aVal).toString());
      }
      setTimeout(() => amountRef.current?.focus(), 50);
    }
  };

  useEffect(() => {
    if (type === 'CREDIT') {
      if (separateCredit) {
        if (amount && !cashAmount && !acAmount) {
          setCashAmount(amount);
        }
      }
    } else {
      if (separateCredit && !amount && (cashAmount || acAmount)) {
        const cVal = parseFloat(cashAmount) || 0;
        const aVal = parseFloat(acAmount) || 0;
        setAmount((cVal + aVal).toString());
      }
    }
  }, [type, separateCredit]);

  useEffect(() => {
    if (separateCredit) {
      if (amount && !cashAmount && !acAmount) {
        setCashAmount(amount);
      }
    } else {
      const cVal = parseFloat(cashAmount) || 0;
      const aVal = parseFloat(acAmount) || 0;
      if (cVal + aVal > 0) {
        setAmount((cVal + aVal).toString());
      }
    }
  }, [separateCredit]);

  const handleInvoiceCheck = async (isPreSubmit: boolean): Promise<boolean | string> => {
    if (!invoiceNo || !activeLedger) return true;
    if (!isSaleLedger) return true;
    setIsCheckingInvoice(true);
    try {
      const normalizedInvoice = invoiceNo.toLowerCase().trim();
      const qTracked = query(collection(db, 'tracked_invoices'), where('ledgerId', '==', activeLedger.id), where('invoiceNo', '==', normalizedInvoice));
      const trackedSnap = await getDocs(qTracked);
      const trackedDocs = trackedSnap.docs.map(d => d.data());
      
      const qTx = query(collection(db, 'transactions'), where('ledgerId', '==', activeLedger.id), where('invoiceNo', '==', normalizedInvoice));
      const txSnap = await getDocs(qTx);
      const matchedTxs = txSnap.docs.map(d => d.data() as Transaction);

      const debitTx = matchedTxs.find(t => t.type === 'DEBIT');
      const creditTx = matchedTxs.find(t => t.type === 'CREDIT');
      
      const debitTracked = trackedDocs.find(t => t.type === 'DEBIT');
      const creditTracked = trackedDocs.find(t => t.type === 'CREDIT');

      const hasDebit = !!(debitTx || debitTracked);
      const hasCredit = !!(creditTx || creditTracked);

      if (!hasDebit && !hasCredit) {
        setPartyLockedByInvoice(false);
        setLockedInvoiceDetails(null);
        return true; 
      }

      const formatTxDetails = (tx: Transaction | undefined, tTracked: any | undefined): string => {
        if (tx) {
           const pt = parties.find(p => p.id === tx.partyId);
           const pName = pt ? pt.name : 'Unknown Party';
           const dateStr = new Date(tx.timestamp).toLocaleDateString();
           return `Party: ${pName}\nAmount: ₹${tx.amount.toFixed(2)}\nDate: ${dateStr}`;
        }
        if (tTracked) {
           const dateStr = new Date(tTracked.timestamp).toLocaleDateString();
           return `Marked directly in Invoice Sheet\nDate: ${dateStr}`;
        }
        return 'Not entered';
      };

      if (hasDebit && hasCredit) {
         setPartyLockedByInvoice(false);
         setLockedInvoiceDetails(null);
         setAlertInfo({ 
           title: "Invoice Fully Completed",
           message: `This invoice ID is already in both sheets.\nBoth are listed. You cannot use this invoice number again.\n\n-- DEBIT ENTRY --\n${formatTxDetails(debitTx, debitTracked)}\n\n-- CREDIT ENTRY --\n${formatTxDetails(creditTx, creditTracked)}`, 
           isError: true 
         });
         return false;
      }

      let effectiveType = type;
      if (hasDebit && !hasCredit) {
         effectiveType = 'CREDIT';
         if (type !== 'CREDIT') {
           setType('CREDIT');
         }
      } else if (hasCredit && !hasDebit) {
         effectiveType = 'DEBIT';
         if (type !== 'DEBIT') {
           setType('DEBIT');
         }
      }

      if (effectiveType === 'DEBIT' && hasDebit) {
         const foundPartyId = debitTx?.partyId || debitTracked?.partyId;
         const pt = parties.find(p => p.id === foundPartyId);
         const pName = pt ? pt.name : 'Unknown Party';
         setAlertInfo({ 
           title: "Duplicate Invoice Entry Not Allowed",
           message: `Invoice #${invoiceNo.toUpperCase()} is ALREADY listed as a DEBIT entry for ${pName}.\n\n-- EXISTING ENTRY --\n${formatTxDetails(debitTx, debitTracked)}\n\nDuplicate DEBIT entries for the same invoice are not valid.`, 
           isError: true 
         });
         return false;
      }

      if (effectiveType === 'CREDIT' && hasCredit) {
         const foundPartyId = creditTx?.partyId || creditTracked?.partyId;
         const pt = parties.find(p => p.id === foundPartyId);
         const pName = pt ? pt.name : 'Unknown Party';
         setAlertInfo({ 
           title: "Duplicate Invoice Entry Not Allowed",
           message: `Invoice #${invoiceNo.toUpperCase()} is ALREADY listed as a CREDIT entry for ${pName}.\n\n-- EXISTING ENTRY --\n${formatTxDetails(creditTx, creditTracked)}\n\nDuplicate CREDIT entries for the same invoice are not valid.`, 
           isError: true 
         });
         return false;
      }

      const foundPartyId = hasDebit ? (debitTx?.partyId || debitTracked?.partyId) : (creditTx?.partyId || creditTracked?.partyId);
      
      const lockedData: any = {};
      if (hasDebit && debitTx) {
        lockedData.amount = debitTx.amount;
        lockedData.date = debitTx.timestamp;
        lockedData.type = 'DEBIT';
      } else if (hasCredit && creditTx) {
        lockedData.amount = creditTx.amount;
        lockedData.date = creditTx.timestamp;
        lockedData.type = 'CREDIT';
      }

      if (foundPartyId) {
          const party = parties.find(p => p.id === foundPartyId);
          if (party) {
              setSelectedParty(party);
              setPartyLockedByInvoice(true);
              if (lockedData.type) {
                setLockedInvoiceDetails(lockedData);
              }
              if (lockedData.amount && !amount && !cashAmount && !acAmount) {
                setAmount(lockedData.amount.toString());
              }
              return party.id;
          }
      }

      return true;
    } catch (err) {
      console.error("Error validating invoice", err);
      return true;
    } finally {
      setIsCheckingInvoice(false);
    }
  };

  const handleInvoiceBlur = async () => {
    if (invoiceNo && document.activeElement !== document.body) {
      setTimeout(async () => {
        if (!selectedParty) {
          await handleInvoiceCheck(false);
        }
      }, 200);
    }
  };

  const checkInvoice = async () => {
    return await handleInvoiceCheck(true);
  };

  const handlePreSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (invoiceNo && activeLedger) {
      const isOk = await checkInvoice();
      if (!isOk) return;
    }

    if (!selectedParty) {
      setAlertInfo({ message: "Please select an account party first.", isError: true });
      return;
    }
    if (type === 'CREDIT' && separateCredit) {
      const cashVal = parseFloat(cashAmount) || 0;
      const acVal = parseFloat(acAmount) || 0;
      const totalVal = cashVal + acVal;
      if (totalVal <= 0) {
        setAlertInfo({ message: "Please enter a valid Cash Credit or A/C Credit amount.", isError: true });
        return;
      }
    } else {
      if (!amount || isNaN(Number(amount)) || Number(amount) <= 0) {
        setAlertInfo({ message: "Please enter a valid voucher amount.", isError: true });
        return;
      }
    }
    if (!invoiceNo.trim() && !notes.trim()) {
      setAlertInfo({ 
        title: "Required Information Missing",
        message: "At least one of Reference/Invoice No. or Description Notes is required to record a transaction voucher.", 
        isError: true 
      });
      return;
    }

    setShowConfirmModal(true);
  };

  const handleConfirmSubmit = async () => {
    if (isSubmitting || !selectedParty || !activeLedger) return;
    
    let numAmount = 0;
    let finalNotes = notes.trim();

    if (type === 'CREDIT' && separateCredit) {
      const cashVal = parseFloat(cashAmount) || 0;
      const acVal = parseFloat(acAmount) || 0;
      numAmount = cashVal + acVal;
      if (numAmount <= 0) return;

      const breakdownParts: string[] = [];
      if (cashVal > 0) breakdownParts.push(`Cash: ₹${cashVal.toFixed(2)}`);
      if (acVal > 0) breakdownParts.push(`A/C: ₹${acVal.toFixed(2)}`);
      if (breakdownParts.length > 0) {
        const breakdownStr = `[${breakdownParts.join(', ')}]`;
        finalNotes = finalNotes ? `${breakdownStr} - ${finalNotes}` : breakdownStr;
      }
    } else {
      if (!amount) return;
      numAmount = parseFloat(amount);
    }

    setIsSubmitting(true);
    
    try {
      const txId = uuidv4();
      const newTx: Transaction = {
        id: txId,
        partyId: selectedParty.id,
        ledgerId: activeLedger.id,
        invoiceNo: invoiceNo.toLowerCase().trim(),
        type,
        amount: numAmount,
        timestamp: Date.now(),
        notes: finalNotes
      };

      const balanceChange = newTx.type === 'DEBIT' ? newTx.amount : -newTx.amount;
      const updatedPartyDue = selectedParty.currentDue + balanceChange;
      
      setLastSavedTx({
        transaction: {
          ...newTx,
          runningBalance: updatedPartyDue
        },
        partyName: selectedParty.name,
        partyPhone: selectedParty.phone || ''
      });

      setAmount('');
      setCashAmount('');
      setAcAmount('');
      setNotes('');
      setSelectedParty(null);
      setPartySearch('');
      setShowConfirmModal(false);
      setInvoiceNo('');
      setShowSuccess(true);
      setIsSubmitting(false);

      createTransaction(newTx, selectedParty).catch(e => {
        handleFirestoreError(e, OperationType.CREATE, 'transactions');
      });
      return;
    } catch (e) {
      handleFirestoreError(e, OperationType.CREATE, 'transactions');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!activeLedger) return <div className="p-8 text-center text-slate-500 font-medium">Please select a ledger.</div>;

  return (
    <div className="p-3 min-[400px]:p-4 sm:p-8 max-w-3xl mx-auto w-full pb-20 sm:pb-8 space-y-3.5 sm:space-y-6">
      {/* Page Header */}
      <PageHeader
        title={activeLedger.type === 'PURCHASE' ? "Purchase Voucher Entry" : "Journal Voucher Entry"}
        subtitle={`Fast-post general ledger transactions to ${activeLedger.name}`}
      />

      {/* Main Voucher Entry Card */}
      <Card>
        <div className="p-3.5 sm:p-6">
          <form onSubmit={handlePreSubmit} className="space-y-3.5 sm:space-y-5">
            {/* Voucher Type & Invoice/Ref Number */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
              <div>
                <label className="block text-[11px] sm:text-xs font-bold uppercase tracking-wider text-slate-700 mb-1 sm:mb-1.5 flex items-center justify-between">
                  <span>Voucher Type</span>
                  <span className="text-[10px] text-slate-400 font-normal">Press F2 to toggle</span>
                </label>
                <div className="grid grid-cols-2 gap-1.5 sm:gap-2 bg-slate-100 p-1 rounded-xl border border-slate-200">
                  <button
                    type="button"
                    onClick={() => handleTypeChange('DEBIT')}
                    className={`py-1.5 sm:py-2 px-2.5 sm:px-3 text-xs font-bold rounded-lg transition-all flex items-center justify-center gap-1 sm:gap-1.5 ${
                      type === 'DEBIT' 
                        ? 'bg-rose-600 text-white shadow-2xs' 
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    <Minus size={13} />
                    Debit (Dr)
                  </button>
                  <button
                    type="button"
                    onClick={() => handleTypeChange('CREDIT')}
                    className={`py-1.5 sm:py-2 px-2.5 sm:px-3 text-xs font-bold rounded-lg transition-all flex items-center justify-center gap-1 sm:gap-1.5 ${
                      type === 'CREDIT' 
                        ? 'bg-emerald-600 text-white shadow-2xs' 
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    <Plus size={13} />
                    Credit (Cr)
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-[11px] sm:text-xs font-bold uppercase tracking-wider text-slate-700 mb-1 sm:mb-1.5">
                  {isSaleLedger ? 'Invoice Number' : 'Reference / Bill No.'}
                </label>
                <div className="relative">
                  <input
                    ref={invoiceRef}
                    type="text"
                    value={invoiceNo}
                    onKeyDown={handleInvoiceKeyDown}
                    onBlur={handleInvoiceBlur}
                    onChange={e => { setInvoiceNo(e.target.value.toLowerCase()); setPartyLockedByInvoice(false); setLockedInvoiceDetails(null); }}
                    className="w-full px-3 py-1.5 sm:px-3.5 sm:py-2 bg-white border border-slate-300 rounded-lg focus:border-blue-600 text-xs sm:text-sm font-mono font-semibold text-slate-900 placeholder:text-slate-400"
                    placeholder="e.g. 1045 or INV-009"
                  />
                  {isCheckingInvoice && (
                    <div className="absolute right-3 top-2 flex items-center justify-center">
                      <div className="animate-spin rounded-full h-3.5 w-3.5 border-2 border-blue-600 border-t-transparent"></div>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Party Selection Section */}
            <div className="space-y-1">
              <label className="block text-[11px] sm:text-xs font-bold uppercase tracking-wider text-slate-700">
                Account Party <span className="text-rose-500">*</span>
              </label>

              {partyLockedByInvoice && selectedParty ? (
                <div className="p-3 border rounded-xl border-blue-200 bg-blue-50/50 flex flex-col space-y-1">
                  <div className="flex items-center justify-between">
                    <div>
                      <span className="font-bold text-slate-900 text-xs sm:text-sm">{selectedParty.name}</span>
                      <span className="text-slate-500 text-[11px] font-mono ml-2">{selectedParty.phone || 'No phone'}</span>
                    </div>
                    <Badge variant="navy" size="xs">Locked by Invoice</Badge>
                  </div>
                  {lockedInvoiceDetails && (
                    <div className="text-[11px] text-blue-700 font-semibold flex justify-between pt-1 border-t border-blue-100">
                      <span>Prior {lockedInvoiceDetails.type}: ₹{lockedInvoiceDetails.amount?.toFixed(2)}</span>
                      <span>Date: {lockedInvoiceDetails.date ? new Date(lockedInvoiceDetails.date).toLocaleDateString() : '-'}</span>
                    </div>
                  )}
                </div>
              ) : !selectedParty ? (
                <div className="relative">
                  <Search className="absolute left-3 top-2 text-slate-400" size={14} />
                  <input
                    type="text"
                    ref={partySearchRef}
                    placeholder={isSaleLedger && !invoiceNo.trim() ? "Enter Invoice No. first to search party..." : "Search party by business name or phone..."}
                    value={partySearch}
                    onChange={e => setPartySearch(e.target.value)}
                    onKeyDown={handlePartySearchKeyDown}
                    disabled={isSaleLedger && !invoiceNo.trim()}
                    className="w-full pl-8.5 pr-3 py-1.5 sm:py-2 bg-white border border-slate-300 rounded-lg focus:border-blue-600 text-xs sm:text-sm font-medium disabled:bg-slate-50 disabled:cursor-not-allowed"
                  />
                  
                  {partySearch && (
                    <div className="absolute z-20 w-full mt-1 bg-white border border-slate-200 rounded-xl shadow-xl max-h-52 overflow-y-auto divide-y divide-slate-100">
                      {filteredParties.length > 0 ? (
                        filteredParties.map((p, idx) => (
                          <button
                            key={p.id}
                            type="button"
                            onClick={() => { 
                              setSelectedParty(p); 
                              setPartySearch(''); 
                              setTimeout(() => amountRef.current?.focus(), 10);
                            }}
                            className={`w-full text-left px-3.5 py-2 flex justify-between items-center transition-all ${
                              idx === searchSelectedIndex ? 'bg-blue-50 border-l-4 border-blue-600 pl-2.5' : 'hover:bg-slate-50'
                            }`}
                          >
                            <span className="font-bold text-slate-900 text-xs sm:text-sm">{p.name}</span>
                            <span className="text-slate-500 font-mono text-[11px]">{p.phone}</span>
                          </button>
                        ))
                      ) : (
                        <div className="px-3.5 py-2.5 text-slate-400 text-xs font-semibold text-center">
                          No matching account parties found.
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ) : (
                <div className="flex items-center justify-between p-3 border border-slate-200 rounded-xl bg-slate-50">
                  <div>
                    <div className="font-bold text-slate-900 text-xs sm:text-sm">{selectedParty.name}</div>
                    <div className="text-[11px] text-slate-500 mt-0.5 flex items-center gap-2">
                      <span>Current Due:</span>
                      <AmountDisplay amount={selectedParty.currentDue} showDrCr={true} size="xs" />
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => { setSelectedParty(null); setTimeout(() => partySearchRef.current?.focus(), 10); }}
                    className="text-xs font-bold text-blue-600 hover:text-blue-700 bg-white border border-slate-200 px-2.5 py-1 rounded-lg shadow-2xs transition-colors"
                  >
                    Change
                  </button>
                </div>
              )}
            </div>

            {/* Split Cash vs A/C Toggle */}
            {type === 'CREDIT' && (
              <div className="flex items-center gap-2 p-2 bg-slate-50 rounded-lg border border-slate-200">
                <input
                  type="checkbox"
                  id="masterSeparateCredit"
                  checked={separateCredit}
                  onChange={e => setSeparateCredit(e.target.checked)}
                  className="h-3.5 w-3.5 rounded border-slate-300 text-blue-600 cursor-pointer"
                />
                <label htmlFor="masterSeparateCredit" className="text-xs font-bold text-slate-700 cursor-pointer select-none">
                  Separate Cash & Bank Account Credit (F3)
                </label>
              </div>
            )}

            {/* Amount Entry Fields */}
            {type === 'CREDIT' && separateCredit ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
                <div>
                  <label className="block text-[11px] sm:text-xs font-bold uppercase tracking-wider text-emerald-700 mb-1">Cash Credit (₹)</label>
                  <input
                    ref={cashAmountRef}
                    onKeyDown={handleCashAmountKeyDown}
                    type="number"
                    step="0.01"
                    min="0"
                    value={cashAmount}
                    onChange={e => {
                      setCashAmount(e.target.value);
                      const cVal = parseFloat(e.target.value) || 0;
                      const aVal = parseFloat(acAmount) || 0;
                      setAmount(cVal + aVal > 0 ? (cVal + aVal).toString() : '');
                    }}
                    disabled={isSaleLedger && !invoiceNo.trim()}
                    className="w-full px-3 py-1.5 sm:px-3.5 sm:py-2 bg-white border border-slate-300 rounded-lg text-xs sm:text-sm font-mono font-bold text-slate-900 focus:border-emerald-600"
                    placeholder="0.00"
                  />
                </div>
                <div>
                  <label className="block text-[11px] sm:text-xs font-bold uppercase tracking-wider text-blue-700 mb-1">Bank A/C Credit (₹)</label>
                  <input
                    ref={acAmountRef}
                    onKeyDown={handleAcAmountKeyDown}
                    type="number"
                    step="0.01"
                    min="0"
                    value={acAmount}
                    onChange={e => {
                      setAcAmount(e.target.value);
                      const cVal = parseFloat(cashAmount) || 0;
                      const aVal = parseFloat(e.target.value) || 0;
                      setAmount(cVal + aVal > 0 ? (cVal + aVal).toString() : '');
                    }}
                    disabled={isSaleLedger && !invoiceNo.trim()}
                    className="w-full px-3 py-1.5 sm:px-3.5 sm:py-2 bg-white border border-slate-300 rounded-lg text-xs sm:text-sm font-mono font-bold text-slate-900 focus:border-blue-600"
                    placeholder="0.00"
                  />
                </div>
              </div>
            ) : (
              <div>
                <label className="block text-[11px] sm:text-xs font-bold uppercase tracking-wider text-slate-700 mb-1">
                  Voucher Amount (₹) <span className="text-rose-500">*</span>
                </label>
                <input
                  ref={amountRef}
                  onKeyDown={handleAmountKeyDown}
                  type="number"
                  step="0.01"
                  min="0.01"
                  value={amount}
                  onChange={e => setAmount(e.target.value)}
                  disabled={isSaleLedger && !invoiceNo.trim()}
                  className="w-full px-3 py-2 sm:px-3.5 sm:py-2.5 bg-white border border-slate-300 rounded-lg text-sm sm:text-base font-mono font-bold text-slate-900 focus:border-blue-600 placeholder:text-slate-400"
                  placeholder="0.00"
                />
              </div>
            )}

            {/* Particulars & Notes */}
            <div>
              <label className="block text-[11px] sm:text-xs font-bold uppercase tracking-wider text-slate-700 mb-1">
                Particulars / Description
              </label>
              <textarea
                ref={notesRef}
                onKeyDown={handleNotesKeyDown}
                value={notes}
                onChange={e => setNotes(e.target.value)}
                disabled={isSaleLedger && !invoiceNo.trim()}
                className="w-full px-3 py-1.5 sm:px-3.5 sm:py-2 bg-white border border-slate-300 rounded-lg text-xs sm:text-sm text-slate-900 focus:border-blue-600"
                rows={2}
                placeholder="e.g. Being goods supplied as per delivery challan / Payment via RTGS"
              />
            </div>

            {/* Submission Action */}
            <div className="pt-3 border-t border-slate-100 flex justify-end">
              <button
                type="submit"
                disabled={isSubmitting || (isSaleLedger && !invoiceNo.trim())}
                className="w-full sm:w-auto px-5 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-bold shadow-2xs transition-colors flex items-center justify-center gap-1.5 disabled:opacity-50"
              >
                Review Voucher & Post
                <ArrowRight size={13} />
              </button>
            </div>
          </form>
        </div>
      </Card>

      {/* Confirmation Modal */}
      {showConfirmModal && selectedParty && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-sm border border-slate-200 overflow-hidden text-xs">
            <div className="px-5 py-4 border-b border-slate-100 bg-slate-50">
              <h3 className="font-bold text-slate-900 text-sm">Review & Post Voucher</h3>
            </div>
            <div className="p-5 space-y-3">
              <div className="flex justify-between">
                <span className="text-slate-500">Party Account:</span>
                <span className="font-bold text-slate-900">{selectedParty.name}</span>
              </div>
              {(isSaleLedger || invoiceNo) && (
                <div className="flex justify-between">
                  <span className="text-slate-500">{isSaleLedger ? 'Invoice No:' : 'Reference:'}</span>
                  <span className="font-mono text-slate-900">{invoiceNo || '-'}</span>
                </div>
              )}
              <div className="flex justify-between">
                <span className="text-slate-500">Voucher Type:</span>
                <span className={`font-bold ${type === 'DEBIT' ? 'text-rose-600' : 'text-emerald-600'}`}>{type}</span>
              </div>
              <div className="flex justify-between border-t border-slate-200 pt-2 font-bold text-sm">
                <span className="text-slate-700">Total Amount:</span>
                <span className="font-mono text-slate-900">
                  ₹{type === 'CREDIT' && separateCredit
                    ? ((parseFloat(cashAmount) || 0) + (parseFloat(acAmount) || 0)).toFixed(2)
                    : parseFloat(amount).toFixed(2)}
                </span>
              </div>
            </div>
            <div className="p-4 border-t border-slate-100 bg-slate-50 flex justify-end gap-2">
              <button 
                onClick={() => setShowConfirmModal(false)}
                disabled={isSubmitting}
                className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-lg font-semibold"
              >
                Cancel
              </button>
              <button 
                ref={confirmBtnRef}
                onClick={handleConfirmSubmit}
                disabled={isSubmitting}
                className={`px-5 py-2 text-white rounded-lg font-bold shadow-xs ${
                  type === 'DEBIT' ? 'bg-rose-600 hover:bg-rose-700' : 'bg-emerald-600 hover:bg-emerald-700'
                }`}
              >
                {isSubmitting ? 'Posting...' : 'Confirm & Save'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Alert Notice Modal */}
      {alertInfo && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-sm border border-slate-200 overflow-hidden text-xs">
            <div className={`p-4 border-b ${alertInfo.isError ? 'bg-rose-50 border-rose-100' : 'bg-blue-50 border-blue-100'}`}>
              <h3 className={`font-bold text-sm flex items-center gap-1.5 ${alertInfo.isError ? 'text-rose-700' : 'text-blue-700'}`}>
                <AlertTriangle size={16} />
                {alertInfo.title || (alertInfo.isError ? 'Validation Notice' : 'Notice')}
              </h3>
            </div>
            <div className="p-5">
              <p className="text-slate-700 whitespace-pre-wrap leading-relaxed">{alertInfo.message}</p>
            </div>
            <div className="p-4 border-t border-slate-100 bg-slate-50 flex justify-end">
              <button 
                autoFocus
                onClick={() => {
                  setAlertInfo(null);
                  setTimeout(() => {
                    if (alertInfo.isError) {
                      invoiceRef.current?.focus();
                    } else {
                      amountRef.current?.focus();
                    }
                  }, 50);
                }}
                className="px-5 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-lg font-bold shadow-xs"
              >
                Acknowledge
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Thermal Receipt Modal */}
      {receiptTx && (
        <ThermalReceiptModal
          isOpen={true}
          onClose={() => {
            setReceiptTx(null);
            setAutoPrintReceipt(false);
          }}
          transaction={receiptTx}
          partyName={receiptPartyName}
          partyPhone={receiptPartyPhone}
          ledgerName={activeLedger?.name || 'Ledger'}
          isPurchaseStyle={activeLedger?.type === 'PURCHASE' || activeLedger?.type === 'LIABILITY' || activeLedger?.type === 'CAPITAL'}
          autoPrint={autoPrintReceipt}
        />
      )}

      {/* Success Notification Banner Modal */}
      {showSuccess && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-xs">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-xs p-6 text-center space-y-4 border border-slate-200">
            <div className="w-14 h-14 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center mx-auto">
              <Check size={28} />
            </div>
            <div>
              <h3 className="font-extrabold text-slate-900 text-base">Voucher Posted!</h3>
              <p className="text-xs text-slate-500 mt-0.5">Recorded in {activeLedger?.name}</p>
            </div>
            <button
              type="button"
              onClick={() => {
                setShowSuccess(false);
                if (invoiceRef.current) {
                  invoiceRef.current.focus();
                }
              }}
              className="w-full py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-lg text-xs font-bold"
            >
              Post Next Voucher (Enter)
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
