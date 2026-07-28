import React, { useState, useEffect } from 'react';
import { useAuth } from '../AuthContext';
import { User } from '../types';
import { db, handleFirestoreError, OperationType, doc, setDoc, recreateDatabaseTables, getDatabaseTableStats } from '../firebase';
import { format } from 'date-fns';
import { Shield, UserPlus, X, Database, RefreshCw } from 'lucide-react';
import { v4 as uuidv4 } from 'uuid';
import DatabaseBackupRestore from '../components/DatabaseBackupRestore';

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
      setError('PIN must be exactly 4 digits');
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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md overflow-hidden">
        <div className="flex justify-between items-center p-4 border-b">
          <h3 className="font-semibold text-lg text-gray-900">Add New User</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={20}/></button>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {error && <div className="p-3 text-sm text-red-600 bg-red-50 rounded-md">{error}</div>}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Username</label>
            <input required type="text" value={name} onChange={e => setName(e.target.value)} className="w-full px-3 py-2 border rounded-md focus:border-sky-500 focus:ring-1 focus:ring-sky-500" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">4-Digit PIN</label>
            <input required type="password" maxLength={4} value={pin} onChange={e => setPin(e.target.value.replace(/[^0-9]/g, ''))} className="w-full px-3 py-2 border rounded-md focus:border-sky-500 focus:ring-1 focus:ring-sky-500 text-center tracking-widest" />
          </div>
          
          <div className="flex items-center mt-4">
            <input type="checkbox" id="isAdmin" checked={isAdmin} onChange={e => setIsAdmin(e.target.checked)} className="h-4 w-4 rounded border-gray-300 text-sky-600 focus:ring-sky-500" />
            <label htmlFor="isAdmin" className="ml-2 block text-sm text-gray-900">Is Admin?</label>
          </div>

          <div className="pt-4 border-t mt-4">
            <label className="block text-sm font-medium text-gray-700 mb-1">Master Admin Password</label>
            <input required type="password" value={masterPass} onChange={e => setMasterPass(e.target.value)} className="w-full px-3 py-2 border rounded-md focus:border-sky-500 focus:ring-1 focus:ring-sky-500" placeholder="Required for adding users" />
          </div>

          <div className="pt-4 flex justify-end">
            <button type="button" onClick={onClose} className="px-4 py-2 text-gray-600 mr-2 hover:bg-gray-50 rounded-md">Cancel</button>
            <button type="submit" className="px-4 py-2 bg-sky-600 text-white rounded-md hover:bg-sky-700">Create User</button>
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
        setDbStatusMsg(`Error recreating database tables: ${res.message}`);
      }
    } catch (err: any) {
      setDbStatusType('error');
      setDbStatusMsg(`Unexpected error: ${err?.message || String(err)}`);
    } finally {
      setIsRecreating(false);
    }
  };

  if (!currentUser?.isAdmin) {
    return <div className="p-8 text-center text-red-600">Access Denied</div>;
  }

  return (
    <div className="p-4 sm:p-8 max-w-5xl mx-auto w-full pb-24 sm:pb-8">
      {showAdd && <AddUserModal onClose={() => setShowAdd(false)} />}

      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-8 gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900 tracking-tight">User Management</h1>
          <p className="text-sm text-gray-500 mt-1">Manage system access and privileges</p>
        </div>
        <button onClick={() => setShowAdd(true)} className="flex items-center px-3 py-2 bg-sky-600 text-white rounded-md text-sm font-medium hover:bg-sky-700 transition-colors font-sans">
          <UserPlus size={16} className="mr-2" />
          Add User
        </button>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="bg-gray-50/50 border-b text-xs uppercase tracking-wider text-gray-500">
              <th className="p-4 font-medium">Username</th>
              <th className="p-4 font-medium">Role</th>
              <th className="p-4 font-medium text-right">Last Activity</th>
            </tr>
          </thead>
          <tbody>
            {users.map(u => (
              <tr key={u.id} className="border-b border-gray-50 hover:bg-gray-50 transition-colors">
                <td className="p-4">
                  <div className="flex items-center font-medium text-gray-900">
                    <div className="w-8 h-8 rounded-full bg-sky-100 text-sky-700 flex items-center justify-center mr-3 text-xs font-bold">
                      {(u.name || 'U').charAt(0).toUpperCase()}
                    </div>
                    {u.name || 'Unnamed'} 
                    {u.id === currentUser.id && <span className="ml-2 text-xs bg-sky-100 text-sky-800 px-2 py-0.5 rounded-full font-medium">You</span>}
                  </div>
                </td>
                <td className="p-4">
                  {u.isAdmin ? (
                    <span className="flex items-center text-xs font-medium text-amber-700 bg-amber-50 border border-amber-200 px-2 py-1 rounded w-max">
                      <Shield size={12} className="mr-1" />
                      Admin
                    </span>
                  ) : (
                    <span className="text-xs font-medium text-gray-600 bg-gray-100 px-2 py-1 rounded">
                      User
                    </span>
                  )}
                </td>
                <td className="p-4 text-sm text-gray-500 text-right">
                  {u.lastActivity ? format(new Date(u.lastActivity), 'dd MMM yyyy, HH:mm') : 'Never'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Database Backup & Restore Module */}
      <div className="mt-8">
        <DatabaseBackupRestore />
      </div>

      {/* Live Table Monitor list */}
      <div className="mt-8 bg-white rounded-xl shadow-sm border border-gray-100 p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-2">Live Database Tables</h2>
        <p className="text-sm text-gray-500 mb-6">Currently recognized tables in your database and active record counts</p>
        
        {loadingStats ? (
          <div className="flex items-center space-x-2 text-gray-500 text-sm py-4">
            <RefreshCw size={16} className="animate-spin text-sky-600" />
            <span>Retrieving table counts...</span>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
            {tableStats.map(stat => (
              <div key={stat.tableName} className="p-4 border rounded-xl bg-gray-50/50 flex flex-col justify-between hover:shadow-sm transition-all">
                <div className="flex justify-between items-start">
                  <span className="font-mono text-xs font-bold text-gray-800 bg-white border px-2 py-1 rounded">
                    {stat.tableName}
                  </span>
                  {stat.exists ? (
                    <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full">
                      Online
                    </span>
                  ) : (
                    <span className="text-[10px] font-bold uppercase tracking-wider text-red-700 bg-red-50 px-2 py-0.5 rounded-full">
                      Offline
                    </span>
                  )}
                </div>
                <div className="mt-4 flex justify-between items-baseline">
                  <span className="text-xs text-gray-500">Total Rows</span>
                  <span className="text-lg font-extrabold text-gray-900">{stat.count}</span>
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="border-t pt-6">
          <h3 className="font-semibold text-gray-900 text-sm mb-2">Database Actions</h3>
          
          {dbStatusMsg && (
            <div className={`p-4 mb-5 rounded-lg text-sm font-medium border ${dbStatusType === 'success' ? 'bg-emerald-50 border-emerald-200 text-emerald-800' : 'bg-red-50 border-red-200 text-red-800'}`}>
              {dbStatusMsg}
            </div>
          )}

          <div className="flex flex-col sm:flex-row gap-3">
            <button
              onClick={handleRecreateTables}
              disabled={isRecreating}
              className="flex items-center justify-center px-4 py-2.5 bg-sky-600 hover:bg-sky-700 disabled:bg-sky-600 disabled:opacity-50 text-white rounded-lg text-sm font-medium transition-all"
            >
              {isRecreating ? (
                <>
                  <RefreshCw size={16} className="mr-2 animate-spin" />
                  Repairing...
                </>
              ) : (
                <>
                  <Database size={16} className="mr-2" />
                  Safe Repair (Keep Data)
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
