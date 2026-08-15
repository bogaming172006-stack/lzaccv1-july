import React, { useState, useEffect, useRef } from 'react';
import { db, handleFirestoreError, OperationType, collection, doc, setDoc, updateDoc, getDocs, query, orderBy, limit, where } from '../firebase';
import { Party, Transaction } from '../types';
import { useLedger } from '../LedgerContext';
import { v4 as uuidv4 } from 'uuid';
import { Search, Check, Printer } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../AuthContext';
import { createTransaction } from '../lib/transactionService';
import { getFilteredCacheItems } from '../lib/idbCache';
import { syncCollection } from '../lib/syncCache';
import ThermalReceiptModal from '../components/ThermalReceiptModal';

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
        // 1. Fast optimistic load from local IndexedDB cache
        const cached = await getFilteredCacheItems<Party>('parties', p => p.ledgerId === activeLedger.id);
        setParties(cached);
        
        // 2. Sync in background with Firestore safely
        await syncCollection<Party>('parties', activeLedger.id, 'parties');
        
        // 3. Load updated list from cache
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

  // Global hotkeys to toggle and change types instantly for fast entry
  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      // If confirm modal is open, Escape will cancel and focus notes field
      if (showConfirmModal) {
        if (e.key === 'Escape') {
          e.preventDefault();
          setShowConfirmModal(false);
          setTimeout(() => notesRef.current?.focus(), 50);
        }
        return;
      }

      // Toggle type with F2 key
      if (e.key === 'F2') {
        e.preventDefault();
        handleTypeChange(type === 'DEBIT' ? 'CREDIT' : 'DEBIT');
      }
      // Toggle separateCredit with F3 or Alt+S
      if (e.key === 'F3' || (e.altKey && e.key.toLowerCase() === 's')) {
        e.preventDefault();
        setSeparateCredit(prev => !prev);
      }
      // Direct shortcut keys
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

  // Speed entry: dismiss success modal instantly on pressing Enter, Space or Escape
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
        // Only submit if amount and party are selected
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
    if (!isSaleLedger) return true; // Only validate invoices in sale ledgers
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

      // Auto switch transaction type to opposite if one side is already listed
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

      // Check if user is attempting to create a duplicate entry of the same type
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

      // Matching invoice of opposite type found
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
              // Auto-fill amount if currently empty
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
      // Small delay to allow 'Enter' key handler or other clicks to process first if they did
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
      setAlertInfo({ message: "Please select a party first.", isError: true });
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
        setAlertInfo({ message: "Please enter a valid amount.", isError: true });
        return;
      }
    }
    if (!invoiceNo.trim() && !notes.trim()) {
      setAlertInfo({ 
        title: "Required Information Missing",
        message: "At least one of Reference/Invoice No. or Notes is required to record a transaction.", 
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
        notes: finalNotes,
        createdBy: currentUser?.name || 'Admin'
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

      // Optimistically reset form and close confirm modal instantly
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

      // Save transaction in background
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

  if (!activeLedger) return <div className="p-8 text-center text-gray-500">Please select a ledger.</div>;

  return (
    <div className="p-3 sm:p-8 max-w-2xl mx-auto w-full pb-24 sm:pb-8 animate-fade-in">
      <div className="mb-5 sm:mb-8">
        <h1 className="text-lg sm:text-2xl font-black text-gray-950 dark:text-white tracking-tight">
          New Entry
        </h1>
        <p className="text-xs sm:text-sm text-gray-500 mt-0.5 font-medium">Log a transaction to {activeLedger.name}</p>
      </div>

      <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-xs border border-gray-100 dark:border-gray-800 overflow-hidden p-4 sm:p-6 text-sm">
        <form onSubmit={handlePreSubmit} className="space-y-4 sm:space-y-5">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-[10px] font-bold uppercase tracking-wider text-gray-400 dark:text-gray-500 mb-1.5">
                Transaction Type
              </label>
              <div className="flex bg-gray-50 dark:bg-gray-950 p-1 rounded-xl border border-gray-150/50 dark:border-gray-800/60">
                <button
                  type="button"
                  onClick={() => handleTypeChange('DEBIT')}
                  className={`flex-1 py-1.5 text-xs font-extrabold rounded-lg transition-all ${type === 'DEBIT' ? 'bg-white dark:bg-gray-900 text-rose-600 shadow-xs' : 'text-gray-400 hover:text-gray-600'}`}
                >
                  DEBIT
                </button>
                <button
                  type="button"
                  onClick={() => handleTypeChange('CREDIT')}
                  className={`flex-1 py-1.5 text-xs font-extrabold rounded-lg transition-all ${type === 'CREDIT' ? 'bg-white dark:bg-gray-900 text-emerald-600 shadow-xs' : 'text-gray-400 hover:text-gray-600'}`}
                >
                  CREDIT
                </button>
              </div>
            </div>

            {isSaleLedger ? (
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-wider text-gray-400 dark:text-gray-500 mb-1.5">
                  Invoice No
                </label>
                <div className="relative">
                  <input
                    ref={invoiceRef}
                    type="text"
                    value={invoiceNo}
                    onKeyDown={handleInvoiceKeyDown}
                    onBlur={handleInvoiceBlur}
                    onChange={e => { setInvoiceNo(e.target.value.toLowerCase()); setPartyLockedByInvoice(false); setLockedInvoiceDetails(null); }}
                    className="w-full px-3 py-1.5 sm:py-2 bg-gray-50 dark:bg-gray-950 border border-gray-150 dark:border-gray-800 rounded-xl focus:bg-white dark:focus:bg-gray-950 focus:border-sky-500 focus:ring-1 focus:ring-sky-500 text-sm font-semibold text-gray-900 dark:text-white"
                    placeholder="Enter Invoice No"
                  />
                  {isCheckingInvoice && (
                    <div className="absolute right-3 top-2.5 sm:top-3 flex items-center justify-center">
                      <div className="animate-spin rounded-full h-3.5 w-3.5 border-2 border-sky-500 border-t-transparent"></div>
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-wider text-gray-400 dark:text-gray-500 mb-1.5">
                  Reference No. (Optional)
                </label>
                <div className="relative">
                  <input
                    ref={invoiceRef}
                    type="text"
                    value={invoiceNo}
                    onKeyDown={handleInvoiceKeyDown}
                    onBlur={handleInvoiceBlur}
                    onChange={e => { setInvoiceNo(e.target.value.toLowerCase()); setPartyLockedByInvoice(false); setLockedInvoiceDetails(null); }}
                    className="w-full px-3 py-1.5 sm:py-2 bg-gray-50 dark:bg-gray-950 border border-gray-150 dark:border-gray-800 rounded-xl focus:bg-white dark:focus:bg-gray-950 focus:border-sky-500 focus:ring-1 focus:ring-sky-500 text-sm font-semibold text-gray-900 dark:text-white"
                    placeholder="e.g. ref-123"
                  />
                  {isCheckingInvoice && (
                    <div className="absolute right-3 top-2.5 sm:top-3 flex items-center justify-center">
                      <div className="animate-spin rounded-full h-3.5 w-3.5 border-2 border-sky-500 border-t-transparent"></div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          <div className="relative">
            <label className="block text-[10px] font-bold uppercase tracking-wider text-gray-400 dark:text-gray-500 mb-1.5">
              Select Party
            </label>
            {partyLockedByInvoice && selectedParty ? (
              <div className="flex flex-col space-y-1.5">
                <div className="flex items-center justify-between p-3 border rounded-xl border-sky-100 dark:border-sky-950/40 bg-sky-50/40 dark:bg-sky-950/20">
                  <div>
                    <div className="font-bold text-gray-900 dark:text-white text-xs">{selectedParty.name}</div>
                    <div className="text-gray-400 text-[10px] font-semibold mt-0.5">{selectedParty.phone || 'No phone'}</div>
                  </div>
                  <div className="text-[10px] text-sky-600 dark:text-sky-400 font-extrabold uppercase tracking-wider bg-sky-100 dark:bg-sky-950/60 px-2 py-0.5 rounded-md">Locked to invoice</div>
                </div>
                {lockedInvoiceDetails && (
                  <div className="text-[10px] text-gray-400 font-bold flex justify-between px-1">
                    <span>Prior {lockedInvoiceDetails.type}: ₹{lockedInvoiceDetails.amount?.toFixed(2)}</span>
                    <span>Date: {lockedInvoiceDetails.date ? new Date(lockedInvoiceDetails.date).toLocaleDateString() : '-'}</span>
                  </div>
                )}
              </div>
            ) : !selectedParty ? (
              <div className="relative">
                <Search className="absolute left-3 top-2.5 sm:top-3 text-gray-400" size={14} />
                <input
                  type="text"
                  ref={partySearchRef}
                  placeholder={isSaleLedger && !invoiceNo.trim() ? "Enter Invoice No. first to search party" : "Search party by name or phone..."}
                  value={partySearch}
                  onChange={e => setPartySearch(e.target.value)}
                  onKeyDown={handlePartySearchKeyDown}
                  disabled={isSaleLedger && !invoiceNo.trim()}
                  className="w-full pl-9 pr-3 py-1.5 sm:py-2 bg-gray-50 dark:bg-gray-950 border border-gray-150 dark:border-gray-800 rounded-xl focus:bg-white dark:focus:bg-gray-950 focus:border-sky-500 focus:ring-1 focus:ring-sky-500 text-sm font-semibold disabled:bg-gray-100 dark:disabled:bg-gray-950/40 disabled:cursor-not-allowed"
                />
                
                {partySearch && (
                  <div className="absolute z-10 w-full mt-1 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl shadow-lg max-h-48 overflow-y-auto divide-y divide-gray-50 dark:divide-gray-850">
                    {filteredParties.length > 0 ? (
                      filteredParties.map((p, idx) => (
                        <button
                          key={p.id}
                          type="button"
                          disabled={isSaleLedger && !invoiceNo.trim()}
                          onClick={() => { 
                            setSelectedParty(p); 
                            setPartySearch(''); 
                            setTimeout(() => amountRef.current?.focus(), 10);
                          }}
                          className={`w-full text-left px-4 py-2.5 flex justify-between items-center transition-all ${idx === searchSelectedIndex ? 'bg-sky-50/50 dark:bg-sky-950/20 border-l-4 border-sky-500 pl-3' : 'hover:bg-gray-50/50 dark:hover:bg-gray-950/20'}`}
                        >
                          <span className="font-bold text-gray-900 dark:text-white text-xs">{p.name}</span>
                          <span className="text-gray-400 text-[10px] font-bold">{p.phone}</span>
                        </button>
                      ))
                    ) : (
                      <div className="px-4 py-3 text-gray-400 text-xs font-semibold">No parties found.</div>
                    )}
                  </div>
                )}
              </div>
            ) : (
              <div className="flex items-center justify-between p-3 border border-gray-150 dark:border-gray-800 rounded-xl bg-gray-50/50 dark:bg-gray-950/30">
                <div>
                  <div className="font-bold text-gray-950 dark:text-white text-xs">{selectedParty.name}</div>
                  <div className="text-[10px] text-gray-400 font-bold mt-0.5">
                    Balance: <span className={selectedParty.currentDue > 0 ? "text-rose-600" : "text-emerald-600"}>{selectedParty.currentDue > 0 ? `-₹${selectedParty.currentDue.toLocaleString(undefined, { minimumFractionDigits: 2 })}` : `₹${Math.abs(selectedParty.currentDue).toLocaleString(undefined, { minimumFractionDigits: 2 })}`}</span>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => { setSelectedParty(null); setTimeout(() => partySearchRef.current?.focus(), 10); }}
                  className="text-xs font-bold text-sky-600 dark:text-sky-400 hover:text-sky-700 bg-sky-50 dark:bg-sky-950/50 px-2.5 py-1.5 rounded-lg border border-sky-100 dark:border-sky-900/50 transition-colors cursor-pointer"
                >
                  Change
                </button>
              </div>
            )}
          </div>

          {type === 'CREDIT' && (
            <div className="flex items-center gap-2 py-0.5">
              <input
                type="checkbox"
                id="separateCredit"
                checked={separateCredit}
                onChange={e => setSeparateCredit(e.target.checked)}
                className="h-3.5 w-3.5 rounded border-gray-300 text-sky-600 focus:ring-sky-500 cursor-pointer"
              />
              <label htmlFor="separateCredit" className="text-xs font-bold text-gray-500 cursor-pointer select-none">
                Separate Cash & A/C Credit
              </label>
            </div>
          )}

          {type === 'CREDIT' && separateCredit ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-wider text-emerald-600 mb-1.5">Cash Credit</label>
                <div className="relative">
                  <span className="absolute left-3.5 top-1.5 sm:top-2 text-emerald-600 font-extrabold text-sm">₹</span>
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
                    className="w-full pl-8 pr-3 py-1.5 sm:py-2 bg-emerald-50/20 dark:bg-emerald-950/10 border border-emerald-100 dark:border-emerald-950/40 rounded-xl focus:bg-white dark:focus:bg-gray-950 focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 text-sm font-extrabold text-emerald-800 dark:text-emerald-400 disabled:bg-gray-100 disabled:cursor-not-allowed"
                    placeholder="0.00"
                  />
                </div>
              </div>
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-wider text-sky-600 mb-1.5">A/C Credit</label>
                <div className="relative">
                  <span className="absolute left-3.5 top-1.5 sm:top-2 text-sky-600 font-extrabold text-sm">₹</span>
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
                    className="w-full pl-8 pr-3 py-1.5 sm:py-2 bg-sky-50/20 dark:bg-sky-950/10 border border-sky-100 dark:border-sky-950/40 rounded-xl focus:bg-white dark:focus:bg-gray-950 focus:border-sky-500 focus:ring-1 focus:ring-sky-500 text-sm font-extrabold text-sky-800 dark:text-sky-400 disabled:bg-gray-100 disabled:cursor-not-allowed"
                    placeholder="0.00"
                  />
                </div>
              </div>
            </div>
          ) : (
            <div>
              <label className="block text-[10px] font-bold uppercase tracking-wider text-gray-400 dark:text-gray-500 mb-1.5">Amount</label>
              <div className="relative">
                <span className="absolute left-3.5 top-1.5 sm:top-2 text-gray-400 font-extrabold text-sm">₹</span>
                <input
                  ref={amountRef}
                  onKeyDown={handleAmountKeyDown}
                  type="number"
                  step="0.01"
                  min="0.01"
                  value={amount}
                  onChange={e => setAmount(e.target.value)}
                  disabled={isSaleLedger && !invoiceNo.trim()}
                  className="w-full pl-8 pr-3 py-1.5 sm:py-2 bg-gray-50 dark:bg-gray-950 border border-gray-150 dark:border-gray-800 rounded-xl focus:bg-white dark:focus:bg-gray-950 focus:border-sky-500 focus:ring-1 focus:ring-sky-500 text-sm font-extrabold text-gray-900 dark:text-white disabled:bg-gray-100 dark:disabled:bg-gray-950/40 disabled:cursor-not-allowed"
                  placeholder="0.00"
                />
              </div>
            </div>
          )}

          <div>
            <label className="block text-[10px] font-bold uppercase tracking-wider text-gray-400 dark:text-gray-500 mb-1.5">Notes (Optional)</label>
            <textarea
              ref={notesRef}
              onKeyDown={handleNotesKeyDown}
              value={notes}
              onChange={e => setNotes(e.target.value)}
              disabled={isSaleLedger && !invoiceNo.trim()}
              className="w-full px-3 py-1.5 sm:py-2 bg-gray-50 dark:bg-gray-950 border border-gray-150 dark:border-gray-800 rounded-xl focus:bg-white dark:focus:bg-gray-950 focus:border-sky-500 focus:ring-1 focus:ring-sky-500 text-sm font-semibold text-gray-900 dark:text-white disabled:bg-gray-100 dark:disabled:bg-gray-950/40 disabled:cursor-not-allowed"
              rows={2}
              placeholder="Add internal transaction notes here..."
            />
          </div>

          <div className="pt-3 border-t border-gray-100 dark:border-gray-800 flex justify-end">
            <button
              type="submit"
              disabled={isSubmitting || (isSaleLedger && !invoiceNo.trim())}
              className="w-full sm:w-auto px-6 py-2 bg-sky-600 hover:bg-sky-700 text-white rounded-xl text-xs font-bold active:scale-98 transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-md"
            >
              Review Transaction
            </button>
          </div>
        </form>
      </div>

      {showConfirmModal && selectedParty && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-sm overflow-hidden text-sm">
            <div className="p-4 border-b">
              <h3 className="font-semibold text-lg text-gray-900">Confirm Entry</h3>
            </div>
            <div className="p-6 space-y-4">
              <div className="flex justify-between">
                <span className="text-gray-500">Party</span>
                <span className="font-semibold text-gray-900">{selectedParty.name}</span>
              </div>
              {(isSaleLedger || invoiceNo) && (
                <div className="flex justify-between">
                  <span className="text-gray-500">{isSaleLedger ? 'Invoice No' : 'Reference'}</span>
                  <span className="font-medium text-gray-900">{invoiceNo || '-'}</span>
                </div>
              )}
              <div className="flex justify-between">
                <span className="text-gray-500">Type</span>
                <span className={`font-bold ${type === 'DEBIT' ? 'text-red-600' : 'text-emerald-600'}`}>{type}</span>
              </div>
              {type === 'CREDIT' ? (
                <div className="pt-2 border-t space-y-1">
                  <div className="flex justify-between font-medium">
                    <span className="text-gray-500">Total Credit</span>
                    <span className="font-bold text-lg text-emerald-600">₹{((parseFloat(cashAmount) || 0) + (parseFloat(acAmount) || 0)).toFixed(2)}</span>
                  </div>
                  {parseFloat(cashAmount || '0') > 0 && (
                    <div className="flex justify-between text-xs text-emerald-600 pl-4 font-medium">
                      <span>• Cash Portion</span>
                      <span>₹{parseFloat(cashAmount).toFixed(2)}</span>
                    </div>
                  )}
                  {parseFloat(acAmount || '0') > 0 && (
                    <div className="flex justify-between text-xs text-sky-600 pl-4 font-medium">
                      <span>• A/C Portion</span>
                      <span>₹{parseFloat(acAmount).toFixed(2)}</span>
                    </div>
                  )}
                </div>
              ) : (
                <div className="flex justify-between pt-2 border-t">
                  <span className="text-gray-500 font-medium">Amount</span>
                  <span className="font-bold text-lg text-gray-900">₹{parseFloat(amount).toFixed(2)}</span>
                </div>
              )}
            </div>
            <div className="p-4 border-t bg-gray-50 flex justify-end space-x-2">
              <button 
                onClick={() => setShowConfirmModal(false)}
                disabled={isSubmitting}
                className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-md font-medium"
              >
                Cancel
              </button>
              <button 
                ref={confirmBtnRef}
                onClick={handleConfirmSubmit}
                disabled={isSubmitting}
                className={`px-4 py-2 text-white rounded-md font-medium ${type === 'DEBIT' ? 'bg-red-600 hover:bg-red-700' : 'bg-emerald-600 hover:bg-emerald-700'} ${isSubmitting ? 'opacity-50' : ''}`}
              >
                {isSubmitting ? 'Saving...' : 'Confirm & Save'}
              </button>
            </div>
          </div>
        </div>
      )}

      {alertInfo && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-sm overflow-hidden transform transition-all">
            <div className={`p-4 border-b ${alertInfo.isError ? 'border-red-100 bg-red-50' : 'border-sky-100 bg-sky-50'}`}>
              <h3 className={`font-semibold text-lg flex items-center ${alertInfo.isError ? 'text-red-700' : 'text-sky-700'}`}>
                {alertInfo.title || (alertInfo.isError ? 'Duplicate Entry' : 'Notice')}
              </h3>
            </div>
            <div className="p-6">
              <p className="text-gray-700 text-sm font-medium whitespace-pre-wrap">{alertInfo.message}</p>
            </div>
            <div className="p-4 border-t bg-gray-50 flex justify-end">
              <button 
                autoFocus
                onClick={() => {
                  setAlertInfo(null);
                  setTimeout(() => {
                    if (document.activeElement === document.body || !document.activeElement) {
                       if (alertInfo.isError) {
                         invoiceRef.current?.focus();
                       } else {
                         if (selectedParty) {
                           if (type === 'CREDIT') {
                             cashAmountRef.current?.focus();
                           } else {
                             amountRef.current?.focus();
                           }
                         } else {
                           partySearchRef.current?.focus();
                         }
                       }
                    }
                  }, 50);
                }}
                className={`px-6 py-2 text-white rounded-md font-medium transition-colors ${alertInfo.isError ? 'bg-red-600 hover:bg-red-700' : 'bg-sky-600 hover:bg-sky-700'}`}
              >
                Okay
              </button>
            </div>
          </div>
        </div>
      )}

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

      {showSuccess && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm transition-opacity">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden flex flex-col items-center p-6 transform transition-all duration-300">
            <div className="w-16 h-16 bg-emerald-100 rounded-full flex items-center justify-center mb-4 shadow-inner animate-[bounce_0.5s_ease-out]">
              <Check className="text-emerald-500" size={32} strokeWidth={3} />
            </div>
            <h3 className="text-lg font-bold text-gray-900 mb-1">Entry Saved Successfully!</h3>
            <p className="text-xs text-gray-500 text-center mb-6 font-medium">
              Recorded in <span className="font-semibold text-gray-700">{activeLedger?.name}</span>
            </p>
            
            <div className="w-full">
              <button
                type="button"
                onClick={() => {
                  setShowSuccess(false);
                  if (invoiceRef.current) {
                    invoiceRef.current.focus();
                  }
                }}
                className="w-full py-2.5 px-4 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-xl font-semibold text-xs active:scale-95 transition-all text-center cursor-pointer"
              >
                Okay, Next
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
