import React, { useState, useMemo } from 'react';
import { Party, Transaction } from '../types';
import { 
  X, 
  FileSpreadsheet, 
  Download, 
  Printer, 
  Copy, 
  Check, 
  Search, 
  ExternalLink,
  Users
} from 'lucide-react';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import * as XLSX from 'xlsx';
import { format, startOfMonth, endOfMonth, subMonths } from 'date-fns';

interface PartyStatementReportModalProps {
  isOpen: boolean;
  onClose: () => void;
  parties: Party[];
  transactions: Transaction[];
  allGroups: string[];
  initialGroup?: string;
  ledgerName?: string;
  userName?: string;
  currency?: string;
  isAdmin?: boolean;
  onSelectParty?: (partyId: string) => void;
}

export default function PartyStatementReportModal({
  isOpen,
  onClose,
  parties,
  transactions,
  allGroups,
  initialGroup = 'ALL',
  ledgerName = 'Main Account',
  userName = 'Operator',
  currency = '₹',
  isAdmin = true,
  onSelectParty
}: PartyStatementReportModalProps) {
  if (!isOpen || !isAdmin) return null;

  // Filter States
  const [selectedGroup, setSelectedGroup] = useState<string>(initialGroup);
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'DUE' | 'ADVANCE' | 'NON_ZERO' | 'ZERO'>('ALL');
  const [searchTerm, setSearchTerm] = useState('');
  const [sortOrder, setSortOrder] = useState<'due_desc' | 'due_asc' | 'name' | 'recent'>('due_desc');
  const [datePreset, setDatePreset] = useState<'all' | 'this_month' | 'last_month' | 'custom'>('all');
  const [startDate, setStartDate] = useState<string>(format(startOfMonth(new Date()), 'yyyy-MM-dd'));
  const [endDate, setEndDate] = useState<string>(format(endOfMonth(new Date()), 'yyyy-MM-dd'));
  
  // Feedback states
  const [copiedShare, setCopiedShare] = useState(false);
  const [isExportingPdf, setIsExportingPdf] = useState(false);
  const [isExportingExcel, setIsExportingExcel] = useState(false);

  // Group party counts mapping
  const groupCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    allGroups.forEach(grp => {
      counts[grp] = parties.filter(p => (p.group || '').trim().toLowerCase() === grp.toLowerCase()).length;
    });
    return counts;
  }, [parties, allGroups]);

  const ungroupedCount = useMemo(() => {
    return parties.filter(p => !p.group || p.group.trim() === '').length;
  }, [parties]);

  // Date range timestamps if custom/preset period is selected
  const dateRange = useMemo(() => {
    if (datePreset === 'all') return null;
    let startTs = 0;
    let endTs = Date.now();

    if (datePreset === 'this_month') {
      startTs = startOfMonth(new Date()).getTime();
      endTs = endOfMonth(new Date()).getTime();
    } else if (datePreset === 'last_month') {
      const prev = subMonths(new Date(), 1);
      startTs = startOfMonth(prev).getTime();
      endTs = endOfMonth(prev).getTime();
    } else if (datePreset === 'custom' && startDate && endDate) {
      startTs = new Date(`${startDate}T00:00:00`).getTime();
      endTs = new Date(`${endDate}T23:59:59`).getTime();
    }
    return { startTs, endTs };
  }, [datePreset, startDate, endDate]);

  // Map of transactions per party
  const partyTransactionsMap = useMemo(() => {
    const map = new Map<string, Transaction[]>();
    transactions.forEach(tx => {
      if (!tx.partyId) return;
      if (dateRange && (tx.timestamp < dateRange.startTs || tx.timestamp > dateRange.endTs)) {
        return;
      }
      const existing = map.get(tx.partyId) || [];
      existing.push(tx);
      map.set(tx.partyId, existing);
    });
    return map;
  }, [transactions, dateRange]);

  // Compile statement rows
  const partyRows = useMemo(() => {
    return parties
      .filter(p => {
        if (selectedGroup === 'ALL') return true;
        if (selectedGroup === '__UNGROUPED__') {
          return !p.group || p.group.trim() === '';
        }
        return (p.group || '').trim().toLowerCase() === selectedGroup.toLowerCase();
      })
      .filter(p => {
        if (statusFilter === 'DUE') return p.currentDue > 0;
        if (statusFilter === 'ADVANCE') return p.currentDue < 0;
        if (statusFilter === 'NON_ZERO') return Math.abs(p.currentDue) > 0.01;
        if (statusFilter === 'ZERO') return Math.abs(p.currentDue) <= 0.01;
        return true;
      })
      .filter(p => {
        if (!searchTerm.trim()) return true;
        const q = searchTerm.toLowerCase().trim();
        return (
          p.name.toLowerCase().includes(q) ||
          (p.phone || '').includes(q) ||
          (p.group || '').toLowerCase().includes(q)
        );
      })
      .map(p => {
        const txs = partyTransactionsMap.get(p.id) || [];
        let totalDebit = 0;
        let totalCredit = 0;
        txs.forEach(t => {
          if (t.type === 'DEBIT' || t.type === 'debit') totalDebit += t.amount || 0;
          else if (t.type === 'CREDIT' || t.type === 'credit') totalCredit += t.amount || 0;
        });

        return {
          party: p,
          totalDebit,
          totalCredit,
          txCount: txs.length,
          lastActivity: p.lastTransaction || (txs.length > 0 ? Math.max(...txs.map(t => t.timestamp)) : 0),
          netDue: p.currentDue
        };
      })
      .sort((a, b) => {
        if (sortOrder === 'name') return a.party.name.localeCompare(b.party.name);
        if (sortOrder === 'due_desc') return b.netDue - a.netDue;
        if (sortOrder === 'due_asc') return a.netDue - b.netDue;
        return (b.lastActivity || 0) - (a.lastActivity || 0);
      });
  }, [parties, selectedGroup, statusFilter, searchTerm, sortOrder, partyTransactionsMap]);

  // Statement Summary Totals
  const summary = useMemo(() => {
    let totalReceivable = 0;
    let receivableCount = 0;
    let totalPayable = 0;
    let payableCount = 0;
    let totalDebitSum = 0;
    let totalCreditSum = 0;

    partyRows.forEach(r => {
      if (r.netDue > 0) {
        totalReceivable += r.netDue;
        receivableCount++;
      } else if (r.netDue < 0) {
        totalPayable += Math.abs(r.netDue);
        payableCount++;
      }
      totalDebitSum += r.totalDebit;
      totalCreditSum += r.totalCredit;
    });

    const netPosition = totalReceivable - totalPayable;

    return {
      totalParties: partyRows.length,
      totalReceivable,
      receivableCount,
      totalPayable,
      payableCount,
      netPosition,
      totalDebitSum,
      totalCreditSum
    };
  }, [partyRows]);

  const getSelectedGroupLabel = () => {
    if (selectedGroup === 'ALL') return 'All Customers';
    if (selectedGroup === '__UNGROUPED__') return 'Ungrouped Customers';
    return `Group: ${selectedGroup}`;
  };

  // Export to PDF
  const handleExportPdf = () => {
    setIsExportingPdf(true);
    try {
      const doc = new jsPDF({
        orientation: 'portrait',
        unit: 'mm',
        format: 'a4'
      });

      // Top Header Banner
      doc.setFillColor(15, 23, 42); // Clean dark slate
      doc.rect(0, 0, 210, 22, 'F');

      doc.setTextColor(255, 255, 255);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(13);
      doc.text(ledgerName.toUpperCase(), 14, 10);
      doc.setFontSize(8.5);
      doc.setFont('helvetica', 'normal');
      doc.text('Customer Statement & Balance Report', 14, 16);

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(8.5);
      doc.text(`DATE: ${format(new Date(), 'dd-MMM-yyyy')}`, 196, 10, { align: 'right' });
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8);
      doc.text(`TIME: ${format(new Date(), 'hh:mm a')}`, 196, 16, { align: 'right' });

      // Scope info
      doc.setTextColor(15, 23, 42);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(10.5);
      doc.text(`STATEMENT SCOPE: ${getSelectedGroupLabel().toUpperCase()}`, 14, 30);

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8);
      doc.setTextColor(100, 116, 139);
      doc.text(`Parties: ${partyRows.length} | Generated by: ${userName}`, 14, 35);

      const periodText = datePreset === 'all' ? 'All Time' : `${startDate} to ${endDate}`;
      doc.text(`Period: ${periodText}`, 196, 30, { align: 'right' });
      doc.text(`Filter: ${statusFilter === 'ALL' ? 'All Balances' : statusFilter}`, 196, 35, { align: 'right' });

      // Summary Box
      const summaryBody = [
        [
          `Customers: ${partyRows.length}`,
          `Total Receivable: Rs. ${summary.totalReceivable.toLocaleString('en-IN', { minimumFractionDigits: 2 })} (${summary.receivableCount})`,
          `Total Payable: Rs. ${summary.totalPayable.toLocaleString('en-IN', { minimumFractionDigits: 2 })} (${summary.payableCount})`,
          `Net: Rs. ${Math.abs(summary.netPosition).toLocaleString('en-IN', { minimumFractionDigits: 2 })} ${summary.netPosition >= 0 ? 'Dr' : 'Cr'}`
        ]
      ];

      autoTable(doc, {
        startY: 39,
        body: summaryBody,
        theme: 'plain',
        bodyStyles: {
          fontSize: 8,
          fontStyle: 'bold',
          textColor: [15, 23, 42],
          fillColor: [248, 250, 252],
          cellPadding: 3
        },
        margin: { left: 14, right: 14 }
      });

      // Data Table
      const tableData = partyRows.map((r, idx) => {
        const dueType = r.netDue > 0 ? 'Receivable' : r.netDue < 0 ? 'Advance' : 'Settled';
        return [
          String(idx + 1),
          r.party.name,
          r.party.phone || '-',
          r.party.group || '-',
          r.totalDebit > 0 ? r.totalDebit.toFixed(2) : '-',
          r.totalCredit > 0 ? r.totalCredit.toFixed(2) : '-',
          `Rs. ${Math.abs(r.netDue).toFixed(2)}`,
          dueType
        ];
      });

      // Totals Row
      tableData.push([
        { content: 'TOTALS', colSpan: 4, styles: { fontStyle: 'bold', halign: 'right', fillColor: [241, 245, 249] } },
        { content: summary.totalDebitSum > 0 ? summary.totalDebitSum.toFixed(2) : '-', styles: { fontStyle: 'bold', fillColor: [241, 245, 249] } },
        { content: summary.totalCreditSum > 0 ? summary.totalCreditSum.toFixed(2) : '-', styles: { fontStyle: 'bold', fillColor: [241, 245, 249] } },
        { content: `Rs. ${Math.abs(summary.netPosition).toFixed(2)}`, styles: { fontStyle: 'bold', fillColor: [241, 245, 249] } },
        { content: summary.netPosition >= 0 ? 'Net Dr' : 'Net Cr', styles: { fontStyle: 'bold', fillColor: [241, 245, 249] } }
      ]);

      autoTable(doc, {
        startY: (doc as any).lastAutoTable ? (doc as any).lastAutoTable.finalY + 4 : 54,
        head: [['#', 'Customer Name', 'Phone', 'Group', 'Sales (Rs)', 'Paid (Rs)', 'Balance', 'Status']],
        body: tableData,
        theme: 'striped',
        headStyles: {
          fillColor: [15, 23, 42],
          textColor: [255, 255, 255],
          fontSize: 8,
          fontStyle: 'bold',
          cellPadding: 2.5
        },
        bodyStyles: {
          fontSize: 7.5,
          textColor: [30, 41, 59],
          cellPadding: 2.5
        },
        columnStyles: {
          0: { cellWidth: 8, halign: 'center' },
          1: { cellWidth: 44, fontStyle: 'bold' },
          2: { cellWidth: 24 },
          3: { cellWidth: 22 },
          4: { cellWidth: 24, halign: 'right' },
          5: { cellWidth: 24, halign: 'right' },
          6: { cellWidth: 28, halign: 'right', fontStyle: 'bold' },
          7: { cellWidth: 22, halign: 'center' }
        },
        margin: { left: 14, right: 14 }
      });

      const cleanFileName = `Statement_${selectedGroup === 'ALL' ? 'All_Parties' : selectedGroup.replace(/\s+/g, '_')}_${format(new Date(), 'yyyyMMdd')}.pdf`;
      doc.save(cleanFileName);
    } catch (err) {
      console.error('Failed to export PDF statement:', err);
      alert('Failed to generate PDF report.');
    } finally {
      setIsExportingPdf(false);
    }
  };

  // Export to Excel (XLSX)
  const handleExportExcel = () => {
    setIsExportingExcel(true);
    try {
      const wb = XLSX.utils.book_new();

      const excelRows: any[][] = [
        [`${ledgerName.toUpperCase()} - CUSTOMER STATEMENT REPORT`],
        [`Scope: ${getSelectedGroupLabel()}`, `Generated: ${format(new Date(), 'dd-MMM-yyyy hh:mm a')}`, `By: ${userName}`],
        [],
        ['Summary Totals'],
        ['Total Customers', partyRows.length],
        ['Total Receivable (Rs.)', summary.totalReceivable, `Parties: ${summary.receivableCount}`],
        ['Total Payable (Rs.)', summary.totalPayable, `Parties: ${summary.payableCount}`],
        ['Net Position (Rs.)', summary.netPosition, summary.netPosition >= 0 ? 'Net Dr' : 'Net Cr'],
        [],
        ['Sr #', 'Customer Name', 'Phone', 'Group', 'Address', 'Sales / Debit (Rs.)', 'Paid / Credit (Rs.)', 'Current Balance (Rs.)', 'Status', 'Last Activity']
      ];

      partyRows.forEach((r, idx) => {
        excelRows.push([
          idx + 1,
          r.party.name,
          r.party.phone || '',
          r.party.group || '',
          r.party.address || '',
          r.totalDebit,
          r.totalCredit,
          r.netDue,
          r.netDue > 0 ? 'Receivable' : r.netDue < 0 ? 'Advance' : 'Settled',
          r.lastActivity ? format(new Date(r.lastActivity), 'dd-MMM-yyyy') : '-'
        ]);
      });

      excelRows.push([]);
      excelRows.push([
        'TOTALS',
        '',
        '',
        '',
        '',
        summary.totalDebitSum,
        summary.totalCreditSum,
        summary.netPosition,
        summary.netPosition >= 0 ? 'Net Dr' : 'Net Cr',
        ''
      ]);

      const ws = XLSX.utils.aoa_to_sheet(excelRows);
      ws['!cols'] = [
        { wch: 6 },
        { wch: 28 },
        { wch: 16 },
        { wch: 16 },
        { wch: 24 },
        { wch: 16 },
        { wch: 16 },
        { wch: 18 },
        { wch: 14 },
        { wch: 14 }
      ];

      XLSX.utils.book_append_sheet(wb, ws, 'Customer Statement');
      const cleanFileName = `Statement_${selectedGroup === 'ALL' ? 'All' : selectedGroup.replace(/\s+/g, '_')}_${format(new Date(), 'yyyyMMdd')}.xlsx`;
      XLSX.writeFile(wb, cleanFileName);
    } catch (err) {
      console.error('Failed to export Excel statement:', err);
      alert('Failed to generate Excel report.');
    } finally {
      setIsExportingExcel(false);
    }
  };

  // Copy WhatsApp / Text Summary
  const handleCopySummary = () => {
    const text = `📊 *CUSTOMER STATEMENT REPORT*\n` +
      `🏢 *Ledger:* ${ledgerName}\n` +
      `📁 *Scope:* ${getSelectedGroupLabel()}\n` +
      `👥 *Customers:* ${partyRows.length}\n` +
      `--------------------------------\n` +
      `🔴 *Total Receivable:* ${currency}${summary.totalReceivable.toLocaleString('en-IN', { minimumFractionDigits: 2 })} (${summary.receivableCount} parties)\n` +
      `🟢 *Total Payable:* ${currency}${summary.totalPayable.toLocaleString('en-IN', { minimumFractionDigits: 2 })} (${summary.payableCount} parties)\n` +
      `⚖️ *Net Position:* ${currency}${Math.abs(summary.netPosition).toLocaleString('en-IN', { minimumFractionDigits: 2 })} ${summary.netPosition >= 0 ? '(Dr)' : '(Cr)'}\n` +
      `--------------------------------\n` +
      `📅 *Date:* ${format(new Date(), 'dd-MMM-yyyy hh:mm a')}`;

    navigator.clipboard.writeText(text);
    setCopiedShare(true);
    setTimeout(() => setCopiedShare(false), 2000);
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-2xs flex items-center justify-center p-2 sm:p-4 overflow-y-auto animate-in fade-in">
      <div 
        className="bg-white w-full max-w-4xl rounded-xl shadow-xl border border-slate-200/80 overflow-hidden flex flex-col max-h-[90vh]"
        onClick={e => e.stopPropagation()}
      >
        {/* Simple, Professional, Minimalist Header */}
        <div className="px-4 sm:px-5 py-3 border-b border-slate-200/80 flex items-center justify-between bg-white shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-md bg-slate-100 flex items-center justify-center text-slate-700">
              <FileSpreadsheet size={15} strokeWidth={2} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-semibold text-slate-900 tracking-tight">
                  Customer Statement Report
                </h2>
                <span className="text-[11px] font-medium text-slate-500 bg-slate-100 px-2 py-0.5 rounded">
                  {selectedGroup === 'ALL' ? 'All Customers' : selectedGroup}
                </span>
              </div>
              <p className="text-[11px] text-slate-400">
                {ledgerName} · Balances and transactions
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="p-1 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-md transition cursor-pointer"
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>

        {/* Clean, Streamlined Controls Toolbar */}
        <div className="px-4 sm:px-5 py-2.5 bg-slate-50/60 border-b border-slate-200/70 shrink-0">
          <div className="flex flex-wrap items-center justify-between gap-2">
            
            {/* Filters Group */}
            <div className="flex flex-wrap items-center gap-2 flex-1 min-w-[280px]">
              {/* Group Selector */}
              <div className="relative">
                <select
                  value={selectedGroup}
                  onChange={e => setSelectedGroup(e.target.value)}
                  className="bg-white border border-slate-200 hover:border-slate-300 rounded-lg pl-2.5 pr-7 py-1.5 text-xs font-medium text-slate-800 focus:outline-none focus:ring-1 focus:ring-slate-400 cursor-pointer shadow-2xs"
                >
                  <option value="ALL">All Groups ({parties.length})</option>
                  {allGroups.length > 0 && (
                    <optgroup label="Groups">
                      {allGroups.map(grp => (
                        <option key={grp} value={grp}>
                          {grp} ({groupCounts[grp] || 0})
                        </option>
                      ))}
                    </optgroup>
                  )}
                  {ungroupedCount > 0 && (
                    <option value="__UNGROUPED__">Ungrouped ({ungroupedCount})</option>
                  )}
                </select>
              </div>

              {/* Status Filter */}
              <select
                value={statusFilter}
                onChange={e => setStatusFilter(e.target.value as any)}
                className="bg-white border border-slate-200 hover:border-slate-300 rounded-lg px-2.5 py-1.5 text-xs font-medium text-slate-800 focus:outline-none focus:ring-1 focus:ring-slate-400 cursor-pointer shadow-2xs"
              >
                <option value="ALL">All Balances</option>
                <option value="DUE">Receivables (Due)</option>
                <option value="ADVANCE">Payables (Advance)</option>
                <option value="NON_ZERO">Outstanding Only</option>
                <option value="ZERO">Zero Balance Only</option>
              </select>

              {/* Period Filter */}
              <select
                value={datePreset}
                onChange={e => setDatePreset(e.target.value as any)}
                className="bg-white border border-slate-200 hover:border-slate-300 rounded-lg px-2.5 py-1.5 text-xs font-medium text-slate-800 focus:outline-none focus:ring-1 focus:ring-slate-400 cursor-pointer shadow-2xs"
              >
                <option value="all">All Time</option>
                <option value="this_month">This Month</option>
                <option value="last_month">Last Month</option>
                <option value="custom">Custom Range</option>
              </select>

              {/* In-report Search */}
              <div className="flex items-center bg-white border border-slate-200 rounded-lg px-2 py-1.5 w-36 sm:w-44 gap-1.5 shadow-2xs">
                <Search size={12} className="text-slate-400 shrink-0" />
                <input
                  type="text"
                  value={searchTerm}
                  onChange={e => setSearchTerm(e.target.value)}
                  placeholder="Search..."
                  className="bg-transparent border-none outline-none text-xs text-slate-800 placeholder:text-slate-400 w-full"
                />
                {searchTerm && (
                  <button 
                    onClick={() => setSearchTerm('')} 
                    className="text-slate-400 hover:text-slate-600 p-0.5 cursor-pointer"
                  >
                    <X size={11} />
                  </button>
                )}
              </div>
            </div>

            {/* Clean, Unified Action Buttons */}
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={handleCopySummary}
                className="px-2.5 py-1.5 bg-white hover:bg-slate-100 border border-slate-200 text-slate-700 rounded-lg text-xs font-medium transition cursor-pointer flex items-center gap-1.5 shadow-2xs active:scale-95"
                title="Copy Summary"
              >
                {copiedShare ? <Check size={13} className="text-emerald-600" /> : <Copy size={13} className="text-slate-500" />}
                <span className="hidden sm:inline">{copiedShare ? 'Copied' : 'Copy'}</span>
              </button>

              <button
                type="button"
                onClick={() => window.print()}
                className="px-2.5 py-1.5 bg-white hover:bg-slate-100 border border-slate-200 text-slate-700 rounded-lg text-xs font-medium transition cursor-pointer flex items-center gap-1.5 shadow-2xs active:scale-95"
                title="Print"
              >
                <Printer size={13} className="text-slate-500" />
                <span className="hidden sm:inline">Print</span>
              </button>

              <button
                type="button"
                onClick={handleExportExcel}
                disabled={isExportingExcel || partyRows.length === 0}
                className="px-2.5 py-1.5 bg-white hover:bg-slate-100 border border-slate-200 text-slate-700 disabled:opacity-50 rounded-lg text-xs font-medium transition cursor-pointer flex items-center gap-1.5 shadow-2xs active:scale-95"
                title="Export Excel"
              >
                <FileSpreadsheet size={13} className="text-emerald-600" />
                <span>{isExportingExcel ? '...' : 'Excel'}</span>
              </button>

              <button
                type="button"
                onClick={handleExportPdf}
                disabled={isExportingPdf || partyRows.length === 0}
                className="px-3 py-1.5 bg-slate-900 hover:bg-slate-800 text-white disabled:opacity-50 rounded-lg text-xs font-medium transition cursor-pointer flex items-center gap-1.5 shadow-xs active:scale-95"
                title="Download PDF"
              >
                <Download size={13} />
                <span>{isExportingPdf ? '...' : 'PDF'}</span>
              </button>
            </div>
          </div>

          {/* Inline Custom Date Picker (Only if custom selected) */}
          {datePreset === 'custom' && (
            <div className="flex items-center gap-2 pt-2 text-xs">
              <span className="text-slate-500 font-medium">From:</span>
              <input
                type="date"
                value={startDate}
                onChange={e => setStartDate(e.target.value)}
                className="bg-white border border-slate-200 rounded-md px-2 py-1 text-xs text-slate-800"
              />
              <span className="text-slate-500 font-medium">To:</span>
              <input
                type="date"
                value={endDate}
                onChange={e => setEndDate(e.target.value)}
                className="bg-white border border-slate-200 rounded-md px-2 py-1 text-xs text-slate-800"
              />
            </div>
          )}
        </div>

        {/* Minimalist Professional Summary Strip */}
        <div className="px-4 sm:px-5 py-2.5 bg-slate-50/40 border-b border-slate-100 flex flex-wrap items-center justify-between gap-3 text-xs shrink-0">
          <div className="flex items-center flex-wrap gap-x-5 gap-y-1">
            <div className="flex items-baseline gap-1.5">
              <span className="text-[11px] text-slate-400 font-medium">Customers</span>
              <span className="font-semibold text-slate-900 tabular-nums">{partyRows.length}</span>
            </div>

            <div className="h-3 w-px bg-slate-200 hidden sm:block" />

            <div className="flex items-baseline gap-1.5">
              <span className="text-[11px] text-slate-400 font-medium">Receivable</span>
              <span className="font-semibold text-rose-600 tabular-nums">
                {currency}{summary.totalReceivable.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
              </span>
              <span className="text-[10px] text-slate-400">({summary.receivableCount})</span>
            </div>

            <div className="h-3 w-px bg-slate-200 hidden sm:block" />

            <div className="flex items-baseline gap-1.5">
              <span className="text-[11px] text-slate-400 font-medium">Payable</span>
              <span className="font-semibold text-emerald-600 tabular-nums">
                {currency}{summary.totalPayable.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
              </span>
              <span className="text-[10px] text-slate-400">({summary.payableCount})</span>
            </div>

            <div className="h-3 w-px bg-slate-200 hidden sm:block" />

            <div className="flex items-baseline gap-1.5">
              <span className="text-[11px] text-slate-400 font-medium">Net</span>
              <span className="font-semibold text-slate-900 tabular-nums">
                {currency}{Math.abs(summary.netPosition).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
              </span>
              <span className="text-[10px] font-medium text-slate-500">
                {summary.netPosition >= 0 ? 'Dr (Due)' : 'Cr (Adv)'}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-1.5 text-[11px] text-slate-400">
            <span>Sort:</span>
            <select
              value={sortOrder}
              onChange={e => setSortOrder(e.target.value as any)}
              className="bg-transparent border-none text-[11px] text-slate-600 font-medium focus:outline-none cursor-pointer hover:text-slate-900 p-0"
            >
              <option value="due_desc">Due: High to Low</option>
              <option value="due_asc">Due: Low to High</option>
              <option value="name">Name (A-Z)</option>
              <option value="recent">Recent</option>
            </select>
          </div>
        </div>

        {/* Clean Minimalist Table */}
        <div className="flex-1 overflow-y-auto p-3 sm:p-4">
          {partyRows.length === 0 ? (
            <div className="py-12 text-center text-slate-400">
              <Users size={32} className="mx-auto text-slate-300 mb-2" />
              <p className="text-xs font-medium text-slate-600">No parties match your selected criteria.</p>
              <p className="text-[11px] text-slate-400 mt-0.5">Try selecting All Groups or resetting the balance filter.</p>
            </div>
          ) : (
            <div className="overflow-x-auto border border-slate-200/80 rounded-lg">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-slate-50/75 text-slate-500 font-medium border-b border-slate-200 text-[11px]">
                    <th className="py-2 px-3 text-center w-8">#</th>
                    <th className="py-2 px-3">Customer Name</th>
                    <th className="py-2 px-3">Group</th>
                    <th className="py-2 px-3">Phone</th>
                    <th className="py-2 px-3 text-right">Total Sales</th>
                    <th className="py-2 px-3 text-right">Total Paid</th>
                    <th className="py-2 px-3 text-right">Current Balance</th>
                    <th className="py-2 px-3 text-center">Status</th>
                    <th className="py-2 px-3 text-center w-8"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {partyRows.map((r, idx) => {
                    const isDue = r.netDue > 0;
                    const isAdv = r.netDue < 0;
                    return (
                      <tr key={r.party.id} className="hover:bg-slate-50/60 transition">
                        <td className="py-2 px-3 text-center text-slate-400 text-[11px]">
                          {idx + 1}
                        </td>
                        <td className="py-2 px-3">
                          <span className="font-semibold text-slate-900 block">
                            {r.party.name}
                          </span>
                          {r.party.address && (
                            <span className="text-[10.5px] text-slate-400 truncate max-w-xs block font-normal">
                              {r.party.address}
                            </span>
                          )}
                        </td>
                        <td className="py-2 px-3 text-slate-600 text-[11px]">
                          {r.party.group || <span className="text-slate-300">-</span>}
                        </td>
                        <td className="py-2 px-3 text-slate-500 font-mono text-[11px]">
                          {r.party.phone || <span className="text-slate-300">-</span>}
                        </td>
                        <td className="py-2 px-3 text-right text-slate-600 tabular-nums">
                          {r.totalDebit > 0 ? `${currency}${r.totalDebit.toLocaleString('en-IN', { minimumFractionDigits: 2 })}` : '-'}
                        </td>
                        <td className="py-2 px-3 text-right text-slate-600 tabular-nums">
                          {r.totalCredit > 0 ? `${currency}${r.totalCredit.toLocaleString('en-IN', { minimumFractionDigits: 2 })}` : '-'}
                        </td>
                        <td className="py-2 px-3 text-right font-medium tabular-nums">
                          <span className={isDue ? 'text-rose-600 font-semibold' : isAdv ? 'text-emerald-600 font-semibold' : 'text-slate-400'}>
                            {currency}{Math.abs(r.netDue).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          </span>
                        </td>
                        <td className="py-2 px-3 text-center">
                          {isDue ? (
                            <span className="text-[10.5px] font-medium text-rose-600">
                              Receivable
                            </span>
                          ) : isAdv ? (
                            <span className="text-[10.5px] font-medium text-emerald-600">
                              Advance
                            </span>
                          ) : (
                            <span className="text-[10.5px] text-slate-400">
                              Settled
                            </span>
                          )}
                        </td>
                        <td className="py-2 px-3 text-center">
                          <button
                            type="button"
                            onClick={() => {
                              if (onSelectParty) {
                                onSelectParty(r.party.id);
                              }
                            }}
                            className="p-1 text-slate-300 hover:text-slate-600 rounded transition cursor-pointer"
                            title="View Ledger"
                          >
                            <ExternalLink size={12} />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="bg-slate-50/75 font-semibold text-slate-800 border-t border-slate-200">
                    <td colSpan={4} className="py-2 px-3 text-right text-[11px] text-slate-500 uppercase tracking-wider">
                      Grand Totals ({partyRows.length}):
                    </td>
                    <td className="py-2 px-3 text-right tabular-nums text-slate-700">
                      {summary.totalDebitSum > 0 ? `${currency}${summary.totalDebitSum.toLocaleString('en-IN', { minimumFractionDigits: 2 })}` : '-'}
                    </td>
                    <td className="py-2 px-3 text-right tabular-nums text-slate-700">
                      {summary.totalCreditSum > 0 ? `${currency}${summary.totalCreditSum.toLocaleString('en-IN', { minimumFractionDigits: 2 })}` : '-'}
                    </td>
                    <td className={`py-2 px-3 text-right tabular-nums ${
                      summary.netPosition >= 0 ? 'text-rose-600' : 'text-emerald-600'
                    }`}>
                      {currency}{Math.abs(summary.netPosition).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                    </td>
                    <td className="py-2 px-3 text-center text-[10.5px] font-medium text-slate-500">
                      {summary.netPosition >= 0 ? 'Net Dr' : 'Net Cr'}
                    </td>
                    <td></td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </div>

        {/* Minimal Footer */}
        <div className="px-4 sm:px-5 py-2.5 bg-white border-t border-slate-200/70 flex items-center justify-between shrink-0">
          <span className="text-[11px] text-slate-400">
            {partyRows.length} {partyRows.length === 1 ? 'customer' : 'customers'} listed
          </span>
          <button
            type="button"
            onClick={onClose}
            className="px-3.5 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-xs font-medium transition cursor-pointer"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
