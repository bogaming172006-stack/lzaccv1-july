import React from 'react';
import { WifiOff } from 'lucide-react';
import { useOnlineStatus } from '../hooks/useOnlineStatus';

export const OfflineIndicator: React.FC = () => {
  const isOnline = useOnlineStatus();

  if (isOnline) return null;

  return (
    <div 
      id="pwa-offline-indicator"
      className="fixed bottom-4 left-4 z-50 flex items-center gap-2.5 rounded-lg bg-zinc-900 border border-zinc-700/80 px-3.5 py-2 text-xs font-medium text-white shadow-2xl animate-in fade-in slide-in-from-bottom-2 duration-200"
    >
      <span className="flex h-2 w-2 relative">
        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75"></span>
        <span className="relative inline-flex rounded-full h-2 w-2 bg-amber-500"></span>
      </span>
      <WifiOff size={14} className="text-amber-400 shrink-0" />
      <span>Offline Mode — Cached local data active</span>
    </div>
  );
};

export default OfflineIndicator;
