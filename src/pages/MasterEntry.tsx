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
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  Sparkles, 
  Info,
  AlertTriangle,
  Receipt,
  FileText,
  X,
  Package,
  Loader2,
  ChevronDown,
  ChevronUp,
  Clock
} from 'lucide-react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../AuthContext';
import { createTransaction } from '../lib/transactionService';
import { getFilteredCacheItems } from '../lib/idbCache';
import { syncCollection } from '../lib/syncCache';
import { logUserActivity } from '../lib/activityLogger';
import { useLedgerTextCase } from '../lib/textCaseHelper';
import { 
  lookupBill, 
  fetchBillingBills, 
  fetchBillItems,
  findMatchingParty, 
  BillingBill,
  BillingBillItem,
  findDebitedTransaction,
  formatBillParticulars
} from '../lib/billingService';
import ThermalReceiptModal from '../components/ThermalReceiptModal';
import PageHeader from '../components/ui/PageHeader';
import { Card, CardHeader, CardBody } from '../components/ui/Card';
import Badge from '../components/ui/Badge';
import AmountDisplay from '../components/ui/AmountDisplay';

export default function MasterEntry() {
  const { activeLedger } = useLedger();
  const { currentUser } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [parties, setParties] = useState<Party[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [partySearch, setPartySearch] = useState('');
  const [selectedParty, setSelectedParty] = useState<Party | null>(null);
  
  const [type, setType] = useState<'DEBIT' | 'CREDIT'>('DEBIT');
  const [amount, setAmount] = useState('');
  const [separateCredit, setSeparateCredit] = useState(false);
  const [cashAmount, setCashAmount] = useState('');
  const [acAmount, setAcAmount] = useState('');
  const [invoiceNo, setInvoiceNo] = useState('');
  const [notes, setNotes] = useState('');
  const { handleTextChange } = useLedgerTextCase();
  
  // Billing Database integration states
  const [billingMatch, setBillingMatch] = useState<BillingBill | null>(null);
  const [isSearchingBilling, setIsSearchingBilling] = useState<boolean>(false);
  const [todayBills, setTodayBills] = useState<BillingBill[]>([]);
  const [todayPendingBills, setTodayPendingBills] = useState<BillingBill[]>([]);

  // Pending bills popup modal states
  const [showPendingBillsModal, setShowPendingBillsModal] = useState<boolean>(false);
  const [pendingModalSearch, setPendingModalSearch] = useState<string>('');
  const [expandedBillId, setExpandedBillId] = useState<string | null>(null);
  const [modalBillItems, setModalBillItems] = useState<{ [billKey: string]: BillingBillItem[] }>({});
  const [loadingModalItems, setLoadingModalItems] = useState<{ [billKey: string]: boolean }>({});
  
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

  // Interactive Bottom Slider Action Pill States
  const [sliderOffset, setSliderOffset] = useState<number>(0);
  const [isDraggingSlider, setIsDraggingSlider] = useState<boolean>(false);
  const sliderStartXRef = useRef<number>(0);
  const currentOffsetRef = useRef<number>(0);
  const isDraggingRef = useRef<boolean>(false);

  const isSaleLedger = activeLedger?.type === 'SALE';
  const isExpenseLedger = activeLedger?.type === 'EXPENSE';

  useEffect(() => {
    if (isExpenseLedger) {
      setType('DEBIT');
      setSeparateCredit(false);
    }
  }, [isExpenseLedger, activeLedger?.id]);

  // Load today's bills from billing database (ONLY DELIVERED AND APPROVED ORDERS)
  useEffect(() => {
    let isCancelled = false;
    const loadTodayBills = async () => {
      try {
        const res = await fetchBillingBills();
        if (!isCancelled && res.success && res.bills) {
          // Strictly filter for ONLY DELIVERED and APPROVED orders
          const deliveredOrApproved = res.bills.filter(b => {
            const s = (b.status || '').toUpperCase().trim();
            return s === 'DELIVERED' || s === 'APPROVED';
          });
          setTodayBills(deliveredOrApproved);
        }
      } catch (err) {
        console.error("MasterEntry: Failed to load today's billing bills", err);
      }
    };
    loadTodayBills();
    return () => {
      isCancelled = true;
    };
  }, []);

  // Compute pending bills from today's bills vs transactions in ledger
  useEffect(() => {
    if (todayBills.length === 0) {
      setTodayPendingBills([]);
      return;
    }
    const pending = todayBills.filter(b => !findDebitedTransaction(b, transactions));
    setTodayPendingBills(pending);
  }, [todayBills, transactions]);

  // Handle navigation from BillingDeclaration page
  useEffect(() => {
    if (location.state && (location.state as any).fromBillingDeclaration) {
      const s = location.state as any;
      if (s.voucherType) setType(s.voucherType);
      if (s.billNo) setInvoiceNo(s.billNo);
      if (s.amount) setAmount(s.amount);
      if (s.notes) setNotes(s.notes);
      
      if (s.partyId) {
        const p = parties.find(pt => pt.id === s.partyId);
        if (p) setSelectedParty(p);
      } else if (s.partyName && parties.length > 0) {
        const matched = findMatchingParty(s.partyName, parties);
        if (matched) setSelectedParty(matched);
      }
    }
  }, [location.state, parties]);

  // Live lookup from billing database when invoiceNo changes
  useEffect(() => {
    const trimmed = (invoiceNo || '').trim();
    if (!trimmed || trimmed.length < 2) {
      setBillingMatch(null);
      setIsSearchingBilling(false);
      return;
    }

    // 1. Instant local match from already loaded today's bills with 0 database reads
    const cleanTarget = trimmed.toLowerCase().replace(/^(inv|bill)[-\s:]*/i, '').replace(/^#+/, '').trim();
    const localMatch = todayPendingBills.find(b => {
      const bNo = (b.bill_no || '').toLowerCase().replace(/^(inv|bill)[-\s:]*/i, '').replace(/^#+/, '').trim();
      return bNo === cleanTarget;
    });

    if (localMatch) {
      setBillingMatch(localMatch);
      setIsSearchingBilling(false);
      return;
    }

    let isCancelled = false;
    setIsSearchingBilling(true);

    const timer = setTimeout(async () => {
      try {
        const res = await lookupBill(trimmed);
        if (!isCancelled) {
          if (res.found && res.bill) {
            setBillingMatch(res.bill);
          } else {
            setBillingMatch(null);
          }
        }
      } catch (err) {
        if (!isCancelled) setBillingMatch(null);
      } finally {
        if (!isCancelled) setIsSearchingBilling(false);
      }
    }, 400);

    return () => {
      isCancelled = true;
      clearTimeout(timer);
    };
  }, [invoiceNo]);

  // Helper to auto-fill fields from a billing bill
  const applyBillingMatch = (bill: BillingBill) => {
    setInvoiceNo(bill.bill_no);
    setAmount(String(bill.total_amount));
    
    // Auto-match party from customer_name
    const matched = findMatchingParty(bill.customer_name, parties);
    if (matched) {
      setSelectedParty(matched);
    }

    // Set notes strictly collecting Order Bill, Place Date, Total Qty, and Vehicle Number
    setNotes(formatBillParticulars(bill));

    // Default to DEBIT for billing entries
    setType('DEBIT');

    // Focus amount or notes
    setTimeout(() => {
      if (matched) {
        amountRef.current?.focus();
      } else {
        partySearchRef.current?.focus();
      }
    }, 50);
  };

  const handleToggleExpandBill = async (bill: BillingBill) => {
    const key = bill.id || bill.bill_no;
    if (expandedBillId === key) {
      setExpandedBillId(null);
      return;
    }
    setExpandedBillId(key);
    if (!modalBillItems[key]) {
      setLoadingModalItems(prev => ({ ...prev, [key]: true }));
      try {
        const items = await fetchBillItems(key);
        setModalBillItems(prev => ({ ...prev, [key]: items }));
      } catch (err) {
        console.error('Failed to load bill items:', err);
      } finally {
        setLoadingModalItems(prev => ({ ...prev, [key]: false }));
      }
    }
  };

  const handleSelectBillFromModal = (bill: BillingBill) => {
    applyBillingMatch(bill);
    setShowPendingBillsModal(false);
  };

  useEffect(() => {
    const loadData = async () => {
      if (!activeLedger?.id) return;
      try {
        const cached = await getFilteredCacheItems<Party>('parties', p => p.ledgerId === activeLedger.id);
        setParties(cached);
        
        const cachedTxs = await getFilteredCacheItems<Transaction>('transactions', t => t.ledgerId === activeLedger.id);
        setTransactions(cachedTxs);
        
        await syncCollection<Party>('parties', activeLedger.id, 'parties');
        await syncCollection<Transaction>('transactions', activeLedger.id, 'transactions');
        
        const fresh = await getFilteredCacheItems<Party>('parties', p => p.ledgerId === activeLedger.id);
        setParties(fresh);

        const freshTxs = await getFilteredCacheItems<Transaction>('transactions', t => t.ledgerId === activeLedger.id);
        setTransactions(freshTxs);
      } catch (err) {
        console.error("MasterEntry: Failed to load parties and transactions from cache", err);
      }
    };
    loadData();
    if (!location.state || !(location.state as any).fromBillingDeclaration) {
      setInvoiceNo('');
    }

    const handleSync = () => {
      loadData();
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
        if (!isExpenseLedger) {
          handleTypeChange(type === 'DEBIT' ? 'CREDIT' : 'DEBIT');
        }
      }
      if (e.key === 'F3' || (e.altKey && e.key.toLowerCase() === 's')) {
        e.preventDefault();
        if (!isExpenseLedger) {
          setSeparateCredit(prev => !prev);
        }
      }
      if (e.altKey && e.key.toLowerCase() === 'd') {
        e.preventDefault();
        handleTypeChange('DEBIT');
      }
      if (e.altKey && e.key.toLowerCase() === 'c') {
        e.preventDefault();
        if (!isExpenseLedger) {
          handleTypeChange('CREDIT');
        }
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
    if (isExpenseLedger && newType === 'CREDIT') return;
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

    // Only detect duplicates for invoices that contain digits/numbers (pure text like "CASH", "UPI", "ADVANCE" are NOT treated as duplicate invoices)
    const hasDigits = /\d+/.test(invoiceNo);
    if (!hasDigits) {
      setPartyLockedByInvoice(false);
      setLockedInvoiceDetails(null);
      return true;
    }

    setIsCheckingInvoice(true);
    try {
      const cleanUpper = invoiceNo.toUpperCase().trim();
      const cleanLower = invoiceNo.toLowerCase().trim();
      
      const [trackedSnapUpper, trackedSnapLower, txSnapUpper, txSnapLower] = await Promise.all([
        getDocs(query(collection(db, 'tracked_invoices'), where('ledgerId', '==', activeLedger.id), where('invoiceNo', '==', cleanUpper))),
        cleanUpper !== cleanLower 
          ? getDocs(query(collection(db, 'tracked_invoices'), where('ledgerId', '==', activeLedger.id), where('invoiceNo', '==', cleanLower)))
          : Promise.resolve({ docs: [] } as any),
        getDocs(query(collection(db, 'transactions'), where('ledgerId', '==', activeLedger.id), where('invoiceNo', '==', cleanUpper))),
        cleanUpper !== cleanLower
          ? getDocs(query(collection(db, 'transactions'), where('ledgerId', '==', activeLedger.id), where('invoiceNo', '==', cleanLower)))
          : Promise.resolve({ docs: [] } as any)
      ]);

      const trackedDocsMap = new Map<string, any>();
      [...trackedSnapUpper.docs, ...trackedSnapLower.docs].forEach(d => trackedDocsMap.set(d.id, d.data()));
      const trackedDocs = Array.from(trackedDocsMap.values());

      const txDocsMap = new Map<string, Transaction>();
      [...txSnapUpper.docs, ...txSnapLower.docs].forEach(d => txDocsMap.set(d.id, d.data() as Transaction));
      const matchedTxs = Array.from(txDocsMap.values());

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

  const handlePreSubmitWithDirection = async (directionType: 'DEBIT' | 'CREDIT') => {
    setType(directionType);
    
    if (invoiceNo && activeLedger) {
      const isOk = await checkInvoice();
      if (!isOk) return;
    }

    if (!selectedParty) {
      setAlertInfo({ message: "Please select an account party first.", isError: true });
      return;
    }
    if (directionType === 'CREDIT' && separateCredit) {
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

  const handlePreSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    await handlePreSubmitWithDirection(type);
  };

  // Slider gestures: Slide left for Credit, Slide right for Debit
  const maxSlide = 85;
  const triggerThreshold = 46;

  const handleSliderPointerDown = (e: React.PointerEvent) => {
    if (isSubmitting) return;
    sliderStartXRef.current = e.clientX;
    currentOffsetRef.current = 0;
    isDraggingRef.current = true;
    setIsDraggingSlider(true);
    try {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    } catch (_) {}
  };

  const handleSliderPointerMove = (e: React.PointerEvent) => {
    if (!isDraggingRef.current) return;
    const deltaX = e.clientX - sliderStartXRef.current;
    let newOffset = deltaX;

    // Disallow sliding left if in Expense ledger
    if (isExpenseLedger && newOffset < 0) {
      newOffset = Math.max(-10, newOffset * 0.12);
    }

    newOffset = Math.max(-maxSlide, Math.min(maxSlide, newOffset));
    currentOffsetRef.current = newOffset;
    setSliderOffset(newOffset);
  };

  const handleSliderPointerUp = (e: React.PointerEvent) => {
    if (!isDraggingRef.current) return;
    isDraggingRef.current = false;
    setIsDraggingSlider(false);
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch (_) {}

    const offset = currentOffsetRef.current;
    if (offset <= -triggerThreshold) {
      // Slid left to CREDIT
      if (isExpenseLedger) {
        setAlertInfo({ message: "Credit vouchers are not allowed in an Expense Ledger.", isError: true });
        setSliderOffset(0);
        return;
      }
      setSliderOffset(-maxSlide);
      try { navigator.vibrate?.(25); } catch (_) {}
      setTimeout(() => {
        handlePreSubmitWithDirection('CREDIT');
        setTimeout(() => setSliderOffset(0), 380);
      }, 100);
    } else if (offset >= triggerThreshold) {
      // Slid right to DEBIT
      setSliderOffset(maxSlide);
      try { navigator.vibrate?.(25); } catch (_) {}
      setTimeout(() => {
        handlePreSubmitWithDirection('DEBIT');
        setTimeout(() => setSliderOffset(0), 380);
      }, 100);
    } else {
      // Spring back to center
      setSliderOffset(0);
    }
  };

  const handleSliderPointerCancel = () => {
    isDraggingRef.current = false;
    setIsDraggingSlider(false);
    setSliderOffset(0);
  };

  const handleTriggerActionWithAnimation = (directionType: 'DEBIT' | 'CREDIT') => {
    if (isSubmitting) return;
    if (directionType === 'CREDIT' && isExpenseLedger) {
      setAlertInfo({ message: "Credit vouchers are not allowed in an Expense Ledger.", isError: true });
      return;
    }
    const targetOffset = directionType === 'CREDIT' ? -maxSlide : maxSlide;
    setSliderOffset(targetOffset);
    try { navigator.vibrate?.(20); } catch (_) {}
    setTimeout(() => {
      handlePreSubmitWithDirection(directionType);
      setTimeout(() => setSliderOffset(0), 380);
    }, 180);
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
      setTransactions(prev => [newTx, ...prev]);

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

      createTransaction(newTx, selectedParty).then(() => {
        logUserActivity(
          `Recorded ${type} Voucher`,
          `₹${numAmount.toFixed(2)} for ${selectedParty.name}${invoiceNo ? ` (Inv #${invoiceNo})` : ''}`,
          currentUser,
          activeLedger.name,
          activeLedger.id
        );
      }).catch(e => {
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
    <div className="p-3 sm:p-6 max-w-[440px] mx-auto w-full pb-24 font-customer">
      <div className="w-full bg-white border border-slate-200/80 rounded-3xl p-5 sm:p-6 shadow-[0_4px_24px_rgba(0,0,0,0.05)] flex flex-col">
        {/* Header Title */}
        <div className="pb-3 mb-4 border-b border-slate-100 flex items-center justify-between">
          <h2 className="text-xl sm:text-[22px] font-extrabold text-[#0B1528] tracking-tight">Invoice Entry</h2>
          {isExpenseLedger && (
            <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded-full bg-rose-50 text-rose-600 border border-rose-200">
              Expense Book
            </span>
          )}
        </div>

        <form onSubmit={handlePreSubmit} className="flex flex-col">
          {/* Row 1: INVOICE NUMBER | ACCOUNT PARTY * | Invoices button */}
          <div className="flex items-start gap-2 sm:gap-2.5">
            {/* INVOICE NUMBER */}
            <div className="w-[34%] min-w-0">
              <label className="text-[10px] sm:text-[10.5px] font-extrabold text-slate-700 tracking-wider uppercase mb-1.5 block truncate">
                Invoice Number
              </label>
              <div className="relative">
                <input
                  ref={invoiceRef}
                  type="text"
                  value={invoiceNo}
                  onKeyDown={handleInvoiceKeyDown}
                  onBlur={handleInvoiceBlur}
                  onChange={e => { setInvoiceNo(e.target.value.toUpperCase()); setPartyLockedByInvoice(false); setLockedInvoiceDetails(null); }}
                  className="w-full bg-white border border-slate-200 rounded-xl px-2.5 h-[42px] text-xs sm:text-[13px] font-mono text-[#0F172A] outline-none placeholder:text-slate-400 focus:border-[#0284c7] focus:ring-2 focus:ring-[#0284c7]/10 transition uppercase"
                  placeholder="REF OR INV"
                />
                {isCheckingInvoice && (
                  <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center justify-center">
                    <div className="animate-spin rounded-full h-3 w-3 border-2 border-[#0284c7] border-t-transparent"></div>
                  </div>
                )}
              </div>
            </div>

            {/* ACCOUNT PARTY * */}
            <div className="flex-1 min-w-0 relative">
              <label className="text-[10px] sm:text-[10.5px] font-extrabold text-slate-700 tracking-wider uppercase mb-1.5 flex items-center truncate">
                <span>Account Party</span>
                <span className="text-[#DC2626] ml-0.5 font-bold">*</span>
              </label>

              {partyLockedByInvoice && selectedParty ? (
                <div className="h-[42px] px-2.5 border border-slate-200 rounded-xl bg-slate-50 flex items-center justify-between text-xs">
                  <span className="font-bold text-slate-900 text-xs truncate max-w-[90px] sm:max-w-[120px]">{selectedParty.name}</span>
                  <span className="text-[8.5px] font-bold uppercase px-1 py-0.2 rounded bg-slate-200 text-slate-700 shrink-0 ml-1">Locked</span>
                </div>
              ) : !selectedParty ? (
                <div className="relative">
                  <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none flex items-center">
                    <Search size={14} strokeWidth={2.2} />
                  </span>
                  <input
                    type="text"
                    ref={partySearchRef}
                    placeholder="Enter Invoice No."
                    value={partySearch}
                    onChange={e => setPartySearch(e.target.value)}
                    onKeyDown={handlePartySearchKeyDown}
                    disabled={isSaleLedger && !invoiceNo.trim()}
                    className="w-full bg-white border border-slate-200 rounded-xl pl-8 pr-2 h-[42px] text-xs sm:text-[13px] text-[#0F172A] outline-none placeholder:text-slate-400 focus:border-[#0284c7] focus:ring-2 focus:ring-[#0284c7]/10 transition disabled:bg-slate-50 disabled:cursor-not-allowed"
                  />

                  {partySearch && (
                    <div className="absolute z-30 w-72 max-w-[85vw] mt-1 bg-white border border-slate-200 rounded-xl shadow-2xl max-h-52 overflow-y-auto divide-y divide-slate-100 left-0">
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
                            className={`w-full text-left px-3 py-2 flex justify-between items-center transition-all ${
                              idx === searchSelectedIndex ? 'bg-sky-50 border-l-3 border-[#0284c7] pl-2' : 'hover:bg-slate-50'
                            }`}
                          >
                            <span className="font-bold text-slate-900 text-xs truncate max-w-[160px]">{p.name}</span>
                            <span className="text-slate-500 font-mono text-[10px] shrink-0 ml-1">{p.phone}</span>
                          </button>
                        ))
                      ) : (
                        <div className="px-3 py-2 text-slate-400 text-xs text-center">
                          No matching account parties found.
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ) : (
                <div className="h-[42px] px-2.5 border border-slate-200 rounded-xl bg-white flex items-center justify-between text-xs">
                  <div className="min-w-0 pr-1">
                    <div className="font-bold text-[#0F172A] text-xs truncate">{selectedParty.name}</div>
                    <div className="text-[9.5px] text-slate-500 -mt-0.5 truncate">
                      ₹{Math.abs(selectedParty.currentDue).toLocaleString('en-IN', { minimumFractionDigits: 2 })} {selectedParty.currentDue >= 0 ? 'DR' : 'CR'}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => { setSelectedParty(null); setTimeout(() => partySearchRef.current?.focus(), 10); }}
                    className="text-[10px] font-semibold text-[#0284c7] hover:underline cursor-pointer bg-slate-50 hover:bg-slate-100 px-1.5 py-0.5 rounded border border-slate-200 transition shrink-0"
                  >
                    Change
                  </button>
                </div>
              )}
            </div>

            {/* Invoices Button */}
            <div className="shrink-0 flex flex-col items-center">
              <span className="text-[10px] sm:text-[10.5px] font-normal text-slate-400 mb-1.5 block">
                Invoices
              </span>
              <button
                type="button"
                onClick={() => setShowPendingBillsModal(true)}
                className="w-[42px] h-[42px] bg-slate-50 hover:bg-slate-100 border border-slate-200 hover:border-slate-300 rounded-xl flex items-center justify-center relative cursor-pointer text-slate-600 transition shadow-2xs active:scale-95"
                title={`${todayPendingBills.length} pending orders waiting to be debited`}
              >
                <FileText size={18} strokeWidth={2} />
                <span className="absolute -top-1.5 -right-1.5 bg-[#DC2626] text-white text-[9.5px] font-extrabold w-5 h-5 rounded-full flex items-center justify-center border-2 border-white shadow-xs">
                  {todayPendingBills.length > 0 ? todayPendingBills.length : todayBills.length > 0 ? todayBills.length : 12}
                </span>
              </button>
            </div>
          </div>

          {/* Live Billing Database Match Card */}
          {billingMatch && (
            <div 
              onClick={() => applyBillingMatch(billingMatch)}
              className="mt-2 p-2 bg-blue-50/90 hover:bg-blue-100/70 border border-blue-200 hover:border-blue-300 rounded-xl text-[11px] transition-colors cursor-pointer"
              title="Click to apply bill details"
            >
              <div className="space-y-0.5">
                <div className="flex items-center gap-1.5">
                  <span className="font-mono font-bold text-blue-950">#{billingMatch.bill_no}</span>
                  {billingMatch.bill_type && (
                    <span className="text-[9.5px] text-slate-500">({billingMatch.bill_type.replace('_', ' ')})</span>
                  )}
                </div>
                <div className="text-slate-800 font-medium truncate">
                  Party: <span className="font-bold text-slate-950">{billingMatch.customer_name}</span>
                </div>
                <div className="text-blue-950 font-mono font-bold text-xs">
                  Bill Amount: ₹{Number(billingMatch.total_amount).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                </div>
              </div>
            </div>
          )}

          {/* Row 2: VOUCHER AMOUNT (₹) * */}
          <div className="flex flex-col mt-4">
            <label className="text-[10px] sm:text-[10.5px] font-extrabold text-slate-700 tracking-wider uppercase mb-1.5 flex items-center">
              <span>Voucher Amount (₹)</span>
              <span className="text-[#DC2626] ml-0.5 font-bold">*</span>
            </label>
            <div className="flex items-stretch rounded-xl border border-slate-200 bg-white overflow-hidden focus-within:border-[#0284c7] focus-within:ring-2 focus-within:ring-[#0284c7]/10 h-[44px] transition">
              <div className="w-10 bg-slate-50 border-r border-slate-200 flex items-center justify-center font-bold text-slate-600 text-sm select-none shrink-0">
                ₹
              </div>
              <input
                ref={amountRef}
                onKeyDown={handleAmountKeyDown}
                type="number"
                step="0.01"
                min="0.01"
                value={amount}
                onChange={e => setAmount(e.target.value)}
                disabled={isSaleLedger && !invoiceNo.trim()}
                className="flex-1 px-3 text-sm sm:text-base font-semibold font-mono text-[#0F172A] outline-none placeholder:text-slate-400 placeholder:font-normal bg-transparent disabled:bg-slate-50"
                placeholder="0.00"
              />
            </div>
          </div>

          {/* Row 3: DESCRIPTION */}
          <div className="flex flex-col mt-4">
            <label className="text-[10px] sm:text-[10.5px] font-extrabold text-slate-700 tracking-wider uppercase mb-1.5">
              Description
            </label>
            <textarea
              ref={notesRef}
              onKeyDown={handleNotesKeyDown}
              value={notes}
              onChange={e => handleTextChange(e, setNotes)}
              disabled={isSaleLedger && !invoiceNo.trim()}
              className="w-full bg-white border border-slate-200 rounded-xl p-3 text-xs sm:text-[13px] text-[#0F172A] outline-none placeholder:text-slate-400 min-h-[88px] focus:border-[#0284c7] focus:ring-2 focus:ring-[#0284c7]/10 transition resize-y disabled:bg-slate-50"
              placeholder="etc"
              rows={3}
            />
          </div>

          {/* Row 4: Bottom Slider Action Pill (Credit / Debit) */}
          <div className="flex flex-col items-center pt-5 pb-1">
            <div className="relative flex items-center h-[52px] w-[280px] sm:w-[300px] rounded-full p-1 border border-slate-200/90 shadow-[0_4px_16px_rgba(0,0,0,0.06)] bg-white select-none">
              {/* Credit Pill (Left Button) */}
              <button
                type="button"
                onClick={() => handleTriggerActionWithAnimation('CREDIT')}
                disabled={isSubmitting || (isSaleLedger && !invoiceNo.trim()) || isExpenseLedger}
                className={`w-1/2 h-full rounded-l-full flex items-center justify-center gap-1.5 font-bold text-xs sm:text-[13px] text-[#16A34A] transition-all cursor-pointer border-none pl-3.5 pr-2 ${
                  sliderOffset < -15
                    ? 'bg-[#bbf7d0] shadow-inner font-extrabold'
                    : 'bg-[#DCFCE7]/75 hover:bg-[#DCFCE7]'
                } ${isExpenseLedger ? 'opacity-30 cursor-not-allowed' : ''}`}
                title={isExpenseLedger ? 'Credit not allowed in expense ledger' : 'Slide left or Tap to Record Credit Voucher'}
              >
                <ArrowLeft size={16} strokeWidth={2.8} className={`text-[#16A34A] transition-transform ${sliderOffset < -15 ? '-translate-x-1' : ''}`} />
                <span className={`transition-all ${sliderOffset < -25 ? 'scale-105 font-black text-emerald-800' : ''}`}>Credit</span>
              </button>

              {/* Debit Pill (Right Button) */}
              <button
                type="button"
                onClick={() => handleTriggerActionWithAnimation('DEBIT')}
                disabled={isSubmitting || (isSaleLedger && !invoiceNo.trim())}
                className={`w-1/2 h-full rounded-r-full flex items-center justify-center gap-1.5 font-bold text-xs sm:text-[13px] text-[#DC2626] transition-all cursor-pointer border-none pr-3.5 pl-2 ${
                  sliderOffset > 15
                    ? 'bg-[#fecdd3] shadow-inner font-extrabold'
                    : 'bg-[#FEE2E2]/75 hover:bg-[#FEE2E2]'
                }`}
                title="Slide right or Tap to Record Debit Voucher"
              >
                <span className={`transition-all ${sliderOffset > 25 ? 'scale-105 font-black text-rose-800' : ''}`}>Debit</span>
                <ArrowRight size={16} strokeWidth={2.8} className={`text-[#DC2626] transition-transform ${sliderOffset > 15 ? 'translate-x-1' : ''}`} />
              </button>

              {/* Draggable Center Knob with Diamond Icon */}
              <div
                onPointerDown={handleSliderPointerDown}
                onPointerMove={handleSliderPointerMove}
                onPointerUp={handleSliderPointerUp}
                onPointerCancel={handleSliderPointerCancel}
                style={{
                  transform: `translate(calc(-50% + ${sliderOffset}px), -50%)`,
                  transition: isDraggingSlider ? 'none' : 'transform 0.28s cubic-bezier(0.34, 1.56, 0.64, 1)',
                  touchAction: 'none'
                }}
                className={`absolute left-1/2 top-1/2 w-11 h-11 rounded-full bg-white shadow-[0_2px_10px_rgba(0,0,0,0.16)] border border-slate-200 flex items-center justify-center z-20 select-none cursor-grab active:cursor-grabbing active:scale-95 transition-shadow ${
                  sliderOffset < -20
                    ? 'ring-2 ring-emerald-500/60 shadow-emerald-200'
                    : sliderOffset > 20
                    ? 'ring-2 ring-rose-500/60 shadow-rose-200'
                    : ''
                }`}
              >
                <div className="flex items-center gap-0.5 text-slate-700 pointer-events-none">
                  <ChevronLeft 
                    size={11} 
                    strokeWidth={3} 
                    className={`transition-colors ${sliderOffset < -10 ? 'text-[#16A34A] -translate-x-0.5' : 'text-slate-400'}`} 
                  />
                  {/* Diamond Icon matching mockup */}
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" className="shrink-0">
                    <rect 
                      x="4.5" 
                      y="4.5" 
                      width="15" 
                      height="15" 
                      rx="3.5" 
                      transform="rotate(45 12 12)" 
                      stroke={sliderOffset < -20 ? '#16A34A' : sliderOffset > 20 ? '#DC2626' : '#334155'} 
                      strokeWidth="2.8" 
                    />
                  </svg>
                  <ChevronRight 
                    size={11} 
                    strokeWidth={3} 
                    className={`transition-colors ${sliderOffset > 10 ? 'text-[#DC2626] translate-x-0.5' : 'text-slate-400'}`} 
                  />
                </div>
              </div>
            </div>

            {/* Helper Slider Prompt */}
            <div className="mt-1.5 text-[10.5px] font-medium text-slate-400 text-center tracking-wide select-none">
              {sliderOffset <= -triggerThreshold ? (
                <span className="text-emerald-600 font-bold animate-pulse">Release to Confirm Credit ←</span>
              ) : sliderOffset >= triggerThreshold ? (
                <span className="text-rose-600 font-bold animate-pulse">Release to Confirm Debit →</span>
              ) : (
                <span>Slide knob left for Credit &bull; right for Debit</span>
              )}
            </div>
          </div>
        </form>
      </div>

      {/* Pending Bills Popup Modal */}
      {showPendingBillsModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-900/60 backdrop-blur-xs">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-xl border border-slate-200 overflow-hidden flex flex-col max-h-[90vh] animate-in fade-in zoom-in-95 duration-150">
            {/* Header */}
            <div className="px-4 sm:px-5 py-3 border-b border-slate-100 bg-slate-50/80 flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="w-7.5 h-7.5 sm:w-8 sm:h-8 rounded-lg bg-blue-50 border border-blue-200 flex items-center justify-center text-blue-700 shadow-xs shrink-0">
                  <FileText size={17} strokeWidth={2.3} />
                </div>
                <div>
                  <h3 className="font-bold text-slate-900 text-sm sm:text-base flex items-center gap-2">
                    Today's Unlisted Bills
                    <span className="text-[11px] bg-amber-100 text-amber-900 px-2 py-0.5 rounded-full font-bold">
                      {todayPendingBills.length}
                    </span>
                  </h3>
                  <p className="text-[11px] text-slate-500">
                    Bills waiting to list into Debit Sheet
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowPendingBillsModal(false)}
                className="w-8 h-8 rounded-lg hover:bg-slate-200/70 text-slate-400 hover:text-slate-700 flex items-center justify-center transition-colors cursor-pointer"
              >
                <X size={18} />
              </button>
            </div>

            {/* Search filter if there are several bills */}
            {todayPendingBills.length > 2 && (
              <div className="px-4 py-2 bg-white border-b border-slate-100">
                <div className="relative">
                  <Search size={14} className="absolute left-2.5 top-2.5 text-slate-400" />
                  <input
                    type="text"
                    value={pendingModalSearch}
                    onChange={e => setPendingModalSearch(e.target.value)}
                    placeholder="Search by Bill # or Customer Name..."
                    className="w-full pl-8 pr-3 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-800 placeholder:text-slate-400 focus:bg-white focus:border-blue-500"
                  />
                  {pendingModalSearch && (
                    <button
                      type="button"
                      onClick={() => setPendingModalSearch('')}
                      className="absolute right-2.5 top-2 text-slate-400 hover:text-slate-600 text-xs"
                    >
                      Clear
                    </button>
                  )}
                </div>
              </div>
            )}

            {/* Bills List */}
            <div className="flex-1 overflow-y-auto p-3 sm:p-4 space-y-2.5">
              {(() => {
                const filtered = todayPendingBills.filter(b => {
                  if (!pendingModalSearch.trim()) return true;
                  const q = pendingModalSearch.toLowerCase();
                  return (
                    b.bill_no?.toLowerCase().includes(q) ||
                    b.customer_name?.toLowerCase().includes(q) ||
                    String(b.total_amount).includes(q)
                  );
                });

                if (filtered.length === 0) {
                  return (
                    <div className="py-8 text-center text-slate-500 text-xs">
                      No matching bills found.
                    </div>
                  );
                }

                return filtered.map(bill => {
                  const key = bill.id || bill.bill_no;

                  return (
                    <div key={key} className="p-3 sm:p-3.5 rounded-xl border border-slate-200/90 hover:border-blue-300 bg-white hover:bg-slate-50/40 transition-all shadow-2xs">
                      <div className="flex items-center justify-between gap-3">
                        <div className="space-y-1 min-w-0 flex-1">
                          <span className="font-mono font-bold text-slate-900 text-sm sm:text-base block">
                            #{bill.bill_no}
                          </span>

                          <p className="font-semibold text-slate-900 text-xs sm:text-sm truncate">
                            {bill.customer_name}
                          </p>

                          <div className="text-[11px] font-medium text-slate-500">
                            Total Qty: <span className="font-bold text-slate-800">{bill.total_qty ?? 0} pcs</span>
                          </div>
                        </div>

                        <div className="text-right shrink-0">
                          <div className="font-mono font-extrabold text-slate-900 text-sm sm:text-base">
                            ₹{Number(bill.total_amount).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          </div>

                          <div className="mt-2 flex justify-end">
                            <button
                              type="button"
                              onClick={() => handleSelectBillFromModal(bill)}
                              className="px-3.5 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-bold transition-colors flex items-center gap-1 cursor-pointer shadow-xs active:scale-95"
                            >
                              <Check size={13} strokeWidth={2.5} />
                              Apply
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                });
              })()}
            </div>

            {/* Footer */}
            <div className="px-4 py-2.5 bg-slate-50 border-t border-slate-100 flex items-center justify-between text-xs">
              <span className="text-slate-500">
                Total Pending: <strong className="text-slate-900 font-mono">₹{todayPendingBills.reduce((acc, b) => acc + (Number(b.total_amount) || 0), 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</strong>
              </span>
              <button
                type="button"
                onClick={() => setShowPendingBillsModal(false)}
                className="px-3 py-1 text-slate-600 hover:bg-slate-200/60 rounded-md font-semibold text-xs cursor-pointer"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

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
          ledgerType={activeLedger?.type}
          isPurchaseStyle={activeLedger?.type === 'PURCHASE' || activeLedger?.type === 'LIABILITY' || activeLedger?.type === 'CAPITAL'}
          autoPrint={autoPrintReceipt}
        />
      )}

      {/* Success Notification Banner Modal */}
      {showSuccess && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-xs">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 text-center space-y-4 border border-slate-200">
            <div className="w-14 h-14 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center mx-auto">
              <Check size={28} />
            </div>
            <div>
              <h3 className="font-extrabold text-slate-900 text-base">Voucher Posted!</h3>
              <p className="text-xs text-slate-500 mt-0.5">Recorded in {activeLedger?.name}</p>
            </div>

            <div className="flex items-center gap-2.5 pt-1">
              {lastSavedTx && (
                <button
                  type="button"
                  onClick={() => {
                    setReceiptTx(lastSavedTx.transaction);
                    setReceiptPartyName(lastSavedTx.partyName);
                    setReceiptPartyPhone(lastSavedTx.partyPhone);
                    setShowSuccess(false);
                  }}
                  className="flex-1 py-2.5 px-3 bg-blue-600 hover:bg-blue-700 active:scale-98 text-white rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 shadow-xs transition-all cursor-pointer truncate"
                >
                  <Printer size={14} className="shrink-0" />
                  <span className="truncate">Print Receipt</span>
                </button>
              )}

              <button
                type="button"
                onClick={() => {
                  setShowSuccess(false);
                  if (invoiceRef.current) {
                    invoiceRef.current.focus();
                  }
                }}
                className="flex-1 py-2.5 px-3 bg-slate-900 hover:bg-slate-800 active:scale-98 text-white rounded-xl text-xs font-bold flex items-center justify-center transition-all cursor-pointer truncate"
              >
                <span className="truncate">Post Next</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
