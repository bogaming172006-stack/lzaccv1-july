import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { db, handleFirestoreError, OperationType, doc, getDoc, collection, query, where, setDoc, updateDoc, orderBy, limit, getDocs } from '../firebase';
import { Party, Transaction } from '../types';
import { ArrowLeft, Download, Plus, Minus, FileText, Edit2, Check, Search, ChevronLeft, ChevronRight, Trash2, Printer, Share2, Send, MessageSquare, Copy, Lock, Eye, EyeOff, Key, Paperclip } from 'lucide-react';
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
      // 1. Update local cache
      await setCacheItem<Party>('parties', updatedParty);
      setParty(updatedParty);

      // 2. Write to Firestore
      await updateDoc(doc(db, 'parties', id), {
        name: updatedParty.name,
        phone: updatedParty.phone,
        address: updatedParty.address,
        email: updatedParty.email,
        status: updatedParty.status,
        lastTransaction: updatedParty.lastTransaction
      });

      // Dispatch event to trigger background Google Sheets sync
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
      // 1. Optimistic first-load of party from local cache
      const cachedParty = await getCacheItem<Party>('parties', id);
      if (cachedParty) {
        setParty(cachedParty);
      } else {
        // Fallback to direct get doc if not in cache yet
        const partySnap = await getDoc(doc(db, 'parties', id));
        if (partySnap.exists()) {
          setParty(partySnap.data() as Party);
        }
      }

      // 2. Optimistic load of transactions from local IndexedDB cache
      const cachedTxs = await getFilteredCacheItems<Transaction>('transactions', t => t.partyId === id);
      const openingBal = cachedParty?.openingBalance ?? 0;
      cachedTxs.sort((a, b) => a.timestamp - b.timestamp); // Chronological order
      let currentBal = openingBal;
      const cachedTxsWithBalances = cachedTxs.map(tx => {
        const balanceChange = tx.type === 'DEBIT' ? tx.amount : -tx.amount;
        currentBal += balanceChange;
        return {
          ...tx,
          runningBalance: currentBal
        };
      });
      cachedTxsWithBalances.sort((a, b) => b.timestamp - a.timestamp); // Newest first for list view
      setTransactions(cachedTxsWithBalances);

      // 3. Sync parties and transactions of the ledger in background to get any external updates
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
          freshTxs.sort((a, b) => a.timestamp - b.timestamp); // Chronological order
          let syncBal = syncOpeningBal;
          const freshTxsWithBalances = freshTxs.map(tx => {
            const balanceChange = tx.type === 'DEBIT' ? tx.amount : -tx.amount;
            syncBal += balanceChange;
            return {
              ...tx,
              runningBalance: syncBal
            };
          });
          freshTxsWithBalances.sort((a, b) => b.timestamp - a.timestamp); // Newest first for list view
          setTransactions(freshTxsWithBalances);
        }
      }
    } catch (error) {
      console.error("Failed to load party details or transactions from cache/sync:", error);
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
  const ITEMS_PER_PAGE = 12;

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

  const txWithBalance = [...pageTxs].sort((a, b) => b.timestamp - a.timestamp);

  const sortedFilteredTxs = [...filteredTxs].sort((a, b) => a.timestamp - b.timestamp);

  let pageOpeningBalance = party?.openingBalance ?? 0;
  if (pageTxs.length > 0 && sortedFilteredTxs.length > 0) {
    const earliestTxOnPage = pageTxs[pageTxs.length - 1];
    const idx = sortedFilteredTxs.findIndex(tx => tx.id === earliestTxOnPage.id);
    if (idx > 0) {
      pageOpeningBalance = sortedFilteredTxs[idx - 1].runningBalance ?? party?.openingBalance ?? 0;
    }
  }

  const isFirstPageOfTransactions = sortedFilteredTxs.length === 0 || (pageTxs.length > 0 && pageTxs.some(tx => tx.id === sortedFilteredTxs[0].id));

  const buildPdf = async (startDate: string, endDate: string) => {
    if (!party) return null;
    const doc = new jsPDF();

    const startTs = new Date(startDate).setHours(0, 0, 0, 0);
    const endTs = new Date(endDate).setHours(23, 59, 59, 999);
    
    // Fetch all transactions for this party from cache to ensure full history in PDF
    const allTxs = await getFilteredCacheItems<Transaction>('transactions', t => t.partyId === id);
    const sortedAllTxs = allTxs.sort((a, b) => a.timestamp - b.timestamp);
    
    // Chronological running balance recalculation for 100% accuracy and data security in PDF report
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
    
    // Find the running balance before the start date
    let periodOpeningBalance = party.openingBalance;
    const priorTx = allTxsWithBalances.filter(tx => tx.timestamp < startTs);
    if (priorTx.length > 0) {
      periodOpeningBalance = priorTx[priorTx.length - 1].runningBalance ?? party.openingBalance;
    }
    
    // Header (Centered)
    let logoBottom = 26;
    try {
      const img = await loadImage('/logo.png');
      const imgWidth = img.naturalWidth || img.width || 100;
      const imgHeight = img.naturalHeight || img.height || 100;
      const aspectRatio = imgWidth / imgHeight;
      
      // We will fit the logo within a bounding box of max width 95mm and max height 35mm
      let targetWidth = 95;
      let targetHeight = targetWidth / aspectRatio;
      if (targetHeight > 35) {
        targetHeight = 35;
        targetWidth = targetHeight * aspectRatio;
      }
      const xPos = 105 - (targetWidth / 2);
      // We also specify 'FAST' compression for massive PDF file size reduction.
      doc.addImage(img, 'PNG', xPos, 10, targetWidth, targetHeight, undefined, 'FAST');
      logoBottom = 10 + targetHeight;
    } catch (e) {
      doc.setTextColor(15, 23, 42); // slate 900
      doc.setFontSize(26);
      doc.setFont('helvetica', 'bold');
      doc.text('GREENZAR', 105, 20, { align: 'center' });
      
      doc.setTextColor(2, 132, 199); // sky 600
      doc.setFontSize(10);
      doc.text('FOOD & BEVERAGE', 105, 26, { align: 'center' });
      logoBottom = 28;
    }
    
    doc.setTextColor(100, 116, 139); // slate 500
    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');
    doc.text('Jhampa, Deganga, North 24 PGS | West Bengal, PIN.-743423', 105, logoBottom + 5, { align: 'center' });
    doc.text('Ph: +91 9476156298  |  Email: greenzarfood@gmail.com', 105, logoBottom + 10, { align: 'center' });
    
    // Sub Header
    doc.setTextColor(15, 23, 42);
    doc.setFontSize(14);
    doc.setFont('helvetica', 'bold');
    doc.text('ACCOUNT STATEMENT', 105, logoBottom + 20, { align: 'center' });
    
    const startDateStr = format(new Date(startDate), 'yyyy-MM-dd');
    const endDateStr = format(new Date(endDate), 'yyyy-MM-dd');
    doc.setTextColor(100, 116, 139);
    doc.setFontSize(10);
    doc.text(`PERIOD: ${startDateStr} to ${endDateStr}`, 105, logoBottom + 26, { align: 'center' });
    
    doc.setTextColor(2, 132, 199);
    doc.text(`PARTY: ${party.name.toUpperCase()}`, 105, logoBottom + 32, { align: 'center' });
    
    doc.setTextColor(100, 116, 139);
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(8);
    doc.text('This statement is System Generated', 105, logoBottom + 37, { align: 'center' });
    
    // Party Details
    doc.setTextColor(15, 23, 42);
    doc.setFontSize(14);
    doc.setFont('helvetica', 'bold');
    doc.text(party.name, 14, logoBottom + 49);
    if (party.address) {
      doc.setFontSize(10);
      doc.setFont('helvetica', 'normal');
      doc.text(`Address: ${party.address}`, 14, logoBottom + 55);
    }
    
    const startY = party.address ? (logoBottom + 62) : (logoBottom + 54);

    const body = filteredTx.map(tx => {
      const particulars = []
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

    // Insert Opening Balance row at the top
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
      theme: 'grid', // changed from plain to grid for better neatness when tight
      columnStyles: {
        0: { cellWidth: 38 }, // Date (keeps date on a single line)
        1: { cellWidth: 'auto' }, // Particulars
        2: { cellWidth: 28 }, // Debit
        3: { cellWidth: 28 }, // Credit
        4: { cellWidth: 28 }, // Balance
      },
      styles: {
        fontSize: 8,
        cellPadding: 2,
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
            data.cell.styles.textColor = [220, 38, 38]; // Red for Debit
          } else if (data.column.index === 3 && data.cell.raw !== '-') {
            data.cell.styles.textColor = [5, 150, 105]; // Green for Credit
          }
        }
        // Right align Debit, Credit, and Balance
        if (data.column.index === 2 || data.column.index === 3 || data.column.index === 4) {
          data.cell.styles.halign = 'right';
        }
      }
    });

    const finalY = (doc as any).lastAutoTable.finalY || startY;
    
    // Find final balance for this period
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

    // Bottom summary card
    doc.setFillColor(248, 250, 252); // Slate 50
    doc.rect(14, finalY + 10, 182, 30, 'F');
    doc.setFontSize(12);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(0, 0, 0);
    doc.text('Period Total:', 20, finalY + 23);
    doc.text(`Rs. ${periodFinalBalance > 0 ? '-' : ''}${Math.abs(periodFinalBalance).toFixed(2)}`, 190, finalY + 23, { align: 'right' });
    
    // Amount string
    doc.setFontSize(10);
    doc.setFont('helvetica', 'italic');
    doc.setTextColor(71, 85, 105);
    doc.text(`Amount in words: ${words}`, 20, finalY + 34);
    
    if (periodFinalBalance === 0) {
      doc.setFontSize(11);
      doc.setFont('helvetica', 'normal');
      doc.text('Balance Cleared for Period', 14, finalY + 44);
    }
    
    // Add Payment Instructions Box
    doc.setFontSize(10);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(15, 23, 42);
    doc.text('Payment Instructions', 14, finalY + 48 + (periodFinalBalance === 0 ? 6 : 0));

    let currentY = finalY + 54 + (periodFinalBalance === 0 ? 6 : 0);

    doc.setTextColor(71, 85, 105);
    doc.setFontSize(9);
    
    doc.setFont('helvetica', 'bold');
    doc.text('Bank:', 14, currentY);
    doc.setFont('helvetica', 'normal');
    doc.text('UCO BANK (BADU BR.)  |  Greenzar Food And Beverage', 26, currentY); currentY += 5;
    doc.text('A/C No: 06710510011188  |  IFSC: UCBA0000671', 26, currentY); currentY += 7;

    doc.setFont('helvetica', 'bold');
    doc.text('UPI ID:', 14, currentY);
    doc.setFont('helvetica', 'normal');
    doc.text('9874682388@ibl', 26, currentY); currentY += 7;

    doc.setFont('helvetica', 'italic');
    doc.setFontSize(8);
    doc.text('Please report any discrepancies within 7 days.', 14, currentY);

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
        alert('File sharing is not fully supported on this device/browser. The PDF statement has been downloaded instead. You can now send it manually.');
      }
    } catch (error) {
      console.error('Error sharing PDF:', error);
      const doc = await buildPdf(shareStartDate, shareEndDate);
      if (doc) {
        const fileName = `ledger_${party.name.replace(/\s+/g, '_')}_${format(new Date(), 'yyyyMMdd')}.pdf`;
        const { blob } = await exportEncryptedPdf(doc, sharePdfPassword);
        downloadPdfBlob(blob, fileName);
      }
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

  useEffect(() => {
    if (separateCredit) {
      if (txAmount && !txCashAmount && !txAcAmount) {
        setTxCashAmount(txAmount);
      }
    } else {
      const cVal = parseFloat(txCashAmount) || 0;
      const aVal = parseFloat(txAcAmount) || 0;
      if (cVal + aVal > 0) {
        setTxAmount((cVal + aVal).toString());
      }
    }
  }, [separateCredit]);

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
        setTxError(`Invoice #${invNo.toUpperCase()} is ALREADY listed in BOTH Debit and Credit sheets (Fully Completed). Duplicate entry is not valid.`);
        return false;
      }

      if (currentModalType === 'DEBIT' && hasDebit) {
        const pId = debitTx?.partyId || debitTracked?.partyId;
        const pName = await getPartyName(pId);
        const amount = debitTx?.amount || 0;
        const dateStr = debitTx ? new Date(debitTx.timestamp).toLocaleDateString() : '';
        setMatchedInvoiceInfo(null);
        setTxError(`Invoice #${invNo.toUpperCase()} was ALREADY entered as a DEBIT for ${pName}${dateStr ? ` on ${dateStr}` : ''}${amount ? ` (₹${amount.toFixed(2)})` : ''}. Duplicate DEBIT entry is not valid.`);
        return false;
      }

      if (currentModalType === 'CREDIT' && hasCredit) {
        const pId = creditTx?.partyId || creditTracked?.partyId;
        const pName = await getPartyName(pId);
        const amount = creditTx?.amount || 0;
        const dateStr = creditTx ? new Date(creditTx.timestamp).toLocaleDateString() : '';
        setMatchedInvoiceInfo(null);
        setTxError(`Invoice #${invNo.toUpperCase()} was ALREADY entered as a CREDIT for ${pName}${dateStr ? ` on ${dateStr}` : ''}${amount ? ` (₹${amount.toFixed(2)})` : ''}. Duplicate CREDIT entry is not valid.`);
        return false;
      }

      // Opposite type exists -> Matched invoice reference found
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

      // Auto-fill amount if empty
      if (origAmount > 0 && !txAmount && !txCashAmount && !txAcAmount) {
        setTxAmount(origAmount.toString());
      }

      if (origPartyId && origPartyId !== party.id) {
        setMatchedInvoiceInfo(null);
        setTxError(`Invoice #${invNo.toUpperCase()} is ALREADY listed under party "${origPartyName}". You cannot add a ${currentModalType} for a different party (${party.name}).`);
        return false;
      } else {
        setTxError('');
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
      setTxError('Please enter either a Receipt/Invoice No. or Notes (at least one is required).');
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
      timestamp: Date.now(),
      createdBy: currentUser?.name || 'Admin'
    };

    const newBalance = party.currentDue + (showTxModal === 'DEBIT' ? numAmount : -numAmount);
    const newTxWithBalance: Transaction = {
      ...newTx,
      runningBalance: newBalance
    };

    // Optimistically update local party balance and list immediately for 0ms lag
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
      setEditTxError('Please enter either a Receipt/Invoice No. or Notes (at least one is required).');
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
    
    const formatAmount = (val: number) => `₹ ${Math.abs(val).toFixed(2)}`;
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

  if (!party) return <div className="p-8 text-center text-gray-500">Loading party...</div>;

  return (
    <div className="p-4 sm:p-8 max-w-5xl mx-auto w-full pb-24 sm:pb-8">
      {showTxModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md overflow-hidden">
            <div className="flex justify-between items-center p-4 border-b">
              <h3 className="font-semibold text-lg text-gray-900">
                {showTxModal === 'DEBIT' 
                  ? (isPurchaseStyle ? 'Make Payment (Debit)' : 'Add Sale / Charge (Debit)') 
                  : (isPurchaseStyle ? 'Add Purchase (Credit)' : 'Receive Payment (Credit)')}
              </h3>
              <button type="button" onClick={() => setShowTxModal(null)} className="text-gray-400 hover:text-gray-600">×</button>
            </div>
            <form onSubmit={handlePreTxSubmit} className="p-6 space-y-4">
              {showTxModal === 'CREDIT' && (
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="separateCredit"
                    checked={separateCredit}
                    onChange={e => setSeparateCredit(e.target.checked)}
                    className="h-4 w-4 rounded border-gray-300 text-sky-600 focus:ring-sky-500 cursor-pointer"
                  />
                  <label htmlFor="separateCredit" className="text-sm font-medium text-gray-700 cursor-pointer select-none">
                    Separate Cash & A/C Credit
                  </label>
                </div>
              )}

              {showTxModal === 'CREDIT' && separateCredit ? (
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-semibold text-emerald-700 mb-1">Cash Credit</label>
                    <div className="relative">
                      <span className="absolute left-2.5 top-2 text-emerald-600 font-bold text-sm">₹</span>
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
                        className="w-full pl-6 pr-2 py-2 border rounded-md focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 font-bold text-emerald-800 bg-emerald-50/10 text-sm"
                        placeholder="0.00"
                        autoFocus
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-sky-700 mb-1">A/C Credit</label>
                    <div className="relative">
                      <span className="absolute left-2.5 top-2 text-sky-600 font-bold text-sm">₹</span>
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
                        className="w-full pl-6 pr-2 py-2 border rounded-md focus:border-sky-500 focus:ring-1 focus:ring-sky-500 font-bold text-sky-800 bg-sky-50/10 text-sm"
                        placeholder="0.00"
                      />
                    </div>
                  </div>
                </div>
              ) : (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Amount</label>
                  <input required type="number" step="0.01" min="0.01" value={txAmount} onChange={e => { setTxAmount(e.target.value); setTxError(''); }} className="w-full px-3 py-2 border rounded-md focus:border-sky-500 focus:ring-1 focus:ring-sky-500" autoFocus />
                </div>
              )}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  {isPurchaseStyle && showTxModal === 'CREDIT' ? 'Bill No.' : 'Receipt / Invoice No.'}
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
                    placeholder="e.g. 101 or ref-123"
                    className="w-full px-3 py-2 border rounded-md focus:border-sky-500 focus:ring-1 focus:ring-sky-500 dark:bg-gray-900 dark:border-gray-700 dark:text-white"
                  />
                  {isCheckingTxInvoice && (
                    <div className="absolute right-3 top-2.5 flex items-center justify-center">
                      <div className="animate-spin rounded-full h-3.5 w-3.5 border-2 border-sky-500 border-t-transparent"></div>
                    </div>
                  )}
                </div>

                {matchedInvoiceInfo && (
                  <div className="p-3 bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800 rounded-lg text-emerald-900 dark:text-emerald-200 text-xs mt-2 space-y-1">
                    <div className="font-bold flex items-center justify-between">
                      <span>✓ Matched Invoice Reference</span>
                      <span className="text-[10px] font-extrabold uppercase bg-emerald-100 dark:bg-emerald-900/60 text-emerald-800 dark:text-emerald-300 px-1.5 py-0.5 rounded">
                        Prior {matchedInvoiceInfo.type}
                      </span>
                    </div>
                    <div className="flex justify-between text-[11px] font-semibold pt-0.5">
                      <span>Original Party: <strong className="font-bold">{matchedInvoiceInfo.partyName}</strong></span>
                      <span>Amount: <strong className="font-bold">₹{matchedInvoiceInfo.amount > 0 ? matchedInvoiceInfo.amount.toFixed(2) : '-'}</strong></span>
                    </div>
                    <div className="text-[10px] text-emerald-700 dark:text-emerald-400">
                      Date: {matchedInvoiceInfo.date ? new Date(matchedInvoiceInfo.date).toLocaleDateString() : '-'}
                    </div>
                  </div>
                )}
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
                <textarea value={txNotes} onChange={e => { setTxNotes(e.target.value); setTxError(''); }} className="w-full px-3 py-2 border rounded-md focus:border-sky-500 focus:ring-1 focus:ring-sky-500"></textarea>
              </div>
              {txError && (
                <div className="p-3 bg-red-50 border border-red-200 text-red-600 rounded-lg text-sm text-center font-medium">
                  {txError}
                </div>
              )}
              <div className="pt-4 flex justify-end">
                <button type="button" onClick={() => setShowTxModal(null)} disabled={isSubmitting} className="px-4 py-2 text-gray-600 mr-2 hover:bg-gray-50 rounded-md">Cancel</button>
                <button type="submit" disabled={isSubmitting} className={`px-4 py-2 text-white rounded-md ${showTxModal === 'DEBIT' ? 'bg-red-600 hover:bg-red-700' : 'bg-emerald-600 hover:bg-emerald-700'} ${isSubmitting ? 'opacity-50 cursor-not-allowed' : ''}`}>
                  {isSubmitting ? 'Saving...' : (showTxModal === 'DEBIT' 
                    ? (isPurchaseStyle ? 'Make Payment' : 'Review Debit') 
                    : (isPurchaseStyle ? 'Review Purchase' : 'Review Credit'))}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showTxConfirmModal && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-sm overflow-hidden">
            <div className="p-6">
              <h3 className="font-semibold text-xl text-gray-900 mb-4 text-center">Confirm Transaction</h3>
              
              <div className="bg-gray-50 p-4 rounded-lg space-y-3 mb-6">
                <div className="flex justify-between text-sm">
                  <span className="text-gray-500">Current Balance:</span>
                  <span className={`font-medium ${party.currentDue > 0 ? 'text-red-600' : 'text-emerald-600'}`}>
                    {party.currentDue > 0 ? `-₹${party.currentDue.toFixed(2)}` : `₹${Math.abs(party.currentDue).toFixed(2)}`}
                  </span>
                </div>
                
                <div className="flex justify-between text-sm border-b border-gray-200 pb-3">
                  <span className="text-gray-500">New {showTxModal}:</span>
                  <span className={`font-medium ${showTxModal === 'DEBIT' ? 'text-red-600' : 'text-emerald-600'}`}>
                    {showTxModal === 'DEBIT' ? `-₹${parseFloat(txAmount).toFixed(2)}` : `+₹${parseFloat(txAmount).toFixed(2)}`}
                  </span>
                </div>
                
                <div className="flex justify-between font-semibold pt-1">
                  <span className="text-gray-900">New Balance:</span>
                  {(() => {
                    const newBalance = party.currentDue + (showTxModal === 'DEBIT' ? parseFloat(txAmount) : -parseFloat(txAmount));
                    return (
                      <span className={newBalance > 0 ? 'text-red-700' : 'text-emerald-700'}>
                        {newBalance > 0 ? `-₹${newBalance.toFixed(2)}` : `₹${Math.abs(newBalance).toFixed(2)}`}
                      </span>
                    );
                  })()}
                </div>
              </div>

              <div className="flex space-x-3">
                <button type="button" onClick={() => setShowTxConfirmModal(false)} disabled={isSubmitting} className="flex-1 py-2.5 px-4 bg-white border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 font-medium transition-colors">
                  Back
                </button>
                <button type="button" onClick={handleConfirmTxSubmit} disabled={isSubmitting} className={`flex-1 py-2.5 px-4 text-white rounded-lg font-medium transition-colors ${showTxModal === 'DEBIT' ? 'bg-red-600 hover:bg-red-700' : 'bg-emerald-600 hover:bg-emerald-700'} ${isSubmitting ? 'opacity-50 cursor-not-allowed' : ''}`}>
                  {isSubmitting ? 'Saving...' : 'Confirm'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      
      {editingTx && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md overflow-hidden">
            <div className="flex justify-between items-center p-4 border-b">
              <h3 className="font-semibold text-lg text-gray-900">Edit Transaction</h3>
              <button type="button" onClick={() => setEditingTx(null)} className="text-gray-400 hover:text-gray-600">×</button>
            </div>
            <form onSubmit={handleEditSubmit} className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Amount</label>
                <input required type="number" step="0.01" min="0.01" value={editTxAmount} onChange={e => { setEditTxAmount(e.target.value); setEditTxError(''); }} className="w-full px-3 py-2 border rounded-md focus:border-sky-500 focus:ring-1 focus:ring-sky-500" autoFocus />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Receipt / Invoice No.</label>
                <input type="text" value={editTxInvoiceNo} onChange={e => { setEditTxInvoiceNo(e.target.value.toLowerCase()); setEditTxError(''); }} className="w-full px-3 py-2 border rounded-md focus:border-sky-500 focus:ring-1 focus:ring-sky-500" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
                <textarea value={editTxNotes} onChange={e => { setEditTxNotes(e.target.value); setEditTxError(''); }} className="w-full px-3 py-2 border rounded-md focus:border-sky-500 focus:ring-1 focus:ring-sky-500"></textarea>
              </div>
              {editTxError && (
                <div className="p-3 bg-red-50 border border-red-200 text-red-600 rounded-lg text-sm text-center font-medium">
                  {editTxError}
                </div>
              )}
              <div className="pt-4 flex justify-end">
                <button type="button" onClick={() => setEditingTx(null)} disabled={isSubmitting} className="px-4 py-2 text-gray-600 mr-2 hover:bg-gray-50 rounded-md">Cancel</button>
                <button type="submit" disabled={isSubmitting} className={`px-4 py-2 text-white rounded-md bg-sky-600 hover:bg-sky-700 ${isSubmitting ? 'opacity-50 cursor-not-allowed' : ''}`}>
                  {isSubmitting ? 'Saving...' : 'Save Changes'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showDeleteConfirmModal && deletingTx && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md overflow-hidden">
            <div className="flex justify-between items-center p-4 border-b">
              <h3 className="font-semibold text-lg text-red-600 flex items-center gap-2">
                <Trash2 size={20} />
                Delete Entry
              </h3>
              <button type="button" onClick={() => { setShowDeleteConfirmModal(false); setDeletingTx(null); setDeletePassword(''); setDeletePasswordError(''); }} className="text-gray-400 hover:text-gray-600">×</button>
            </div>
            <div className="p-6 space-y-4">
              <p className="text-gray-600 text-sm">
                Are you sure you want to delete this entry? This action is irreversible. All related calculations and running balances will be automatically recalculated.
              </p>
              
              <div className="bg-gray-50 p-4 rounded-lg space-y-2 border border-gray-100 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-500">Date:</span>
                  <span className="font-medium text-gray-800">{format(new Date(deletingTx.timestamp), 'dd MMM yyyy, HH:mm')}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Particulars/Notes:</span>
                  <span className="font-medium text-gray-800 truncate max-w-[200px]">{deletingTx.notes || '-'}</span>
                </div>
                {deletingTx.invoiceNo && (
                  <div className="flex justify-between">
                    <span className="text-gray-500">Ref/Invoice No:</span>
                    <span className="font-mono text-gray-800 uppercase">{deletingTx.invoiceNo}</span>
                  </div>
                )}
                <div className="flex justify-between">
                  <span className="text-gray-500">Type:</span>
                  <span className={`font-semibold ${deletingTx.type === 'DEBIT' ? 'text-red-600' : 'text-emerald-600'}`}>
                    {deletingTx.type}
                  </span>
                </div>
                <div className="flex justify-between border-t border-gray-200/60 pt-2 mt-2">
                  <span className="text-gray-500 font-medium">Amount:</span>
                  <span className={`font-bold ${deletingTx.type === 'DEBIT' ? 'text-red-600' : 'text-emerald-600'}`}>
                    ₹{deletingTx.amount.toLocaleString(undefined, {minimumFractionDigits: 2})}
                  </span>
                </div>
              </div>

              <div className="space-y-1.5 pt-2">
                <label className="block text-xs font-bold uppercase tracking-wider text-gray-500">
                  Admin Password
                </label>
                <input
                  type="password"
                  placeholder="Enter Admin Password to confirm"
                  value={deletePassword}
                  onChange={(e) => {
                    setDeletePassword(e.target.value);
                    setDeletePasswordError('');
                  }}
                  className="w-full px-3 py-2 border border-gray-250 rounded-md focus:outline-none focus:ring-1 focus:ring-red-500 focus:border-red-500 text-sm"
                />
                {deletePasswordError && (
                  <p className="text-xs text-red-600 font-semibold mt-0.5">
                    {deletePasswordError}
                  </p>
                )}
              </div>

              <div className="pt-4 flex justify-end">
                <button 
                  type="button" 
                  onClick={() => { setShowDeleteConfirmModal(false); setDeletingTx(null); setDeletePassword(''); setDeletePasswordError(''); }} 
                  disabled={isSubmitting} 
                  className="px-4 py-2 text-gray-600 mr-2 hover:bg-gray-50 rounded-md text-sm font-medium transition-colors"
                >
                  Cancel
                </button>
                <button 
                  type="button" 
                  onClick={handleDeleteSubmit} 
                  disabled={isSubmitting} 
                  className={`px-4 py-2 text-white rounded-md bg-red-600 hover:bg-red-700 text-sm font-medium transition-colors ${isSubmitting ? 'opacity-50 cursor-not-allowed' : ''}`}
                >
                  {isSubmitting ? 'Deleting...' : 'Delete & Recalculate'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showDownloadModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-sm overflow-hidden">
            <div className="flex justify-between items-center p-4 border-b">
              <h3 className="font-semibold text-lg text-gray-900">Download Statement</h3>
              <button type="button" onClick={() => setShowDownloadModal(false)} className="text-gray-400 hover:text-gray-600">×</button>
            </div>
            <form onSubmit={generatePdf} className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Start Date</label>
                <input required type="date" value={downloadStartDate} onChange={e => setDownloadStartDate(e.target.value)} className="w-full px-3 py-2 border rounded-md focus:border-sky-500 focus:ring-1 focus:ring-sky-500 text-sm" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">End Date</label>
                <input required type="date" value={downloadEndDate} onChange={e => setDownloadEndDate(e.target.value)} min={downloadStartDate} className="w-full px-3 py-2 border rounded-md focus:border-sky-500 focus:ring-1 focus:ring-sky-500 text-sm" />
              </div>

              {/* PDF Lock Password Option */}
              <div className="pt-2 border-t border-gray-150">
                <div className="flex justify-between items-center mb-1.5">
                  <label className="text-xs font-semibold text-gray-700 flex items-center gap-1.5">
                    <Lock size={13} className={downloadPdfPassword.trim() ? "text-amber-600" : "text-gray-400"} />
                    <span>PDF Password Protection</span>
                  </label>
                  {party?.phone && !downloadPdfPassword && (
                    <button
                      type="button"
                      onClick={() => setDownloadPdfPassword(party.phone.replace(/\D/g, ''))}
                      className="text-[10px] text-sky-600 font-medium hover:underline flex items-center gap-1"
                    >
                      <Key size={10} />
                      Use Phone No
                    </button>
                  )}
                </div>

                <div className="relative">
                  <input
                    type={showDownloadPassText ? "text" : "password"}
                    placeholder="Set password to lock PDF (Optional)..."
                    value={downloadPdfPassword}
                    onChange={e => setDownloadPdfPassword(e.target.value)}
                    className="w-full px-3 py-2 text-xs border rounded-lg focus:border-sky-500 focus:ring-1 focus:ring-sky-500 pr-9 bg-gray-50/50"
                  />
                  <button
                    type="button"
                    onClick={() => setShowDownloadPassText(!showDownloadPassText)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                  >
                    {showDownloadPassText ? <EyeOff size={14} /> : <Eye size={14} />}
                  </button>
                </div>

                {downloadPdfPassword.trim() ? (
                  <div className="mt-1.5 flex items-center justify-between text-[11px] text-amber-700 bg-amber-50 p-2 rounded-md border border-amber-200">
                    <span className="flex items-center gap-1 font-medium">
                      <Lock size={11} className="shrink-0" />
                      Locked with: <code className="font-mono bg-amber-100 px-1 rounded">{downloadPdfPassword}</code>
                    </span>
                    <button
                      type="button"
                      onClick={() => setDownloadPdfPassword('')}
                      className="text-amber-800 hover:underline font-bold text-[10px] ml-2"
                    >
                      Remove
                    </button>
                  </div>
                ) : (
                  <p className="text-[10px] text-gray-400 mt-1">
                    Leave empty for standard unlocked PDF statement.
                  </p>
                )}
              </div>

              <div className="pt-2 flex justify-end">
                <button type="button" onClick={() => setShowDownloadModal(false)} className="px-4 py-2 text-gray-600 mr-2 hover:bg-gray-50 rounded-md text-sm">Cancel</button>
                <button type="submit" className="px-4 py-2 text-white bg-sky-600 hover:bg-sky-700 rounded-md text-sm font-semibold flex items-center gap-1.5">
                  <Download size={14} />
                  {downloadPdfPassword.trim() ? "Download Locked PDF" : "Download PDF"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showEditPartyModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-fade-in">
          <div className="bg-white dark:bg-gray-900 rounded-xl shadow-xl w-full max-w-md overflow-hidden border border-gray-150">
            <div className="flex justify-between items-center p-4 border-b border-gray-150 bg-gray-50 dark:bg-gray-800/50">
              <h3 className="font-bold text-gray-950 dark:text-white flex items-center gap-2">
                <Edit2 size={16} className="text-sky-600" />
                Edit Party Details
              </h3>
              <button type="button" onClick={() => setShowEditPartyModal(false)} className="text-gray-400 hover:text-gray-600 text-xl font-bold leading-none">×</button>
            </div>
            <form onSubmit={handleEditPartySubmit} className="p-5 space-y-4">
              {editPartyError && (
                <div className="p-3 text-xs font-semibold text-red-600 bg-red-50 rounded-lg border border-red-100">
                  {editPartyError}
                </div>
              )}
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-gray-500 mb-1">Party Name</label>
                <input
                  required
                  type="text"
                  value={editPartyName}
                  onChange={e => setEditPartyName(e.target.value)}
                  className="w-full px-3 py-2 border rounded-md focus:border-sky-500 focus:ring-1 focus:ring-sky-500 text-sm"
                  placeholder="e.g. John Doe"
                />
              </div>
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-gray-500 mb-1">Phone Number</label>
                <input
                  type="text"
                  value={editPartyPhone}
                  onChange={e => setEditPartyPhone(e.target.value)}
                  className="w-full px-3 py-2 border rounded-md focus:border-sky-500 focus:ring-1 focus:ring-sky-500 text-sm font-mono"
                  placeholder="e.g. 9876543210"
                />
              </div>
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-gray-500 mb-1">Email Address</label>
                <input
                  type="email"
                  value={editPartyEmail}
                  onChange={e => setEditPartyEmail(e.target.value)}
                  className="w-full px-3 py-2 border rounded-md focus:border-sky-500 focus:ring-1 focus:ring-sky-500 text-sm"
                  placeholder="e.g. client@example.com"
                />
              </div>
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-gray-500 mb-1">Address</label>
                <textarea
                  value={editPartyAddress}
                  onChange={e => setEditPartyAddress(e.target.value)}
                  rows={3}
                  className="w-full px-3 py-2 border rounded-md focus:border-sky-500 focus:ring-1 focus:ring-sky-500 text-sm"
                  placeholder="e.g. 123 Main St, Springfield"
                />
              </div>
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-gray-500 mb-1">Status</label>
                <select
                  value={editPartyStatus}
                  onChange={e => setEditPartyStatus(e.target.value as 'Active' | 'Inactive')}
                  className="w-full px-3 py-2 border rounded-md focus:border-sky-500 focus:ring-1 focus:ring-sky-500 text-sm bg-white text-gray-800"
                >
                  <option value="Active">Active</option>
                  <option value="Inactive">Inactive</option>
                </select>
              </div>
              <div className="pt-4 flex justify-end space-x-2 border-t border-gray-100 mt-6">
                <button
                  type="button"
                  onClick={() => setShowEditPartyModal(false)}
                  className="px-4 py-2 text-xs font-bold text-gray-600 hover:bg-gray-50 rounded-md border"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="px-4 py-2 text-xs font-bold text-white bg-sky-600 hover:bg-sky-700 rounded-md disabled:opacity-50 flex items-center gap-1.5 shadow-sm"
                >
                  {isSubmitting ? 'Saving...' : 'Save Changes'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
      
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <button 
            type="button"
            onClick={() => navigate('/parties')} 
            className="flex items-center text-xs font-normal text-gray-600 hover:text-gray-900 transition-colors"
          >
            <ArrowLeft size={14} className="mr-1" /> Dashboard &gt; Accounts &gt; {party.name}
          </button>
        </div>

        {/* Quick Add Action Buttons */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => {
              setTxAmount('');
              setTxCashAmount('');
              setTxAcAmount('');
              setSeparateCredit(false);
              setTxInvoiceNo('');
              setTxNotes('');
              setTxError('');
              setShowTxModal('DEBIT');
            }}
            className="inline-flex items-center justify-center px-3 py-1.5 bg-rose-600 hover:bg-rose-700 text-white rounded text-xs font-normal transition-all cursor-pointer shadow-2xs"
          >
            <Plus size={14} className="mr-1" />
            <span>{isPurchaseStyle ? 'Make Payment (Debit)' : 'Add Sale (Debit)'}</span>
          </button>

          <button
            type="button"
            onClick={() => {
              setTxAmount('');
              setTxCashAmount('');
              setTxAcAmount('');
              setSeparateCredit(false);
              setTxInvoiceNo('');
              setTxNotes('');
              setTxError('');
              setShowTxModal('CREDIT');
            }}
            className="inline-flex items-center justify-center px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded text-xs font-normal transition-all cursor-pointer shadow-2xs"
          >
            <Plus size={14} className="mr-1" />
            <span>{isPurchaseStyle ? 'Add Purchase (Credit)' : 'Receive Payment (Credit)'}</span>
          </button>
        </div>
      </div>

      {/* Party Summary Info Card */}
      <div className="bg-white rounded-lg border border-gray-200 p-4 mb-5 text-xs font-normal shadow-2xs">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-xl font-normal text-gray-900 tracking-tight">{party.name}</h1>
              <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-normal ${party.status === 'Inactive' ? 'bg-amber-50 text-amber-800 border-amber-200' : 'bg-emerald-50 text-emerald-800 border-emerald-200'} border`}>
                {party.status || 'Active'}
              </span>
              {currentUser?.isAdmin && (
                <>
                  <button
                    type="button"
                    onClick={handleOpenEditParty}
                    className="inline-flex items-center gap-1 px-2 py-0.5 bg-white hover:bg-gray-50 text-gray-700 rounded text-[11px] font-normal border border-gray-300 transition-colors cursor-pointer"
                  >
                    <Edit2 size={11} /> Edit Account
                  </button>
                </>
              )}
            </div>
            {party.phone || party.address || party.email ? (
              <p className="text-xs text-gray-500 font-normal mt-1 flex flex-wrap items-center gap-2">
                {party.phone && <span>Ph: {party.phone}</span>}
                {party.email && <span>Email: {party.email}</span>}
                {party.address && <span>Addr: {party.address}</span>}
              </p>
            ) : (
              <p className="text-xs text-gray-400 italic font-normal mt-1">No contact info provided</p>
            )}
          </div>

          <div className="w-full sm:w-auto pt-3 sm:pt-0 border-t sm:border-t-0 border-gray-100 flex flex-col items-start sm:items-end">
            <p className="text-xs text-gray-500 font-normal mb-0.5">Closing / Net Balance</p>
            <div className={`text-xl font-normal tracking-tight ${party.currentDue > 0 ? 'text-rose-600' : party.currentDue < 0 ? 'text-emerald-600' : 'text-gray-900'}`}>
              {party.currentDue > 0 ? (
                <>-₹{Math.abs(party.currentDue).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} (Due)</>
              ) : party.currentDue < 0 ? (
                <>₹{Math.abs(party.currentDue).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} (Advance)</>
              ) : (
                <>₹0.00</>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Ledger Table Container */}
      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden shadow-2xs text-xs font-normal">
        <div className="p-3 border-b border-gray-200 flex flex-col sm:flex-row justify-between items-center bg-white gap-3">
          <div>
            <h2 className="font-normal text-gray-900 text-xs">Full Account Statement</h2>
            <p className="text-[11px] text-gray-500 font-normal mt-0.5">
              {filteredTxs.length} transaction(s) found
            </p>
          </div>
          <div className="flex items-center gap-2 w-full sm:w-auto">
            <div className="relative w-full sm:w-64">
              <Search className="absolute left-2.5 top-2 text-gray-400" size={13} />
              <input
                type="text"
                placeholder="Search notes or ref..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-8 pr-3 py-1 text-xs border border-gray-300 rounded focus:outline-none focus:border-sky-500 text-gray-800 placeholder-gray-400 font-normal"
              />
            </div>
            <button 
              onClick={() => setShowDownloadModal(true)} 
              className="px-2.5 py-1 bg-white hover:bg-gray-50 border border-gray-300 text-gray-700 rounded text-xs font-normal flex items-center gap-1 cursor-pointer"
            >
              <Download size={13} /> PDF
            </button>
            <button 
              onClick={() => setShowShareModal(true)} 
              className="px-2.5 py-1 bg-white hover:bg-gray-50 border border-gray-300 text-gray-700 rounded text-xs font-normal flex items-center gap-1 cursor-pointer"
            >
              <Share2 size={13} /> Share
            </button>
          </div>
        </div>
        
        {/* Desktop View Table */}
        <div className="hidden md:block overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs font-normal">
            <thead>
              <tr className="bg-white border-b border-gray-200 text-gray-900 font-normal">
                <th className="p-2.5 border-r border-gray-200 font-normal w-40">Date</th>
                <th className="p-2.5 border-r border-gray-200 font-normal">Particulars</th>
                <th className="p-2.5 border-r border-gray-200 font-normal text-right min-w-[120px]">Debit (Dr)</th>
                <th className="p-2.5 border-r border-gray-200 font-normal text-right min-w-[120px]">Credit (Cr)</th>
                <th className="p-2.5 font-normal text-right min-w-[130px]">Balance</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 bg-white">
              {txWithBalance.length === 0 ? (
                <tr>
                  <td colSpan={5} className="p-8 text-center text-gray-400 font-normal text-xs">
                    No transactions recorded yet.
                  </td>
                </tr>
              ) : (
                <>
                  {txWithBalance.map((tx) => (
                    <tr 
                      key={tx.id} 
                      onClick={() => setSelectedDetailTx(tx)}
                      className="hover:bg-gray-50/80 cursor-pointer transition-colors text-xs font-normal"
                    >
                      <td className="p-2.5 border-r border-gray-200 text-gray-600 font-normal whitespace-nowrap">
                        {format(new Date(tx.timestamp), 'dd MMM yyyy, HH:mm')}
                      </td>
                      <td className="p-2.5 border-r border-gray-200">
                        <div className="flex items-center justify-between group">
                          <div>
                            <div className="font-normal text-gray-900 flex items-center gap-1.5">
                              <span>{tx.notes || '-'}</span>
                              {tx.attachmentUrl && (
                                <span className="inline-flex items-center gap-1 text-[10px] bg-amber-100 text-amber-800 font-extrabold px-1.5 py-0.5 rounded border border-amber-200" title="Scanned Bill Attachment Available">
                                  <Paperclip size={10} /> Bill Attached
                                </span>
                              )}
                            </div>
                            {tx.invoiceNo && <div className="text-[11px] text-gray-400 font-normal">Inv: {tx.invoiceNo}</div>}
                          </div>
                          <div className="flex items-center space-x-1.5 ml-2 md:opacity-0 md:group-hover:opacity-100 flex-shrink-0">
                            {currentUser?.isAdmin && (
                              <>
                                <button type="button" onClick={(e) => {
                                  e.stopPropagation();
                                  setEditingTx(tx);
                                  setEditTxAmount(tx.amount.toString());
                                  setEditTxInvoiceNo(tx.invoiceNo || '');
                                  setEditTxNotes(tx.notes || '');
                                }} className="p-1 text-gray-500 hover:text-sky-600 rounded transition-colors" title="Edit Transaction">
                                  <Edit2 size={13} />
                                </button>
                                <button type="button" onClick={(e) => {
                                  e.stopPropagation();
                                  setDeletingTx(tx);
                                  setShowDeleteConfirmModal(true);
                                }} className="p-1 text-gray-500 hover:text-rose-600 rounded transition-colors" title="Delete Transaction">
                                  <Trash2 size={13} />
                                </button>
                              </>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="p-2.5 border-r border-gray-200 text-right text-rose-600 font-normal whitespace-nowrap">
                        {tx.type === 'DEBIT' ? tx.amount.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2}) : <span className="text-gray-300">-</span>}
                      </td>
                      <td className="p-2.5 border-r border-gray-200 text-right text-emerald-600 font-normal whitespace-nowrap">
                        {tx.type === 'CREDIT' ? tx.amount.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2}) : <span className="text-gray-300">-</span>}
                      </td>
                      <td className={`p-2.5 text-right font-normal whitespace-nowrap ${(tx.runningBalance ?? 0) > 0 ? 'text-rose-600' : (tx.runningBalance ?? 0) < 0 ? 'text-emerald-600' : 'text-gray-800'}`}>
                        {(tx.runningBalance ?? 0) === 0 ? '0.00' : (tx.runningBalance ?? 0) > 0 ? `-₹${Math.abs(tx.runningBalance ?? 0).toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}` : `₹${Math.abs(tx.runningBalance ?? 0).toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}`}
                      </td>
                    </tr>
                  ))}

                  <tr className="bg-gray-50/50 text-xs font-normal">
                    <td className="p-2.5 border-r border-gray-200 text-gray-400 font-normal">-</td>
                    <td className="p-2.5 border-r border-gray-200 font-normal text-gray-700">
                      {isFirstPageOfTransactions ? 'Opening Balance' : 'Balance Brought Forward'}
                    </td>
                    <td className="p-2.5 border-r border-gray-200 text-right text-gray-500 font-normal">
                      {pageOpeningBalance > 0 ? pageOpeningBalance.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2}) : '-'}
                    </td>
                    <td className="p-2.5 border-r border-gray-200 text-right text-gray-500 font-normal">
                      {pageOpeningBalance < 0 ? Math.abs(pageOpeningBalance).toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2}) : '-'}
                    </td>
                    <td className="p-2.5 text-right font-normal text-gray-800">
                      {pageOpeningBalance === 0 
                        ? '0.00' 
                        : pageOpeningBalance > 0 
                          ? `-₹${Math.abs(pageOpeningBalance).toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}`
                          : `₹${Math.abs(pageOpeningBalance).toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}`}
                    </td>
                  </tr>
                </>
              )}
            </tbody>
          </table>
        </div>

        {/* Mobile View Card List */}
        <div className="block md:hidden divide-y divide-gray-100 bg-white">
          {/* Transaction Cards on Mobile */}
          {txWithBalance.length === 0 ? (
            <div className="p-12 text-center text-gray-500">
              <FileText size={32} className="mx-auto mb-3 text-gray-300" />
              <p className="text-sm">No transactions recorded yet.</p>
            </div>
          ) : (
            <>
              {txWithBalance.map((tx) => (
                <div 
                  key={tx.id} 
                  onClick={() => setSelectedDetailTx(tx)}
                  className="p-3 hover:bg-gray-50/40 transition-colors flex items-center justify-between gap-3 text-sm bg-white cursor-pointer"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    {/* Compact Date Badge */}
                    <div className="flex flex-col items-center justify-center bg-gray-50 text-gray-500 rounded p-1 min-w-[38px] h-[38px] text-center border border-gray-100 shrink-0">
                      <span className="text-[8px] font-bold uppercase leading-none">{format(new Date(tx.timestamp), 'MMM')}</span>
                      <span className="text-xs font-extrabold text-gray-800 leading-tight mt-0.5">{format(new Date(tx.timestamp), 'dd')}</span>
                    </div>
                    
                    {/* Notes & Balance Info */}
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <h4 className="font-semibold text-gray-950 text-xs sm:text-sm truncate">{tx.notes || 'No notes'}</h4>
                        {tx.attachmentUrl && (
                          <span className="inline-flex items-center gap-0.5 text-[9px] bg-amber-100 text-amber-800 font-extrabold px-1 py-0.2 rounded border border-amber-200 shrink-0">
                            <Paperclip size={9} /> Bill
                          </span>
                        )}
                      </div>
                      <div className="text-[10px] text-gray-500 truncate mt-0.5 flex items-center gap-1.5 flex-wrap">
                        {tx.invoiceNo && <span className="font-mono text-gray-400">Inv: {tx.invoiceNo}</span>}
                        <span className={`font-bold px-1 py-0.2 text-[9px] rounded uppercase tracking-wider ${(tx.runningBalance ?? 0) > 0 ? 'bg-red-50 text-red-700 border border-red-100' : (tx.runningBalance ?? 0) < 0 ? 'bg-emerald-50 text-emerald-700 border border-emerald-100' : 'bg-gray-50 text-gray-600 border border-gray-200'}`}>
                          Bal: {(tx.runningBalance ?? 0) === 0 ? '0.00' : (tx.runningBalance ?? 0) > 0 ? `-₹${Math.abs(tx.runningBalance ?? 0).toLocaleString(undefined, {maximumFractionDigits: 0})}` : `₹${Math.abs(tx.runningBalance ?? 0).toLocaleString(undefined, {maximumFractionDigits: 0})}`}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Amount & Actions */}
                  <div className="flex items-center gap-2 shrink-0">
                    <div className="text-right">
                      <span className={`text-[8px] sm:text-[9px] uppercase font-bold tracking-wider leading-none block mb-0.5 ${tx.type === 'DEBIT' ? 'text-red-500' : 'text-emerald-500'}`}>
                        {tx.type === 'DEBIT' ? 'Debit (Dr)' : 'Credit (Cr)'}
                      </span>
                      <div className={`font-extrabold text-xs sm:text-sm ${tx.type === 'DEBIT' ? 'text-red-600' : 'text-emerald-600'}`}>
                        {tx.type === 'DEBIT' ? '-' : '+'}₹{tx.amount.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                      </div>
                    </div>

                    {currentUser?.isAdmin && (
                      <div className="flex items-center gap-0.5 border-l pl-2 border-gray-150">
                        <button 
                          type="button" 
                          onClick={(e) => {
                            e.stopPropagation();
                            setEditingTx(tx);
                            setEditTxAmount(tx.amount.toString());
                            setEditTxInvoiceNo(tx.invoiceNo || '');
                            setEditTxNotes(tx.notes || '');
                          }} 
                          className="text-gray-400 hover:text-sky-600 p-2 rounded-md hover:bg-sky-50 active:bg-sky-100 transition-colors" 
                          title="Edit Transaction"
                        >
                          <Edit2 size={14} />
                        </button>
                        <button 
                          type="button" 
                          onClick={(e) => {
                            e.stopPropagation();
                            setDeletingTx(tx);
                            setShowDeleteConfirmModal(true);
                          }} 
                          className="text-gray-400 hover:text-red-600 p-2 rounded-md hover:bg-red-50 active:bg-red-100 transition-colors" 
                          title="Delete Transaction"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              ))}

              {/* Opening Balance Card on Mobile */}
              <div className="p-3 bg-gray-50/50 flex items-center justify-between gap-3 text-sm">
                <div className="flex items-center gap-3">
                  <div className="flex items-center justify-center bg-gray-150 text-gray-400 rounded w-[38px] h-[38px] border border-gray-200 text-center shrink-0">
                    <span className="text-[9px] font-bold uppercase leading-none">START</span>
                  </div>
                  <div>
                    <h4 className="font-semibold text-gray-800 text-xs sm:text-sm">
                      {isFirstPageOfTransactions ? 'Opening Balance' : 'Balance Brought Forward'}
                    </h4>
                    <p className="text-[10px] text-gray-400 mt-0.5">Prior period balance</p>
                  </div>
                </div>
                <div className="text-right">
                  <span className="text-[8px] uppercase font-bold tracking-wider leading-none block mb-0.5 text-gray-400">
                    Balance
                  </span>
                  <div className={`font-extrabold text-xs sm:text-sm ${pageOpeningBalance > 0 ? 'text-red-600' : pageOpeningBalance < 0 ? 'text-emerald-600' : 'text-gray-500'}`}>
                    {pageOpeningBalance === 0 
                      ? '₹ 0.00' 
                      : pageOpeningBalance > 0 
                        ? `-₹${Math.abs(pageOpeningBalance).toLocaleString(undefined, {minimumFractionDigits: 2})}`
                        : `₹${Math.abs(pageOpeningBalance).toLocaleString(undefined, {minimumFractionDigits: 2})}`}
                  </div>
                </div>
              </div>
            </>
          )}
        </div>

        {totalPages > 1 && (
          <div className="p-4 border-t border-gray-100 flex flex-col sm:flex-row items-center justify-between bg-gray-50/50 gap-4">
            <div className="text-sm text-gray-500">
              Showing page <span className="font-medium">{currentPage}</span> of{' '}
              <span className="font-medium">{totalPages}</span> ({filteredTxs.length} transactions)
            </div>
            <div className="flex items-center space-x-1">
              <button
                type="button"
                disabled={currentPage === 1}
                onClick={() => setCurrentPage(prev => Math.max(prev - 1, 1))}
                className="p-2 border border-gray-200 rounded-md hover:bg-white text-gray-600 disabled:opacity-50 disabled:hover:bg-transparent transition-colors"
                title="Next (Newer Transactions)"
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
                title="Previous (Older Transactions)"
              >
                <ChevronRight size={16} />
              </button>
            </div>
          </div>
        )}
      </div>

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

      {showSuccess && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm transition-opacity">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-xs overflow-hidden flex flex-col items-center justify-center p-8 transform transition-all duration-300">
            <div className="w-20 h-20 bg-emerald-100 rounded-full flex items-center justify-center mb-6 shadow-inner animate-[bounce_0.5s_ease-out]">
              <Check className="text-emerald-500" size={40} strokeWidth={3} />
            </div>
            <h3 className="text-xl font-bold text-gray-900 mb-2">Success!</h3>
            <p className="text-sm text-gray-500 text-center font-medium">Transaction has been recorded.</p>
          </div>
        </div>
      )}

      {showShareModal && party && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-[fadeIn_0.2s_ease-out]">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-lg overflow-hidden flex flex-col max-h-[90vh]">
            <div className="flex justify-between items-center p-4 border-b bg-gray-50/50">
              <h3 className="font-semibold text-lg text-gray-900 flex items-center gap-2">
                <Share2 size={18} className="text-emerald-500" />
                Share Ledger Statement (PDF)
              </h3>
              <button 
                type="button" 
                onClick={() => setShowShareModal(false)} 
                className="text-gray-400 hover:text-gray-600 font-bold text-xl cursor-pointer"
              >
                ×
              </button>
            </div>
            
            <div className="p-6 space-y-5 overflow-y-auto flex-1">
              {/* Date Filters */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-gray-500 mb-1">
                    From Date
                  </label>
                  <input 
                    required 
                    type="date" 
                    value={shareStartDate} 
                    onChange={e => setShareStartDate(e.target.value)} 
                    className="w-full px-3 py-2 border rounded-md focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 text-sm" 
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-gray-500 mb-1">
                    To Date
                  </label>
                  <input 
                    required 
                    type="date" 
                    value={shareEndDate} 
                    onChange={e => setShareEndDate(e.target.value)} 
                    min={shareStartDate} 
                    className="w-full px-3 py-2 border rounded-md focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 text-sm" 
                  />
                </div>
              </div>

              {/* Statement Preview / Summary Card */}
              {(() => {
                const { rangeTxs, periodOpeningBalance, periodClosingBalance, totalDebit, totalCredit } = getShareRangeData();
                const totalTxsCount = rangeTxs.length;

                return (
                  <div className="space-y-4">
                    <div className="bg-slate-50 border border-slate-100 rounded-xl p-4 space-y-3">
                      <div className="flex justify-between items-center text-xs text-slate-500 font-semibold uppercase tracking-wider border-b border-slate-200/60 pb-2">
                        <span>Ledger Summary Preview</span>
                        <span className="text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full lowercase font-normal">
                          {totalTxsCount} transaction{totalTxsCount !== 1 ? 's' : ''}
                        </span>
                      </div>

                      <div className="grid grid-cols-2 gap-y-2.5 text-sm">
                        <div className="text-slate-500">Opening Bal:</div>
                        <div className="text-right font-semibold text-slate-800">
                          ₹{Math.abs(periodOpeningBalance).toFixed(2)} {periodOpeningBalance > 0 ? 'Dr' : periodOpeningBalance < 0 ? 'Cr' : ''}
                        </div>

                        <div className="text-slate-500">Total Debit (+):</div>
                        <div className="text-right font-semibold text-red-600">
                          ₹{totalDebit.toFixed(2)}
                        </div>

                        <div className="text-slate-500">Total Credit (-):</div>
                        <div className="text-right font-semibold text-emerald-600">
                          ₹{totalCredit.toFixed(2)}
                        </div>

                        <div className="text-slate-800 font-semibold pt-1 border-t border-dashed border-slate-200">Closing Bal:</div>
                        <div className={`text-right font-bold pt-1 border-t border-dashed border-slate-200 ${periodClosingBalance > 0 ? 'text-red-600' : 'text-emerald-600'}`}>
                          ₹{Math.abs(periodClosingBalance).toFixed(2)} {periodClosingBalance > 0 ? 'Dr' : periodClosingBalance < 0 ? 'Cr' : ''}
                        </div>
                      </div>
                    </div>

                    {/* Password Lock Section in Share Modal */}
                    <div className="pt-3 pb-1 border-t border-slate-200">
                      <div className="flex justify-between items-center mb-1.5">
                        <label className="text-xs font-semibold text-slate-700 flex items-center gap-1.5">
                          <Lock size={13} className={sharePdfPassword.trim() ? "text-amber-600" : "text-slate-400"} />
                          <span>PDF Lock Password</span>
                        </label>
                        {party?.phone && !sharePdfPassword && (
                          <button
                            type="button"
                            onClick={() => setSharePdfPassword(party.phone.replace(/\D/g, ''))}
                            className="text-[10px] text-sky-600 font-medium hover:underline flex items-center gap-1"
                          >
                            <Key size={10} />
                            Use Phone ({party.phone.slice(-4)})
                          </button>
                        )}
                      </div>

                      <div className="relative">
                        <input
                          type={showSharePassText ? "text" : "password"}
                          placeholder="Password to lock shared PDF (Optional)..."
                          value={sharePdfPassword}
                          onChange={e => setSharePdfPassword(e.target.value)}
                          className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg focus:border-sky-500 focus:ring-1 focus:ring-sky-500 pr-9 bg-slate-50"
                        />
                        <button
                          type="button"
                          onClick={() => setShowSharePassText(!showSharePassText)}
                          className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                        >
                          {showSharePassText ? <EyeOff size={14} /> : <Eye size={14} />}
                        </button>
                      </div>

                      {sharePdfPassword.trim() ? (
                        <div className="mt-1.5 flex items-center justify-between text-[11px] text-amber-800 bg-amber-50 p-2 rounded-md border border-amber-200">
                          <span className="flex items-center gap-1 font-medium">
                            <Lock size={11} className="shrink-0" />
                            Locked with: <code className="font-mono bg-amber-100 px-1 rounded">{sharePdfPassword}</code>
                          </span>
                          <button
                            type="button"
                            onClick={() => setSharePdfPassword('')}
                            className="text-amber-900 hover:underline font-bold text-[10px] ml-2"
                          >
                            Remove
                          </button>
                        </div>
                      ) : (
                        <p className="text-[10px] text-slate-400 mt-1">
                          Lock PDF statement with password before sending to client.
                        </p>
                      )}
                    </div>

                    {/* Direct Sharing Actions */}
                    <div className="space-y-3 pt-2">
                      <button
                        type="button"
                        onClick={handleSharePdf}
                        className="w-full flex items-center justify-center gap-2.5 py-3 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold active:scale-98 transition-all shadow-md shadow-emerald-900/10 cursor-pointer"
                      >
                        <Share2 size={16} />
                        {sharePdfPassword.trim() ? "Share Password-Locked PDF" : "Share PDF Statement"}
                      </button>

                      <button
                        type="button"
                        onClick={async () => {
                          const doc = await buildPdf(shareStartDate, shareEndDate);
                          if (doc) {
                            const fileName = `ledger_${party.name.replace(/\s+/g, '_')}_${format(new Date(), 'yyyyMMdd')}.pdf`;
                            const { blob } = await exportEncryptedPdf(doc, sharePdfPassword);
                            downloadPdfBlob(blob, fileName);
                          }
                        }}
                        className="w-full flex items-center justify-center gap-2.5 py-2.5 px-4 rounded-xl bg-sky-50 hover:bg-sky-100 text-sky-700 text-xs font-semibold active:scale-98 transition-all border border-sky-100 cursor-pointer"
                      >
                        <Download size={14} />
                        {sharePdfPassword.trim() ? "Download Password-Locked PDF" : "Download PDF Document"}
                      </button>

                      <div className="relative flex py-2 items-center">
                        <div className="flex-grow border-t border-gray-200"></div>
                        <span className="flex-shrink mx-4 text-gray-400 text-[11px] font-bold uppercase tracking-wider">Alternative Text Format</span>
                        <div className="flex-grow border-t border-gray-200"></div>
                      </div>

                      <button
                        type="button"
                        onClick={() => {
                          const shareMsg = getShareMessage(rangeTxs, periodOpeningBalance, periodClosingBalance, totalDebit, totalCredit);
                          navigator.clipboard.writeText(shareMsg);
                          setShareCopied(true);
                          setTimeout(() => setShareCopied(false), 2500);
                        }}
                        className="w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl bg-slate-800 hover:bg-slate-700 text-white text-xs font-semibold active:scale-98 transition-all shadow-sm cursor-pointer"
                      >
                        {shareCopied ? (
                          <>
                            <Check size={14} className="text-emerald-400" />
                            Copied Text Summary to Clipboard!
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

            <div className="p-4 border-t bg-gray-50 flex justify-end">
              <button 
                type="button" 
                onClick={() => setShowShareModal(false)} 
                className="px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-white text-sm font-semibold transition-colors cursor-pointer"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Transaction Detail Popup Modal */}
      <TransactionDetailModal
        isOpen={selectedDetailTx !== null}
        onClose={() => setSelectedDetailTx(null)}
        transaction={selectedDetailTx}
        partyName={party?.name || ''}
        ledgerName={activeLedger?.name}
      />
    </div>
  );
}
