import React, { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { getApiUrl } from '../firebase';
import { Party, Transaction, Ledger } from '../types';
import { 
  FileText, 
  Clock, 
  AlertCircle, 
  Printer, 
  ShieldCheck, 
  TrendingUp, 
  TrendingDown, 
  Building2, 
  Phone, 
  MapPin, 
  CheckCircle2,
  Calendar,
  DollarSign
} from 'lucide-react';
import { format } from 'date-fns';
import { formatAmountInWords } from '../lib/numberToWords';

export default function SharedLedgerView() {
  const { token } = useParams<{ token: string }>();
  const [isLoading, setIsLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isExpired, setIsExpired] = useState(false);

  const [party, setParty] = useState<Party | null>(null);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [ledger, setLedger] = useState<Ledger | null>(null);
  const [expiresAt, setExpiresAt] = useState<number | null>(null);
  const [timeLeftStr, setTimeLeftStr] = useState<string>('');

  useEffect(() => {
    let isMounted = true;

    async function fetchLedger() {
      if (!token) {
        setIsLoading(false);
        setErrorMsg('Invalid or missing link token.');
        return;
      }

      setIsLoading(true);
      setErrorMsg(null);
      setIsExpired(false);

      try {
        const res = await fetch(getApiUrl(`/api/shared-ledger/${token}`));
        const data = await res.json();

        if (!isMounted) return;

        if (res.status === 410 || data.expired) {
          setIsExpired(true);
          setErrorMsg(data.error || 'This ledger link has expired. Please request a new link.');
          return;
        }

        if (!res.ok || !data.success) {
          setErrorMsg(data.error || 'Unable to load ledger statement. Please request a new link.');
          return;
        }

        setParty(data.party);
        setTransactions(data.transactions || []);
        setLedger(data.ledger || null);
        setExpiresAt(data.expiresAt);
      } catch (err: any) {
        if (!isMounted) return;
        console.error('Failed to load shared ledger:', err);
        setErrorMsg('Network error while verifying ledger link. Please try again.');
      } finally {
        if (isMounted) setIsLoading(false);
      }
    }

    fetchLedger();

    return () => {
      isMounted = false;
    };
  }, [token]);

  // Real-time countdown calculation based on expiresAt
  useEffect(() => {
    if (!expiresAt) return;

    const interval = setInterval(() => {
      const now = Date.now();
      const diff = expiresAt - now;

      if (diff <= 0) {
        setTimeLeftStr('0m 0s');
        setIsExpired(true);
        setErrorMsg('This ledger link has expired. Please request a new link.');
        clearInterval(interval);
      } else {
        const mins = Math.floor(diff / 60000);
        const secs = Math.floor((diff % 60000) / 1000);
        setTimeLeftStr(`${mins}m ${secs < 10 ? '0' : ''}${secs}s`);
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [expiresAt]);

  // Calculate Running Balances & Summary
  const { ledgerRows, totalDebits, totalCredits, openingBalance, closingBalance } = React.useMemo(() => {
    if (!party) {
      return { ledgerRows: [], totalDebits: 0, totalCredits: 0, openingBalance: 0, closingBalance: 0 };
    }

    const opening = party.openingBalance || 0;
    // Sort transactions chronologically ascending
    const sorted = [...transactions].sort((a, b) => a.timestamp - b.timestamp);

    let running = opening;
    let debits = 0;
    let credits = 0;

    const rows = sorted.map((tx, idx) => {
      const isDebit = tx.type === 'DEBIT';
      const amt = tx.amount || 0;

      if (isDebit) {
        running += amt;
        debits += amt;
      } else {
        running -= amt;
        credits += amt;
      }

      return {
        id: tx.id || String(idx),
        index: idx + 1,
        timestamp: tx.timestamp,
        dateFormatted: tx.date || (tx.timestamp ? format(new Date(tx.timestamp), 'dd/MM/yyyy') : '-'),
        timeFormatted: tx.timestamp ? format(new Date(tx.timestamp), 'hh:mm a') : '',
        invoiceNo: tx.invoiceNo || '-',
        particulars: tx.notes || (isDebit ? 'Debit Voucher / Goods' : 'Payment Received / Credit'),
        paymentMode: tx.paymentMode || (isDebit ? 'Bill / Invoice' : 'Cash'),
        debit: isDebit ? amt : 0,
        credit: !isDebit ? amt : 0,
        runningBalance: running
      };
    });

    return {
      ledgerRows: rows,
      totalDebits: debits,
      totalCredits: credits,
      openingBalance: opening,
      closingBalance: running
    };
  }, [party, transactions]);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4 font-sans">
        <div className="bg-white rounded-2xl shadow-xl border border-slate-200 p-8 max-w-sm w-full text-center space-y-4">
          <div className="w-12 h-12 rounded-full border-4 border-blue-200 border-t-[#0055a5] animate-spin mx-auto" />
          <h2 className="text-sm font-bold text-slate-800">Verifying Shared Ledger Link...</h2>
          <p className="text-xs text-slate-500">Checking secure server-side token & validity.</p>
        </div>
      </div>
    );
  }

  if (isExpired || errorMsg) {
    return (
      <div className="min-h-screen bg-slate-100 flex items-center justify-center p-4 font-sans">
        <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 p-8 max-w-md w-full text-center space-y-5 animate-in fade-in zoom-in-95 duration-200">
          <div className="w-16 h-16 rounded-2xl bg-amber-50 border border-amber-200 text-amber-600 flex items-center justify-center mx-auto shadow-xs">
            <Clock size={32} />
          </div>
          <div>
            <h1 className="text-lg font-bold text-slate-900 mb-2">
              {isExpired ? 'Link Expired' : 'Access Notice'}
            </h1>
            <p className="text-sm font-medium text-slate-700 leading-relaxed bg-amber-50/70 p-3.5 rounded-xl border border-amber-200/60">
              {errorMsg || 'This ledger link has expired. Please request a new link.'}
            </p>
          </div>
          <div className="pt-2 text-xs text-slate-500 space-y-2 border-t border-slate-100">
            <p className="flex items-center justify-center gap-1.5 text-slate-600 font-semibold">
              <ShieldCheck size={14} className="text-blue-600" />
              Security Policy Notice
            </p>
            <p className="leading-relaxed">
              For financial privacy and security, customer statement links are temporary and automatically expire exactly 30 minutes after generation.
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (!party) return null;

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 font-sans pb-12 print:bg-white print:pb-0">
      
      {/* Top Banner Notice (Hidden in Print) */}
      <div className="bg-slate-900 text-white px-4 py-2 text-xs print:hidden shadow-sm">
        <div className="max-w-5xl mx-auto flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            <span className="font-semibold text-slate-200">Official Customer Ledger • Read-Only View</span>
          </div>
          <div className="flex items-center gap-3">
            {timeLeftStr && (
              <span className="bg-slate-800 border border-slate-700 px-2.5 py-0.5 rounded text-[11px] font-mono text-amber-300 font-bold flex items-center gap-1">
                <Clock size={12} />
                <span>Link expires in: {timeLeftStr}</span>
              </span>
            )}
            <button
              type="button"
              onClick={() => window.print()}
              className="px-3 py-1 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded text-xs flex items-center gap-1.5 transition-colors cursor-pointer"
            >
              <Printer size={13} />
              <span>Print / PDF</span>
            </button>
          </div>
        </div>
      </div>

      <div className="max-w-5xl mx-auto p-4 sm:p-6 space-y-4">
        
        {/* Statement Header Card */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-2xs p-5 sm:p-6">
          <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4 pb-4 border-b border-slate-100">
            <div>
              <div className="flex items-center gap-2">
                <Building2 size={20} className="text-[#0055a5]" />
                <h1 className="text-xl font-black text-slate-900 tracking-tight">
                  {ledger?.name || 'Greenzar Food & Beverage ERP'}
                </h1>
              </div>
              <p className="text-xs text-slate-500 mt-0.5">Account Statement & Financial Ledger</p>
            </div>

            <div className="text-left sm:text-right space-y-0.5 text-xs">
              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10.5px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                <ShieldCheck size={12} />
                Verified Customer Link
              </span>
              <p className="text-slate-500 mt-1">Generated: {format(new Date(), 'dd-MMM-yyyy hh:mm a')}</p>
            </div>
          </div>

          {/* Customer Profile Box */}
          <div className="mt-4 pt-1 grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
            <div className="bg-slate-50 border border-slate-200/80 rounded-xl p-3.5 space-y-1">
              <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Customer Name</p>
              <p className="text-base font-bold text-slate-900">{party.name}</p>
              {party.phone && (
                <p className="text-slate-600 flex items-center gap-1.5 pt-0.5">
                  <Phone size={12} className="text-slate-400" />
                  <span>{party.phone}</span>
                </p>
              )}
              {party.address && (
                <p className="text-slate-600 flex items-center gap-1.5">
                  <MapPin size={12} className="text-slate-400" />
                  <span>{party.address}</span>
                </p>
              )}
            </div>

            <div className="bg-slate-50 border border-slate-200/80 rounded-xl p-3.5 flex flex-col justify-between">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Current Outstanding Position</p>
                <div className="flex items-baseline gap-2 mt-1">
                  <span className={`text-2xl font-black font-mono ${closingBalance >= 0 ? 'text-rose-700' : 'text-emerald-700'}`}>
                    ₹{Math.abs(closingBalance).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </span>
                  <span className={`text-xs font-bold px-2 py-0.5 rounded ${closingBalance >= 0 ? 'bg-rose-100 text-rose-800' : 'bg-emerald-100 text-emerald-800'}`}>
                    {closingBalance >= 0 ? 'Dr (Due Payable)' : 'Cr (Advance Received)'}
                  </span>
                </div>
              </div>

              {formatAmountInWords(Math.abs(closingBalance)) && (
                <p className="text-[10.5px] italic text-slate-600 mt-2 border-t border-slate-200/60 pt-1.5 truncate">
                  {formatAmountInWords(Math.abs(closingBalance))}
                </p>
              )}
            </div>
          </div>
        </div>

        {/* 4 Summary Cards */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
          <div className="bg-white p-3.5 rounded-xl border border-slate-200 shadow-2xs">
            <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block mb-1">Opening Balance</span>
            <div className={`text-sm sm:text-base font-bold font-mono ${openingBalance >= 0 ? 'text-slate-900' : 'text-emerald-600'}`}>
              ₹{Math.abs(openingBalance).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
              <span className="text-[10px] ml-1 font-sans">{openingBalance >= 0 ? 'Dr' : 'Cr'}</span>
            </div>
          </div>

          <div className="bg-white p-3.5 rounded-xl border border-slate-200 shadow-2xs">
            <span className="text-[10px] font-bold text-rose-600 uppercase tracking-wider block mb-1">Total Debits (+)</span>
            <div className="text-sm sm:text-base font-bold font-mono text-rose-700">
              ₹{totalDebits.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
            </div>
          </div>

          <div className="bg-white p-3.5 rounded-xl border border-slate-200 shadow-2xs">
            <span className="text-[10px] font-bold text-emerald-600 uppercase tracking-wider block mb-1">Total Credits (-)</span>
            <div className="text-sm sm:text-base font-bold font-mono text-emerald-700">
              ₹{totalCredits.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
            </div>
          </div>

          <div className="bg-white p-3.5 rounded-xl border border-slate-200 shadow-2xs">
            <span className="text-[10px] font-bold text-blue-700 uppercase tracking-wider block mb-1">Net Balance</span>
            <div className={`text-sm sm:text-base font-bold font-mono ${closingBalance >= 0 ? 'text-rose-700' : 'text-emerald-700'}`}>
              ₹{Math.abs(closingBalance).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
              <span className="text-[10px] ml-1 font-sans">{closingBalance >= 0 ? 'Dr' : 'Cr'}</span>
            </div>
          </div>
        </div>

        {/* Ledger Transactions Table */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-2xs overflow-hidden">
          <div className="px-5 py-3.5 border-b border-slate-200 flex items-center justify-between">
            <h3 className="font-bold text-slate-800 text-xs sm:text-sm flex items-center gap-2">
              <FileText size={16} className="text-[#0055a5]" />
              Detailed Ledger Transactions ({ledgerRows.length} entries)
            </h3>
            <span className="text-[10px] text-slate-400 font-mono">Date-wise chronological</span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-slate-600 uppercase tracking-wider text-[10px] font-bold">
                  <th className="py-2.5 px-3 w-10">#</th>
                  <th className="py-2.5 px-3">Date</th>
                  <th className="py-2.5 px-3">Invoice / Ref</th>
                  <th className="py-2.5 px-3">Particulars</th>
                  <th className="py-2.5 px-3">Mode</th>
                  <th className="py-2.5 px-3 text-right">Debit (+)</th>
                  <th className="py-2.5 px-3 text-right">Credit (-)</th>
                  <th className="py-2.5 px-3 text-right">Balance</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {/* Opening Balance Row */}
                <tr className="bg-slate-50/50 font-semibold text-slate-700 italic">
                  <td className="py-2.5 px-3">-</td>
                  <td className="py-2.5 px-3">-</td>
                  <td className="py-2.5 px-3">-</td>
                  <td className="py-2.5 px-3 font-bold text-slate-800">Opening Balance B/F</td>
                  <td className="py-2.5 px-3">-</td>
                  <td className="py-2.5 px-3 text-right font-mono">{openingBalance > 0 ? `₹${openingBalance.toFixed(2)}` : '-'}</td>
                  <td className="py-2.5 px-3 text-right font-mono">{openingBalance < 0 ? `₹${Math.abs(openingBalance).toFixed(2)}` : '-'}</td>
                  <td className={`py-2.5 px-3 text-right font-mono font-bold ${openingBalance >= 0 ? 'text-rose-700' : 'text-emerald-700'}`}>
                    ₹{Math.abs(openingBalance).toFixed(2)} {openingBalance >= 0 ? 'Dr' : 'Cr'}
                  </td>
                </tr>

                {ledgerRows.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="py-8 text-center text-slate-400 italic">
                      No transaction entries recorded for this period.
                    </td>
                  </tr>
                ) : (
                  ledgerRows.map((row) => (
                    <tr key={row.id} className="hover:bg-slate-50/80 transition-colors">
                      <td className="py-2.5 px-3 text-slate-400 font-mono text-[10.5px]">{row.index}</td>
                      <td className="py-2.5 px-3 font-mono text-slate-800 whitespace-nowrap">
                        {row.dateFormatted}
                        {row.timeFormatted && <span className="block text-[9.5px] text-slate-400">{row.timeFormatted}</span>}
                      </td>
                      <td className="py-2.5 px-3 font-semibold text-blue-700 font-mono">{row.invoiceNo}</td>
                      <td className="py-2.5 px-3 text-slate-800 font-medium max-w-xs">{row.particulars}</td>
                      <td className="py-2.5 px-3 text-slate-500 uppercase text-[10px] font-semibold">{row.paymentMode}</td>
                      <td className="py-2.5 px-3 text-right font-mono font-semibold text-rose-700">
                        {row.debit > 0 ? `₹${row.debit.toLocaleString('en-IN', { minimumFractionDigits: 2 })}` : '-'}
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono font-semibold text-emerald-700">
                        {row.credit > 0 ? `₹${row.credit.toLocaleString('en-IN', { minimumFractionDigits: 2 })}` : '-'}
                      </td>
                      <td className={`py-2.5 px-3 text-right font-mono font-bold ${row.runningBalance >= 0 ? 'text-rose-700' : 'text-emerald-700'}`}>
                        ₹{Math.abs(row.runningBalance).toLocaleString('en-IN', { minimumFractionDigits: 2 })} {row.runningBalance >= 0 ? 'Dr' : 'Cr'}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
              <tfoot className="bg-slate-100 font-bold border-t-2 border-slate-300 text-xs text-slate-900">
                <tr>
                  <td colSpan={5} className="py-3 px-3 text-right uppercase tracking-wider text-[11px] text-slate-600">
                    Total Period Movement:
                  </td>
                  <td className="py-3 px-3 text-right font-mono text-rose-700">
                    ₹{totalDebits.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                  </td>
                  <td className="py-3 px-3 text-right font-mono text-emerald-700">
                    ₹{totalCredits.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                  </td>
                  <td className={`py-3 px-3 text-right font-mono font-black ${closingBalance >= 0 ? 'text-rose-700' : 'text-emerald-700'}`}>
                    ₹{Math.abs(closingBalance).toLocaleString('en-IN', { minimumFractionDigits: 2 })} {closingBalance >= 0 ? 'Dr' : 'Cr'}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>

        {/* Footer Note */}
        <div className="text-center text-[11px] text-slate-400 py-4 print:text-slate-600">
          <p>This is a computer-generated account statement provided via secure temporary link.</p>
          <p className="mt-0.5">Valid for 30 minutes from creation. All entries are subject to reconciliation.</p>
        </div>

      </div>
    </div>
  );
}
