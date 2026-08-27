import React, { useState, useRef } from 'react';
import { 
  X, 
  Upload, 
  FileSpreadsheet, 
  Download, 
  CheckCircle, 
  AlertCircle, 
  Loader2, 
  ArrowRight,
  FileText,
  Trash2,
  HelpCircle,
  ArrowDownUp
} from 'lucide-react';
import * as XLSX from 'xlsx';
import Papa from 'papaparse';
import { v4 as uuidv4 } from 'uuid';
import { db, doc, setDoc } from '../firebase';
import { Party } from '../types';
import { setCacheItem } from '../lib/idbCache';
import { updateDashboardPartiesCount } from '../lib/transactionService';
import { formatContactWith91 } from '../lib/phoneUtils';

interface BulkImportPartiesModalProps {
  isOpen: boolean;
  onClose: () => void;
  ledgerId: string;
  ledgerName: string;
  ledgerType?: string;
  existingParties: Party[];
  onSuccess: (importedCount: number) => void;
}

interface RawImportRow {
  name: string;
  address: string;
  phone: string;
  rawAmount: number;
  email: string;
  isValid: boolean;
  isDuplicate?: boolean;
}

export default function BulkImportPartiesModal({
  isOpen,
  onClose,
  ledgerId,
  ledgerName,
  ledgerType,
  existingParties,
  onSuccess
}: BulkImportPartiesModalProps) {
  const [activeTab, setActiveTab] = useState<'upload' | 'paste'>('upload');
  const [file, setFile] = useState<File | null>(null);
  const [pastedText, setPastedText] = useState('');
  const [isDragging, setIsDragging] = useState(false);
  const [rawRows, setRawRows] = useState<RawImportRow[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  
  // Balance interpretation mode:
  // 'user_mode': Negative (-123) is Due, Positive (+123) is Advance
  // 'standard_mode': Positive (+123) is Due, Negative (-123) is Advance
  const [amountMode, setAmountMode] = useState<'user_mode' | 'standard_mode'>('user_mode');
  const [duplicateAction, setDuplicateAction] = useState<'skip' | 'update' | 'import_all'>('skip');
  const fileInputRef = useRef<HTMLInputElement>(null);

  if (!isOpen) return null;

  const existingNamesSet = new Set(existingParties.map(p => (p.name || '').trim().toLowerCase()));

  // Process raw tabular rows
  const processRawData = (rows: any[][]) => {
    setErrorMsg(null);
    if (!rows || rows.length === 0) {
      setRawRows([]);
      return;
    }

    // Default column mapping according to user request:
    // Col 0: Name, Col 1: Address, Col 2: Contact, Col 3: Due/Advance Amount, Col 4: Email
    let startIndex = 0;
    let colMap = {
      name: 0,
      address: 1,
      phone: 2,
      amount: 3,
      email: 4
    };

    const firstRowStr = rows[0].map(c => String(c || '').toLowerCase().trim());
    const hasHeader = firstRowStr.some(c => 
      c.includes('name') || c.includes('party') || c.includes('vendor') || 
      c.includes('address') || c.includes('city') || c.includes('location') ||
      c.includes('phone') || c.includes('contact') || c.includes('mobile') || 
      c.includes('due') || c.includes('advance') || c.includes('amount') || c.includes('balance') || 
      c.includes('email') || c.includes('mail')
    );

    if (hasHeader) {
      startIndex = 1;
      let nameIdx = -1;
      let addrIdx = -1;
      let phoneIdx = -1;
      let amountIdx = -1;
      let emailIdx = -1;

      firstRowStr.forEach((header, idx) => {
        if (header.includes('name') || header.includes('party') || header.includes('vendor') || header.includes('account')) {
          nameIdx = idx;
        } else if (header.includes('address') || header.includes('city') || header.includes('location') || header.includes('addr')) {
          addrIdx = idx;
        } else if (header.includes('phone') || header.includes('contact') || header.includes('mobile') || header.includes('number')) {
          phoneIdx = idx;
        } else if (header.includes('due') || header.includes('advance') || header.includes('amount') || header.includes('balance') || header.includes('opening')) {
          amountIdx = idx;
        } else if (header.includes('email') || header.includes('mail')) {
          emailIdx = idx;
        }
      });

      if (nameIdx !== -1) colMap.name = nameIdx;
      if (addrIdx !== -1) colMap.address = addrIdx;
      if (phoneIdx !== -1) colMap.phone = phoneIdx;
      if (amountIdx !== -1) colMap.amount = amountIdx;
      if (emailIdx !== -1) colMap.email = emailIdx;
    } else {
      // If no explicit header row, check if column 1 looks like a phone number and column 2 looks like an address
      const sampleRow = rows[0];
      const col1 = String(sampleRow[1] || '').trim();
      const col2 = String(sampleRow[2] || '').trim();
      const isCol1Phone = /^\+?[0-9\s-]{7,15}$/.test(col1.replace(/[^0-9+]/g, ''));
      const isCol2Phone = /^\+?[0-9\s-]{7,15}$/.test(col2.replace(/[^0-9+]/g, ''));

      if (isCol1Phone && !isCol2Phone) {
        // [Name, Phone, Address/Balance...]
        colMap = { name: 0, phone: 1, address: 2, amount: 3, email: 4 };
      } else {
        // Default requested format: [Name, Address, Contact, Amount, Email]
        colMap = { name: 0, address: 1, phone: 2, amount: 3, email: 4 };
      }
    }

    const results: RawImportRow[] = [];

    for (let i = startIndex; i < rows.length; i++) {
      const row = rows[i];
      if (!row || row.length === 0) continue;
      
      const rawName = String(row[colMap.name] !== undefined ? row[colMap.name] : (row[0] || '')).trim();
      if (!rawName) continue; // skip empty rows

      const rawAddress = String(row[colMap.address] !== undefined ? row[colMap.address] : (row[1] || '')).trim();
      const rawPhone = String(row[colMap.phone] !== undefined ? row[colMap.phone] : (row[2] || '')).trim();
      const rawAmountVal = row[colMap.amount] !== undefined ? row[colMap.amount] : (row[3] || '0');
      const rawEmail = String(row[colMap.email] !== undefined ? row[colMap.email] : (row[4] || '')).trim();

      // Clean amount
      let numAmount = 0;
      if (typeof rawAmountVal === 'number') {
        numAmount = rawAmountVal;
      } else {
        const cleanStr = String(rawAmountVal).trim();
        const isNeg = cleanStr.startsWith('-') || cleanStr.includes('(') || cleanStr.toLowerCase().includes('due') || cleanStr.toLowerCase().includes('dr');
        const cleanBal = cleanStr.replace(/[^0-9.]/g, '');
        numAmount = parseFloat(cleanBal) || 0;
        if (isNeg && numAmount > 0) {
          numAmount = -numAmount;
        }
      }

      const isDup = existingNamesSet.has(rawName.toLowerCase());

      results.push({
        name: rawName,
        address: rawAddress,
        phone: formatContactWith91(rawPhone),
        rawAmount: numAmount,
        email: rawEmail,
        isValid: rawName.length > 0,
        isDuplicate: isDup
      });
    }

    setRawRows(results);
    if (results.length === 0) {
      setErrorMsg("No valid party rows could be found. Please ensure at least the 'Party Name' column is populated.");
    }
  };

  // Convert rawAmount into the app's internal openingBalance / currentDue
  // In the app: positive currentDue = Due (Receivable), negative currentDue = Advance (Payable)
  const computeSystemBalance = (rawAmount: number): number => {
    if (rawAmount === 0) return 0;
    if (amountMode === 'user_mode') {
      // User format: -123 means Due (+123 in system), +123 means Advance (-123 in system)
      return -rawAmount;
    } else {
      // Standard format: +123 means Due (+123 in system), -123 means Advance (-123 in system)
      return rawAmount;
    }
  };

  // Handle file drop / select
  const handleFileChange = async (selectedFile: File) => {
    setFile(selectedFile);
    setIsProcessing(true);
    setErrorMsg(null);

    const fileName = selectedFile.name.toLowerCase();

    try {
      if (fileName.endsWith('.xlsx') || fileName.endsWith('.xls')) {
        const data = await selectedFile.arrayBuffer();
        const workbook = XLSX.read(data, { type: 'array' });
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 }) as any[][];
        processRawData(jsonData);
      } else {
        const text = await selectedFile.text();
        Papa.parse(text, {
          skipEmptyLines: true,
          complete: (results) => {
            processRawData(results.data as any[][]);
          },
          error: (error: any) => {
            setErrorMsg(`CSV parsing error: ${error.message}`);
          }
        });
      }
    } catch (err: any) {
      console.error("File processing error:", err);
      setErrorMsg(`Failed to read file: ${err.message || 'Unknown error'}`);
    } finally {
      setIsProcessing(false);
    }
  };

  // Handle pasted text parsing
  const handleParsePastedText = () => {
    if (!pastedText.trim()) {
      setErrorMsg("Please paste some CSV or spreadsheet data first.");
      return;
    }

    setIsProcessing(true);
    try {
      Papa.parse(pastedText, {
        skipEmptyLines: true,
        complete: (results) => {
          processRawData(results.data as any[][]);
        },
        error: (error: any) => {
          setErrorMsg(`Text parsing error: ${error.message}`);
        }
      });
    } catch (err: any) {
      setErrorMsg(`Failed to parse text: ${err.message || 'Unknown error'}`);
    } finally {
      setIsProcessing(false);
    }
  };

  // Download Sample Template with exact requested columns: [Party Name, Address, Contact Number, Due / Advance Amount, Email]
  const handleDownloadSample = () => {
    const isPurch = ledgerType === 'PURCHASE';
    const sampleHeaders = ['Party Name', 'Address', 'Contact Number', 'Due or Advance Amount', 'Email'];
    const sampleData = isPurch ? [
      ['Apex Raw Materials Ltd', '12 Industrial Area, Sector 4', '9876543210', '-25000', 'sales@apexraw.com'],
      ['Supreme Packaging Co', 'Plot 45, Okhla Phase 2', '9811223344', '12500', 'orders@supremepack.com'],
      ['Global Logistics & Freight', 'Ring Road Cargo Terminal', '9988776655', '0', 'billing@globallogistics.in']
    ] : [
      ['Metro Retailers & Sons', 'Shop 104, Main Market', '9876543210', '-15000', 'accounts@metroretail.com'],
      ['Sunrise Enterprises', '42 Commercial Complex', '9812345678', '5000', 'info@sunriseent.com'],
      ['Modern Supermart', 'Ground Floor, City Mall', '9944556677', '0', 'purchase@modernmart.in']
    ];

    const csvContent = [
      sampleHeaders.join(','),
      ...sampleData.map(row => row.map(cell => `"${cell}"`).join(','))
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `${isPurch ? 'purchase_suppliers_template' : 'parties_import_template'}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Perform Final Bulk Import
  const handleExecuteImport = async () => {
    if (rawRows.length === 0 || isImporting) return;
    setIsImporting(true);
    setErrorMsg(null);

    try {
      const partiesToCreate: Party[] = [];

      for (const row of rawRows) {
        if (!row.isValid) continue;

        const systemBalance = computeSystemBalance(row.rawAmount);

        if (row.isDuplicate) {
          if (duplicateAction === 'skip') {
            continue;
          }
          if (duplicateAction === 'update') {
            const match = existingParties.find(p => p.name.trim().toLowerCase() === row.name.trim().toLowerCase());
            if (match) {
              const updatedParty: Party = {
                ...match,
                phone: row.phone || match.phone,
                address: row.address || match.address,
                email: row.email || match.email,
                openingBalance: systemBalance !== 0 ? systemBalance : match.openingBalance,
                currentDue: systemBalance !== 0 ? systemBalance : match.currentDue
              };
              await setDoc(doc(db, 'parties', match.id), updatedParty);
              await setCacheItem<Party>('parties', updatedParty);
              continue;
            }
          }
        }

        // Create new party
        const newId = uuidv4();
        const newParty: Party = {
          id: newId,
          ledgerId: ledgerId,
          name: row.name.trim(),
          address: row.address,
          phone: row.phone,
          email: row.email,
          openingBalance: systemBalance,
          currentDue: systemBalance,
          lastTransaction: Date.now(),
          status: 'Active'
        };

        partiesToCreate.push(newParty);
        await setDoc(doc(db, 'parties', newId), newParty);
        await setCacheItem<Party>('parties', newParty);
      }

      if (partiesToCreate.length > 0) {
        await updateDashboardPartiesCount(ledgerId, partiesToCreate.length);
      }

      window.dispatchEvent(new CustomEvent('database-synced'));
      onSuccess(partiesToCreate.length);
      onClose();
    } catch (err: any) {
      console.error("Failed to execute bulk import:", err);
      setErrorMsg(`Import failed: ${err.message || 'Unknown database error'}`);
    } finally {
      setIsImporting(false);
    }
  };

  const validCount = rawRows.filter(r => r.isValid).length;
  const dupCount = rawRows.filter(r => r.isDuplicate).length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-200">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl border border-slate-200 overflow-hidden flex flex-col max-h-[92vh]">
        
        {/* Modal Header */}
        <div className="px-5 sm:px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/80 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-blue-100 text-blue-700 flex items-center justify-center shadow-2xs font-bold">
              <FileSpreadsheet size={20} />
            </div>
            <div>
              <h2 className="text-base sm:text-lg font-bold text-slate-900 tracking-tight">
                Bulk Import Parties & Contacts
              </h2>
              <p className="text-xs text-slate-500 font-medium">
                Importing into <span className="font-semibold text-slate-700">{ledgerName}</span>
              </p>
            </div>
          </div>
          <button 
            type="button" 
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-200/60 rounded-lg transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-5 sm:p-6 overflow-y-auto space-y-5 flex-1">

          {/* Action Tabs & Template Download */}
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-3">
            <div className="flex items-center gap-1.5 p-1 bg-slate-100 rounded-xl">
              <button
                type="button"
                onClick={() => setActiveTab('upload')}
                className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition flex items-center gap-1.5 ${
                  activeTab === 'upload'
                    ? 'bg-white text-blue-700 shadow-2xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <Upload size={14} />
                <span>Upload CSV / Excel File</span>
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('paste')}
                className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition flex items-center gap-1.5 ${
                  activeTab === 'paste'
                    ? 'bg-white text-blue-700 shadow-2xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <FileText size={14} />
                <span>Paste Text / Rows</span>
              </button>
            </div>

            <button
              type="button"
              onClick={handleDownloadSample}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-blue-700 hover:text-blue-800 bg-blue-50 hover:bg-blue-100/80 rounded-xl transition border border-blue-200/60"
              title="Download CSV template matching your exact columns"
            >
              <Download size={13} />
              <span>Download Sample CSV Template</span>
            </button>
          </div>

          {/* Column Format Indicator */}
          <div className="p-3 bg-slate-50 border border-slate-200/80 rounded-xl text-xs space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="font-bold text-slate-800">Standard Column Order:</span>
              <span className="text-[11px] text-blue-700 font-semibold bg-blue-50 px-2 py-0.5 rounded-md border border-blue-200/60">
                1. Name → 2. Address → 3. Contact → 4. Due/Advance Amount
              </span>
            </div>
            <div className="flex flex-wrap gap-1.5 font-mono text-[11px]">
              <span className="bg-white px-2 py-0.5 rounded border border-slate-200 text-slate-700">Column A: <strong>Party Name</strong></span>
              <span className="bg-white px-2 py-0.5 rounded border border-slate-200 text-slate-700">Column B: <strong>Address</strong></span>
              <span className="bg-white px-2 py-0.5 rounded border border-slate-200 text-slate-700">Column C: <strong>Contact Number</strong></span>
              <span className="bg-white px-2 py-0.5 rounded border border-slate-200 text-slate-700">Column D: <strong>Due / Advance (-123 or +123)</strong></span>
            </div>
          </div>

          {/* Error Message */}
          {errorMsg && (
            <div className="p-3.5 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-800 flex items-start gap-2.5 animate-in fade-in">
              <AlertCircle size={16} className="shrink-0 mt-0.5 text-rose-600" />
              <div className="flex-1">{errorMsg}</div>
            </div>
          )}

          {/* Tab 1: Upload File */}
          {activeTab === 'upload' && (
            <div className="space-y-3">
              <div
                onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setIsDragging(false);
                  if (e.dataTransfer.files && e.dataTransfer.files[0]) {
                    handleFileChange(e.dataTransfer.files[0]);
                  }
                }}
                onClick={() => fileInputRef.current?.click()}
                className={`border-2 border-dashed rounded-2xl p-6 sm:p-8 text-center cursor-pointer transition-all duration-150 flex flex-col items-center justify-center gap-3 ${
                  isDragging
                    ? 'border-blue-600 bg-blue-50/50 scale-[0.99]'
                    : file
                    ? 'border-emerald-300 bg-emerald-50/30 hover:bg-emerald-50/50'
                    : 'border-slate-300 bg-slate-50/50 hover:bg-slate-100/60 hover:border-slate-400'
                }`}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".csv,.xlsx,.xls,.txt,.tsv"
                  className="hidden"
                  onChange={(e) => {
                    if (e.target.files && e.target.files[0]) {
                      handleFileChange(e.target.files[0]);
                    }
                  }}
                />

                <div className={`w-12 h-12 rounded-2xl flex items-center justify-center font-bold ${
                  file ? 'bg-emerald-100 text-emerald-700' : 'bg-blue-50 text-blue-600'
                }`}>
                  {isProcessing ? (
                    <Loader2 size={24} className="animate-spin text-blue-600" />
                  ) : file ? (
                    <FileSpreadsheet size={24} />
                  ) : (
                    <Upload size={24} />
                  )}
                </div>

                <div className="space-y-1">
                  <p className="text-sm font-bold text-slate-800">
                    {file ? file.name : "Click to select or drag & drop CSV or Excel file"}
                  </p>
                  <p className="text-xs text-slate-500 font-medium">
                    Supports <span className="font-semibold text-slate-700">.csv, .xlsx, .xls</span> format
                  </p>
                </div>

                {file && (
                  <div className="flex items-center gap-2 mt-1">
                    <span className="text-[11px] px-2.5 py-0.5 rounded-full bg-emerald-100 text-emerald-800 font-semibold">
                      {(file.size / 1024).toFixed(1)} KB
                    </span>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setFile(null);
                        setRawRows([]);
                        if (fileInputRef.current) fileInputRef.current.value = '';
                      }}
                      className="text-xs text-rose-600 hover:text-rose-800 p-1 flex items-center gap-1 font-medium"
                    >
                      <Trash2 size={12} />
                      Remove
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Tab 2: Paste Text */}
          {activeTab === 'paste' && (
            <div className="space-y-3">
              <div className="space-y-1">
                <label className="block text-xs font-bold text-slate-700">
                  Paste rows directly (CSV or copied from Excel / Google Sheets):
                </label>
                <p className="text-[11px] text-slate-500 font-medium">
                  Format: <code className="bg-slate-100 px-1 py-0.5 rounded font-mono text-slate-700">Party Name, Address, Contact Number, Due/Advance (-123 or 123)</code>
                </p>
              </div>

              <textarea
                rows={5}
                value={pastedText}
                onChange={(e) => setPastedText(e.target.value)}
                placeholder={`Apex Retailers, 104 Main Street Sector 2, 9876543210, -15000\nMetro Traders, Ring Road Complex, 9811223344, 5000\nCity Distributors, Phase 2 Industrial Area, 9988776655, 0`}
                className="w-full p-3 bg-slate-50 border border-slate-300 rounded-xl text-xs font-mono text-slate-900 focus:bg-white focus:border-blue-600 focus:outline-none transition resize-y"
              />

              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={handleParsePastedText}
                  disabled={isProcessing || !pastedText.trim()}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 text-white text-xs font-bold rounded-xl shadow-2xs transition flex items-center gap-1.5"
                >
                  {isProcessing ? <Loader2 size={14} className="animate-spin" /> : <ArrowRight size={14} />}
                  <span>Parse Rows</span>
                </button>
              </div>
            </div>
          )}

          {/* Amount / Balance Sign Rule Toggle */}
          <div className="p-3.5 bg-blue-50/50 border border-blue-100 rounded-xl space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5 font-bold text-xs text-slate-800">
                <ArrowDownUp size={14} className="text-blue-600" />
                <span>Amount Format / Balance Rule</span>
              </div>
              <span className="text-[11px] text-slate-500 font-medium">Click to change balance interpretation</span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <label 
                className={`p-2.5 rounded-xl border text-xs cursor-pointer flex items-start gap-2 transition ${
                  amountMode === 'user_mode'
                    ? 'bg-white border-blue-500 ring-2 ring-blue-500/20 text-slate-900 shadow-2xs'
                    : 'bg-white/60 border-slate-200 text-slate-600 hover:bg-white'
                }`}
              >
                <input
                  type="radio"
                  name="amountMode"
                  checked={amountMode === 'user_mode'}
                  onChange={() => setAmountMode('user_mode')}
                  className="mt-0.5 text-blue-600 focus:ring-blue-500"
                />
                <div>
                  <p className="font-bold text-slate-800">Your Format (Negative = Due, Positive = Advance)</p>
                  <p className="text-[11px] text-slate-500 mt-0.5">
                    <code>-123</code> is parsed as <strong>₹123 Due</strong>, <code>+123</code> as <strong>₹123 Advance</strong>.
                  </p>
                </div>
              </label>

              <label 
                className={`p-2.5 rounded-xl border text-xs cursor-pointer flex items-start gap-2 transition ${
                  amountMode === 'standard_mode'
                    ? 'bg-white border-blue-500 ring-2 ring-blue-500/20 text-slate-900 shadow-2xs'
                    : 'bg-white/60 border-slate-200 text-slate-600 hover:bg-white'
                }`}
              >
                <input
                  type="radio"
                  name="amountMode"
                  checked={amountMode === 'standard_mode'}
                  onChange={() => setAmountMode('standard_mode')}
                  className="mt-0.5 text-blue-600 focus:ring-blue-500"
                />
                <div>
                  <p className="font-bold text-slate-800">Standard / Direct (Positive = Due, Negative = Advance)</p>
                  <p className="text-[11px] text-slate-500 mt-0.5">
                    <code>+123</code> is parsed as <strong>₹123 Due</strong>, <code>-123</code> as <strong>₹123 Advance</strong>.
                  </p>
                </div>
              </label>
            </div>
          </div>

          {/* Preview & Confirmation Section */}
          {rawRows.length > 0 && (
            <div className="space-y-3 pt-2 border-t border-slate-100">
              
              {/* Summary Bar */}
              <div className="flex flex-wrap items-center justify-between gap-2 p-3 bg-slate-50 border border-slate-200 rounded-xl text-xs">
                <div className="flex items-center gap-2 text-slate-900 font-semibold">
                  <CheckCircle size={16} className="text-emerald-600" />
                  <span>Ready to import: <strong>{validCount}</strong> parties detected</span>
                  {dupCount > 0 && (
                    <span className="text-amber-700 font-medium">({dupCount} already exist)</span>
                  )}
                </div>

                {dupCount > 0 && (
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] text-slate-600 font-medium">Duplicates:</span>
                    <select
                      value={duplicateAction}
                      onChange={(e) => setDuplicateAction(e.target.value as any)}
                      className="px-2 py-1 bg-white border border-slate-300 rounded-lg text-xs font-medium text-slate-700 focus:outline-none focus:border-blue-500"
                    >
                      <option value="skip">Skip existing</option>
                      <option value="update">Update contact/balance</option>
                      <option value="import_all">Create duplicates</option>
                    </select>
                  </div>
                )}
              </div>

              {/* Data Preview Table */}
              <div className="border border-slate-200 rounded-xl overflow-hidden shadow-2xs max-h-56 overflow-y-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead className="bg-slate-50 sticky top-0 border-b border-slate-200 text-slate-600 font-bold uppercase text-[10px] tracking-wider">
                    <tr>
                      <th className="p-2.5">#</th>
                      <th className="p-2.5">Party Name</th>
                      <th className="p-2.5">Address</th>
                      <th className="p-2.5">Contact Number</th>
                      <th className="p-2.5">Parsed Amount & Type</th>
                      <th className="p-2.5 text-center">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 bg-white">
                    {rawRows.slice(0, 50).map((row, idx) => {
                      const sysBal = computeSystemBalance(row.rawAmount);
                      const isDue = sysBal > 0;
                      const isAdv = sysBal < 0;
                      const absAmount = Math.abs(sysBal);

                      return (
                        <tr key={idx} className="hover:bg-slate-50/80 transition-colors">
                          <td className="p-2.5 text-slate-400 font-mono text-[11px]">{idx + 1}</td>
                          <td className="p-2.5 font-bold text-slate-800">{row.name}</td>
                          <td className="p-2.5 text-slate-600 truncate max-w-[130px]">{row.address || '—'}</td>
                          <td className="p-2.5 font-mono text-slate-600">{row.phone || '—'}</td>
                          <td className="p-2.5">
                            {isDue ? (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-rose-50 text-rose-700 font-mono font-bold text-[11px] border border-rose-200/60">
                                <span>₹{absAmount.toLocaleString('en-IN')}</span>
                                <span className="text-[9px] uppercase font-sans font-extrabold bg-rose-600 text-white px-1 rounded">Due</span>
                              </span>
                            ) : isAdv ? (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 font-mono font-bold text-[11px] border border-emerald-200/60">
                                <span>₹{absAmount.toLocaleString('en-IN')}</span>
                                <span className="text-[9px] uppercase font-sans font-extrabold bg-emerald-600 text-white px-1 rounded">Advance</span>
                              </span>
                            ) : (
                              <span className="font-mono text-slate-500 font-medium">₹0 (Settled)</span>
                            )}
                          </td>
                          <td className="p-2.5 text-center">
                            {row.isDuplicate ? (
                              <span className="px-2 py-0.5 bg-amber-100 text-amber-800 text-[10px] font-bold rounded-full">
                                Exists
                              </span>
                            ) : (
                              <span className="px-2 py-0.5 bg-emerald-100 text-emerald-800 text-[10px] font-bold rounded-full">
                                New
                              </span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {rawRows.length > 50 && (
                <p className="text-[11px] text-center text-slate-400 font-medium">
                  Showing first 50 of {rawRows.length} total detected records.
                </p>
              )}
            </div>
          )}

          {/* Quick Guidance Box */}
          <div className="p-3.5 bg-slate-50 rounded-xl border border-slate-200 text-xs text-slate-600 space-y-1.5">
            <div className="flex items-center gap-1.5 font-bold text-slate-800">
              <HelpCircle size={14} className="text-blue-600" />
              <span>Import Highlights</span>
            </div>
            <ul className="list-disc list-inside text-[11px] text-slate-500 space-y-0.5 pl-1">
              <li>Columns: <code>Party Name</code>, <code>Address</code>, <code>Contact Number</code>, <code>Due/Advance Amount</code>.</li>
              <li>Negative numbers (e.g., <code>-15000</code>) are automatically recognized as <strong>Due / Receivable</strong>.</li>
              <li>Positive numbers (e.g., <code>5000</code>) are automatically recognized as <strong>Advance / Payable</strong>.</li>
              <li>All phone numbers are automatically formatted with country code <code>+91</code>.</li>
            </ul>
          </div>

        </div>

        {/* Modal Footer */}
        <div className="px-5 sm:px-6 py-3.5 border-t border-slate-100 bg-slate-50/80 flex items-center justify-between shrink-0">
          <button 
            type="button" 
            disabled={isImporting} 
            onClick={onClose} 
            className="px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-200/60 rounded-xl transition-colors"
          >
            Cancel
          </button>

          <button 
            type="button" 
            disabled={isImporting || rawRows.length === 0} 
            onClick={handleExecuteImport} 
            className="px-5 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 text-white text-xs font-bold rounded-xl shadow-xs transition-colors flex items-center gap-2"
          >
            {isImporting ? (
              <>
                <Loader2 className="animate-spin" size={14} />
                <span>Importing {validCount} Parties...</span>
              </>
            ) : (
              <>
                <Upload size={14} />
                <span>Import {validCount > 0 ? `${validCount} Parties Now` : 'Parties'}</span>
              </>
            )}
          </button>
        </div>

      </div>
    </div>
  );
}
