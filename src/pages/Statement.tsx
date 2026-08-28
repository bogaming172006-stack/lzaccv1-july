import React, { useState, useEffect, useMemo, useRef } from 'react';
import { db, collection, getDocs } from '../firebase';
import { Party, Transaction, Ledger, LEDGER_TYPE_LABELS } from '../types';
import { useLedger } from '../LedgerContext';
import { useAuth } from '../AuthContext';
import { format, startOfWeek, endOfWeek, startOfMonth, endOfMonth, subMonths, startOfYear, endOfYear, parseISO, isWithinInterval } from 'date-fns';
import { 
  FileSpreadsheet, 
  Download, 
  Printer, 
  Calendar, 
  Filter, 
  Search, 
  RefreshCw, 
  ArrowRight, 
  TrendingUp, 
  TrendingDown, 
  DollarSign, 
  Building2, 
  User as UserIcon, 
  FileText, 
  Layers, 
  CheckCircle2,
  SlidersHorizontal,
  ChevronDown,
  X,
  CreditCard,
  Hash,
  BookOpen
} from 'lucide-react';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import * as XLSX from 'xlsx';
import PageHeader from '../components/ui/PageHeader';
import StatCard from '../components/ui/StatCard';
import AmountDisplay from '../components/ui/AmountDisplay';
import Badge from '../components/ui/Badge';
import { Card } from '../components/ui/Card';
import TransactionDetailModal from '../components/TransactionDetailModal';

type DatePreset = 'today' | 'yesterday' | 'this_week' | 'this_month' | 'last_month' | 'this_quarter' | 'this_year' | 'all_time' | 'custom';

export default function Statement() {
  const { ledgers, activeLedger } = useLedger();
  const { currentUser } = useAuth();

  // Raw Database Data
  const [parties, setParties] = useState<Record<string, Party>>({});
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Filters State
  const [datePreset, setDatePreset] = useState<DatePreset>('this_month');
  const [startDate, setStartDate] = useState<string>(format(startOfMonth(new Date()), 'yyyy-MM-dd'));
  const [endDate, setEndDate] = useState<string>(format(endOfMonth(new Date()), 'yyyy-MM-dd'));
  
  const [selectedLedgerId, setSelectedLedgerId] = useState<string>('ACTIVE'); // 'ALL' | 'ACTIVE' | specific ledger id
  const [selectedPartyId, setSelectedPartyId] = useState<string>('ALL'); // 'ALL' | specific party id
  const [partySearch, setPartySearch] = useState<string>('');
  const [showPartyDropdown, setShowPartyDropdown] = useState<boolean>(false);
  
  const [txTypeFilter, setTxTypeFilter] = useState<'ALL' | 'DEBIT' | 'CREDIT'>('ALL');
  const [paymentModeFilter, setPaymentModeFilter] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [minAmount, setMinAmount] = useState<string>('');
  const [maxAmount, setMaxAmount] = useState<string>('');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc'); // asc = chronological from opening to closing
  
  // Selected detail modal
  const [selectedDetailTx, setSelectedDetailTx] = useState<Transaction | null>(null);
  const [isExportingPdf, setIsExportingPdf] = useState(false);
  const [isExportingExcel, setIsExportingExcel] = useState(false);
  const [isExportingCsv, setIsExportingCsv] = useState(false);

  const partyDropdownRef = useRef<HTMLDivElement>(null);

  // Fetch all initial data
  const fetchData = async () => {
    setIsLoading(true);
    try {
      const partiesSnap = await getDocs(collection(db, 'parties'));
      const partiesMap: Record<string, Party> = {};
      partiesSnap.docs.forEach(doc => {
        if (doc.exists()) {
          const p = doc.data() as Party;
          partiesMap[p.id] = p;
        }
      });
      setParties(partiesMap);

      const txSnap = await getDocs(collection(db, 'transactions'));
      const txList: Transaction[] = [];
      txSnap.docs.forEach(doc => {
        if (doc.exists()) {
          txList.push(doc.data() as Transaction);
        }
      });
      setTransactions(txList);
    } catch (err) {
      console.error("Failed to fetch statement data:", err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchData();

    const handleSync = () => {
      fetchData();
    };
    window.addEventListener('database-synced', handleSync);
    return () => {
      window.removeEventListener('database-synced', handleSync);
    };
  }, []);

  // Close party dropdown on click outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (partyDropdownRef.current && !partyDropdownRef.current.contains(event.target as Node)) {
        setShowPartyDropdown(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Handle Date Preset Changes
  const handlePresetChange = (preset: DatePreset) => {
    setDatePreset(preset);
    const now = new Date();
    
    switch (preset) {
      case 'today':
        setStartDate(format(now, 'yyyy-MM-dd'));
        setEndDate(format(now, 'yyyy-MM-dd'));
        break;
      case 'yesterday': {
        const yesterday = new Date();
        yesterday.setDate(now.getDate() - 1);
        setStartDate(format(yesterday, 'yyyy-MM-dd'));
        setEndDate(format(yesterday, 'yyyy-MM-dd'));
        break;
      }
      case 'this_week':
        setStartDate(format(startOfWeek(now, { weekStartsOn: 1 }), 'yyyy-MM-dd'));
        setEndDate(format(endOfWeek(now, { weekStartsOn: 1 }), 'yyyy-MM-dd'));
        break;
      case 'this_month':
        setStartDate(format(startOfMonth(now), 'yyyy-MM-dd'));
        setEndDate(format(endOfMonth(now), 'yyyy-MM-dd'));
        break;
      case 'last_month': {
        const lastMonth = subMonths(now, 1);
        setStartDate(format(startOfMonth(lastMonth), 'yyyy-MM-dd'));
        setEndDate(format(endOfMonth(lastMonth), 'yyyy-MM-dd'));
        break;
      }
      case 'this_quarter': {
        const currentMonth = now.getMonth();
        const quarterStartMonth = Math.floor(currentMonth / 3) * 3;
        const qStart = new Date(now.getFullYear(), quarterStartMonth, 1);
        const qEnd = new Date(now.getFullYear(), quarterStartMonth + 3, 0);
        setStartDate(format(qStart, 'yyyy-MM-dd'));
        setEndDate(format(qEnd, 'yyyy-MM-dd'));
        break;
      }
      case 'this_year':
        setStartDate(format(startOfYear(now), 'yyyy-MM-dd'));
        setEndDate(format(endOfYear(now), 'yyyy-MM-dd'));
        break;
      case 'all_time':
        setStartDate('2020-01-01');
        setEndDate(format(now, 'yyyy-MM-dd'));
        break;
      case 'custom':
        // Keep existing start/end date
        break;
    }
  };

  // Determine current effective Ledger ID
  const effectiveLedgerId = selectedLedgerId === 'ACTIVE' 
    ? (activeLedger?.id || 'ALL') 
    : selectedLedgerId;

  // List of parties filtered by ledger
  const availableParties = useMemo(() => {
    return (Object.values(parties) as Party[]).filter(p => {
      if (effectiveLedgerId !== 'ALL' && p.ledgerId !== effectiveLedgerId) return false;
      return true;
    }).sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  }, [parties, effectiveLedgerId]);

  // Selected party object
  const selectedParty = selectedPartyId !== 'ALL' ? parties[selectedPartyId] || null : null;

  // Calculate opening balance, filtered transactions, and running balances
  const statementData = useMemo(() => {
    if (!startDate || !endDate) {
      return {
        openingBalance: 0,
        periodDebits: 0,
        periodCredits: 0,
        netMovement: 0,
        closingBalance: 0,
        rows: []
      };
    }

    const startTimestamp = new Date(`${startDate}T00:00:00.000`).getTime();
    const endTimestamp = new Date(`${endDate}T23:59:59.999`).getTime();

    // 1. Calculate Prior Opening Balance
    // Sum of prior transactions before startTimestamp + Party base openingBalance (if specific party)
    let initialOpening = 0;
    if (selectedPartyId !== 'ALL' && selectedParty) {
      initialOpening += selectedParty.openingBalance || 0;
    } else if (effectiveLedgerId !== 'ALL') {
      // Sum of opening balances of all parties in this ledger
      initialOpening += availableParties.reduce((sum, p) => sum + (p.openingBalance || 0), 0);
    } else {
      // All parties across all ledgers
      initialOpening += (Object.values(parties) as Party[]).reduce((sum, p) => sum + (p.openingBalance || 0), 0);
    }

    // Accumulate all transactions prior to startDate to get accurate historical opening balance
    transactions.forEach(tx => {
      if (tx.timestamp < startTimestamp) {
        // Check ledger filter
        if (effectiveLedgerId !== 'ALL' && tx.ledgerId !== effectiveLedgerId) return;
        // Check party filter
        if (selectedPartyId !== 'ALL' && tx.partyId !== selectedPartyId) return;

        if (tx.type === 'DEBIT') {
          initialOpening += tx.amount || 0;
        } else {
          initialOpening -= tx.amount || 0;
        }
      }
    });

    // 2. Filter Transactions within the Period
    const filteredPeriodTx = transactions.filter(tx => {
      // Timestamp range
      if (tx.timestamp < startTimestamp || tx.timestamp > endTimestamp) return;

      // Ledger filter
      if (effectiveLedgerId !== 'ALL' && tx.ledgerId !== effectiveLedgerId) return false;

      // Party filter
      if (selectedPartyId !== 'ALL' && tx.partyId !== selectedPartyId) return false;

      // Tx Type filter
      if (txTypeFilter !== 'ALL' && tx.type !== txTypeFilter) return false;

      // Payment Mode filter
      if (paymentModeFilter !== 'ALL') {
        const mode = (tx.paymentMode || 'CASH').toUpperCase();
        if (paymentModeFilter === 'CASH' && mode !== 'CASH') return false;
        if (paymentModeFilter === 'BANK' && !['BANK', 'ONLINE', 'UPI', 'CHEQUE'].includes(mode)) return false;
        if (paymentModeFilter === 'DISCOUNT' && !['DISCOUNT', 'ADJUSTMENT'].includes(mode)) return false;
      }

      // Min/Max Amount filter
      if (minAmount && tx.amount < parseFloat(minAmount)) return false;
      if (maxAmount && tx.amount > parseFloat(maxAmount)) return false;

      // Search query (invoice #, notes, party name)
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const partyName = (parties[tx.partyId]?.name || '').toLowerCase();
        const invoiceNo = (tx.invoiceNo || '').toLowerCase();
        const notes = (tx.notes || '').toLowerCase();
        const matches = partyName.includes(q) || invoiceNo.includes(q) || notes.includes(q);
        if (!matches) return false;
      }

      return true;
    });

    // Sort strictly chronological ascending for running balance calculation
    filteredPeriodTx.sort((a, b) => a.timestamp - b.timestamp);

    let runningBalance = initialOpening;
    let periodDebits = 0;
    let periodCredits = 0;

    const rows = filteredPeriodTx.map((tx, index) => {
      const isDebit = tx.type === 'DEBIT';
      const debitAmt = isDebit ? tx.amount : 0;
      const creditAmt = !isDebit ? tx.amount : 0;

      if (isDebit) {
        runningBalance += tx.amount;
        periodDebits += tx.amount;
      } else {
        runningBalance -= tx.amount;
        periodCredits += tx.amount;
      }

      const party = parties[tx.partyId];
      const ledgerObj = ledgers.find(l => l.id === tx.ledgerId);

      return {
        id: tx.id,
        index: index + 1,
        rawTx: tx,
        timestamp: tx.timestamp,
        dateFormatted: format(new Date(tx.timestamp), 'dd/MM/yyyy'),
        timeFormatted: format(new Date(tx.timestamp), 'hh:mm a'),
        partyName: party?.name || 'Unknown Party',
        partyPhone: party?.phone || '',
        invoiceNo: tx.invoiceNo || '-',
        type: tx.type,
        ledgerName: ledgerObj?.name || 'Main Ledger',
        paymentMode: tx.paymentMode || (isDebit ? 'Invoice / Bill' : 'Cash'),
        notes: tx.notes || '',
        debit: debitAmt,
        credit: creditAmt,
        runningBalance: runningBalance
      };
    });

    // If user prefers descending view on screen, we can flip rows, but running balances remain accurate
    const finalDisplayRows = sortOrder === 'desc' ? [...rows].reverse() : rows;

    return {
      openingBalance: initialOpening,
      periodDebits,
      periodCredits,
      netMovement: periodDebits - periodCredits,
      closingBalance: runningBalance,
      rows: finalDisplayRows
    };
  }, [
    startDate,
    endDate,
    transactions,
    parties,
    ledgers,
    effectiveLedgerId,
    selectedPartyId,
    selectedParty,
    availableParties,
    txTypeFilter,
    paymentModeFilter,
    minAmount,
    maxAmount,
    searchQuery,
    sortOrder
  ]);

  // Format currency
  const formatCurrency = (val: number) => {
    return `₹${Math.abs(val).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  };

  // 1. Export CSV Handler
  const handleExportCsv = () => {
    setIsExportingCsv(true);
    try {
      const activeLedgerName = ledgers.find(l => l.id === effectiveLedgerId)?.name || 'Consolidated Ledgers';
      const entityName = selectedParty ? selectedParty.name : `All Parties (${activeLedgerName})`;

      const csvRows: string[][] = [
        ['GREENZAR FOOD & BEVERAGE ERP - ACCOUNT STATEMENT'],
        [`Entity / Account:`, entityName],
        [`Period:`, `${startDate} to ${endDate}`],
        [`Generated On:`, format(new Date(), 'dd-MMM-yyyy hh:mm a')],
        [`Generated By:`, currentUser?.name || 'System Operator'],
        [''],
        [`Opening Balance (as of ${startDate}):`, String(statementData.openingBalance), statementData.openingBalance >= 0 ? 'Dr (Due)' : 'Cr (Advance)'],
        [`Total Period Debits:`, String(statementData.periodDebits)],
        [`Total Period Credits:`, String(statementData.periodCredits)],
        [`Net Movement:`, String(statementData.netMovement)],
        [`Closing Balance (as of ${endDate}):`, String(statementData.closingBalance), statementData.closingBalance >= 0 ? 'Dr (Due)' : 'Cr (Advance)'],
        [''],
        ['Sr #', 'Date', 'Time', 'Particulars / Party', 'Voucher / Invoice #', 'Ledger Book', 'Payment Mode', 'Debit (Rs)', 'Credit (Rs)', 'Running Balance (Rs)', 'Remarks / Notes']
      ];

      statementData.rows.forEach((r, idx) => {
        csvRows.push([
          String(idx + 1),
          r.dateFormatted,
          r.timeFormatted,
          `"${r.partyName.replace(/"/g, '""')}"`,
          `"${r.invoiceNo.replace(/"/g, '""')}"`,
          `"${r.ledgerName.replace(/"/g, '""')}"`,
          r.paymentMode,
          r.debit > 0 ? r.debit.toFixed(2) : '0.00',
          r.credit > 0 ? r.credit.toFixed(2) : '0.00',
          r.runningBalance.toFixed(2),
          `"${r.notes.replace(/"/g, '""')}"`
        ]);
      });

      // Total Row
      csvRows.push([
        'TOTAL',
        '',
        '',
        '',
        '',
        '',
        '',
        statementData.periodDebits.toFixed(2),
        statementData.periodCredits.toFixed(2),
        statementData.closingBalance.toFixed(2),
        ''
      ]);

      const csvContent = "\uFEFF" + csvRows.map(e => e.join(",")).join("\n");
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.setAttribute("href", url);
      link.setAttribute("download", `Statement_${entityName.replace(/[^a-zA-Z0-9]/g, '_')}_${startDate}_to_${endDate}.csv`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch (err) {
      console.error("CSV Export failed:", err);
      alert("Failed to export CSV. Please check browser permissions.");
    } finally {
      setIsExportingCsv(false);
    }
  };

  // 2. Export Excel (.xlsx) Handler
  const handleExportExcel = () => {
    setIsExportingExcel(true);
    try {
      const activeLedgerName = ledgers.find(l => l.id === effectiveLedgerId)?.name || 'Consolidated Ledgers';
      const entityName = selectedParty ? selectedParty.name : `All Parties (${activeLedgerName})`;

      const worksheetData = [
        ['GREENZAR FOOD & BEVERAGE ERP'],
        ['STATEMENT OF ACCOUNT / FINANCIAL LEDGER'],
        [],
        ['Entity / Account Name:', entityName],
        ['Ledger Book:', activeLedgerName],
        ['Period Range:', `From ${startDate} to ${endDate}`],
        ['Generated Date:', format(new Date(), 'dd-MMM-yyyy hh:mm a')],
        ['Generated By:', currentUser?.name || 'Operator'],
        [],
        ['Opening Balance:', statementData.openingBalance, statementData.openingBalance >= 0 ? 'Dr (Receivable)' : 'Cr (Advance)'],
        ['Total Period Debits (Sales/Charges):', statementData.periodDebits],
        ['Total Period Credits (Receipts/Payments):', statementData.periodCredits],
        ['Net Period Movement:', statementData.netMovement],
        ['Closing Balance:', statementData.closingBalance, statementData.closingBalance >= 0 ? 'Dr (Receivable)' : 'Cr (Advance)'],
        [],
        ['Sr #', 'Date', 'Time', 'Particulars / Party', 'Voucher / Invoice #', 'Ledger', 'Payment Mode', 'Debit (Rs)', 'Credit (Rs)', 'Running Balance (Rs)', 'Notes']
      ];

      statementData.rows.forEach((r, idx) => {
        worksheetData.push([
          idx + 1,
          r.dateFormatted,
          r.timeFormatted,
          r.partyName,
          r.invoiceNo,
          r.ledgerName,
          r.paymentMode,
          r.debit,
          r.credit,
          r.runningBalance,
          r.notes
        ]);
      });

      // Total Row
      worksheetData.push([
        'TOTALS',
        '',
        '',
        '',
        '',
        '',
        '',
        statementData.periodDebits,
        statementData.periodCredits,
        statementData.closingBalance,
        ''
      ]);

      const ws = XLSX.utils.aoa_to_sheet(worksheetData);
      
      // Auto-fit column widths
      ws['!cols'] = [
        { wch: 6 },
        { wch: 12 },
        { wch: 10 },
        { wch: 28 },
        { wch: 18 },
        { wch: 18 },
        { wch: 14 },
        { wch: 14 },
        { wch: 14 },
        { wch: 18 },
        { wch: 30 }
      ];

      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Account Statement');

      XLSX.writeFile(wb, `Statement_${entityName.replace(/[^a-zA-Z0-9]/g, '_')}_${startDate}_to_${endDate}.xlsx`);
    } catch (err) {
      console.error("Excel Export failed:", err);
      alert("Failed to export Excel file.");
    } finally {
      setIsExportingExcel(false);
    }
  };

  // 3. Export PDF Handler
  const handleExportPdf = () => {
    setIsExportingPdf(true);
    try {
      const doc = new jsPDF({
        orientation: 'portrait',
        unit: 'mm',
        format: 'a4'
      });

      const activeLedgerName = ledgers.find(l => l.id === effectiveLedgerId)?.name || 'Consolidated Ledgers';
      const entityName = selectedParty ? selectedParty.name : `Consolidated Statement (${activeLedgerName})`;

      // Header Banner
      doc.setFillColor(0, 85, 165); // #0055a5 brand blue
      doc.rect(0, 0, 210, 22, 'F');

      doc.setTextColor(255, 255, 255);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(14);
      doc.text('GREENZAR FOOD & BEVERAGE ERP', 14, 10);
      doc.setFontSize(8.5);
      doc.setFont('helvetica', 'normal');
      doc.text('Official Account Statement & Ledger Report', 14, 16);

      doc.setFont('helvetica', 'bold');
      doc.text(`DATE: ${format(new Date(), 'dd-MMM-yyyy')}`, 196, 10, { align: 'right' });
      doc.setFont('helvetica', 'normal');
      doc.text(`TIME: ${format(new Date(), 'hh:mm a')}`, 196, 16, { align: 'right' });

      // Statement Entity & Metadata Box
      doc.setTextColor(30, 41, 59);
      doc.setFontSize(11);
      doc.setFont('helvetica', 'bold');
      doc.text(`STATEMENT FOR: ${entityName.toUpperCase()}`, 14, 30);

      doc.setFontSize(8.5);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(71, 85, 105);
      
      if (selectedParty) {
        if (selectedParty.phone) doc.text(`Phone: ${selectedParty.phone}`, 14, 35);
        if (selectedParty.address) doc.text(`Address: ${selectedParty.address}`, 14, 39);
      } else {
        doc.text(`Ledger Book: ${activeLedgerName}`, 14, 35);
      }

      doc.setFont('helvetica', 'bold');
      doc.setTextColor(15, 23, 42);
      doc.text(`Statement Period: ${startDate} to ${endDate}`, 196, 30, { align: 'right' });
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(71, 85, 105);
      doc.text(`Generated by: ${currentUser?.name || 'Authorized Operator'}`, 196, 35, { align: 'right' });

      // Summary Table Box
      const summaryBody = [
        [
          `Opening Balance: Rs. ${statementData.openingBalance.toFixed(2)} ${statementData.openingBalance >= 0 ? 'Dr' : 'Cr'}`,
          `Total Debits: Rs. ${statementData.periodDebits.toFixed(2)}`,
          `Total Credits: Rs. ${statementData.periodCredits.toFixed(2)}`,
          `Closing Balance: Rs. ${statementData.closingBalance.toFixed(2)} ${statementData.closingBalance >= 0 ? 'Dr' : 'Cr'}`
        ]
      ];

      autoTable(doc, {
        startY: selectedParty && selectedParty.address ? 44 : 41,
        head: [['Summary Metrics for Selected Period', '', '', '']],
        body: summaryBody,
        theme: 'grid',
        headStyles: {
          fillColor: [241, 245, 249],
          textColor: [15, 23, 42],
          fontSize: 7.5,
          fontStyle: 'bold'
        },
        bodyStyles: {
          fontSize: 8,
          fontStyle: 'bold',
          textColor: [15, 23, 42],
          fillColor: [248, 250, 252]
        },
        margin: { left: 14, right: 14 }
      });

      // Transaction Rows
      const tableData = statementData.rows.map((r, i) => [
        String(i + 1),
        r.dateFormatted,
        selectedParty ? r.paymentMode : `${r.partyName}\n(${r.paymentMode})`,
        r.invoiceNo,
        r.debit > 0 ? r.debit.toFixed(2) : '-',
        r.credit > 0 ? r.credit.toFixed(2) : '-',
        `${r.runningBalance.toFixed(2)} ${r.runningBalance >= 0 ? 'Dr' : 'Cr'}`
      ]);

      // Add Total Row
      tableData.push([
        '',
        'TOTALS',
        '',
        '',
        statementData.periodDebits.toFixed(2),
        statementData.periodCredits.toFixed(2),
        `${statementData.closingBalance.toFixed(2)} ${statementData.closingBalance >= 0 ? 'Dr' : 'Cr'}`
      ]);

      const lastAutoTable = (doc as any).lastAutoTable;
      const startY = (lastAutoTable ? lastAutoTable.finalY : 55) + 4;

      autoTable(doc, {
        startY: startY,
        head: [['#', 'Date', 'Particulars / Mode', 'Inv #', 'Debit (Rs)', 'Credit (Rs)', 'Balance (Rs)']],
        body: tableData,
        theme: 'striped',
        headStyles: {
          fillColor: [0, 85, 165],
          textColor: [255, 255, 255],
          fontSize: 8,
          fontStyle: 'bold',
          halign: 'left'
        },
        columnStyles: {
          0: { cellWidth: 8, halign: 'center' },
          1: { cellWidth: 20 },
          2: { cellWidth: 'auto' },
          3: { cellWidth: 22 },
          4: { cellWidth: 24, halign: 'right', textColor: [185, 28, 28] }, // Red for debit
          5: { cellWidth: 24, halign: 'right', textColor: [21, 128, 61] }, // Green for credit
          6: { cellWidth: 28, halign: 'right', fontStyle: 'bold' }
        },
        styles: {
          fontSize: 7.5,
          cellPadding: 2,
          overflow: 'linebreak'
        },
        margin: { left: 14, right: 14, bottom: 20 },
        didParseCell: function(data) {
          // Style total row
          if (data.row.index === tableData.length - 1) {
            data.cell.styles.fontStyle = 'bold';
            data.cell.styles.fillColor = [226, 232, 240];
            data.cell.styles.textColor = [15, 23, 42];
          }
        },
        didDrawPage: function(data) {
          // Footer
          const str = `Page ${data.pageNumber} of ${doc.getNumberOfPages()}`;
          doc.setFontSize(7.5);
          doc.setTextColor(148, 163, 184);
          doc.text(str, 196, 290, { align: 'right' });
          doc.text('Greenzar ERP - Computer Generated Authentic Statement', 14, 290);
        }
      });

      // Signature line on last page
      const finalY = (doc as any).lastAutoTable.finalY + 12;
      if (finalY < 270) {
        doc.setFontSize(8);
        doc.setTextColor(100, 116, 139);
        doc.text('_____________________________', 150, finalY);
        doc.text('Authorized Signatory', 158, finalY + 5);
      }

      doc.save(`Statement_${entityName.replace(/[^a-zA-Z0-9]/g, '_')}_${startDate}_to_${endDate}.pdf`);
    } catch (err) {
      console.error("PDF Export failed:", err);
      alert("Failed to export PDF statement.");
    } finally {
      setIsExportingPdf(false);
    }
  };

  // Direct Print View Trigger
  const handlePrint = () => {
    window.print();
  };

  return (
    <div className="p-3 sm:p-6 max-w-[1600px] mx-auto space-y-5 print:p-0 print:m-0 print:max-w-none">
      
      {/* ── Transaction Detail Modal ── */}
      {selectedDetailTx && (
        <TransactionDetailModal
          isOpen={!!selectedDetailTx}
          transaction={selectedDetailTx}
          partyName={parties[selectedDetailTx.partyId]?.name || 'Unknown'}
          ledgerName={ledgers.find(l => l.id === selectedDetailTx.ledgerId)?.name}
          ledgerType={ledgers.find(l => l.id === selectedDetailTx.ledgerId)?.type}
          isAdmin={currentUser?.isAdmin}
          onClose={() => setSelectedDetailTx(null)}
        />
      )}

      {/* ── Page Header ── */}
      <div className="print:hidden">
        <PageHeader
          title="Account Statements & Ledger Reports"
          subtitle="Generate custom date-range statements, day-to-day/month-to-month reports, and export 100% accurate CSV, Excel & PDF statements."
          badge="Audit & Financial Reports"
          actions={
            <div className="flex items-center gap-2 flex-wrap">
              <button
                type="button"
                onClick={fetchData}
                disabled={isLoading}
                className="px-3 py-2 bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 text-xs font-semibold rounded-lg shadow-2xs flex items-center gap-1.5 transition-colors cursor-pointer"
                title="Refresh latest database records"
              >
                <RefreshCw size={14} className={isLoading ? "animate-spin text-blue-600" : "text-slate-500"} />
                <span className="hidden sm:inline">Refresh</span>
              </button>

              <button
                type="button"
                onClick={handlePrint}
                className="px-3 py-2 bg-slate-800 hover:bg-slate-900 text-white text-xs font-semibold rounded-lg shadow-2xs flex items-center gap-1.5 transition-colors cursor-pointer"
              >
                <Printer size={14} />
                <span>Print</span>
              </button>

              <button
                type="button"
                onClick={handleExportCsv}
                disabled={isExportingCsv || statementData.rows.length === 0}
                className="px-3 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-xs font-semibold rounded-lg shadow-2xs flex items-center gap-1.5 transition-colors cursor-pointer"
              >
                <Download size={14} />
                <span>CSV</span>
              </button>

              <button
                type="button"
                onClick={handleExportExcel}
                disabled={isExportingExcel || statementData.rows.length === 0}
                className="px-3 py-2 bg-teal-600 hover:bg-teal-700 disabled:opacity-50 text-white text-xs font-semibold rounded-lg shadow-2xs flex items-center gap-1.5 transition-colors cursor-pointer"
              >
                <FileSpreadsheet size={14} />
                <span>Excel</span>
              </button>

              <button
                type="button"
                onClick={handleExportPdf}
                disabled={isExportingPdf || statementData.rows.length === 0}
                className="px-3 py-2 bg-[#0055a5] hover:bg-blue-700 disabled:opacity-50 text-white text-xs font-bold rounded-lg shadow-2xs flex items-center gap-1.5 transition-colors cursor-pointer"
              >
                <FileText size={14} />
                <span>{isExportingPdf ? 'Generating PDF...' : 'Download PDF'}</span>
              </button>
            </div>
          }
        />
      </div>

      {/* ── Filters & Configuration Control Bar ── */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-2xs p-4 sm:p-5 space-y-4 print:hidden">
        
        {/* Preset Date Range Buttons */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-bold text-slate-700 uppercase tracking-wider flex items-center gap-1.5">
              <Calendar size={14} className="text-[#0055a5]" />
              Date Presets & Period
            </span>
            <span className="text-[11px] text-slate-400">Select standard duration or pick custom dates</span>
          </div>

          <div className="flex items-center gap-1.5 overflow-x-auto pb-1 custom-scrollbar">
            {[
              { key: 'today', label: 'Today' },
              { key: 'yesterday', label: 'Yesterday' },
              { key: 'this_week', label: 'This Week' },
              { key: 'this_month', label: 'This Month' },
              { key: 'last_month', label: 'Last Month' },
              { key: 'this_quarter', label: 'This Quarter' },
              { key: 'this_year', label: 'This Year' },
              { key: 'all_time', label: 'All Time' }
            ].map((p) => (
              <button
                key={p.key}
                type="button"
                onClick={() => handlePresetChange(p.key as DatePreset)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-all cursor-pointer ${
                  datePreset === p.key
                    ? 'bg-[#0055a5] text-white shadow-xs'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200 hover:text-slate-900'
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>

        {/* Date Inputs & Primary Selectors */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 pt-2 border-t border-slate-100">
          
          {/* Start Date */}
          <div>
            <label className="block text-[11px] font-bold text-slate-600 uppercase tracking-wider mb-1">
              Start Date (From)
            </label>
            <input
              type="date"
              value={startDate}
              onChange={(e) => {
                setStartDate(e.target.value);
                setDatePreset('custom');
              }}
              className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg text-xs font-semibold text-slate-800 focus:border-[#0055a5] focus:bg-white focus:outline-none transition-colors"
            />
          </div>

          {/* End Date */}
          <div>
            <label className="block text-[11px] font-bold text-slate-600 uppercase tracking-wider mb-1">
              End Date (To)
            </label>
            <input
              type="date"
              value={endDate}
              onChange={(e) => {
                setEndDate(e.target.value);
                setDatePreset('custom');
              }}
              className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg text-xs font-semibold text-slate-800 focus:border-[#0055a5] focus:bg-white focus:outline-none transition-colors"
            />
          </div>

          {/* Ledger Book Selector */}
          <div>
            <label className="block text-[11px] font-bold text-slate-600 uppercase tracking-wider mb-1">
              Ledger Book
            </label>
            <select
              value={selectedLedgerId}
              onChange={(e) => {
                setSelectedLedgerId(e.target.value);
                setSelectedPartyId('ALL');
              }}
              className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg text-xs font-semibold text-slate-800 focus:border-[#0055a5] focus:bg-white focus:outline-none transition-colors"
            >
              <option value="ACTIVE">Current Ledger: {activeLedger?.name || 'Active'}</option>
              <option value="ALL">All Combined Ledgers (Consolidated)</option>
              {ledgers.map(l => (
                <option key={l.id} value={l.id}>{l.name} ({LEDGER_TYPE_LABELS[l.type] || l.type})</option>
              ))}
            </select>
          </div>

          {/* Account / Party Autocomplete Selector */}
          <div className="relative" ref={partyDropdownRef}>
            <label className="block text-[11px] font-bold text-slate-600 uppercase tracking-wider mb-1 flex items-center justify-between">
              <span>Party / Account</span>
              {selectedPartyId !== 'ALL' && (
                <button
                  type="button"
                  onClick={() => { setSelectedPartyId('ALL'); setPartySearch(''); }}
                  className="text-[10px] text-rose-600 hover:underline font-bold"
                >
                  Clear Selection
                </button>
              )}
            </label>
            
            <div 
              onClick={() => setShowPartyDropdown(true)}
              className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg text-xs font-semibold text-slate-800 flex items-center justify-between cursor-pointer hover:border-slate-400 transition-colors"
            >
              <span className="truncate">
                {selectedParty ? selectedParty.name : `All Parties (${availableParties.length})`}
              </span>
              <ChevronDown size={14} className="text-slate-400 shrink-0 ml-1" />
            </div>

            {/* Dropdown Menu */}
            {showPartyDropdown && (
              <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-slate-200 rounded-xl shadow-xl z-50 p-2 space-y-1.5 animate-in fade-in duration-100">
                <div className="relative">
                  <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    type="text"
                    value={partySearch}
                    onChange={(e) => setPartySearch(e.target.value)}
                    placeholder="Search party name or phone..."
                    className="w-full pl-8 pr-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg text-slate-800 placeholder:text-slate-400 focus:outline-none focus:border-blue-600"
                    autoFocus
                  />
                </div>

                <div className="max-h-48 overflow-y-auto space-y-0.5 custom-scrollbar">
                  <button
                    type="button"
                    onClick={() => { setSelectedPartyId('ALL'); setShowPartyDropdown(false); }}
                    className={`w-full text-left px-2.5 py-1.5 text-xs rounded-lg flex items-center justify-between ${
                      selectedPartyId === 'ALL' ? 'bg-[#0055a5] text-white font-bold' : 'hover:bg-slate-100 text-slate-700'
                    }`}
                  >
                    <span>All Parties (Consolidated)</span>
                    <span className="text-[10px] opacity-75">{availableParties.length} total</span>
                  </button>

                  {availableParties
                    .filter(p => (p.name || '').toLowerCase().includes(partySearch.toLowerCase()) || (p.phone || '').includes(partySearch))
                    .map(p => (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => { setSelectedPartyId(p.id); setShowPartyDropdown(false); }}
                        className={`w-full text-left px-2.5 py-1.5 text-xs rounded-lg flex items-center justify-between ${
                          selectedPartyId === p.id ? 'bg-[#0055a5] text-white font-bold' : 'hover:bg-slate-100 text-slate-700'
                        }`}
                      >
                        <span className="truncate font-medium">{p.name}</span>
                        <span className={`text-[10px] font-mono shrink-0 ml-2 ${selectedPartyId === p.id ? 'text-white' : (p.currentDue || 0) >= 0 ? 'text-rose-600' : 'text-emerald-600'}`}>
                          ₹{Math.abs(p.currentDue || 0).toLocaleString()} {(p.currentDue || 0) >= 0 ? 'Dr' : 'Cr'}
                        </span>
                      </button>
                    ))}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Secondary Detailed Filters Row */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 pt-2 border-t border-slate-100">
          
          {/* Movement Type */}
          <div>
            <label className="block text-[11px] font-bold text-slate-600 uppercase tracking-wider mb-1">
              Transaction Type
            </label>
            <select
              value={txTypeFilter}
              onChange={(e) => setTxTypeFilter(e.target.value as any)}
              className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg text-xs font-semibold text-slate-800 focus:border-[#0055a5] focus:bg-white focus:outline-none transition-colors"
            >
              <option value="ALL">All Entries (Debits & Credits)</option>
              <option value="DEBIT">Debits Only (Sales / Charges / Outgoing)</option>
              <option value="CREDIT">Credits Only (Receipts / Collections / Payments)</option>
            </select>
          </div>

          {/* Payment Mode */}
          <div>
            <label className="block text-[11px] font-bold text-slate-600 uppercase tracking-wider mb-1">
              Payment / Voucher Mode
            </label>
            <select
              value={paymentModeFilter}
              onChange={(e) => setPaymentModeFilter(e.target.value)}
              className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg text-xs font-semibold text-slate-800 focus:border-[#0055a5] focus:bg-white focus:outline-none transition-colors"
            >
              <option value="ALL">All Payment Modes</option>
              <option value="CASH">Cash Only</option>
              <option value="BANK">Bank / Online / UPI / Cheque</option>
              <option value="DISCOUNT">Discount / Adjustments</option>
            </select>
          </div>

          {/* Search Query */}
          <div>
            <label className="block text-[11px] font-bold text-slate-600 uppercase tracking-wider mb-1">
              Search Invoice / Memo
            </label>
            <div className="relative">
              <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Invoice #, note, bill..."
                className="w-full pl-8 pr-3 py-2 bg-slate-50 border border-slate-300 rounded-lg text-xs font-semibold text-slate-800 placeholder:text-slate-400 focus:border-[#0055a5] focus:bg-white focus:outline-none transition-colors"
              />
            </div>
          </div>

          {/* Sort Order */}
          <div>
            <label className="block text-[11px] font-bold text-slate-600 uppercase tracking-wider mb-1">
              Chronological Sort Order
            </label>
            <select
              value={sortOrder}
              onChange={(e) => setSortOrder(e.target.value as any)}
              className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg text-xs font-semibold text-slate-800 focus:border-[#0055a5] focus:bg-white focus:outline-none transition-colors"
            >
              <option value="asc">Earliest to Latest (Opening ➔ Closing)</option>
              <option value="desc">Latest to Earliest (Newest First)</option>
            </select>
          </div>

        </div>

      </div>

      {/* ── Printable Formal Statement Header (Shown on print / PDF preview) ── */}
      <div className="hidden print:block mb-6 text-slate-900 border-b-2 border-slate-800 pb-4">
        <div className="flex justify-between items-start">
          <div>
            <h1 className="text-2xl font-black uppercase tracking-wider text-[#0055a5]">Greenzar Food & Beverage ERP</h1>
            <p className="text-xs font-medium text-slate-600">Official Financial Ledger & Account Statement</p>
          </div>
          <div className="text-right text-xs">
            <p className="font-bold">Period: {startDate} to {endDate}</p>
            <p className="text-slate-500">Printed on: {format(new Date(), 'dd-MMM-yyyy hh:mm a')}</p>
          </div>
        </div>

        <div className="mt-3 pt-3 border-t border-slate-200 grid grid-cols-2 gap-4 text-xs">
          <div>
            <p className="font-bold uppercase text-slate-500 text-[10px]">Statement For</p>
            <p className="text-sm font-bold text-slate-900">{selectedParty ? selectedParty.name : 'All Consolidated Accounts'}</p>
            {selectedParty?.phone && <p className="text-slate-600">Phone: {selectedParty.phone}</p>}
            {selectedParty?.address && <p className="text-slate-600">Address: {selectedParty.address}</p>}
          </div>
          <div className="text-right">
            <p className="font-bold uppercase text-slate-500 text-[10px]">Ledger Scope</p>
            <p className="font-semibold text-slate-800">{ledgers.find(l => l.id === effectiveLedgerId)?.name || 'Consolidated Ledgers'}</p>
            <p className="text-slate-600">Generated by: {currentUser?.name || 'Administrator'}</p>
          </div>
        </div>
      </div>

      {/* ── Executive Summary KPI Cards ── */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        
        {/* 1. Opening Balance */}
        <StatCard
          title={`Opening Balance (${startDate})`}
          value={formatCurrency(statementData.openingBalance)}
          variant={statementData.openingBalance >= 0 ? "debit" : "credit"}
          icon={Calendar}
          subtitle={statementData.openingBalance >= 0 ? "Dr (Due Receivable)" : "Cr (Advance / Payable)"}
        />

        {/* 2. Period Debits */}
        <StatCard
          title="Total Debits (+)"
          value={formatCurrency(statementData.periodDebits)}
          variant="debit"
          icon={TrendingUp}
          subtitle={`${statementData.rows.filter(r => r.debit > 0).length} Debit Invoices/Bills`}
        />

        {/* 3. Period Credits */}
        <StatCard
          title="Total Credits (-)"
          value={formatCurrency(statementData.periodCredits)}
          variant="credit"
          icon={TrendingDown}
          subtitle={`${statementData.rows.filter(r => r.credit > 0).length} Credit Receipts`}
        />

        {/* 4. Net Movement */}
        <StatCard
          title="Net Period Movement"
          value={formatCurrency(statementData.netMovement)}
          variant="navy"
          icon={DollarSign}
          subtitle={statementData.netMovement >= 0 ? "Net Addition (+)" : "Net Reduction (-)"}
        />

        {/* 5. Closing Balance */}
        <StatCard
          title={`Closing Balance (${endDate})`}
          value={formatCurrency(statementData.closingBalance)}
          variant={statementData.closingBalance >= 0 ? "debit" : "credit"}
          icon={CheckCircle2}
          subtitle={statementData.closingBalance >= 0 ? "Dr (Closing Due)" : "Cr (Closing Advance)"}
        />

      </div>

      {/* ── Statement Ledger Movements Table ── */}
      <Card className="overflow-hidden shadow-2xs border-slate-200">
        
        {/* Table Header Bar */}
        <div className="px-4 py-3 bg-slate-50/80 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <BookOpen size={16} className="text-[#0055a5]" />
            <h2 className="text-xs sm:text-sm font-bold text-slate-900">
              Itemized Ledger Movement ({statementData.rows.length} records)
            </h2>
          </div>

          <div className="flex items-center gap-2 text-xs text-slate-500">
            <span>Period: <strong className="text-slate-800">{startDate}</strong> to <strong className="text-slate-800">{endDate}</strong></span>
          </div>
        </div>

        {/* Scrollable Table View */}
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="bg-slate-100/90 text-slate-700 font-bold uppercase tracking-wider text-[11px] border-b border-slate-200">
                <th className="py-2.5 px-3 text-center w-10">#</th>
                <th className="py-2.5 px-3">Date & Time</th>
                <th className="py-2.5 px-3">Particulars / Party</th>
                <th className="py-2.5 px-3">Voucher / Inv #</th>
                <th className="py-2.5 px-3">Ledger Book</th>
                <th className="py-2.5 px-3">Mode</th>
                <th className="py-2.5 px-3 text-right">Debit (Dr)</th>
                <th className="py-2.5 px-3 text-right">Credit (Cr)</th>
                <th className="py-2.5 px-3 text-right">Running Balance</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-slate-800">
              
              {/* Row 0: Opening Balance Marker */}
              <tr className="bg-amber-50/50 font-semibold border-b border-amber-100">
                <td className="py-2.5 px-3 text-center text-amber-700">★</td>
                <td className="py-2.5 px-3 text-amber-900">{startDate}</td>
                <td className="py-2.5 px-3 text-amber-900 font-bold" colSpan={4}>
                  OPENING BALANCE BROUGHT FORWARD
                </td>
                <td className="py-2.5 px-3 text-right text-slate-400">-</td>
                <td className="py-2.5 px-3 text-right text-slate-400">-</td>
                <td className="py-2.5 px-3 text-right font-mono font-bold text-slate-900">
                  <span className={statementData.openingBalance >= 0 ? "text-rose-700" : "text-emerald-700"}>
                    {formatCurrency(statementData.openingBalance)} {statementData.openingBalance >= 0 ? 'Dr' : 'Cr'}
                  </span>
                </td>
              </tr>

              {/* Transactions Rows */}
              {statementData.rows.length === 0 ? (
                <tr>
                  <td colSpan={9} className="py-12 text-center text-slate-400">
                    <FileText size={32} className="mx-auto mb-2 text-slate-300 opacity-60" />
                    <p className="font-semibold text-slate-600 text-sm">No transactions found in this period range.</p>
                    <p className="text-xs text-slate-400 mt-1">Try expanding your date range or adjusting your search filters.</p>
                  </td>
                </tr>
              ) : (
                statementData.rows.map((row, idx) => (
                  <tr 
                    key={row.id}
                    onClick={() => setSelectedDetailTx(row.rawTx)}
                    className="hover:bg-blue-50/40 cursor-pointer transition-colors"
                  >
                    <td className="py-2 px-3 text-center text-slate-400 text-[11px] font-mono">
                      {idx + 1}
                    </td>

                    <td className="py-2 px-3 whitespace-nowrap">
                      <span className="font-semibold text-slate-900 block">{row.dateFormatted}</span>
                      <span className="text-[10px] text-slate-400 block">{row.timeFormatted}</span>
                    </td>

                    <td className="py-2 px-3">
                      <span className="font-bold text-slate-900 block truncate max-w-[200px] sm:max-w-[280px]">
                        {row.partyName}
                      </span>
                      {row.notes && (
                        <span className="text-[10px] text-slate-500 italic block truncate max-w-[250px]">
                          {row.notes}
                        </span>
                      )}
                    </td>

                    <td className="py-2 px-3 whitespace-nowrap">
                      {row.invoiceNo && row.invoiceNo !== '-' ? (
                        <span className="font-mono text-xs font-semibold px-1.5 py-0.5 rounded bg-slate-100 text-slate-700 border border-slate-200">
                          #{row.invoiceNo}
                        </span>
                      ) : (
                        <span className="text-slate-400">-</span>
                      )}
                    </td>

                    <td className="py-2 px-3 whitespace-nowrap text-slate-600 text-[11px]">
                      {row.ledgerName}
                    </td>

                    <td className="py-2 px-3 whitespace-nowrap">
                      <span className={`text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded ${
                        row.paymentMode.toLowerCase().includes('cash')
                          ? 'bg-amber-100 text-amber-800'
                          : row.paymentMode.toLowerCase().includes('bank') || row.paymentMode.toLowerCase().includes('upi')
                          ? 'bg-blue-100 text-blue-800'
                          : 'bg-slate-100 text-slate-700'
                      }`}>
                        {row.paymentMode}
                      </span>
                    </td>

                    {/* Debit */}
                    <td className="py-2 px-3 text-right whitespace-nowrap font-mono font-semibold">
                      {row.debit > 0 ? (
                        <span className="text-rose-700">
                          ₹{row.debit.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                        </span>
                      ) : (
                        <span className="text-slate-300">-</span>
                      )}
                    </td>

                    {/* Credit */}
                    <td className="py-2 px-3 text-right whitespace-nowrap font-mono font-semibold">
                      {row.credit > 0 ? (
                        <span className="text-emerald-700">
                          ₹{row.credit.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                        </span>
                      ) : (
                        <span className="text-slate-300">-</span>
                      )}
                    </td>

                    {/* Running Balance */}
                    <td className="py-2 px-3 text-right whitespace-nowrap font-mono font-bold">
                      <span className={row.runningBalance >= 0 ? "text-slate-900" : "text-emerald-700"}>
                        ₹{Math.abs(row.runningBalance).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                      </span>
                      <span className={`ml-1 text-[10px] uppercase font-semibold px-1 py-0.2 rounded ${
                        row.runningBalance >= 0 ? 'bg-rose-100 text-rose-800' : 'bg-emerald-100 text-emerald-800'
                      }`}>
                        {row.runningBalance >= 0 ? 'Dr' : 'Cr'}
                      </span>
                    </td>
                  </tr>
                ))
              )}

            </tbody>

            {/* Total Footer Row */}
            <tfoot className="bg-slate-100 border-t-2 border-slate-300 font-bold text-slate-900 text-xs">
              <tr>
                <td colSpan={6} className="py-3 px-3 text-right uppercase tracking-wider text-[11px] text-slate-600">
                  Total Movement & Closing Balance:
                </td>
                <td className="py-3 px-3 text-right font-mono text-rose-700">
                  ₹{statementData.periodDebits.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                </td>
                <td className="py-3 px-3 text-right font-mono text-emerald-700">
                  ₹{statementData.periodCredits.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                </td>
                <td className="py-3 px-3 text-right font-mono font-black text-slate-900">
                  <span>₹{Math.abs(statementData.closingBalance).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
                  <span className={`ml-1 text-[10px] px-1 py-0.2 rounded ${statementData.closingBalance >= 0 ? 'bg-rose-600 text-white' : 'bg-emerald-600 text-white'}`}>
                    {statementData.closingBalance >= 0 ? 'Dr' : 'Cr'}
                  </span>
                </td>
              </tr>
            </tfoot>
          </table>
        </div>

      </Card>

    </div>
  );
}
