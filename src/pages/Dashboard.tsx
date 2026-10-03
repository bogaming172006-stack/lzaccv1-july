import React, { useEffect, useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  TrendingUp, 
  TrendingDown, 
  Loader2, 
  BookOpen, 
  PlusCircle, 
  FolderPlus, 
  ArrowUpRight, 
  ArrowDownRight, 
  Calendar, 
  Wallet, 
  Users, 
  CreditCard,
  FileSpreadsheet,
  FileText,
  Building2,
  CheckCircle2,
  Clock,
  ArrowRight,
  RefreshCw,
  AlertTriangle,
  AlertCircle,
  Search,
  X,
  Package,
  Layers,
  Check,
  Eye,
  Phone,
  MapPin,
  Truck,
  ExternalLink,
  Printer,
  Bluetooth
} from 'lucide-react';
import { useLedger } from '../LedgerContext';
import { useAuth } from '../AuthContext';
import { format, startOfDay, endOfDay, parseISO } from 'date-fns';
import { syncCollection } from '../lib/syncCache';
import { getFilteredCacheItems } from '../lib/idbCache';
import { 
  BillingBill, 
  BillingBillItem,
  fetchBillingBills, 
  fetchBillItems,
  computeDeclarationSummary,
  getTodayKolkataDate,
  findMatchingParty 
} from '../lib/billingService';
import CompanyLogo from '../components/CompanyLogo';
import PageHeader from '../components/ui/PageHeader';
import StatCard from '../components/ui/StatCard';
import Badge from '../components/ui/Badge';
import AmountDisplay from '../components/ui/AmountDisplay';
import { Card, CardHeader, CardBody } from '../components/ui/Card';
import { Party, Transaction, DashboardSummary, LEDGER_TYPE_LABELS, Ledger } from '../types';
import ThermalReceiptModal from '../components/ThermalReceiptModal';
import { 
  printToBluetoothPrinter, 
  createBillReceiptData, 
  openRawBtBluetoothPrint,
  BluetoothPrinterStatus,
  getCachedPrinterName 
} from '../lib/bluetoothPrinter';

export default function Dashboard() {
  const { currentUser } = useAuth();
  const isAdmin = currentUser?.isAdmin ?? false;
  const { activeLedger, ledgers, createLedger, setActiveLedgerId } = useLedger();
  const navigate = useNavigate();
  const [allLedgerTxs, setAllLedgerTxs] = useState<Transaction[]>([]);
  const [parties, setParties] = useState<Party[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [newLedgerName, setNewLedgerName] = useState('');
  const [newLedgerType, setNewLedgerType] = useState<Ledger['type']>('SALE');
  const [createError, setCreateError] = useState<string | null>(null);
  const [isCreatingLedger, setIsCreatingLedger] = useState(false);

  // Stock Database Today's Bills State
  const [stockDate, setStockDate] = useState<string>(() => getTodayKolkataDate());
  const [stockBills, setStockBills] = useState<BillingBill[]>([]);
  const [isStockLoading, setIsStockLoading] = useState<boolean>(false);
  const [stockError, setStockError] = useState<string | null>(null);
  const [orderStatusFilter, setOrderStatusFilter] = useState<'DELIVERED_OR_APPROVED' | 'DELIVERED' | 'APPROVED' | 'PENDING' | 'OTHER' | 'ALL'>('DELIVERED_OR_APPROVED');
  const [stockFilterTab, setStockFilterTab] = useState<'pending' | 'all' | 'debited'>('pending');
  const [stockSearchQuery, setStockSearchQuery] = useState<string>('');
  const [selectedOrderDetails, setSelectedOrderDetails] = useState<{
    bill: BillingBill;
    isDebited: boolean;
    matchedTx?: Transaction;
  } | null>(null);
  const [orderItems, setOrderItems] = useState<BillingBillItem[]>([]);
  const [isLoadingItems, setIsLoadingItems] = useState<boolean>(false);
  const [bluetoothStatus, setBluetoothStatus] = useState<BluetoothPrinterStatus>({ state: 'idle' });
  const [thermalReceiptBill, setThermalReceiptBill] = useState<{ bill: BillingBill; items: BillingBillItem[] } | null>(null);

  const handlePrintOrderBluetooth = async (bill: BillingBill, items: BillingBillItem[]) => {
    const data = createBillReceiptData(
      bill,
      items.map(it => ({
        name: it.product_name,
        qty: it.qty,
        rate: it.rate,
        line_total: it.line_total,
        mark: it.mark_text
      })),
      'GREENZAR FOOD & BEVERAGE'
    );
    setBluetoothStatus({ state: 'connecting', message: 'Scanning Bluetooth thermal printers...' });
    const res = await printToBluetoothPrinter(data, st => setBluetoothStatus(st));
    if (res.success) {
      setTimeout(() => setBluetoothStatus({ state: 'idle' }), 4000);
    }
  };

  const handlePrintOrderRawBt = (bill: BillingBill, items: BillingBillItem[]) => {
    const data = createBillReceiptData(
      bill,
      items.map(it => ({
        name: it.product_name,
        qty: it.qty,
        rate: it.rate,
        line_total: it.line_total,
        mark: it.mark_text
      })),
      'GREENZAR FOOD & BEVERAGE'
    );
    openRawBtBluetoothPrint(data);
  };

  useEffect(() => {
    if (!selectedOrderDetails?.bill) {
      setOrderItems([]);
      setIsLoadingItems(false);
      return;
    }
    let isCancelled = false;
    setIsLoadingItems(true);
    const billIdOrNo = selectedOrderDetails.bill.id || selectedOrderDetails.bill.bill_no;
    fetchBillItems(billIdOrNo)
      .then(items => {
        if (!isCancelled) {
          setOrderItems(items || []);
          setIsLoadingItems(false);
        }
      })
      .catch(err => {
        console.error('Error fetching order items:', err);
        if (!isCancelled) {
          setOrderItems([]);
          setIsLoadingItems(false);
        }
      });
    return () => {
      isCancelled = true;
    };
  }, [selectedOrderDetails?.bill?.id, selectedOrderDetails?.bill?.bill_no]);

  const loadStockBills = async (dateToFetch?: string) => {
    setIsStockLoading(true);
    setStockError(null);
    try {
      const targetDate = dateToFetch || stockDate || getTodayKolkataDate();
      const res = await fetchBillingBills(targetDate);
      if (res.success) {
        setStockBills(res.bills);
      } else {
        setStockError(res.error || 'Failed to fetch bills from stock database');
      }
    } catch (err: any) {
      setStockError(err.message || 'Error fetching stock database bills');
    } finally {
      setIsStockLoading(false);
    }
  };

  // Load and Sync Local Cache
  const syncDashboardData = async () => {
    if (!activeLedger?.id) return;
    setIsLoading(true);
    try {
      // 1. Sync parties cache
      await syncCollection<Party>('parties', activeLedger.id, 'parties');
      const cachedParties = await getFilteredCacheItems<Party>('parties', p => p.ledgerId === activeLedger.id);
      setParties(cachedParties);

      // 2. Sync dashboard summary cache
      await syncCollection<DashboardSummary>('dashboard_summary', activeLedger.id, 'dashboard_summary');
      const cachedSummaries = await getFilteredCacheItems<DashboardSummary>('dashboard_summary', s => s.ledgerId === activeLedger.id);
      if (cachedSummaries.length > 0) {
        setSummary(cachedSummaries[0]);
      } else {
        setSummary({
          id: activeLedger.id,
          ledgerId: activeLedger.id,
          totalReceivable: cachedParties.filter(p => p.currentDue > 0).reduce((a, b) => a + b.currentDue, 0),
          totalPayable: cachedParties.filter(p => p.currentDue < 0).reduce((a, b) => a + Math.abs(b.currentDue), 0),
          totalTransactions: 0,
          totalParties: cachedParties.length
        });
      }

      // 3. Index-free transactions caching and filtering
      await syncCollection<Transaction>('transactions', activeLedger.id, 'transactions');
      const cachedTxs = await getFilteredCacheItems<Transaction>('transactions', t => t.ledgerId === activeLedger.id);
      setAllLedgerTxs(cachedTxs);
      setTransactions(cachedTxs);
    } catch (e) {
      console.error("Dashboard cache retrieval failed:", e);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    syncDashboardData();
    loadStockBills(stockDate);

    const handleSync = () => {
      syncDashboardData();
      loadStockBills(stockDate);
    };
    window.addEventListener('database-synced', handleSync);
    return () => {
      window.removeEventListener('database-synced', handleSync);
    };
  }, [activeLedger?.id, stockDate]);

  // Order Status Filter: If DELIVERED or APPROVED then only these orders are showing
  const statusFilteredBills = useMemo(() => {
    if (orderStatusFilter === 'DELIVERED_OR_APPROVED') {
      return stockBills.filter(b => {
        const s = (b.status || '').toUpperCase().trim();
        return s === 'DELIVERED' || s === 'APPROVED';
      });
    }
    if (orderStatusFilter === 'DELIVERED') {
      return stockBills.filter(b => (b.status || '').toUpperCase().trim() === 'DELIVERED');
    }
    if (orderStatusFilter === 'APPROVED') {
      return stockBills.filter(b => (b.status || '').toUpperCase().trim() === 'APPROVED');
    }
    if (orderStatusFilter === 'PENDING') {
      return stockBills.filter(b => (b.status || '').toUpperCase().trim() === 'PENDING');
    }
    if (orderStatusFilter === 'OTHER') {
      return stockBills.filter(b => {
        const s = (b.status || '').toUpperCase().trim();
        return s !== 'DELIVERED' && s !== 'APPROVED' && s !== 'PENDING';
      });
    }
    return stockBills;
  }, [stockBills, orderStatusFilter]);

  // Today's Stock Database Verification & Summary for Status-Filtered Orders
  const todayStockSummary = useMemo(() => {
    return computeDeclarationSummary(statusFilteredBills, transactions, stockDate);
  }, [statusFilteredBills, transactions, stockDate]);

  // Filtered Stock Bills for Display
  const displayedStockBills = useMemo(() => {
    const q = stockSearchQuery.trim().toLowerCase();
    const pending = todayStockSummary.pendingBills;
    const debited = todayStockSummary.debitedBills;

    let list: { bill: BillingBill; isDebited: boolean; matchedTx?: Transaction }[] = [];

    if (stockFilterTab === 'pending') {
      list = pending.map(b => ({ bill: b, isDebited: false }));
    } else if (stockFilterTab === 'debited') {
      list = debited.map(d => ({ bill: d.bill, isDebited: true, matchedTx: d.transaction }));
    } else {
      list = statusFilteredBills.map(b => {
        const found = debited.find(d => d.bill.id === b.id);
        return {
          bill: b,
          isDebited: !!found,
          matchedTx: found?.transaction
        };
      });
    }

    if (!q) return list;

    return list.filter(item => {
      const b = item.bill;
      return (
        b.bill_no.toLowerCase().includes(q) ||
        (b.customer_name && b.customer_name.toLowerCase().includes(q)) ||
        (b.salesman_name && b.salesman_name.toLowerCase().includes(q)) ||
        (b.vehicle_number && b.vehicle_number.toLowerCase().includes(q)) ||
        (b.status && b.status.toLowerCase().includes(q)) ||
        String(b.total_amount).includes(q)
      );
    });
  }, [todayStockSummary, statusFilteredBills, stockFilterTab, stockSearchQuery]);

  // Direct Enter Bill in Ledger
  const handleEnterBill = (bill: BillingBill) => {
    const matchedParty = findMatchingParty(bill.customer_name, parties);
    navigate('/master-entry', {
      state: {
        fromBillingDeclaration: true,
        billNo: bill.bill_no,
        amount: String(bill.total_amount),
        partyId: matchedParty ? matchedParty.id : undefined,
        partyName: bill.customer_name,
        notes: `Bill #${bill.bill_no} - ${bill.customer_name}${bill.remark ? ` (${bill.remark})` : ''}`,
        date: bill.bill_date || stockDate || getTodayKolkataDate(),
        voucherType: 'DEBIT'
      }
    });
  };

  if (!activeLedger) {
    const handleCreateLedgerSubmit = async (e: React.FormEvent) => {
      e.preventDefault();
      if (!newLedgerName.trim()) {
        setCreateError('Please enter a name for the ledger.');
        return;
      }
      setIsCreatingLedger(true);
      setCreateError(null);
      try {
        await createLedger(newLedgerName.trim(), newLedgerType);
        setNewLedgerName('');
      } catch (err: any) {
        setCreateError(err.message || String(err));
      } finally {
        setIsCreatingLedger(false);
      }
    };

    return (
      <div className="p-4 sm:p-8 max-w-4xl mx-auto w-full pb-24 sm:pb-8 flex flex-col items-center justify-center min-h-[75vh]">
        <div className="w-full max-w-2xl bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
          <div className="p-8 bg-slate-900 border-b border-slate-800 text-center sm:text-left flex flex-col sm:flex-row items-center gap-6">
            <div className="w-16 h-16 bg-blue-600 rounded-2xl flex items-center justify-center text-white shadow-lg shrink-0">
              <Building2 size={32} />
            </div>
            <div>
              <div className="flex flex-col sm:flex-row sm:items-center gap-2 justify-center sm:justify-start">
                <span className="text-xs font-bold uppercase text-slate-400 tracking-wider">Corporate ERP Portal</span>
                <CompanyLogo className="h-7 w-auto self-center sm:self-auto" variant="white" />
              </div>
              <p className="text-slate-300 mt-2 text-xs sm:text-sm leading-relaxed">
                Welcome to Greenzar Food & Beverage enterprise financial system. To begin managing parties, transactions, and audit reports, please select or create a ledger.
              </p>
            </div>
          </div>

          <div className="p-8 space-y-8">
            {ledgers.length > 0 && (
              <div>
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700 mb-3 flex items-center gap-2">
                  <FolderPlus size={16} className="text-blue-600" />
                  Select an Existing Ledger
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {ledgers.map(l => (
                    <button
                      key={l.id}
                      onClick={() => setActiveLedgerId(l.id)}
                      className="flex items-center justify-between p-4 bg-slate-50 hover:bg-blue-50 hover:border-blue-300 border border-slate-200 rounded-xl transition-all text-left group"
                    >
                      <div className="overflow-hidden mr-3">
                        <p className="font-bold text-slate-900 truncate group-hover:text-blue-900 text-sm">{l.name}</p>
                        <p className="text-xs text-slate-500 mt-0.5 uppercase">{LEDGER_TYPE_LABELS[l.type] || l.type}</p>
                      </div>
                      <span className="text-xs font-bold text-blue-600 bg-blue-100/60 px-3 py-1 rounded-md group-hover:bg-blue-600 group-hover:text-white transition-all shrink-0">
                        Open Book
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div>
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700 mb-3 flex items-center gap-2">
                <PlusCircle size={16} className="text-emerald-600" />
                Create a New Ledger Book
              </h3>
              
              <form onSubmit={handleCreateLedgerSubmit} className="space-y-4 bg-slate-50/70 p-5 border border-slate-200 rounded-xl">
                {createError && (
                  <div className="p-3 text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-lg font-medium">
                    {createError}
                  </div>
                )}
                
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">Ledger Name</label>
                    <input
                      type="text"
                      required
                      placeholder="e.g. Sales Ledger 2026"
                      value={newLedgerName}
                      onChange={e => setNewLedgerName(e.target.value)}
                      className="w-full px-3.5 py-2 bg-white border border-slate-300 rounded-lg text-sm text-slate-900 focus:outline-none focus:border-blue-600"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">Accounting Type</label>
                    <select
                      value={newLedgerType}
                      onChange={e => setNewLedgerType(e.target.value as Ledger['type'])}
                      className="w-full px-3.5 py-2 bg-white border border-slate-300 rounded-lg text-sm text-slate-900 focus:outline-none focus:border-blue-600"
                    >
                      {Object.entries(LEDGER_TYPE_LABELS).map(([key, label]) => (
                        <option key={key} value={key}>{label}</option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="flex justify-end pt-2">
                  <button
                    type="submit"
                    disabled={isCreatingLedger}
                    className="w-full sm:w-auto px-6 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-bold text-xs rounded-lg transition-colors flex items-center justify-center gap-2 shadow-xs"
                  >
                    {isCreatingLedger ? (
                      <>
                        <Loader2 className="animate-spin" size={16} />
                        Creating Ledger...
                      </>
                    ) : (
                      <>
                        <PlusCircle size={16} />
                        Create & Open Ledger
                      </>
                    )}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const isExpense = activeLedger?.type === 'EXPENSE';
  const totalOutstanding = summary?.totalReceivable ?? parties.filter(p => p.currentDue > 0).reduce((a, b) => a + b.currentDue, 0);
  const totalDebtorsCount = parties.filter(p => p.currentDue > 0).length;
  const totalAdvancePayables = summary?.totalPayable ?? parties.filter(p => p.currentDue < 0).reduce((a, b) => a + Math.abs(b.currentDue), 0);
  
  // Calculate Today's Transactions
  const now = new Date();
  const todayStartTs = startOfDay(now).getTime();
  const todayEndTs = endOfDay(now).getTime();
  const todayTxs = allLedgerTxs.filter(t => t.timestamp >= todayStartTs && t.timestamp <= todayEndTs);
  const todayDebit = todayTxs.filter(t => t.type === 'DEBIT').reduce((acc, t) => acc + t.amount, 0);
  const todayCredit = todayTxs.filter(t => t.type === 'CREDIT').reduce((acc, t) => acc + t.amount, 0);
  const todayDebitCount = todayTxs.filter(t => t.type === 'DEBIT').length;
  const todayCreditCount = todayTxs.filter(t => t.type === 'CREDIT').length;

  const todayStr = getTodayKolkataDate();
  const yesterdayStr = (() => {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    try {
      return d.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
    } catch {
      return d.toISOString().slice(0, 10);
    }
  })();

  const renderOrderStatusBadge = (status?: string) => {
    const s = (status || '').toUpperCase().trim();
    if (s === 'DELIVERED') {
      return <span className="text-[9px] font-medium text-emerald-700">Delivered</span>;
    }
    if (s === 'APPROVED') {
      return <span className="text-[9px] font-medium text-blue-700">Approved</span>;
    }
    if (s === 'PENDING') {
      return <span className="text-[9px] font-medium text-amber-700">Pending</span>;
    }
    if (s === 'CHECK_IN') {
      return <span className="text-[9px] font-medium text-purple-700">Check In</span>;
    }
    if (s === 'VERIFYING') {
      return <span className="text-[9px] font-medium text-indigo-700">Verifying</span>;
    }
    if (s === 'CANCELLED') {
      return <span className="text-[9px] font-medium text-rose-700">Cancelled</span>;
    }
    return <span className="text-[9px] font-medium text-slate-600">{status || 'Unknown'}</span>;
  };

  return (
    <div className="w-full max-w-xl md:max-w-2xl mx-auto p-4 sm:p-5 bg-white min-h-screen pb-20 font-customer">
      
      {/* Top Header */}
      <div className="mb-4">
        <h1 className="text-xl font-bold text-[#0F172A] tracking-tight">
          Financial Overview
        </h1>
        <p className="text-[13px] text-[#64748B] mt-0.5">
          {activeLedger.name} • {LEDGER_TYPE_LABELS[activeLedger.type] || activeLedger.type}
        </p>
      </div>

      {/* Total Outstanding Banner */}
      <div className="bg-gradient-to-br from-[#0056B3] to-[#004494] text-white rounded-2xl p-4 sm:p-5 shadow-[0_4px_14px_rgba(0,86,179,0.28)] mb-4">
        <div className="text-[11.5px] font-semibold tracking-wider uppercase opacity-90 mb-2">
          {isExpense ? 'Total Expenses (Payable)' : 'Total Outstanding'} • {totalDebtorsCount} {totalDebtorsCount === 1 ? 'party' : 'parties'} with balance
        </div>
        <div className="text-[23px] sm:text-[26px] font-bold tracking-tight mb-4 flex items-baseline select-all tabular-nums">
          <span className="text-[21px] mr-0.5 font-normal">₹</span>
          <span>{totalOutstanding.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
          <span className="text-[13px] font-semibold ml-1.5 tracking-wider">DR</span>
        </div>
        <div className="flex justify-between items-center gap-2.5 flex-wrap">
          <div className="bg-[rgba(0,42,94,0.65)] border border-white/15 px-3 py-1.5 rounded-full text-xs font-semibold text-[#34D399] flex items-center gap-1">
            <span>Advance:</span>
            <span>₹{totalAdvancePayables.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} Cr</span>
          </div>
          <button
            type="button"
            onClick={() => navigate('/parties')}
            className="bg-white text-[#0056B3] hover:bg-blue-50 border-none rounded-full px-3.5 py-1.5 text-[12.5px] font-bold flex items-center gap-1.5 shadow-xs transition cursor-pointer"
          >
            <Users size={14} className="text-[#0056B3]" />
            <span>All Parties ({parties.length}) →</span>
          </button>
        </div>
      </div>

      {/* Today's Debit & Credit Cards */}
      <div className="grid grid-cols-2 gap-3 mb-4">
        {/* Debit Card */}
        <div className="bg-white rounded-2xl p-3.5 border border-[#E2E8F0] border-l-4 border-l-[#EF4444] shadow-xs relative">
          <div className="flex justify-between items-center mb-2">
            <span className="text-[11px] font-bold text-[#64748B] uppercase tracking-wider flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-[#EF4444]"></span>
              Todays Debit
            </span>
            <div className="w-6 h-6 rounded-md bg-[#FEE2E2] text-[#DC2626] flex items-center justify-center shrink-0">
              <ArrowDownRight size={14} strokeWidth={2.5} />
            </div>
          </div>
          <div className="text-[17px] font-bold text-[#0F172A] mb-2.5 tabular-nums">
            ₹ {todayDebit.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </div>
          <div className="flex justify-between items-center text-[11.5px] text-[#64748B]">
            <span>{todayDebitCount} {todayDebitCount === 1 ? 'voucher' : 'vouchers'}</span>
            <button
              type="button"
              onClick={() => navigate('/log')}
              className="font-semibold text-[#DC2626] hover:underline cursor-pointer"
            >
              Log →
            </button>
          </div>
        </div>

        {/* Credit Card */}
        <div className="bg-white rounded-2xl p-3.5 border border-[#E2E8F0] border-l-4 border-l-[#10B981] shadow-xs relative">
          <div className="flex justify-between items-center mb-2">
            <span className="text-[11px] font-bold text-[#64748B] uppercase tracking-wider flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-[#10B981]"></span>
              Todays Credit
            </span>
            <div className="w-6 h-6 rounded-md bg-[#DCFCE7] text-[#059669] flex items-center justify-center shrink-0">
              <ArrowUpRight size={14} strokeWidth={2.5} />
            </div>
          </div>
          <div className="text-[17px] font-bold text-[#0F172A] mb-2.5 tabular-nums">
            ₹ {todayCredit.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </div>
          <div className="flex justify-between items-center text-[11.5px] text-[#64748B]">
            <span>{todayCreditCount} {todayCreditCount === 1 ? 'receipt' : 'receipts'}</span>
            <button
              type="button"
              onClick={() => navigate('/log')}
              className="font-semibold text-[#059669] hover:underline cursor-pointer"
            >
              Log →
            </button>
          </div>
        </div>
      </div>

      {/* Status Tabs */}
      <div className="flex gap-4 border-b border-[#E2E8F0] pb-2 mb-3.5 overflow-x-auto">
        <button
          type="button"
          onClick={() => setStockFilterTab('pending')}
          className={`text-[13px] font-semibold whitespace-nowrap pb-1.5 cursor-pointer transition ${
            stockFilterTab === 'pending'
              ? 'text-[#DC2626] border-b-2 border-[#DC2626] -mb-[10px] font-bold'
              : 'text-[#64748B] hover:text-[#0F172A]'
          }`}
        >
          Not Entered ({todayStockSummary.pendingBills.length})
        </button>
        <button
          type="button"
          onClick={() => setStockFilterTab('all')}
          className={`text-[13px] font-semibold whitespace-nowrap pb-1.5 cursor-pointer transition ${
            stockFilterTab === 'all'
              ? 'text-[#0F172A] border-b-2 border-[#0F172A] -mb-[10px] font-bold'
              : 'text-[#64748B] hover:text-[#0F172A]'
          }`}
        >
          All Matching ({statusFilteredBills.length})
        </button>
        <button
          type="button"
          onClick={() => setStockFilterTab('debited')}
          className={`text-[13px] font-semibold whitespace-nowrap pb-1.5 cursor-pointer transition ${
            stockFilterTab === 'debited'
              ? 'text-[#059669] border-b-2 border-[#059669] -mb-[10px] font-bold'
              : 'text-[#64748B] hover:text-[#0F172A]'
          }`}
        >
          Entered ({todayStockSummary.debitedBills.length})
        </button>
      </div>

      {/* Search Box */}
      <div className="flex items-center bg-[#F8FAFC] border border-[#E2E8F0] rounded-xl px-3.5 py-2.5 gap-2.5 mb-4">
        <Search size={16} className="text-[#94A3B8] shrink-0" strokeWidth={2.2} />
        <input
          type="text"
          placeholder="Search bill no, customer, salesman..."
          value={stockSearchQuery}
          onChange={e => setStockSearchQuery(e.target.value)}
          className="border-none outline-none bg-transparent w-full text-[13.5px] text-[#0F172A] placeholder:text-[#94A3B8]"
        />
        {stockSearchQuery && (
          <button
            type="button"
            onClick={() => setStockSearchQuery('')}
            className="text-[#94A3B8] hover:text-slate-600 cursor-pointer"
          >
            <X size={14} />
          </button>
        )}
      </div>

      {/* Parties List */}
      <div id="partiesSection" className="mb-6">
        <div className="grid grid-cols-[85px_1fr_95px] sm:grid-cols-[100px_1fr_120px] text-[11px] font-bold text-[#64748B] tracking-wider px-2 pb-2 border-b border-[#F1F5F9] uppercase">
          <span>ORDER NO</span>
          <span>CUSTOMER NAME</span>
          <span className="text-right">ORDER STATUS</span>
        </div>

        {isStockLoading && stockBills.length === 0 ? (
          <div className="py-8 text-center text-slate-400 flex flex-col items-center justify-center gap-1">
            <Loader2 size={18} className="animate-spin text-blue-600" />
            <p className="text-xs">Loading orders...</p>
          </div>
        ) : stockError ? (
          <div className="p-4 text-center text-amber-700 text-xs flex items-center justify-center gap-2">
            <AlertTriangle size={14} className="shrink-0 text-amber-600" />
            <span>{stockError}</span>
            <button
              type="button"
              onClick={() => loadStockBills(stockDate)}
              className="underline font-semibold ml-1 cursor-pointer"
            >
              Retry
            </button>
          </div>
        ) : displayedStockBills.length === 0 ? (
          <div className="py-8 text-center text-slate-400 px-4">
            <Package size={20} className="mx-auto mb-1 text-slate-300" />
            <p className="text-xs font-medium text-slate-600">No matching orders found</p>
            <p className="text-[11px] text-slate-400 mt-0.5">Orders created in billing will appear here live.</p>
          </div>
        ) : (
          <ul className="divide-y divide-[#F1F5F9] list-none p-0 m-0">
            {displayedStockBills.map(({ bill, isDebited }) => {
              const matchedParty = findMatchingParty(bill.customer_name, parties);
              const formattedTime = (() => {
                if (!bill.created_at) return '';
                try {
                  return format(new Date(bill.created_at), 'HH:mm');
                } catch {
                  return '';
                }
              })();
              const balanceText = matchedParty 
                ? `Balance: ₹ ${Math.abs(matchedParty.currentDue).toLocaleString('en-IN', { minimumFractionDigits: 2 })} ${matchedParty.currentDue >= 0 ? 'DR' : 'CR'}`
                : `Amount: ₹ ${Number(bill.total_amount).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;

              return (
                <li
                  key={bill.id || bill.bill_no}
                  onClick={() => setSelectedOrderDetails({ bill, isDebited })}
                  className="grid grid-cols-[85px_1fr_95px] sm:grid-cols-[100px_1fr_120px] items-center py-3.5 px-2 hover:bg-[#F8FAFC] cursor-pointer transition-colors"
                >
                  <div className="min-w-0 pr-1">
                    <strong className="block text-[13.5px] font-bold text-[#0F172A] leading-tight">
                      #{bill.bill_no}
                    </strong>
                    <span className="block text-[11px] text-[#94A3B8] mt-0.5">
                      {formattedTime || 'Today'}
                    </span>
                  </div>

                  <div className="min-w-0 pr-2">
                    <h4 className="text-[13.5px] font-bold text-[#0F172A] leading-tight truncate">
                      {bill.customer_name}
                    </h4>
                    <p className="text-[11.5px] text-[#64748B] mt-0.5 truncate">
                      {balanceText}
                    </p>
                  </div>

                  <div className="text-right flex flex-col items-end shrink-0">
                    <span className="text-[11.5px] font-semibold text-[#059669]">
                      {bill.status ? bill.status.charAt(0).toUpperCase() + bill.status.slice(1).toLowerCase() : 'Delivered'}
                    </span>
                    {isDebited ? (
                      <span className="text-[10px] text-slate-400 font-medium mt-0.5">Entered</span>
                    ) : (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleEnterBill(bill);
                        }}
                        className="text-[10px] font-bold text-[#DC2626] hover:underline cursor-pointer mt-0.5"
                      >
                        Not Entered →
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* ========================================================================= */}
      {/* ORDER DETAILS MODAL                                                       */}
      {/* ========================================================================= */}
      {selectedOrderDetails && (
        <div 
          className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-150"
          onClick={() => setSelectedOrderDetails(null)}
        >
          <div 
            className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-lg overflow-hidden animate-in zoom-in-95 duration-150"
            onClick={e => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="px-4 py-3 sm:px-5 sm:py-3.5 border-b border-slate-100 flex items-center justify-between bg-slate-50/70">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-blue-50 border border-blue-200 text-[#0055a5] flex items-center justify-center font-bold">
                  <Package size={16} />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-sm sm:text-base font-bold text-slate-900 tracking-tight">
                      Order Details #{selectedOrderDetails.bill.bill_no}
                    </h3>
                    {renderOrderStatusBadge(selectedOrderDetails.bill.status)}
                  </div>
                  <p className="text-[10px] text-slate-500 mt-0.5">
                    Filter Date: <span className="font-mono text-slate-700">{stockDate}</span> • Status: <span className="font-semibold text-slate-700">{selectedOrderDetails.bill.status || 'CREATED'}</span>
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setSelectedOrderDetails(null)}
                className="w-7 h-7 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 flex items-center justify-center transition-colors cursor-pointer"
              >
                <X size={16} />
              </button>
            </div>

            {/* Modal Body - Simple text, no background color, no borders */}
            <div className="p-4 sm:p-5 space-y-3 max-h-[75vh] overflow-y-auto text-xs text-slate-700">
              {/* Customer / Party */}
              <div className="space-y-1">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <span className="text-[10px] uppercase font-semibold text-slate-400">
                      Customer / Party
                    </span>
                    <h4 className="text-sm font-bold text-slate-900">
                      {selectedOrderDetails.bill.customer_name || 'Anonymous Customer'}
                    </h4>
                  </div>
                  {(() => {
                    const match = findMatchingParty(selectedOrderDetails.bill.customer_name, parties);
                    return match ? (
                      <span className="text-[10px] font-medium text-emerald-700">
                        ✓ Matched: {match.name}
                      </span>
                    ) : null;
                  })()}
                </div>

                <div className="text-[11px] text-slate-600 space-y-0.5">
                  {selectedOrderDetails.bill.phone_number && (
                    <div className="flex items-center gap-1.5">
                      <span className="text-slate-400">Phone:</span>
                      <span>{selectedOrderDetails.bill.phone_number}</span>
                    </div>
                  )}
                  {selectedOrderDetails.bill.customer_address && (
                    <div className="flex items-center gap-1.5">
                      <span className="text-slate-400">Address:</span>
                      <span className="truncate">{selectedOrderDetails.bill.customer_address}</span>
                    </div>
                  )}
                </div>
              </div>

              {/* Financial & Order Specs - Simple text */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-1 text-xs">
                <div>
                  <span className="text-[10px] uppercase font-medium text-slate-400 block">Order Amount</span>
                  <span className="text-sm sm:text-base font-bold text-slate-900 font-mono">
                    ₹{Number(selectedOrderDetails.bill.total_amount).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                  </span>
                </div>
                <div>
                  <span className="text-[10px] uppercase font-medium text-slate-400 block">Total Qty</span>
                  <span className="text-sm sm:text-base font-semibold text-slate-800">
                    {selectedOrderDetails.bill.total_qty || 0} pcs
                  </span>
                </div>
                <div>
                  <span className="text-[10px] uppercase font-medium text-slate-400 block">Total Weight</span>
                  <span className="text-sm sm:text-base font-semibold text-slate-800">
                    {selectedOrderDetails.bill.total_weight ? `${selectedOrderDetails.bill.total_weight} kg` : 'N/A'}
                  </span>
                </div>
                <div>
                  <span className="text-[10px] uppercase font-medium text-slate-400 block">Bill Type</span>
                  <span className="text-sm sm:text-base font-semibold text-slate-800 uppercase">
                    {selectedOrderDetails.bill.bill_type ? selectedOrderDetails.bill.bill_type.replace('_', ' ') : 'Standard'}
                  </span>
                </div>
              </div>

              {/* Order Items Breakdown (Name, Qty, Rate, Amount) */}
              <div className="pt-2">
                <div className="flex items-center justify-between pb-1.5 border-b border-slate-100">
                  <div className="flex items-center gap-1.5">
                    <Package size={13} className="text-[#0055a5]" />
                    <span className="text-[10px] uppercase font-bold tracking-wider text-slate-600">
                      Ordered Items {orderItems.length > 0 ? `(${orderItems.length})` : ''}
                    </span>
                  </div>
                  {orderItems.length > 0 && (
                    <span className="text-[10px] text-slate-400 font-medium">
                      Total: {orderItems.reduce((acc, it) => acc + (Number(it.qty) || 0), 0)} pcs
                    </span>
                  )}
                </div>

                {isLoadingItems ? (
                  <div className="py-4 text-center text-slate-400 flex items-center justify-center gap-1.5 text-xs">
                    <Loader2 size={13} className="animate-spin text-[#0055a5]" />
                    <span>Loading ordered items...</span>
                  </div>
                ) : orderItems.length === 0 ? (
                  <div className="py-3 text-center text-slate-400 text-[11px] italic bg-slate-50/50 rounded-lg my-1">
                    No individual item details found for this bill.
                  </div>
                ) : (
                  <div className="overflow-x-auto mt-1 border border-slate-100 rounded-lg">
                    <table className="w-full text-left text-xs">
                      <thead>
                        <tr className="text-[9px] uppercase font-semibold text-slate-400 bg-slate-50/60 border-b border-slate-100">
                          <th className="py-1.5 px-2 w-7">#</th>
                          <th className="py-1.5 px-2">Item Name</th>
                          <th className="py-1.5 px-2 text-center w-16">Qty</th>
                          <th className="py-1.5 px-2 text-right w-20">Rate</th>
                          <th className="py-1.5 px-2 text-right w-24">Amount</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 text-[11px]">
                        {orderItems.map((item, idx) => {
                          const itemQty = Number(item.qty) || 0;
                          const itemRate = Number(item.rate) || 0;
                          const itemTotal = Number(item.line_total) || (itemQty * itemRate);
                          return (
                            <tr key={item.id || idx} className="hover:bg-slate-50/50">
                              <td className="py-1.5 px-2 text-slate-400 text-[10px] tabular-nums">
                                {idx + 1}
                              </td>
                              <td className="py-1.5 px-2 font-medium text-slate-900">
                                {item.product_name}
                                {item.mark_text && (
                                  <span className="ml-1 text-[8.5px] text-amber-600">({item.mark_text})</span>
                                )}
                              </td>
                              <td className="py-1.5 px-2 text-center font-bold text-slate-800 tabular-nums">
                                {itemQty}
                              </td>
                              <td className="py-1.5 px-2 text-right text-slate-500 tabular-nums">
                                ₹{itemRate.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                              </td>
                              <td className="py-1.5 px-2 text-right font-bold text-slate-900 tabular-nums">
                                ₹{itemTotal.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                      <tfoot>
                        <tr className="border-t border-slate-200 font-bold text-slate-900 bg-slate-50/70 text-[11px]">
                          <td colSpan={2} className="py-1.5 px-2 text-[10px] uppercase text-slate-500">
                            Total
                          </td>
                          <td className="py-1.5 px-2 text-center tabular-nums text-slate-900">
                            {orderItems.reduce((acc, it) => acc + (Number(it.qty) || 0), 0)} pcs
                          </td>
                          <td className="py-1.5 px-2"></td>
                          <td className="py-1.5 px-2 text-right tabular-nums text-slate-900">
                            ₹{orderItems.reduce((acc, it) => acc + (Number(it.line_total) || (Number(it.qty || 0) * Number(it.rate || 0))), 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          </td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                )}
              </div>

              {/* Transport & Dispatch Details - Simple text */}
              <div className="space-y-1 pt-1 text-[11px]">
                <span className="text-[10px] uppercase font-semibold text-slate-400 block">
                  Logistics & Transport
                </span>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  <div>
                    <span className="text-slate-400 text-[10px] block">Vehicle No:</span>
                    <span className="font-semibold text-slate-800">{selectedOrderDetails.bill.vehicle_number || '—'}</span>
                  </div>
                  <div>
                    <span className="text-slate-400 text-[10px] block">Driver:</span>
                    <span className="font-semibold text-slate-800">{selectedOrderDetails.bill.driver_name || '—'}</span>
                  </div>
                  <div>
                    <span className="text-slate-400 text-[10px] block">Driver Contact:</span>
                    <span className="font-semibold text-slate-800">{selectedOrderDetails.bill.driver_contact || '—'}</span>
                  </div>
                  <div>
                    <span className="text-slate-400 text-[10px] block">Salesman:</span>
                    <span className="font-semibold text-slate-800">{selectedOrderDetails.bill.salesman_name || '—'}</span>
                  </div>
                  <div>
                    <span className="text-slate-400 text-[10px] block">UPI / Ref:</span>
                    <span className="font-mono text-slate-800">{selectedOrderDetails.bill.payment_upi || '—'}</span>
                  </div>
                  <div>
                    <span className="text-slate-400 text-[10px] block">Order Date:</span>
                    <span className="font-mono text-slate-800">{selectedOrderDetails.bill.bill_date || stockDate}</span>
                  </div>
                </div>

                {selectedOrderDetails.bill.remark && (
                  <div className="pt-1">
                    <span className="text-slate-400 text-[10px] block">Remark / Notes:</span>
                    <p className="text-slate-700 italic text-[11px]">{selectedOrderDetails.bill.remark}</p>
                  </div>
                )}
              </div>

              {/* Ledger Debit Status - Simple text */}
              <div className="pt-2 flex items-center justify-between gap-3 text-xs">
                <div>
                  <p className={`font-semibold text-xs sm:text-sm ${selectedOrderDetails.isDebited ? 'text-emerald-700' : 'text-slate-800'}`}>
                    {selectedOrderDetails.isDebited ? 'Entered in Ledger' : 'Not Yet Entered in Ledger'}
                  </p>
                  <p className="text-[10.5px] text-slate-500 mt-0.5">
                    {selectedOrderDetails.isDebited 
                      ? 'This stock database order has already been verified and debited.' 
                      : 'This stock order is waiting to be recorded into your ledger books.'}
                  </p>
                </div>

                {!selectedOrderDetails.isDebited ? (
                  <button
                    type="button"
                    onClick={() => {
                      const b = selectedOrderDetails.bill;
                      setSelectedOrderDetails(null);
                      handleEnterBill(b);
                    }}
                    className="px-3 py-1.5 bg-[#0055a5] hover:bg-blue-800 text-white rounded-md text-xs font-semibold shadow-xs transition-colors shrink-0 flex items-center gap-1 cursor-pointer"
                  >
                    <PlusCircle size={13} />
                    <span>Enter in Ledger</span>
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedOrderDetails(null);
                      navigate('/log');
                    }}
                    className="px-3 py-1.5 text-emerald-800 hover:text-emerald-950 hover:bg-emerald-50 rounded-md text-xs font-semibold transition-colors shrink-0 cursor-pointer"
                  >
                    View in Log
                  </button>
                )}
              </div>
            </div>

            {/* Bluetooth Status Toast / Feedback Banner */}
            {bluetoothStatus.state !== 'idle' && (
              <div className={`px-4 py-2 text-xs flex items-center justify-between border-t ${
                bluetoothStatus.state === 'success'
                  ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                  : bluetoothStatus.state === 'error'
                  ? 'bg-rose-50 text-rose-800 border-rose-200'
                  : 'bg-blue-50 text-blue-800 border-blue-200'
              }`}>
                <div className="flex items-center gap-1.5 min-w-0">
                  {bluetoothStatus.state === 'connecting' || bluetoothStatus.state === 'printing' ? (
                    <Loader2 size={13} className="animate-spin text-blue-600 shrink-0" />
                  ) : bluetoothStatus.state === 'success' ? (
                    <Check size={13} className="text-emerald-600 shrink-0" />
                  ) : (
                    <AlertCircle size={13} className="text-rose-600 shrink-0" />
                  )}
                  <span className="font-medium truncate text-[11px]">{bluetoothStatus.message}</span>
                </div>
                {bluetoothStatus.state === 'error' && (
                  <button
                    type="button"
                    onClick={() => handlePrintOrderRawBt(selectedOrderDetails.bill, orderItems)}
                    className="underline text-[10.5px] font-bold text-blue-700 hover:text-blue-900 cursor-pointer shrink-0 ml-2"
                    title="Print via RawBT Android App"
                  >
                    Use RawBT
                  </button>
                )}
              </div>
            )}

            {/* Modal Footer with Print and Bluetooth Options */}
            <div className="px-4 py-3 bg-slate-50 border-t border-slate-100 flex flex-wrap items-center justify-between gap-2 text-xs">
              <span className="text-slate-400 text-[10.5px]">
                Created: {selectedOrderDetails.bill.created_at ? new Date(selectedOrderDetails.bill.created_at).toLocaleString() : 'N/A'}
              </span>

              <div className="flex items-center gap-1.5 flex-wrap">
                {/* Direct Bluetooth Thermal Printer Button */}
                <button
                  type="button"
                  onClick={() => handlePrintOrderBluetooth(selectedOrderDetails.bill, orderItems)}
                  disabled={bluetoothStatus.state === 'connecting' || bluetoothStatus.state === 'printing'}
                  className="flex items-center gap-1 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-semibold rounded-lg shadow-2xs transition-colors cursor-pointer text-xs"
                  title="Connect and print directly to mobile Bluetooth thermal printer (POS-58, POS-80, MPT-II)"
                >
                  {bluetoothStatus.state === 'connecting' || bluetoothStatus.state === 'printing' ? (
                    <Loader2 size={13} className="animate-spin text-white" />
                  ) : (
                    <Bluetooth size={13} className="text-blue-200" />
                  )}
                  <span>
                    {bluetoothStatus.state === 'printing'
                      ? 'Printing...'
                      : bluetoothStatus.state === 'connecting'
                      ? 'Connecting...'
                      : getCachedPrinterName()
                      ? `BT Print (${getCachedPrinterName()})`
                      : 'Bluetooth Printer'}
                  </span>
                </button>

                {/* Print Receipt / Thermal Preview Button */}
                <button
                  type="button"
                  onClick={() => setThermalReceiptBill({ bill: selectedOrderDetails.bill, items: orderItems })}
                  className="flex items-center gap-1 px-3 py-1.5 bg-white border border-slate-300 hover:bg-slate-100 text-slate-800 font-semibold rounded-lg shadow-2xs transition-colors cursor-pointer text-xs"
                  title="Open formal receipt preview with 58mm/80mm sizes and PDF export"
                >
                  <Printer size={13} className="text-slate-600" />
                  <span>Print Receipt</span>
                </button>

                <button
                  type="button"
                  onClick={() => setSelectedOrderDetails(null)}
                  className="px-3 py-1.5 bg-slate-200 hover:bg-slate-300 text-slate-700 font-semibold rounded-lg shadow-2xs transition-colors cursor-pointer text-xs"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Thermal Receipt Print Modal for Bill */}
      {thermalReceiptBill && (
        <ThermalReceiptModal
          isOpen={true}
          onClose={() => setThermalReceiptBill(null)}
          transaction={{
            id: thermalReceiptBill.bill.id || `bill-${thermalReceiptBill.bill.bill_no}`,
            ledgerId: activeLedger?.id || '',
            type: 'DEBIT',
            amount: Number(thermalReceiptBill.bill.total_amount) || 0,
            timestamp: thermalReceiptBill.bill.bill_date ? new Date(thermalReceiptBill.bill.bill_date).getTime() : Date.now(),
            partyId: '',
            notes: thermalReceiptBill.bill.remark || `Order #${thermalReceiptBill.bill.bill_no}`,
            invoiceNo: String(thermalReceiptBill.bill.bill_no || '')
          }}
          partyName={thermalReceiptBill.bill.customer_name || 'Anonymous Customer'}
          partyPhone={thermalReceiptBill.bill.phone_number}
          partyAddress={thermalReceiptBill.bill.customer_address}
          ledgerName={activeLedger?.name || 'Stock Database'}
          customTitle="ORDER DELIVERY BILL"
          items={thermalReceiptBill.items}
          vehicleNumber={thermalReceiptBill.bill.vehicle_number}
          driverName={thermalReceiptBill.bill.driver_name}
          salesmanName={thermalReceiptBill.bill.salesman_name}
        />
      )}

    </div>
  );
}
