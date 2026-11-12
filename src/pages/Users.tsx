import React, { useState, useEffect } from 'react';
import { useAuth } from '../AuthContext';
import { User, UserActivity } from '../types';
import { db, handleFirestoreError, OperationType, doc, setDoc, updateDoc, recreateDatabaseTables, getDatabaseTableStats } from '../firebase';
import { format } from 'date-fns';
import { 
  Shield, 
  UserPlus, 
  X, 
  Database, 
  RefreshCw, 
  Users as UsersIcon, 
  CheckCircle2, 
  AlertCircle, 
  Activity, 
  Clock, 
  Smartphone, 
  History, 
  Search,
  Filter,
  ArrowRight,
  Eye,
  Check,
  Copy,
  Trash2,
  AlertTriangle,
  MessageSquare
} from 'lucide-react';
import { v4 as uuidv4 } from 'uuid';
import DatabaseBackupRestore from '../components/DatabaseBackupRestore';
import PageHeader from '../components/ui/PageHeader';
import StatCard from '../components/ui/StatCard';
import Badge from '../components/ui/Badge';
import { Card } from '../components/ui/Card';
import { fetchUserActivities, logUserActivity } from '../lib/activityLogger';
import { getDeviceId, isDeviceAuthorized, ADMIN_WHATSAPP_NUMBER } from '../lib/deviceId';

function formatRelativeTime(timestamp?: number) {
  if (!timestamp) return 'Never active';
  const diff = Math.max(0, Date.now() - timestamp);
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);

  if (diff < 30000) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days === 1) return 'Yesterday';
  if (days < 30) return `${days}d ago`;
  return format(new Date(timestamp), 'dd MMM yyyy');
}

function getUserPresence(user: User) {
  if (!user.lastActivity) {
    return { 
      label: 'Offline', 
      badgeVariant: 'neutral' as const, 
      dotClass: 'bg-slate-300' 
    };
  }
  const diff = Date.now() - user.lastActivity;
  if (diff < 5 * 60 * 1000 && user.deviceId) {
    return { 
      label: 'Online Now', 
      badgeVariant: 'credit' as const, 
      dotClass: 'bg-emerald-500 animate-pulse' 
    };
  }
  if (diff < 60 * 60 * 1000) {
    return { 
      label: 'Active Recently', 
      badgeVariant: 'amber' as const, 
      dotClass: 'bg-amber-500' 
    };
  }
  return { 
    label: 'Offline', 
    badgeVariant: 'neutral' as const, 
    dotClass: 'bg-slate-400' 
  };
}

interface AddUserModalProps {
  onClose: () => void;
}

function AddUserModal({ onClose }: AddUserModalProps) {
  const { currentUser, currentDeviceId } = useAuth();
  const [name, setName] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [initialDeviceId, setInitialDeviceId] = useState('');
  const [isAdmin, setIsAdmin] = useState(false);
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    const cleanName = name.trim();
    const cleanUsername = username.trim();
    const cleanPassword = password.trim();
    const cleanDev = initialDeviceId.trim();

    if (!cleanName) {
      setError('Please enter a name');
      return;
    }
    if (!cleanUsername) {
      setError('Please enter a username');
      return;
    }
    if (!cleanPassword) {
      setError('Please enter a password');
      return;
    }

    setIsSubmitting(true);
    const id = uuidv4();
    const newUser: User = {
      id,
      name: cleanName,
      username: cleanUsername.toLowerCase(),
      pin: cleanPassword,
      isAdmin,
      role: isAdmin ? 'admin' : 'user',
      deviceId: '',
      authorizedDeviceId: cleanDev,
      authorizedDeviceIds: cleanDev ? [cleanDev] : [],
      lastActivity: Date.now(),
      lastAction: 'Account Created',
      lastActionDetails: `Created by ${currentUser?.name || 'Administrator'}${cleanDev ? ` with authorized device ${cleanDev}` : ''}`
    };

    try {
      await setDoc(doc(db, 'users', id), newUser);
      logUserActivity('Created User Account', `Added new user: ${cleanName} (@${cleanUsername}) - ${isAdmin ? 'Admin' : 'Standard User'}`, currentUser);
      onClose();
    } catch (err: any) {
      setError(err?.message || 'Failed to create user account');
      handleFirestoreError(err, OperationType.CREATE, `users/${id}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-md border border-slate-200 overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center bg-slate-50">
          <h3 className="font-bold text-slate-900 text-sm">Add New User</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 cursor-pointer"><X size={18}/></button>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-4 text-xs">
          {error && (
            <div className="p-3 text-rose-700 bg-rose-50 border border-rose-200 rounded-lg font-semibold flex items-center gap-2">
              <AlertCircle size={15} />
              {error}
            </div>
          )}

          {/* 1. Name */}
          <div>
            <label className="block font-bold uppercase tracking-wider text-slate-700 mb-1.5">
              Name
            </label>
            <input 
              required 
              type="text" 
              value={name} 
              onChange={e => setName(e.target.value)} 
              className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:border-blue-600 focus:ring-1 focus:ring-blue-600 text-slate-900 text-sm font-semibold" 
              placeholder="e.g. John Doe"
            />
          </div>

          {/* 2. Username (below Name) */}
          <div>
            <label className="block font-bold uppercase tracking-wider text-slate-700 mb-1.5">
              Username
            </label>
            <input 
              required 
              type="text" 
              value={username} 
              onChange={e => setUsername(e.target.value)} 
              className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:border-blue-600 focus:ring-1 focus:ring-blue-600 text-slate-900 text-sm font-semibold" 
              placeholder="e.g. johndoe"
            />
          </div>

          {/* 3. Password (below Username) */}
          <div>
            <label className="block font-bold uppercase tracking-wider text-slate-700 mb-1.5">
              Password
            </label>
            <input 
              required 
              type="password" 
              value={password} 
              onChange={e => setPassword(e.target.value)} 
              className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:border-blue-600 focus:ring-1 focus:ring-blue-600 text-slate-900 text-sm font-semibold" 
              placeholder="Enter password or PIN"
            />
          </div>

          {/* 4. Authorized Device ID (Optional) */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="font-bold uppercase tracking-wider text-slate-700 text-[10.5px]">
                Authorized Device ID (Optional)
              </label>
              <button
                type="button"
                onClick={() => setInitialDeviceId(currentDeviceId)}
                className="text-[10px] text-blue-600 hover:text-blue-800 font-bold underline cursor-pointer"
              >
                Use My Current Device
              </button>
            </div>
            <div className="relative">
              <Smartphone size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input 
                type="text" 
                value={initialDeviceId} 
                onChange={e => setInitialDeviceId(e.target.value.trim().toUpperCase())} 
                className="w-full pl-8 pr-3 py-2 border border-slate-300 rounded-lg font-mono focus:border-blue-600 focus:ring-1 focus:ring-blue-600 text-slate-900 text-xs" 
                placeholder="e.g. DEV-A4C982EF (or authorize later)"
              />
            </div>
            <p className="text-[10.5px] text-slate-400 mt-1">
              If left blank, user can send their Device ID to WhatsApp {ADMIN_WHATSAPP_NUMBER} when logging in.
            </p>
          </div>
          
          {/* 5. Tick mark (Admin or not) */}
          <div className="flex items-center gap-2.5 pt-2 pb-1 bg-slate-50 p-3 rounded-lg border border-slate-200">
            <input 
              type="checkbox" 
              id="isAdmin" 
              checked={isAdmin} 
              onChange={e => setIsAdmin(e.target.checked)} 
              className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500 cursor-pointer" 
            />
            <label htmlFor="isAdmin" className="font-bold text-slate-800 cursor-pointer select-none text-xs flex items-center gap-1.5">
              <span>Admin</span>
              <span className="text-[11px] font-normal text-slate-500">({isAdmin ? 'Full administrative access' : 'Access: Dashboard, Party Ledger, Input, Day Log & Invoice Sheet only'})</span>
            </label>
          </div>

          <div className="pt-4 flex justify-end gap-2 border-t border-slate-100">
            <button 
              type="button" 
              onClick={onClose} 
              disabled={isSubmitting}
              className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-lg font-semibold cursor-pointer"
            >
              Cancel
            </button>
            <button 
              type="submit" 
              disabled={isSubmitting}
              className="px-5 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-bold rounded-lg shadow-xs cursor-pointer flex items-center gap-1.5"
            >
              <UserPlus size={14} />
              <span>{isSubmitting ? 'Adding...' : 'Add User'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

interface ManageDeviceModalProps {
  user: User;
  onClose: () => void;
  currentAdminDeviceId: string;
}

function ManageDeviceModal({ user, onClose, currentAdminDeviceId }: ManageDeviceModalProps) {
  const { currentUser } = useAuth();
  const [newDeviceId, setNewDeviceId] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const authorizedList: string[] = Array.from(new Set([
    ...(user.authorizedDeviceIds || []),
    ...(user.authorizedDeviceId ? [user.authorizedDeviceId] : [])
  ])).filter(Boolean);

  const handleCopy = (id: string) => {
    navigator.clipboard.writeText(id);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const handleAuthorize = async (idToAuth: string) => {
    const cleanId = idToAuth.trim().toUpperCase();
    if (!cleanId) return;
    setIsSaving(true);
    setError('');
    setSuccess('');

    try {
      const nextList = Array.from(new Set([...authorizedList, cleanId]));
      await updateDoc(doc(db, 'users', user.id), {
        authorizedDeviceId: cleanId,
        authorizedDeviceIds: nextList,
        pendingDeviceId: user.pendingDeviceId === cleanId ? '' : (user.pendingDeviceId || '')
      });
      logUserActivity('Device Authorized', `Authorized device ${cleanId} for operator ${user.name}`, currentUser);
      setSuccess(`Device ${cleanId} authorized successfully!`);
      setNewDeviceId('');
    } catch (err: any) {
      setError(err?.message || 'Failed to authorize device');
    } finally {
      setIsSaving(false);
    }
  };

  const handleRevoke = async (idToRevoke: string) => {
    setIsSaving(true);
    setError('');
    setSuccess('');

    try {
      const nextList = authorizedList.filter(id => id !== idToRevoke);
      const nextPrimary = nextList[0] || '';
      await updateDoc(doc(db, 'users', user.id), {
        authorizedDeviceId: nextPrimary,
        authorizedDeviceIds: nextList
      });
      logUserActivity('Device Revoked', `Revoked device ${idToRevoke} for operator ${user.name}`, currentUser);
      setSuccess(`Device ${idToRevoke} revoked.`);
    } catch (err: any) {
      setError(err?.message || 'Failed to revoke device');
    } finally {
      setIsSaving(false);
    }
  };

  const handleClearAll = async () => {
    if (!window.confirm(`Revoke all authorized devices for ${user.name}? This operator will not be able to log in until authorized.`)) return;
    setIsSaving(true);
    setError('');
    setSuccess('');
    try {
      await updateDoc(doc(db, 'users', user.id), {
        authorizedDeviceId: '',
        authorizedDeviceIds: [],
        deviceId: '',
        pendingDeviceId: ''
      });
      logUserActivity('All Devices Revoked', `Revoked all authorized devices for operator ${user.name}`, currentUser);
      setSuccess('All device authorizations cleared.');
    } catch (err: any) {
      setError(err?.message || 'Failed to clear devices');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-900/60 backdrop-blur-xs">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg border border-slate-200 overflow-hidden flex flex-col max-h-[90vh]">
        <div className="px-5 py-4 border-b border-slate-100 flex justify-between items-center bg-slate-50">
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-emerald-100 text-emerald-800 rounded-lg">
              <Smartphone size={18} />
            </div>
            <div>
              <h3 className="font-bold text-slate-900 text-sm">Authorized Devices</h3>
              <p className="text-xs text-slate-500">
                Manage login security for <strong className="text-slate-800">{user.name}</strong> (@{user.username || user.name})
              </p>
            </div>
          </div>
          <button onClick={onClose} className="p-1 text-slate-400 hover:text-slate-600 rounded-lg cursor-pointer">
            <X size={18} />
          </button>
        </div>

        <div className="p-5 overflow-y-auto space-y-4 text-xs">
          {error && (
            <div className="p-2.5 bg-rose-50 border border-rose-200 text-rose-700 rounded-lg font-medium flex items-center gap-2">
              <AlertCircle size={14} />
              {error}
            </div>
          )}
          {success && (
            <div className="p-2.5 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-lg font-medium flex items-center gap-2">
              <CheckCircle2 size={14} />
              {success}
            </div>
          )}

          {/* Pending Request Alert if present */}
          {user.pendingDeviceId && !authorizedList.includes(user.pendingDeviceId) && (
            <div className="p-3.5 bg-amber-50 border border-amber-200 rounded-xl space-y-2">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <span className="font-bold text-amber-900 flex items-center gap-1.5 text-xs">
                    <AlertTriangle size={14} className="text-amber-600" />
                    Pending Device Authorization Request
                  </span>
                  <p className="text-[11px] text-amber-700 mt-0.5">
                    User attempted login from this device:
                  </p>
                </div>
                {user.pendingDeviceTime && (
                  <span className="text-[10px] text-amber-600 font-mono">
                    {formatRelativeTime(user.pendingDeviceTime)}
                  </span>
                )}
              </div>
              <div className="flex items-center justify-between gap-2 bg-white px-3 py-2 rounded-lg border border-amber-200">
                <code className="font-mono font-bold text-slate-900 text-xs">
                  {user.pendingDeviceId}
                </code>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => handleCopy(user.pendingDeviceId!)}
                    className="px-2 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded text-[11px] font-semibold cursor-pointer"
                  >
                    {copiedId === user.pendingDeviceId ? 'Copied' : 'Copy'}
                  </button>
                  <button
                    type="button"
                    disabled={isSaving}
                    onClick={() => handleAuthorize(user.pendingDeviceId!)}
                    className="px-3 py-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded text-[11px] font-bold cursor-pointer disabled:opacity-50"
                  >
                    ✓ Authorize Now
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Currently Authorized Devices List */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="font-bold uppercase tracking-wider text-slate-600 text-[11px]">
                Authorized Device List ({authorizedList.length})
              </span>
              {authorizedList.length > 0 && (
                <button
                  type="button"
                  onClick={handleClearAll}
                  disabled={isSaving}
                  className="text-[11px] text-rose-600 hover:text-rose-800 font-semibold cursor-pointer"
                >
                  Revoke All
                </button>
              )}
            </div>

            {authorizedList.length === 0 ? (
              <div className="p-4 text-center bg-slate-50 border border-dashed border-slate-200 rounded-xl text-slate-500">
                <p className="font-medium text-slate-700">No devices authorized yet.</p>
                <p className="text-[11px] text-slate-400 mt-0.5">
                  This operator is strictly blocked from logging in until an authorized Device ID is assigned.
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                {authorizedList.map(devId => {
                  const isCurrent = devId === currentAdminDeviceId;
                  return (
                    <div 
                      key={devId} 
                      className={`p-3 rounded-lg border flex items-center justify-between gap-2 ${
                        isCurrent ? 'bg-emerald-50/50 border-emerald-200' : 'bg-white border-slate-200'
                      }`}
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <Smartphone size={16} className={isCurrent ? 'text-emerald-600' : 'text-slate-400'} />
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5">
                            <code className="font-mono font-bold text-slate-900 text-xs">
                              {devId}
                            </code>
                            {isCurrent && (
                              <span className="px-1.5 py-0.2 bg-emerald-100 text-emerald-800 text-[10px] font-bold rounded">
                                This Device
                              </span>
                            )}
                          </div>
                          <span className="text-[10px] text-slate-400 block">
                            Status: Authorized for sign-in
                          </span>
                        </div>
                      </div>

                      <div className="flex items-center gap-1.5 shrink-0">
                        <button
                          type="button"
                          onClick={() => handleCopy(devId)}
                          className="p-1.5 text-slate-500 hover:text-slate-800 hover:bg-slate-100 rounded cursor-pointer"
                          title="Copy Device ID"
                        >
                          {copiedId === devId ? <Check size={13} className="text-emerald-600" /> : <Copy size={13} />}
                        </button>
                        <button
                          type="button"
                          disabled={isSaving}
                          onClick={() => handleRevoke(devId)}
                          className="p-1.5 text-rose-500 hover:text-rose-700 hover:bg-rose-50 rounded cursor-pointer disabled:opacity-50"
                          title="Revoke device"
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Quick Add Section */}
          <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-xl space-y-3">
            <span className="font-bold uppercase tracking-wider text-slate-600 text-[11px] block">
              Assign Device ID
            </span>

            {/* Quick Authorize Current Device */}
            <button
              type="button"
              disabled={isSaving || authorizedList.includes(currentAdminDeviceId)}
              onClick={() => handleAuthorize(currentAdminDeviceId)}
              className="w-full py-2 px-3 bg-white hover:bg-slate-100 border border-slate-200 rounded-lg text-slate-800 font-semibold text-xs flex items-center justify-between cursor-pointer disabled:opacity-50"
            >
              <span className="flex items-center gap-2">
                <Smartphone size={14} className="text-emerald-600" />
                Authorize Current Admin Device ({currentAdminDeviceId.substring(0, 12)}...)
              </span>
              <span className="text-[11px] font-bold text-emerald-700">
                {authorizedList.includes(currentAdminDeviceId) ? 'Already Authorized' : '+ Authorize'}
              </span>
            </button>

            {/* Manual Device ID Input */}
            <div>
              <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                Enter Device ID from WhatsApp / Operator
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={newDeviceId}
                  onChange={e => setNewDeviceId(e.target.value.trim().toUpperCase())}
                  placeholder="e.g. DEV-A4C982EF"
                  className="flex-1 px-3 py-1.5 bg-white border border-slate-200 rounded-lg font-mono text-xs text-slate-800 focus:outline-none focus:border-emerald-600"
                />
                <button
                  type="button"
                  disabled={isSaving || !newDeviceId.trim()}
                  onClick={() => handleAuthorize(newDeviceId)}
                  className="px-4 py-1.5 bg-emerald-700 hover:bg-emerald-800 disabled:opacity-50 text-white font-bold rounded-lg cursor-pointer transition text-xs"
                >
                  Authorize
                </button>
              </div>
            </div>

            <p className="text-[10px] text-slate-400">
              Helpline: Operators without access should message WhatsApp <strong className="text-slate-600">{ADMIN_WHATSAPP_NUMBER}</strong> with their Device ID.
            </p>
          </div>
        </div>

        <div className="px-5 py-3 border-t border-slate-100 bg-slate-50 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 bg-slate-900 hover:bg-slate-800 text-white rounded-lg text-xs font-bold transition cursor-pointer"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}

interface UserActivityModalProps {
  user: User;
  onClose: () => void;
}

function UserActivityModal({ user, onClose }: UserActivityModalProps) {
  const [activities, setActivities] = useState<UserActivity[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      const acts = await fetchUserActivities(user.id, 40);
      setActivities(acts);
      setLoading(false);
    };
    load();
  }, [user.id]);

  const presence = getUserPresence(user);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-900/60 backdrop-blur-xs">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl border border-slate-200 overflow-hidden flex flex-col max-h-[85vh]">
        {/* Modal Header */}
        <div className="px-5 py-4 border-b border-slate-100 flex justify-between items-center bg-slate-50">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-slate-900 text-white flex items-center justify-center font-bold text-sm">
              {(user.name || 'U').charAt(0).toUpperCase()}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-bold text-slate-900 text-sm sm:text-base">{user.name}</h3>
                <span className={`w-2 h-2 rounded-full ${presence.dotClass}`} />
                <span className="text-[11px] font-semibold text-slate-500">{presence.label}</span>
              </div>
              <p className="text-xs text-slate-500 font-mono">
                {user.isAdmin ? 'Executive Administrator' : 'Standard Operator'} • Last active: {user.lastActivity ? format(new Date(user.lastActivity), 'dd MMM yyyy, HH:mm') : 'Never'}
              </p>
            </div>
          </div>
          <button onClick={onClose} className="p-1 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-200/60 cursor-pointer">
            <X size={18} />
          </button>
        </div>

        {/* Modal Content */}
        <div className="p-5 overflow-y-auto flex-1 space-y-4">
          {/* Quick Summary Strip */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-xs bg-slate-50 p-3 rounded-lg border border-slate-200">
            <div>
              <span className="text-slate-400 block text-[10px] uppercase font-bold">Latest Action</span>
              <span className="font-semibold text-slate-800 truncate block mt-0.5">{user.lastAction || 'Login'}</span>
            </div>
            <div>
              <span className="text-slate-400 block text-[10px] uppercase font-bold">Session State</span>
              <span className="font-semibold text-slate-800 font-mono text-[11px] block mt-0.5">
                {user.deviceId ? `Active Device` : 'Signed Out'}
              </span>
            </div>
            <div className="col-span-2 sm:col-span-1">
              <span className="text-slate-400 block text-[10px] uppercase font-bold">Relative Time</span>
              <span className="font-semibold text-slate-800 block mt-0.5">{formatRelativeTime(user.lastActivity)}</span>
            </div>
          </div>

          {/* Activity Timeline */}
          <div>
            <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wider mb-3 flex items-center gap-1.5">
              <History size={14} className="text-blue-600" />
              Activity Audit Trail (Newest First)
            </h4>

            {loading ? (
              <div className="py-8 flex items-center justify-center gap-2 text-xs text-slate-500 font-medium">
                <RefreshCw size={15} className="animate-spin text-blue-600" />
                Loading activity history...
              </div>
            ) : activities.length === 0 ? (
              <div className="py-8 text-center bg-slate-50 rounded-lg border border-dashed border-slate-200 text-xs text-slate-400">
                No detailed historical activity recorded for this user yet.
              </div>
            ) : (
              <div className="space-y-2.5">
                {activities.map((act) => (
                  <div key={act.id} className="p-3 bg-white rounded-lg border border-slate-200 hover:border-blue-300 transition-colors">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <span className="text-xs font-bold text-slate-900 block">{act.action}</span>
                        {act.details && (
                          <p className="text-xs text-slate-600 mt-0.5">{act.details}</p>
                        )}
                        {act.ledgerName && (
                          <span className="inline-block mt-1 text-[10px] font-semibold text-slate-500 bg-slate-100 px-1.5 py-0.2 rounded">
                            {act.ledgerName}
                          </span>
                        )}
                      </div>
                      <div className="text-right shrink-0">
                        <span className="text-[11px] font-mono font-medium text-slate-600 block">
                          {format(new Date(act.timestamp), 'dd MMM, HH:mm')}
                        </span>
                        <span className="text-[10px] text-slate-400 block mt-0.5">
                          {formatRelativeTime(act.timestamp)}
                        </span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Modal Footer */}
        <div className="px-5 py-3 border-t border-slate-100 bg-slate-50 flex justify-end">
          <button 
            type="button" 
            onClick={onClose}
            className="px-4 py-1.5 bg-slate-900 hover:bg-slate-800 text-white rounded-lg text-xs font-bold transition-colors cursor-pointer"
          >
            Close Inspector
          </button>
        </div>
      </div>
    </div>
  );
}

export default function Users() {
  const { users, currentUser, currentDeviceId } = useAuth();
  const [showAdd, setShowAdd] = useState(false);
  const [selectedUserForActivity, setSelectedUserForActivity] = useState<User | null>(null);
  const [selectedUserForDevice, setSelectedUserForDevice] = useState<User | null>(null);
  const [copiedCurrentDev, setCopiedCurrentDev] = useState(false);
  const [isRecreating, setIsRecreating] = useState(false);
  const [dbStatusMsg, setDbStatusMsg] = useState('');
  const [dbStatusType, setDbStatusType] = useState<'success' | 'error'>('success');
  const [tableStats, setTableStats] = useState<{ tableName: string; count: number; exists: boolean }[]>([]);
  const [loadingStats, setLoadingStats] = useState(true);

  // Direct Inline Device ID Input in Database User Section
  const [deviceInputMap, setDeviceInputMap] = useState<Record<string, string>>({});
  const [savingDevUserId, setSavingDevUserId] = useState<string | null>(null);
  const [savedFeedbackUserId, setSavedFeedbackUserId] = useState<string | null>(null);

  const handleSaveInlineDevice = async (userId: string, overrideVal?: string) => {
    const targetUser = users.find(u => u.id === userId);
    if (!targetUser) return;
    const rawVal = overrideVal !== undefined 
      ? overrideVal 
      : (deviceInputMap[userId] !== undefined ? deviceInputMap[userId] : (targetUser.authorizedDeviceId || ''));
    const cleanVal = rawVal.trim().toUpperCase();

    setSavingDevUserId(userId);
    try {
      await updateDoc(doc(db, 'users', userId), {
        authorizedDeviceId: cleanVal,
        authorizedDeviceIds: cleanVal ? [cleanVal] : [],
        pendingDeviceId: ''
      });
      logUserActivity('Database Device Authorized', `Saved authorized device ${cleanVal || '(cleared)'} for ${targetUser.name}`, currentUser);
      setSavedFeedbackUserId(userId);
      setDeviceInputMap(prev => ({ ...prev, [userId]: cleanVal }));
      setTimeout(() => setSavedFeedbackUserId(null), 2500);
    } catch (err) {
      console.error('Error saving device to database:', err);
    } finally {
      setSavingDevUserId(null);
    }
  };

  const handleClearInlineDevice = async (userId: string) => {
    const targetUser = users.find(u => u.id === userId);
    if (!targetUser) return;
    setSavingDevUserId(userId);
    try {
      await updateDoc(doc(db, 'users', userId), {
        authorizedDeviceId: '',
        authorizedDeviceIds: [],
        pendingDeviceId: '',
        deviceId: ''
      });
      setDeviceInputMap(prev => ({ ...prev, [userId]: '' }));
      logUserActivity('Device Revoked', `Cleared authorized device for ${targetUser.name}`, currentUser);
      setSavedFeedbackUserId(userId);
      setTimeout(() => setSavedFeedbackUserId(null), 2500);
    } catch (err) {
      console.error('Error clearing device:', err);
    } finally {
      setSavingDevUserId(null);
    }
  };

  // Global Activity Stream State
  const [allActivities, setAllActivities] = useState<UserActivity[]>([]);
  const [loadingActivities, setLoadingActivities] = useState(true);
  const [activitySearch, setActivitySearch] = useState('');

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

  const loadAllActivities = async () => {
    setLoadingActivities(true);
    try {
      const acts = await fetchUserActivities(undefined, 30);
      setAllActivities(acts);
    } catch (err) {
      console.error("Error fetching all activities:", err);
    } finally {
      setLoadingActivities(false);
    }
  };

  useEffect(() => {
    if (currentUser?.isAdmin) {
      fetchStats();
      loadAllActivities();
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

  const [updatingUserId, setUpdatingUserId] = useState<string | null>(null);

  const handleToggleUserRole = async (targetUser: User) => {
    if (targetUser.id === currentUser?.id) {
      return;
    }
    const nextIsAdmin = !targetUser.isAdmin;
    const nextRoleName = nextIsAdmin ? 'Executive Admin' : 'Standard User';
    const targetName = targetUser.name || targetUser.username || 'this user';
    
    setUpdatingUserId(targetUser.id);
    try {
      await updateDoc(doc(db, 'users', targetUser.id), {
        isAdmin: nextIsAdmin,
        role: nextIsAdmin ? 'admin' : 'user'
      });
      await logUserActivity(
        'Updated User Role',
        `Changed role for ${targetName} to ${nextRoleName}`,
        currentUser
      );
    } catch (err: any) {
      console.error('Failed to update role:', err);
    } finally {
      setUpdatingUserId(null);
    }
  };

  if (!currentUser?.isAdmin) {
    return <div className="p-8 text-center text-rose-600 font-semibold">Access Denied. Executive Admin role required.</div>;
  }

  const adminUsersCount = users.filter(u => u.isAdmin).length;
  const standardUsersCount = users.length - adminUsersCount;

  const filteredActivities = allActivities.filter(a => {
    if (!activitySearch.trim()) return true;
    const q = activitySearch.toLowerCase();
    return (
      a.userName?.toLowerCase().includes(q) ||
      a.action?.toLowerCase().includes(q) ||
      a.details?.toLowerCase().includes(q) ||
      a.ledgerName?.toLowerCase().includes(q)
    );
  });

  return (
    <div className="p-4 sm:p-8 max-w-6xl mx-auto w-full pb-24 sm:pb-8 space-y-6">
      {showAdd && <AddUserModal onClose={() => setShowAdd(false)} />}
      {selectedUserForActivity && (
        <UserActivityModal 
          user={selectedUserForActivity} 
          onClose={() => setSelectedUserForActivity(null)} 
        />
      )}
      {selectedUserForDevice && (
        <ManageDeviceModal
          user={selectedUserForDevice}
          currentAdminDeviceId={currentDeviceId}
          onClose={() => setSelectedUserForDevice(null)}
        />
      )}

      {/* Header */}
      <PageHeader
        title="User Access & Security Control"
        subtitle="Manage operators, device authorization, administrative roles, and live activity monitoring"
        actions={
          <div className="flex items-center gap-2">
            <div className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 bg-slate-100 border border-slate-200 rounded-lg font-mono text-xs text-slate-700">
              <Smartphone size={13} className="text-slate-500" />
              <span>This Device: <strong className="text-slate-900">{currentDeviceId.substring(0, 12)}</strong></span>
              <button
                type="button"
                onClick={() => {
                  navigator.clipboard.writeText(currentDeviceId);
                  setCopiedCurrentDev(true);
                  setTimeout(() => setCopiedCurrentDev(false), 2000);
                }}
                className="ml-1 text-slate-400 hover:text-slate-700 cursor-pointer"
                title="Copy This Device ID"
              >
                {copiedCurrentDev ? <Check size={12} className="text-emerald-600" /> : <Copy size={12} />}
              </button>
            </div>
            <button 
              onClick={() => setShowAdd(true)} 
              className="inline-flex items-center justify-center px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-bold shadow-xs transition-colors cursor-pointer"
            >
              <UserPlus size={15} className="mr-1.5" />
              Add User Account
            </button>
          </div>
        }
      />

      {/* Pending Device Authorization Alert Banner */}
      {(() => {
        const pendingUsers = users.filter(u => u.pendingDeviceId && !isDeviceAuthorized(u, u.pendingDeviceId));
        if (pendingUsers.length === 0) return null;

        return (
          <div className="p-4 bg-amber-50 border-2 border-amber-300 rounded-xl space-y-3 shadow-xs">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-amber-900 font-bold text-sm">
                <AlertTriangle size={18} className="text-amber-600 shrink-0" />
                <span>Action Required: {pendingUsers.length} Device Authorization Request{pendingUsers.length > 1 ? 's' : ''} Pending</span>
              </div>
              <div className="flex items-center gap-1.5 text-xs text-amber-800">
                <MessageSquare size={13} className="text-emerald-700" />
                <span>WhatsApp Helpline: <strong>{ADMIN_WHATSAPP_NUMBER}</strong></span>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
              {pendingUsers.map(u => (
                <div key={u.id} className="p-3 bg-white rounded-lg border border-amber-200 flex items-center justify-between gap-3 shadow-xs">
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="font-bold text-slate-900 text-xs truncate">{u.name}</span>
                      <span className="text-[10.5px] text-slate-400 font-mono">(@{u.username || u.name})</span>
                    </div>
                    <div className="flex items-center gap-1.5 mt-1">
                      <span className="text-[10px] text-slate-500 font-semibold">Requested Device ID:</span>
                      <code className="font-mono text-xs font-bold text-amber-950 bg-amber-100/70 px-1.5 py-0.2 rounded border border-amber-200">
                        {u.pendingDeviceId}
                      </code>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      type="button"
                      onClick={async () => {
                        const devId = u.pendingDeviceId!;
                        const currentList = Array.from(new Set([...(u.authorizedDeviceIds || []), ...(u.authorizedDeviceId ? [u.authorizedDeviceId] : []), devId])).filter(Boolean);
                        await updateDoc(doc(db, 'users', u.id), {
                          authorizedDeviceId: devId,
                          authorizedDeviceIds: currentList,
                          pendingDeviceId: ''
                        });
                        logUserActivity('Device Authorized', `1-click authorized device ${devId} for ${u.name}`, currentUser);
                      }}
                      className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-bold transition cursor-pointer shadow-xs"
                      title="Authorize this device now"
                    >
                      ✓ Authorize
                    </button>
                    <button
                      type="button"
                      onClick={async () => {
                        await updateDoc(doc(db, 'users', u.id), { pendingDeviceId: '' });
                      }}
                      className="px-2.5 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-lg text-xs font-semibold transition cursor-pointer"
                      title="Dismiss request"
                    >
                      ✕
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

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

      {/* User Accounts & Activity Directory */}
      <Card>
        <div className="p-4 border-b border-slate-100 bg-slate-50/60 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div>
            <h3 className="font-bold text-slate-900 text-xs sm:text-sm flex items-center gap-1.5">
              <Activity size={15} className="text-blue-600" />
              Active System Operator Directory & Activity Monitor
            </h3>
            <p className="text-[11px] text-slate-500 mt-0.5">
              Real-time user session status, latest operations, and login activity
            </p>
          </div>
          <span className="text-xs text-slate-500 font-mono self-start sm:self-auto">
            {users.length} Operator{users.length !== 1 ? 's' : ''} Provisioned
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse table-finance">
            <thead>
              <tr>
                <th>Username / Operator</th>
                <th className="w-36">System Role</th>
                <th className="w-80">Authorized Device (Paste Device ID)</th>
                <th className="w-28">Live Status</th>
                <th>Last Performed Action</th>
                <th className="w-40 text-right">Last System Activity</th>
                <th className="w-28 text-center">Audit</th>
              </tr>
            </thead>
            <tbody>
              {users.map(u => {
                const presence = getUserPresence(u);
                const hasPending = u.pendingDeviceId && !isDeviceAuthorized(u, u.pendingDeviceId);
                const isCurrentDev = u.authorizedDeviceId === currentDeviceId || (u.authorizedDeviceIds && u.authorizedDeviceIds.includes(currentDeviceId));

                return (
                  <tr key={u.id} className="hover:bg-blue-50/40 transition-colors">
                    {/* Operator Name */}
                    <td>
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-lg bg-slate-900 text-white flex items-center justify-center text-xs font-bold shrink-0">
                          {(u.name || 'U').charAt(0).toUpperCase()}
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-slate-900 text-xs sm:text-sm block">
                              {u.name || 'Unnamed Operator'}
                            </span>
                            {u.id === currentUser.id && (
                              <Badge variant="navy" size="xs">Current Session</Badge>
                            )}
                          </div>
                          {u.username && (
                            <span className="text-[11px] text-slate-400 font-mono block">
                              @{u.username}
                            </span>
                          )}
                        </div>
                      </div>
                    </td>

                    {/* Role */}
                    <td>
                      <div className="flex flex-col sm:flex-row sm:items-center gap-1.5">
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
                        {u.id !== currentUser.id ? (
                          <button
                            type="button"
                            disabled={updatingUserId === u.id}
                            onClick={() => handleToggleUserRole(u)}
                            title={`Switch ${u.name || 'user'} to ${u.isAdmin ? 'Standard User' : 'Executive Admin'}`}
                            className="inline-flex items-center text-[10.5px] font-bold text-blue-600 hover:text-blue-800 bg-blue-50 hover:bg-blue-100 border border-blue-200 px-2 py-0.5 rounded transition-colors cursor-pointer disabled:opacity-50"
                          >
                            {updatingUserId === u.id ? 'Updating...' : u.isAdmin ? 'Make User' : 'Make Admin'}
                          </button>
                        ) : (
                          <span className="text-[10px] text-slate-400 italic">(You)</span>
                        )}
                      </div>
                    </td>

                    {/* Authorized Device (Direct Input Line) */}
                    <td>
                      <div className="flex flex-col gap-1.5 py-1 min-w-[280px]">
                        <div className="flex items-center gap-1.5">
                          <div className="relative flex-1">
                            <Smartphone size={13} className={`absolute left-2.5 top-1/2 -translate-y-1/2 ${isCurrentDev ? "text-emerald-600" : "text-slate-400"}`} />
                            <input
                              type="text"
                              placeholder="Paste Device ID here..."
                              value={deviceInputMap[u.id] !== undefined ? deviceInputMap[u.id] : (u.authorizedDeviceId || '')}
                              onChange={(e) => setDeviceInputMap(prev => ({ ...prev, [u.id]: e.target.value.trim().toUpperCase() }))}
                              className={`w-full pl-7 pr-2 py-1.5 text-xs font-mono font-bold rounded-lg border transition-all ${
                                isCurrentDev 
                                  ? 'bg-emerald-50/70 border-emerald-300 text-emerald-950 focus:border-emerald-600' 
                                  : 'bg-white border-slate-300 text-slate-900 focus:border-blue-600'
                              }`}
                            />
                          </div>

                          <button
                            type="button"
                            disabled={savingDevUserId === u.id}
                            onClick={() => handleSaveInlineDevice(u.id)}
                            className="px-3 py-1.5 bg-emerald-700 hover:bg-emerald-800 active:bg-emerald-900 disabled:opacity-50 text-white rounded-lg text-xs font-bold transition cursor-pointer shrink-0 shadow-2xs"
                            title="Save this Device ID in the database"
                          >
                            {savingDevUserId === u.id ? 'Saving...' : 'Save'}
                          </button>

                          {(u.authorizedDeviceId || deviceInputMap[u.id]) && (
                            <button
                              type="button"
                              disabled={savingDevUserId === u.id}
                              onClick={() => handleClearInlineDevice(u.id)}
                              className="p-1.5 bg-slate-100 hover:bg-rose-50 text-slate-400 hover:text-rose-600 rounded-lg transition cursor-pointer shrink-0"
                              title="Clear / Revoke Device"
                            >
                              <Trash2 size={13} />
                            </button>
                          )}
                        </div>

                        {/* Helper badges and quick paste actions */}
                        <div className="flex flex-wrap items-center gap-2 text-[10.5px]">
                          {savedFeedbackUserId === u.id && (
                            <span className="text-emerald-700 font-bold flex items-center gap-0.5">
                              <Check size={11} /> Saved in Database!
                            </span>
                          )}

                          {isCurrentDev && (
                            <span className="text-emerald-800 font-bold bg-emerald-100/70 px-1.5 py-0.2 rounded text-[10px]">
                              ● This Device
                            </span>
                          )}

                          {hasPending && (
                            <button
                              type="button"
                              onClick={() => {
                                setDeviceInputMap(prev => ({ ...prev, [u.id]: u.pendingDeviceId! }));
                                handleSaveInlineDevice(u.id, u.pendingDeviceId!);
                              }}
                              className="text-amber-900 bg-amber-50 hover:bg-amber-100 border border-amber-300 px-1.5 py-0.5 rounded font-bold cursor-pointer transition flex items-center gap-1"
                              title="Click to paste requested Device ID and authorize immediately"
                            >
                              <AlertTriangle size={11} className="text-amber-600" />
                              Paste Request: {u.pendingDeviceId}
                            </button>
                          )}

                          <button
                            type="button"
                            onClick={() => setDeviceInputMap(prev => ({ ...prev, [u.id]: currentDeviceId }))}
                            className="text-slate-500 hover:text-blue-700 underline cursor-pointer text-[10px]"
                            title="Paste your current machine's Device ID into this field"
                          >
                            Paste My Device ({currentDeviceId.substring(0, 8)}...)
                          </button>
                        </div>
                      </div>
                    </td>

                    {/* Live Presence */}
                    <td>
                      <div className="flex items-center gap-1.5">
                        <span className={`w-2 h-2 rounded-full ${presence.dotClass}`} />
                        <span className="text-xs font-semibold text-slate-700">
                          {presence.label}
                        </span>
                      </div>
                    </td>

                    {/* Last Action */}
                    <td>
                      <div className="min-w-0 max-w-xs">
                        <span className="text-xs font-semibold text-slate-800 block truncate">
                          {u.lastAction || 'System Login'}
                        </span>
                        {u.lastActionDetails && (
                          <span className="text-[10.5px] text-slate-400 block truncate mt-0.5">
                            {u.lastActionDetails}
                          </span>
                        )}
                      </div>
                    </td>

                    {/* Last Activity Time */}
                    <td className="text-right">
                      <span className="font-mono text-xs text-slate-700 font-semibold block">
                        {u.lastActivity ? format(new Date(u.lastActivity), 'dd MMM yyyy, HH:mm') : 'Never logged'}
                      </span>
                      <span className="text-[10px] text-slate-400 block mt-0.5">
                        {formatRelativeTime(u.lastActivity)}
                      </span>
                    </td>

                    {/* Security Actions (Manage Device & Audit Logs) */}
                    <td className="text-center">
                      <div className="flex items-center justify-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => setSelectedUserForDevice(u)}
                          className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-semibold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 rounded-md transition-colors cursor-pointer border border-emerald-200/60"
                          title="Manage Authorized Devices"
                        >
                          <Smartphone size={12} />
                          <span>Device</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => setSelectedUserForActivity(u)}
                          className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-semibold text-blue-600 bg-blue-50 hover:bg-blue-100 rounded-md transition-colors cursor-pointer"
                          title="View user activity history"
                        >
                          <Eye size={12} />
                          <span>Logs</span>
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Global Real-Time User Activity Audit Stream */}
      <Card>
        <div className="p-4 border-b border-slate-100 bg-slate-50/60 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h3 className="font-bold text-slate-900 text-xs sm:text-sm flex items-center gap-1.5">
              <History size={15} className="text-blue-600" />
              Live User Activity Audit Trail
            </h3>
            <p className="text-[11px] text-slate-500 mt-0.5">
              Chronological stream of user actions across all active companies and operators
            </p>
          </div>

          <div className="flex items-center gap-2">
            <div className="relative">
              <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                placeholder="Search activity or user..."
                value={activitySearch}
                onChange={e => setActivitySearch(e.target.value)}
                className="pl-7 pr-2.5 py-1 text-xs bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-blue-500 w-44 sm:w-56"
              />
            </div>
            <button
              onClick={loadAllActivities}
              className="p-1.5 text-slate-500 hover:text-blue-600 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors cursor-pointer"
              title="Refresh Activity Log"
            >
              <RefreshCw size={13} className={loadingActivities ? "animate-spin text-blue-600" : ""} />
            </button>
          </div>
        </div>

        <div className="p-4">
          {loadingActivities ? (
            <div className="py-8 flex items-center justify-center gap-2 text-xs text-slate-500 font-medium">
              <RefreshCw size={14} className="animate-spin text-blue-600" />
              Loading real-time user activities...
            </div>
          ) : filteredActivities.length === 0 ? (
            <div className="py-8 text-center text-xs text-slate-400 font-medium">
              No recent activity records match your query.
            </div>
          ) : (
            <div className="divide-y divide-slate-100">
              {filteredActivities.slice(0, 15).map((act) => (
                <div key={act.id} className="py-2.5 first:pt-0 last:pb-0 flex items-center justify-between gap-3 text-xs">
                  <div className="min-w-0 flex items-center gap-2.5">
                    <div className="w-7 h-7 rounded-md bg-blue-50 text-blue-700 font-bold flex items-center justify-center text-[11px] shrink-0">
                      {(act.userName || 'U').charAt(0).toUpperCase()}
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="font-bold text-slate-900">{act.userName}</span>
                        <span className="text-[11px] font-semibold text-blue-600 bg-blue-50 px-1.5 py-0.2 rounded">
                          {act.action}
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-500 truncate mt-0.5">
                        {act.details} {act.ledgerName ? `• In ${act.ledgerName}` : ''}
                      </p>
                    </div>
                  </div>

                  <div className="text-right shrink-0 font-mono">
                    <span className="text-[11px] text-slate-700 font-semibold block">
                      {format(new Date(act.timestamp), 'dd MMM, HH:mm')}
                    </span>
                    <span className="text-[10px] text-slate-400 block">
                      {formatRelativeTime(act.timestamp)}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
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
            className="p-1.5 text-slate-400 hover:text-blue-600 rounded hover:bg-blue-50 transition-colors cursor-pointer"
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
              className="px-4 py-2 bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white rounded-lg text-xs font-bold shadow-xs transition-colors flex items-center cursor-pointer"
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
