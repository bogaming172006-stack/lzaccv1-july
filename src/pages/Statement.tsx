import React, { useState, useEffect, useMemo, useRef } from 'react';
import { db, collection, getDocs } from '../firebase';
import { Party, Transaction, Ledger, LEDGER_TYPE_LABELS } from '../types';
import { useLedger } from '../LedgerContext';
import { useAuth } from '../AuthContext';
import { format, startOfWeek, endOfWeek, startOfMonth, endOfMonth, subMonths, startOfYear, endOfYear } from 'date-fns';
import { 
  FileSpreadsheet, 
  Download, 
  Printer, 
  Calendar, 
  Search, 
  RefreshCw, 
  TrendingUp, 
  TrendingDown, 
  DollarSign, 
  FileText, 
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  BookOpen,
  Users,
  Layers,
  ArrowUpDown,
  Phone,
  FileCheck
} from 'lucide-react';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import * as XLSX from 'xlsx';
import PageHeader from '../components/ui/PageHeader';
import StatCard from '../components/ui/StatCard';
import { Card } from '../components/ui/Card';
import TransactionDetailModal from '../components/TransactionDetailModal';
import { formatAmountInWords } from '../lib/numberToWords';

type DatePreset = 'today' | 'yesterday' | 'this_week' | 'this_month' | 'last_month' | 'this_quarter' | 'this_year' | 'all_time' | 'custom';
type StatementViewMode = 'party_wise' | 'flat';

interface PartyLedgerStatement {
  party: Party;
  ledger: Ledger | undefined;
  openingBalance: number;
  transactions: {
    id: string;
    index: number;
    rawTx: Transaction;
    timestamp: number;
    dateFormatted: string;
    timeFormatted: string;
    invoiceNo: string;
    particulars: string;
    paymentMode: string;
    debit: number;
    credit: number;
    runningBalance: number;
  }[];
  totalDebits: number;
  totalCredits: number;
  netMovement: number;
  closingBalance: number;
}

interface LedgerGroupStatement {
  ledgerId: string;
  ledgerName: string;
  ledgerType: string;
  parties: PartyLedgerStatement[];
  totalDebits: number;
  totalCredits: number;
  netClosingBalance: number;
}

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
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc'); // chronological order within party / table
  
  // UI View Mode
  const [viewMode, setViewMode] = useState<StatementViewMode>('party_wise');
  const [expandedParties, setExpandedParties] = useState<Record<string, boolean>>({});
  const [showExportMenu, setShowExportMenu] = useState(false);

  // Selected detail modal
  const [selectedDetailTx, setSelectedDetailTx] = useState<Transaction | null>(null);
  const [isExportingPdf, setIsExportingPdf] = useState(false);
  const [isExportingExcel, setIsExportingExcel] = useState(false);
  const [isExportingCsv, setIsExportingCsv] = useState(false);

  const partyDropdownRef = useRef<HTMLDivElement>(null);
  const exportMenuRef = useRef<HTMLDivElement>(null);

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

  // Close dropdowns on outside click
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (partyDropdownRef.current && !partyDropdownRef.current.contains(event.target as Node)) {
        setShowPartyDropdown(false);
      }
      if (exportMenuRef.current && !exportMenuRef.current.contains(event.target as Node)) {
        setShowExportMenu(false);
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

  // -------------------------------------------------------------
  // Comprehensive Party-Wise & Ledger Grouped Data Calculation
  // -------------------------------------------------------------
  const ledgerGroupsData = useMemo(() => {
    if (!startDate || !endDate) return [];

    const startTimestamp = new Date(`${startDate}T00:00:00.000`).getTime();
    const endTimestamp = new Date(`${endDate}T23:59:59.999`).getTime();

    // Determine which ledgers to process
    let targetLedgers = ledgers;
    if (effectiveLedgerId !== 'ALL') {
      targetLedgers = ledgers.filter(l => l.id === effectiveLedgerId);
      if (targetLedgers.length === 0 && activeLedger) {
        targetLedgers = [activeLedger];
      }
    }

    // Sort ledgers: SALE first, PURCHASE second, others third
    const sortedLedgers = [...targetLedgers].sort((a, b) => {
      const typeRank = (type: string) => {
        if (type === 'SALE') return 1;
        if (type === 'PURCHASE') return 2;
        if (type === 'EXPENSE') return 3;
        return 4;
      };
      const rankA = typeRank(a.type);
      const rankB = typeRank(b.type);
      if (rankA !== rankB) return rankA - rankB;
      return (a.name || '').localeCompare(b.name || '');
    });

    const groups: LedgerGroupStatement[] = [];

    sortedLedgers.forEach(ledger => {
      // Find parties for this ledger
      let ledgerParties = (Object.values(parties) as Party[]).filter(p => p.ledgerId === ledger.id);
      
      // If user selected a specific party, filter down
      if (selectedPartyId !== 'ALL') {
        ledgerParties = ledgerParties.filter(p => p.id === selectedPartyId);
      }

      // If party search query in UI
      if (partySearch.trim()) {
        const q = partySearch.toLowerCase().trim();
        ledgerParties = ledgerParties.filter(p => 
          (p.name || '').toLowerCase().includes(q) || (p.phone || '').includes(q)
        );
      }

      if (ledgerParties.length === 0) return;

      const partyStatements: PartyLedgerStatement[] = [];
      let groupTotalDebits = 0;
      let groupTotalCredits = 0;
      let groupClosingBalance = 0;

      ledgerParties.forEach(party => {
        // 1. Calculate historical opening balance for this party before startDate
        let partyOpening = party.openingBalance || 0;

        const partyAllTx = transactions.filter(tx => tx.partyId === party.id);

        // Historical prior transactions
        partyAllTx.forEach(tx => {
          if (tx.timestamp < startTimestamp) {
            if (tx.type === 'DEBIT') {
              partyOpening += tx.amount || 0;
            } else {
              partyOpening -= tx.amount || 0;
            }
          }
        });

        // 2. Filter transactions in current period
        const periodTx = partyAllTx.filter(tx => {
          if (tx.timestamp < startTimestamp || tx.timestamp > endTimestamp) return false;
          if (txTypeFilter !== 'ALL' && tx.type !== txTypeFilter) return false;

          if (paymentModeFilter !== 'ALL') {
            const mode = (tx.paymentMode || 'CASH').toUpperCase();
            if (paymentModeFilter === 'CASH' && mode !== 'CASH') return false;
            if (paymentModeFilter === 'BANK' && !['BANK', 'ONLINE', 'UPI', 'CHEQUE'].includes(mode)) return false;
            if (paymentModeFilter === 'DISCOUNT' && !['DISCOUNT', 'ADJUSTMENT'].includes(mode)) return false;
          }

          if (minAmount && tx.amount < parseFloat(minAmount)) return false;
          if (maxAmount && tx.amount > parseFloat(maxAmount)) return false;

          if (searchQuery.trim()) {
            const q = searchQuery.toLowerCase().trim();
            const invoiceNo = (tx.invoiceNo || '').toLowerCase();
            const notes = (tx.notes || '').toLowerCase();
            const matches = invoiceNo.includes(q) || notes.includes(q);
            if (!matches) return false;
          }

          return true;
        });

        // Sort ascending strictly by date for running balance calculation
        periodTx.sort((a, b) => a.timestamp - b.timestamp);

        let running = partyOpening;
        let partyDebits = 0;
        let partyCredits = 0;

        const txRows = periodTx.map((tx, idx) => {
          const isDebit = tx.type === 'DEBIT';
          const debitAmt = isDebit ? tx.amount : 0;
          const creditAmt = !isDebit ? tx.amount : 0;

          if (isDebit) {
            running += tx.amount;
            partyDebits += tx.amount;
          } else {
            running -= tx.amount;
            partyCredits += tx.amount;
          }

          return {
            id: tx.id,
            index: idx + 1,
            rawTx: tx,
            timestamp: tx.timestamp,
            dateFormatted: format(new Date(tx.timestamp), 'dd/MM/yyyy'),
            timeFormatted: format(new Date(tx.timestamp), 'hh:mm a'),
            invoiceNo: tx.invoiceNo || '-',
            particulars: tx.notes || (isDebit ? (ledger.type === 'SALE' ? 'Sales Invoice / Goods' : 'Debit Voucher / Charge') : (ledger.type === 'PURCHASE' ? 'Purchase Bill / Goods' : 'Payment Received / Receipt')),
            paymentMode: tx.paymentMode || (isDebit ? 'Invoice / Bill' : 'Cash'),
            debit: debitAmt,
            credit: creditAmt,
            runningBalance: running
          };
        });

        // Include party if has opening balance != 0 OR has transactions in period OR specific party selected
        if (selectedPartyId !== 'ALL' || partyOpening !== 0 || txRows.length > 0 || !searchQuery) {
          groupTotalDebits += partyDebits;
          groupTotalCredits += partyCredits;
          groupClosingBalance += running;

          partyStatements.push({
            party,
            ledger,
            openingBalance: partyOpening,
            transactions: sortOrder === 'desc' ? [...txRows].reverse() : txRows,
            totalDebits: partyDebits,
            totalCredits: partyCredits,
            netMovement: partyDebits - partyCredits,
            closingBalance: running
          });
        }
      });

      // Sort parties alphabetically
      partyStatements.sort((a, b) => (a.party.name || '').localeCompare(b.party.name || ''));

      if (partyStatements.length > 0) {
        groups.push({
          ledgerId: ledger.id,
          ledgerName: ledger.name,
          ledgerType: ledger.type,
          parties: partyStatements,
          totalDebits: groupTotalDebits,
          totalCredits: groupTotalCredits,
          netClosingBalance: groupClosingBalance
        });
      }
    });

    return groups;
  }, [
    startDate,
    endDate,
    transactions,
    parties,
    ledgers,
    activeLedger,
    effectiveLedgerId,
    selectedPartyId,
    partySearch,
    txTypeFilter,
    paymentModeFilter,
    minAmount,
    maxAmount,
    searchQuery,
    sortOrder
  ]);

  // Overall Global Summary Stats
  const globalSummary = useMemo(() => {
    let totalOpening = 0;
    let totalDebits = 0;
    let totalCredits = 0;
    let totalClosing = 0;
    let totalTxCount = 0;
    let totalPartiesCount = 0;

    ledgerGroupsData.forEach(g => {
      g.parties.forEach(p => {
        totalOpening += p.openingBalance;
        totalDebits += p.totalDebits;
        totalCredits += p.totalCredits;
        totalClosing += p.closingBalance;
        totalTxCount += p.transactions.length;
        totalPartiesCount++;
      });
    });

    return {
      totalOpening,
      totalDebits,
      totalCredits,
      netMovement: totalDebits - totalCredits,
      totalClosing,
      totalTxCount,
      totalPartiesCount
    };
  }, [ledgerGroupsData]);

  // Flat transaction list for continuous timeline view
  const flatChronologicalRows = useMemo(() => {
    const allRows: Array<{
      id: string;
      timestamp: number;
      dateFormatted: string;
      timeFormatted: string;
      partyName: string;
      partyPhone: string;
      invoiceNo: string;
      particulars: string;
      ledgerName: string;
      paymentMode: string;
      debit: number;
      credit: number;
      rawTx: Transaction;
    }> = [];

    ledgerGroupsData.forEach(g => {
      g.parties.forEach(p => {
        p.transactions.forEach(t => {
          allRows.push({
            id: t.id,
            timestamp: t.timestamp,
            dateFormatted: t.dateFormatted,
            timeFormatted: t.timeFormatted,
            partyName: p.party.name,
            partyPhone: p.party.phone || '',
            invoiceNo: t.invoiceNo,
            particulars: t.particulars,
            ledgerName: g.ledgerName,
            paymentMode: t.paymentMode,
            debit: t.debit,
            credit: t.credit,
            rawTx: t.rawTx
          });
        });
      });
    });

    // Sort strictly chronological
    allRows.sort((a, b) => sortOrder === 'desc' ? b.timestamp - a.timestamp : a.timestamp - b.timestamp);
    return allRows;
  }, [ledgerGroupsData, sortOrder]);

  // Format currency
  const formatCurrency = (val: number) => {
    return `₹${Math.abs(val).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  };

  // Toggle individual party expand/collapse
  const togglePartyExpand = (partyId: string) => {
    setExpandedParties(prev => ({
      ...prev,
      [partyId]: prev[partyId] === undefined ? false : !prev[partyId]
    }));
  };

  // Expand all / collapse all parties
  const handleToggleAllParties = (expand: boolean) => {
    const newState: Record<string, boolean> = {};
    ledgerGroupsData.forEach(g => {
      g.parties.forEach(p => {
        newState[p.party.id] = expand;
      });
    });
    setExpandedParties(newState);
  };

  // -------------------------------------------------------------
  // 1. EXPORT CSV: PARTY-WISE DETAILED LEDGER (SALES FIRST, THEN PURCHASES)
  // -------------------------------------------------------------
  const handleExportPartyWiseCsv = () => {
    setIsExportingCsv(true);
    try {
      const activeLedgerName = ledgers.find(l => l.id === effectiveLedgerId)?.name || 'All Combined Ledgers';
      const entityName = selectedParty ? selectedParty.name : `Consolidated Statement (${activeLedgerName})`;

      const csvRows: string[][] = [
        ['GREENZAR FOOD & BEVERAGE ERP - OFFICIAL ACCOUNT STATEMENT & LEDGER'],
        ['Report Type:', 'Party-by-Party Itemized Ledger Statement (Sales First, Purchases Next)'],
        ['Statement Scope:', entityName],
        ['Period Range:', `${startDate} to ${endDate}`],
        ['Generated Date:', format(new Date(), 'dd-MMM-yyyy hh:mm a')],
        ['Generated By:', currentUser?.name || 'System Operator'],
        [''],
        ['========================================================================================================'],
        ['EXECUTIVE SUMMARY TOTALS (SELECTED PERIOD)'],
        ['========================================================================================================'],
        ['Total Opening Balance (Brought Forward):', `Rs. ${Math.abs(globalSummary.totalOpening).toFixed(2)}`, globalSummary.totalOpening >= 0 ? 'Dr (Receivable / Asset)' : 'Cr (Payable / Advance)'],
        ['Total Period Debits (Sales / Invoices / Charges):', `Rs. ${globalSummary.totalDebits.toFixed(2)}`],
        ['Total Period Credits (Receipts / Collections / Payments):', `Rs. ${globalSummary.totalCredits.toFixed(2)}`],
        ['Net Period Movement (Debits - Credits):', `Rs. ${globalSummary.netMovement.toFixed(2)}`, globalSummary.netMovement >= 0 ? 'Net Sales Increase' : 'Net Collections Increase'],
        ['Total Closing Balance (Carried Forward):', `Rs. ${Math.abs(globalSummary.totalClosing).toFixed(2)}`, globalSummary.totalClosing >= 0 ? 'Dr (Net Receivable)' : 'Cr (Net Advance)'],
        ['Total Active Accounts / Parties:', String(globalSummary.totalPartiesCount)],
        ['Total Transactions in Period:', String(globalSummary.totalTxCount)],
        [''],
      ];

      // Iterate through each ledger group (Sales first, then Purchases, then others)
      ledgerGroupsData.forEach(group => {
        csvRows.push(['========================================================================================================']);
        csvRows.push([`LEDGER CATEGORY: ${group.ledgerName.toUpperCase()} [${group.ledgerType.toUpperCase()}]`]);
        csvRows.push(['========================================================================================================']);
        csvRows.push(['']);

        // For each party in this ledger
        group.parties.forEach((pState, pIndex) => {
          const partyBalanceType = pState.openingBalance >= 0 ? 'Dr' : 'Cr';
          const closingBalanceType = pState.closingBalance >= 0 ? 'Dr' : 'Cr';

          csvRows.push([
            `ACCOUNT #${pIndex + 1}: ${pState.party.name.toUpperCase()}`,
            pState.party.phone ? `Phone: ${pState.party.phone}` : '',
            pState.party.address ? `Address: ${pState.party.address}` : '',
            `Opening Balance as of ${startDate}: Rs. ${Math.abs(pState.openingBalance).toFixed(2)} ${partyBalanceType}`
          ]);

          // Party Date-wise Table Header with separate Debit & Credit columns
          csvRows.push([
            'Sr #',
            'Date',
            'Time',
            'Voucher / Inv #',
            'Particulars / Description',
            'Payment Mode',
            'Debit Amount (Rs)',
            'Credit Amount (Rs)',
            'Running Balance (Rs)'
          ]);

          if (pState.transactions.length === 0) {
            csvRows.push(['-', startDate, '-', '-', 'No transactions in period (Opening balance carried forward)', '-', '0.00', '0.00', `${Math.abs(pState.openingBalance).toFixed(2)} ${partyBalanceType}`]);
          } else {
            pState.transactions.forEach((tx, tIdx) => {
              const runType = tx.runningBalance >= 0 ? 'Dr' : 'Cr';
              csvRows.push([
                String(tIdx + 1),
                tx.dateFormatted,
                tx.timeFormatted,
                `"${tx.invoiceNo.replace(/"/g, '""')}"`,
                `"${tx.particulars.replace(/"/g, '""')}"`,
                tx.paymentMode,
                tx.debit > 0 ? tx.debit.toFixed(2) : '0.00',
                tx.credit > 0 ? tx.credit.toFixed(2) : '0.00',
                `${Math.abs(tx.runningBalance).toFixed(2)} ${runType}`
              ]);
            });
          }

          // Party Subtotal Line
          csvRows.push([
            `SUBTOTAL: ${pState.party.name}`,
            '',
            '',
            '',
            'Total Debits & Credits for Period:',
            '',
            pState.totalDebits.toFixed(2),
            pState.totalCredits.toFixed(2),
            `Closing: ${Math.abs(pState.closingBalance).toFixed(2)} ${closingBalanceType}`
          ]);
          csvRows.push(['--------------------------------------------------------------------------------------------------------']);
          csvRows.push(['']);
        });

        // Ledger Group Total
        csvRows.push([
          `TOTAL FOR LEDGER [${group.ledgerName}]:`,
          '',
          '',
          '',
          'Ledger Debits & Credits Total:',
          '',
          group.totalDebits.toFixed(2),
          group.totalCredits.toFixed(2),
          `Net: ${Math.abs(group.netClosingBalance).toFixed(2)} ${group.netClosingBalance >= 0 ? 'Dr' : 'Cr'}`
        ]);
        csvRows.push(['']);
        csvRows.push(['']);
      });

      // Grand Totals at the bottom
      csvRows.push(['========================================================================================================']);
      csvRows.push(['GRAND TOTALS - ALL LEDGERS & PARTIES']);
      csvRows.push([
        'TOTAL ALL DEBITS (SALES / CHARGES):', String(globalSummary.totalDebits.toFixed(2)),
        'TOTAL ALL CREDITS (RECEIPTS / PAYMENTS):', String(globalSummary.totalCredits.toFixed(2)),
        'NET CLOSING POSITION:', `${Math.abs(globalSummary.totalClosing).toFixed(2)} ${globalSummary.totalClosing >= 0 ? 'Dr (Receivable)' : 'Cr (Advance)'}`
      ]);
      csvRows.push(['========================================================================================================']);

      const csvContent = "\uFEFF" + csvRows.map(e => e.join(",")).join("\n");
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.setAttribute("href", url);
      link.setAttribute("download", `Party_Wise_Statement_${startDate}_to_${endDate}.csv`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch (err) {
      console.error("CSV Export failed:", err);
      alert("Failed to export CSV statement.");
    } finally {
      setIsExportingCsv(false);
      setShowExportMenu(false);
    }
  };

  // -------------------------------------------------------------
  // 2. EXPORT CSV: FLAT CONTINUOUS CHRONOLOGICAL LIST
  // -------------------------------------------------------------
  const handleExportFlatCsv = () => {
    setIsExportingCsv(true);
    try {
      const csvRows: string[][] = [
        ['GREENZAR FOOD & BEVERAGE ERP - CONTINUOUS ACCOUNT STATEMENT'],
        ['Period:', `${startDate} to ${endDate}`],
        ['Generated On:', format(new Date(), 'dd-MMM-yyyy hh:mm a')],
        [''],
        ['Sr #', 'Date', 'Time', 'Party Name', 'Voucher / Invoice #', 'Particulars', 'Ledger', 'Payment Mode', 'Debit (Rs)', 'Credit (Rs)']
      ];

      flatChronologicalRows.forEach((r, idx) => {
        csvRows.push([
          String(idx + 1),
          r.dateFormatted,
          r.timeFormatted,
          `"${r.partyName.replace(/"/g, '""')}"`,
          `"${r.invoiceNo.replace(/"/g, '""')}"`,
          `"${r.particulars.replace(/"/g, '""')}"`,
          `"${r.ledgerName.replace(/"/g, '""')}"`,
          r.paymentMode,
          r.debit > 0 ? r.debit.toFixed(2) : '0.00',
          r.credit > 0 ? r.credit.toFixed(2) : '0.00'
        ]);
      });

      // Total Row
      csvRows.push([
        'TOTALS',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        globalSummary.totalDebits.toFixed(2),
        globalSummary.totalCredits.toFixed(2)
      ]);

      const csvContent = "\uFEFF" + csvRows.map(e => e.join(",")).join("\n");
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.setAttribute("href", url);
      link.setAttribute("download", `Continuous_Statement_${startDate}_to_${endDate}.csv`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch (err) {
      console.error("Flat CSV export failed:", err);
    } finally {
      setIsExportingCsv(false);
      setShowExportMenu(false);
    }
  };

  // -------------------------------------------------------------
  // 3. EXPORT EXCEL (.xlsx): MULTI-PARTY STRUCTURED
  // -------------------------------------------------------------
  const handleExportExcel = () => {
    setIsExportingExcel(true);
    try {
      const wb = XLSX.utils.book_new();

      // Sheet 1: Party-Wise Detailed Ledger
      const detailedData: any[][] = [
        ['GREENZAR FOOD & BEVERAGE ERP'],
        ['STATEMENT OF ACCOUNT - PARTY-WISE DETAILED LEDGER'],
        [],
        ['Statement Period:', `${startDate} to ${endDate}`],
        ['Generated Date:', format(new Date(), 'dd-MMM-yyyy hh:mm a')],
        ['Total Period Debits:', globalSummary.totalDebits],
        ['Total Period Credits:', globalSummary.totalCredits],
        ['Net Closing Balance:', `${globalSummary.totalClosing.toFixed(2)} ${globalSummary.totalClosing >= 0 ? 'Dr' : 'Cr'}`],
        []
      ];

      ledgerGroupsData.forEach(group => {
        detailedData.push([`LEDGER BOOK: ${group.ledgerName.toUpperCase()} (${group.ledgerType})`]);
        detailedData.push([]);

        group.parties.forEach(p => {
          detailedData.push([
            `PARTY: ${p.party.name}`,
            p.party.phone ? `Phone: ${p.party.phone}` : '',
            `Opening Balance: Rs. ${Math.abs(p.openingBalance).toFixed(2)} ${p.openingBalance >= 0 ? 'Dr' : 'Cr'}`
          ]);
          detailedData.push(['Sr #', 'Date', 'Time', 'Voucher / Inv #', 'Particulars / Notes', 'Mode', 'Debit (Rs)', 'Credit (Rs)', 'Running Balance']);

          if (p.transactions.length === 0) {
            detailedData.push(['-', startDate, '-', '-', 'Opening balance brought forward', '-', 0, 0, p.openingBalance]);
          } else {
            p.transactions.forEach((tx, idx) => {
              detailedData.push([
                idx + 1,
                tx.dateFormatted,
                tx.timeFormatted,
                tx.invoiceNo,
                tx.particulars,
                tx.paymentMode,
                tx.debit,
                tx.credit,
                tx.runningBalance
              ]);
            });
          }

          detailedData.push([
            `Subtotal: ${p.party.name}`,
            '',
            '',
            '',
            '',
            'Totals:',
            p.totalDebits,
            p.totalCredits,
            p.closingBalance
          ]);
          detailedData.push([]);
        });
      });

      // Grand Total row
      detailedData.push([
        'GRAND TOTALS',
        '',
        '',
        '',
        '',
        '',
        globalSummary.totalDebits,
        globalSummary.totalCredits,
        globalSummary.totalClosing
      ]);

      const wsDetailed = XLSX.utils.aoa_to_sheet(detailedData);
      wsDetailed['!cols'] = [
        { wch: 8 },
        { wch: 14 },
        { wch: 12 },
        { wch: 18 },
        { wch: 32 },
        { wch: 16 },
        { wch: 16 },
        { wch: 16 },
        { wch: 18 }
      ];
      XLSX.utils.book_append_sheet(wb, wsDetailed, 'Party-Wise Ledger');

      // Sheet 2: Party Balance Summary
      const summaryData: any[][] = [
        ['GREENZAR FOOD & BEVERAGE ERP - PARTY BALANCE SUMMARY'],
        ['Period:', `${startDate} to ${endDate}`],
        [],
        ['Sr #', 'Party / Account Name', 'Ledger', 'Phone', 'Opening Balance', 'Debit (Sales)', 'Credit (Receipts)', 'Net Movement', 'Closing Balance', 'Status']
      ];

      let partyCount = 0;
      ledgerGroupsData.forEach(g => {
        g.parties.forEach(p => {
          partyCount++;
          summaryData.push([
            partyCount,
            p.party.name,
            g.ledgerName,
            p.party.phone || '-',
            p.openingBalance,
            p.totalDebits,
            p.totalCredits,
            p.netMovement,
            p.closingBalance,
            p.closingBalance >= 0 ? 'Dr (Due)' : 'Cr (Advance)'
          ]);
        });
      });

      summaryData.push([
        'TOTALS',
        '',
        '',
        '',
        globalSummary.totalOpening,
        globalSummary.totalDebits,
        globalSummary.totalCredits,
        globalSummary.netMovement,
        globalSummary.totalClosing,
        globalSummary.totalClosing >= 0 ? 'Net Dr' : 'Net Cr'
      ]);

      const wsSummary = XLSX.utils.aoa_to_sheet(summaryData);
      wsSummary['!cols'] = [
        { wch: 6 },
        { wch: 28 },
        { wch: 18 },
        { wch: 16 },
        { wch: 16 },
        { wch: 16 },
        { wch: 16 },
        { wch: 16 },
        { wch: 16 },
        { wch: 14 }
      ];
      XLSX.utils.book_append_sheet(wb, wsSummary, 'Summary by Party');

      XLSX.writeFile(wb, `Statement_${startDate}_to_${endDate}.xlsx`);
    } catch (err) {
      console.error("Excel Export failed:", err);
      alert("Failed to export Excel file.");
    } finally {
      setIsExportingExcel(false);
      setShowExportMenu(false);
    }
  };

  // -------------------------------------------------------------
  // 4. EXPORT PDF: FORMAL PROFESSIONAL STATEMENT
  // -------------------------------------------------------------
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
      doc.setFontSize(13);
      doc.text('GREENZAR FOOD & BEVERAGE ERP', 14, 9);
      doc.setFontSize(8);
      doc.setFont('helvetica', 'normal');
      doc.text('Official Account Statement & Ledger Report', 14, 15);

      doc.setFont('helvetica', 'bold');
      doc.text(`DATE: ${format(new Date(), 'dd-MMM-yyyy')}`, 196, 9, { align: 'right' });
      doc.setFont('helvetica', 'normal');
      doc.text(`TIME: ${format(new Date(), 'hh:mm a')}`, 196, 15, { align: 'right' });

      // Entity Info Box
      doc.setTextColor(30, 41, 59);
      doc.setFontSize(10);
      doc.setFont('helvetica', 'bold');
      doc.text(`STATEMENT: ${entityName.toUpperCase()}`, 14, 29);

      doc.setFontSize(8);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(71, 85, 105);
      
      if (selectedParty) {
        if (selectedParty.phone) doc.text(`Phone: ${selectedParty.phone}`, 14, 34);
        if (selectedParty.address) doc.text(`Address: ${selectedParty.address}`, 14, 38);
      } else {
        doc.text(`Ledger Scope: ${activeLedgerName} | Active Parties: ${globalSummary.totalPartiesCount}`, 14, 34);
      }

      doc.setFont('helvetica', 'bold');
      doc.setTextColor(15, 23, 42);
      doc.text(`Period: ${startDate} to ${endDate}`, 196, 29, { align: 'right' });
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(71, 85, 105);
      doc.text(`Generated by: ${currentUser?.name || 'Operator'}`, 196, 34, { align: 'right' });

      // Summary Table Box
      const closingWords = formatAmountInWords(Math.abs(globalSummary.totalClosing));
      const summaryBody: any[][] = [
        [
          `Opening Balance:\nRs. ${Math.abs(globalSummary.totalOpening).toFixed(2)} ${globalSummary.totalOpening >= 0 ? 'Dr' : 'Cr'}`,
          `Total Debits (Sales/Charges):\nRs. ${globalSummary.totalDebits.toFixed(2)}`,
          `Total Credits (Receipts/Payments):\nRs. ${globalSummary.totalCredits.toFixed(2)}`,
          `Net Period Movement:\nRs. ${globalSummary.netMovement.toFixed(2)} (${globalSummary.netMovement >= 0 ? '+Dr' : '-Cr'})`,
          `Closing Balance:\nRs. ${Math.abs(globalSummary.totalClosing).toFixed(2)} ${globalSummary.totalClosing >= 0 ? 'Dr' : 'Cr'}`
        ]
      ];

      if (closingWords) {
        summaryBody.push([
          {
            content: `Net Closing Balance in Words: ${closingWords} (${globalSummary.totalClosing >= 0 ? 'Debit / Net Receivable' : 'Credit / Net Advance'})`,
            colSpan: 5,
            styles: { fontStyle: 'italic', fontSize: 7, textColor: [71, 85, 105], fillColor: [248, 250, 252] }
          }
        ]);
      }

      autoTable(doc, {
        startY: 40,
        head: [['Executive Summary Totals for Period', '', '', '', '']],
        body: summaryBody,
        theme: 'grid',
        headStyles: {
          fillColor: [241, 245, 249],
          textColor: [15, 23, 42],
          fontSize: 7.5,
          fontStyle: 'bold'
        },
        bodyStyles: {
          fontSize: 7.5,
          fontStyle: 'bold',
          textColor: [15, 23, 42],
          fillColor: [248, 250, 252]
        },
        margin: { left: 14, right: 14 }
      });

      // Build table rows
      const tableData: any[][] = [];

      if (selectedParty) {
        // Single Party View
        const pData = ledgerGroupsData.flatMap(g => g.parties).find(p => p.party.id === selectedParty.id);
        if (pData) {
          // Opening balance line
          tableData.push([
            '-',
            startDate,
            `Opening Balance brought forward as of ${startDate}`,
            '-',
            '-',
            '-',
            '-',
            `${Math.abs(pData.openingBalance).toFixed(2)} ${pData.openingBalance >= 0 ? 'Dr' : 'Cr'}`
          ]);

          pData.transactions.forEach((tx, idx) => {
            tableData.push([
              String(idx + 1),
              tx.dateFormatted,
              tx.particulars,
              tx.invoiceNo,
              tx.paymentMode,
              tx.debit > 0 ? tx.debit.toFixed(2) : '-',
              tx.credit > 0 ? tx.credit.toFixed(2) : '-',
              `${Math.abs(tx.runningBalance).toFixed(2)} ${tx.runningBalance >= 0 ? 'Dr' : 'Cr'}`
            ]);
          });

          // Single party summary line
          tableData.push([
            { content: `Total Movement (${pData.party.name}):`, colSpan: 5, styles: { fontStyle: 'bold', halign: 'right', fillColor: [241, 245, 249] } },
            { content: pData.totalDebits.toFixed(2), styles: { fontStyle: 'bold', halign: 'right', textColor: [185, 28, 28], fillColor: [241, 245, 249] } },
            { content: pData.totalCredits.toFixed(2), styles: { fontStyle: 'bold', halign: 'right', textColor: [21, 128, 61], fillColor: [241, 245, 249] } },
            { content: `${Math.abs(pData.closingBalance).toFixed(2)} ${pData.closingBalance >= 0 ? 'Dr' : 'Cr'}`, styles: { fontStyle: 'bold', halign: 'right', fillColor: [241, 245, 249] } }
          ]);

          const partyWords = formatAmountInWords(Math.abs(pData.closingBalance));
          if (partyWords) {
            tableData.push([
              {
                content: `Amount in words: ${partyWords} (${pData.closingBalance >= 0 ? 'Dr' : 'Cr'})`,
                colSpan: 8,
                styles: { fontStyle: 'italic', fontSize: 6.8, textColor: [71, 85, 105], fillColor: [248, 250, 252] }
              }
            ]);
          }
        }
      } else {
        // Multi-Party Grouped View (Sales first, Purchases second)
        ledgerGroupsData.forEach(g => {
          // Ledger Category Banner Row
          tableData.push([
            {
              content: `▶ LEDGER CATEGORY: ${g.ledgerName.toUpperCase()} [${g.ledgerType.toUpperCase()}]`,
              colSpan: 8,
              styles: { fillColor: [0, 85, 165], fontStyle: 'bold', textColor: [255, 255, 255], fontSize: 8 }
            }
          ]);

          g.parties.forEach((p, pIdx) => {
            // Party Header with Opening Balance
            tableData.push([
              {
                content: `ACCOUNT #${pIdx + 1}: ${p.party.name} ${p.party.phone ? `(Ph: ${p.party.phone})` : ''}  |  Opening Balance as of ${startDate}: Rs. ${Math.abs(p.openingBalance).toFixed(2)} ${p.openingBalance >= 0 ? 'Dr' : 'Cr'}`,
                colSpan: 8,
                styles: { fillColor: [241, 245, 249], fontStyle: 'bold', textColor: [15, 23, 42], fontSize: 7.5 }
              }
            ]);

            if (p.transactions.length === 0) {
              tableData.push([
                '-',
                startDate,
                'Opening balance brought forward (No transactions in period)',
                '-',
                '-',
                '-',
                '-',
                `${Math.abs(p.openingBalance).toFixed(2)} ${p.openingBalance >= 0 ? 'Dr' : 'Cr'}`
              ]);
            } else {
              p.transactions.forEach((tx, idx) => {
                tableData.push([
                  String(idx + 1),
                  tx.dateFormatted,
                  tx.particulars,
                  tx.invoiceNo,
                  tx.paymentMode,
                  tx.debit > 0 ? tx.debit.toFixed(2) : '-',
                  tx.credit > 0 ? tx.credit.toFixed(2) : '-',
                  `${Math.abs(tx.runningBalance).toFixed(2)} ${tx.runningBalance >= 0 ? 'Dr' : 'Cr'}`
                ]);
              });
            }

            // Party Subtotal Line
            tableData.push([
              { content: `Subtotal (${p.party.name}):`, colSpan: 5, styles: { fontStyle: 'bold', halign: 'right', fillColor: [248, 250, 252] } },
              { content: p.totalDebits.toFixed(2), styles: { fontStyle: 'bold', halign: 'right', textColor: [185, 28, 28], fillColor: [248, 250, 252] } },
              { content: p.totalCredits.toFixed(2), styles: { fontStyle: 'bold', halign: 'right', textColor: [21, 128, 61], fillColor: [248, 250, 252] } },
              { content: `${Math.abs(p.closingBalance).toFixed(2)} ${p.closingBalance >= 0 ? 'Dr' : 'Cr'}`, styles: { fontStyle: 'bold', halign: 'right', fillColor: [248, 250, 252] } }
            ]);
          });

          // Ledger Group Total Line
          tableData.push([
            { content: `TOTAL FOR ${g.ledgerName.toUpperCase()}:`, colSpan: 5, styles: { fontStyle: 'bold', halign: 'right', fillColor: [238, 242, 246] } },
            { content: g.totalDebits.toFixed(2), styles: { fontStyle: 'bold', halign: 'right', textColor: [185, 28, 28], fillColor: [238, 242, 246] } },
            { content: g.totalCredits.toFixed(2), styles: { fontStyle: 'bold', halign: 'right', textColor: [21, 128, 61], fillColor: [238, 242, 246] } },
            { content: `${Math.abs(g.netClosingBalance).toFixed(2)} ${g.netClosingBalance >= 0 ? 'Dr' : 'Cr'}`, styles: { fontStyle: 'bold', halign: 'right', fillColor: [238, 242, 246] } }
          ]);
        });
      }

      // Grand Total Row
      tableData.push([
        { content: 'GRAND TOTALS - ALL ACCOUNTS & LEDGERS', colSpan: 5, styles: { fontStyle: 'bold', halign: 'right', fillColor: [226, 232, 240] } },
        { content: globalSummary.totalDebits.toFixed(2), styles: { fontStyle: 'bold', halign: 'right', fillColor: [226, 232, 240], textColor: [185, 28, 28] } },
        { content: globalSummary.totalCredits.toFixed(2), styles: { fontStyle: 'bold', halign: 'right', fillColor: [226, 232, 240], textColor: [21, 128, 61] } },
        { content: `${Math.abs(globalSummary.totalClosing).toFixed(2)} ${globalSummary.totalClosing >= 0 ? 'Dr' : 'Cr'}`, styles: { fontStyle: 'bold', halign: 'right', fillColor: [226, 232, 240] } }
      ]);

      const lastAutoTable = (doc as any).lastAutoTable;
      const startY = (lastAutoTable ? lastAutoTable.finalY : 55) + 3;

      autoTable(doc, {
        startY: startY,
        head: [['#', 'Date', 'Particulars / Notes', 'Inv #', 'Mode', 'Debit (Rs)', 'Credit (Rs)', 'Balance (Rs)']],
        body: tableData,
        theme: 'striped',
        headStyles: {
          fillColor: [0, 85, 165],
          textColor: [255, 255, 255],
          fontSize: 7.5,
          fontStyle: 'bold',
          halign: 'left'
        },
        columnStyles: {
          0: { cellWidth: 7, halign: 'center' },
          1: { cellWidth: 18 },
          2: { cellWidth: 'auto' },
          3: { cellWidth: 18 },
          4: { cellWidth: 18 },
          5: { cellWidth: 22, halign: 'right', textColor: [185, 28, 28] },
          6: { cellWidth: 22, halign: 'right', textColor: [21, 128, 61] },
          7: { cellWidth: 26, halign: 'right', fontStyle: 'bold' }
        },
        styles: {
          fontSize: 7,
          cellPadding: 1.8,
          overflow: 'linebreak'
        },
        margin: { left: 14, right: 14, bottom: 20 },
        didDrawPage: function(data) {
          const str = `Page ${data.pageNumber} of ${doc.getNumberOfPages()}`;
          doc.setFontSize(7);
          doc.setTextColor(148, 163, 184);
          doc.text(str, 196, 290, { align: 'right' });
          doc.text('Greenzar ERP - Official Financial Ledger Statement', 14, 290);
        }
      });

      doc.save(`Statement_${entityName.replace(/[^a-zA-Z0-9]/g, '_')}_${startDate}_to_${endDate}.pdf`);
    } catch (err) {
      console.error("PDF Export failed:", err);
      alert("Failed to export PDF statement.");
    } finally {
      setIsExportingPdf(false);
      setShowExportMenu(false);
    }
  };

  return (
    <div className="p-3 sm:p-6 max-w-[1600px] mx-auto space-y-5 print:p-0 print:m-0 print:max-w-none">
      
      {/* Transaction Detail Modal */}
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

      {/* Page Header */}
      <div className="print:hidden">
        <PageHeader
          title="Account Statements & Ledger Reports"
          subtitle="Generate custom party-wise and consolidated ledger statements with separate Debit & Credit columns. Download CSV (Sale parties first, Purchases next), Excel & PDF."
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
                onClick={() => window.print()}
                className="px-3 py-2 bg-slate-800 hover:bg-slate-900 text-white text-xs font-semibold rounded-lg shadow-2xs flex items-center gap-1.5 transition-colors cursor-pointer"
              >
                <Printer size={14} />
                <span>Print</span>
              </button>

              {/* Primary CSV Download Button with Party-Wise Format */}
              <div className="relative" ref={exportMenuRef}>
                <div className="inline-flex rounded-lg shadow-2xs">
                  <button
                    type="button"
                    onClick={handleExportPartyWiseCsv}
                    disabled={isExportingCsv || globalSummary.totalPartiesCount === 0}
                    className="px-3.5 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-xs font-bold rounded-l-lg flex items-center gap-1.5 transition-colors cursor-pointer"
                    title="Download Party-Wise CSV (Sales parties first, then Purchases)"
                  >
                    <Download size={14} />
                    <span>{isExportingCsv ? 'Exporting...' : 'Download CSV'}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowExportMenu(!showExportMenu)}
                    className="px-2 py-2 bg-emerald-700 hover:bg-emerald-800 text-white rounded-r-lg border-l border-emerald-500 cursor-pointer"
                    title="More CSV / Export Options"
                  >
                    <ChevronDown size={14} />
                  </button>
                </div>

                {/* Export Dropdown Options */}
                {showExportMenu && (
                  <div className="absolute right-0 mt-1 w-64 bg-white border border-slate-200 rounded-xl shadow-xl z-50 p-2 space-y-1 animate-in fade-in duration-100">
                    <p className="px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-slate-400">
                      Export CSV Formats
                    </p>
                    <button
                      type="button"
                      onClick={handleExportPartyWiseCsv}
                      className="w-full text-left px-2.5 py-2 text-xs font-semibold text-slate-800 hover:bg-emerald-50 hover:text-emerald-800 rounded-lg flex items-start gap-2"
                    >
                      <FileSpreadsheet size={15} className="text-emerald-600 shrink-0 mt-0.5" />
                      <div>
                        <p className="font-bold">Party-Wise Ledger CSV</p>
                        <p className="text-[10px] text-slate-500 font-normal">Sale parties first, then Purchase parties, Date-wise Debit & Credit</p>
                      </div>
                    </button>

                    <button
                      type="button"
                      onClick={handleExportFlatCsv}
                      className="w-full text-left px-2.5 py-2 text-xs font-semibold text-slate-800 hover:bg-blue-50 hover:text-blue-800 rounded-lg flex items-start gap-2"
                    >
                      <FileCheck size={15} className="text-blue-600 shrink-0 mt-0.5" />
                      <div>
                        <p className="font-bold">Continuous Flat CSV</p>
                        <p className="text-[10px] text-slate-500 font-normal">Single continuous date-wise transactions sheet</p>
                      </div>
                    </button>

                    <div className="border-t border-slate-100 my-1"></div>

                    <p className="px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-slate-400">
                      Other Formats
                    </p>
                    <button
                      type="button"
                      onClick={handleExportExcel}
                      className="w-full text-left px-2.5 py-2 text-xs font-semibold text-slate-800 hover:bg-teal-50 hover:text-teal-800 rounded-lg flex items-center gap-2"
                    >
                      <FileSpreadsheet size={15} className="text-teal-600" />
                      <span>Excel Workbook (.xlsx)</span>
                    </button>
                    <button
                      type="button"
                      onClick={handleExportPdf}
                      className="w-full text-left px-2.5 py-2 text-xs font-semibold text-slate-800 hover:bg-blue-50 hover:text-blue-800 rounded-lg flex items-center gap-2"
                    >
                      <FileText size={15} className="text-[#0055a5]" />
                      <span>Formal PDF Statement</span>
                    </button>
                  </div>
                )}
              </div>

              {/* Excel Direct Button */}
              <button
                type="button"
                onClick={handleExportExcel}
                disabled={isExportingExcel || globalSummary.totalPartiesCount === 0}
                className="px-3 py-2 bg-teal-600 hover:bg-teal-700 disabled:opacity-50 text-white text-xs font-semibold rounded-lg shadow-2xs flex items-center gap-1.5 transition-colors cursor-pointer"
              >
                <FileSpreadsheet size={14} />
                <span>Excel</span>
              </button>

              {/* PDF Direct Button */}
              <button
                type="button"
                onClick={handleExportPdf}
                disabled={isExportingPdf || globalSummary.totalPartiesCount === 0}
                className="px-3.5 py-2 bg-[#0055a5] hover:bg-blue-700 disabled:opacity-50 text-white text-xs font-bold rounded-lg shadow-2xs flex items-center gap-1.5 transition-colors cursor-pointer"
              >
                <FileText size={14} />
                <span>{isExportingPdf ? 'Generating...' : 'PDF'}</span>
              </button>
            </div>
          }
        />
      </div>

      {/* Filters & Configuration Control Bar */}
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
              Ledger Book Scope
            </label>
            <select
              value={selectedLedgerId}
              onChange={(e) => {
                setSelectedLedgerId(e.target.value);
                setSelectedPartyId('ALL');
              }}
              className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg text-xs font-semibold text-slate-800 focus:border-[#0055a5] focus:bg-white focus:outline-none transition-colors"
            >
              <option value="ACTIVE">Active Ledger: {activeLedger?.name || 'Active'}</option>
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
              <option value="DEBIT">Debits Only (Sales / Charges / Outward)</option>
              <option value="CREDIT">Credits Only (Receipts / Collections / Payments)</option>
            </select>
          </div>

          {/* Payment Mode */}
          <div>
            <label className="block text-[11px] font-bold text-slate-600 uppercase tracking-wider mb-1">
              Payment Mode
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
              Sort Order (Date-wise)
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

      {/* Printable Formal Statement Header (Shown on print) */}
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
          </div>
          <div className="text-right">
            <p className="font-bold uppercase text-slate-500 text-[10px]">Ledger Scope</p>
            <p className="font-semibold text-slate-800">{ledgers.find(l => l.id === effectiveLedgerId)?.name || 'Consolidated Ledgers'}</p>
          </div>
        </div>
      </div>

      {/* Executive Summary KPI Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        
        {/* 1. Opening Balance */}
        <StatCard
          title={`Opening Balance (${startDate})`}
          value={formatCurrency(globalSummary.totalOpening)}
          variant={globalSummary.totalOpening >= 0 ? "debit" : "credit"}
          icon={Calendar}
          subtitle={globalSummary.totalOpening >= 0 ? "Dr (Due Receivable)" : "Cr (Advance / Payable)"}
        />

        {/* 2. Period Debits */}
        <StatCard
          title="Total Debits (+)"
          value={formatCurrency(globalSummary.totalDebits)}
          variant="debit"
          icon={TrendingUp}
          subtitle="Sales & Outward Charges"
        />

        {/* 3. Period Credits */}
        <StatCard
          title="Total Credits (-)"
          value={formatCurrency(globalSummary.totalCredits)}
          variant="credit"
          icon={TrendingDown}
          subtitle="Collections & Receipts"
        />

        {/* 4. Net Movement */}
        <StatCard
          title="Net Period Movement"
          value={formatCurrency(globalSummary.netMovement)}
          variant="navy"
          icon={DollarSign}
          subtitle={globalSummary.netMovement >= 0 ? "Net Addition (+)" : "Net Reduction (-)"}
        />

        {/* 5. Closing Balance */}
        <StatCard
          title={`Closing Balance (${endDate})`}
          value={formatCurrency(globalSummary.totalClosing)}
          variant={globalSummary.totalClosing >= 0 ? "debit" : "credit"}
          icon={CheckCircle2}
          subtitle={globalSummary.totalClosing >= 0 ? "Dr (Closing Due)" : "Cr (Closing Advance)"}
        />

      </div>

      {formatAmountInWords(Math.abs(globalSummary.totalClosing)) && (
        <div className="px-3.5 py-2 bg-slate-50 border border-slate-200/80 rounded-lg text-xs text-slate-700 flex items-center justify-between gap-2 flex-wrap print:hidden">
          <div className="flex items-center gap-1.5 text-slate-600">
            <FileText size={13} className="text-slate-400 shrink-0" />
            <span className="font-semibold text-slate-800 uppercase text-[10px] tracking-wider">Closing Position in Words:</span>
            <span className="italic font-medium text-slate-900">{formatAmountInWords(Math.abs(globalSummary.totalClosing))}</span>
          </div>
          <span className={`text-[10.5px] font-bold px-2 py-0.5 rounded ${globalSummary.totalClosing >= 0 ? 'bg-rose-100 text-rose-700' : 'bg-emerald-100 text-emerald-700'}`}>
            {globalSummary.totalClosing >= 0 ? 'Net Dr (Receivable)' : 'Net Cr (Payable / Advance)'}
          </span>
        </div>
      )}

      {/* View Mode Toggle Bar */}
      <div className="flex items-center justify-between flex-wrap gap-2 print:hidden">
        <div className="inline-flex bg-slate-200/80 p-1 rounded-xl">
          <button
            type="button"
            onClick={() => setViewMode('party_wise')}
            className={`px-3.5 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-all cursor-pointer ${
              viewMode === 'party_wise'
                ? 'bg-white text-[#0055a5] shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Users size={14} />
            <span>Party-by-Party Ledger (Sales First, Purchases Next)</span>
          </button>
          
          <button
            type="button"
            onClick={() => setViewMode('flat')}
            className={`px-3.5 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-all cursor-pointer ${
              viewMode === 'flat'
                ? 'bg-white text-[#0055a5] shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Layers size={14} />
            <span>Continuous Timeline View</span>
          </button>
        </div>

        {viewMode === 'party_wise' && (
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => handleToggleAllParties(true)}
              className="text-xs text-blue-700 hover:underline font-semibold"
            >
              Expand All
            </button>
            <span className="text-slate-300">|</span>
            <button
              type="button"
              onClick={() => handleToggleAllParties(false)}
              className="text-xs text-slate-600 hover:underline font-semibold"
            >
              Collapse All
            </button>
          </div>
        )}
      </div>

      {/* ------------------------------------------------------------- */}
      {/* VIEW 1: PARTY-WISE GROUPED STATEMENT (SALES FIRST, PURCHASES NEXT) */}
      {/* ------------------------------------------------------------- */}
      {viewMode === 'party_wise' && (
        <div className="space-y-6">
          {ledgerGroupsData.length === 0 ? (
            <Card className="p-12 text-center text-slate-400">
              <FileText size={36} className="mx-auto mb-2 text-slate-300 opacity-60" />
              <p className="font-bold text-slate-700 text-sm">No party accounts found for this period.</p>
              <p className="text-xs text-slate-400 mt-1">Adjust your date range or clear search filters.</p>
            </Card>
          ) : (
            ledgerGroupsData.map(group => {
              const isSaleLedger = group.ledgerType === 'SALE';
              const isPurchaseLedger = group.ledgerType === 'PURCHASE';

              return (
                <div key={group.ledgerId} className="space-y-3">
                  
                  {/* Ledger Category Header Banner */}
                  <div className={`px-4 py-2.5 rounded-xl border flex items-center justify-between flex-wrap gap-2 ${
                    isSaleLedger
                      ? 'bg-blue-50/80 border-blue-200 text-blue-900'
                      : isPurchaseLedger
                      ? 'bg-purple-50/80 border-purple-200 text-purple-900'
                      : 'bg-slate-100 border-slate-200 text-slate-800'
                  }`}>
                    <div className="flex items-center gap-2">
                      <BookOpen size={16} className={isSaleLedger ? 'text-blue-700' : isPurchaseLedger ? 'text-purple-700' : 'text-slate-700'} />
                      <h2 className="text-sm font-black uppercase tracking-wider">
                        {group.ledgerName} ({group.ledgerType} LEDGER)
                      </h2>
                      <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-white/80 border border-current opacity-80">
                        {group.parties.length} Accounts
                      </span>
                    </div>

                    <div className="flex items-center gap-4 text-xs font-mono">
                      <span>Total Debits: <strong className="text-rose-700">₹{group.totalDebits.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</strong></span>
                      <span>Total Credits: <strong className="text-emerald-700">₹{group.totalCredits.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</strong></span>
                      <span>Net Balance: <strong>₹{Math.abs(group.netClosingBalance).toLocaleString('en-IN', { minimumFractionDigits: 2 })} {group.netClosingBalance >= 0 ? 'Dr' : 'Cr'}</strong></span>
                    </div>
                  </div>

                  {/* Parties in this Ledger */}
                  <div className="space-y-3">
                    {group.parties.map(pState => {
                      const isExpanded = expandedParties[pState.party.id] !== false; // expanded by default

                      return (
                        <Card key={pState.party.id} className="overflow-hidden border-slate-200 shadow-2xs">
                          
                          {/* Party Summary Bar / Accordion Trigger */}
                          <div 
                            onClick={() => togglePartyExpand(pState.party.id)}
                            className="px-4 py-3 bg-slate-50/90 hover:bg-slate-100/90 border-b border-slate-200 flex items-center justify-between cursor-pointer transition-colors select-none"
                          >
                            <div className="flex items-center gap-3">
                              <button type="button" className="text-slate-400 hover:text-slate-700">
                                {isExpanded ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
                              </button>

                              <div>
                                <div className="flex items-center gap-2">
                                  <h3 className="text-sm font-bold text-slate-900">{pState.party.name}</h3>
                                  {pState.party.phone && (
                                    <span className="text-xs text-slate-500 flex items-center gap-1">
                                      <Phone size={11} className="text-slate-400" />
                                      {pState.party.phone}
                                    </span>
                                  )}
                                </div>
                                <p className="text-[11px] text-slate-500">
                                  Opening Balance: <strong className={pState.openingBalance >= 0 ? "text-rose-700" : "text-emerald-700"}>
                                    ₹{Math.abs(pState.openingBalance).toLocaleString('en-IN', { minimumFractionDigits: 2 })} {pState.openingBalance >= 0 ? 'Dr' : 'Cr'}
                                  </strong>
                                  <span className="mx-2">•</span>
                                  <span>{pState.transactions.length} transactions</span>
                                </p>
                              </div>
                            </div>

                            {/* Party KPI Quick View */}
                            <div className="flex items-center gap-3 text-right">
                              <div className="hidden sm:block text-xs font-mono">
                                <p className="text-rose-700 font-semibold">Dr: ₹{pState.totalDebits.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</p>
                                <p className="text-emerald-700 font-semibold">Cr: ₹{pState.totalCredits.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</p>
                              </div>
                              <div className="text-right">
                                <span className="text-[10px] text-slate-400 uppercase block font-semibold">Closing Balance</span>
                                <span className="font-mono font-bold text-sm text-slate-900 block">
                                  ₹{Math.abs(pState.closingBalance).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                                  <span className={`ml-1 text-[10px] px-1 py-0.5 rounded font-bold ${
                                    pState.closingBalance >= 0 ? 'bg-rose-100 text-rose-800' : 'bg-emerald-100 text-emerald-800'
                                  }`}>
                                    {pState.closingBalance >= 0 ? 'Dr' : 'Cr'}
                                  </span>
                                </span>
                              </div>
                            </div>
                          </div>

                          {/* Party Transactions Table */}
                          {isExpanded && (
                            <div className="overflow-x-auto">
                              <table className="w-full text-left border-collapse text-xs">
                                <thead>
                                  <tr className="bg-slate-100/70 text-slate-600 font-bold uppercase tracking-wider text-[10px] border-b border-slate-200">
                                    <th className="py-2 px-3 text-center w-8">#</th>
                                    <th className="py-2 px-3 w-24">Date</th>
                                    <th className="py-2 px-3">Particulars / Description</th>
                                    <th className="py-2 px-3 w-28">Voucher / Inv #</th>
                                    <th className="py-2 px-3 w-24">Mode</th>
                                    <th className="py-2 px-3 text-right w-28">Debit (Dr)</th>
                                    <th className="py-2 px-3 text-right w-28">Credit (Cr)</th>
                                    <th className="py-2 px-3 text-right w-32">Running Balance</th>
                                  </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100 text-slate-800">
                                  
                                  {/* Opening Balance Line */}
                                  <tr className="bg-amber-50/40 font-semibold text-[11px]">
                                    <td className="py-2 px-3 text-center text-amber-700">★</td>
                                    <td className="py-2 px-3 text-amber-900">{startDate}</td>
                                    <td className="py-2 px-3 text-amber-900" colSpan={3}>
                                      OPENING BALANCE BROUGHT FORWARD
                                    </td>
                                    <td className="py-2 px-3 text-right text-slate-400">-</td>
                                    <td className="py-2 px-3 text-right text-slate-400">-</td>
                                    <td className="py-2 px-3 text-right font-mono font-bold">
                                      <span className={pState.openingBalance >= 0 ? "text-rose-700" : "text-emerald-700"}>
                                        ₹{Math.abs(pState.openingBalance).toLocaleString('en-IN', { minimumFractionDigits: 2 })} {pState.openingBalance >= 0 ? 'Dr' : 'Cr'}
                                      </span>
                                    </td>
                                  </tr>

                                  {pState.transactions.length === 0 ? (
                                    <tr>
                                      <td colSpan={8} className="py-4 text-center text-slate-400 italic">
                                        No transactions recorded for this account in the selected date range.
                                      </td>
                                    </tr>
                                  ) : (
                                    pState.transactions.map((tx, tIdx) => (
                                      <tr
                                        key={tx.id}
                                        onClick={() => setSelectedDetailTx(tx.rawTx)}
                                        className="hover:bg-blue-50/40 cursor-pointer transition-colors"
                                      >
                                        <td className="py-2 px-3 text-center text-slate-400 text-[10px] font-mono">
                                          {tIdx + 1}
                                        </td>
                                        <td className="py-2 px-3 whitespace-nowrap">
                                          <span className="font-semibold text-slate-900 block">{tx.dateFormatted}</span>
                                          <span className="text-[10px] text-slate-400 block">{tx.timeFormatted}</span>
                                        </td>
                                        <td className="py-2 px-3">
                                          <span className="font-medium text-slate-800">{tx.particulars}</span>
                                        </td>
                                        <td className="py-2 px-3 font-mono">
                                          {tx.invoiceNo !== '-' ? (
                                            <span className="bg-slate-100 text-slate-700 px-1.5 py-0.5 rounded text-[11px] border border-slate-200">
                                              #{tx.invoiceNo}
                                            </span>
                                          ) : (
                                            <span className="text-slate-400">-</span>
                                          )}
                                        </td>
                                        <td className="py-2 px-3 whitespace-nowrap">
                                          <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-slate-100 text-slate-700 uppercase">
                                            {tx.paymentMode}
                                          </span>
                                        </td>
                                        <td className="py-2 px-3 text-right font-mono font-semibold text-rose-700">
                                          {tx.debit > 0 ? `₹${tx.debit.toLocaleString('en-IN', { minimumFractionDigits: 2 })}` : '-'}
                                        </td>
                                        <td className="py-2 px-3 text-right font-mono font-semibold text-emerald-700">
                                          {tx.credit > 0 ? `₹${tx.credit.toLocaleString('en-IN', { minimumFractionDigits: 2 })}` : '-'}
                                        </td>
                                        <td className="py-2 px-3 text-right font-mono font-bold">
                                          <span>₹{Math.abs(tx.runningBalance).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
                                          <span className={`ml-1 text-[9px] px-1 py-0.2 rounded font-bold ${
                                            tx.runningBalance >= 0 ? 'bg-rose-100 text-rose-800' : 'bg-emerald-100 text-emerald-800'
                                          }`}>
                                            {tx.runningBalance >= 0 ? 'Dr' : 'Cr'}
                                          </span>
                                        </td>
                                      </tr>
                                    ))
                                  )}

                                </tbody>

                                {/* Party Subtotal Footer */}
                                <tfoot className="bg-slate-50 border-t border-slate-200 font-bold text-slate-800 text-[11px]">
                                  <tr>
                                    <td colSpan={5} className="py-2.5 px-3 text-right uppercase text-slate-500">
                                      Total for {pState.party.name}:
                                    </td>
                                    <td className="py-2.5 px-3 text-right font-mono text-rose-700">
                                      ₹{pState.totalDebits.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                                    </td>
                                    <td className="py-2.5 px-3 text-right font-mono text-emerald-700">
                                      ₹{pState.totalCredits.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                                    </td>
                                    <td className="py-2.5 px-3 text-right font-mono font-bold text-slate-900">
                                      ₹{Math.abs(pState.closingBalance).toLocaleString('en-IN', { minimumFractionDigits: 2 })} {pState.closingBalance >= 0 ? 'Dr' : 'Cr'}
                                    </td>
                                  </tr>
                                </tfoot>

                              </table>
                            </div>
                          )}

                        </Card>
                      );
                    })}
                  </div>

                </div>
              );
            })
          )}
        </div>
      )}

      {/* ------------------------------------------------------------- */}
      {/* VIEW 2: CONTINUOUS TIMELINE STATEMENT VIEW */}
      {/* ------------------------------------------------------------- */}
      {viewMode === 'flat' && (
        <Card className="overflow-hidden shadow-2xs border-slate-200">
          <div className="px-4 py-3 bg-slate-50/80 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <BookOpen size={16} className="text-[#0055a5]" />
              <h2 className="text-xs sm:text-sm font-bold text-slate-900">
                Continuous Ledger Timeline ({flatChronologicalRows.length} records)
              </h2>
            </div>
            <div className="text-xs text-slate-500">
              Period: <strong className="text-slate-800">{startDate}</strong> to <strong className="text-slate-800">{endDate}</strong>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-slate-100/90 text-slate-700 font-bold uppercase tracking-wider text-[11px] border-b border-slate-200">
                  <th className="py-2.5 px-3 text-center w-10">#</th>
                  <th className="py-2.5 px-3">Date & Time</th>
                  <th className="py-2.5 px-3">Party / Account</th>
                  <th className="py-2.5 px-3">Particulars / Notes</th>
                  <th className="py-2.5 px-3">Voucher #</th>
                  <th className="py-2.5 px-3">Ledger</th>
                  <th className="py-2.5 px-3">Mode</th>
                  <th className="py-2.5 px-3 text-right">Debit (Dr)</th>
                  <th className="py-2.5 px-3 text-right">Credit (Cr)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-slate-800">
                {flatChronologicalRows.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="py-12 text-center text-slate-400">
                      <FileText size={32} className="mx-auto mb-2 text-slate-300 opacity-60" />
                      <p className="font-semibold text-slate-600 text-sm">No transactions found in this period.</p>
                    </td>
                  </tr>
                ) : (
                  flatChronologicalRows.map((row, idx) => (
                    <tr
                      key={row.id}
                      onClick={() => setSelectedDetailTx(row.rawTx)}
                      className="hover:bg-blue-50/40 cursor-pointer transition-colors"
                    >
                      <td className="py-2 px-3 text-center text-slate-400 text-[11px] font-mono">{idx + 1}</td>
                      <td className="py-2 px-3 whitespace-nowrap">
                        <span className="font-semibold text-slate-900 block">{row.dateFormatted}</span>
                        <span className="text-[10px] text-slate-400 block">{row.timeFormatted}</span>
                      </td>
                      <td className="py-2 px-3 font-bold text-slate-900">{row.partyName}</td>
                      <td className="py-2 px-3 text-slate-600 truncate max-w-xs">{row.particulars}</td>
                      <td className="py-2 px-3 font-mono">
                        {row.invoiceNo !== '-' ? (
                          <span className="bg-slate-100 text-slate-700 px-1.5 py-0.5 rounded text-[11px] border border-slate-200">
                            #{row.invoiceNo}
                          </span>
                        ) : '-'}
                      </td>
                      <td className="py-2 px-3 text-slate-600">{row.ledgerName}</td>
                      <td className="py-2 px-3 uppercase text-[10px] font-semibold text-slate-700">{row.paymentMode}</td>
                      <td className="py-2 px-3 text-right font-mono font-semibold text-rose-700">
                        {row.debit > 0 ? `₹${row.debit.toLocaleString('en-IN', { minimumFractionDigits: 2 })}` : '-'}
                      </td>
                      <td className="py-2 px-3 text-right font-mono font-semibold text-emerald-700">
                        {row.credit > 0 ? `₹${row.credit.toLocaleString('en-IN', { minimumFractionDigits: 2 })}` : '-'}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
              <tfoot className="bg-slate-100 border-t-2 border-slate-300 font-bold text-slate-900 text-xs">
                <tr>
                  <td colSpan={7} className="py-3 px-3 text-right uppercase tracking-wider text-[11px] text-slate-600">
                    Total Movement:
                  </td>
                  <td className="py-3 px-3 text-right font-mono text-rose-700">
                    ₹{globalSummary.totalDebits.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                  </td>
                  <td className="py-3 px-3 text-right font-mono text-emerald-700">
                    ₹{globalSummary.totalCredits.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </Card>
      )}

    </div>
  );
}
