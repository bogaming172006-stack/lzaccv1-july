import React, { useState, useEffect } from 'react';
import { useAuth } from '../AuthContext';
import { LogIn, UserPlus, Database, Lock, User as UserIcon, ShieldAlert, Smartphone, Copy, Check, MessageSquare, ArrowLeft, RefreshCw, Shield, Key } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import CompanyLogo from '../components/CompanyLogo';
import { db, doc, setDoc, updateDoc, handleFirestoreError, OperationType } from '../firebase';
import { v4 as uuidv4 } from 'uuid';
import { User } from '../types';
import { getDeviceId, isDeviceAuthorized, ADMIN_WHATSAPP_NUMBER } from '../lib/deviceId';
import { logUserActivity } from '../lib/activityLogger';

export default function Login() {
  const { users, login, currentUser, isLoading, currentDeviceId } = useAuth();
  const navigate = useNavigate();
  const [username, setUsername] = useState('');
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');

  const [createName, setCreateName] = useState('');
  const [createPin, setCreatePin] = useState('');
  const [isCreating, setIsCreating] = useState(false);

  // Unauthorized device state
  const [unauthorizedData, setUnauthorizedData] = useState<{
    deviceId: string;
    whatsappUrl: string;
    user?: User;
    username: string;
    pin: string;
  } | null>(null);

  const [copied, setCopied] = useState(false);
  const [adminAuthPin, setAdminAuthPin] = useState('');
  const [isAuthorizingAdmin, setIsAuthorizingAdmin] = useState(false);
  const [adminAuthError, setAdminAuthError] = useState('');
  const [showAdminPinAuth, setShowAdminPinAuth] = useState(false);

  useEffect(() => {
    if (currentUser) {
      navigate('/', { replace: true });
    }
  }, [currentUser, navigate]);

  // Live listener: If user was blocked for unauthorized device, and Admin authorizes it live in Users panel, auto-login!
  useEffect(() => {
    if (!unauthorizedData) return;
    const devId = unauthorizedData.deviceId || currentDeviceId;
    const targetUser = users.find(u => 
      u.id === unauthorizedData.user?.id ||
      (u.username && u.username.toLowerCase() === unauthorizedData.username.toLowerCase()) ||
      (u.name && u.name.toLowerCase() === unauthorizedData.username.toLowerCase())
    );

    if (targetUser && isDeviceAuthorized(targetUser, devId)) {
      // Device is now authorized! Automatically login
      const result = login(unauthorizedData.username, unauthorizedData.pin);
      if (result.success) {
        setUnauthorizedData(null);
      }
    }
  }, [users, unauthorizedData, currentDeviceId, login]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (isLoading) return;
    setError('');
    
    if (!username.trim()) {
      setError('Please enter your username');
      return;
    }
    if (!pin.trim()) {
      setError('Please enter your password / PIN');
      return;
    }

    const result = login(username, pin);
    if (!result.success) {
      if (result.isUnauthorizedDevice && result.deviceId && result.whatsappUrl) {
        setUnauthorizedData({
          deviceId: result.deviceId,
          whatsappUrl: result.whatsappUrl,
          user: result.user,
          username: username.trim(),
          pin: pin.trim()
        });
        // Direct WhatsApp popup trigger
        try {
          window.open(result.whatsappUrl, '_blank', 'noopener,noreferrer');
        } catch {
          // Fallback handled by rendered button
        }
      } else {
        setError(result.error || 'Invalid username or password');
      }
    }
  };

  const handleCopyDeviceId = () => {
    const devId = unauthorizedData?.deviceId || currentDeviceId || getDeviceId();
    navigator.clipboard.writeText(devId);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  const handleAdminAuthorizeOnScreen = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!unauthorizedData || isAuthorizingAdmin) return;
    setIsAuthorizingAdmin(true);
    setAdminAuthError('');

    try {
      const entered = adminAuthPin.trim();
      if (!entered) {
        setAdminAuthError('Please enter your 4-digit Admin PIN');
        setIsAuthorizingAdmin(false);
        return;
      }

      // Check if entered PIN matches this user's PIN (if admin) OR any admin's PIN
      const matchingAdmin = users.find(u => u.isAdmin && String(u.pin).trim() === entered);

      if (!matchingAdmin && (!unauthorizedData.user?.isAdmin || String(unauthorizedData.user?.pin).trim() !== entered)) {
        setAdminAuthError('Invalid Admin PIN. Please check and try again.');
        setIsAuthorizingAdmin(false);
        return;
      }

      const targetUser = unauthorizedData.user || users.find(u => 
        (u.username && u.username.toLowerCase() === unauthorizedData.username.toLowerCase()) ||
        (u.name && u.name.toLowerCase() === unauthorizedData.username.toLowerCase())
      );

      if (!targetUser) {
        setAdminAuthError('User record not found.');
        setIsAuthorizingAdmin(false);
        return;
      }

      const devId = unauthorizedData.deviceId;
      const currentList = Array.from(new Set([
        ...(targetUser.authorizedDeviceIds || []),
        ...(targetUser.authorizedDeviceId ? [targetUser.authorizedDeviceId] : []),
        devId
      ])).filter(Boolean);

      await updateDoc(doc(db, 'users', targetUser.id), {
        authorizedDeviceId: devId,
        authorizedDeviceIds: currentList,
        deviceId: devId,
        pendingDeviceId: '',
        lastActivity: Date.now()
      });

      logUserActivity('Device Self-Authorized via Admin PIN', `Authorized device ${devId} for ${targetUser.name}`, targetUser);

      // Login immediately
      const res = login(unauthorizedData.username, unauthorizedData.pin);
      if (res.success) {
        setUnauthorizedData(null);
      }
    } catch (err: any) {
      setAdminAuthError(err?.message || 'Failed to authorize device');
    } finally {
      setIsAuthorizingAdmin(false);
    }
  };

  const handleCreateInitialUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isLoading || isCreating) return;
    setError('');

    if (!createName.trim()) {
      setError('Please enter a username');
      return;
    }
    if (!createPin.trim()) {
      setError('Please enter a password / PIN');
      return;
    }

    setIsCreating(true);
    const userId = uuidv4();
    const curDev = currentDeviceId || getDeviceId();

    const newUser: User = {
      id: userId,
      name: createName.trim(),
      username: createName.trim().toLowerCase(),
      pin: createPin.trim(),
      isAdmin: true,
      role: 'admin',
      deviceId: curDev,
      authorizedDeviceId: curDev,
      authorizedDeviceIds: [curDev],
      lastActivity: Date.now(),
      lastAction: 'Initial Admin Account Created'
    };

    try {
      await setDoc(doc(db, 'users', userId), newUser);
      login(newUser.name, newUser.pin);
    } catch (err: any) {
      setError(err.message || String(err));
      handleFirestoreError(err, OperationType.CREATE, `users/${userId}`);
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <div className="relative min-h-screen w-full flex items-center justify-center bg-slate-100/90 p-4 font-sans text-slate-800 antialiased overflow-hidden select-none">
      
      {/* ── Lightweight Background Layer ── */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        <div 
          className="absolute inset-0 opacity-[0.35]"
          style={{
            backgroundImage: `radial-gradient(#94a3b8 1px, transparent 1px)`,
            backgroundSize: '24px 24px',
          }}
        />
        <div className="absolute -top-24 -left-24 w-80 sm:w-96 h-80 sm:h-96 rounded-full bg-emerald-200/30 blur-2xl" />
        <div className="absolute -bottom-24 -right-24 w-80 sm:w-96 h-80 sm:h-96 rounded-full bg-teal-200/25 blur-2xl" />
      </div>

      {/* ── Main Container Card ── */}
      <div className="relative z-10 w-full max-w-[420px] bg-white rounded-2xl shadow-xl border border-slate-200/90 p-6 sm:p-8 transition-all">
        
        {/* Brand Header */}
        <div className="text-center">
          <div className="flex justify-center mb-3">
            <CompanyLogo className="h-16 sm:h-20 w-auto max-w-[200px] object-contain" />
          </div>
          
          <h1 className="text-base sm:text-lg font-medium text-slate-900 tracking-tight">
            Greenzar Food & Beverage
          </h1>
          <p className="text-xs text-slate-500 mt-1 font-normal text-center">
            Accounts Ledger Portal
          </p>
        </div>

        {/* Divider */}
        <div className="w-full h-px bg-slate-100 my-5"></div>

        {/* ── Unauthorized Device Screen ── */}
        {unauthorizedData ? (
          <div className="space-y-4">
            <div className="p-4 bg-rose-50 border border-rose-200 rounded-xl text-rose-900">
              <div className="flex items-start gap-3">
                <div className="p-2 bg-rose-100 text-rose-700 rounded-lg shrink-0 mt-0.5">
                  <ShieldAlert size={20} />
                </div>
                <div>
                  <h3 className="font-bold text-sm text-rose-900">Device Not Authorized</h3>
                  <p className="text-xs text-rose-700 mt-0.5 leading-relaxed">
                    Login is permitted <strong>only on authorized devices</strong>. This device has not been assigned to operator{' '}
                    <span className="font-semibold text-rose-950">"{unauthorizedData.user?.name || unauthorizedData.username}"</span>.
                  </p>
                </div>
              </div>
            </div>

            {/* Device ID Card */}
            <div className="bg-slate-50 border border-slate-200 rounded-xl p-3.5 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
                  <Smartphone size={13} className="text-slate-600" />
                  Your Device ID
                </span>
                <span className="text-[10px] font-medium text-amber-700 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-full">
                  Pending Authorization
                </span>
              </div>
              
              <div className="flex items-center justify-between gap-2 bg-white px-3 py-2 rounded-lg border border-slate-200">
                <code className="font-mono text-sm font-bold text-slate-900 select-all tracking-wider">
                  {unauthorizedData.deviceId}
                </code>
                <button
                  type="button"
                  onClick={handleCopyDeviceId}
                  className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded transition cursor-pointer"
                  title="Copy Device ID"
                >
                  {copied ? <Check size={13} className="text-emerald-600" /> : <Copy size={13} />}
                  <span>{copied ? 'Copied!' : 'Copy'}</span>
                </button>
              </div>

              <p className="text-[11px] text-slate-500 leading-normal">
                An authorization request was recorded for the Admin. Send this Device ID to the helpline below to get authorized.
              </p>
            </div>

            {/* 👑 Administrator Direct Authorization Card */}
            <div className="bg-blue-50/90 border border-blue-200 rounded-xl p-3.5 space-y-2.5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5 text-blue-950 font-bold text-xs">
                  <Shield size={14} className="text-blue-700" />
                  <span>{unauthorizedData.user?.isAdmin ? 'Administrator Verification' : 'Authorize with Admin PIN'}</span>
                </div>
                <button
                  type="button"
                  onClick={() => setShowAdminPinAuth(!showAdminPinAuth)}
                  className="text-[11px] font-bold text-blue-700 hover:text-blue-900 underline cursor-pointer"
                >
                  {showAdminPinAuth ? 'Collapse' : 'Enter Admin PIN'}
                </button>
              </div>

              <p className="text-[11px] text-blue-800 leading-relaxed">
                {unauthorizedData.user?.isAdmin 
                  ? 'Are you the Administrator? Authorize this device immediately by entering your Admin PIN.' 
                  : 'If an Administrator is present, enter the Admin PIN below to authorize this device instantly.'}
              </p>

              {(showAdminPinAuth || unauthorizedData.user?.isAdmin) && (
                <form onSubmit={handleAdminAuthorizeOnScreen} className="space-y-2 pt-1">
                  <div className="flex gap-2">
                    <div className="relative flex-1">
                      <Key size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                      <input
                        type="password"
                        maxLength={4}
                        value={adminAuthPin}
                        onChange={e => setAdminAuthPin(e.target.value.replace(/[^0-9]/g, ''))}
                        placeholder="4-Digit Admin PIN"
                        className="w-full pl-8 pr-3 py-1.5 bg-white border border-blue-300 rounded-lg text-xs font-mono tracking-widest text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-blue-600"
                      />
                    </div>
                    <button
                      type="submit"
                      disabled={isAuthorizingAdmin || !adminAuthPin.trim()}
                      className="px-3.5 py-1.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-lg text-xs font-bold transition cursor-pointer"
                    >
                      {isAuthorizingAdmin ? 'Verifying...' : 'Authorize Device'}
                    </button>
                  </div>
                  {adminAuthError && (
                    <p className="text-[10.5px] text-rose-600 font-semibold">{adminAuthError}</p>
                  )}
                </form>
              )}
            </div>

            {/* WhatsApp Redirect Button */}
            <a
              href={unauthorizedData.whatsappUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="w-full py-3 px-4 bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 text-white rounded-xl text-xs sm:text-sm font-bold transition flex items-center justify-center gap-2.5 shadow-md hover:shadow-lg cursor-pointer"
            >
              <MessageSquare size={16} />
              <span>Send Device ID to WhatsApp ({ADMIN_WHATSAPP_NUMBER})</span>
            </a>

            {/* Auto-check Live Indicator */}
            <div className="flex items-center justify-center gap-2 py-1 text-xs text-slate-500">
              <RefreshCw size={13} className="animate-spin text-emerald-600" />
              <span>Waiting for Admin to authorize...</span>
            </div>

            {/* Back Button */}
            <div className="pt-2 border-t border-slate-100 flex items-center justify-between">
              <button
                type="button"
                onClick={() => setUnauthorizedData(null)}
                className="inline-flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-800 font-medium cursor-pointer"
              >
                <ArrowLeft size={14} />
                <span>Back to Login</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  const res = login(unauthorizedData.username, unauthorizedData.pin);
                  if (res.success) {
                    setUnauthorizedData(null);
                  }
                }}
                className="text-xs text-emerald-700 hover:text-emerald-900 font-bold underline cursor-pointer"
              >
                Retry Now
              </button>
            </div>
          </div>
        ) : !isLoading && users.length === 0 ? (
          /* ── Initial Master Admin Setup ── */
          <form onSubmit={handleCreateInitialUser} className="space-y-4">
            <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg text-slate-700 text-xs flex items-start gap-2.5">
              <Database size={15} className="text-slate-600 shrink-0 mt-0.5" />
              <div>
                <p className="font-medium text-slate-800 text-xs">Initial Setup Required</p>
                <p className="mt-0.5 text-[11.5px] text-slate-500 leading-relaxed font-normal">
                  No accounts found. Create master administrator. Your device will be authorized automatically.
                </p>
              </div>
            </div>

            {error && (
              <div className="text-xs text-rose-600 font-normal">
                {error}
              </div>
            )}

            <div>
              <label className="block text-xs font-normal text-slate-600 mb-1.5">
                Operator Username
              </label>
              <div className="relative">
                <UserIcon size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  required
                  value={createName}
                  onChange={(e) => setCreateName(e.target.value)}
                  disabled={isCreating}
                  className="w-full pl-9 pr-3 py-2 bg-white border border-slate-200 rounded-lg text-xs sm:text-sm font-normal text-slate-800 placeholder:text-slate-400 focus:border-emerald-600 focus:ring-1 focus:ring-emerald-600/20 focus:outline-none transition"
                  placeholder="Enter username"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-normal text-slate-600 mb-1.5">
                4-Digit Security PIN
              </label>
              <div className="relative">
                <Lock size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="password"
                  required
                  maxLength={4}
                  value={createPin}
                  onChange={(e) => setCreatePin(e.target.value.replace(/[^0-9]/g, ''))}
                  disabled={isCreating}
                  className="w-full pl-9 pr-3 py-2 bg-white border border-slate-200 rounded-lg text-xs sm:text-sm font-normal tracking-widest text-slate-800 placeholder:text-slate-400 focus:border-emerald-600 focus:ring-1 focus:ring-emerald-600/20 focus:outline-none transition"
                  placeholder="••••"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={isCreating}
              className="w-full py-2.5 px-4 bg-emerald-700 hover:bg-emerald-800 active:bg-emerald-900 text-white rounded-lg text-xs sm:text-sm font-medium transition disabled:opacity-50 flex items-center justify-center gap-2 cursor-pointer mt-2"
            >
              <UserPlus size={15} />
              <span>{isCreating ? 'Creating Master Account...' : 'Create Master Account'}</span>
            </button>
          </form>
        ) : (
          /* ── Standard Login Form ── */
          <form onSubmit={handleSubmit} className="space-y-4">
            {error && (
              <div className="p-2.5 bg-rose-50 border border-rose-200 rounded-lg text-xs text-rose-700 font-medium">
                {error}
              </div>
            )}
            
            <div>
              <label className="block text-xs font-normal text-slate-600 mb-1.5">
                Operator Username
              </label>
              <div className="relative">
                <UserIcon size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  disabled={isLoading}
                  className="w-full pl-9 pr-3 py-2 bg-white border border-slate-200 rounded-lg text-xs sm:text-sm font-normal text-slate-800 placeholder:text-slate-400 focus:border-emerald-600 focus:ring-1 focus:ring-emerald-600/20 focus:outline-none transition"
                  placeholder="Enter registered username"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-normal text-slate-600 mb-1.5">
                Password / PIN
              </label>
              <div className="relative">
                <Lock size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="password"
                  value={pin}
                  onChange={(e) => setPin(e.target.value)}
                  disabled={isLoading}
                  className="w-full pl-9 pr-3 py-2 bg-white border border-slate-200 rounded-lg text-xs sm:text-sm font-normal text-slate-800 placeholder:text-slate-400 focus:border-emerald-600 focus:ring-1 focus:ring-emerald-600/20 focus:outline-none transition"
                  placeholder="Enter password or PIN"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={isLoading}
              className="w-full py-2.5 px-4 bg-emerald-800 hover:bg-emerald-900 active:bg-emerald-950 text-white rounded-lg text-xs sm:text-sm font-medium transition disabled:opacity-50 flex items-center justify-center gap-2 cursor-pointer mt-2"
            >
              <LogIn size={15} />
              <span>{isLoading ? 'Authenticating...' : 'Sign In to Ledger'}</span>
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
