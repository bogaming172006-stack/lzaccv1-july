import React, { useState, useEffect } from 'react';
import { useAuth } from '../AuthContext';
import { LogIn, UserPlus, Database, ShieldCheck, Lock, User as UserIcon } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import CompanyLogo from '../components/CompanyLogo';
import { db, doc, setDoc, handleFirestoreError, OperationType } from '../firebase';
import { v4 as uuidv4 } from 'uuid';
import { User } from '../types';

export default function Login() {
  const { users, login, currentUser, isLoading } = useAuth();
  const navigate = useNavigate();
  const [username, setUsername] = useState('');
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');

  const [createName, setCreateName] = useState('');
  const [createPin, setCreatePin] = useState('');
  const [isCreating, setIsCreating] = useState(false);

  useEffect(() => {
    if (currentUser) {
      navigate('/', { replace: true });
    }
  }, [currentUser, navigate]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (isLoading) return;
    setError('');
    
    if (!username.trim()) {
      setError('Please enter your operator username');
      return;
    }
    if (pin.length !== 4) {
      setError('Security PIN must be exactly 4 digits');
      return;
    }

    const success = login(username, pin);
    if (!success) {
      setError('Invalid operator username or security PIN');
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
    if (createPin.length !== 4) {
      setError('Security PIN must be exactly 4 digits');
      return;
    }

    setIsCreating(true);
    const userId = uuidv4();
    const newUser: User = {
      id: userId,
      name: createName.trim(),
      pin: createPin.trim(),
      isAdmin: true,
      deviceId: '',
      lastActivity: Date.now()
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
    <div className="min-h-screen flex items-center justify-center bg-slate-100 p-4 font-sans antialiased">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-xl border border-slate-200 overflow-hidden">
        {/* Top Corporate Branding Banner */}
        <div className="bg-[#0f172a] px-8 py-7 text-center border-b border-slate-800">
          <div className="flex justify-center mb-3">
            <div className="p-3 bg-white/10 rounded-2xl backdrop-blur-xs border border-white/10">
              <CompanyLogo className="h-16 w-auto" variant="white" />
            </div>
          </div>
          <h1 className="text-white font-bold text-base tracking-tight">Greenzar Food & Beverage</h1>
          <p className="text-slate-400 text-xs font-medium mt-1">Enterprise Financial Accounting & General Ledger</p>
        </div>

        <div className="p-8 space-y-6">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <div>
              <h2 className="font-bold text-slate-900 text-sm">System Operator Authentication</h2>
              <p className="text-xs text-slate-500 mt-0.5">Enter authorized credentials to access workspace</p>
            </div>
            <ShieldCheck size={20} className="text-blue-600" />
          </div>

          {!isLoading && users.length === 0 ? (
            <form onSubmit={handleCreateInitialUser} className="space-y-4">
              <div className="p-3.5 bg-amber-50 border border-amber-200 rounded-xl text-amber-900 text-xs flex items-start gap-2.5">
                <Database size={16} className="text-amber-600 shrink-0 mt-0.5" />
                <div>
                  <p className="font-bold">Initial System Bootstrap</p>
                  <p className="mt-0.5 text-[11px] text-amber-800">
                    No operator accounts found. Create the master Administrator account to initialize database.
                  </p>
                </div>
              </div>

              {error && (
                <div className="p-3 text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-lg font-semibold">
                  {error}
                </div>
              )}

              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-700 mb-1.5">Master Operator Username</label>
                <div className="relative">
                  <UserIcon size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    type="text"
                    required
                    value={createName}
                    onChange={(e) => setCreateName(e.target.value)}
                    disabled={isCreating}
                    className="w-full pl-9 pr-3 py-2 bg-white border border-slate-300 rounded-lg text-xs font-semibold text-slate-900 focus:border-blue-600 focus:outline-none"
                    placeholder="e.g. Admin"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-700 mb-1.5">4-Digit Security PIN</label>
                <div className="relative">
                  <Lock size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    type="password"
                    required
                    maxLength={4}
                    value={createPin}
                    onChange={(e) => setCreatePin(e.target.value.replace(/[^0-9]/g, ''))}
                    disabled={isCreating}
                    className="w-full pl-9 pr-3 py-2 bg-white border border-slate-300 rounded-lg text-center tracking-widest text-base font-mono font-bold text-slate-900 focus:border-blue-600 focus:outline-none"
                    placeholder="••••"
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={isCreating}
                className="w-full py-2.5 px-4 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-bold shadow-xs transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
              >
                <UserPlus size={15} />
                <span>{isCreating ? 'Provisioning Master...' : 'Provision Master Account & Enter'}</span>
              </button>
            </form>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              {error && (
                <div className="p-3 text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-lg font-semibold">
                  {error}
                </div>
              )}
              
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-700 mb-1.5">Operator Username</label>
                <div className="relative">
                  <UserIcon size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    type="text"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    disabled={isLoading}
                    className="w-full pl-9 pr-3 py-2 bg-white border border-slate-300 rounded-lg text-xs font-semibold text-slate-900 focus:border-blue-600 focus:outline-none"
                    placeholder="Enter registered username"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-700 mb-1.5">4-Digit Security PIN</label>
                <div className="relative">
                  <Lock size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    type="password"
                    maxLength={4}
                    value={pin}
                    onChange={(e) => setPin(e.target.value.replace(/[^0-9]/g, ''))}
                    disabled={isLoading}
                    className="w-full pl-9 pr-3 py-2 bg-white border border-slate-300 rounded-lg text-center tracking-widest text-base font-mono font-bold text-slate-900 focus:border-blue-600 focus:outline-none"
                    placeholder="••••"
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={isLoading}
                className="w-full py-2.5 px-4 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-bold shadow-xs transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
              >
                <LogIn size={15} />
                <span>{isLoading ? 'Authenticating...' : 'Sign In to Ledger'}</span>
              </button>
            </form>
          )}

          <div className="pt-4 border-t border-slate-100 flex items-center justify-between text-[11px] text-slate-400">
            <span>Encrypted Offline Engine</span>
            <span>v2.4.0 Corporate Edition</span>
          </div>
        </div>
      </div>
    </div>
  );
}
