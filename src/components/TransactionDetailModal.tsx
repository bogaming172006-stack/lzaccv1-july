import React from 'react';
import { format } from 'date-fns';
import { X, Calendar, User, Hash, BookOpen, FileText, ArrowDownRight, ArrowUpRight, CreditCard, DollarSign, Printer, Download, Edit2, Trash2 } from 'lucide-react';
import { Transaction, Ledger } from '../types';

interface TransactionDetailModalProps {
  isOpen: boolean;
  onClose: () => void;
  transaction: Transaction | null;
  partyName: string;
  ledgerName?: string;
  ledgerType?: Ledger['type'];
  isAdmin?: boolean;
  onOpenReceipt?: (transaction: Transaction) => void;
  onEdit?: (transaction: Transaction) => void;
  onDelete?: (transaction: Transaction) => void;
}

export default function TransactionDetailModal({
  isOpen,
  onClose,
  transaction,
  partyName,
  ledgerName,
  ledgerType,
  isAdmin,
  onOpenReceipt,
  onEdit,
  onDelete
}: TransactionDetailModalProps) {
  if (!isOpen || !transaction) return null;

  const runningBalance = transaction.runningBalance;
  const isExp = ledgerType === 'EXPENSE';

  const partyLabel = isExp
    ? (transaction.type === 'DEBIT' ? 'Paid To' : 'Received From')
    : ledgerType === 'PURCHASE'
    ? (transaction.type === 'DEBIT' ? 'Paid To (Vendor)' : 'Supplier / Vendor')
    : ledgerType === 'SALE'
    ? (transaction.type === 'CREDIT' ? 'Received From' : 'Customer / Bill To')
    : (transaction.type === 'CREDIT' ? 'Received From' : 'Paid To / Party');

  // Helper to parse notes for Cash / AC breakdown
  const parseNotesBreakdown = (notesText: string) => {
    const bracketRegex = /^\[(Cash:\s*₹[^,\]]+)?(?:,\s*)?(A\/C:\s*₹[^\]]+)?\]/i;
    const match = notesText.match(bracketRegex);
    
    if (match) {
      const cashPart = match[1];
      const acPart = match[2];
      const remainingNotes = notesText.replace(bracketRegex, '').trim();
      return {
        hasBreakdown: true,
        cashPart: cashPart ? cashPart.replace(/Cash:\s*/i, '').trim() : null,
        acPart: acPart ? acPart.replace(/A\/C:\s*/i, '').trim() : null,
        cleanNotes: remainingNotes || 'No additional notes'
      };
    }
    return {
      hasBreakdown: false,
      cashPart: null,
      acPart: null,
      cleanNotes: notesText || 'No notes'
    };
  };

  const breakdown = parseNotesBreakdown(transaction.notes || '');

  return (
    <div 
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/50 backdrop-blur-2xs animate-fade-in"
      onClick={onClose}
    >
      <div 
        className="bg-white rounded-xl shadow-xl w-full max-w-sm overflow-hidden transform transition-all border border-slate-200"
        onClick={(e) => e.stopPropagation()}
        id="transaction-detail-modal"
      >
        {/* Header */}
        <div className="flex justify-between items-center px-3.5 py-2.5 sm:px-4 sm:py-3 border-b border-slate-100 bg-slate-50/80">
          <div className="flex items-center gap-1.5">
            <span className={`p-1 rounded-md ${transaction.type === 'DEBIT' ? 'bg-rose-50 text-rose-600' : 'bg-emerald-50 text-emerald-600'}`}>
              <FileText size={13} />
            </span>
            <h3 className="font-normal text-slate-800 text-xs sm:text-sm tracking-tight">Transaction Details</h3>
          </div>
          <div className="flex items-center gap-1">
            {isAdmin && onEdit && (
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onEdit(transaction);
                }}
                className="flex items-center gap-1 px-2 py-1 bg-blue-50 hover:bg-blue-100 text-blue-700 text-xs font-semibold rounded border border-blue-200 transition-colors"
                title="Edit Transaction"
              >
                <Edit2 size={12} />
                <span>Edit</span>
              </button>
            )}
            {isAdmin && onDelete && (
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onDelete(transaction);
                }}
                className="p-1 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded transition-colors"
                title="Delete Transaction"
              >
                <Trash2 size={14} />
              </button>
            )}
            <button 
              type="button" 
              onClick={onClose} 
              className="text-slate-400 hover:text-slate-600 p-1 rounded hover:bg-slate-100 transition-colors cursor-pointer"
              id="close-detail-modal-btn"
            >
              <X size={15} />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="p-3 sm:p-4 space-y-2.5 sm:space-y-3">
          {/* Amount Box */}
          <div className="text-center py-2.5 px-3 bg-slate-50/80 rounded-lg border border-slate-100">
            <span className={`text-[9.5px] min-[400px]:text-[10px] uppercase font-normal tracking-wider block mb-0.5 ${transaction.type === 'DEBIT' ? 'text-rose-500' : 'text-emerald-600'}`}>
              {transaction.type === 'DEBIT' ? 'Debit (Dr) / Outflow' : 'Credit (Cr) / Inflow'}
            </span>
            <div className={`text-base min-[400px]:text-lg sm:text-xl font-normal tracking-tight tabular-nums ${transaction.type === 'DEBIT' ? 'text-rose-600' : 'text-emerald-600'}`}>
              {transaction.type === 'DEBIT' ? '-' : '+'}₹{transaction.amount.toLocaleString(undefined, { minimumFractionDigits: 2 })}
            </div>
          </div>

          {/* Core Info list */}
          <div className="space-y-2 text-[11px] min-[400px]:text-[11.5px] sm:text-xs">
            {/* Party / Payee / Head */}
            <div className="flex items-start gap-2">
              <User size={13} className="text-slate-400 mt-0.5 shrink-0" />
              <div className="min-w-0 flex-1 flex items-center justify-between gap-1">
                <span className="text-[9.5px] min-[400px]:text-[10px] text-slate-400 font-normal uppercase">{partyLabel}</span>
                <span className="font-semibold text-slate-800 truncate">{partyName}</span>
              </div>
            </div>

            {/* Ledger Name */}
            {ledgerName && (
              <div className="flex items-start gap-2">
                <BookOpen size={13} className="text-slate-400 mt-0.5 shrink-0" />
                <div className="min-w-0 flex-1 flex items-center justify-between gap-1">
                  <span className="text-[9.5px] min-[400px]:text-[10px] text-slate-400 font-normal uppercase">Ledger</span>
                  <span className="font-normal text-slate-700 truncate">{ledgerName}</span>
                </div>
              </div>
            )}

            {/* Date & Time */}
            <div className="flex items-start gap-2">
              <Calendar size={13} className="text-slate-400 mt-0.5 shrink-0" />
              <div className="min-w-0 flex-1 flex items-center justify-between gap-1">
                <span className="text-[9.5px] min-[400px]:text-[10px] text-slate-400 font-normal uppercase">Date & Time</span>
                <span className="font-normal text-slate-700">
                  {format(new Date(transaction.timestamp), 'dd MMM yyyy, hh:mm a')}
                </span>
              </div>
            </div>

            {/* Reference No */}
            <div className="flex items-start gap-2">
              <Hash size={13} className="text-slate-400 mt-0.5 shrink-0" />
              <div className="min-w-0 flex-1 flex items-center justify-between gap-1">
                <span className="text-[9.5px] min-[400px]:text-[10px] text-slate-400 font-normal uppercase">Reference</span>
                <span className={`font-normal ${transaction.invoiceNo ? 'text-slate-800 bg-slate-100 px-1.5 py-0.2 rounded' : 'text-slate-400 italic'}`}>
                  {transaction.invoiceNo || 'None'}
                </span>
              </div>
            </div>

            {/* Running Balance */}
            {runningBalance !== undefined && (
              <div className="flex items-start gap-2 border-t pt-2 border-slate-100">
                <div className={`p-0.5 rounded ${runningBalance > 0 ? 'text-rose-600' : runningBalance < 0 ? 'text-emerald-600' : 'text-slate-600'}`}>
                  {runningBalance >= 0 ? <ArrowDownRight size={13} /> : <ArrowUpRight size={13} />}
                </div>
                <div className="min-w-0 flex-1 flex items-center justify-between gap-1">
                  <span className="text-[9.5px] min-[400px]:text-[10px] text-slate-400 font-normal uppercase">Balance</span>
                  <span className={`font-normal tabular-nums ${runningBalance > 0 ? 'text-rose-600' : runningBalance < 0 ? 'text-emerald-600' : 'text-slate-600'}`}>
                    {runningBalance === 0 ? '₹0.00' : runningBalance > 0 ? `₹${Math.abs(runningBalance).toLocaleString(undefined, { minimumFractionDigits: 2 })} Dr` : `₹${Math.abs(runningBalance).toLocaleString(undefined, { minimumFractionDigits: 2 })} Cr`}
                  </span>
                </div>
              </div>
            )}
          </div>

          {/* Payment Breakdown (if parsed) */}
          {breakdown.hasBreakdown && (
            <div className="p-2 bg-slate-50 rounded-lg border border-slate-100 space-y-1.5">
              <span className="text-[9px] text-slate-400 font-normal uppercase tracking-wider block">Split Details</span>
              <div className="grid grid-cols-2 gap-1.5">
                {breakdown.cashPart && (
                  <div className="flex items-center gap-1 bg-white p-1.5 rounded border border-emerald-100">
                    <DollarSign size={12} className="text-emerald-500" />
                    <div className="min-w-0">
                      <span className="text-[8.5px] text-slate-400 block font-normal">Cash</span>
                      <span className="font-normal text-emerald-700 text-[10.5px]">{breakdown.cashPart}</span>
                    </div>
                  </div>
                )}
                {breakdown.acPart && (
                  <div className="flex items-center gap-1 bg-white p-1.5 rounded border border-sky-100">
                    <CreditCard size={12} className="text-sky-500" />
                    <div className="min-w-0">
                      <span className="text-[8.5px] text-slate-400 block font-normal">Bank A/C</span>
                      <span className="font-normal text-sky-700 text-[10.5px]">{breakdown.acPart}</span>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Notes Card */}
          <div className="p-2.5 bg-slate-50/70 rounded-lg border border-slate-100">
            <span className="text-[9px] min-[400px]:text-[9.5px] text-slate-400 font-normal uppercase tracking-wider block mb-0.5">Notes</span>
            <p className="text-slate-600 text-[10.5px] min-[400px]:text-[11px] sm:text-xs font-normal whitespace-pre-wrap leading-relaxed">
              {breakdown.cleanNotes}
            </p>
          </div>
        </div>

        {/* Footer */}
        <div className="px-3.5 py-2.5 sm:px-4 sm:py-3 border-t border-slate-100 bg-slate-50/90 flex items-center justify-between gap-2">
          {onOpenReceipt ? (
            <button 
              type="button" 
              onClick={() => {
                onClose();
                onOpenReceipt(transaction);
              }} 
              className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-blue-50 hover:bg-blue-100 text-blue-700 rounded-md font-semibold text-[11px] sm:text-xs transition-colors cursor-pointer border border-blue-200"
            >
              <Printer size={13} />
              <span>Download / Print Receipt</span>
            </button>
          ) : <div />}
          
          <button 
            type="button" 
            onClick={onClose} 
            className="px-3.5 py-1.5 bg-slate-800 hover:bg-slate-900 active:scale-98 text-white rounded-md font-semibold text-[11px] sm:text-xs transition-all cursor-pointer shadow-2xs"
            id="ok-detail-modal-btn"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
