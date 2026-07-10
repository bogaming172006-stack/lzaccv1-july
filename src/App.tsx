import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { formatContactWith91 } from './lib/phoneUtils';
import { GOOGLE_SHEETS_CONFIG } from './googleSheetsConfig';
import { AuthProvider, useAuth } from './AuthContext';
import { LedgerProvider, useLedger } from './LedgerContext';
import { ThemeProvider } from './ThemeContext';
import { setLocalFallback } from './firebase';
import Navigation from './components/Navigation';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import PartyList from './pages/PartyList';
import PartyDetail from './pages/PartyDetail';
import Log from './pages/Log';
import Activities from './pages/Activities';
import Users from './pages/Users';
import MasterEntry from './pages/MasterEntry';
import InvoiceSheets from './pages/InvoiceSheets';
import ProductList from './pages/ProductList';
import AccountsMail from './pages/AccountsMail';
import SplashLoader from './components/SplashLoader';

const RequireAuth: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { currentUser, isLoading, error: authError } = useAuth();
  const { error: ledgerError, isLoading: ledgerLoading } = useLedger();

  if (isLoading || ledgerLoading) {
    return null;
  }

  const activeError = authError || ledgerError;
  if (activeError) {
    const is401Error = activeError.includes('401') || activeError.includes('Unauthorized') || activeError.includes('unauthorized');

    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 p-6 font-sans">
        <div className="bg-white border border-red-100 rounded-2xl shadow-xl max-w-xl w-full p-8 text-gray-800">
          <div className="w-16 h-16 bg-red-50 text-red-500 rounded-full flex items-center justify-center mx-auto mb-6">
            <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          </div>
          <h2 className="text-xl font-bold text-center text-gray-900 mb-2">Turso Database Connection Failure</h2>
          <p className="text-sm text-center text-gray-600 max-w-md mx-auto mb-6">
            {is401Error 
              ? "Your Turso Database Auth Token is missing, incorrect, or unauthorized (401 error)."
              : "We encountered a connection or authorization issue communicating with your Turso database."}
          </p>
          
          <div className="bg-red-50 text-red-800 text-left rounded-lg p-4 font-mono text-xs overflow-auto max-h-48 mb-6 border border-red-100/50 break-all select-all">
            {activeError}
          </div>

          <div className="border-t border-gray-100 pt-6">
            <div className="text-xs text-gray-500 leading-relaxed">
              <p className="font-semibold mb-3 text-gray-700 text-center text-sm">How to Resolve This Database Issue:</p>
              
              <div className="bg-slate-50 p-4 rounded-xl border border-slate-100/80 mb-6 text-gray-600 space-y-3">
                <p>
                  <strong>Why am I seeing "Failed to fetch"?</strong> This happens when the frontend cannot communicate with your database backend server. Usually, this means the server is waiting for valid database configuration parameters or is waking up.
                </p>
                <p>
                  Follow these steps to connect your live Turso database:
                </p>
              </div>

              <ol className="list-decimal list-inside space-y-2.5 text-left max-w-md mx-auto text-gray-600 pl-2">
                <li>
                  Click <strong className="text-gray-800">"Create Token"</strong> in your Turso API Tokens window to generate a secure token.
                </li>
                <li>
                  Copy the generated token string.
                </li>
                <li>
                  Open the <strong className="text-gray-800">Settings menu</strong> (gear icon) in the top-right corner of your AI Studio Build window.
                </li>
                <li>
                  Add/update your environment variables:
                  <ul className="list-disc list-inside pl-4 mt-1 text-xs space-y-1 font-mono text-slate-700">
                    <li><strong className="text-gray-800 font-sans">TURSO_DB_URL</strong>: Your database connection URL</li>
                    <li><strong className="text-gray-800 font-sans">TURSO_DB_AUTH_TOKEN</strong>: The copied token</li>
                  </ul>
                </li>
                <li>
                  Click <strong className="text-gray-800">Save</strong> and refresh the page to securely load your application.
                </li>
              </ol>

              <div className="text-center mt-6">
                <button
                  onClick={() => window.location.reload()}
                  className="px-5 py-2 bg-slate-800 hover:bg-slate-900 text-white font-medium text-xs rounded-lg transition"
                >
                  Refresh Application
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!currentUser) return <Navigate to="/login" replace />;
  return <>{children}</>;
};

const AuthLayout: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { activeLedger } = useLedger();
  
  let themeClass = 'theme-sale';
  if (activeLedger) {
    switch (activeLedger.type) {
      case 'SALE':
        themeClass = 'theme-sale';
        break;
      case 'PURCHASE':
        themeClass = 'theme-purchase';
        break;
      case 'CASH_BANK':
        themeClass = 'theme-cash-bank';
        break;
      case 'EXPENSE':
        themeClass = 'theme-expense';
        break;
      case 'ASSET':
        themeClass = 'theme-asset';
        break;
      case 'LIABILITY':
        themeClass = 'theme-liability';
        break;
      case 'CAPITAL':
        themeClass = 'theme-capital';
        break;
    }
  }
  
  return (
    <div className={`flex flex-col sm:flex-row h-screen bg-gray-50 overflow-hidden font-sans ${themeClass}`}>
      <Navigation />
      <main className="flex-1 overflow-y-auto w-full h-full relative pt-16 sm:pt-0">
        {children}
      </main>
    </div>
  );
};

const triggerGoogleSheetSync = async (activeLedgerId: string) => {
  let appsScriptUrl = localStorage.getItem('greenzar_apps_script_url');
  if (!appsScriptUrl || !appsScriptUrl.trim()) {
    appsScriptUrl = GOOGLE_SHEETS_CONFIG.APPS_SCRIPT_URL;
  }

  const sheetTitle = localStorage.getItem('greenzar_sheet_tab_name') || GOOGLE_SHEETS_CONFIG.DEFAULT_TAB_NAME;

  try {
    const { getFilteredCacheItems } = await import('./lib/idbCache');
    const { syncCollection } = await import('./lib/syncCache');
    
    // Sync cache first to get latest updates
    await syncCollection<any>('parties', activeLedgerId, 'parties');
    const activeParties = await getFilteredCacheItems<any>('parties', p => p.ledgerId === activeLedgerId && p.status !== 'Inactive');

    // Sync transactions to find latest debit and credit
    await syncCollection<any>('transactions', activeLedgerId, 'transactions');
    const activeTransactions = await getFilteredCacheItems<any>('transactions', t => t.ledgerId === activeLedgerId);

    const headers = [
      'Party Name',
      'Address',
      'Opening Balance',
      'Recent Debit',
      'Recent Credit',
      'Current Balance',
      'Email ID',
      'Contact Number'
    ];

    const updatedRows = activeParties.map(party => {
      // Filter transactions for this party and sort by timestamp descending
      const partyTx = activeTransactions
        .filter(t => t.partyId === party.id)
        .sort((a, b) => b.timestamp - a.timestamp);

      let openingBalance = party.openingBalance || 0;
      let recentDebit = 0;
      let recentCredit = 0;
      const currentBalance = party.currentDue || 0;

      if (partyTx.length > 0) {
        const latestTx = partyTx[0];
        if (latestTx.type === 'DEBIT') {
          recentDebit = latestTx.amount || 0;
          openingBalance = currentBalance - recentDebit;
        } else {
          recentCredit = latestTx.amount || 0;
          openingBalance = currentBalance + recentCredit;
        }
      } else {
        openingBalance = currentBalance;
      }

      return [
        party.name,
        party.address || '',
        String(openingBalance),
        String(recentDebit),
        String(recentCredit),
        String(currentBalance),
        party.email || '',
        formatContactWith91(party.phone)
      ];
    });

    const finalPayload = [headers, ...updatedRows];

    console.log(`[Background Auto-Sync] Syncing ${activeParties.length} parties to Google Sheet...`);
    
    const res = await fetch('/api/sheets/sync-proxy', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        appsScriptUrl: appsScriptUrl.trim(),
        action: 'sync',
        sheet: sheetTitle.trim(),
        rows: finalPayload
      })
    });
    
    if (res.ok) {
      console.log('[Background Auto-Sync] Google Sheet updated successfully.');
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('google-sheet-synced'));
      }
    } else {
      console.warn('[Background Auto-Sync] Sync failed with status:', res.status);
    }
  } catch (err) {
    console.error('[Background Auto-Sync] Error during background Google Sheet update:', err);
  }
};

const AppContent: React.FC = () => {
  const { isLoading: authLoading } = useAuth();
  const { isLoading: ledgerLoading, activeLedger } = useLedger();
  const [showSplash, setShowSplash] = React.useState(true);
  const [fade, setFade] = React.useState(false);
  const [minTimeElapsed, setMinTimeElapsed] = React.useState(false);
  const [videoReady, setVideoReady] = React.useState(false);

  // Real-time Background Scanning & Synchronization: Checks and updates Google Sheets every 1 second (1000ms)
  React.useEffect(() => {
    if (!activeLedger?.id) return;

    let intervalId: NodeJS.Timeout | null = null;
    let lastPayloadString = '';

    const performScanSync = async () => {
      const isAutoSyncEnabled = localStorage.getItem('greenzar_realtime_sheet_sync') !== 'false';
      if (!isAutoSyncEnabled) return;

      let appsScriptUrl = localStorage.getItem('greenzar_apps_script_url');
      if (!appsScriptUrl || !appsScriptUrl.trim()) {
        appsScriptUrl = GOOGLE_SHEETS_CONFIG.APPS_SCRIPT_URL;
      }

      const sheetTitle = localStorage.getItem('greenzar_sheet_tab_name') || GOOGLE_SHEETS_CONFIG.DEFAULT_TAB_NAME;

      try {
        const { getFilteredCacheItems } = await import('./lib/idbCache');
        const { syncCollection } = await import('./lib/syncCache');
        
        // Fast local fetch from IndexedDB cache (instantaneous)
        const activeParties = await getFilteredCacheItems<any>('parties', p => p.ledgerId === activeLedger.id && p.status !== 'Inactive');
        const activeTransactions = await getFilteredCacheItems<any>('transactions', t => t.ledgerId === activeLedger.id);

        const currentPayload = activeParties.map(party => {
          const partyTx = activeTransactions
            .filter(t => t.partyId === party.id)
            .sort((a, b) => b.timestamp - a.timestamp);

          let openingBalance = party.openingBalance || 0;
          let recentDebit = 0;
          let recentCredit = 0;
          const currentBalance = party.currentDue || 0;

          if (partyTx.length > 0) {
            const latestTx = partyTx[0];
            if (latestTx.type === 'DEBIT') {
              recentDebit = latestTx.amount || 0;
              openingBalance = currentBalance - recentDebit;
            } else {
              recentCredit = latestTx.amount || 0;
              openingBalance = currentBalance + recentCredit;
            }
          } else {
            openingBalance = currentBalance;
          }

          return [
            party.name,
            party.address || '',
            String(openingBalance),
            String(recentDebit),
            String(recentCredit),
            String(currentBalance),
            party.email || '',
            formatContactWith91(party.phone)
          ];
        });

        const currentPayloadStr = JSON.stringify(currentPayload);

        // ONLY execute the sync network post request if something actually changed!
        // This makes 1-second background scanning extremely high-performance and quota-safe.
        if (currentPayloadStr === lastPayloadString) {
          return;
        }

        console.log('[Background Auto-Sync] Changes detected in local database. Scanning & uploading to Google Sheet...', activeParties.length);
        
        const headers = [
          'Party Name',
          'Address',
          'Opening Balance',
          'Recent Debit',
          'Recent Credit',
          'Current Balance',
          'Email ID',
          'Contact Number'
        ];

        const finalPayload = [headers, ...currentPayload];
        
        const res = await fetch('/api/sheets/sync-proxy', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            appsScriptUrl: appsScriptUrl.trim(),
            action: 'sync',
            sheet: sheetTitle.trim(),
            rows: finalPayload
          })
        });
        
        if (res.ok) {
          console.log('[Background Auto-Sync] Google Sheet updated successfully.');
          lastPayloadString = currentPayloadStr;
          window.dispatchEvent(new CustomEvent('google-sheet-synced'));
        } else {
          console.warn('[Background Auto-Sync] Sync failed with status:', res.status);
        }
      } catch (err) {
        console.error('[Background Auto-Sync] Error during background Google Sheet update:', err);
      }
    };

    // Run the scan check instantly, then every 1000ms (1 second)
    performScanSync();
    intervalId = setInterval(performScanSync, 1000);

    // Also trigger on database sync event for instant responsiveness
    const handleDatabaseSynced = () => {
      performScanSync();
    };
    window.addEventListener('database-synced', handleDatabaseSynced);

    return () => {
      if (intervalId) clearInterval(intervalId);
      window.removeEventListener('database-synced', handleDatabaseSynced);
    };
  }, [activeLedger?.id]);

  // Minimum splash screen duration of 2.0s so the user can enjoy the high-quality animation smoothly
  React.useEffect(() => {
    const timer = setTimeout(() => {
      setMinTimeElapsed(true);
    }, 2000);
    return () => clearTimeout(timer);
  }, []);

  React.useEffect(() => {
    // We only smoothly transition when the auth/ledger loads, the minimum display duration has passed, AND the video player is ready/rendering
    if (!authLoading && !ledgerLoading && minTimeElapsed && videoReady) {
      setFade(true);
      const timer = setTimeout(() => {
        setShowSplash(false);
      }, 700); // 700ms transition
      return () => clearTimeout(timer);
    }
  }, [authLoading, ledgerLoading, minTimeElapsed, videoReady]);

  return (
    <>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<Login />} />
          
          <Route path="/" element={
            <RequireAuth>
              <AuthLayout>
                <Dashboard />
              </AuthLayout>
            </RequireAuth>
          } />
          
          <Route path="/parties" element={
            <RequireAuth>
              <AuthLayout>
                <PartyList />
              </AuthLayout>
            </RequireAuth>
          } />

          <Route path="/products" element={
            <RequireAuth>
              <AuthLayout>
                <ProductList />
              </AuthLayout>
            </RequireAuth>
          } />
          
          <Route path="/parties/:id" element={
            <RequireAuth>
              <AuthLayout>
                <PartyDetail />
              </AuthLayout>
            </RequireAuth>
          } />
          
          <Route path="/log" element={
            <RequireAuth>
              <AuthLayout>
                <Log />
              </AuthLayout>
            </RequireAuth>
          } />
          
          <Route path="/activities" element={
            <RequireAuth>
              <AuthLayout>
                <Activities />
              </AuthLayout>
            </RequireAuth>
          } />
          
          <Route path="/master-entry" element={
            <RequireAuth>
              <AuthLayout>
                <MasterEntry />
              </AuthLayout>
            </RequireAuth>
          } />
          
          <Route path="/invoice-sheets" element={
            <RequireAuth>
              <AuthLayout>
                <InvoiceSheets />
              </AuthLayout>
            </RequireAuth>
          } />

          <Route path="/accounts-mail" element={
            <RequireAuth>
              <AuthLayout>
                <AccountsMail />
              </AuthLayout>
            </RequireAuth>
          } />
          
          <Route path="/admin" element={
            <RequireAuth>
              <AuthLayout>
                <Users />
              </AuthLayout>
            </RequireAuth>
          } />
          
        </Routes>
      </BrowserRouter>

      {showSplash && (
        <SplashLoader 
          onReady={() => setVideoReady(true)}
          className={`transition-opacity duration-700 ease-out ${fade ? 'opacity-0 pointer-events-none' : 'opacity-100'}`}
        />
      )}
    </>
  );
};

export default function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <LedgerProvider>
          <AppContent />
        </LedgerProvider>
      </AuthProvider>
    </ThemeProvider>
  );
}
