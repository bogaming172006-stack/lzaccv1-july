import React, { useState, useEffect } from 'react';
import { useAuth } from '../AuthContext';
import { User, UserActivity } from '../types';
import { db, handleFirestoreError, OperationType, doc, setDoc, recreateDatabaseTables, getDatabaseTableStats } from '../firebase';
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
  Eye
} from 'lucide-react';
import { v4 as uuidv4 } from 'uuid';
import DatabaseBackupRestore from '../components/DatabaseBackupRestore';
import PageHeader from '../components/ui/PageHeader';
import StatCard from '../components/ui/StatCard';
import Badge from '../components/ui/Badge';
import { Card } from '../components/ui/Card';
import { fetchUserActivities, logUserActivity } from '../lib/activityLogger';

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
  const { currentUser } = useAuth();
  const [name, setName] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [isAdmin, setIsAdmin] = useState(false);
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    const cleanName = name.trim();
    const cleanUsername = username.trim();
    const cleanPassword = password.trim();

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
      deviceId: '',
      lastActivity: Date.now(),
      lastAction: 'Account Created',
      lastActionDetails: `Created by ${currentUser?.name || 'Administrator'}`
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
          
          {/* 4. Tick mark (Admin or not) */}
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
              <span className="text-[11px] font-normal text-slate-500">({isAdmin ? 'Full administrative access' : 'Standard operator access'})</span>
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
  const { users, currentUser } = useAuth();
  const [showAdd, setShowAdd] = useState(false);
  const [selectedUserForActivity, setSelectedUserForActivity] = useState<User | null>(null);
  const [isRecreating, setIsRecreating] = useState(false);
  const [dbStatusMsg, setDbStatusMsg] = useState('');
  const [dbStatusType, setDbStatusType] = useState<'success' | 'error'>('success');
  const [tableStats, setTableStats] = useState<{ tableName: string; count: number; exists: boolean }[]>([]);
  const [loadingStats, setLoadingStats] = useState(true);

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

      {/* Header */}
      <PageHeader
        title="User Access & Security Control"
        subtitle="Manage operators, administrative roles, live activity monitoring, and database health"
        actions={
          <button 
            onClick={() => setShowAdd(true)} 
            className="inline-flex items-center justify-center px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-bold shadow-xs transition-colors cursor-pointer"
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
                <th className="w-32">Live Status</th>
                <th>Last Performed Action</th>
                <th className="w-48 text-right">Last System Activity</th>
                <th className="w-28 text-center">Audit</th>
              </tr>
            </thead>
            <tbody>
              {users.map(u => {
                const presence = getUserPresence(u);
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

                    {/* Audit Timeline Action */}
                    <td className="text-center">
                      <button
                        type="button"
                        onClick={() => setSelectedUserForActivity(u)}
                        className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-semibold text-blue-600 bg-blue-50 hover:bg-blue-100 rounded-md transition-colors cursor-pointer"
                        title="View user activity history"
                      >
                        <Eye size={12} />
                        <span>Logs</span>
                      </button>
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
