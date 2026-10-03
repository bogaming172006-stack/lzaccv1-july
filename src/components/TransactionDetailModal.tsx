import React from 'react';
import { format } from 'date-fns';
import { X, Edit2, Trash2, Printer, Bluetooth } from 'lucide-react';
import { Transaction, Ledger } from '../types';
import { formatAmountInWords } from '../lib/numberToWords';

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
  const balanceChange = transaction.type === 'DEBIT' ? transaction.amount : -transaction.amount;
  const beforeAmount = transaction.beforeAmount !== undefined ? transaction.beforeAmount : (runningBalance !== undefined ? (runningBalance - balanceChange) : undefined);
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
        cleanNotes: remainingNotes || ''
      };
    }
    return {
      hasBreakdown: false,
      cashPart: null,
      acPart: null,
      cleanNotes: notesText || ''
    };
  };

  const breakdown = parseNotesBreakdown(transaction.notes || '');

  return (
    <div 
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/40 backdrop-blur-2xs"
      onClick={onClose}
    >
      <div 
        className="bg-white rounded-xl shadow-lg w-full max-w-sm overflow-hidden p-5 space-y-4"
        onClick={(e) => e.stopPropagation()}
        id="transaction-detail-modal"
      >
        {/* Header - Simple clean text */}
        <div className="flex justify-between items-center pb-2">
          <h3 className="font-semibold text-slate-900 text-sm tracking-tight">
            Transaction Details
          </h3>
          <div className="flex items-center gap-1.5">
            {isAdmin && onEdit && (
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onEdit(transaction);
                }}
                className="inline-flex items-center gap-1 px-2 py-1 text-slate-700 hover:text-slate-900 text-xs font-medium rounded hover:bg-slate-100 transition-colors"
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
                className="p-1 text-slate-400 hover:text-rose-600 rounded transition-colors"
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
              <X size={16} />
            </button>
          </div>
        </div>

        {/* Amount Section - Simple text, no background color, no border */}
        <div className="py-1">
          <div className="text-2xl font-bold tracking-tight tabular-nums text-slate-900">
            {transaction.type === 'DEBIT' ? '-' : '+'}₹{transaction.amount.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </div>
          <div className="text-xs text-slate-500 font-medium mt-0.5">
            {transaction.type === 'DEBIT' ? 'Debit (Dr) / Outflow' : 'Credit (Cr) / Inflow'}
          </div>
          {formatAmountInWords(transaction.amount) && (
            <div className="text-[11px] text-slate-500 italic mt-0.5">
              {formatAmountInWords(transaction.amount)}
            </div>
          )}
        </div>

        {/* Details List - All simple text rows, no background colors, no card borders */}
        <div className="space-y-2 text-xs text-slate-700">
          <div className="flex justify-between items-baseline gap-2">
            <span className="text-slate-500">{partyLabel}</span>
            <span className="font-semibold text-slate-900 text-right">{partyName}</span>
          </div>

          {ledgerName && (
            <div className="flex justify-between items-baseline gap-2">
              <span className="text-slate-500">Ledger</span>
              <span className="text-slate-800 text-right">{ledgerName}</span>
            </div>
          )}

          <div className="flex justify-between items-baseline gap-2">
            <span className="text-slate-500">Date & Time</span>
            <span className="text-slate-800 text-right">
              {format(new Date(transaction.timestamp), 'dd MMM yyyy, hh:mm a')}
            </span>
          </div>

          <div className="flex justify-between items-baseline gap-2">
            <span className="text-slate-500">Reference No</span>
            <span className="text-slate-800 font-mono text-right">
              {transaction.invoiceNo || 'None'}
            </span>
          </div>

          {runningBalance !== undefined && (
            <>
              {beforeAmount !== undefined && (
                <div className="flex justify-between items-baseline gap-2">
                  <span className="text-slate-500">Before Balance</span>
                  <span className="tabular-nums text-slate-800 text-right">
                    {beforeAmount === 0 ? '₹0.00' : beforeAmount > 0 ? `₹${Math.abs(beforeAmount).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} Dr` : `₹${Math.abs(beforeAmount).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} Cr`}
                  </span>
                </div>
              )}
              <div className="flex justify-between items-baseline gap-2">
                <span className="text-slate-500">After Balance</span>
                <span className="font-semibold tabular-nums text-slate-900 text-right">
                  {runningBalance === 0 ? '₹0.00' : runningBalance > 0 ? `₹${Math.abs(runningBalance).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} Dr` : `₹${Math.abs(runningBalance).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} Cr`}
                </span>
              </div>
            </>
          )}

          {breakdown.hasBreakdown && (
            <>
              {breakdown.cashPart && (
                <div className="flex justify-between items-baseline gap-2">
                  <span className="text-slate-500">Cash Amount</span>
                  <span className="text-slate-800 text-right font-medium">{breakdown.cashPart}</span>
                </div>
              )}
              {breakdown.acPart && (
                <div className="flex justify-between items-baseline gap-2">
                  <span className="text-slate-500">Bank A/C Amount</span>
                  <span className="text-slate-800 text-right font-medium">{breakdown.acPart}</span>
                </div>
              )}
            </>
          )}

          {breakdown.cleanNotes && breakdown.cleanNotes.trim() !== '' && (
            <div className="pt-1">
              <span className="text-slate-500 block">Notes</span>
              <p className="text-slate-800 whitespace-pre-wrap leading-relaxed mt-0.5">
                {breakdown.cleanNotes}
              </p>
            </div>
          )}
        </div>

        {/* Footer - Simple buttons without colored backgrounds */}
        <div className="pt-3 flex items-center justify-between gap-2">
          {onOpenReceipt ? (
            <button 
              type="button" 
              onClick={() => {
                onClose();
                onOpenReceipt(transaction);
              }} 
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-blue-700 hover:text-blue-900 hover:bg-blue-50/50 rounded-md font-medium text-xs transition-colors cursor-pointer"
              title="Print receipt voucher or connect to Bluetooth thermal printer"
            >
              <Printer size={13} />
              <Bluetooth size={12} className="text-blue-500 -ml-0.5" />
              <span>Print / BT Receipt</span>
            </button>
          ) : <div />}
          
          <button 
            type="button" 
            onClick={onClose} 
            className="px-4 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-800 rounded-md font-medium text-xs transition-colors cursor-pointer"
            id="ok-detail-modal-btn"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
