import React, { useState, useEffect } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { LayoutDashboard, Users as UsersIcon, FileText, Settings, LogOut, ChevronDown, Plus, BookOpen, Package, Activity, Menu, Sun, Moon, Database, AlertCircle, RefreshCw, Check, Mail, FileSpreadsheet } from 'lucide-react';
import { useAuth } from '../AuthContext';
import { useLedger } from '../LedgerContext';
import { useTheme } from '../ThemeContext';
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
  
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await onCreate(name, type);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-sm overflow-hidden">
        <div className="p-4 border-b flex justify-between items-center">
          <h3 className="font-semibold text-lg text-gray-900">New Ledger</h3>
          <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-600 text-2xl leading-none">&times;</button>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Ledger Name</label>
            <input required type="text" value={name} onChange={e => setName(e.target.value)} className="w-full px-3 py-2 border rounded-md focus:border-sky-500 focus:ring-1 focus:ring-sky-500" placeholder="e.g. Purchase Ledger 2026" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Type</label>
            <select value={type} onChange={e => setType(e.target.value as Ledger['type'])} className="w-full px-3 py-2 border rounded-md focus:border-sky-500 focus:ring-1 focus:ring-sky-500">
              {Object.entries(LEDGER_TYPE_LABELS).map(([key, label]) => (
                <option key={key} value={key}>{label}</option>
              ))}
            </select>
          </div>
          <div className="pt-4 flex justify-end">
            <button type="button" onClick={onClose} className="px-4 py-2 text-gray-600 mr-2 hover:bg-gray-50 rounded-md">Cancel</button>
            <button type="submit" className="px-4 py-2 bg-sky-600 text-white rounded-md hover:bg-sky-700">Create</button>
          </div>
        </form>
      </div>
    </div>
  );
}



export default function Navigation() {
  const { currentUser, logout } = useAuth();
  const { ledgers, activeLedger, setActiveLedgerId, createLedger } = useLedger();
  const { theme, toggleTheme } = useTheme();
  const [showLedgerMenu, setShowLedgerMenu] = useState(false);
  const [showNewLedgerModal, setShowNewLedgerModal] = useState(false);
  const [showMobileMore, setShowMobileMore] = useState(false);
  const navigate = useNavigate();
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
          syncCollection('products', activeLedger.id, 'products'),
          syncCollection('transactions', activeLedger.id, 'transactions'),
          syncCollection('dashboard_summary', activeLedger.id, 'dashboard_summary'),
          syncCollection('tracked_invoices', activeLedger.id, 'tracked_invoices')
        ]);
      }
      setSyncSuccess(true);
      window.dispatchEvent(new CustomEvent('database-synced'));
      setTimeout(() => {
        setSyncSuccess(false);
      }, 800);
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

  if (!currentUser) return null;

  const links = [
    { to: '/', icon: <LayoutDashboard size={20} />, label: 'Dashboard' },
    { to: '/parties', icon: <UsersIcon size={20} />, label: 'Parties' },
    { to: '/products', icon: <Package size={20} />, label: 'Products' },
    { to: '/master-entry', icon: <Plus size={20} />, label: 'Master Entry' },
    ...(activeLedger?.type === 'SALE' ? [{ to: '/invoice-sheets', icon: <BookOpen size={20} />, label: 'Invoice Sheets' }] : []),
    { to: '/log', icon: <FileText size={20} />, label: 'Log' },
    { to: '/activities', icon: <Activity size={20} />, label: 'Activities' },
    ...(currentUser.isAdmin ? [{ to: '/accounts-mail', icon: <FileSpreadsheet size={20} />, label: 'Google Sheets Sync' }] : []),
  ];

  if (currentUser.isAdmin) {
    links.push({ to: '/admin', icon: <Settings size={20} />, label: 'Admin Users' });
  }

  const handleCreateLedger = async (name: string, type: Ledger['type']) => {
    await createLedger(name, type);
    setShowNewLedgerModal(false);
    setShowLedgerMenu(false);
  };

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
          className="fixed inset-0 bg-black/40 backdrop-blur-sm z-40 sm:hidden transition-opacity" 
          onClick={() => setShowMobileMore(false)} 
        />
      )}

      {/* Mobile Bottom More Drawer */}
      {showMobileMore && (
        <div className="fixed inset-x-0 bottom-16 bg-white border-t rounded-t-2xl shadow-2xl z-50 p-5 divide-y divide-gray-100 max-h-[75vh] overflow-y-auto sm:hidden animate-in fade-in slide-in-from-bottom duration-200">
          <div className="flex justify-between items-center pb-3">
            <h3 className="font-bold text-xs uppercase tracking-wider text-gray-400">All Operations</h3>
            <button 
              className="text-gray-400 hover:text-gray-600 font-extrabold text-xl leading-none p-1" 
              onClick={() => setShowMobileMore(false)}
            >
              &times;
            </button>
          </div>
          
          <div className="py-3 space-y-1">
            <NavLink 
              to="/products" 
              onClick={() => setShowMobileMore(false)} 
              className={({ isActive }) => `flex items-center px-4 py-3 rounded-lg text-sm font-medium transition-colors ${isActive ? 'bg-sky-50 text-sky-700' : 'text-gray-700 hover:bg-gray-50'}`}
            >
              <Package size={18} className="mr-3 text-sky-500" />
              Products
            </NavLink>
            
            <NavLink 
              to="/activities" 
              onClick={() => setShowMobileMore(false)} 
              className={({ isActive }) => `flex items-center px-4 py-3 rounded-lg text-sm font-medium transition-colors ${isActive ? 'bg-sky-50 text-sky-700' : 'text-gray-700 hover:bg-gray-50'}`}
            >
              <Activity size={18} className="mr-3 text-emerald-500" />
              All Activities
            </NavLink>
            
            {activeLedger?.type === 'SALE' && (
              <NavLink 
                to="/invoice-sheets" 
                onClick={() => setShowMobileMore(false)} 
                className={({ isActive }) => `flex items-center px-4 py-3 rounded-lg text-sm font-medium transition-colors ${isActive ? 'bg-sky-50 text-sky-700' : 'text-gray-700 hover:bg-gray-50'}`}
              >
                <BookOpen size={18} className="mr-3 text-indigo-500" />
                Invoice Sheets
              </NavLink>
            )}

            {currentUser.isAdmin && (
              <NavLink 
                to="/accounts-mail" 
                onClick={() => setShowMobileMore(false)} 
                className={({ isActive }) => `flex items-center px-4 py-3 rounded-lg text-sm font-medium transition-colors ${isActive ? 'bg-sky-50 text-sky-700' : 'text-gray-700 hover:bg-gray-50'}`}
              >
                <FileSpreadsheet size={18} className="mr-3 text-emerald-500" />
                Google Sheets Sync
              </NavLink>
            )}
            
            {currentUser.isAdmin && (
              <NavLink 
                to="/admin" 
                onClick={() => setShowMobileMore(false)} 
                className={({ isActive }) => `flex items-center px-4 py-3 rounded-lg text-sm font-medium transition-colors ${isActive ? 'bg-sky-50 text-sky-700' : 'text-gray-700 hover:bg-gray-50'}`}
              >
                <Settings size={18} className="mr-3 text-amber-500" />
                Admin Settings
              </NavLink>
            )}
          </div>

          <div className="pt-4">
            <div className="flex items-center px-4 py-2 mb-4 bg-gray-50 rounded-lg border border-gray-100">
              <div className="w-8 h-8 rounded-full bg-sky-100 flex items-center justify-center text-sky-700 font-bold mr-3 text-xs">
                {currentUser.name.charAt(0).toUpperCase()}
              </div>
              <div className="overflow-hidden">
                <p className="font-bold text-sm text-gray-950 leading-tight truncate">{currentUser.name}</p>
                <p className="text-[10px] text-gray-500 leading-none mt-1">{currentUser.isAdmin ? 'Administrator' : 'User'}</p>
              </div>
            </div>
            <button 
              onClick={() => { setShowMobileMore(false); logout(); }} 
              className="w-full flex items-center px-4 py-3 text-sm font-bold text-red-600 hover:bg-red-50 rounded-lg transition-colors border border-transparent hover:border-red-100"
            >
              <LogOut size={18} className="mr-3" />
              Sign Out
            </button>
          </div>
        </div>
      )}

      {/* Main Navigation Wrapper */}
      {/* 
        - Desktop: Left sidebar (sm:relative sm:w-64 sm:h-screen sm:flex sm:flex-col)
        - Mobile: Squeezeless 5-slot bottom bar (fixed bottom-0 left-0 right-0 h-16 flex flex-row)
      */}
      <nav className="fixed bottom-0 left-0 right-0 bg-white border-t sm:relative sm:border-t-0 sm:border-r w-full sm:w-64 h-16 sm:h-screen flex flex-row sm:flex-col shadow-lg sm:shadow-sm z-40 transition-all">
        
        {/* Desktop Header */}
        <div className="hidden sm:flex flex-col border-b p-4">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center">
              <CompanyLogo className="h-20 w-auto" variant={theme === 'dark' ? 'white' : 'color'} />
            </div>
            <button
              type="button"
              onClick={handleRefreshDatabase}
              disabled={isSyncing}
              className={`p-1.5 rounded-lg border hover:bg-gray-100 transition-all text-gray-500 hover:text-sky-600 flex items-center justify-center relative ${isSyncing ? 'cursor-not-allowed opacity-85' : ''}`}
              title="Refresh and Sync Local Cache with Database"
            >
              {syncSuccess ? (
                <Check size={18} className="text-emerald-600 animate-bounce" />
              ) : (
                <RefreshCw size={18} className={isSyncing ? "animate-spin text-sky-600" : ""} />
              )}
            </button>
          </div>
          
          <div className="relative">
            <button 
              onClick={() => setShowLedgerMenu(!showLedgerMenu)}
              className="w-full flex items-center justify-between px-3 py-2 bg-gray-50 hover:bg-gray-100 border border-gray-200 rounded-md text-sm transition-colors text-left"
            >
              <div className="overflow-hidden">
                <div className="font-semibold text-gray-900 truncate">{activeLedger?.name || 'Select Ledger'}</div>
                <div className="text-xs text-gray-500">{activeLedger ? LEDGER_TYPE_LABELS[activeLedger.type] || activeLedger.type : ''}</div>
              </div>
              <ChevronDown size={16} className="text-gray-500 ml-2 flex-shrink-0" />
            </button>
            
            {showLedgerMenu && (
              <div className="absolute top-full mt-1 left-0 right-0 bg-white border border-gray-200 rounded-md shadow-lg overflow-hidden z-50">
                <div className="max-h-48 overflow-y-auto">
                  {ledgers.map(l => (
                    <button
                      key={l.id}
                      onClick={() => handleLedgerSwitch(l.id)}
                      className={`w-full text-left px-3 py-2 text-sm hover:bg-sky-50 transition-colors ${activeLedger?.id === l.id ? 'bg-sky-50 font-medium text-sky-700' : 'text-gray-700'}`}
                    >
                      {l.name}
                    </button>
                  ))}
                </div>
                {currentUser.isAdmin && (
                  <div className="border-t border-gray-100 p-1">
                    <button 
                      onClick={() => setShowNewLedgerModal(true)}
                      className="w-full flex items-center text-left px-2 py-1.5 text-sm text-sky-600 hover:bg-sky-50 rounded"
                    >
                      <Plus size={14} className="mr-1.5" />
                      Add Ledger
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
        
        {/* Mobile Top Ledger Header */}
        <div className="sm:hidden fixed top-0 w-full h-16 bg-white border-b flex items-center px-4 justify-between z-40 shadow-sm bg-opacity-95 backdrop-blur-sm">
          <div className="flex items-center h-14">
            <CompanyLogo className="h-13 w-auto" variant={theme === 'dark' ? 'white' : 'color'} />
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleRefreshDatabase}
              disabled={isSyncing}
              className={`p-1.5 rounded-full border hover:bg-gray-100 text-gray-500 hover:text-sky-600 transition-colors flex items-center justify-center ${isSyncing ? 'cursor-not-allowed opacity-85' : ''}`}
              title="Refresh and Sync Local Cache with Database"
            >
              {syncSuccess ? (
                <Check size={14} className="text-emerald-600 animate-bounce" />
              ) : (
                <RefreshCw size={14} className={isSyncing ? "animate-spin text-sky-600" : ""} />
              )}
            </button>
            <button 
              onClick={() => setShowLedgerMenu(!showLedgerMenu)}
              className="text-xs font-bold text-sky-700 bg-sky-50 px-3 py-1.5 rounded-full max-w-[170px] truncate border border-sky-100 flex items-center gap-1 active:scale-95 transition-transform"
            >
              {activeLedger?.name || 'Select Ledger'}
              <ChevronDown size={12} className="opacity-70" />
            </button>
          </div>
          
          {showLedgerMenu && (
            <div className="absolute top-16 right-4 w-52 bg-white border border-gray-250 rounded-xl shadow-xl overflow-hidden z-50 border-gray-150 animate-in fade-in slide-in-from-top-1">
              <div className="max-h-48 overflow-y-auto p-1 space-y-0.5">
                {ledgers.map(l => (
                  <button
                    key={l.id}
                    onClick={() => handleLedgerSwitch(l.id)}
                    className={`w-full text-left px-3 py-2.5 text-xs rounded-lg hover:bg-sky-50 transition-colors ${activeLedger?.id === l.id ? 'bg-sky-50 font-bold text-sky-700' : 'text-gray-700'}`}
                  >
                    {l.name}
                  </button>
                ))}
              </div>
              {currentUser.isAdmin && (
                <div className="border-t border-gray-150 p-1.5 bg-gray-50">
                  <button 
                    onClick={() => { setShowNewLedgerModal(true); setShowLedgerMenu(false); }}
                    className="w-full flex items-center text-left px-3 py-2 text-xs text-sky-600 hover:bg-sky-100 rounded-lg font-semibold"
                  >
                    <Plus size={14} className="mr-1.5" />
                    Add Ledger
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
        
        {/* Desktop Sidebar Links list */}
        <div className="hidden sm:flex flex-1 flex-col overflow-y-auto">
          {links.map((link) => (
            <NavLink
              key={link.to}
              to={link.to}
              className={({ isActive }) =>
                `flex flex-row items-center p-2 px-4 py-3 text-sm font-medium transition-colors ${
                  isActive ? 'text-sky-600 bg-sky-50 border-l-4 border-sky-600' : 'text-gray-500 hover:text-gray-900 hover:bg-gray-50 border-l-4 border-transparent'
                }`
              }
            >
              <span className="mr-3">{link.icon}</span>
              <span>{link.label}</span>
            </NavLink>
          ))}
        </div>

        {/* Mobile bottom tabs layout (Optimized 5-slot Layout) */}
        <div className="sm:hidden flex w-full h-full items-center justify-around px-2">
          {/* Slot 1: Dashboard (Home) */}
          <NavLink
            to="/"
            className={({ isActive }) =>
              `flex flex-col items-center justify-center flex-1 h-full py-1 text-[10px] font-bold transition-colors ${
                isActive ? 'text-sky-600' : 'text-gray-400 hover:text-gray-700'
              }`
            }
          >
            <LayoutDashboard size={20} className="mb-0.5" />
            <span>Dashboard</span>
          </NavLink>

          {/* Slot 2: Parties */}
          <NavLink
            to="/parties"
            className={({ isActive }) =>
              `flex flex-col items-center justify-center flex-1 h-full py-1 text-[10px] font-bold transition-colors ${
                isActive ? 'text-sky-600' : 'text-gray-400 hover:text-gray-700'
              }`
            }
          >
            <UsersIcon size={20} className="mb-0.5" />
            <span>Parties</span>
          </NavLink>

          {/* Slot 3: Master Entry (Highlighted center button) */}
          <NavLink
            to="/master-entry"
            className="flex flex-col items-center justify-center flex-1 h-full relative"
          >
            {({ isActive }) => (
              <>
                <div className={`flex items-center justify-center w-11 h-11 rounded-full shadow-md border-4 border-white active:scale-95 transition-transform absolute -top-4 ${
                  isActive ? 'bg-sky-600 text-white' : 'bg-gray-700 text-white'
                }`}>
                  <Plus size={22} className={isActive ? "rotate-90 transition-transform duration-200" : ""} />
                </div>
                <span className={`text-[10px] font-bold mt-8 ${isActive ? 'text-sky-600' : 'text-gray-400'}`}>Entry</span>
              </>
            )}
          </NavLink>

          {/* Slot 4: Log */}
          <NavLink
            to="/log"
            className={({ isActive }) =>
              `flex flex-col items-center justify-center flex-1 h-full py-1 text-[10px] font-bold transition-colors ${
                isActive ? 'text-sky-600' : 'text-gray-400 hover:text-gray-700'
              }`
            }
          >
            <FileText size={20} className="mb-0.5" />
            <span>Log</span>
          </NavLink>

          {/* Slot 5: More (Custom menu toggle button) */}
          <button
            onClick={() => setShowMobileMore(!showMobileMore)}
            type="button"
            className={`flex flex-col items-center justify-center flex-1 h-full py-1 text-[10px] font-bold transition-colors ${
              showMobileMore ? 'text-sky-600' : 'text-gray-400 hover:text-gray-700'
            }`}
          >
            <Menu size={20} className="mb-0.5" />
            <span>More</span>
          </button>
        </div>

        {/* Desktop Footer section */}
        <div className="hidden sm:block p-4 border-t">
          <div className="flex items-center mb-4">
            <div className="w-8 h-8 rounded-full bg-sky-100 flex items-center justify-center text-sky-700 font-bold mr-3">
              {currentUser.name.charAt(0).toUpperCase()}
            </div>
            <div className="overflow-hidden text-sm">
              <p className="font-medium text-gray-900 truncate">{currentUser.name}</p>
              <p className="text-xs text-gray-500 truncate">{currentUser.isAdmin ? 'Admin' : 'User'}</p>
            </div>
          </div>
          <button
            onClick={logout}
            className="w-full flex items-center justify-center px-4 py-2 text-sm font-medium text-gray-700 bg-gray-50 hover:bg-gray-100 rounded-md transition-colors"
          >
            <LogOut size={16} className="mr-2" />
            Sign Out
          </button>
        </div>
      </nav>
    </>
  );
}
