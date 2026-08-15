import React, { useState, useEffect } from 'react';
import { useAuth } from '../AuthContext';
import { User } from '../types';
import { db, handleFirestoreError, OperationType, doc, setDoc, recreateDatabaseTables, getDatabaseTableStats } from '../firebase';
import { format } from 'date-fns';
import { Shield, UserPlus, X, Database, RefreshCw, Users as UsersIcon, CheckCircle2, AlertCircle } from 'lucide-react';
import { v4 as uuidv4 } from 'uuid';
import DatabaseBackupRestore from '../components/DatabaseBackupRestore';
import PageHeader from '../components/ui/PageHeader';
import StatCard from '../components/ui/StatCard';
import Badge from '../components/ui/Badge';
import { Card } from '../components/ui/Card';

interface AddUserModalProps {
  onClose: () => void;
}

function AddUserModal({ onClose }: AddUserModalProps) {
  const [name, setName] = useState('');
  const [pin, setPin] = useState('');
  const [isAdmin, setIsAdmin] = useState(false);
  const [masterPass, setMasterPass] = useState('');
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (masterPass !== 'greenzarthing6211') {
      setError('Invalid master admin password');
      return;
    }
    if (pin.length !== 4) {
      setError('PIN must be exactly 4 numeric digits');
      return;
    }

    const id = uuidv4();
    const newUser: User = {
      id,
      name,
      pin,
      isAdmin,
      deviceId: '',
      lastActivity: Date.now()
    };

    try {
      onClose();
      setDoc(doc(db, 'users', id), newUser).catch(err => {
        handleFirestoreError(err, OperationType.CREATE, `users/${id}`);
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, `users/${id}`);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-md border border-slate-200 overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center bg-slate-50">
          <h3 className="font-bold text-slate-900 text-sm">Provision System User</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600"><X size={18}/></button>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-4 text-xs">
          {error && (
            <div className="p-3 text-rose-700 bg-rose-50 border border-rose-200 rounded-lg font-semibold flex items-center gap-2">
              <AlertCircle size={15} />
              {error}
            </div>
          )}
          <div>
            <label className="block font-bold uppercase tracking-wider text-slate-700 mb-1.5">User Full Name / Label</label>
            <input 
              required 
              type="text" 
              value={name} 
              onChange={e => setName(e.target.value)} 
              className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:border-blue-600 text-slate-900 text-sm font-semibold" 
              placeholder="e.g. Finance Officer"
            />
          </div>
          <div>
            <label className="block font-bold uppercase tracking-wider text-slate-700 mb-1.5">4-Digit Security PIN</label>
            <input 
              required 
              type="password" 
              maxLength={4} 
              value={pin} 
              onChange={e => setPin(e.target.value.replace(/[^0-9]/g, ''))} 
              className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:border-blue-600 text-center tracking-widest font-mono text-sm font-bold" 
              placeholder="••••"
            />
          </div>
          
          <div className="flex items-center gap-2 pt-1">
            <input 
              type="checkbox" 
              id="isAdmin" 
              checked={isAdmin} 
              onChange={e => setIsAdmin(e.target.checked)} 
              className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500" 
            />
            <label htmlFor="isAdmin" className="font-bold text-slate-800 cursor-pointer select-none">
              Grant Executive Admin Privileges
            </label>
          </div>

          <div className="pt-4 border-t border-slate-100">
            <label className="block font-bold uppercase tracking-wider text-slate-700 mb-1.5">Master Authorisation Key</label>
            <input 
              required 
              type="password" 
              value={masterPass} 
              onChange={e => setMasterPass(e.target.value)} 
              className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:border-blue-600 font-mono text-sm" 
              placeholder="Required to provision account" 
            />
          </div>

          <div className="pt-4 flex justify-end gap-2">
            <button 
              type="button" 
              onClick={onClose} 
              className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-lg font-semibold"
            >
              Cancel
            </button>
            <button 
              type="submit" 
              className="px-5 py-2 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-lg shadow-xs"
            >
              Create Account
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function Users() {
  const { users, currentUser } = useAuth();
  const [showAdd, setShowAdd] = useState(false);
  const [isRecreating, setIsRecreating] = useState(false);
  const [dbStatusMsg, setDbStatusMsg] = useState('');
  const [dbStatusType, setDbStatusType] = useState<'success' | 'error'>('success');
  const [tableStats, setTableStats] = useState<{ tableName: string; count: number; exists: boolean }[]>([]);
  const [loadingStats, setLoadingStats] = useState(true);

  const fetchStats = async () => {
    setLoadingStats(true);
    try {
      const res = await getDatabaseTableStats();
      if (res.success) {
        setTableStats(res.stats);
      }
    } catch (err) {
      console.error("Error loading table stats:", err);
    } finally {
      setLoadingStats(false);
    }
  };

  useEffect(() => {
    if (currentUser?.isAdmin) {
      fetchStats();
    }
  }, [currentUser]);

  const handleRecreateTables = async () => {
    setIsRecreating(true);
    setDbStatusMsg('');
    try {
      const res = await recreateDatabaseTables();
      if (res.success) {
        setDbStatusType('success');
        setDbStatusMsg(res.message);
        await fetchStats();
      } else {
        setDbStatusType('error');
        setDbStatusMsg(`Error checking database tables: ${res.message}`);
      }
    } catch (err: any) {
      setDbStatusType('error');
      setDbStatusMsg(`Unexpected error: ${err?.message || String(err)}`);
    } finally {
      setIsRecreating(false);
    }
  };

  if (!currentUser?.isAdmin) {
    return <div className="p-8 text-center text-rose-600 font-semibold">Access Denied. Executive Admin role required.</div>;
  }

  const adminUsersCount = users.filter(u => u.isAdmin).length;
  const standardUsersCount = users.length - adminUsersCount;

  return (
    <div className="p-4 sm:p-8 max-w-6xl mx-auto w-full pb-24 sm:pb-8 space-y-6">
      {showAdd && <AddUserModal onClose={() => setShowAdd(false)} />}

      {/* Header */}
      <PageHeader
        title="User Access & Security Control"
        subtitle="Manage operators, administrative roles, security credentials, and storage engines"
        actions={
          <button 
            onClick={() => setShowAdd(true)} 
            className="inline-flex items-center justify-center px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-bold shadow-xs transition-colors"
          >
            <UserPlus size={15} className="mr-1.5" />
            Add User Account
          </button>
        }
      />

      {/* Stat Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatCard
          title="Total User Accounts"
          value={users.length}
          subtitle="Provisioned login profiles"
          icon={UsersIcon}
          iconColor="text-blue-600"
          iconBg="bg-blue-50"
        />

        <StatCard
          title="Administrator Accounts"
          value={adminUsersCount}
          subtitle="Full privilege role clearance"
          icon={Shield}
          iconColor="text-amber-600"
          iconBg="bg-amber-50"
        />

        <StatCard
          title="Standard Operator Accounts"
          value={standardUsersCount}
          subtitle="Restricted ledger entry profiles"
          icon={UsersIcon}
          iconColor="text-slate-600"
          iconBg="bg-slate-100"
        />
      </div>

      {/* User Accounts Table */}
      <Card>
        <div className="p-4 border-b border-slate-100 bg-slate-50/60 flex items-center justify-between">
          <h3 className="font-bold text-slate-900 text-xs sm:text-sm">Active System Operator Directory</h3>
          <span className="text-xs text-slate-500 font-mono">Role-based access level</span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse table-finance">
            <thead>
              <tr>
                <th>Username / Operator</th>
                <th className="w-40">System Role</th>
                <th className="w-48 text-right">Last System Activity</th>
              </tr>
            </thead>
            <tbody>
              {users.map(u => (
                <tr key={u.id} className="hover:bg-blue-50/40 transition-colors">
                  <td>
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-lg bg-slate-900 text-white flex items-center justify-center text-xs font-bold shrink-0">
                        {(u.name || 'U').charAt(0).toUpperCase()}
                      </div>
                      <div>
                        <span className="font-bold text-slate-900 text-xs sm:text-sm block">
                          {u.name || 'Unnamed Operator'}
                        </span>
                        {u.id === currentUser.id && (
                          <Badge variant="navy" size="xs">Current Session</Badge>
                        )}
                      </div>
                    </div>
                  </td>
                  <td>
                    {u.isAdmin ? (
                      <Badge variant="credit" size="sm">
                        <Shield size={12} className="mr-1 inline" />
                        Executive Admin
                      </Badge>
                    ) : (
                      <Badge variant="neutral" size="sm">
                        Standard User
                      </Badge>
                    )}
                  </td>
                  <td className="text-right font-mono text-xs text-slate-600">
                    {u.lastActivity ? format(new Date(u.lastActivity), 'dd MMM yyyy, HH:mm') : 'Never logged'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Database Backup & Restore Module */}
      <div className="pt-2">
        <DatabaseBackupRestore />
      </div>

      {/* Live Table Monitor */}
      <Card>
        <div className="p-5 border-b border-slate-100 bg-slate-50/60 flex items-center justify-between">
          <div>
            <h3 className="font-bold text-slate-900 text-sm">Database Engine & Table Verification</h3>
            <p className="text-xs text-slate-500 mt-0.5">Live SQL record statistics and database health diagnostics</p>
          </div>
          <button 
            onClick={fetchStats}
            className="p-1.5 text-slate-400 hover:text-blue-600 rounded hover:bg-blue-50 transition-colors"
            title="Refresh statistics"
          >
            <RefreshCw size={15} />
          </button>
        </div>
        
        <div className="p-5 space-y-5">
          {loadingStats ? (
            <div className="flex items-center space-x-2 text-slate-500 text-xs py-4">
              <RefreshCw size={14} className="animate-spin text-blue-600" />
              <span>Verifying database table records...</span>
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
              {tableStats.map(stat => (
                <div key={stat.tableName} className="p-3.5 border border-slate-200 rounded-xl bg-slate-50/50 flex flex-col justify-between">
                  <div className="flex justify-between items-start">
                    <span className="font-mono text-xs font-bold text-slate-900 bg-white border border-slate-200 px-2 py-0.5 rounded">
                      {stat.tableName}
                    </span>
                    <Badge variant={stat.exists ? 'credit' : 'debit'} size="xs">
                      {stat.exists ? 'Online' : 'Offline'}
                    </Badge>
                  </div>
                  <div className="mt-3 flex justify-between items-baseline pt-2 border-t border-slate-200/60">
                    <span className="text-[11px] text-slate-500 font-medium">Records</span>
                    <span className="text-base font-bold font-mono text-slate-900">{stat.count}</span>
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="pt-4 border-t border-slate-100 flex flex-col sm:flex-row gap-3 items-center justify-between">
            <div>
              <h4 className="font-bold text-slate-900 text-xs">Diagnostic Safe Repair</h4>
              <p className="text-[11px] text-slate-500">Re-validates all relational indexes while strictly preserving data</p>
            </div>
            
            <button
              onClick={handleRecreateTables}
              disabled={isRecreating}
              className="px-4 py-2 bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white rounded-lg text-xs font-bold shadow-xs transition-colors flex items-center"
            >
              {isRecreating ? (
                <>
                  <RefreshCw size={14} className="mr-1.5 animate-spin" />
                  Verifying Tables...
                </>
              ) : (
                <>
                  <Database size={14} className="mr-1.5" />
                  Safe Structure Repair
                </>
              )}
            </button>
          </div>

          {dbStatusMsg && (
            <div className={`p-3 rounded-lg text-xs font-medium border ${
              dbStatusType === 'success' ? 'bg-emerald-50 border-emerald-200 text-emerald-800' : 'bg-rose-50 border-rose-200 text-rose-800'
            }`}>
              {dbStatusMsg}
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}
