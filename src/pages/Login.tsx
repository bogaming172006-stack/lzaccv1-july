import React, { useState, useEffect } from 'react';
import { useAuth } from '../AuthContext';
import { LogIn, UserPlus, Database, Lock, User as UserIcon } from 'lucide-react';
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
    <div className="min-h-screen flex items-center justify-center bg-[#f0f2f5] p-3 sm:p-4 font-sans antialiased">
      <div className="w-full max-w-[390px] bg-white rounded-2xl shadow-[0_12px_36px_-8px_rgba(0,0,0,0.1)] border border-slate-100/90 p-5 sm:p-7 transition-all">
        
        {/* Brand Header */}
        <div className="text-center">
          <div className="flex justify-center mb-2.5">
            <CompanyLogo className="h-20 min-[400px]:h-24 sm:h-28 w-auto max-w-[240px] object-contain" />
          </div>
          
          <h1 className="text-lg sm:text-[21px] font-bold text-[#082f1d] tracking-tight leading-snug">
            Greenzar Food & Beverage
          </h1>
          
          {/* Subtle Green Pill Accent */}
          <div className="w-8 h-0.5 bg-[#148348] rounded-full mx-auto mt-2"></div>
        </div>

        {/* Thin Divider Line */}
        <div className="w-full h-px bg-slate-100 my-4 sm:my-5"></div>

        {/* Accounts Operator Authentication Section */}
        <div className="mb-4 sm:mb-5">
          <h2 className="font-bold text-slate-900 text-sm sm:text-[15px] tracking-tight">
            Accounts Operator Authentication
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Enter authorized credentials to access
          </p>
        </div>

        {!isLoading && users.length === 0 ? (
          <form onSubmit={handleCreateInitialUser} className="space-y-3.5 sm:space-y-4">
            <div className="p-2.5 bg-emerald-50 border border-emerald-200 rounded-xl text-emerald-900 text-xs flex items-start gap-2">
              <Database size={15} className="text-emerald-700 shrink-0 mt-0.5" />
              <div>
                <p className="font-bold text-[11px]">Initial System Bootstrap</p>
                <p className="mt-0.5 text-[10.5px] text-emerald-800 leading-relaxed">
                  No operator accounts found. Create master Admin account.
                </p>
              </div>
            </div>

            {error && (
              <div className="p-2.5 text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-xl font-semibold">
                {error}
              </div>
            )}

            <div>
              <label className="block text-[10.5px] font-bold uppercase tracking-wider text-[#0e633d] mb-1.5">
                OPERATOR USERNAME
              </label>
              <div className="relative">
                <UserIcon size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#0e633d]" />
                <input
                  type="text"
                  required
                  value={createName}
                  onChange={(e) => setCreateName(e.target.value)}
                  disabled={isCreating}
                  className="w-full pl-9 pr-3 py-2.5 bg-white border border-slate-200 rounded-xl text-xs sm:text-sm font-medium text-slate-900 placeholder:text-slate-400 focus:border-[#0e633d] focus:ring-3 focus:ring-emerald-500/10 focus:outline-none transition-all shadow-2xs"
                  placeholder="Enter registered username"
                />
              </div>
            </div>

            <div>
              <label className="block text-[10.5px] font-bold uppercase tracking-wider text-[#0e633d] mb-1.5">
                4-DIGIT SECURITY PIN
              </label>
              <div className="relative">
                <Lock size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#0e633d]" />
                <input
                  type="password"
                  required
                  maxLength={4}
                  value={createPin}
                  onChange={(e) => setCreatePin(e.target.value.replace(/[^0-9]/g, ''))}
                  disabled={isCreating}
                  className="w-full pl-9 pr-3 py-2.5 bg-white border border-slate-200 rounded-xl text-xs sm:text-sm font-medium tracking-widest text-slate-900 placeholder:text-slate-400 focus:border-[#0e633d] focus:ring-3 focus:ring-emerald-500/10 focus:outline-none transition-all shadow-2xs"
                  placeholder="••••"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={isCreating}
              className="w-full py-2.5 sm:py-3 px-4 bg-[#0e633d] hover:bg-[#0a4e2f] active:scale-[0.99] text-white rounded-xl text-xs sm:text-sm font-semibold shadow-md shadow-emerald-950/15 transition-all disabled:opacity-50 flex items-center justify-center gap-2 cursor-pointer mt-1"
            >
              <UserPlus size={16} />
              <span>{isCreating ? 'Provisioning Master...' : 'Provision Master Account & Enter'}</span>
            </button>
          </form>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-3.5 sm:space-y-4">
            {error && (
              <div className="p-2.5 text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-xl font-semibold">
                {error}
              </div>
            )}
            
            <div>
              <label className="block text-[10.5px] font-bold uppercase tracking-wider text-[#0e633d] mb-1.5">
                OPERATOR USERNAME
              </label>
              <div className="relative">
                <UserIcon size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#0e633d]" />
                <input
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  disabled={isLoading}
                  className="w-full pl-9 pr-3 py-2.5 bg-white border border-slate-200 rounded-xl text-xs sm:text-sm font-medium text-slate-900 placeholder:text-slate-400 focus:border-[#0e633d] focus:ring-3 focus:ring-emerald-500/10 focus:outline-none transition-all shadow-2xs"
                  placeholder="Enter registered username"
                />
              </div>
            </div>

            <div>
              <label className="block text-[10.5px] font-bold uppercase tracking-wider text-[#0e633d] mb-1.5">
                4-DIGIT SECURITY PIN
              </label>
              <div className="relative">
                <Lock size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#0e633d]" />
                <input
                  type="password"
                  maxLength={4}
                  value={pin}
                  onChange={(e) => setPin(e.target.value.replace(/[^0-9]/g, ''))}
                  disabled={isLoading}
                  className="w-full pl-9 pr-3 py-2.5 bg-white border border-slate-200 rounded-xl text-xs sm:text-sm font-medium tracking-widest text-slate-900 placeholder:text-slate-400 focus:border-[#0e633d] focus:ring-3 focus:ring-emerald-500/10 focus:outline-none transition-all shadow-2xs"
                  placeholder="••••"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={isLoading}
              className="w-full py-2.5 sm:py-3 px-4 bg-[#0e633d] hover:bg-[#0a4e2f] active:scale-[0.99] text-white rounded-xl text-xs sm:text-sm font-semibold shadow-md shadow-emerald-950/15 transition-all disabled:opacity-50 flex items-center justify-center gap-2 cursor-pointer mt-1"
            >
              <LogIn size={16} className="stroke-[2.2]" />
              <span>{isLoading ? 'Authenticating...' : 'Sign In to Ledger'}</span>
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
