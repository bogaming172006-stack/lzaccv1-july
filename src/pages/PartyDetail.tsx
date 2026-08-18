import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { db, handleFirestoreError, OperationType, doc, getDoc, collection, query, where, updateDoc, getDocs } from '../firebase';
import { Party, Transaction } from '../types';
import { 
  ArrowLeft, 
  Download, 
  Plus, 
  Minus, 
  FileText, 
  Edit2, 
  Check, 
  Search, 
  ChevronLeft, 
  ChevronRight, 
  Trash2, 
  Share2, 
  Copy, 
  Lock, 
  Eye, 
  EyeOff, 
  Key, 
  Building2, 
  Phone, 
  Mail, 
  MapPin,
  TrendingDown,
  TrendingUp,
  CreditCard,
  X,
  Loader2
} from 'lucide-react';
import { v4 as uuidv4 } from 'uuid';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { ToWords } from 'to-words';
import { format } from 'date-fns';
import { useLedger } from '../LedgerContext';
import { useAuth } from '../AuthContext';

import { createTransaction, editTransaction, deleteTransaction } from '../lib/transactionService';
import { getCacheItem, getFilteredCacheItems, setCacheItem } from '../lib/idbCache';
import { syncCollection } from '../lib/syncCache';
import ThermalReceiptModal from '../components/ThermalReceiptModal';
import { loadImage } from '../components/CompanyLogo';
import TransactionDetailModal from '../components/TransactionDetailModal';
import { formatContactWith91 } from '../lib/phoneUtils';
import { exportEncryptedPdf, downloadPdfBlob } from '../lib/pdfEncrypt';
import PageHeader from '../components/ui/PageHeader';
import StatCard from '../components/ui/StatCard';
import AmountDisplay from '../components/ui/AmountDisplay';
import Badge from '../components/ui/Badge';
import { Card, CardHeader, CardBody } from '../components/ui/Card';

export default function PartyDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { activeLedger } = useLedger();
  const isPurchaseStyle = activeLedger?.type === 'PURCHASE' || activeLedger?.type === 'LIABILITY' || activeLedger?.type === 'CAPITAL';
  const { currentUser } = useAuth();
  const [party, setParty] = useState<Party | null>(null);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [receiptTx, setReceiptTx] = useState<Transaction | null>(null);
  const [selectedDetailTx, setSelectedDetailTx] = useState<Transaction | null>(null);
  
  const [showTxModal, setShowTxModal] = useState<'DEBIT' | 'CREDIT' | null>(null);
  const [showTxConfirmModal, setShowTxConfirmModal] = useState(false);
  const [txAmount, setTxAmount] = useState('');
  const [separateCredit, setSeparateCredit] = useState(false);
  const [txCashAmount, setTxCashAmount] = useState('');
  const [txAcAmount, setTxAcAmount] = useState('');
  const [txInvoiceNo, setTxInvoiceNo] = useState('');
  const [txNotes, setTxNotes] = useState('');
  const [txError, setTxError] = useState('');
  const [matchedInvoiceInfo, setMatchedInvoiceInfo] = useState<{ amount: number; date: number; partyName: string; type: 'DEBIT' | 'CREDIT' } | null>(null);
  const [isCheckingTxInvoice, setIsCheckingTxInvoice] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);

  const [editingTx, setEditingTx] = useState<Transaction | null>(null);
  const [deletingTx, setDeletingTx] = useState<Transaction | null>(null);
  const [showDeleteConfirmModal, setShowDeleteConfirmModal] = useState(false);
  const [deletePassword, setDeletePassword] = useState('');
  const [deletePasswordError, setDeletePasswordError] = useState('');
  const [editTxAmount, setEditTxAmount] = useState('');
  const [editTxInvoiceNo, setEditTxInvoiceNo] = useState('');
  const [editTxNotes, setEditTxNotes] = useState('');
  const [editTxError, setEditTxError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  const [showDownloadModal, setShowDownloadModal] = useState(false);
  const [downloadStartDate, setDownloadStartDate] = useState(format(new Date(), 'yyyy-MM-01'));
  const [downloadEndDate, setDownloadEndDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [downloadPdfPassword, setDownloadPdfPassword] = useState('');
  const [showDownloadPassText, setShowDownloadPassText] = useState(false);

  const [showShareModal, setShowShareModal] = useState(false);
  const [shareStartDate, setShareStartDate] = useState(() => {
    const d = new Date();
    d.setMonth(d.getMonth() - 1);
    return format(d, 'yyyy-MM-dd');
  });
  const [shareEndDate, setShareEndDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [sharePdfPassword, setSharePdfPassword] = useState('');
  const [showSharePassText, setShowSharePassText] = useState(false);
  const [shareCopied, setShareCopied] = useState(false);

  // Edit Party details state
  const [showEditPartyModal, setShowEditPartyModal] = useState(false);
  const [editPartyName, setEditPartyName] = useState('');
  const [editPartyPhone, setEditPartyPhone] = useState('');
  const [editPartyAddress, setEditPartyAddress] = useState('');
  const [editPartyEmail, setEditPartyEmail] = useState('');
  const [editPartyStatus, setEditPartyStatus] = useState<'Active' | 'Inactive'>('Active');
  const [editPartyError, setEditPartyError] = useState('');

  const handleOpenEditParty = () => {
    if (!party) return;
    setEditPartyName(party.name);
    setEditPartyPhone(party.phone || '');
    setEditPartyAddress(party.address || '');
    setEditPartyEmail(party.email || '');
    setEditPartyStatus(party.status || 'Active');
    setEditPartyError('');
    setShowEditPartyModal(true);
  };

  const handleEditPartySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!party || !id) return;
    if (!editPartyName.trim()) {
      setEditPartyError('Party name is required.');
      return;
    }
    setIsSubmitting(true);
    setEditPartyError('');

    const updatedParty: Party = {
      ...party,
      name: editPartyName.trim(),
      phone: formatContactWith91(editPartyPhone),
      address: editPartyAddress.trim(),
      email: editPartyEmail.trim(),
      status: editPartyStatus,
      lastTransaction: Date.now()
    };

    try {
      await setCacheItem<Party>('parties', updatedParty);
      setParty(updatedParty);

      await updateDoc(doc(db, 'parties', id), {
        name: updatedParty.name,
        phone: updatedParty.phone,
        address: updatedParty.address,
        email: updatedParty.email,
        status: updatedParty.status,
        lastTransaction: updatedParty.lastTransaction
      });

      window.dispatchEvent(new CustomEvent('database-synced'));
      setShowEditPartyModal(false);
    } catch (err) {
      console.error("Failed to update party details:", err);
      setEditPartyError('Failed to save changes. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const fetchPartyAndTransactions = async () => {
    if (!id) return;
    try {
      const cachedParty = await getCacheItem<Party>('parties', id);
      if (cachedParty) {
        setParty(cachedParty);
      } else {
        const partySnap = await getDoc(doc(db, 'parties', id));
        if (partySnap.exists()) {
          setParty(partySnap.data() as Party);
        }
      }

      const cachedTxs = await getFilteredCacheItems<Transaction>('transactions', t => t.partyId === id);
      const openingBal = cachedParty?.openingBalance ?? 0;
      cachedTxs.sort((a, b) => a.timestamp - b.timestamp);
      let currentBal = openingBal;
      const cachedTxsWithBalances = cachedTxs.map(tx => {
        const balanceChange = tx.type === 'DEBIT' ? tx.amount : -tx.amount;
        currentBal += balanceChange;
        return {
          ...tx,
          runningBalance: currentBal
        };
      });
      cachedTxsWithBalances.sort((a, b) => b.timestamp - a.timestamp);
      setTransactions(cachedTxsWithBalances);

      if (activeLedger?.id) {
        await Promise.all([
          syncCollection<Party>('parties', activeLedger.id, 'parties'),
          syncCollection<Transaction>('transactions', activeLedger.id, 'transactions')
        ]);
        
        const [freshParty, freshTxs] = await Promise.all([
          getCacheItem<Party>('parties', id),
          getFilteredCacheItems<Transaction>('transactions', t => t.partyId === id)
        ]);

        if (freshParty) {
          setParty(freshParty);
        }
        if (freshTxs) {
          const syncOpeningBal = (freshParty || cachedParty)?.openingBalance ?? 0;
          freshTxs.sort((a, b) => a.timestamp - b.timestamp);
          let syncBal = syncOpeningBal;
          const freshTxsWithBalances = freshTxs.map(tx => {
            const balanceChange = tx.type === 'DEBIT' ? tx.amount : -tx.amount;
            syncBal += balanceChange;
            return {
              ...tx,
              runningBalance: syncBal
            };
          });
          freshTxsWithBalances.sort((a, b) => b.timestamp - a.timestamp);
          setTransactions(freshTxsWithBalances);
        }
      }
    } catch (error) {
      console.error("Failed to load party details:", error);
    }
  };

  useEffect(() => {
    fetchPartyAndTransactions();

    const handleSync = () => {
      fetchPartyAndTransactions();
    };
    window.addEventListener('database-synced', handleSync);
    return () => {
      window.removeEventListener('database-synced', handleSync);
    };
  }, [id, activeLedger?.id]);

  const [currentPage, setCurrentPage] = useState(1);
  const ITEMS_PER_PAGE = 15;

  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery, id]);

  const filteredTxs = transactions.filter(tx => {
    if (!searchQuery) return true;
    const lowerQuery = searchQuery.toLowerCase();
    const notesMatch = tx.notes?.toLowerCase().includes(lowerQuery);
    const invoiceMatch = tx.invoiceNo?.toLowerCase().includes(lowerQuery);
    return notesMatch || invoiceMatch;
  });

  const totalPages = Math.ceil(filteredTxs.length / ITEMS_PER_PAGE);

  const pageTxs = filteredTxs.slice(
    (currentPage - 1) * ITEMS_PER_PAGE,
    currentPage * ITEMS_PER_PAGE
  );

  const txWithBalance = [...pageTxs].sort((a, b) => a.timestamp - b.timestamp);
  const sortedFilteredTxs = [...filteredTxs].sort((a, b) => a.timestamp - b.timestamp);

  let pageOpeningBalance = party?.openingBalance ?? 0;
  if (txWithBalance.length > 0 && sortedFilteredTxs.length > 0) {
    const firstTxOnPage = txWithBalance[0];
    const idx = sortedFilteredTxs.findIndex(tx => tx.id === firstTxOnPage.id);
    if (idx > 0) {
      pageOpeningBalance = sortedFilteredTxs[idx - 1].runningBalance ?? party?.openingBalance ?? 0;
    }
  }

  const isFirstPageOfTransactions = sortedFilteredTxs.length === 0 || (txWithBalance.length > 0 && txWithBalance[0].id === sortedFilteredTxs[0].id);

  const buildPdf = async (startDate: string, endDate: string) => {
    if (!party) return null;
    const doc = new jsPDF();

    const startTs = new Date(startDate).setHours(0, 0, 0, 0);
    const endTs = new Date(endDate).setHours(23, 59, 59, 999);
    
    const allTxs = await getFilteredCacheItems<Transaction>('transactions', t => t.partyId === id);
    const sortedAllTxs = allTxs.sort((a, b) => a.timestamp - b.timestamp);
    
    let currentBal = party.openingBalance;
    const allTxsWithBalances = sortedAllTxs.map(tx => {
      const balanceChange = tx.type === 'DEBIT' ? tx.amount : -tx.amount;
      currentBal += balanceChange;
      return {
        ...tx,
        runningBalance: currentBal
      };
    });
    
    const filteredTx = allTxsWithBalances.filter(tx => tx.timestamp >= startTs && tx.timestamp <= endTs);
    
    let periodOpeningBalance = party.openingBalance;
    const priorTx = allTxsWithBalances.filter(tx => tx.timestamp < startTs);
    if (priorTx.length > 0) {
      periodOpeningBalance = priorTx[priorTx.length - 1].runningBalance ?? party.openingBalance;
    }
    
    let logoBottom = 26;
    try {
      const img = await loadImage('/logo.png');
      const imgWidth = img.naturalWidth || img.width || 100;
      const imgHeight = img.naturalHeight || img.height || 100;
      const aspectRatio = imgWidth / imgHeight;
      
      let targetWidth = 95;
      let targetHeight = targetWidth / aspectRatio;
      if (targetHeight > 35) {
        targetHeight = 35;
        targetWidth = targetHeight * aspectRatio;
      }
      const xPos = 105 - (targetWidth / 2);
      doc.addImage(img, 'PNG', xPos, 10, targetWidth, targetHeight, undefined, 'FAST');
      logoBottom = 10 + targetHeight;
    } catch (e) {
      doc.setTextColor(15, 23, 42);
      doc.setFontSize(24);
      doc.setFont('helvetica', 'bold');
      doc.text('GREENZAR FOOD & BEVERAGE', 105, 20, { align: 'center' });
      logoBottom = 28;
    }
    
    doc.setTextColor(100, 116, 139);
    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');
    doc.text('Jhampa, Deganga, North 24 PGS | West Bengal, PIN.-743423', 105, logoBottom + 5, { align: 'center' });
    doc.text('Ph: +91 9476156298  |  Email: greenzarfood@gmail.com', 105, logoBottom + 10, { align: 'center' });
    
    doc.setTextColor(15, 23, 42);
    doc.setFontSize(13);
    doc.setFont('helvetica', 'bold');
    doc.text('ACCOUNT STATEMENT', 105, logoBottom + 20, { align: 'center' });
    
    const startDateStr = format(new Date(startDate), 'yyyy-MM-dd');
    const endDateStr = format(new Date(endDate), 'yyyy-MM-dd');
    doc.setTextColor(100, 116, 139);
    doc.setFontSize(9);
    doc.text(`PERIOD: ${startDateStr} to ${endDateStr}`, 105, logoBottom + 26, { align: 'center' });
    
    doc.setTextColor(2, 132, 199);
    doc.text(`PARTY: ${party.name.toUpperCase()}`, 105, logoBottom + 31, { align: 'center' });
    
    doc.setTextColor(15, 23, 42);
    doc.setFontSize(13);
    doc.setFont('helvetica', 'bold');
    doc.text(party.name, 14, logoBottom + 45);
    if (party.address) {
      doc.setFontSize(9);
      doc.setFont('helvetica', 'normal');
      doc.text(`Address: ${party.address}`, 14, logoBottom + 51);
    }
    
    const startY = party.address ? (logoBottom + 58) : (logoBottom + 50);

    const body = filteredTx.map(tx => {
      const particulars = [];
      if (tx.notes) particulars.push(tx.notes.replace(/₹/g, 'Rs.'));
      if (tx.invoiceNo) particulars.push(`Inv: ${tx.invoiceNo}`);
      
      return [
        format(new Date(tx.timestamp), 'dd MMM yyyy, hh:mm a'),
        particulars.join('\n') || '-',
        tx.type === 'DEBIT' ? tx.amount.toFixed(2) : '-',
        tx.type === 'CREDIT' ? tx.amount.toFixed(2) : '-',
        (tx.runningBalance > 0 ? `-${tx.runningBalance.toFixed(2)}` : Math.abs(tx.runningBalance).toFixed(2))
      ];
    });

    body.unshift([
      '-',
      'Opening Balance',
      periodOpeningBalance > 0 ? periodOpeningBalance.toFixed(2) : '-',
      periodOpeningBalance < 0 ? Math.abs(periodOpeningBalance).toFixed(2) : '-',
      (periodOpeningBalance > 0 ? `-${periodOpeningBalance.toFixed(2)}` : Math.abs(periodOpeningBalance).toFixed(2))
    ]);

    autoTable(doc, {
      startY: startY,
      margin: { left: 14, right: 14 },
      head: [['Date', 'Particulars', 'Debit (Dr)', 'Credit (Cr)', 'Balance']],
      body: body,
      theme: 'grid',
      columnStyles: {
        0: { cellWidth: 38 },
        1: { cellWidth: 'auto' },
        2: { cellWidth: 28 },
        3: { cellWidth: 28 },
        4: { cellWidth: 28 },
      },
      styles: {
        fontSize: 8,
        cellPadding: 2.5,
        lineColor: [226, 232, 240],
        lineWidth: 0.1,
        textColor: [51, 65, 85],
      },
      headStyles: { 
        fillColor: [248, 250, 252],
        textColor: [15, 23, 42],
        fontStyle: 'bold',
        lineColor: [226, 232, 240],
        lineWidth: 0.1,
      },
      didParseCell: function(data) {
        if (data.section === 'body') {
          if (data.column.index === 2 && data.cell.raw !== '-') {
            data.cell.styles.textColor = [220, 38, 38];
          } else if (data.column.index === 3 && data.cell.raw !== '-') {
            data.cell.styles.textColor = [5, 150, 105];
          }
        }
        if (data.column.index === 2 || data.column.index === 3 || data.column.index === 4) {
          data.cell.styles.halign = 'right';
        }
      }
    });

    const finalY = (doc as any).lastAutoTable.finalY || startY;
    
    let periodFinalBalance = periodOpeningBalance;
    if (filteredTx.length > 0) {
      periodFinalBalance = filteredTx[filteredTx.length - 1].runningBalance;
    }

    let words = '';
    try {
      const toWords = new ToWords({
        localeCode: 'en-IN',
        converterOptions: {
          currency: true,
          ignoreDecimal: false,
          ignoreZeroCurrency: false,
          doNotAddOnly: false,
        }
      });
      words = toWords.convert(Math.abs(Math.round(periodFinalBalance * 100) / 100));
    } catch(e) {
      console.error(e);
    }

    doc.setFillColor(248, 250, 252);
    doc.rect(14, finalY + 8, 182, 28, 'F');
    doc.setFontSize(11);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(0, 0, 0);
    doc.text('Period Total:', 20, finalY + 20);
    doc.text(`Rs. ${periodFinalBalance > 0 ? '-' : ''}${Math.abs(periodFinalBalance).toFixed(2)}`, 190, finalY + 20, { align: 'right' });
    
    doc.setFontSize(9);
    doc.setFont('helvetica', 'italic');
    doc.setTextColor(71, 85, 105);
    doc.text(`Amount in words: ${words}`, 20, finalY + 30);
    
    let currentY = finalY + 44;
    doc.setFontSize(9);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(15, 23, 42);
    doc.text('Payment Instructions', 14, currentY); currentY += 5;

    doc.setTextColor(71, 85, 105);
    doc.setFontSize(8);
    doc.setFont('helvetica', 'bold');
    doc.text('Bank:', 14, currentY);
    doc.setFont('helvetica', 'normal');
    doc.text('UCO BANK (BADU BR.)  |  Greenzar Food And Beverage', 26, currentY); currentY += 4.5;
    doc.text('A/C No: 06710510011188  |  IFSC: UCBA0000671', 26, currentY); currentY += 5.5;

    doc.setFont('helvetica', 'bold');
    doc.text('UPI ID:', 14, currentY);
    doc.setFont('helvetica', 'normal');
    doc.text('9874682388@ibl', 26, currentY);

    return doc;
  };

  const generatePdf = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!party) return;
    const doc = await buildPdf(downloadStartDate, downloadEndDate);
    if (doc) {
      const fileName = `ledger_${party.name.replace(/\s+/g, '_')}_${format(new Date(), 'yyyyMMdd')}.pdf`;
      const { blob } = await exportEncryptedPdf(doc, downloadPdfPassword);
      downloadPdfBlob(blob, fileName);
    }
    setShowDownloadModal(false);
  };

  const handleSharePdf = async () => {
    if (!party) return;
    try {
      const doc = await buildPdf(shareStartDate, shareEndDate);
      if (!doc) return;
      const fileName = `ledger_${party.name.replace(/\s+/g, '_')}_${format(new Date(), 'yyyyMMdd')}.pdf`;
      const { blob } = await exportEncryptedPdf(doc, sharePdfPassword);
      const file = new File([blob], fileName, { type: 'application/pdf' });

      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({
          files: [file],
          title: `Ledger Statement: ${party.name}`,
          text: `Please find attached the ledger statement for ${party.name} from ${format(new Date(shareStartDate), 'dd MMM yyyy')} to ${format(new Date(shareEndDate), 'dd MMM yyyy')}.${sharePdfPassword.trim() ? ' (Protected PDF - Password required to open)' : ''}`
        });
      } else {
        downloadPdfBlob(blob, fileName);
        alert('File sharing is not fully supported on this device/browser. The PDF statement has been downloaded instead.');
      }
    } catch (error) {
      console.error('Error sharing PDF:', error);
    }
  };

  useEffect(() => {
    if (!showTxModal) {
      setTxAmount('');
      setTxCashAmount('');
      setTxAcAmount('');
      setTxInvoiceNo('');
      setTxNotes('');
      setSeparateCredit(false);
      setMatchedInvoiceInfo(null);
      setTxError('');
    }
  }, [showTxModal]);

  const checkTxInvoice = async (invNo: string, currentModalType: 'DEBIT' | 'CREDIT'): Promise<boolean> => {
    if (!invNo.trim() || !party?.ledgerId) {
      setMatchedInvoiceInfo(null);
      return true;
    }
    setIsCheckingTxInvoice(true);
    try {
      const normalizedInvoice = invNo.toLowerCase().trim();
      const qTracked = query(collection(db, 'tracked_invoices'), where('ledgerId', '==', party.ledgerId), where('invoiceNo', '==', normalizedInvoice));
      const trackedSnap = await getDocs(qTracked);
      const trackedDocs = trackedSnap.docs.map(d => d.data());
      
      const qTx = query(collection(db, 'transactions'), where('ledgerId', '==', party.ledgerId), where('invoiceNo', '==', normalizedInvoice));
      const txSnap = await getDocs(qTx);
      const matchedTxs = txSnap.docs.map(d => d.data() as Transaction);

      const debitTx = matchedTxs.find(t => t.type === 'DEBIT');
      const creditTx = matchedTxs.find(t => t.type === 'CREDIT');
      const debitTracked = trackedDocs.find(t => t.type === 'DEBIT');
      const creditTracked = trackedDocs.find(t => t.type === 'CREDIT');

      const hasDebit = !!(debitTx || debitTracked);
      const hasCredit = !!(creditTx || creditTracked);

      if (!hasDebit && !hasCredit) {
        setMatchedInvoiceInfo(null);
        return true;
      }

      const getPartyName = async (partyId?: string): Promise<string> => {
        if (!partyId) return 'Unknown Party';
        if (partyId === party.id) return party.name;
        try {
          const cached = await getCacheItem<Party>('parties', partyId);
          if (cached?.name) return cached.name;
          const pDoc = await getDoc(doc(db, 'parties', partyId));
          if (pDoc.exists()) {
            return (pDoc.data() as Party).name || 'Unknown Party';
          }
        } catch (e) {
          console.error("Error getting party name:", e);
        }
        return 'Unknown Party';
      };

      if (hasDebit && hasCredit) {
        setMatchedInvoiceInfo(null);
        setTxError(`Invoice #${invNo.toUpperCase()} is ALREADY listed in BOTH Debit and Credit sheets (Fully Completed).`);
        return false;
      }

      if (currentModalType === 'DEBIT' && hasDebit) {
        const pId = debitTx?.partyId || debitTracked?.partyId;
        const pName = await getPartyName(pId);
        setMatchedInvoiceInfo(null);
        setTxError(`Invoice #${invNo.toUpperCase()} was ALREADY entered as a DEBIT for ${pName}.`);
        return false;
      }

      if (currentModalType === 'CREDIT' && hasCredit) {
        const pId = creditTx?.partyId || creditTracked?.partyId;
        const pName = await getPartyName(pId);
        setMatchedInvoiceInfo(null);
        setTxError(`Invoice #${invNo.toUpperCase()} was ALREADY entered as a CREDIT for ${pName}.`);
        return false;
      }

      const origTx = currentModalType === 'CREDIT' ? debitTx : creditTx;
      const origTracked = currentModalType === 'CREDIT' ? debitTracked : creditTracked;
      const origPartyId = origTx?.partyId || origTracked?.partyId;
      const origPartyName = await getPartyName(origPartyId);
      const origAmount = origTx?.amount || 0;
      const origDate = origTx?.timestamp || Date.now();
      const origType = currentModalType === 'CREDIT' ? 'DEBIT' : 'CREDIT';

      setMatchedInvoiceInfo({
        amount: origAmount,
        date: origDate,
        partyName: origPartyName,
        type: origType
      });

      if (origAmount > 0 && !txAmount && !txCashAmount && !txAcAmount) {
        setTxAmount(origAmount.toString());
      }

      if (origPartyId && origPartyId !== party.id) {
        setMatchedInvoiceInfo(null);
        setTxError(`Invoice #${invNo.toUpperCase()} is ALREADY listed under party "${origPartyName}".`);
        return false;
      }

      return true;
    } catch (e) {
      console.error("Error checking invoice in PartyDetail", e);
      return true;
    } finally {
      setIsCheckingTxInvoice(false);
    }
  };

  const handlePreTxSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setTxError('');

    if (txInvoiceNo.trim()) {
      const isInvoiceValid = await checkTxInvoice(txInvoiceNo, showTxModal!);
      if (!isInvoiceValid) return;
    }

    if (showTxModal === 'CREDIT' && separateCredit) {
      const cashVal = parseFloat(txCashAmount) || 0;
      const acVal = parseFloat(txAcAmount) || 0;
      const totalVal = cashVal + acVal;
      if (totalVal <= 0) {
        setTxError('Please enter a valid Cash Credit or A/C Credit amount.');
        return;
      }
    } else {
      const numAmount = parseFloat(txAmount);
      if (isNaN(numAmount) || numAmount <= 0) {
        setTxError('Please enter a valid amount.');
        return;
      }
    }
    if (!txInvoiceNo.trim() && !txNotes.trim()) {
      setTxError('Please enter either a Receipt/Invoice No. or Notes.');
      return;
    }
    setShowTxConfirmModal(true);
  };

  const handleConfirmTxSubmit = async () => {
    if (isSubmitting || !party || !showTxModal) return;
    setIsSubmitting(true);
    
    const txId = uuidv4();
    let numAmount = 0;
    let finalNotes = txNotes.trim();

    if (showTxModal === 'CREDIT' && separateCredit) {
      const cashVal = parseFloat(txCashAmount) || 0;
      const acVal = parseFloat(txAcAmount) || 0;
      numAmount = cashVal + acVal;
      if (numAmount <= 0) {
        setIsSubmitting(false);
        return;
      }

      const breakdownParts: string[] = [];
      if (cashVal > 0) breakdownParts.push(`Cash: ₹${cashVal.toFixed(2)}`);
      if (acVal > 0) breakdownParts.push(`A/C: ₹${acVal.toFixed(2)}`);
      if (breakdownParts.length > 0) {
        const breakdownStr = `[${breakdownParts.join(', ')}]`;
        finalNotes = finalNotes ? `${breakdownStr} - ${finalNotes}` : breakdownStr;
      }
    } else {
      numAmount = parseFloat(txAmount);
      if (isNaN(numAmount) || numAmount <= 0) {
        setIsSubmitting(false);
        return;
      }
    }

    const newTx: Transaction = {
      id: txId,
      partyId: party.id,
      ledgerId: party.ledgerId,
      invoiceNo: txInvoiceNo.toLowerCase().trim(),
      type: showTxModal,
      amount: numAmount,
      notes: finalNotes,
      timestamp: Date.now()
    };

    const newBalance = party.currentDue + (showTxModal === 'DEBIT' ? numAmount : -numAmount);
    const newTxWithBalance: Transaction = {
      ...newTx,
      runningBalance: newBalance
    };

    setParty(prev => prev ? {
      ...prev,
      currentDue: newBalance,
      totalDebit: (prev.totalDebit || 0) + (showTxModal === 'DEBIT' ? numAmount : 0),
      totalCredit: (prev.totalCredit || 0) + (showTxModal === 'CREDIT' ? numAmount : 0),
      lastTransaction: newTx.timestamp
    } : null);

    setTransactions(prev => [newTxWithBalance, ...prev]);

    setShowTxConfirmModal(false);
    setShowTxModal(null);
    setShowSuccess(true);
    setTimeout(() => setShowSuccess(false), 1500);
    setIsSubmitting(false);

    try {
      await createTransaction(newTx, party);
      fetchPartyAndTransactions();
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, `transactions/${txId}`);
    }
  };

  const handleEditSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setEditTxError('');
    if (isSubmitting || !party || !editingTx) return;
    setIsSubmitting(true);
    
    const numAmount = parseFloat(editTxAmount);
    if (isNaN(numAmount) || numAmount <= 0) {
      setEditTxError('Please enter a valid amount.');
      setIsSubmitting(false);
      return;
    }

    if (!editTxInvoiceNo.trim() && !editTxNotes.trim()) {
      setEditTxError('Please enter either a Receipt/Invoice No. or Notes.');
      setIsSubmitting(false);
      return;
    }

    try {
      const success = await editTransaction(
        editingTx.id,
        editingTx,
        {
          amount: numAmount,
          invoiceNo: editTxInvoiceNo.toLowerCase().trim(),
          notes: editTxNotes
        },
        party
      );
      if (success) {
        setEditingTx(null);
        setShowSuccess(true);
        setTimeout(() => setShowSuccess(false), 1500);
        await fetchPartyAndTransactions();
      }
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `transactions/${editingTx.id}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDeleteSubmit = async () => {
    if (isSubmitting || !party || !deletingTx) return;
    if (deletePassword !== 'greenzarthing6211') {
      setDeletePasswordError('Invalid admin password');
      return;
    }
    setIsSubmitting(true);
    try {
      const success = await deleteTransaction(deletingTx, party);
      if (success) {
        setShowDeleteConfirmModal(false);
        setDeletingTx(null);
        setDeletePassword('');
        setDeletePasswordError('');
        setShowSuccess(true);
        setTimeout(() => setShowSuccess(false), 1500);
        await fetchPartyAndTransactions();
      }
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, `transactions/${deletingTx.id}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  const getShareRangeData = () => {
    if (!party) return { rangeTxs: [], periodOpeningBalance: 0, periodClosingBalance: 0, totalDebit: 0, totalCredit: 0 };
    
    const startTs = new Date(shareStartDate).setHours(0, 0, 0, 0);
    const endTs = new Date(shareEndDate).setHours(23, 59, 59, 999);
    
    const sortedAllTxs = [...transactions].sort((a, b) => a.timestamp - b.timestamp);
    const rangeTxs = sortedAllTxs.filter(tx => tx.timestamp >= startTs && tx.timestamp <= endTs);
    
    let periodOpeningBalance = party.openingBalance ?? 0;
    const priorTxs = sortedAllTxs.filter(tx => tx.timestamp < startTs);
    if (priorTxs.length > 0) {
      periodOpeningBalance = priorTxs[priorTxs.length - 1].runningBalance ?? party.openingBalance ?? 0;
    }
    
    let totalDebit = 0;
    let totalCredit = 0;
    rangeTxs.forEach(tx => {
      if (tx.type === 'DEBIT') {
        totalDebit += tx.amount;
      } else {
        totalCredit += tx.amount;
      }
    });

    const periodClosingBalance = rangeTxs.length > 0 
      ? (rangeTxs[rangeTxs.length - 1].runningBalance ?? periodOpeningBalance)
      : periodOpeningBalance;
      
    return { rangeTxs, periodOpeningBalance, periodClosingBalance, totalDebit, totalCredit };
  };

  const getShareMessage = (rangeTxs: Transaction[], startBal: number, endBal: number, totalDr: number, totalCr: number) => {
    if (!party) return '';
    const startStr = format(new Date(shareStartDate), 'dd MMM yyyy');
    const endStr = format(new Date(shareEndDate), 'dd MMM yyyy');
    
    const formatAmount = (val: number) => `₹${Math.abs(val).toFixed(2)}`;
    const formatTxAmount = (val: number) => `₹${Math.abs(val).toFixed(2)}`;

    const formatBalText = (val: number) => {
      if (val === 0) return '₹ 0.00';
      return `${formatAmount(val)} ${val >= 0 ? 'Dr' : 'Cr'}`;
    };

    let msg = `*GREENZAR FOOD & BEVERAGE*\n`;
    msg += `*LEDGER STATEMENT*\n`;
    msg += `----------------------------------------\n`;
    msg += `*Party:* ${party.name.toUpperCase()}\n`;
    if (party.phone) msg += `*Phone:* ${party.phone}\n`;
    msg += `*Period:* ${startStr} to ${endStr}\n`;
    msg += `----------------------------------------\n\n`;
    
    msg += `*SUMMARY:*\n`;
    msg += `• Opening Bal: ${formatBalText(startBal)}\n`;
    msg += `• Total Debit (+): ${formatAmount(totalDr)}\n`;
    msg += `• Total Credit (-): ${formatAmount(totalCr)}\n`;
    msg += `• Closing Bal: ${formatBalText(endBal)}\n\n`;
    
    if (rangeTxs.length > 0) {
      msg += `*TRANSACTIONS:*\n`;
      rangeTxs.forEach((tx) => {
        const txDate = format(new Date(tx.timestamp), 'dd MMM');
        const txType = tx.type === 'DEBIT' ? 'Dr' : 'Cr';
        const notes = tx.notes ? ` (${tx.notes.toUpperCase()})` : '';
        const invoice = tx.invoiceNo ? ` [Inv: ${tx.invoiceNo.toUpperCase()}]` : '';
        msg += `• ${txDate} | ${formatTxAmount(tx.amount)} ${txType}${notes}${invoice}\n`;
      });
      msg += `\n`;
    } else {
      msg += `No transactions in this period.\n\n`;
    }
    
    msg += `----------------------------------------\n`;
    msg += `Thank you! Generated on ${format(new Date(), 'dd MMM yyyy, hh:mm a')}`;
    return msg;
  };

  if (!party) {
    return (
      <div className="p-8 text-center text-slate-500 font-medium">
        <Loader2 className="animate-spin mx-auto mb-2 text-blue-600" size={24} />
        Loading Party Ledger...
      </div>
    );
  }

  const totalDebitSum = transactions.filter(t => t.type === 'DEBIT').reduce((acc, t) => acc + t.amount, 0);
  const totalCreditSum = transactions.filter(t => t.type === 'CREDIT').reduce((acc, t) => acc + t.amount, 0);

  return (
    <div className="p-3 min-[400px]:p-4 sm:p-8 max-w-7xl mx-auto w-full pb-20 sm:pb-8 space-y-3 sm:space-y-6">
      
      {/* Top Breadcrumb & Actions */}
      <div className="flex items-center justify-between gap-2">
        <button 
          onClick={() => navigate('/parties')} 
          className="inline-flex items-center text-xs font-bold text-slate-600 hover:text-slate-900 transition-colors"
        >
          <ArrowLeft size={14} className="mr-1 sm:mr-1.5" /> Back to Parties
        </button>

        <div className="flex items-center gap-1.5 sm:gap-2">
          <button
            type="button"
            onClick={() => { setTxAmount(''); setTxInvoiceNo(''); setTxNotes(''); setTxError(''); setShowTxModal('DEBIT'); }}
            className="inline-flex items-center gap-1 px-2.5 py-1.5 bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 rounded-lg text-xs font-bold shadow-2xs transition-colors"
          >
            <Minus size={12} />
            <span>Debit (Dr)</span>
          </button>
          <button
            type="button"
            onClick={() => { setTxAmount(''); setTxCashAmount(''); setTxAcAmount(''); setTxInvoiceNo(''); setTxNotes(''); setTxError(''); setShowTxModal('CREDIT'); }}
            className="inline-flex items-center gap-1 px-2.5 py-1.5 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200 rounded-lg text-xs font-bold shadow-2xs transition-colors"
          >
            <Plus size={12} />
            <span>Credit (Cr)</span>
          </button>

          {currentUser?.isAdmin && (
            <button
              type="button"
              onClick={handleOpenEditParty}
              className="inline-flex items-center gap-1 px-2 sm:px-3 py-1.5 bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 rounded-lg text-xs font-bold shadow-2xs transition-colors"
              title="Edit Profile"
            >
              <Edit2 size={12} className="text-blue-600" />
              <span className="hidden sm:inline">Edit Profile</span>
            </button>
          )}
        </div>
      </div>

      {/* Corporate Account Header Card */}
      <div className="bg-white rounded-xl sm:rounded-2xl shadow-2xs border border-slate-200/90 p-3.5 sm:p-6">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3.5 sm:gap-6">
          <div className="flex items-start gap-3 sm:gap-4 min-w-0">
            {/* Square outline box avatar */}
            <div className="w-10 h-10 sm:w-14 sm:h-14 rounded-lg sm:rounded-xl bg-white border border-slate-200 text-slate-900 flex items-center justify-center font-bold text-base sm:text-xl uppercase shrink-0 shadow-2xs">
              {party.name.substring(0, 2).toUpperCase()}
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="text-lg sm:text-2xl font-bold text-slate-900 tracking-tight truncate">{party.name}</h1>
                {currentUser?.isAdmin && (
                  <span className="px-2 py-0.5 rounded-md text-[10px] sm:text-xs font-medium bg-emerald-50 text-emerald-600 border border-emerald-200/50">
                    {party.status || 'Active'}
                  </span>
                )}
              </div>
              
              <div className="flex flex-wrap items-center gap-x-3.5 sm:gap-x-5 gap-y-1 text-[11px] sm:text-xs text-slate-600 mt-1 sm:mt-2">
                {party.phone && (
                  <span className="flex items-center gap-1 font-medium text-slate-700">
                    <Phone size={12} className="text-slate-400" />
                    {party.phone}
                  </span>
                )}
                {party.email && (
                  <span className="flex items-center gap-1 text-slate-600 truncate max-w-[180px]">
                    <Mail size={12} className="text-slate-400 shrink-0" />
                    <span className="truncate">{party.email}</span>
                  </span>
                )}
                {party.address && (
                  <span className="flex items-center gap-1 text-slate-600 truncate max-w-[200px]">
                    <MapPin size={12} className="text-slate-400 shrink-0" />
                    <span className="truncate">{party.address}</span>
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Current Ledger Balance Display */}
          <div className="flex flex-col items-start lg:items-end pt-2.5 lg:pt-0 border-t lg:border-t-0 border-slate-100 shrink-0">
            <span className="text-[10px] sm:text-[11px] uppercase font-semibold tracking-wider text-slate-500 mb-0.5 sm:mb-1">
              CURRENT OUTSTANDING BALANCE
            </span>
            <div className="text-xl sm:text-3xl font-extrabold tracking-tight tabular-nums flex items-baseline gap-1 select-all">
              <span className={party.currentDue > 0 ? "text-rose-600" : party.currentDue < 0 ? "text-emerald-600" : "text-slate-900"}>
                ₹ {Math.abs(party.currentDue).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </span>
              <span className={`text-xs sm:text-sm font-bold uppercase ${party.currentDue > 0 ? "text-rose-600" : party.currentDue < 0 ? "text-emerald-600" : "text-slate-500"}`}>
                {party.currentDue > 0 ? 'DR' : party.currentDue < 0 ? 'CR' : ''}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Account Financial Metric Cards (3 Clean Cards) */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 sm:gap-4">
        
        {/* Card 1: OPENING BALANCE */}
        <div className="bg-white rounded-xl border border-slate-200 p-3.5 sm:p-5 shadow-2xs flex flex-col justify-between space-y-1 sm:space-y-2">
          <span className="text-[10px] sm:text-[11px] font-semibold uppercase tracking-wider text-slate-500">
            OPENING BALANCE
          </span>
          <div>
            <div className="text-lg sm:text-2xl font-bold tracking-tight text-rose-600 tabular-nums">
              ₹ {Math.abs(party.openingBalance).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
              {party.openingBalance !== 0 && (
                <span className="ml-1 text-[10px] sm:text-xs font-bold uppercase text-rose-600">
                  {party.openingBalance >= 0 ? 'DR' : 'CR'}
                </span>
              )}
            </div>
            <p className="text-[11px] sm:text-xs text-slate-400 mt-0.5 sm:mt-1">Initial ledger balance</p>
          </div>
        </div>

        {/* Card 2: TOTAL DEBIT (DR) */}
        <div className="bg-white rounded-xl border border-slate-200 p-3.5 sm:p-5 shadow-2xs flex flex-col justify-between space-y-1 sm:space-y-2">
          <span className="text-[10px] sm:text-[11px] font-semibold uppercase tracking-wider text-slate-500">
            TOTAL DEBIT (DR)
          </span>
          <div>
            <div className="text-lg sm:text-2xl font-bold tracking-tight text-rose-600 tabular-nums">
              ₹ {totalDebitSum.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
            </div>
            <p className="text-[11px] sm:text-xs text-slate-400 mt-0.5 sm:mt-1">
              {transactions.filter(t => t.type === 'DEBIT').length} debit {transactions.filter(t => t.type === 'DEBIT').length === 1 ? 'entry' : 'entries'}
            </p>
          </div>
        </div>

        {/* Card 3: TOTAL CREDIT (CR) */}
        <div className="bg-white rounded-xl border border-slate-200 p-3.5 sm:p-5 shadow-2xs flex flex-col justify-between space-y-1 sm:space-y-2">
          <span className="text-[10px] sm:text-[11px] font-semibold uppercase tracking-wider text-slate-500">
            TOTAL CREDIT (CR)
          </span>
          <div>
            <div className="text-lg sm:text-2xl font-bold tracking-tight text-slate-900 tabular-nums">
              ₹ {totalCreditSum.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
            </div>
            <p className="text-[11px] sm:text-xs text-slate-400 mt-0.5 sm:mt-1">
              {transactions.filter(t => t.type === 'CREDIT').length} credit {transactions.filter(t => t.type === 'CREDIT').length === 1 ? 'entry' : 'entries'}
            </p>
          </div>
        </div>

      </div>

      {/* Main Ledger Statement Table Card */}
      <div className="bg-white rounded-xl sm:rounded-2xl border border-slate-200 overflow-hidden shadow-2xs">
        {/* Statement Toolbar */}
        <div className="p-3 sm:p-5 border-b border-slate-100 flex flex-col lg:flex-row gap-3 sm:gap-4 items-stretch lg:items-center justify-between">
          <div>
            <h3 className="font-bold text-slate-900 text-sm sm:text-base">Account Journal Statement</h3>
            <p className="text-[11px] sm:text-xs text-slate-500 mt-0.5">
              Showing 1 to {filteredTxs.length} of {transactions.length} entries
            </p>
          </div>

          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 sm:gap-2.5">
            <div className="relative flex-1 sm:w-64">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                placeholder="Search notes or invoice no..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                className="w-full pl-8 pr-3 py-1.5 sm:py-2 bg-white border border-slate-200 hover:border-slate-300 rounded-lg text-xs text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-[#0055a5] transition-colors"
              />
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <button 
                onClick={() => setShowDownloadModal(true)} 
                className="flex-1 sm:flex-initial inline-flex items-center justify-center px-2.5 sm:px-3.5 py-1.5 sm:py-2 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 text-xs font-medium rounded-lg shadow-2xs transition-colors"
              >
                <Download size={13} className="mr-1 sm:mr-1.5 text-slate-700" />
                Export PDF
              </button>
              <button 
                onClick={() => setShowShareModal(true)} 
                className="flex-1 sm:flex-initial inline-flex items-center justify-center px-2.5 sm:px-3.5 py-1.5 sm:py-2 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 text-xs font-medium rounded-lg shadow-2xs transition-colors"
              >
                <Share2 size={13} className="mr-1 sm:mr-1.5 text-slate-700" />
                Share
              </button>
            </div>
          </div>
        </div>

        {/* Corporate Accounting Journal Table */}
        <div className="hidden md:block overflow-x-auto">
          <table className="w-full text-left border-collapse table-finance">
            <thead>
              <tr className="border-b border-slate-200 bg-white text-[11px] font-semibold uppercase text-slate-700 tracking-wider">
                <th className="py-3 px-4 w-44">Date & Time</th>
                <th className="py-3 px-4">Particulars / Description</th>
                <th className="py-3 px-4 w-32 text-right">Debit (Dr)</th>
                <th className="py-3 px-4 w-32 text-right">Credit (Cr)</th>
                <th className="py-3 px-4 w-40 text-right">Running Balance</th>
                <th className="py-3 px-4 w-20 text-center">Receipt</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-xs">
              {/* Opening Balance Row */}
              <tr className="bg-slate-50/40 font-normal">
                <td className="py-3.5 px-4 text-slate-400">-</td>
                <td className="py-3.5 px-4">
                  <span className="font-semibold text-slate-900">
                    {isFirstPageOfTransactions ? 'Opening Balance' : 'Balance Brought Forward'}
                  </span>
                  <span className="text-slate-400 ml-2">(Carried from previous ledger state)</span>
                </td>
                <td className="py-3.5 px-4 text-right text-slate-700 tabular-nums">
                  {pageOpeningBalance > 0 ? pageOpeningBalance.toFixed(2) : '-'}
                </td>
                <td className="py-3.5 px-4 text-right text-slate-400 tabular-nums">
                  {pageOpeningBalance < 0 ? Math.abs(pageOpeningBalance).toFixed(2) : '-'}
                </td>
                <td className="py-3.5 px-4 text-right tabular-nums">
                  <span className={`font-semibold ${pageOpeningBalance > 0 ? 'text-rose-600' : pageOpeningBalance < 0 ? 'text-emerald-600' : 'text-slate-700'}`}>
                    ₹ {Math.abs(pageOpeningBalance).toLocaleString('en-IN', { minimumFractionDigits: 2 })} {pageOpeningBalance >= 0 ? 'DR' : 'CR'}
                  </span>
                </td>
                <td className="py-3.5 px-4 text-center text-slate-400">-</td>
              </tr>

              {/* Transactions List */}
              {txWithBalance.map((tx) => (
                <tr 
                  key={tx.id} 
                  onClick={() => setSelectedDetailTx(tx)}
                  className="hover:bg-slate-50/70 cursor-pointer transition-colors"
                >
                  <td className="py-3.5 px-4 text-slate-600 whitespace-nowrap">
                    {format(new Date(tx.timestamp), 'dd MMM yyyy, HH:mm')}
                  </td>

                  <td className="py-3.5 px-4">
                    <div className="flex items-center justify-between group">
                      <div className="min-w-0 pr-2">
                        <span className="text-slate-800 font-normal block leading-relaxed">
                          {tx.notes || 'General ledger entry'}
                        </span>
                        {tx.invoiceNo && (
                          <span className="text-[11px] font-medium text-blue-600 hover:underline inline-block mt-0.5">
                            Inv #{tx.invoiceNo}
                          </span>
                        )}
                      </div>

                      {currentUser?.isAdmin && (
                        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button 
                            type="button" 
                            onClick={(e) => {
                              e.stopPropagation();
                              setEditingTx(tx);
                              setEditTxAmount(tx.amount.toString());
                              setEditTxInvoiceNo(tx.invoiceNo || '');
                              setEditTxNotes(tx.notes || '');
                            }} 
                            className="p-1 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded"
                            title="Edit Transaction"
                          >
                            <Edit2 size={13} />
                          </button>
                          <button 
                            type="button" 
                            onClick={(e) => {
                              e.stopPropagation();
                              setDeletingTx(tx);
                              setShowDeleteConfirmModal(true);
                            }} 
                            className="p-1 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded"
                            title="Delete Transaction"
                          >
                            <Trash2 size={13} />
                          </button>
                        </div>
                      )}
                    </div>
                  </td>

                  <td className="py-3.5 px-4 text-right tabular-nums">
                    {tx.type === 'DEBIT' ? (
                      <span className="font-semibold text-rose-600">
                        ₹ {tx.amount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                      </span>
                    ) : (
                      <span className="text-slate-400">-</span>
                    )}
                  </td>

                  <td className="py-3.5 px-4 text-right tabular-nums">
                    {tx.type === 'CREDIT' ? (
                      <span className="font-semibold text-emerald-600">
                        ₹ {tx.amount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                      </span>
                    ) : (
                      <span className="text-slate-400">-</span>
                    )}
                  </td>

                  <td className="py-3.5 px-4 text-right tabular-nums">
                    <span className={`font-semibold ${(tx.runningBalance ?? 0) > 0 ? 'text-rose-600' : (tx.runningBalance ?? 0) < 0 ? 'text-emerald-600' : 'text-slate-700'}`}>
                      ₹ {Math.abs(tx.runningBalance ?? 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })} {(tx.runningBalance ?? 0) >= 0 ? 'DR' : 'CR'}
                    </span>
                  </td>

                  <td className="py-3.5 px-4 text-center" onClick={e => e.stopPropagation()}>
                    <button
                      type="button"
                      onClick={() => setReceiptTx(tx)}
                      className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded transition-colors"
                      title="Print Thermal Receipt"
                    >
                      <FileText size={14} />
                    </button>
                  </td>
                </tr>
              ))}

              {txWithBalance.length === 0 && (
                <tr>
                  <td colSpan={6} className="py-12 text-center text-slate-400 text-xs font-normal">
                    No transactions recorded for this account yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Footer row: Total entries */}
        <div className="px-4 py-3 border-t border-slate-100 bg-white text-xs text-slate-500 font-medium">
          Total {txWithBalance.length + 1} entries
        </div>

        {/* Mobile View Card List (High Density & Compact) */}
        <div className="block md:hidden divide-y divide-slate-100 bg-white">
          <div className="p-2.5 sm:p-3.5 bg-slate-50 flex items-center justify-between text-xs">
            <div>
              <span className="font-bold text-slate-800 block text-xs">
                {isFirstPageOfTransactions ? 'Opening Balance' : 'Balance Brought Forward'}
              </span>
              <span className="text-[10px] text-slate-400">Prior period ledger state</span>
            </div>
            <AmountDisplay amount={pageOpeningBalance} showDrCr={true} size="xs" />
          </div>

          {txWithBalance.map((tx) => (
            <div 
              key={tx.id} 
              onClick={() => setSelectedDetailTx(tx)}
              className="p-2.5 sm:p-3.5 hover:bg-slate-50 flex items-center justify-between gap-2.5 cursor-pointer transition-colors"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5 text-[10.5px] text-slate-500 font-mono">
                  <span>{format(new Date(tx.timestamp), 'dd MMM, HH:mm')}</span>
                  {tx.invoiceNo && <span className="text-blue-700 bg-blue-50 px-1 py-0.2 rounded font-semibold">#{tx.invoiceNo}</span>}
                </div>
                <h4 className="font-bold text-slate-900 text-xs mt-0.5 truncate">{tx.notes || 'Voucher entry'}</h4>
                <div className="mt-0.5">
                  <span className="text-[10px] text-slate-400 font-mono">
                    Bal: {tx.runningBalance && tx.runningBalance > 0 ? `-${tx.runningBalance.toFixed(2)}` : tx.runningBalance?.toFixed(2)}
                  </span>
                </div>
              </div>

              <div className="text-right shrink-0">
                <AmountDisplay 
                  amount={tx.amount} 
                  type={tx.type} 
                  showDrCr={true} 
                  size="xs" 
                />
              </div>
            </div>
          ))}
        </div>

        {/* Pagination Footer */}
        {totalPages > 1 && (
          <div className="p-4 border-t border-slate-100 flex items-center justify-between bg-slate-50/60">
            <span className="text-xs text-slate-500 font-medium">
              Page {currentPage} of {totalPages}
            </span>
            <div className="flex items-center space-x-1">
              <button
                type="button"
                disabled={currentPage === 1}
                onClick={() => setCurrentPage(prev => Math.max(prev - 1, 1))}
                className="p-1.5 border border-slate-300 rounded-md bg-white hover:bg-slate-50 text-slate-600 disabled:opacity-40"
              >
                <ChevronLeft size={16} />
              </button>
              <button
                type="button"
                disabled={currentPage === totalPages}
                onClick={() => setCurrentPage(prev => Math.min(prev + 1, totalPages))}
                className="p-1.5 border border-slate-300 rounded-md bg-white hover:bg-slate-50 text-slate-600 disabled:opacity-40"
              >
                <ChevronRight size={16} />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Transaction Modal (Debit / Credit) */}
      {showTxModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-md border border-slate-200 overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center bg-slate-50">
              <div className="flex items-center gap-2">
                <div className={`p-1.5 rounded-lg ${showTxModal === 'DEBIT' ? 'bg-rose-50 text-rose-600' : 'bg-emerald-50 text-emerald-600'}`}>
                  {showTxModal === 'DEBIT' ? <Minus size={16} /> : <Plus size={16} />}
                </div>
                <div>
                  <h3 className="font-bold text-slate-900 text-sm">
                    {showTxModal === 'DEBIT' ? 'Record Debit Voucher (Dr)' : 'Record Credit Voucher (Cr)'}
                  </h3>
                  <p className="text-xs text-slate-500">{party.name}</p>
                </div>
              </div>
              <button type="button" onClick={() => setShowTxModal(null)} className="text-slate-400 hover:text-slate-600 p-1">
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handlePreTxSubmit} className="p-6 space-y-4">
              {showTxModal === 'CREDIT' && (
                <div className="flex items-center gap-2 p-2.5 bg-slate-50 rounded-lg border border-slate-200">
                  <input
                    type="checkbox"
                    id="separateCredit"
                    checked={separateCredit}
                    onChange={e => setSeparateCredit(e.target.checked)}
                    className="h-4 w-4 rounded border-slate-300 text-blue-600 cursor-pointer"
                  />
                  <label htmlFor="separateCredit" className="text-xs font-bold text-slate-700 cursor-pointer select-none">
                    Separate Cash & Bank Account Credit
                  </label>
                </div>
              )}

              {showTxModal === 'CREDIT' && separateCredit ? (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-bold text-emerald-700 uppercase tracking-wider mb-1">Cash Credit (₹)</label>
                    <input
                      required
                      type="number"
                      step="0.01"
                      min="0"
                      value={txCashAmount}
                      onChange={e => {
                        setTxCashAmount(e.target.value);
                        setTxError('');
                        const cVal = parseFloat(e.target.value) || 0;
                        const aVal = parseFloat(txAcAmount) || 0;
                        setTxAmount(cVal + aVal > 0 ? (cVal + aVal).toString() : '');
                      }}
                      className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg text-slate-900 font-mono focus:border-emerald-600"
                      placeholder="0.00"
                      autoFocus
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-blue-700 uppercase tracking-wider mb-1">Bank A/C Credit (₹)</label>
                    <input
                      required
                      type="number"
                      step="0.01"
                      min="0"
                      value={txAcAmount}
                      onChange={e => {
                        setTxAcAmount(e.target.value);
                        setTxError('');
                        const cVal = parseFloat(txCashAmount) || 0;
                        const aVal = parseFloat(e.target.value) || 0;
                        setTxAmount(cVal + aVal > 0 ? (cVal + aVal).toString() : '');
                      }}
                      className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg text-slate-900 font-mono focus:border-blue-600"
                      placeholder="0.00"
                    />
                  </div>
                </div>
              ) : (
                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-slate-700 mb-1.5">
                    Amount (₹) <span className="text-rose-500">*</span>
                  </label>
                  <input 
                    required 
                    type="number" 
                    step="0.01" 
                    min="0.01" 
                    value={txAmount} 
                    onChange={e => { setTxAmount(e.target.value); setTxError(''); }} 
                    className="w-full px-3.5 py-2 text-sm bg-white border border-slate-300 rounded-lg text-slate-900 font-mono focus:border-blue-600" 
                    placeholder="0.00" 
                    autoFocus 
                  />
                </div>
              )}

              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-700 mb-1.5">
                  Receipt / Invoice No.
                </label>
                <div className="relative">
                  <input
                    type="text"
                    value={txInvoiceNo}
                    onChange={e => {
                      setTxInvoiceNo(e.target.value.toLowerCase());
                      setTxError('');
                      if (!e.target.value.trim()) setMatchedInvoiceInfo(null);
                    }}
                    onBlur={() => {
                      if (txInvoiceNo.trim() && showTxModal) {
                        checkTxInvoice(txInvoiceNo, showTxModal);
                      }
                    }}
                    placeholder="e.g. 101 or INV-45"
                    className="w-full px-3.5 py-2 text-sm bg-white border border-slate-300 rounded-lg text-slate-900 font-mono focus:border-blue-600"
                  />
                  {isCheckingTxInvoice && (
                    <div className="absolute right-3 top-2.5">
                      <Loader2 className="animate-spin text-blue-600" size={16} />
                    </div>
                  )}
                </div>

                {matchedInvoiceInfo && (
                  <div className="p-2.5 bg-emerald-50 border border-emerald-200 rounded-lg text-emerald-900 text-xs mt-2">
                    <span className="font-bold">✓ Matched Invoice Reference Found:</span>
                    <p className="text-[11px] text-emerald-700 mt-0.5">
                      Prior {matchedInvoiceInfo.type} for {matchedInvoiceInfo.partyName} (₹{matchedInvoiceInfo.amount.toFixed(2)})
                    </p>
                  </div>
                )}
              </div>

              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-700 mb-1.5">
                  Particulars / Notes
                </label>
                <textarea 
                  value={txNotes} 
                  onChange={e => { setTxNotes(e.target.value); setTxError(''); }} 
                  className="w-full px-3.5 py-2 text-sm bg-white border border-slate-300 rounded-lg text-slate-900 focus:border-blue-600" 
                  rows={2} 
                  placeholder="e.g. Goods delivery / NEFT Payment"
                />
              </div>

              {txError && (
                <div className="p-3 bg-rose-50 border border-rose-200 text-rose-700 rounded-lg text-xs font-semibold">
                  {txError}
                </div>
              )}

              <div className="pt-4 border-t border-slate-100 flex justify-end gap-2">
                <button 
                  type="button" 
                  onClick={() => setShowTxModal(null)} 
                  disabled={isSubmitting} 
                  className="px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-lg"
                >
                  Cancel
                </button>
                <button 
                  type="submit" 
                  disabled={isSubmitting} 
                  className={`px-5 py-2 text-white text-xs font-bold rounded-lg shadow-xs ${
                    showTxModal === 'DEBIT' ? 'bg-rose-600 hover:bg-rose-700' : 'bg-emerald-600 hover:bg-emerald-700'
                  }`}
                >
                  Review Voucher
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Confirmation Modal */}
      {showTxConfirmModal && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-sm border border-slate-200 overflow-hidden p-6">
            <h3 className="font-bold text-base text-slate-900 mb-4 text-center">Confirm Ledger Voucher</h3>
            
            <div className="bg-slate-50 p-4 rounded-lg space-y-2.5 mb-5 border border-slate-200 text-xs">
              <div className="flex justify-between text-slate-600">
                <span>Current Balance:</span>
                <span className="font-bold text-slate-900">{party.currentDue.toFixed(2)}</span>
              </div>
              <div className="flex justify-between text-slate-600 border-b border-slate-200 pb-2">
                <span>Voucher {showTxModal}:</span>
                <span className={`font-bold ${showTxModal === 'DEBIT' ? 'text-rose-600' : 'text-emerald-600'}`}>
                  {showTxModal === 'DEBIT' ? '-' : '+'}₹{parseFloat(txAmount).toFixed(2)}
                </span>
              </div>
              <div className="flex justify-between font-bold text-slate-900 pt-1">
                <span>Expected New Balance:</span>
                <span>
                  {(party.currentDue + (showTxModal === 'DEBIT' ? parseFloat(txAmount) : -parseFloat(txAmount))).toFixed(2)}
                </span>
              </div>
            </div>

            <div className="flex gap-2">
              <button 
                type="button" 
                onClick={() => setShowTxConfirmModal(false)} 
                disabled={isSubmitting} 
                className="flex-1 py-2 px-3 border border-slate-300 text-slate-700 rounded-lg text-xs font-semibold hover:bg-slate-50"
              >
                Back
              </button>
              <button 
                type="button" 
                onClick={handleConfirmTxSubmit} 
                disabled={isSubmitting} 
                className={`flex-1 py-2 px-3 text-white rounded-lg text-xs font-bold shadow-xs ${
                  showTxModal === 'DEBIT' ? 'bg-rose-600 hover:bg-rose-700' : 'bg-emerald-600 hover:bg-emerald-700'
                }`}
              >
                {isSubmitting ? 'Posting...' : 'Confirm & Post'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Transaction Modal */}
      {editingTx && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-md border border-slate-200 overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center bg-slate-50">
              <h3 className="font-bold text-slate-900 text-sm">Edit Voucher Entry</h3>
              <button type="button" onClick={() => setEditingTx(null)} className="text-slate-400 hover:text-slate-600 p-1">
                <X size={18} />
              </button>
            </div>
            <form onSubmit={handleEditSubmit} className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-700 mb-1.5">Amount (₹)</label>
                <input required type="number" step="0.01" min="0.01" value={editTxAmount} onChange={e => { setEditTxAmount(e.target.value); setEditTxError(''); }} className="w-full px-3.5 py-2 text-sm bg-white border border-slate-300 rounded-lg font-mono focus:border-blue-600" />
              </div>
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-700 mb-1.5">Invoice No.</label>
                <input type="text" value={editTxInvoiceNo} onChange={e => { setEditTxInvoiceNo(e.target.value.toLowerCase()); setEditTxError(''); }} className="w-full px-3.5 py-2 text-sm bg-white border border-slate-300 rounded-lg font-mono focus:border-blue-600" />
              </div>
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-700 mb-1.5">Particulars</label>
                <textarea value={editTxNotes} onChange={e => { setEditTxNotes(e.target.value); setEditTxError(''); }} className="w-full px-3.5 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:border-blue-600" rows={2} />
              </div>
              {editTxError && (
                <div className="p-3 bg-rose-50 border border-rose-200 text-rose-700 rounded-lg text-xs font-semibold">
                  {editTxError}
                </div>
              )}
              <div className="pt-3 flex justify-end gap-2">
                <button type="button" onClick={() => setEditingTx(null)} disabled={isSubmitting} className="px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-lg">Cancel</button>
                <button type="submit" disabled={isSubmitting} className="px-5 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded-lg shadow-xs">Save Changes</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {showDeleteConfirmModal && deletingTx && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-md border border-slate-200 overflow-hidden p-6 space-y-4">
            <h3 className="font-bold text-rose-600 text-base flex items-center gap-2">
              <Trash2 size={18} />
              Delete Ledger Voucher
            </h3>
            <p className="text-xs text-slate-600">
              Are you sure you want to delete this voucher? All running balances will be recalculated.
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
                onClick={() => { setShowDeleteConfirmModal(false); setDeletingTx(null); setDeletePassword(''); }} 
                className="px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-lg"
              >
                Cancel
              </button>
              <button 
                type="button" 
                onClick={handleDeleteSubmit} 
                disabled={isSubmitting} 
                className="px-5 py-2 bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold rounded-lg shadow-xs"
              >
                {isSubmitting ? 'Deleting...' : 'Confirm Delete'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* PDF Export Modal */}
      {showDownloadModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-sm border border-slate-200 overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center bg-slate-50">
              <h3 className="font-bold text-slate-900 text-sm">Download Account Statement</h3>
              <button type="button" onClick={() => setShowDownloadModal(false)} className="text-slate-400 hover:text-slate-600 p-1">
                <X size={18} />
              </button>
            </div>
            <form onSubmit={generatePdf} className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-700 mb-1.5">Start Date</label>
                <input required type="date" value={downloadStartDate} onChange={e => setDownloadStartDate(e.target.value)} className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs font-mono" />
              </div>
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-700 mb-1.5">End Date</label>
                <input required type="date" value={downloadEndDate} onChange={e => setDownloadEndDate(e.target.value)} min={downloadStartDate} className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs font-mono" />
              </div>

              <div className="pt-2 border-t border-slate-100">
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-700 mb-1.5 flex items-center gap-1">
                  <Lock size={12} className="text-slate-400" />
                  PDF Password Protection (Optional)
                </label>
                <input
                  type={showDownloadPassText ? "text" : "password"}
                  placeholder="Set PDF opening password..."
                  value={downloadPdfPassword}
                  onChange={e => setDownloadPdfPassword(e.target.value)}
                  className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg font-mono"
                />
              </div>

              <div className="pt-2 flex justify-end gap-2">
                <button type="button" onClick={() => setShowDownloadModal(false)} className="px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-lg">Cancel</button>
                <button type="submit" className="px-5 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded-lg shadow-xs flex items-center gap-1.5">
                  <Download size={14} /> Download PDF
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit Party Modal */}
      {showEditPartyModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-md border border-slate-200 overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center bg-slate-50">
              <h3 className="font-bold text-slate-900 text-sm">Edit Party Details</h3>
              <button type="button" onClick={() => setShowEditPartyModal(false)} className="text-slate-400 hover:text-slate-600 p-1">
                <X size={18} />
              </button>
            </div>
            <form onSubmit={handleEditPartySubmit} className="p-6 space-y-4">
              {editPartyError && (
                <div className="p-3 text-xs font-semibold text-rose-600 bg-rose-50 rounded-lg border border-rose-100">
                  {editPartyError}
                </div>
              )}
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-700 mb-1.5">Party Name</label>
                <input required type="text" value={editPartyName} onChange={e => setEditPartyName(e.target.value)} className="w-full px-3.5 py-2 border border-slate-300 rounded-lg text-sm" />
              </div>
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-700 mb-1.5">Phone Number</label>
                <input type="text" value={editPartyPhone} onChange={e => setEditPartyPhone(e.target.value)} className="w-full px-3.5 py-2 border border-slate-300 rounded-lg text-sm font-mono" />
              </div>
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-700 mb-1.5">Email Address</label>
                <input type="email" value={editPartyEmail} onChange={e => setEditPartyEmail(e.target.value)} className="w-full px-3.5 py-2 border border-slate-300 rounded-lg text-sm" />
              </div>
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-700 mb-1.5">Address</label>
                <textarea value={editPartyAddress} onChange={e => setEditPartyAddress(e.target.value)} rows={2} className="w-full px-3.5 py-2 border border-slate-300 rounded-lg text-sm" />
              </div>
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-700 mb-1.5">Status</label>
                <select value={editPartyStatus} onChange={e => setEditPartyStatus(e.target.value as any)} className="w-full px-3.5 py-2 border border-slate-300 rounded-lg text-sm bg-white">
                  <option value="Active">Active</option>
                  <option value="Inactive">Inactive</option>
                </select>
              </div>
              <div className="pt-2 flex justify-end gap-2">
                <button type="button" onClick={() => setShowEditPartyModal(false)} className="px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-lg">Cancel</button>
                <button type="submit" disabled={isSubmitting} className="px-5 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded-lg shadow-xs">Save Changes</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Thermal Receipt Modal */}
      {receiptTx && (
        <ThermalReceiptModal
          isOpen={true}
          onClose={() => setReceiptTx(null)}
          transaction={receiptTx}
          partyName={party.name}
          partyPhone={party.phone}
          ledgerName={activeLedger?.name || 'Ledger'}
          isPurchaseStyle={isPurchaseStyle}
        />
      )}

      {/* Transaction Detail Popup */}
      <TransactionDetailModal
        isOpen={selectedDetailTx !== null}
        onClose={() => setSelectedDetailTx(null)}
        transaction={selectedDetailTx}
        partyName={party?.name || ''}
        ledgerName={activeLedger?.name}
      />

      {/* Share Modal */}
      {showShareModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg border border-slate-200 overflow-hidden flex flex-col max-h-[90vh]">
            <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center bg-slate-50">
              <h3 className="font-bold text-slate-900 text-sm flex items-center gap-2">
                <Share2 size={16} className="text-emerald-600" />
                Share Account Statement
              </h3>
              <button type="button" onClick={() => setShowShareModal(false)} className="text-slate-400 hover:text-slate-600 p-1">
                <X size={18} />
              </button>
            </div>
            
            <div className="p-6 space-y-4 overflow-y-auto flex-1">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-slate-700 mb-1">From Date</label>
                  <input type="date" value={shareStartDate} onChange={e => setShareStartDate(e.target.value)} className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs font-mono" />
                </div>
                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-slate-700 mb-1">To Date</label>
                  <input type="date" value={shareEndDate} onChange={e => setShareEndDate(e.target.value)} min={shareStartDate} className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs font-mono" />
                </div>
              </div>

              {(() => {
                const { rangeTxs, periodOpeningBalance, periodClosingBalance, totalDebit, totalCredit } = getShareRangeData();
                return (
                  <div className="space-y-4">
                    <div className="bg-slate-50 border border-slate-200 rounded-lg p-4 space-y-2 text-xs">
                      <div className="flex justify-between text-slate-600">
                        <span>Opening Balance:</span>
                        <span className="font-mono font-bold text-slate-900">{periodOpeningBalance.toFixed(2)}</span>
                      </div>
                      <div className="flex justify-between text-slate-600">
                        <span>Period Debit (+):</span>
                        <span className="font-mono font-bold text-rose-600">{totalDebit.toFixed(2)}</span>
                      </div>
                      <div className="flex justify-between text-slate-600">
                        <span>Period Credit (-):</span>
                        <span className="font-mono font-bold text-emerald-600">{totalCredit.toFixed(2)}</span>
                      </div>
                      <div className="flex justify-between font-bold text-slate-900 border-t border-slate-200 pt-2">
                        <span>Closing Balance:</span>
                        <span className="font-mono">{periodClosingBalance.toFixed(2)}</span>
                      </div>
                    </div>

                    <div className="space-y-2 pt-2">
                      <button
                        type="button"
                        onClick={handleSharePdf}
                        className="w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold transition-all shadow-xs"
                      >
                        <Share2 size={14} />
                        Share PDF Document
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          const shareMsg = getShareMessage(rangeTxs, periodOpeningBalance, periodClosingBalance, totalDebit, totalCredit);
                          navigator.clipboard.writeText(shareMsg);
                          setShareCopied(true);
                          setTimeout(() => setShareCopied(false), 2500);
                        }}
                        className="w-full flex items-center justify-center gap-2 py-2 px-4 rounded-lg bg-slate-800 hover:bg-slate-900 text-white text-xs font-bold transition-all shadow-xs"
                      >
                        {shareCopied ? (
                          <>
                            <Check size={14} className="text-emerald-400" />
                            Copied Summary to Clipboard!
                          </>
                        ) : (
                          <>
                            <Copy size={14} />
                            Copy Plain Text Summary
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                );
              })()}
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
