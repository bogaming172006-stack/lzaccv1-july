import React, { useState } from 'react';
import { NavLink, useNavigate, useLocation } from 'react-router-dom';
import { 
  LayoutDashboard, 
  Users as UsersIcon, 
  FileText, 
  Settings, 
  LogOut, 
  ChevronDown, 
  Plus, 
  BookOpen, 
  Activity, 
  Menu, 
  Database, 
  RefreshCw, 
  Check, 
  FileSpreadsheet,
  Building2,
  ShieldCheck,
  CreditCard,
  Layers,
  X
} from 'lucide-react';
import { useAuth } from '../AuthContext';
import { useLedger } from '../LedgerContext';
import CompanyLogo from './CompanyLogo';
import { clearCacheStore } from '../lib/idbCache';
import { syncCollection } from '../lib/syncCache';
import { Ledger, LEDGER_TYPE_LABELS } from '../types';

interface NewLedgerModalProps {
  onClose: () => void;
  onCreate: (name: string, type: Ledger['type']) => Promise<void>;
}

function NewLedgerModal({ onClose, onCreate }: NewLedgerModalProps) {
  const [name, setName] = useState('');
  const [type, setType] = useState<Ledger['type']>('SALE');
  const [isSubmitting, setIsSubmitting] = useState(false);
  
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || isSubmitting) return;
    setIsSubmitting(true);
    try {
      await onCreate(name.trim(), type);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-150">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-md border border-slate-200 overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center bg-slate-50">
          <div className="flex items-center gap-2">
            <div className="p-1.5 bg-blue-50 text-blue-600 rounded-lg">
              <Building2 size={18} />
            </div>
            <div>
              <h3 className="font-bold text-slate-900 text-sm">Create New Ledger Book</h3>
              <p className="text-xs text-slate-500">Add an accounting ledger to Greenzar ERP</p>
            </div>
          </div>
          <button 
            type="button" 
            onClick={onClose} 
            className="text-slate-400 hover:text-slate-600 p-1 rounded-md transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-slate-700 mb-1.5">
              Ledger Name
            </label>
            <input 
              required 
              type="text" 
              value={name} 
              onChange={e => setName(e.target.value)} 
              className="w-full px-3.5 py-2 text-sm bg-white border border-slate-300 rounded-lg text-slate-900 placeholder:text-slate-400 focus:border-blue-600 focus:ring-1 focus:ring-blue-600" 
              placeholder="e.g. Primary Sales Ledger 2026" 
            />
          </div>

          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-slate-700 mb-1.5">
              Accounting Classification
            </label>
            <select 
              value={type} 
              onChange={e => setType(e.target.value as Ledger['type'])} 
              className="w-full px-3.5 py-2 text-sm bg-white border border-slate-300 rounded-lg text-slate-900 focus:border-blue-600 focus:ring-1 focus:ring-blue-600"
            >
              {Object.entries(LEDGER_TYPE_LABELS).map(([key, label]) => (
                <option key={key} value={key}>{label}</option>
              ))}
            </select>
          </div>

          <div className="pt-4 border-t border-slate-100 flex items-center justify-end gap-2.5">
            <button 
              type="button" 
              onClick={onClose} 
              className="px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
            >
              Cancel
            </button>
            <button 
              type="submit" 
              disabled={isSubmitting} 
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded-lg shadow-xs transition-colors disabled:opacity-50"
            >
              {isSubmitting ? 'Creating...' : 'Create Ledger'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function Navigation() {
  const { currentUser, logout } = useAuth();
  const { ledgers, activeLedger, setActiveLedgerId, createLedger } = useLedger();
  const [showLedgerMenu, setShowLedgerMenu] = useState(false);
  const [showNewLedgerModal, setShowNewLedgerModal] = useState(false);
  const [showMobileMore, setShowMobileMore] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncSuccess, setSyncSuccess] = useState(false);

  const handleRefreshDatabase = async () => {
    if (isSyncing) return;
    setIsSyncing(true);
    setSyncSuccess(false);
    try {
      await clearCacheStore('parties');
      await clearCacheStore('products');
      await clearCacheStore('transactions');
      await clearCacheStore('dashboard_summary');
      await clearCacheStore('tracked_invoices');
      
      if (activeLedger?.id) {
        await Promise.all([
          syncCollection('parties', activeLedger.id, 'parties'),
          syncCollection('transactions', activeLedger.id, 'transactions'),
          syncCollection('dashboard_summary', activeLedger.id, 'dashboard_summary'),
          syncCollection('tracked_invoices', activeLedger.id, 'tracked_invoices')
        ]);
      }
      setSyncSuccess(true);
      window.dispatchEvent(new CustomEvent('database-synced'));
      setTimeout(() => {
        setSyncSuccess(false);
      }, 1200);
    } catch (err) {
      console.error("Database sync failed:", err);
    } finally {
      setIsSyncing(false);
    }
  };

  const handleLedgerSwitch = (id: string) => {
    setActiveLedgerId(id);
    setShowLedgerMenu(false);
    navigate('/');
  };

  const isPurchase = activeLedger?.type === 'PURCHASE';

  const handleCreateLedger = async (name: string, type: Ledger['type']) => {
    await createLedger(name, type);
    setShowNewLedgerModal(false);
    setShowLedgerMenu(false);
  };

  if (!currentUser) return null;

  return (
    <>
      {showNewLedgerModal && (
        <NewLedgerModal 
          onClose={() => setShowNewLedgerModal(false)} 
          onCreate={handleCreateLedger} 
        />
      )}

      {/* Mobile Drawer Backdrop */}
      {showMobileMore && (
        <div 
          className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs z-50 sm:hidden transition-opacity" 
          onClick={() => setShowMobileMore(false)} 
        />
      )}

      {/* Mobile Bottom More Drawer */}
      {showMobileMore && (
        <div className="fixed inset-x-0 bottom-16 bg-white border-t border-slate-200 rounded-t-2xl shadow-2xl z-50 p-5 divide-y divide-slate-100 max-h-[75vh] overflow-y-auto sm:hidden animate-in slide-in-from-bottom duration-200">
          <div className="flex justify-between items-center pb-3">
            <span className="font-bold text-xs uppercase tracking-wider text-slate-500">Greenzar ERP Modules</span>
            <button 
              className="text-slate-400 hover:text-slate-600 p-1" 
              onClick={() => setShowMobileMore(false)}
            >
              <X size={18} />
            </button>
          </div>
          
          <div className="py-3 space-y-1">
            <NavLink 
              to="/activities" 
              onClick={() => setShowMobileMore(false)} 
              className={({ isActive }) => `flex items-center px-3.5 py-2.5 rounded-lg text-sm font-medium transition-colors ${isActive ? 'bg-blue-50 text-blue-700 font-semibold' : 'text-slate-700 hover:bg-slate-50'}`}
            >
              <Activity size={18} className="mr-3 text-slate-500" />
              Overall Transaction
            </NavLink>

            {activeLedger?.type === 'SALE' && (
              <NavLink 
                to="/invoice-sheets" 
                onClick={() => setShowMobileMore(false)} 
                className={({ isActive }) => `flex items-center px-3.5 py-2.5 rounded-lg text-sm font-medium transition-colors ${isActive ? 'bg-blue-50 text-blue-700 font-semibold' : 'text-slate-700 hover:bg-slate-50'}`}
              >
                <BookOpen size={18} className="mr-3 text-slate-500" />
                Invoice Sheets
              </NavLink>
            )}

            {currentUser.isAdmin && (
              <>
                <div className="pt-2 pb-1">
                  <span className="text-[10px] uppercase font-bold text-slate-400 tracking-wider px-3.5">Administration</span>
                </div>

                <NavLink 
                  to="/accounts-mail" 
                  onClick={() => setShowMobileMore(false)} 
                  className={({ isActive }) => `flex items-center px-3.5 py-2.5 rounded-lg text-sm font-medium transition-colors ${isActive ? 'bg-blue-50 text-blue-700 font-semibold' : 'text-slate-700 hover:bg-slate-50'}`}
                >
                  <FileSpreadsheet size={18} className="mr-3 text-emerald-600" />
                  Google Sheets Auto-Sync
                </NavLink>

                <NavLink 
                  to="/backup-restore" 
                  onClick={() => setShowMobileMore(false)} 
                  className={({ isActive }) => `flex items-center px-3.5 py-2.5 rounded-lg text-sm font-medium transition-colors ${isActive ? 'bg-blue-50 text-blue-700 font-semibold' : 'text-slate-700 hover:bg-slate-50'}`}
                >
                  <Database size={18} className="mr-3 text-blue-600" />
                  Backup & Restore
                </NavLink>
                
                <NavLink 
                  to="/admin" 
                  onClick={() => setShowMobileMore(false)} 
                  className={({ isActive }) => `flex items-center px-3.5 py-2.5 rounded-lg text-sm font-medium transition-colors ${isActive ? 'bg-blue-50 text-blue-700 font-semibold' : 'text-slate-700 hover:bg-slate-50'}`}
                >
                  <Settings size={18} className="mr-3 text-slate-600" />
                  User Management
                </NavLink>
              </>
            )}
          </div>

          <div className="pt-4">
            <div className="flex items-center px-3.5 py-2.5 mb-3 bg-slate-50 rounded-lg border border-slate-200">
              <div className="w-8 h-8 rounded-lg bg-blue-600 text-white flex items-center justify-center font-bold mr-3 text-xs shadow-xs">
                {currentUser.name.charAt(0).toUpperCase()}
              </div>
              <div className="overflow-hidden">
                <p className="font-bold text-sm text-slate-900 truncate">{currentUser.name}</p>
                <p className="text-[10px] text-slate-500 uppercase tracking-wider">{currentUser.isAdmin ? 'Administrator' : 'Standard User'}</p>
              </div>
            </div>
            <button 
              onClick={() => { setShowMobileMore(false); logout(); }} 
              className="w-full flex items-center justify-center px-4 py-2.5 text-xs font-bold text-rose-600 hover:bg-rose-50 rounded-lg transition-colors border border-rose-200"
            >
              <LogOut size={16} className="mr-2" />
              Sign Out
            </button>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* DESKTOP SIDEBAR - Crisp Clean White Enterprise Theme */}
      {/* ========================================================================= */}
      <aside className="hidden sm:flex flex-col w-64 h-screen bg-white border-r border-slate-200 text-slate-700 select-none z-30 shrink-0">
        
        {/* Brand Header */}
        <div className="p-4 border-b border-slate-200/80 bg-white">
          <div className="flex items-center justify-between gap-2 mb-3.5">
            <div>
              <span className="font-extrabold text-slate-900 text-sm tracking-wider uppercase block font-sans">
                Greenzar
              </span>
              <span className="text-[10px] text-slate-500 font-medium tracking-tight block">
                Food & Beverage ERP
              </span>
            </div>

            <button
              type="button"
              onClick={handleRefreshDatabase}
              disabled={isSyncing}
              className={`p-1.5 rounded-lg border border-slate-200 text-slate-400 hover:text-slate-900 hover:bg-slate-50 hover:border-slate-300 transition-all flex items-center justify-center ${isSyncing ? 'cursor-not-allowed opacity-80' : ''}`}
              title="Sync & Re-index Local Cache"
            >
              {syncSuccess ? (
                <Check size={14} className="text-emerald-600" />
              ) : (
                <RefreshCw size={14} className={isSyncing ? "animate-spin text-blue-600" : ""} />
              )}
            </button>
          </div>

          {/* Active Ledger Switcher */}
          <div className="relative">
            <button 
              onClick={() => setShowLedgerMenu(!showLedgerMenu)}
              className={`w-full flex items-center justify-between px-3 py-2.5 ${
                isPurchase 
                  ? 'bg-purple-50/80 hover:bg-purple-100/80 border-purple-200 shadow-2xs' 
                  : 'bg-slate-50 hover:bg-slate-100 border-slate-200/90'
              } border rounded-xl text-xs transition-all text-left group`}
            >
              <div className="overflow-hidden min-w-0 pr-2">
                <div className={`font-semibold truncate text-[13px] ${isPurchase ? 'text-purple-950 group-hover:text-purple-700' : 'text-slate-900 group-hover:text-blue-600'}`}>
                  {activeLedger?.name || 'Select Ledger'}
                </div>
              </div>
              <ChevronDown size={14} className={`${isPurchase ? 'text-purple-400 group-hover:text-purple-600' : 'text-slate-400 group-hover:text-slate-600'} shrink-0 transition-colors`} />
            </button>
            
            {showLedgerMenu && (
              <div className="absolute top-full mt-1.5 left-0 right-0 bg-white border border-slate-200 rounded-xl shadow-xl overflow-hidden z-50 animate-in fade-in slide-in-from-top-1 duration-150">
                <div className="p-2.5 border-b border-slate-100 text-[11px] font-normal uppercase tracking-wider text-slate-500 bg-slate-50 flex items-center justify-between">
                  <span>Available Ledgers ({ledgers.length})</span>
                  {isPurchase && <span className="text-[10px] text-amber-700 font-bold">PURCHASE ACTIVE</span>}
                </div>
                <div className="max-h-52 overflow-y-auto p-1.5 space-y-0.5 custom-scrollbar">
                  {ledgers.map(l => {
                    const isLedgerPurchase = l.type === 'PURCHASE';
                    const isCurrent = activeLedger?.id === l.id;
                    return (
                      <button
                        key={l.id}
                        onClick={() => handleLedgerSwitch(l.id)}
                        className={`w-full text-left px-2.5 py-2 text-[13px] rounded-lg transition-colors flex items-center justify-between ${
                          isCurrent
                            ? isLedgerPurchase 
                              ? 'bg-gradient-to-r from-purple-800 to-purple-950 text-white font-medium shadow-xs border-l-3 border-amber-400'
                              : 'bg-[#0055a5] text-white font-normal' 
                            : 'text-slate-700 hover:bg-slate-100 hover:text-slate-900 font-normal'
                        }`}
                      >
                        <span className="truncate font-medium">{l.name}</span>
                      </button>
                    );
                  })}
                </div>
                {currentUser.isAdmin && (
                  <div className="border-t border-slate-100 p-1.5 bg-slate-50">
                    <button 
                      onClick={() => { setShowNewLedgerModal(true); setShowLedgerMenu(false); }}
                      className="w-full flex items-center justify-center text-left px-2.5 py-1.5 text-xs text-[#0055a5] hover:text-blue-700 hover:bg-blue-50 rounded-lg font-normal transition-colors"
                    >
                      <Plus size={14} className="mr-1.5" />
                      Create New Ledger
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Sidebar Nav Links */}
        <div className="flex-1 overflow-y-auto px-3 py-4 space-y-5 custom-scrollbar">
          
          {/* Section 1: Financial Ledgers */}
          <div>
            <span className="px-3 text-[11px] font-normal uppercase tracking-wider text-slate-400 block mb-1.5">
              Financial Accounting
            </span>
            <nav className="space-y-0.5">
              <NavLink
                to="/"
                end
                className={({ isActive }) =>
                  `flex items-center px-3 py-2 text-[13px] rounded-lg transition-all ${
                    isActive
                      ? 'bg-[#0055a5] text-white shadow-xs font-normal'
                      : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100 font-normal'
                  }`
                }
              >
                {({ isActive }) => (
                  <>
                    <LayoutDashboard size={16} className={`mr-2.5 shrink-0 ${isActive ? 'text-white' : 'text-slate-400'}`} />
                    <span>Financial Dashboard</span>
                  </>
                )}
              </NavLink>

              <NavLink
                to="/parties"
                className={({ isActive }) =>
                  `flex items-center px-3 py-2 text-[13px] rounded-lg transition-all ${
                    isActive
                      ? 'bg-[#0055a5] text-white shadow-xs font-normal'
                      : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100 font-normal'
                  }`
                }
              >
                {({ isActive }) => (
                  <>
                    <UsersIcon size={16} className={`mr-2.5 shrink-0 ${isActive ? 'text-white' : 'text-slate-400'}`} />
                    <span>Parties & Ledgers</span>
                  </>
                )}
              </NavLink>

              <NavLink
                to="/master-entry"
                className={({ isActive }) =>
                  `flex items-center px-3 py-2 text-[13px] rounded-lg transition-all ${
                    isActive
                      ? 'bg-[#0055a5] text-white shadow-xs font-normal'
                      : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100 font-normal'
                  }`
                }
              >
                {({ isActive }) => (
                  <>
                    <CreditCard size={16} className={`mr-2.5 shrink-0 ${isActive ? 'text-white' : 'text-slate-400'}`} />
                    <span>Master Voucher Entry</span>
                  </>
                )}
              </NavLink>

              {activeLedger?.type === 'SALE' && (
                <NavLink
                  to="/invoice-sheets"
                  className={({ isActive }) =>
                    `flex items-center px-3 py-2 text-[13px] rounded-lg transition-all ${
                      isActive
                        ? 'bg-[#0055a5] text-white shadow-xs font-normal'
                        : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100 font-normal'
                    }`
                  }
                >
                  {({ isActive }) => (
                    <>
                      <BookOpen size={16} className={`mr-2.5 shrink-0 ${isActive ? 'text-white' : 'text-slate-400'}`} />
                      <span>Invoice Sheets</span>
                    </>
                  )}
                </NavLink>
              )}
            </nav>
          </div>

          {/* Section 2: Management & Audit */}
          <div>
            <span className="px-3 text-[11px] font-normal uppercase tracking-wider text-slate-400 block mb-1.5">
              Operations & Audit
            </span>
            <nav className="space-y-0.5">
              <NavLink
                to="/log"
                className={({ isActive }) =>
                  `flex items-center px-3 py-2 text-[13px] rounded-lg transition-all ${
                    isActive
                      ? 'bg-[#0055a5] text-white shadow-xs font-normal'
                      : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100 font-normal'
                  }`
                }
              >
                {({ isActive }) => (
                  <>
                    <FileText size={16} className={`mr-2.5 shrink-0 ${isActive ? 'text-white' : 'text-slate-400'}`} />
                    <span>Day Log</span>
                  </>
                )}
              </NavLink>

              <NavLink
                to="/activities"
                className={({ isActive }) =>
                  `flex items-center px-3 py-2 text-[13px] rounded-lg transition-all ${
                    isActive
                      ? 'bg-[#0055a5] text-white shadow-xs font-normal'
                      : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100 font-normal'
                  }`
                }
              >
                {({ isActive }) => (
                  <>
                    <Activity size={16} className={`mr-2.5 shrink-0 ${isActive ? 'text-white' : 'text-slate-400'}`} />
                    <span>Overall Transaction</span>
                  </>
                )}
              </NavLink>
            </nav>
          </div>

          {/* Section 3: System Administration (Admin Only) */}
          {currentUser.isAdmin && (
            <div>
              <span className="px-3 text-[11px] font-normal uppercase tracking-wider text-slate-400 block mb-1.5">
                System Administration
              </span>
              <nav className="space-y-0.5">
                <NavLink
                  to="/accounts-mail"
                  className={({ isActive }) =>
                    `flex items-center px-3 py-2 text-[13px] rounded-lg transition-all ${
                      isActive
                        ? 'bg-[#0055a5] text-white shadow-xs font-normal'
                        : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100 font-normal'
                    }`
                  }
                >
                  {({ isActive }) => (
                    <>
                      <FileSpreadsheet size={16} className={`mr-2.5 shrink-0 ${isActive ? 'text-white' : 'text-emerald-600'}`} />
                      <span>Google Sheets Sync</span>
                    </>
                  )}
                </NavLink>

                <NavLink
                  to="/backup-restore"
                  className={({ isActive }) =>
                    `flex items-center px-3 py-2 text-[13px] rounded-lg transition-all ${
                      isActive
                        ? 'bg-[#0055a5] text-white shadow-xs font-normal'
                        : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100 font-normal'
                    }`
                  }
                >
                  {({ isActive }) => (
                    <>
                      <Database size={16} className={`mr-2.5 shrink-0 ${isActive ? 'text-white' : 'text-blue-600'}`} />
                      <span>Backup & Restore</span>
                    </>
                  )}
                </NavLink>

                <NavLink
                  to="/admin"
                  className={({ isActive }) =>
                    `flex items-center px-3 py-2 text-[13px] rounded-lg transition-all ${
                      isActive
                        ? 'bg-[#0055a5] text-white shadow-xs font-normal'
                        : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100 font-normal'
                    }`
                  }
                >
                  {({ isActive }) => (
                    <>
                      <Settings size={16} className={`mr-2.5 shrink-0 ${isActive ? 'text-white' : 'text-slate-400'}`} />
                      <span>User Management</span>
                    </>
                  )}
                </NavLink>
              </nav>
            </div>
          )}
        </div>

        {/* User Profile & Sign Out Footer */}
        <div className="p-3.5 border-t border-slate-200 bg-slate-50/70">
          <div className="flex items-center justify-between mb-2.5">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className={`w-8 h-8 rounded-lg ${
                isPurchase 
                  ? 'bg-purple-900 text-amber-300 ring-1 ring-amber-400/50' 
                  : 'bg-[#0055a5] text-white'
              } flex items-center justify-center font-bold text-xs shrink-0 shadow-xs`}>
                {currentUser.name.charAt(0).toUpperCase()}
              </div>
              <div className="overflow-hidden min-w-0">
                <p className="text-xs font-normal text-slate-900 truncate">{currentUser.name}</p>
                <span className="text-[10px] text-slate-500 uppercase tracking-wider block">
                  {currentUser.isAdmin ? 'Executive Admin' : 'Operator'}
                </span>
              </div>
            </div>

            <button
              onClick={logout}
              className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors"
              title="Sign Out"
            >
              <LogOut size={16} />
            </button>
          </div>

          <div className="pt-2 border-t border-slate-200/80 flex items-center justify-between text-[10px] text-slate-500">
            <span className="flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
              Live Database Connected
            </span>
            <span className={isPurchase ? "text-amber-700 font-bold" : "text-slate-400"}>
              {isPurchase ? "Purchase Book" : "v2.4"}
            </span>
          </div>
        </div>
      </aside>

      {/* ========================================================================= */}
      {/* MOBILE TOP BAR - Clean Compact Style */}
      {/* ========================================================================= */}
      <header className="sm:hidden fixed top-0 left-0 right-0 h-13 bg-white border-b border-slate-200 flex items-center px-3 justify-between z-40 shadow-2xs text-slate-900">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 bg-white border border-slate-200/90 rounded-lg shadow-2xs overflow-hidden flex items-center justify-center shrink-0">
            <video
              autoPlay
              loop
              muted
              playsInline
              preload="auto"
              className="w-full h-full object-cover pointer-events-none select-none"
            >
              <source src="/loading.webm" type="video/webm" />
              <source src="/loading.mp4" type="video/mp4" />
            </video>
          </div>
          <span className="font-medium text-xs tracking-tight text-slate-900">Greenzar Acc</span>
        </div>

        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={handleRefreshDatabase}
            disabled={isSyncing}
            className={`p-1.5 rounded-lg border border-slate-200 text-slate-600 hover:text-slate-900 hover:bg-slate-50 transition-colors ${isSyncing ? 'cursor-not-allowed' : ''}`}
            title="Refresh Database"
          >
            {syncSuccess ? (
              <Check size={14} className="text-emerald-600" />
            ) : (
              <RefreshCw size={14} className={isSyncing ? "animate-spin text-blue-600" : ""} />
            )}
          </button>

          <button 
            onClick={() => setShowLedgerMenu(!showLedgerMenu)}
            className={`text-xs font-semibold ${
              isPurchase 
                ? 'text-purple-950 bg-purple-50 hover:bg-purple-100 border-purple-200' 
                : 'text-slate-800 bg-slate-100 hover:bg-slate-200 border-slate-200'
            } px-2.5 py-1 rounded-lg border flex items-center gap-1 max-w-[130px] truncate transition-colors`}
          >
            <span className="truncate">{activeLedger?.name || 'Ledger'}</span>
            <ChevronDown size={12} className="opacity-60 shrink-0" />
          </button>
        </div>

        {showLedgerMenu && (
          <div className="absolute top-13 right-3 w-52 bg-white border border-slate-200 rounded-xl shadow-2xl overflow-hidden z-50 animate-in fade-in duration-150">
            <div className="max-h-48 overflow-y-auto p-1 space-y-0.5">
              {ledgers.map(l => (
                <button
                  key={l.id}
                  onClick={() => handleLedgerSwitch(l.id)}
                  className={`w-full text-left px-2.5 py-1.5 text-xs rounded-lg transition-colors ${
                    activeLedger?.id === l.id 
                      ? l.type === 'PURCHASE' ? 'bg-purple-900 text-amber-300 font-medium' : 'bg-[#0055a5] text-white font-normal' 
                      : 'text-slate-700 hover:bg-slate-100'
                  }`}
                >
                  {l.name}
                </button>
              ))}
            </div>
            {currentUser.isAdmin && (
              <div className="border-t border-slate-100 p-1 bg-slate-50">
                <button 
                  onClick={() => { setShowNewLedgerModal(true); setShowLedgerMenu(false); }}
                  className="w-full flex items-center text-left px-2.5 py-1.5 text-xs text-[#0055a5] hover:bg-blue-50 rounded-lg font-medium"
                >
                  <Plus size={13} className="mr-1.5" />
                  Add Ledger
                </button>
              </div>
            )}
          </div>
        )}
      </header>

      {/* ========================================================================= */}
      {/* MOBILE BOTTOM NAVIGATION BAR (Compact Modern 5-Slot Layout) */}
      {/* ========================================================================= */}
      <nav className="sm:hidden fixed bottom-0 left-0 right-0 h-14 bg-white border-t border-slate-200/90 flex items-center justify-around px-1 z-40 shadow-[0_-3px_12px_rgba(0,0,0,0.05)] text-slate-500">
        <NavLink
          to="/"
          end
          className={({ isActive }) =>
            `flex flex-col items-center justify-center flex-1 h-full py-1 text-[10.5px] font-medium transition-colors ${
              isActive ? (isPurchase ? 'text-purple-700 font-bold' : 'text-[#0055a5] font-bold') : 'text-slate-500 hover:text-slate-900'
            }`
          }
        >
          <LayoutDashboard size={18} className="mb-0.5" />
          <span>Overview</span>
        </NavLink>

        <NavLink
          to="/parties"
          className={({ isActive }) =>
            `flex flex-col items-center justify-center flex-1 h-full py-1 text-[10.5px] font-medium transition-colors ${
              isActive ? (isPurchase ? 'text-purple-700 font-bold' : 'text-[#0055a5] font-bold') : 'text-slate-500 hover:text-slate-900'
            }`
          }
        >
          <UsersIcon size={18} className="mb-0.5" />
          <span>Parties</span>
        </NavLink>

        {/* Compact Highlighted Master Entry Action */}
        <NavLink
          to="/master-entry"
          className="flex flex-col items-center justify-center flex-1 h-full relative"
        >
          {({ isActive }) => (
            <>
              <div className={`flex items-center justify-center w-10 h-10 rounded-full shadow-md border-2 border-white -top-3 absolute transition-transform active:scale-95 ${
                isPurchase
                  ? 'bg-gradient-to-tr from-purple-800 to-purple-950 text-amber-300 ring-1 ring-amber-400/90'
                  : 'bg-[#0055a5] text-white'
              }`}>
                <Plus size={20} className={isActive ? "rotate-90 transition-transform duration-200" : ""} />
              </div>
              <span className={`text-[10px] mt-6.5 font-medium ${
                isActive ? (isPurchase ? 'text-purple-800 font-bold' : 'text-[#0055a5] font-bold') : 'text-slate-500'
              }`}>
                Voucher
              </span>
            </>
          )}
        </NavLink>

        <NavLink
          to="/log"
          className={({ isActive }) =>
            `flex flex-col items-center justify-center flex-1 h-full py-1 text-[10.5px] font-medium transition-colors ${
              isActive ? (isPurchase ? 'text-purple-700 font-bold' : 'text-[#0055a5] font-bold') : 'text-slate-500 hover:text-slate-900'
            }`
          }
        >
          <FileText size={18} className="mb-0.5" />
          <span>Day Log</span>
        </NavLink>

        <button
          onClick={() => setShowMobileMore(!showMobileMore)}
          type="button"
          className={`flex flex-col items-center justify-center flex-1 h-full py-1 text-[10.5px] font-medium transition-colors ${
            showMobileMore ? (isPurchase ? 'text-purple-700 font-bold' : 'text-[#0055a5] font-bold') : 'text-slate-500 hover:text-slate-900'
          }`}
        >
          <Menu size={18} className="mb-0.5" />
          <span>Menu</span>
        </button>
      </nav>
    </>
  );
}
