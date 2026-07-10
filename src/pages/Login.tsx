import React, { useState, useEffect } from 'react';
import { useAuth } from '../AuthContext';
import { LogIn } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import CompanyLogo from '../components/CompanyLogo';

export default function Login() {
  const { users, login, currentUser, isLoading } = useAuth();
  const navigate = useNavigate();
  const [username, setUsername] = useState('');
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (currentUser) {
      navigate('/', { replace: true });
    }
  }, [currentUser, navigate]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (isLoading) return;
    
    if (!username.trim()) {
      setError('Please enter a username');
      return;
    }
    if (pin.length !== 4) {
      setError('PIN must be exactly 4 digits');
      return;
    }
    
    const user = users.find(u => (u?.name || '').toLowerCase() === username.trim().toLowerCase());
    if (!user) {
      setError('Invalid username or PIN');
      return;
    }

    const success = login(user.id, pin);
    if (!success) {
      setError('Invalid username or PIN');
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
                placeholder="e.g. Admin"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Security PIN (4 digits)</label>
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
        </div>
      </div>
    </div>
  );
}
