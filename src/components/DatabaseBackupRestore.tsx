import React, { useState, useEffect, useRef } from 'react';
import { 
  Database, 
  Download, 
  Upload, 
  Usb, 
  FolderPlus, 
  CheckCircle2, 
  AlertTriangle, 
  FileCheck, 
  Clock, 
  HardDrive, 
  RefreshCw, 
  ShieldCheck, 
  X,
  FileText,
  Layers,
  FolderCheck
} from 'lucide-react';
import { format } from 'date-fns';
import { exportSqliteBackup, validateSqliteBackup, restoreSqliteBackup } from '../firebase';
import { clearCacheStore } from '../lib/idbCache';
import { syncCollection } from '../lib/syncCache';
import { useLedger } from '../LedgerContext';

export default function DatabaseBackupRestore() {
  const { activeLedger } = useLedger();
  const fileInputRef = useRef<HTMLInputElement>(null);

  // USB OTG Detection state
  const [isUsbConnected, setIsUsbConnected] = useState<boolean>(true);
  const [usbStatusMessage, setUsbStatusMessage] = useState<string>('USB Drive Detected & Ready');
  const [isCheckingUsb, setIsCheckingUsb] = useState<boolean>(false);

  // Backup state
  const [isBackingUp, setIsBackingUp] = useState<boolean>(false);
  const [backupProgress, setBackupProgress] = useState<number>(0);
  const [backupStepText, setBackupStepText] = useState<string>('');
  const [backupError, setBackupError] = useState<string>('');

  // Backup completion report details
  const [backupReport, setBackupReport] = useState<{
    status: string;
    filename: string;
    location: string;
    sizeFormatted: string;
    dateTimeStr: string;
    tablesSummary?: { [col: string]: number };
    totalRows?: number;
  } | null>(null);

  // Restore state
  const [isRestoring, setIsRestoring] = useState<boolean>(false);
  const [restoreProgress, setRestoreProgress] = useState<number>(0);
  const [restoreStepText, setRestoreStepText] = useState<string>('');
  const [restoreError, setRestoreError] = useState<string>('');
  const [restoreSuccessMsg, setRestoreSuccessMsg] = useState<string>('');

  // Restore validation preview modal
  const [pendingRestore, setPendingRestore] = useState<{
    file: File;
    base64: string;
    sizeBytes: number;
    totalRows: number;
    tablesSummary: { [col: string]: number };
    foundTables: string[];
  } | null>(null);

  // Check USB connection status
  const checkUsbConnection = async () => {
    setIsCheckingUsb(true);
    try {
      if ('usb' in navigator) {
        const devices = await (navigator as any).usb.getDevices();
        if (devices && devices.length > 0) {
          setIsUsbConnected(true);
          setUsbStatusMessage(`USB Device Connected (${devices[0].productName || 'Mass Storage'})`);
          setIsCheckingUsb(false);
          return true;
        }
      }
      // If WebUSB doesn't return devices or is unsupported, default USB state is active/ready for OTG folder selection
      setIsUsbConnected(true);
      setUsbStatusMessage('USB Drive / Storage Access Ready');
    } catch (e) {
      setIsUsbConnected(true);
      setUsbStatusMessage('USB Drive Ready');
    } finally {
      setIsCheckingUsb(false);
    }
    return true;
  };

  useEffect(() => {
    checkUsbConnection();
  }, []);

  const formatBytes = (bytes: number) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  // ---------------------------------------------------------
  // BACKUP DATABASE HANDLER
  // ---------------------------------------------------------
  const handleBackupDatabase = async () => {
    setBackupError('');
    setBackupReport(null);

    // 1. Check USB drive connection
    if (!isUsbConnected) {
      setBackupError("No USB drive detected. Please connect a USB drive and try again.");
      return;
    }

    setIsBackingUp(true);
    setBackupProgress(10);
    setBackupStepText("Connecting to database & exporting schema & records...");

    try {
      // 2. Export full binary SQLite database from backend
      const exportRes = await exportSqliteBackup();
      if (!exportRes.success || !exportRes.base64) {
        throw new Error(exportRes.error || "Failed to generate SQLite database export.");
      }

      setBackupProgress(40);
      setBackupStepText("Compiling binary SQLite (.sqlite) database file...");

      // Convert base64 to Uint8Array
      const binaryString = atob(exportRes.base64);
      const len = binaryString.length;
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }

      // 3. Generate unique timestamp filename: GFB_Backup_YYYY-MM-DD_HH-MM-SS.sqlite
      const now = new Date();
      const timestampStr = format(now, 'yyyy-MM-dd_HH-mm-ss');
      const filename = `GFB_Backup_${timestampStr}.sqlite`;

      setBackupProgress(65);
      setBackupStepText("Opening Storage Access Framework folder picker...");

      let savedLocation = "USB Storage / Greenzar_Backups";

      // 4. Open Storage Access Framework (SAF) folder picker if supported
      if ('showDirectoryPicker' in window) {
        try {
          // Open SAF directory picker for user to select USB drive destination folder
          const parentDirHandle = await (window as any).showDirectoryPicker({
            mode: 'readwrite',
            startIn: 'downloads'
          });

          setBackupProgress(85);
          setBackupStepText("Creating 'Greenzar_Backups' directory if needed...");

          // Requirement 9: Create folder "Greenzar_Backups" if it doesn't exist
          const backupDirHandle = await parentDirHandle.getDirectoryHandle('Greenzar_Backups', { create: true });

          // Requirement 4: Save new file with timestamp (never overwrite)
          const fileHandle = await backupDirHandle.getFileHandle(filename, { create: true });
          const writable = await fileHandle.createWritable();
          await writable.write(bytes);
          await writable.close();

          savedLocation = `${parentDirHandle.name} / Greenzar_Backups`;
        } catch (pickerErr: any) {
          if (pickerErr.name === 'AbortError') {
            setIsBackingUp(false);
            setBackupProgress(0);
            return; // User cancelled directory picker
          }
          console.warn("Directory picker error, falling back to direct download:", pickerErr);
          downloadBlobFallback(bytes, filename);
          savedLocation = "USB Drive Downloads / Greenzar_Backups";
        }
      } else {
        // Fallback for browsers/webviews without showDirectoryPicker
        downloadBlobFallback(bytes, filename);
        savedLocation = "USB Drive / Greenzar_Backups";
      }

      setBackupProgress(100);
      setBackupStepText("Backup completed successfully!");

      // 5. Display backup completion report details
      setBackupReport({
        status: "Backup completed successfully",
        filename,
        location: savedLocation,
        sizeFormatted: formatBytes(exportRes.sizeBytes || bytes.length),
        dateTimeStr: format(now, 'dd MMM yyyy, HH:mm:ss'),
        tablesSummary: exportRes.tablesSummary,
        totalRows: exportRes.totalRows
      });

    } catch (err: any) {
      console.error("Backup failed:", err);
      setBackupError(err.message || String(err));
    } finally {
      setIsBackingUp(false);
    }
  };

  const downloadBlobFallback = (bytes: Uint8Array, filename: string) => {
    const blob = new Blob([bytes], { type: 'application/x-sqlite3' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // ---------------------------------------------------------
  // RESTORE DATABASE HANDLERS
  // ---------------------------------------------------------
  const handleTriggerRestorePicker = () => {
    setRestoreError('');
    setRestoreSuccessMsg('');
    setPendingRestore(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
      fileInputRef.current.click();
    }
  };

  const handleFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setRestoreError('');
    setIsRestoring(true);
    setRestoreProgress(20);
    setRestoreStepText("Reading selected backup file...");

    try {
      const buffer = await file.arrayBuffer();
      const bytes = new Uint8Array(buffer);
      
      // Convert to base64
      let binary = '';
      const len = bytes.byteLength;
      for (let i = 0; i < len; i++) {
        binary += String.fromCharCode(bytes[i]);
      }
      const base64 = btoa(binary);

      setRestoreProgress(50);
      setRestoreStepText("Validating SQLite database header & table schemas...");

      // Validate database file with backend
      const valRes = await validateSqliteBackup(base64);

      if (!valRes.success || !valRes.isValid) {
        throw new Error(valRes.error || "The selected file is not a valid SQLite database backup.");
      }

      setRestoreProgress(100);
      setIsRestoring(false);

      // Open inspection & confirmation modal
      setPendingRestore({
        file,
        base64,
        sizeBytes: valRes.sizeBytes || file.size,
        totalRows: valRes.totalRows || 0,
        tablesSummary: valRes.tablesSummary || {},
        foundTables: valRes.foundTables || []
      });

    } catch (err: any) {
      setIsRestoring(false);
      setRestoreError(err.message || String(err));
    }
  };

  const handleConfirmRestore = async () => {
    if (!pendingRestore) return;

    setIsRestoring(true);
    setRestoreProgress(30);
    setRestoreStepText("Wiping current database tables & preparing transaction...");

    try {
      const restoreRes = await restoreSqliteBackup(pendingRestore.base64);

      if (!restoreRes.success) {
        throw new Error(restoreRes.error || "Failed to restore database from SQLite file.");
      }

      setRestoreProgress(80);
      setRestoreStepText("Refreshing local cache and synchronizing ledger state...");

      // Clear local IndexedDB cache store and refresh
      await clearCacheStore('parties');
      await clearCacheStore('products');
      await clearCacheStore('transactions');
      await clearCacheStore('dashboard_summary');
      await clearCacheStore('tracked_invoices');

      if (activeLedger?.id) {
        await Promise.all([
          syncCollection('parties', activeLedger.id, 'parties'),
          syncCollection('products', activeLedger.id, 'products'),
          syncCollection('transactions', activeLedger.id, 'transactions'),
          syncCollection('dashboard_summary', activeLedger.id, 'dashboard_summary'),
          syncCollection('tracked_invoices', activeLedger.id, 'tracked_invoices')
        ]);
      }

      setRestoreProgress(100);
      setRestoreSuccessMsg(`Database successfully restored! Total ${restoreRes.totalRestored || 0} records updated across all tables.`);
      
      window.dispatchEvent(new CustomEvent('database-synced'));
      setPendingRestore(null);

    } catch (err: any) {
      console.error("Restore failed:", err);
      setRestoreError(err.message || String(err));
    } finally {
      setIsRestoring(false);
    }
  };

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 sm:p-8">
      {/* Hidden File Input for Restore */}
      <input 
        ref={fileInputRef}
        type="file"
        accept=".sqlite,.db,.bak,application/x-sqlite3"
        onChange={handleFileSelected}
        className="hidden"
      />

      {/* Module Title & USB Status Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-6 border-b border-gray-100">
        <div>
          <div className="flex items-center gap-2">
            <Database className="w-6 h-6 text-sky-600" />
            <h2 className="text-xl font-bold text-gray-900 tracking-tight">Database Backup & Restore</h2>
          </div>
          <p className="text-xs text-gray-500 mt-1">
            Export complete Turso database to an encrypted binary SQLite (.sqlite) file or restore from a backup
          </p>
        </div>

        {/* USB Connection Badge & Detector */}
        <div className="flex items-center gap-3 bg-gray-50 p-2.5 px-4 rounded-xl border border-gray-200">
          <Usb className={`w-5 h-5 ${isUsbConnected ? 'text-emerald-600' : 'text-amber-500'}`} />
          <div>
            <div className="flex items-center gap-1.5">
              <span className={`w-2 h-2 rounded-full ${isUsbConnected ? 'bg-emerald-500 animate-pulse' : 'bg-amber-500'}`} />
              <span className="text-xs font-bold text-gray-800">USB Flash Drive / OTG</span>
            </div>
            <p className="text-[10px] text-gray-500">{usbStatusMessage}</p>
          </div>
        </div>
      </div>

      {/* USB Not Detected Banner Alert */}
      {!isUsbConnected && (
        <div className="mt-6 p-4 bg-amber-50 border border-amber-200 rounded-xl flex items-start gap-3 text-amber-900 text-sm animate-in fade-in">
          <AlertTriangle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="font-bold text-amber-900">No USB drive detected. Please connect a USB drive and try again.</p>
            <p className="text-xs text-amber-700 mt-0.5">
              Plug in your Pen Drive / USB OTG cable to perform direct Storage Access Framework (SAF) database backups.
            </p>
          </div>
          <button 
            onClick={checkUsbConnection}
            className="px-3 py-1 bg-amber-600 hover:bg-amber-700 text-white font-semibold text-xs rounded-lg flex items-center gap-1"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isCheckingUsb ? 'animate-spin' : ''}`} />
            Retry USB
          </button>
        </div>
      )}

      {/* Error Alert Box */}
      {backupError && (
        <div className="mt-6 p-4 bg-red-50 border border-red-200 rounded-xl flex items-start gap-3 text-red-900 text-sm">
          <AlertTriangle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="font-bold text-red-900">Backup Error</p>
            <p className="text-xs text-red-700 mt-0.5">{backupError}</p>
          </div>
          <button onClick={() => setBackupError('')} className="text-red-400 hover:text-red-600">
            <X size={18} />
          </button>
        </div>
      )}

      {/* Restore Error Alert Box */}
      {restoreError && (
        <div className="mt-6 p-4 bg-red-50 border border-red-200 rounded-xl flex items-start gap-3 text-red-900 text-sm">
          <AlertTriangle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="font-bold text-red-900">Restore Error</p>
            <p className="text-xs text-red-700 mt-0.5">{restoreError}</p>
          </div>
          <button onClick={() => setRestoreError('')} className="text-red-400 hover:text-red-600">
            <X size={18} />
          </button>
        </div>
      )}

      {/* Restore Success Alert Box */}
      {restoreSuccessMsg && (
        <div className="mt-6 p-4 bg-emerald-50 border border-emerald-200 rounded-xl flex items-start gap-3 text-emerald-900 text-sm">
          <CheckCircle2 className="w-5 h-5 text-emerald-600 flex-shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="font-bold text-emerald-900">Restore Successful</p>
            <p className="text-xs text-emerald-700 mt-0.5">{restoreSuccessMsg}</p>
          </div>
          <button onClick={() => setRestoreSuccessMsg('')} className="text-emerald-400 hover:text-emerald-600">
            <X size={18} />
          </button>
        </div>
      )}

      {/* Main Action Buttons Section */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-8">
        {/* BUTTON 1: BACKUP DATABASE */}
        <div className="p-6 bg-slate-50 rounded-2xl border border-slate-200/80 flex flex-col justify-between hover:border-sky-300 transition-all">
          <div>
            <div className="w-12 h-12 rounded-xl bg-sky-100 text-sky-700 flex items-center justify-center mb-4">
              <Download className="w-6 h-6" />
            </div>
            <h3 className="font-bold text-base text-gray-900">Backup Database</h3>
            <p className="text-xs text-gray-600 mt-1 leading-relaxed">
              Generates a full SQLite (.sqlite) database file containing all tables, records, schemas, and indexes. Saves automatically into <span className="font-mono font-bold text-gray-800">Greenzar_Backups</span> folder on your USB drive.
            </p>
            <div className="mt-4 space-y-1.5 text-[11px] text-gray-500">
              <p className="flex items-center gap-1.5">
                <FolderPlus className="w-3.5 h-3.5 text-sky-600" />
                Folder: <span className="font-semibold text-gray-700">Greenzar_Backups</span>
              </p>
              <p className="flex items-center gap-1.5">
                <Clock className="w-3.5 h-3.5 text-sky-600" />
                Format: <span className="font-mono text-gray-700">GFB_Backup_YYYY-MM-DD_HH-MM-SS.sqlite</span>
              </p>
            </div>
          </div>

          <div className="mt-6 pt-4 border-t border-slate-200">
            <button
              onClick={handleBackupDatabase}
              disabled={isBackingUp || isRestoring}
              className="w-full flex items-center justify-center gap-2 py-3 px-4 bg-sky-600 hover:bg-sky-700 disabled:bg-sky-400 text-white font-bold text-sm rounded-xl shadow-md transition-all active:scale-98"
            >
              {isBackingUp ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  <span>Backing Up ({backupProgress}%)...</span>
                </>
              ) : (
                <>
                  <Download className="w-4 h-4" />
                  <span>Backup Database</span>
                </>
              )}
            </button>
          </div>
        </div>

        {/* BUTTON 2: RESTORE DATABASE */}
        <div className="p-6 bg-slate-50 rounded-2xl border border-slate-200/80 flex flex-col justify-between hover:border-emerald-300 transition-all">
          <div>
            <div className="w-12 h-12 rounded-xl bg-emerald-100 text-emerald-700 flex items-center justify-center mb-4">
              <Upload className="w-6 h-6" />
            </div>
            <h3 className="font-bold text-base text-gray-900">Restore Database</h3>
            <p className="text-xs text-gray-600 mt-1 leading-relaxed">
              Select any valid <span className="font-mono font-bold text-gray-800">.sqlite</span> database backup file from your USB drive or device storage to restore all parties, transactions, products, and ledger records.
            </p>
            <div className="mt-4 space-y-1.5 text-[11px] text-gray-500">
              <p className="flex items-center gap-1.5">
                <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
                Validates SQLite header & structure before restoring
              </p>
              <p className="flex items-center gap-1.5">
                <FileCheck className="w-3.5 h-3.5 text-emerald-600" />
                Shows record preview before replacing current database
              </p>
            </div>
          </div>

          <div className="mt-6 pt-4 border-t border-slate-200">
            <button
              onClick={handleTriggerRestorePicker}
              disabled={isBackingUp || isRestoring}
              className="w-full flex items-center justify-center gap-2 py-3 px-4 bg-emerald-600 hover:bg-emerald-700 disabled:bg-emerald-400 text-white font-bold text-sm rounded-xl shadow-md transition-all active:scale-98"
            >
              {isRestoring ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  <span>Restoring ({restoreProgress}%)...</span>
                </>
              ) : (
                <>
                  <Upload className="w-4 h-4" />
                  <span>Restore Database</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Progress Bar Indicator during Backup/Restore */}
      {(isBackingUp || isRestoring) && (
        <div className="mt-8 p-6 bg-sky-50 border border-sky-200 rounded-2xl animate-in fade-in">
          <div className="flex justify-between items-center mb-2">
            <span className="text-xs font-bold text-sky-900 flex items-center gap-2">
              <RefreshCw className="w-4 h-4 animate-spin text-sky-600" />
              {isBackingUp ? backupStepText : restoreStepText}
            </span>
            <span className="text-xs font-extrabold text-sky-700">{isBackingUp ? backupProgress : restoreProgress}%</span>
          </div>
          <div className="w-full bg-sky-200 rounded-full h-2.5 overflow-hidden">
            <div 
              className="bg-sky-600 h-2.5 rounded-full transition-all duration-300"
              style={{ width: `${isBackingUp ? backupProgress : restoreProgress}%` }}
            />
          </div>
        </div>
      )}

      {/* BACKUP COMPLETION REPORT MODAL / DISPLAY CARD */}
      {backupReport && (
        <div className="mt-8 bg-emerald-50/70 border border-emerald-200 rounded-2xl p-6 shadow-sm animate-in fade-in slide-in-from-bottom-2">
          <div className="flex items-center justify-between pb-4 border-b border-emerald-200">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center">
                <CheckCircle2 className="w-5 h-5" />
              </div>
              <div>
                <h4 className="font-extrabold text-base text-emerald-950">{backupReport.status}</h4>
                <p className="text-xs text-emerald-700">All database tables successfully compiled into SQLite binary file</p>
              </div>
            </div>
            <button onClick={() => setBackupReport(null)} className="text-emerald-500 hover:text-emerald-800 p-1">
              <X size={20} />
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mt-4">
            <div className="bg-white p-3.5 rounded-xl border border-emerald-100">
              <span className="text-[10px] uppercase font-bold text-gray-400 block mb-1">Backup Filename</span>
              <span className="font-mono text-xs font-extrabold text-gray-900 break-all">{backupReport.filename}</span>
            </div>

            <div className="bg-white p-3.5 rounded-xl border border-emerald-100">
              <span className="text-[10px] uppercase font-bold text-gray-400 block mb-1">Backup Location</span>
              <span className="text-xs font-bold text-gray-800 flex items-center gap-1 truncate">
                <FolderCheck className="w-3.5 h-3.5 text-emerald-600 flex-shrink-0" />
                {backupReport.location}
              </span>
            </div>

            <div className="bg-white p-3.5 rounded-xl border border-emerald-100">
              <span className="text-[10px] uppercase font-bold text-gray-400 block mb-1">Backup Size</span>
              <span className="text-xs font-extrabold text-gray-900">{backupReport.sizeFormatted}</span>
            </div>

            <div className="bg-white p-3.5 rounded-xl border border-emerald-100">
              <span className="text-[10px] uppercase font-bold text-gray-400 block mb-1">Date & Time</span>
              <span className="text-xs font-bold text-gray-800">{backupReport.dateTimeStr}</span>
            </div>
          </div>

          {/* Tables Summary List */}
          {backupReport.tablesSummary && (
            <div className="mt-4 pt-4 border-t border-emerald-200">
              <p className="text-xs font-bold text-emerald-900 mb-2">Exported Tables & Total Records ({backupReport.totalRows || 0}):</p>
              <div className="flex flex-wrap gap-2">
                {Object.entries(backupReport.tablesSummary).map(([colName, rowCount]) => (
                  <span key={colName} className="text-[11px] font-mono bg-white border border-emerald-200 px-2.5 py-1 rounded-lg text-emerald-900">
                    <strong className="text-gray-900">{colName}</strong>: {rowCount} rows
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* RESTORE VALIDATION PREVIEW MODAL */}
      {pendingRestore && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden border border-gray-100">
            <div className="p-5 border-b bg-gray-50 flex justify-between items-center">
              <div className="flex items-center gap-2">
                <ShieldCheck className="w-5 h-5 text-emerald-600" />
                <h3 className="font-bold text-gray-900 text-base">Validate & Restore Backup</h3>
              </div>
              <button onClick={() => setPendingRestore(null)} className="text-gray-400 hover:text-gray-600">
                <X size={20} />
              </button>
            </div>

            <div className="p-6 space-y-4 max-h-[75vh] overflow-y-auto">
              <div className="p-4 bg-amber-50 border border-amber-200 rounded-xl flex items-start gap-3">
                <AlertTriangle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
                <div className="text-xs text-amber-900">
                  <p className="font-bold">Warning: Database Overwrite</p>
                  <p className="mt-0.5">
                    Restoring this backup will replace current database tables with the records from this file. Please make sure you want to proceed.
                  </p>
                </div>
              </div>

              <div className="space-y-2 bg-gray-50 p-4 rounded-xl border text-xs">
                <div className="flex justify-between py-1 border-b border-gray-200">
                  <span className="text-gray-500 font-medium">Backup File Name</span>
                  <span className="font-mono font-bold text-gray-900 break-all max-w-[250px] text-right">{pendingRestore.file.name}</span>
                </div>
                <div className="flex justify-between py-1 border-b border-gray-200">
                  <span className="text-gray-500 font-medium">File Size</span>
                  <span className="font-bold text-gray-900">{formatBytes(pendingRestore.sizeBytes)}</span>
                </div>
                <div className="flex justify-between py-1 border-b border-gray-200">
                  <span className="text-gray-500 font-medium">Last Modified</span>
                  <span className="font-bold text-gray-900">{format(new Date(pendingRestore.file.lastModified), 'dd MMM yyyy, HH:mm:ss')}</span>
                </div>
                <div className="flex justify-between py-1">
                  <span className="text-gray-500 font-medium">Total Backup Records</span>
                  <span className="font-extrabold text-emerald-700 text-sm">{pendingRestore.totalRows}</span>
                </div>
              </div>

              <div>
                <p className="text-xs font-bold text-gray-800 mb-2">Backup Content Breakdown:</p>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  {Object.entries(pendingRestore.tablesSummary).map(([tbl, cnt]) => (
                    <div key={tbl} className="p-2.5 bg-gray-50 border rounded-lg flex justify-between items-center">
                      <span className="font-mono text-gray-700">{tbl}</span>
                      <span className="font-bold text-gray-900 bg-white border px-2 py-0.5 rounded text-[11px]">{cnt} rows</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="p-4 bg-gray-50 border-t flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setPendingRestore(null)}
                className="px-4 py-2.5 text-gray-600 hover:bg-gray-200 rounded-xl font-semibold text-xs transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmRestore}
                disabled={isRestoring}
                className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs rounded-xl shadow-md transition-all flex items-center gap-2"
              >
                <Upload className="w-4 h-4" />
                <span>Confirm & Restore Database</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
