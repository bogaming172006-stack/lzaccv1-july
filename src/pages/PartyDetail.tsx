import React, { useState, useEffect, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { db, handleFirestoreError, OperationType, doc, getDoc, collection, query, where, updateDoc, getDocs } from '../firebase';
import { Party, Transaction } from '../types';
import { 
  ArrowLeft, 
  Download, 
  Plus, 
  Minus, 
  FileText, 
  Calendar,
  Filter,
  Edit2, 
  Check, 
  Search, 
  ChevronLeft, 
  ChevronRight, 
  ChevronUp,
  ChevronDown,
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
  Loader2, 
  RefreshCw, 
  Calculator, 
  Wrench, 
  Sparkles,
  BarChart2,
  MoreVertical
} from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { v4 as uuidv4 } from 'uuid';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { format, subMonths, startOfMonth, endOfMonth } from 'date-fns';
import { formatAmountInWords } from '../lib/numberToWords';
import { useLedger } from '../LedgerContext';
import { useAuth } from '../AuthContext';
import { getAvatarColor, formatCustomerCurrency } from '../lib/customerTheme';

import { createTransaction, editTransaction, deleteTransaction, recalculatePartyBalance } from '../lib/transactionService';
import { getCacheItem, getFilteredCacheItems, setCacheItem } from '../lib/idbCache';
import { syncCollection } from '../lib/syncCache';
import { logUserActivity } from '../lib/activityLogger';
import { isInvoiceNumber } from '../lib/invoiceClassification';
import { useLedgerTextCase, CaseIndicator } from '../lib/textCaseHelper';
import ThermalReceiptModal from '../components/ThermalReceiptModal';
import { loadImage, getOptimizedLogoData } from '../components/CompanyLogo';
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
  const isExpense = activeLedger?.type === 'EXPENSE';
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
  const [editTxType, setEditTxType] = useState<'DEBIT' | 'CREDIT'>('DEBIT');
  const [editTxDate, setEditTxDate] = useState('');
  const [editTxTime, setEditTxTime] = useState('');
  const [editTxAmount, setEditTxAmount] = useState('');
  const [editTxInvoiceNo, setEditTxInvoiceNo] = useState('');
  const [editTxNotes, setEditTxNotes] = useState('');
  const [editTxError, setEditTxError] = useState('');
  const { isCaps, toggleManualCaps, handleTextChange } = useLedgerTextCase();
  const [isRecalculating, setIsRecalculating] = useState(false);
  const [recalcSummary, setRecalcSummary] = useState<{
    openingBalance: number;
    totalDebit: number;
    totalCredit: number;
    currentDue: number;
    transactionCount: number;
  } | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [showDateFilter, setShowDateFilter] = useState(false);
  const [show12MonthChart, setShow12MonthChart] = useState(false);
  const [activeFilter, setActiveFilter] = useState<'all' | 'debit' | 'credit'>('all');
  const [currency, setCurrency] = useState<string>(() => localStorage.getItem('party_currency') || 'Rp');
  const [density, setDensity] = useState<'compact' | 'ultra'>(() => (localStorage.getItem('party_density') as any) || 'compact');
  const [showMoreMenu, setShowMoreMenu] = useState(false);

  const handleDensityChange = (d: 'compact' | 'ultra') => {
    setDensity(d);
    localStorage.setItem('party_density', d);
  };

  const handleCurrencyChange = (curr: string) => {
    setCurrency(curr);
    localStorage.setItem('party_currency', curr);
  };

  // Generate 12-month rolling column chart data for this specific party
  const party12MonthData = useMemo(() => {
    const data = [];
    const now = new Date();
    for (let i = 11; i >= 0; i--) {
      const monthDate = subMonths(now, i);
      const start = startOfMonth(monthDate).getTime();
      const end = endOfMonth(monthDate).getTime();
      
      const monthTxs = transactions.filter(t => t.timestamp >= start && t.timestamp <= end);
      const debit = monthTxs.filter(t => t.type === 'DEBIT').reduce((acc, t) => acc + (t.amount || 0), 0);
      const credit = monthTxs.filter(t => t.type === 'CREDIT').reduce((acc, t) => acc + (t.amount || 0), 0);
      const txCount = monthTxs.length;
      
      data.push({
        name: format(monthDate, 'MMM'),
        fullMonth: format(monthDate, 'MMMM yyyy'),
        debit,
        credit,
        net: debit - credit,
        txCount
      });
    }
    return data;
  }, [transactions]);

  const party12MonthDr = useMemo(() => party12MonthData.reduce((acc, m) => acc + m.debit, 0), [party12MonthData]);
  const party12MonthCr = useMemo(() => party12MonthData.reduce((acc, m) => acc + m.credit, 0), [party12MonthData]);
  const party12MonthNet = party12MonthDr - party12MonthCr;

  const totalDebitSum = useMemo(() => {
    return transactions.filter(t => t.type === 'DEBIT').reduce((acc, t) => acc + t.amount, 0);
  }, [transactions]);

  const totalCreditSum = useMemo(() => {
    return transactions.filter(t => t.type === 'CREDIT').reduce((acc, t) => acc + t.amount, 0);
  }, [transactions]);

  const groupedTransactions = useMemo(() => {
    let items = [...transactions].sort((a, b) => b.timestamp - a.timestamp);
    if (activeFilter === 'debit') {
      items = items.filter(t => t.type === 'DEBIT');
    } else if (activeFilter === 'credit') {
      items = items.filter(t => t.type === 'CREDIT');
    }

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      items = items.filter(t => 
        (t.notes || '').toLowerCase().includes(q) || 
        (t.invoiceNo || '').toLowerCase().includes(q)
      );
    }

    const groups: Record<string, Transaction[]> = {};
    items.forEach(tx => {
      const dateStr = format(new Date(tx.timestamp), 'MMM d, yyyy');
      if (!groups[dateStr]) groups[dateStr] = [];
      groups[dateStr].push(tx);
    });
    return groups;
  }, [transactions, activeFilter, searchQuery]);

  const handleOpenEditTx = (tx: Transaction) => {
    setEditingTx(tx);
    setEditTxType(tx.type);
    setEditTxAmount(tx.amount.toString());
    setEditTxDate(format(new Date(tx.timestamp), 'yyyy-MM-dd'));
    setEditTxTime(format(new Date(tx.timestamp), 'HH:mm'));
    setEditTxInvoiceNo(tx.invoiceNo || '');
    setEditTxNotes(tx.notes || '');
    setEditTxError('');
  };

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
  const [partyIdCopied, setPartyIdCopied] = useState(false);

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
  }, [searchQuery, startDate, endDate, id]);

  const filteredTxs = transactions.filter(tx => {
    if (startDate && new Date(startDate).getTime() > tx.timestamp) return false;
    if (endDate) {
      const end = new Date(endDate);
      end.setHours(23, 59, 59, 999);
      if (end.getTime() < tx.timestamp) return false;
    }
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
  const sortedFilteredTxs = [...filteredTxs].sort((a, b) => b.timestamp - a.timestamp);

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
    const doc = new jsPDF({ compress: true });

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
      const logoData = await getOptimizedLogoData('/logo.png', 500, 0.85);
      const aspectRatio = logoData.width / logoData.height;
      
      let targetWidth = 95;
      let targetHeight = targetWidth / aspectRatio;
      if (targetHeight > 35) {
        targetHeight = 35;
        targetWidth = targetHeight * aspectRatio;
      }
      const xPos = 105 - (targetWidth / 2);
      doc.addImage(logoData.dataUrl, logoData.format, xPos, 10, targetWidth, targetHeight, undefined, 'FAST');
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

    const words = formatAmountInWords(Math.abs(periodFinalBalance));
    doc.setFontSize(8.5);
    doc.setFont('helvetica', 'italic');
    doc.setTextColor(71, 85, 105);
    const splitWords = words ? doc.splitTextToSize(`Amount in words: ${words}`, 170) : [];
    const boxHeight = 22 + (splitWords.length > 0 ? (splitWords.length * 4.5) : 0);

    doc.setFillColor(248, 250, 252);
    doc.rect(14, finalY + 8, 182, boxHeight, 'F');
    doc.setFontSize(11);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(0, 0, 0);
    doc.text('Period Total:', 20, finalY + 19);
    doc.text(`Rs. ${periodFinalBalance > 0 ? '-' : ''}${Math.abs(periodFinalBalance).toFixed(2)}`, 190, finalY + 19, { align: 'right' });
    
    if (splitWords.length > 0) {
      doc.setFontSize(8.5);
      doc.setFont('helvetica', 'italic');
      doc.setTextColor(71, 85, 105);
      doc.text(splitWords, 20, finalY + 28);
    }
    
    let currentY = finalY + 8 + boxHeight + 8;
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

    // Only detect duplicates for invoices that contain digits/numbers (pure text like "CASH", "UPI", "ADVANCE" are NOT treated as duplicate invoices)
    const hasDigits = /\d+/.test(invNo);
    if (!hasDigits) {
      setMatchedInvoiceInfo(null);
      return true;
    }

    setIsCheckingTxInvoice(true);
    try {
      const cleanUpper = invNo.toUpperCase().trim();
      const cleanLower = invNo.toLowerCase().trim();

      const [trackedSnapUpper, trackedSnapLower, txSnapUpper, txSnapLower] = await Promise.all([
        getDocs(query(collection(db, 'tracked_invoices'), where('ledgerId', '==', party.ledgerId), where('invoiceNo', '==', cleanUpper))),
        cleanUpper !== cleanLower 
          ? getDocs(query(collection(db, 'tracked_invoices'), where('ledgerId', '==', party.ledgerId), where('invoiceNo', '==', cleanLower)))
          : Promise.resolve({ docs: [] } as any),
        getDocs(query(collection(db, 'transactions'), where('ledgerId', '==', party.ledgerId), where('invoiceNo', '==', cleanUpper))),
        cleanUpper !== cleanLower
          ? getDocs(query(collection(db, 'transactions'), where('ledgerId', '==', party.ledgerId), where('invoiceNo', '==', cleanLower)))
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
      logUserActivity(
        `Recorded ${showTxModal} Voucher`,
        `₹${numAmount.toFixed(2)} for ${party.name}${txInvoiceNo ? ` (Inv #${txInvoiceNo})` : ''}`,
        currentUser,
        activeLedger?.name,
        party.ledgerId
      );
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
      setEditTxError('Please enter a valid positive amount.');
      setIsSubmitting(false);
      return;
    }

    if (!editTxInvoiceNo.trim() && !editTxNotes.trim()) {
      setEditTxError('Please enter either a Receipt/Invoice No. or Notes.');
      setIsSubmitting(false);
      return;
    }

    let updatedTimestamp = editingTx.timestamp;
    if (editTxDate) {
      const [year, month, day] = editTxDate.split('-').map(Number);
      let hours = 0;
      let minutes = 0;
      if (editTxTime) {
        [hours, minutes] = editTxTime.split(':').map(Number);
      } else {
        const orig = new Date(editingTx.timestamp);
        hours = orig.getHours();
        minutes = orig.getMinutes();
      }
      const updatedDate = new Date(year, month - 1, day, hours || 0, minutes || 0);
      if (!isNaN(updatedDate.getTime())) {
        updatedTimestamp = updatedDate.getTime();
      }
    }

    try {
      const success = await editTransaction(
        editingTx.id,
        editingTx,
        {
          amount: numAmount,
          type: editTxType,
          timestamp: updatedTimestamp,
          invoiceNo: editTxInvoiceNo.toLowerCase().trim(),
          notes: editTxNotes
        },
        party
      );
      if (success) {
        logUserActivity(
          'Edited Voucher Entry',
          `Updated ${editTxType} voucher for ${party.name} to ₹${numAmount.toFixed(2)}${editTxInvoiceNo ? ` (Inv #${editTxInvoiceNo})` : ''}`,
          currentUser,
          activeLedger?.name,
          party.ledgerId
        );
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

  const handleRecalculateBalance = async () => {
    if (!party || !party.id || isRecalculating) return;
    setIsRecalculating(true);
    try {
      const res = await recalculatePartyBalance(party.id, party.ledgerId);
      if (res.success) {
        setRecalcSummary(res);
        setShowSuccess(true);
        setTimeout(() => setShowSuccess(false), 2000);
        await fetchPartyAndTransactions();
        logUserActivity(
          'Recalculated & Fixed Calculations',
          `Verified & fixed running balances for ${party.name} (${res.transactionCount} vouchers, Balance: ₹${res.currentDue.toFixed(2)})`,
          currentUser,
          activeLedger?.name,
          party.ledgerId
        );
      } else {
        alert(`Calculation check completed with note: ${res.error || 'Failed'}`);
      }
    } catch (err) {
      console.error('Error recalculating balance:', err);
    } finally {
      setIsRecalculating(false);
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
        logUserActivity(
          'Deleted Voucher Entry',
          `Removed ₹${deletingTx.amount.toFixed(2)} voucher from ${party.name}`,
          currentUser,
          activeLedger?.name,
          party.ledgerId
        );
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

  const avatar = getAvatarColor(party.name);
  const initial = party.name.trim().charAt(0).toUpperCase() || 'C';

  return (
    <div className={`w-full min-h-screen bg-white sm:bg-[#F8FAFC] pb-16 font-customer ${density === 'ultra' ? 'text-[11px]' : 'text-xs'}`}>
      <div className="w-full min-h-screen bg-white flex flex-col relative sm:max-w-xl md:max-w-2xl sm:mx-auto sm:border-x sm:border-slate-100 sm:shadow-xs transition-all">
        
        {/* ========================================================================= */}
        {/* COMPACT SCREEN 2: TRANSACTION PAGE HEADER                                 */}
        {/* ========================================================================= */}
        <header className="px-3 py-1.5 flex items-center justify-between bg-white sticky top-0 z-20 border-b border-[#F1F5F9]">
          <div className="flex items-center gap-2 flex-1 min-w-0 mr-2">
            <button 
              id="backToListBtn" 
              onClick={() => navigate('/parties')}
              className="p-1 text-[#0F172A] rounded-md hover:bg-slate-100 active:opacity-60 transition shrink-0" 
              aria-label="Back"
            >
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                <line x1="19" y1="12" x2="5" y2="12"></line>
                <polyline points="12 19 5 12 12 5"></polyline>
              </svg>
            </button>
            <h1 className="text-sm font-bold text-[#0F172A] tracking-tight truncate flex-1 min-w-0" id="detailCustomerHeaderTitle">
              {party.name}
            </h1>
          </div>

          <div className="flex items-center gap-0.5 shrink-0">
            <button 
              onClick={() => setShowDownloadModal(true)} 
              className="p-1 text-slate-600 hover:text-slate-900 rounded-md hover:bg-slate-100 transition"
              title="Export PDF Statement"
            >
              <Download size={13} />
            </button>
            <button 
              onClick={() => setShowShareModal(true)} 
              className="p-1 text-slate-600 hover:text-slate-900 rounded-md hover:bg-slate-100 transition"
              title="Share Statement via WhatsApp / Link"
            >
              <Share2 size={13} />
            </button>
            <button 
              onClick={() => setShowMoreMenu(true)} 
              className="p-1 text-slate-600 hover:text-slate-900 rounded-md hover:bg-slate-100 transition"
              title="More Actions & Settings"
            >
              <MoreVertical size={13} />
            </button>
          </div>
        </header>

        {/* COMPACT CUSTOMER CARD SIMPLE */}
        <div className="px-3 py-1.5 flex items-center">
          <div className="flex items-center gap-2.5 flex-1 min-w-0">
            <div 
              className={`w-7 h-7 rounded-full flex items-center justify-center text-[10.5px] font-bold shrink-0 shadow-2xs ${avatar.className}`}
              style={{ backgroundColor: avatar.bg, color: avatar.text }}
            >
              {initial}
            </div>
            <div className="flex-1 min-w-0">
              <h2 className="text-xs font-bold text-[#0F172A] leading-tight mb-0.5 truncate" id="detailCustomerName">
                {party.name}
              </h2>
              <p className="text-[10px] text-[#64748B] leading-tight truncate" id="detailCustomerMeta">
                {[party.email || 'No email', party.phone || 'No phone'].join(' • ')}
              </p>
            </div>
          </div>
        </div>

        {/* COMPACT FINANCIAL BALANCE BANNER */}
        <div className="mx-3 my-1 bg-white border border-[#E2E8F0] rounded-xl p-2.5 shadow-2xs">
          <div className="flex justify-between items-baseline pb-1.5 border-b border-[#F1F5F9]">
            <span className="text-[9px] font-bold text-[#64748B] uppercase tracking-[0.5px]">
              CURRENT BALANCE
            </span>
            <span className={`text-base font-bold ${party.currentDue > 0 ? 'text-[#DC2626]' : party.currentDue < 0 ? 'text-[#16A34A]' : 'text-[#0F172A]'}`} id="detailNetBalance">
              {formatCustomerCurrency(party.currentDue, currency)} {party.currentDue > 0 ? 'DR' : party.currentDue < 0 ? 'CR' : ''}
            </span>
          </div>

          <div className="grid grid-cols-2 gap-2 pt-1.5">
            <div className="flex flex-col gap-0.5">
              <span className="text-[9.5px] text-[#64748B] font-medium flex items-center gap-1">
                <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="#DC2626" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="7" y1="17" x2="17" y2="7"></line><polyline points="7 7 17 7 17 17"></polyline>
                </svg>
                Total Debit
              </span>
              <span className="text-[11px] font-bold text-[#DC2626] tabular-nums" id="detailTotalDebit">
                {formatCustomerCurrency(totalDebitSum, currency)}
              </span>
            </div>

            <div className="flex flex-col gap-0.5">
              <span className="text-[9.5px] text-[#64748B] font-medium flex items-center gap-1">
                <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="#16A34A" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="17" y1="7" x2="7" y2="17"></line><polyline points="17 17 7 17 7 7"></polyline>
                </svg>
                Total Credit
              </span>
              <span className="text-[11px] font-bold text-[#16A34A] tabular-nums" id="detailTotalCredit">
                {formatCustomerCurrency(totalCreditSum, currency)}
              </span>
            </div>
          </div>
        </div>

        {/* QUICK ACTION BUTTONS (+ DEBIT / + CREDIT) */}
        <div className="px-3 py-1 flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => { setTxAmount(''); setTxInvoiceNo(''); setTxNotes(''); setTxError(''); setShowTxModal('DEBIT'); }}
            className="flex-1 py-1 px-2 bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200/80 rounded-lg text-[11px] font-bold transition flex items-center justify-center gap-1 cursor-pointer active:scale-95 shadow-2xs"
          >
            <Minus size={11} className="text-rose-600" />
            <span>+ Debit (Dr)</span>
          </button>

          <button
            type="button"
            onClick={() => { setTxAmount(''); setTxCashAmount(''); setTxAcAmount(''); setTxInvoiceNo(''); setTxNotes(''); setTxError(''); setShowTxModal('CREDIT'); }}
            className="flex-1 py-1 px-2 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200/80 rounded-lg text-[11px] font-bold transition flex items-center justify-center gap-1 cursor-pointer active:scale-95 shadow-2xs"
          >
            <Plus size={11} className="text-emerald-600" />
            <span>+ Credit (Cr)</span>
          </button>
        </div>

        {/* COMPACT FILTER TABS & SEARCH */}
        <div className="px-3 py-1 flex items-center justify-between gap-1">
          <div className="flex gap-1">
            <button 
              onClick={() => setActiveFilter('all')}
              className={`px-2 py-0.5 text-[10px] font-semibold rounded-full border transition-all cursor-pointer ${
                activeFilter === 'all' 
                  ? 'bg-[#0F172A] text-white border-[#0F172A]' 
                  : 'border-[#E2E8F0] bg-white text-[#64748B] hover:bg-slate-50'
              }`}
            >
              All
            </button>
            <button 
              onClick={() => setActiveFilter('debit')}
              className={`px-2 py-0.5 text-[10px] font-semibold rounded-full border transition-all cursor-pointer ${
                activeFilter === 'debit' 
                  ? 'bg-[#0F172A] text-white border-[#0F172A]' 
                  : 'border-[#E2E8F0] bg-white text-[#64748B] hover:bg-slate-50'
              }`}
            >
              Debit
            </button>
            <button 
              onClick={() => setActiveFilter('credit')}
              className={`px-2 py-0.5 text-[10px] font-semibold rounded-full border transition-all cursor-pointer ${
                activeFilter === 'credit' 
                  ? 'bg-[#0F172A] text-white border-[#0F172A]' 
                  : 'border-[#E2E8F0] bg-white text-[#64748B] hover:bg-slate-50'
              }`}
            >
              Credit
            </button>
          </div>

          <div className="relative w-24">
            <Search size={10} className="absolute left-1.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input 
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Search..."
              className="w-full pl-5 pr-1.5 py-0.5 bg-slate-50 border border-slate-200 rounded-full text-[10px] text-slate-800 placeholder:text-slate-400 focus:outline-none focus:border-blue-600"
            />
          </div>
        </div>

        {/* COMPACT TRANSACTIONS LIST SECTION */}
        <div className="px-3 pb-14 flex-1">
          <ul className="list-none m-0 p-0" id="transactionsList">
            {Object.entries(groupedTransactions).map(([dateStr, txs]) => (
              <React.Fragment key={dateStr}>
                {/* DATE SEPARATOR */}
                <li className="flex items-center my-1.5 text-[#94A3B8] text-[9.5px] font-semibold before:flex-1 before:h-[1px] before:bg-[#E2E8F0] after:flex-1 after:h-[1px] after:bg-[#E2E8F0]">
                  <span className="px-2 tracking-[0.2px]">{dateStr}</span>
                </li>

                {/* TRANSACTION ROWS */}
                {(txs as Transaction[]).map((tx) => {
                  const isDebit = tx.type === 'DEBIT';
                  return (
                    <li 
                      key={tx.id}
                      onClick={() => setSelectedDetailTx(tx)}
                      className="flex items-center justify-between py-1.5 border-b border-[#F1F5F9] cursor-pointer hover:bg-slate-50/70 transition-colors select-none"
                    >
                      <div className="flex items-center gap-2">
                        <div className={`w-6 h-6 rounded-full flex items-center justify-center shrink-0 ${isDebit ? 'bg-[#FEE2E2] text-[#DC2626]' : 'bg-[#DCFCE7] text-[#16A34A]'}`}>
                          {isDebit ? (
                            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                              <line x1="7" y1="17" x2="17" y2="7"></line><polyline points="7 7 17 7 17 17"></polyline>
                            </svg>
                          ) : (
                            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                              <line x1="17" y1="7" x2="7" y2="17"></line><polyline points="17 17 7 17 7 7"></polyline>
                            </svg>
                          )}
                        </div>
                        <div>
                          <div className="text-[11px] font-bold text-[#0F172A] mb-0.5 leading-tight truncate max-w-[170px]">
                            {tx.invoiceNo ? `Invoice #${tx.invoiceNo}` : (tx.notes || (isDebit ? 'Debit Entry' : 'Payment'))}
                          </div>
                          <div className="text-[9.5px] text-[#64748B]">
                            {format(new Date(tx.timestamp), 'hh:mm a')}
                          </div>
                        </div>
                      </div>

                      <div className="text-right shrink-0">
                        <div className={`text-[11px] font-bold mb-0.5 tabular-nums ${isDebit ? 'text-[#DC2626]' : 'text-[#16A34A]'}`}>
                          {isDebit ? '-' : '+'}{formatCustomerCurrency(tx.amount, currency)}
                        </div>
                        <span className={`text-[8px] font-bold uppercase tracking-[0.3px] ${isDebit ? 'text-[#DC2626]' : 'text-[#16A34A]'}`}>
                          {tx.type}
                        </span>
                      </div>
                    </li>
                  );
                })}
              </React.Fragment>
            ))}

            {transactions.length === 0 && (
              <li className="text-center py-10 px-3 text-[#94A3B8] text-[11px]">
                No transactions recorded.
              </li>
            )}
          </ul>
        </div>

        {/* MORE OPTIONS MODAL */}
        {showMoreMenu && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-3 bg-slate-900/50 backdrop-blur-xs animate-in fade-in">
            <div className="bg-white rounded-xl w-full max-w-xs border border-slate-200 p-4 space-y-3 shadow-xl">
              <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                <h3 className="font-bold text-sm text-[#0F172A]">Customer Actions</h3>
                <button 
                  onClick={() => setShowMoreMenu(false)}
                  className="text-slate-400 hover:text-slate-600 p-0.5"
                >
                  <X size={16} />
                </button>
              </div>

              {/* Interface Size Toggle */}
              <div>
                <label className="text-[10px] font-bold text-slate-700 uppercase tracking-wider block mb-1.5">Interface Size</label>
                <div className="grid grid-cols-2 gap-1.5">
                  <button
                    type="button"
                    onClick={() => handleDensityChange('compact')}
                    className={`px-2 py-1.5 rounded-lg text-[11px] font-semibold border transition ${
                      density === 'compact' 
                        ? 'border-blue-600 bg-blue-50 text-blue-700' 
                        : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                    }`}
                  >
                    Compact (Default)
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDensityChange('ultra')}
                    className={`px-2 py-1.5 rounded-lg text-[11px] font-semibold border transition ${
                      density === 'ultra' 
                        ? 'border-blue-600 bg-blue-50 text-blue-700' 
                        : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                    }`}
                  >
                    Ultra-Compact
                  </button>
                </div>
              </div>

              {/* Currency Selector */}
              <div>
                <label className="text-[10px] font-bold text-slate-700 uppercase tracking-wider block mb-1.5">Currency Symbol</label>
                <div className="grid grid-cols-3 gap-1.5">
                  {[
                    { id: 'Rp', label: 'Rp' },
                    { id: '₹', label: '₹' },
                    { id: '$', label: '$' }
                  ].map(c => (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => handleCurrencyChange(c.id)}
                      className={`px-2 py-1.5 rounded-lg text-[11px] font-semibold border transition ${
                        currency === c.id 
                          ? 'border-blue-600 bg-blue-50 text-blue-700' 
                          : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                      }`}
                    >
                      {c.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-1.5 pt-1.5 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => { setShowMoreMenu(false); handleOpenEditParty(); }}
                  className="w-full py-1.5 px-2.5 bg-slate-100 hover:bg-slate-200 rounded-lg text-[11px] font-semibold text-slate-700 flex items-center justify-center gap-1.5 transition"
                >
                  <Edit2 size={13} className="text-blue-600" />
                  <span>Edit Customer Details</span>
                </button>

                {currentUser?.isAdmin && (
                  <button
                    type="button"
                    onClick={() => { setShowMoreMenu(false); handleRecalculateBalance(); }}
                    disabled={isRecalculating}
                    className="w-full py-1.5 px-2.5 bg-amber-50 hover:bg-amber-100 rounded-lg text-[11px] font-semibold text-amber-800 flex items-center justify-center gap-1.5 transition"
                  >
                    <RefreshCw size={13} className={isRecalculating ? "animate-spin text-amber-700" : "text-amber-700"} />
                    <span>{isRecalculating ? 'Recalculating...' : 'Fix Balance Calculations'}</span>
                  </button>
                )}

                <button
                  type="button"
                  onClick={() => {
                    navigator.clipboard.writeText(party.id);
                    setPartyIdCopied(true);
                    setTimeout(() => setPartyIdCopied(false), 2000);
                  }}
                  className="w-full py-1.5 px-2.5 bg-slate-50 hover:bg-slate-100 rounded-lg text-[10.5px] font-mono text-slate-600 flex items-center justify-center gap-1.5 transition"
                >
                  <Copy size={12} />
                  <span>{partyIdCopied ? 'ID Copied!' : `Copy ID: ${party.id.substring(0, 12)}...`}</span>
                </button>
              </div>

              <button
                type="button"
                onClick={() => setShowMoreMenu(false)}
                className="w-full py-2 bg-[#0F172A] text-white font-bold text-[11px] rounded-lg hover:bg-slate-800 transition"
              >
                Close
              </button>
            </div>
          </div>
        )}

      </div>

      {/* Transaction Modal (Debit / Credit) */}
      {showTxModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-150">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-sm border border-slate-200 overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-100 flex justify-between items-center bg-slate-50/90">
              <div className="flex items-center gap-2">
                <div className={`p-1 rounded-md ${showTxModal === 'DEBIT' ? 'bg-rose-100/70 text-rose-600' : 'bg-emerald-100/70 text-emerald-600'}`}>
                  {showTxModal === 'DEBIT' ? <Minus size={13} strokeWidth={2.5} /> : <Plus size={13} strokeWidth={2.5} />}
                </div>
                <div>
                  <h3 className="font-bold text-slate-900 text-xs sm:text-sm leading-tight">
                    {isExpense ? 'Record Expense Payment (Dr)' : showTxModal === 'DEBIT' ? 'Record Debit Voucher (Dr)' : 'Record Credit Voucher (Cr)'}
                  </h3>
                  <p className="text-[10.5px] text-slate-500 leading-tight">{party.name}</p>
                </div>
              </div>
              <button 
                type="button" 
                onClick={() => setShowTxModal(null)} 
                className="text-slate-400 hover:text-slate-600 p-1 rounded-md transition-colors"
              >
                <X size={15} />
              </button>
            </div>

            <form onSubmit={handlePreTxSubmit} className="p-4 space-y-3">
              {showTxModal === 'CREDIT' && (
                <div className="flex items-center gap-2 p-2 bg-slate-50 rounded-md border border-slate-200">
                  <input
                    type="checkbox"
                    id="separateCredit"
                    checked={separateCredit}
                    onChange={e => setSeparateCredit(e.target.checked)}
                    className="h-3.5 w-3.5 rounded border-slate-300 text-blue-600 cursor-pointer"
                  />
                  <label htmlFor="separateCredit" className="text-[11px] font-semibold text-slate-700 cursor-pointer select-none">
                    Separate Cash & Bank Account Credit
                  </label>
                </div>
              )}

              {showTxModal === 'CREDIT' && separateCredit ? (
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-[10px] font-bold text-emerald-700 uppercase tracking-wider mb-1">Cash Credit (₹)</label>
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
                      className="w-full px-2.5 py-1.5 text-xs bg-white border border-slate-300 rounded-md text-slate-900 font-mono focus:border-emerald-600 focus:outline-none"
                      placeholder="0.00"
                      autoFocus
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-blue-700 uppercase tracking-wider mb-1">Bank A/C Credit (₹)</label>
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
                      className="w-full px-2.5 py-1.5 text-xs bg-white border border-slate-300 rounded-md text-slate-900 font-mono focus:border-blue-600 focus:outline-none"
                      placeholder="0.00"
                    />
                  </div>
                </div>
              ) : (
                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-600 mb-1">
                    Amount (₹) <span className="text-rose-500">*</span>
                  </label>
                  <input 
                    required 
                    type="number" 
                    step="0.01" 
                    min="0.01" 
                    value={txAmount} 
                    onChange={e => { setTxAmount(e.target.value); setTxError(''); }} 
                    className="w-full px-2.5 py-1.5 text-xs bg-white border border-slate-300 rounded-md text-slate-900 font-mono focus:border-blue-600 focus:outline-none" 
                    placeholder="0.00" 
                    autoFocus 
                  />
                </div>
              )}

              {txAmount && !isNaN(parseFloat(txAmount)) && parseFloat(txAmount) > 0 && (
                <div className="px-2.5 py-1.5 bg-blue-50/80 border border-blue-100 rounded-md text-[11px] text-blue-900 flex items-start gap-1.5">
                  <FileText size={12} className="text-blue-600 mt-0.5 shrink-0" />
                  <div className="min-w-0 flex-1">
                    <span className="font-semibold block text-[9.5px] uppercase tracking-wider text-blue-700">Amount in words:</span>
                    <span className="italic font-medium text-blue-950 leading-tight block">{formatAmountInWords(txAmount)}</span>
                  </div>
                </div>
              )}

              <div>
                <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-600 mb-1">
                  Receipt / Invoice No.
                </label>
                <div className="relative">
                  <input
                    type="text"
                    value={txInvoiceNo}
                    onChange={e => {
                      setTxInvoiceNo(e.target.value.toUpperCase());
                      setTxError('');
                      if (!e.target.value.trim()) setMatchedInvoiceInfo(null);
                    }}
                    onBlur={() => {
                      if (txInvoiceNo.trim() && showTxModal) {
                        checkTxInvoice(txInvoiceNo, showTxModal);
                      }
                    }}
                    placeholder="e.g. 101 or INV-45"
                    className="w-full px-2.5 py-1.5 text-xs bg-white border border-slate-300 rounded-md text-slate-900 font-mono uppercase focus:border-blue-600 focus:outline-none placeholder:normal-case"
                  />
                  {isCheckingTxInvoice && (
                    <div className="absolute right-2.5 top-2">
                      <Loader2 className="animate-spin text-blue-600" size={13} />
                    </div>
                  )}
                </div>

                {matchedInvoiceInfo && (
                  <div className="p-2 bg-emerald-50 border border-emerald-200 rounded-md text-emerald-900 text-[11px] mt-1.5">
                    <span className="font-bold">✓ Matched Invoice Reference:</span>
                    <p className="text-[10.5px] text-emerald-700 mt-0.5">
                      Prior {matchedInvoiceInfo.type} for {matchedInvoiceInfo.partyName} (₹{matchedInvoiceInfo.amount.toFixed(2)})
                    </p>
                  </div>
                )}
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-600">
                    Particulars / Notes
                  </label>
                  <CaseIndicator isCaps={isCaps} onToggle={toggleManualCaps} />
                </div>
                <textarea 
                  value={txNotes} 
                  onChange={e => { handleTextChange(e, setTxNotes); setTxError(''); }} 
                  className="w-full px-2.5 py-1.5 text-xs bg-white border border-slate-300 rounded-md text-slate-900 focus:border-blue-600 focus:outline-none" 
                  rows={2} 
                  placeholder="e.g. Goods delivery / NEFT Payment"
                />
              </div>

              {txError && (
                <div className="p-2 bg-rose-50 border border-rose-200 text-rose-700 rounded-md text-[11px] font-medium">
                  {txError}
                </div>
              )}

              <div className="pt-2.5 border-t border-slate-100 flex justify-end gap-1.5">
                <button 
                  type="button" 
                  onClick={() => setShowTxModal(null)} 
                  disabled={isSubmitting} 
                  className="px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-md transition-colors"
                >
                  Cancel
                </button>
                <button 
                  type="submit" 
                  disabled={isSubmitting} 
                  className={`px-4 py-1.5 text-white text-xs font-bold rounded-md shadow-2xs transition-colors ${
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
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-3 sm:p-4 bg-slate-900/60 backdrop-blur-xs">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-xs border border-slate-200 overflow-hidden p-4">
            <h3 className="font-bold text-sm text-slate-900 mb-3 text-center">Confirm Ledger Voucher</h3>
            
            <div className="bg-slate-50 p-3 rounded-md space-y-2 mb-4 border border-slate-200 text-[11.5px]">
              <div className="flex justify-between text-slate-600">
                <span>Current Balance:</span>
                <span className="font-bold text-slate-900">{party.currentDue.toFixed(2)}</span>
              </div>
              <div className="flex justify-between text-slate-600 border-b border-slate-200 pb-1.5">
                <span>Voucher {showTxModal}:</span>
                <span className={`font-bold ${showTxModal === 'DEBIT' ? 'text-rose-600' : 'text-emerald-600'}`}>
                  {showTxModal === 'DEBIT' ? '-' : '+'}₹{parseFloat(txAmount).toFixed(2)}
                </span>
              </div>
              {formatAmountInWords(txAmount) && (
                <div className="text-[10px] text-slate-500 italic bg-white p-1.5 rounded border border-slate-200/80 leading-tight">
                  <span className="font-semibold not-italic text-slate-600 block text-[9px] uppercase tracking-wider">In Words:</span>
                  {formatAmountInWords(txAmount)}
                </div>
              )}
              <div className="flex justify-between font-bold text-slate-900 pt-0.5">
                <span>Expected Balance:</span>
                <span>
                  {(party.currentDue + (showTxModal === 'DEBIT' ? parseFloat(txAmount) : -parseFloat(txAmount))).toFixed(2)}
                </span>
              </div>
            </div>

            <div className="flex gap-1.5">
              <button 
                type="button" 
                onClick={() => setShowTxConfirmModal(false)} 
                disabled={isSubmitting} 
                className="flex-1 py-1.5 px-2.5 border border-slate-300 text-slate-700 rounded-md text-xs font-semibold hover:bg-slate-50 transition-colors"
              >
                Back
              </button>
              <button 
                type="button" 
                onClick={handleConfirmTxSubmit} 
                disabled={isSubmitting} 
                className={`flex-1 py-1.5 px-2.5 text-white rounded-md text-xs font-bold shadow-2xs transition-colors ${
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
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-900/60 backdrop-blur-xs">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-md border border-slate-200 overflow-hidden flex flex-col max-h-[90vh]">
            <div className="px-4 py-3 border-b border-slate-100 flex justify-between items-center bg-slate-50/90">
              <div className="flex items-center gap-1.5">
                <Edit2 size={14} className="text-blue-600" />
                <h3 className="font-bold text-slate-900 text-xs sm:text-sm">Edit Voucher Entry</h3>
              </div>
              <button type="button" onClick={() => setEditingTx(null)} className="text-slate-400 hover:text-slate-600 p-1">
                <X size={15} />
              </button>
            </div>

            <form onSubmit={handleEditSubmit} className="p-4 space-y-3 overflow-y-auto flex-1">
              {/* Type Selection */}
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-600 mb-1.5">
                  Voucher Type
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => { setEditTxType('DEBIT'); setEditTxError(''); }}
                    className={`py-2 px-3 rounded-lg text-xs font-bold border transition flex items-center justify-center gap-1.5 ${
                      editTxType === 'DEBIT'
                        ? 'bg-rose-50 border-rose-500 text-rose-700 shadow-2xs'
                        : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
                    }`}
                  >
                    <Minus size={13} className="text-rose-600" />
                    <span>Debit (Dr / Outgoing)</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => { setEditTxType('CREDIT'); setEditTxError(''); }}
                    className={`py-2 px-3 rounded-lg text-xs font-bold border transition flex items-center justify-center gap-1.5 ${
                      editTxType === 'CREDIT'
                        ? 'bg-emerald-50 border-emerald-500 text-emerald-700 shadow-2xs'
                        : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
                    }`}
                  >
                    <Plus size={13} className="text-emerald-600" />
                    <span>Credit (Cr / Incoming)</span>
                  </button>
                </div>
              </div>

              {/* Amount */}
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-600 mb-1">
                  Amount (₹) <span className="text-rose-500">*</span>
                </label>
                <div className="relative">
                  <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 font-bold text-xs">₹</span>
                  <input
                    required
                    type="number"
                    step="0.01"
                    min="0.01"
                    value={editTxAmount}
                    onChange={e => { setEditTxAmount(e.target.value); setEditTxError(''); }}
                    className="w-full pl-6 pr-2.5 py-1.5 text-xs bg-white border border-slate-300 rounded-md font-mono font-bold focus:border-blue-600 focus:outline-none"
                    placeholder="0.00"
                  />
                </div>
                {editTxAmount && !isNaN(parseFloat(editTxAmount)) && parseFloat(editTxAmount) > 0 && (
                  <div className="mt-1 px-2.5 py-1.5 bg-blue-50/70 border border-blue-100 rounded-md text-[11px] text-blue-900 flex items-start gap-1.5">
                    <FileText size={12} className="text-blue-600 mt-0.5 shrink-0" />
                    <div className="min-w-0 flex-1">
                      <span className="font-semibold block text-[9.5px] uppercase tracking-wider text-blue-700">Amount in words:</span>
                      <span className="italic font-medium text-blue-950 leading-tight block">{formatAmountInWords(editTxAmount)}</span>
                    </div>
                  </div>
                )}
              </div>

              {/* Date & Time */}
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-600 mb-1">Date</label>
                  <input
                    type="date"
                    value={editTxDate}
                    onChange={e => { setEditTxDate(e.target.value); setEditTxError(''); }}
                    className="w-full px-2.5 py-1.5 text-xs bg-white border border-slate-300 rounded-md font-mono focus:border-blue-600 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-600 mb-1">Time</label>
                  <input
                    type="time"
                    value={editTxTime}
                    onChange={e => { setEditTxTime(e.target.value); setEditTxError(''); }}
                    className="w-full px-2.5 py-1.5 text-xs bg-white border border-slate-300 rounded-md font-mono focus:border-blue-600 focus:outline-none"
                  />
                </div>
              </div>

              {/* Invoice No. */}
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-600 mb-1">Invoice / Receipt No.</label>
                <input
                  type="text"
                  placeholder="e.g. INV-1002"
                  value={editTxInvoiceNo}
                  onChange={e => { setEditTxInvoiceNo(e.target.value.toUpperCase()); setEditTxError(''); }}
                  className="w-full px-2.5 py-1.5 text-xs bg-white border border-slate-300 rounded-md font-mono uppercase focus:border-blue-600 focus:outline-none placeholder:normal-case"
                />
              </div>

              {/* Particulars / Notes */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-600">Particulars / Description</label>
                  <CaseIndicator isCaps={isCaps} onToggle={toggleManualCaps} />
                </div>
                <textarea
                  value={editTxNotes}
                  onChange={e => { handleTextChange(e, setEditTxNotes); setEditTxError(''); }}
                  className="w-full px-2.5 py-1.5 text-xs bg-white border border-slate-300 rounded-md focus:border-blue-600 focus:outline-none"
                  rows={2}
                  placeholder="Describe goods, payment details or notes"
                />
              </div>

              {/* Balance Calculation Preview */}
              {party && (
                <div className="bg-slate-50 border border-slate-200 rounded-lg p-2.5 text-[11px] space-y-1">
                  <div className="flex items-center justify-between text-slate-500 font-medium">
                    <span>Original Entry:</span>
                    <span className="font-mono">{editingTx.type} ₹{editingTx.amount.toFixed(2)}</span>
                  </div>
                  <div className="flex items-center justify-between text-slate-800 font-semibold">
                    <span>New Entry:</span>
                    <span className={`font-mono ${editTxType === 'DEBIT' ? 'text-rose-600' : 'text-emerald-600'}`}>
                      {editTxType} ₹{parseFloat(editTxAmount || '0').toFixed(2)}
                    </span>
                  </div>
                  <p className="text-[10px] text-slate-400 pt-1 border-t border-slate-200">
                    * All running balances and party totals will be automatically recalculated upon saving.
                  </p>
                </div>
              )}

              {editTxError && (
                <div className="p-2 bg-rose-50 border border-rose-200 text-rose-700 rounded-md text-[11px] font-medium">
                  {editTxError}
                </div>
              )}

              <div className="pt-2.5 border-t border-slate-100 flex justify-end gap-1.5">
                <button
                  type="button"
                  onClick={() => setEditingTx(null)}
                  disabled={isSubmitting}
                  className="px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-md"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="px-4 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded-md shadow-2xs flex items-center gap-1.5"
                >
                  {isSubmitting ? (
                    <>
                      <Loader2 size={12} className="animate-spin" />
                      <span>Recalculating...</span>
                    </>
                  ) : (
                    <span>Save & Recalculate</span>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {showDeleteConfirmModal && deletingTx && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-900/60 backdrop-blur-xs">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-sm border border-slate-200 overflow-hidden p-4 space-y-3">
            <h3 className="font-bold text-rose-600 text-sm flex items-center gap-1.5">
              <Trash2 size={15} />
              Delete Ledger Voucher
            </h3>
            <p className="text-xs text-slate-600">
              Are you sure you want to delete this voucher? All running balances will be recalculated.
            </p>
            
            <div className="space-y-1 pt-1">
              <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-600">Admin Password</label>
              <input
                type="password"
                placeholder="Enter admin password"
                value={deletePassword}
                onChange={e => { setDeletePassword(e.target.value); setDeletePasswordError(''); }}
                className="w-full px-2.5 py-1.5 border border-slate-300 rounded-md text-xs font-mono focus:border-rose-600 focus:outline-none"
              />
              {deletePasswordError && (
                <p className="text-[11px] text-rose-600 font-semibold mt-0.5">{deletePasswordError}</p>
              )}
            </div>

            <div className="pt-2 flex justify-end gap-1.5">
              <button 
                type="button" 
                onClick={() => { setShowDeleteConfirmModal(false); setDeletingTx(null); setDeletePassword(''); }} 
                className="px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-md transition-colors"
              >
                Cancel
              </button>
              <button 
                type="button" 
                onClick={handleDeleteSubmit} 
                disabled={isSubmitting} 
                className="px-4 py-1.5 bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold rounded-md shadow-2xs transition-colors"
              >
                {isSubmitting ? 'Deleting...' : 'Confirm Delete'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* PDF Export Modal */}
      {showDownloadModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-900/60 backdrop-blur-xs">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-sm border border-slate-200 overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-100 flex justify-between items-center bg-slate-50/90">
              <h3 className="font-bold text-slate-900 text-xs sm:text-sm">Download Account Statement</h3>
              <button type="button" onClick={() => setShowDownloadModal(false)} className="text-slate-400 hover:text-slate-600 p-1">
                <X size={15} />
              </button>
            </div>
            <form onSubmit={generatePdf} className="p-4 space-y-3">
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-600 mb-1">Start Date</label>
                <input required type="date" value={downloadStartDate} onChange={e => setDownloadStartDate(e.target.value)} className="w-full px-2.5 py-1.5 border border-slate-300 rounded-md text-xs font-mono focus:outline-none focus:border-blue-600" />
              </div>
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-600 mb-1">End Date</label>
                <input required type="date" value={downloadEndDate} onChange={e => setDownloadEndDate(e.target.value)} min={downloadStartDate} className="w-full px-2.5 py-1.5 border border-slate-300 rounded-md text-xs font-mono focus:outline-none focus:border-blue-600" />
              </div>

              <div className="pt-2 border-t border-slate-100">
                <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-600 mb-1 flex items-center gap-1">
                  <Lock size={11} className="text-slate-400" />
                  PDF Password Protection (Optional)
                </label>
                <input
                  type={showDownloadPassText ? "text" : "password"}
                  placeholder="Set PDF opening password..."
                  value={downloadPdfPassword}
                  onChange={e => setDownloadPdfPassword(e.target.value)}
                  className="w-full px-2.5 py-1.5 text-xs border border-slate-300 rounded-md font-mono focus:outline-none focus:border-blue-600"
                />
              </div>

              <div className="pt-2 flex justify-end gap-1.5">
                <button type="button" onClick={() => setShowDownloadModal(false)} className="px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-md">Cancel</button>
                <button type="submit" className="px-4 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded-md shadow-2xs flex items-center gap-1">
                  <Download size={13} /> Download PDF
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit Party Modal */}
      {showEditPartyModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-900/60 backdrop-blur-xs">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-sm border border-slate-200 overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-100 flex justify-between items-center bg-slate-50/90">
              <h3 className="font-bold text-slate-900 text-xs sm:text-sm">Edit Party Details</h3>
              <button type="button" onClick={() => setShowEditPartyModal(false)} className="text-slate-400 hover:text-slate-600 p-1">
                <X size={15} />
              </button>
            </div>
            <form onSubmit={handleEditPartySubmit} className="p-4 space-y-3">
              {editPartyError && (
                <div className="p-2 text-[11px] font-semibold text-rose-600 bg-rose-50 rounded-md border border-rose-100">
                  {editPartyError}
                </div>
              )}
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-600 mb-1">Party Name</label>
                <input required type="text" value={editPartyName} onChange={e => handleTextChange(e, setEditPartyName)} className="w-full px-2.5 py-1.5 border border-slate-300 rounded-md text-xs focus:outline-none focus:border-blue-600" />
              </div>
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-600 mb-1">Phone Number</label>
                <input type="text" value={editPartyPhone} onChange={e => setEditPartyPhone(e.target.value)} className="w-full px-2.5 py-1.5 border border-slate-300 rounded-md text-xs font-mono focus:outline-none focus:border-blue-600" />
              </div>
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-600 mb-1">Email Address</label>
                <input type="email" value={editPartyEmail} onChange={e => setEditPartyEmail(e.target.value)} className="w-full px-2.5 py-1.5 border border-slate-300 rounded-md text-xs focus:outline-none focus:border-blue-600" />
              </div>
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-600 mb-1">Address</label>
                <textarea value={editPartyAddress} onChange={e => handleTextChange(e, setEditPartyAddress)} rows={2} className="w-full px-2.5 py-1.5 border border-slate-300 rounded-md text-xs focus:outline-none focus:border-blue-600" />
              </div>
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-600 mb-1">Status</label>
                <select value={editPartyStatus} onChange={e => setEditPartyStatus(e.target.value as any)} className="w-full px-2.5 py-1.5 border border-slate-300 rounded-md text-xs bg-white focus:outline-none focus:border-blue-600">
                  <option value="Active">Active</option>
                  <option value="Inactive">Inactive</option>
                </select>
              </div>
              <div className="pt-2 flex justify-end gap-1.5">
                <button type="button" onClick={() => setShowEditPartyModal(false)} className="px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-md">Cancel</button>
                <button type="submit" disabled={isSubmitting} className="px-4 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded-md shadow-2xs">Save Changes</button>
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
          ledgerType={activeLedger?.type}
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
        ledgerType={activeLedger?.type}
        isAdmin={currentUser?.isAdmin}
        onOpenReceipt={(tx) => setReceiptTx(tx)}
        onEdit={(tx) => handleOpenEditTx(tx)}
        onDelete={(tx) => {
          setDeletingTx(tx);
          setShowDeleteConfirmModal(true);
        }}
      />

      {/* Calculation Recalculation Summary Modal */}
      {recalcSummary && party && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-900/60 backdrop-blur-xs">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-sm border border-slate-200 overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-100 flex justify-between items-center bg-amber-50/90">
              <div className="flex items-center gap-1.5 text-amber-900 font-bold text-xs sm:text-sm">
                <Calculator size={16} className="text-amber-600" />
                <span>Calculation Verified & Fixed</span>
              </div>
              <button type="button" onClick={() => setRecalcSummary(null)} className="text-slate-400 hover:text-slate-600 p-1">
                <X size={15} />
              </button>
            </div>
            
            <div className="p-4 space-y-3 text-xs">
              <p className="text-slate-600">
                All chronological running balances for <strong>{party.name}</strong> have been recalculated from initial entries:
              </p>

              <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 space-y-1.5 font-mono text-[11.5px]">
                <div className="flex justify-between text-slate-600">
                  <span>Opening Balance:</span>
                  <span className="font-bold text-slate-800">₹{recalcSummary.openingBalance.toFixed(2)}</span>
                </div>
                <div className="flex justify-between text-rose-600">
                  <span>Total Debit (+Dr):</span>
                  <span className="font-bold">₹{recalcSummary.totalDebit.toFixed(2)}</span>
                </div>
                <div className="flex justify-between text-emerald-600">
                  <span>Total Credit (-Cr):</span>
                  <span className="font-bold">₹{recalcSummary.totalCredit.toFixed(2)}</span>
                </div>
                <div className="flex justify-between text-slate-500 text-[10.5px]">
                  <span>Total Entries Processed:</span>
                  <span className="font-bold">{recalcSummary.transactionCount} vouchers</span>
                </div>
                <div className="flex justify-between font-bold text-slate-900 border-t border-slate-200 pt-1.5 text-xs">
                  <span>Net Ledger Balance:</span>
                  <span className={recalcSummary.currentDue > 0 ? "text-rose-600" : recalcSummary.currentDue < 0 ? "text-emerald-600" : "text-slate-900"}>
                    ₹{Math.abs(recalcSummary.currentDue).toFixed(2)} {recalcSummary.currentDue > 0 ? 'DR' : recalcSummary.currentDue < 0 ? 'CR' : ''}
                  </span>
                </div>
              </div>

              <div className="p-2 bg-emerald-50 border border-emerald-200 rounded-md text-[11px] text-emerald-800 flex items-center gap-1.5">
                <Check size={13} className="text-emerald-600 shrink-0" />
                <span>Running balances and dashboard summaries are in 100% sync.</span>
              </div>

              <div className="pt-2 flex justify-end">
                <button
                  type="button"
                  onClick={() => setRecalcSummary(null)}
                  className="w-full py-2 bg-slate-900 hover:bg-slate-800 text-white font-bold rounded-lg text-xs transition"
                >
                  Done
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

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
