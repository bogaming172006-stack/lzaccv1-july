import React, { useState, useEffect } from 'react';
import { useAuth } from '../AuthContext';
import { LogIn, UserPlus, Database } from 'lucide-react';
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

  // Initial user creation state if 0 users in DB
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
      setError('Please enter a username');
      return;
    }
    if (pin.length !== 4) {
      setError('PIN must be exactly 4 digits');
      return;
    }

    const success = login(username, pin);
    if (!success) {
      setError('Invalid username or PIN');
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
      setError('PIN must be exactly 4 digits');
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
    <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4 font-sans">
      <div className="w-full max-w-sm bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="p-8">
          <div className="w-12 h-12 bg-sky-100 rounded-lg flex items-center justify-center mb-6 mx-auto">
            <LogIn className="text-sky-600" size={24} />
          </div>
          <div className="flex justify-center mb-4">
            <CompanyLogo className="h-20 w-auto" variant="color" />
          </div>
          <p className="text-sm text-center text-gray-500 mb-6">Sign in to your ledger account</p>

          {!isLoading && users.length === 0 ? (
            /* Database has no users -> Allow adding initial user directly into database */
            <form onSubmit={handleCreateInitialUser} className="space-y-4">
              <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-amber-900 text-xs flex items-start gap-2">
                <Database size={16} className="text-amber-600 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="font-bold">No users in database</p>
                  <p className="mt-0.5">Input a name & 4-digit PIN below to register the first user into the database.</p>
                </div>
              </div>

              {error && (
                <div className="p-3 text-sm text-red-600 bg-red-50 rounded-md">
                  {error}
                </div>
              )}

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Username / Name</label>
                <input
                  type="text"
                  required
                  value={createName}
                  onChange={(e) => setCreateName(e.target.value)}
                  disabled={isCreating}
                  className="w-full px-4 py-2 bg-gray-50 border border-gray-200 rounded-md focus:outline-none focus:ring-2 focus:ring-sky-500/50 focus:border-sky-500 transition-colors"
                  placeholder="e.g. Admin or Azhar"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">4-Digit Security PIN</label>
                <input
                  type="password"
                  required
                  maxLength={4}
                  value={createPin}
                  onChange={(e) => setCreatePin(e.target.value.replace(/[^0-9]/g, ''))}
                  disabled={isCreating}
                  className="w-full px-4 py-2 bg-gray-50 border border-gray-200 rounded-md focus:outline-none focus:ring-2 focus:ring-sky-500/50 focus:border-sky-500 text-center tracking-widest text-lg font-mono"
                  placeholder="••••"
                />
              </div>

              <button
                type="submit"
                disabled={isCreating}
                className="w-full py-2.5 px-4 bg-emerald-600 text-white rounded-md font-medium hover:bg-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-offset-2 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
              >
                <UserPlus size={18} />
                <span>{isCreating ? 'Creating User...' : 'Create User in Database & Access'}</span>
              </button>
            </form>
          ) : (
            /* Database has users -> Standard Database Login */
            <form onSubmit={handleSubmit} className="space-y-4">
              {error && (
                <div className="p-3 text-sm text-red-600 bg-red-50 rounded-md">
                  {error}
                </div>
              )}
              
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Username</label>
                <input
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  disabled={isLoading}
                  className="w-full px-4 py-2 bg-gray-50 border border-gray-200 rounded-md focus:outline-none focus:ring-2 focus:ring-sky-500/50 focus:border-sky-500 transition-colors disabled:opacity-50"
                  placeholder="Enter username"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Security PIN</label>
                <input
                  type="password"
                  maxLength={4}
                  value={pin}
                  onChange={(e) => setPin(e.target.value.replace(/[^0-9]/g, ''))}
                  disabled={isLoading}
                  className="w-full px-4 py-2 bg-gray-50 border border-gray-200 rounded-md focus:outline-none focus:ring-2 focus:ring-sky-500/50 focus:border-sky-500 transition-colors text-center tracking-widest text-lg disabled:opacity-50 font-mono"
                  placeholder="••••"
                />
              </div>

              <button
                type="submit"
                disabled={isLoading}
                className="w-full py-2.5 px-4 bg-sky-600 text-white rounded-md font-medium hover:bg-sky-700 focus:outline-none focus:ring-2 focus:ring-sky-500 focus:ring-offset-2 transition-colors disabled:opacity-50"
              >
                {isLoading ? 'Loading Workspace...' : 'Access Ledger'}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
