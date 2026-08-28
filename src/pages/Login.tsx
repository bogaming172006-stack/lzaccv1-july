import React, { useState, useEffect } from 'react';
import { useAuth } from '../AuthContext';
import { LogIn, UserPlus, Database, Lock, User as UserIcon, ShieldCheck } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import CompanyLogo from '../components/CompanyLogo';
import { db, doc, setDoc, handleFirestoreError, OperationType } from '../firebase';
import { v4 as uuidv4 } from 'uuid';
import { User } from '../types';
import { motion } from 'motion/react';

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
      setError('Please enter your username');
      return;
    }
    if (!pin.trim()) {
      setError('Please enter your password / PIN');
      return;
    }

    const success = login(username, pin);
    if (!success) {
      setError('Invalid username or password');
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
    const newUser: User = {
      id: userId,
      name: createName.trim(),
      username: createName.trim().toLowerCase(),
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
    <div className="relative min-h-screen w-full flex items-center justify-center bg-[#f8fafc] p-4 font-sans text-slate-800 antialiased overflow-hidden select-none">
      
      {/* ── Background Animations & Decorative Layer ── */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        {/* Subtle Geometric Background Dot Grid */}
        <div 
          className="absolute inset-0 opacity-[0.45]"
          style={{
            backgroundImage: `radial-gradient(#94a3b8 1px, transparent 1px)`,
            backgroundSize: '28px 28px',
            maskImage: 'radial-gradient(ellipse 60% 60% at 50% 50%, #000 70%, transparent 100%)',
            WebkitMaskImage: 'radial-gradient(ellipse 60% 60% at 50% 50%, #000 70%, transparent 100%)'
          }}
        />

        {/* Animated Gradient Ambient Orb 1 - Emerald / Greenzar Theme */}
        <motion.div
          animate={{
            x: [0, 60, -40, 0],
            y: [0, -50, 40, 0],
            scale: [1, 1.15, 0.95, 1],
          }}
          transition={{
            duration: 18,
            repeat: Infinity,
            ease: "easeInOut"
          }}
          className="absolute -top-20 -left-20 w-[380px] sm:w-[480px] h-[380px] sm:h-[480px] rounded-full bg-gradient-to-br from-emerald-200/40 via-teal-100/30 to-transparent blur-3xl"
        />

        {/* Animated Gradient Ambient Orb 2 - Sky / Soft Cyan Tone */}
        <motion.div
          animate={{
            x: [0, -70, 50, 0],
            y: [0, 60, -30, 0],
            scale: [1, 0.9, 1.12, 1],
          }}
          transition={{
            duration: 22,
            repeat: Infinity,
            ease: "easeInOut"
          }}
          className="absolute -bottom-24 -right-24 w-[420px] sm:w-[520px] h-[420px] sm:h-[520px] rounded-full bg-gradient-to-tl from-sky-200/35 via-emerald-100/25 to-transparent blur-3xl"
        />

        {/* Animated Ambient Orb 3 - Center subtle light pulse */}
        <motion.div
          animate={{
            opacity: [0.35, 0.6, 0.35],
            scale: [0.95, 1.05, 0.95],
          }}
          transition={{
            duration: 12,
            repeat: Infinity,
            ease: "easeInOut"
          }}
          className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] sm:w-[750px] h-[600px] sm:h-[750px] rounded-full bg-emerald-50/40 blur-[100px]"
        />

        {/* Subtle Animated Floating Rings / Wave Lines */}
        <motion.div
          animate={{
            rotate: [0, 360]
          }}
          transition={{
            duration: 90,
            repeat: Infinity,
            ease: "linear"
          }}
          className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[620px] h-[620px] rounded-full border border-slate-200/40 pointer-events-none"
        />
        <motion.div
          animate={{
            rotate: [360, 0]
          }}
          transition={{
            duration: 120,
            repeat: Infinity,
            ease: "linear"
          }}
          className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[820px] h-[820px] rounded-full border border-dashed border-slate-200/30 pointer-events-none"
        />
      </div>

      {/* ── Main Login Container Card ── */}
      <motion.div
        initial={{ opacity: 0, y: 16, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
        className="relative z-10 w-full max-w-[380px] bg-white/95 backdrop-blur-md rounded-2xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] border border-slate-200/90 p-6 sm:p-8 transition-all"
      >
        
        {/* Brand Header */}
        <div className="text-center">
          <div className="flex justify-center mb-3">
            <CompanyLogo className="h-16 sm:h-20 w-auto max-w-[200px] object-contain" />
          </div>
          
          <h1 className="text-base sm:text-lg font-medium text-slate-900 tracking-tight">
            Greenzar Food & Beverage
          </h1>
          <p className="text-xs text-slate-500 mt-1 font-normal flex items-center justify-center gap-1.5">
            <ShieldCheck size={13} className="text-emerald-600" />
            <span>Accounts Ledger Portal</span>
          </p>
        </div>

        {/* Subtle Divider */}
        <div className="w-full h-px bg-slate-100 my-5"></div>

        {!isLoading && users.length === 0 ? (
          <form onSubmit={handleCreateInitialUser} className="space-y-4">
            <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg text-slate-700 text-xs flex items-start gap-2.5">
              <Database size={15} className="text-slate-600 shrink-0 mt-0.5" />
              <div>
                <p className="font-medium text-slate-800 text-xs">Initial Setup Required</p>
                <p className="mt-0.5 text-[11.5px] text-slate-500 leading-relaxed font-normal">
                  No accounts found. Create master administrator.
                </p>
              </div>
            </div>

            {error && (
              <div className="p-2.5 text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-lg font-normal">
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
          <form onSubmit={handleSubmit} className="space-y-4">
            {error && (
              <div className="p-2.5 text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-lg font-normal">
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
      </motion.div>
    </div>
  );
}

