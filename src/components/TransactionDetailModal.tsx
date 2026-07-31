import React from 'react';
import { format } from 'date-fns';
import { X, Calendar, User, Hash, BookOpen, FileText, ArrowDownRight, ArrowUpRight, CreditCard, DollarSign, ShieldCheck } from 'lucide-react';
import { Transaction } from '../types';
import { useAuth } from '../AuthContext';

interface TransactionDetailModalProps {
  isOpen: boolean;
  onClose: () => void;
  transaction: Transaction | null;
  partyName: string;
  ledgerName?: string;
}

export default function TransactionDetailModal({
  isOpen,
  onClose,
  transaction,
  partyName,
  ledgerName
}: TransactionDetailModalProps) {
  const { currentUser } = useAuth();
  if (!isOpen || !transaction) return null;

  // Format running balance nicely if available
  const runningBalance = transaction.runningBalance;

  // Helper to parse notes for Cash / AC breakdown (e.g., "[Cash: ₹1500.00, A/C: ₹10500.00] - notes")
  const parseNotesBreakdown = (notesText: string) => {
    const bracketRegex = /^\[(Cash:\s*₹[^,\]]+)?(?:,\s*)?(A\/C:\s*₹[^\]]+)?\]/i;
    const match = notesText.match(bracketRegex);
    
    if (match) {
      const cashPart = match[1]; // Cash: ₹...
      const acPart = match[2]; // A/C: ₹...
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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-fade-in">
      <div 
        className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden transform transition-all border border-gray-100"
        onClick={(e) => e.stopPropagation()}
        id="transaction-detail-modal"
      >
        {/* Header */}
        <div className="flex justify-between items-center px-6 py-4 border-b border-gray-100 bg-gray-50/50">
          <div className="flex items-center gap-2">
            <span className={`p-1.5 rounded-lg ${transaction.type === 'DEBIT' ? 'bg-rose-50 text-rose-600' : 'bg-emerald-50 text-emerald-600'}`}>
              <FileText size={16} />
            </span>
            <h3 className="font-extrabold text-gray-900 tracking-tight text-base">Transaction Details</h3>
          </div>
          <button 
            type="button" 
            onClick={onClose} 
            className="text-gray-400 hover:text-gray-600 p-1.5 rounded-lg hover:bg-gray-100 transition-colors cursor-pointer"
            id="close-detail-modal-btn"
          >
            <X size={18} />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-5">
          {/* Amount Box */}
          <div className="text-center py-5 px-4 bg-gray-50/70 rounded-xl border border-gray-100">
            <span className={`text-[10px] uppercase font-bold tracking-widest leading-none block mb-1.5 ${transaction.type === 'DEBIT' ? 'text-rose-500' : 'text-emerald-500'}`}>
              {transaction.type === 'DEBIT' ? 'Debit (Dr) / Outflow' : 'Credit (Cr) / Inflow'}
            </span>
            <div className={`text-3xl font-extrabold tracking-tight ${transaction.type === 'DEBIT' ? 'text-rose-600' : 'text-emerald-600'}`}>
              {transaction.type === 'DEBIT' ? '-' : '+'}₹{transaction.amount.toLocaleString(undefined, { minimumFractionDigits: 2 })}
            </div>
          </div>

          {/* Core Info list */}
          <div className="space-y-3.5">
            {/* Party */}
            <div className="flex items-start gap-3">
              <User size={16} className="text-gray-400 mt-1 shrink-0" />
              <div className="min-w-0">
                <span className="text-[10px] text-gray-400 font-bold uppercase tracking-wider block leading-none mb-0.5">Party</span>
                <span className="font-bold text-gray-950 text-sm">{partyName}</span>
              </div>
            </div>

            {/* Ledger Name */}
            {ledgerName && (
              <div className="flex items-start gap-3">
                <BookOpen size={16} className="text-gray-400 mt-1 shrink-0" />
                <div className="min-w-0">
                  <span className="text-[10px] text-gray-400 font-bold uppercase tracking-wider block leading-none mb-0.5">Ledger / Book</span>
                  <span className="font-semibold text-gray-700 text-sm">{ledgerName}</span>
                </div>
              </div>
            )}

            {/* Date & Time */}
            <div className="flex items-start gap-3">
              <Calendar size={16} className="text-gray-400 mt-1 shrink-0" />
              <div className="min-w-0">
                <span className="text-[10px] text-gray-400 font-bold uppercase tracking-wider block leading-none mb-0.5">Date & Time</span>
                <span className="font-semibold text-gray-800 text-sm">
                  {format(new Date(transaction.timestamp), 'dd MMM yyyy, hh:mm a')}
                </span>
              </div>
            </div>

            {/* Reference No */}
            <div className="flex items-start gap-3">
              <Hash size={16} className="text-gray-400 mt-1 shrink-0" />
              <div className="min-w-0">
                <span className="text-[10px] text-gray-400 font-bold uppercase tracking-wider block leading-none mb-0.5">Reference / Ref No</span>
                <span className={`text-sm ${transaction.invoiceNo ? 'font-mono font-bold text-gray-900 bg-gray-100 px-1.5 py-0.5 rounded' : 'font-semibold text-gray-400 italic'}`}>
                  {transaction.invoiceNo || 'Not provided'}
                </span>
              </div>
            </div>

            {/* Entry By (Admin/Boss only) */}
            {currentUser?.isAdmin && (
              <div className="flex items-start gap-3">
                <ShieldCheck size={16} className="text-sky-500 mt-1 shrink-0" />
                <div className="min-w-0">
                  <span className="text-[10px] text-gray-400 font-bold uppercase tracking-wider block leading-none mb-0.5">Entry By</span>
                  <span className="font-bold text-slate-800 text-sm bg-slate-100 px-2 py-0.5 rounded border border-slate-200 inline-block">
                    {transaction.createdBy || 'Admin'}
                  </span>
                </div>
              </div>
            )}

            {/* Running Balance (if available) */}
            {runningBalance !== undefined && (
              <div className="flex items-start gap-3 border-t pt-3 border-gray-100">
                <div className={`p-1 rounded ${runningBalance > 0 ? 'bg-rose-50 text-rose-600' : runningBalance < 0 ? 'bg-emerald-50 text-emerald-600' : 'bg-gray-50 text-gray-600'}`}>
                  {runningBalance >= 0 ? <ArrowDownRight size={14} /> : <ArrowUpRight size={14} />}
                </div>
                <div className="min-w-0">
                  <span className="text-[10px] text-gray-400 font-bold uppercase tracking-wider block leading-none mb-0.5">Running Balance After Transaction</span>
                  <span className={`text-sm font-extrabold ${runningBalance > 0 ? 'text-rose-600' : runningBalance < 0 ? 'text-emerald-600' : 'text-gray-600'}`}>
                    {runningBalance === 0 ? '₹ 0.00' : runningBalance > 0 ? `-₹${Math.abs(runningBalance).toLocaleString(undefined, { minimumFractionDigits: 2 })} (Dr)` : `₹${Math.abs(runningBalance).toLocaleString(undefined, { minimumFractionDigits: 2 })} (Cr)`}
                  </span>
                </div>
              </div>
            )}
          </div>

          {/* Separate Payment Breakdown (if parsed) */}
          {breakdown.hasBreakdown && (
            <div className="p-3 bg-gray-50 rounded-xl border border-gray-100/70 space-y-2">
              <span className="text-[10px] text-gray-400 font-bold uppercase tracking-wider block leading-none mb-1">Payment Split Breakdown</span>
              <div className="grid grid-cols-2 gap-2.5">
                {breakdown.cashPart && (
                  <div className="flex items-center gap-1.5 bg-white p-2 rounded-lg border border-emerald-100/80">
                    <DollarSign size={14} className="text-emerald-500" />
                    <div className="min-w-0">
                      <span className="text-[9px] text-gray-400 block font-semibold leading-none">Cash</span>
                      <span className="font-extrabold text-emerald-700 text-xs">{breakdown.cashPart}</span>
                    </div>
                  </div>
                )}
                {breakdown.acPart && (
                  <div className="flex items-center gap-1.5 bg-white p-2 rounded-lg border border-sky-100/80">
                    <CreditCard size={14} className="text-sky-500" />
                    <div className="min-w-0">
                      <span className="text-[9px] text-gray-400 block font-semibold leading-none">Bank A/C</span>
                      <span className="font-extrabold text-sky-700 text-xs">{breakdown.acPart}</span>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Notes Card */}
          <div className="p-4 bg-gray-50/50 rounded-xl border border-gray-100/60">
            <span className="text-[10px] text-gray-400 font-bold uppercase tracking-wider block leading-none mb-1.5">Particulars / Notes</span>
            <p className="text-gray-700 text-xs sm:text-sm font-medium whitespace-pre-wrap leading-relaxed">
              {breakdown.cleanNotes}
            </p>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-gray-100 bg-gray-50/50 flex justify-end">
          <button 
            type="button" 
            onClick={onClose} 
            className="px-5 py-2 bg-gray-900 hover:bg-gray-850 active:scale-98 text-white rounded-xl font-bold text-xs transition-all cursor-pointer shadow-md shadow-gray-950/5"
            id="ok-detail-modal-btn"
          >
            Okay, Close
          </button>
        </div>
      </div>
    </div>
  );
}
