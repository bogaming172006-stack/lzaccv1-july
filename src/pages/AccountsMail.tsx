import React, { useState, useEffect } from 'react';
import { 
  RefreshCw, 
  FileSpreadsheet, 
  Loader2, 
  AlertCircle, 
  CheckCircle, 
  CloudLightning,
  Settings,
  FileKey,
  ExternalLink,
  Users,
  Mail,
  Activity,
  Play,
  UserPlus,
  Download
} from 'lucide-react';
import { useLedger } from '../LedgerContext';
import { useAuth } from '../AuthContext';
import { getFilteredCacheItems, setCacheItem } from '../lib/idbCache';
import { syncCollection } from '../lib/syncCache';
import { Party, Transaction } from '../types';
import { db, setDoc, doc } from '../firebase';
import { updateDashboardPartiesCount } from '../lib/transactionService';
import { v4 as uuidv4 } from 'uuid';
import { formatContactWith91 } from '../lib/phoneUtils';

const extractSpreadsheetId = (input: string | null): string => {
  const trimmed = (input || '').trim();
  const match = trimmed.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (match && match[1]) {
    return match[1];
  }
  return trimmed;
};

const APPS_SCRIPT_CODE = `function doGet(e) {
  // Gracefully handle manual "Run" triggers in Google Apps Script editor where 'e' is undefined
  if (!e || !e.parameter) {
    initializeSheetWithHeaders();
    return ContentService.createTextOutput(JSON.stringify({
      status: "info",
      message: "The Apps Script is active and working! Google Sheets headers have been verified/created. Please avoid clicking 'Run' manually in the script editor. To connect this script to your ledger app, click 'Deploy' -> 'New deployment', select 'Web app', set who has access to 'Anyone', and paste the Web App URL into your Ledger configuration!"
    })).setMimeType(ContentService.MimeType.JSON);
  }

  // Handle diagnostic version ping
  if (e.parameter.action === "ping") {
    return ContentService.createTextOutput(JSON.stringify({
      status: "success",
      version: "1.6",
      capabilities: ["preserve_custom_columns", "in_place_row_mapping", "non_destructive_merge", "clear_i_j_on_f_update_unconditional"],
      message: "Ping successful! Apps Script is running version 1.6 supporting automatic clearing of custom columns I and J whenever Column F (Current Balance) is updated or edited."
    })).setMimeType(ContentService.MimeType.JSON);
  }

  var sheetName = e.parameter.sheet || "Sheet1";
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(sheetName);
  
  if (!sheet) {
    sheet = ss.insertSheet(sheetName);
  }
  
  // Auto-create headers if the sheet is empty
  ensureHeadersExist(sheet);

  var data = sheet.getDataRange().getValues();
  return ContentService.createTextOutput(JSON.stringify(data))
                       .setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) {
      return ContentService.createTextOutput(JSON.stringify({
        status: "info",
        message: "The Apps Script is active! Do not click 'Run' manually in the script editor. To write data, the ledger app will send a secure POST request to this Web App."
      })).setMimeType(ContentService.MimeType.JSON);
    }
    
    var requestData = JSON.parse(e.postData.contents);
    var action = requestData.action;
    var sheetName = requestData.sheet || "Sheet1";
    var rows = requestData.rows;
    
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName(sheetName);
    if (!sheet) {
      sheet = ss.insertSheet(sheetName);
    }
    
    if (action === "sync" || action === "write") {
      if (rows && rows.length > 0) {
        // 1. Read existing sheet data to map and preserve custom columns (I, J, K, etc.) and other existing rows
        var existingData = [];
        try {
          existingData = sheet.getDataRange().getValues();
        } catch (err) {}

        // Ensure headers exist
        if (existingData.length === 0) {
          ensureHeadersExist(sheet);
          try {
            existingData = sheet.getDataRange().getValues();
          } catch (err) {}
        }

        // We copy the existing data as our starting base to avoid destroying any user-added rows or data
        var mergedData = [];
        for (var r = 0; r < existingData.length; r++) {
          mergedData.push(existingData[r].slice());
        }

        // Map existing party names (column A, case-insensitive, trimmed) to their indices in mergedData
        var partyRowMap = {};
        for (var r = 1; r < mergedData.length; r++) {
          var partyName = String(mergedData[r][0] || '').trim().toLowerCase();
          if (partyName) {
            partyRowMap[partyName] = r;
          }
        }

        // Helper to normalize amount comparisons safely (handles currency, formatting, and null/empty)
        function getNormalizedAmount(val) {
          if (val === undefined || val === null) return 0;
          var str = String(val).trim();
          if (str === "") return 0;
          var clean = str.replace(/[^\d.-]/g, '');
          var num = parseFloat(clean);
          return isNaN(num) ? 0 : num;
        }

        // Process incoming rows (skipping the header incoming row at index 0)
        for (var i = 1; i < rows.length; i++) {
          var incomingRow = rows[i];
          var incomingPartyName = String(incomingRow[0] || '').trim().toLowerCase();
          if (!incomingPartyName) continue;

          // Ensure standard columns are exactly 8 elements
          var standardCols = incomingRow.slice(0, 8);
          while (standardCols.length < 8) {
            standardCols.push("");
          }

          if (partyRowMap.hasOwnProperty(incomingPartyName)) {
            // Party already exists in the sheet. Overwrite standard columns (A-H, i.e., index 0-7)
            var targetIndex = partyRowMap[incomingPartyName];
            var targetRow = mergedData[targetIndex];
            
            // Get Column F (index 5) and compare with existing F to only clear I/J if balance actually changed
            var incomingF = standardCols[5];
            var existingF = targetRow[5];
            
            // Overwrite columns A-H (indices 0-7) of targetRow, keeping index 8 (Column I) and onwards untouched!
            for (var c = 0; c < 8; c++) {
              targetRow[c] = standardCols[c];
            }
            
            // Check if Column F has actually changed using robust normalization
            var incomingFNum = getNormalizedAmount(incomingF);
            var existingFNum = getNormalizedAmount(existingF);
            
            if (incomingFNum !== existingFNum) {
              // Ensure row array has enough space for columns I and J
              while (targetRow.length < 10) {
                targetRow.push("");
              }
              targetRow[8] = ""; // Clear Column I (index 8)
              targetRow[9] = ""; // Clear Column J (index 9)
            }
          } else {
            // New party name. Append a brand new row to mergedData
            // and avoid overwriting any rows that might contain manual data in columns I, J, K, etc.
            mergedData.push(standardCols);
            partyRowMap[incomingPartyName] = mergedData.length - 1;
          }
        }

        // 2. Pad all rows to have the same length (required by setValues)
        var maxCols = 0;
        for (var k = 0; k < mergedData.length; k++) {
          if (mergedData[k].length > maxCols) {
            maxCols = mergedData[k].length;
          }
        }
        for (var k = 0; k < mergedData.length; k++) {
          while (mergedData[k].length < maxCols) {
            mergedData[k].push("");
          }
        }

        // 3. Write everything back in-place starting from A1
        sheet.getRange(1, 1, mergedData.length, maxCols).setValues(mergedData);
      } else {
        ensureHeadersExist(sheet);
      }
      return ContentService.createTextOutput(JSON.stringify({ status: "success", message: "Synchronized " + (rows ? rows.length : 0) + " rows successfully in-place, keeping all custom columns, extra rows, and manual values untouched." }))
                           .setMimeType(ContentService.MimeType.JSON);
    }
    
    return ContentService.createTextOutput(JSON.stringify({ status: "error", message: "Invalid action." }))
                           .setMimeType(ContentService.MimeType.JSON);
  } catch (error) {
    return ContentService.createTextOutput(JSON.stringify({ status: "error", message: error.toString() }))
                           .setMimeType(ContentService.MimeType.JSON);
  }
}

// Automatically check and initialize headers on trigger
function onOpen() {
  initializeSheetWithHeaders();
}

function initializeSheetWithHeaders() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheets = ss.getSheets();
  for (var i = 0; i < sheets.length; i++) {
    ensureHeadersExist(sheets[i]);
  }
}

function ensureHeadersExist(sheet) {
  var lastRow = sheet.getLastRow();
  var lastColumn = sheet.getLastColumn();
  
  if (lastRow === 0 || lastColumn === 0) {
    var headers = ["Party Name", "Address", "Opening Balance", "Recent Debit", "Recent Credit", "Current Balance", "Email ID", "Contact Number"];
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    
    // Apply elegant styling to headers matching Ledger theme
    var headerRange = sheet.getRange(1, 1, 1, headers.length);
    headerRange.setFontWeight("bold");
    headerRange.setBackground("#E6F4EA"); // Soft emerald bg
    headerRange.setFontColor("#137333"); // Dark green text
    headerRange.setBorder(true, true, true, true, true, true);
    sheet.setFrozenRows(1);
    
    sheet.autoResizeColumns(1, headers.length);
  }
}

// Automatically clear columns I (9) and J (10) when Column F (6) is edited directly in Google Sheets
function onEdit(e) {
  if (!e) return;
  var range = e.range;
  var sheet = range.getSheet();
  
  var startColumn = range.getColumn();
  var endColumn = range.getLastColumn();
  
  // Column 6 is Column F (Current Balance)
  if (startColumn <= 6 && endColumn >= 6) {
    var startRow = range.getRow();
    var endRow = range.getLastRow();
    
    for (var r = startRow; r <= endRow; r++) {
      if (r > 1) { // Skip headers
        sheet.getRange(r, 9).setValue("");  // Clear Column I
        sheet.getRange(r, 10).setValue(""); // Clear Column J
      }
    }
  }
}`;

export default function AccountsMail() {
  const { currentUser } = useAuth();
  const { activeLedger } = useLedger();

  // If not admin, show access denied
  if (!currentUser?.isAdmin) {
    return (
      <div className="flex flex-col items-center justify-center p-12 bg-white rounded-2xl border border-gray-100 max-w-lg mx-auto my-12 shadow-sm">
        <div className="p-3 bg-red-50 rounded-full text-red-500 mb-4">
          <AlertCircle size={32} />
        </div>
        <h2 className="text-xl font-bold text-gray-900 mb-2">Access Denied</h2>
        <p className="text-gray-500 text-center">
          The Google Sheets Sync feature is restricted to administrator accounts only.
        </p>
      </div>
    );
  }

  // Apps Script Web App Endpoint URL (used for pushing data)
  const [appsScriptUrl, setAppsScriptUrl] = useState(() => {
    const stored = localStorage.getItem('greenzar_apps_script_url');
    if (!stored || 
        stored.includes('AKfycbwJLtr0KjDiLo7j4oaTW2Q1mZKhB-VFeMmU3Wkyrk7ZDEVfE_W-qgv4yrpXjfAszaH1Fg') || 
        stored.includes('AKfycbzlXn0Ot87HWFk0i5D0-2zA22YaFTwo83z7nNOYes0dds4dzAegstmnmhfkrkoKJChj6Q') || 
        stored.includes('AKfycbwl0FAyUHSpIhwDPegydP5b8KgFavcQzON_OmzSqeJ9ug8da8fPuSyZ86SZk-Lv7Q_aHA') ||
        stored.includes('AKfycbzf6Ova3trn3HcX4ErVg-mcXRvdkC1TB-txwAYF4ynWC7ZT18juy2yc9xMQbK_UC7MLww') ||
        stored.includes('AKfycbxrvjYS-v8mV-iLmTxqLO7x9sbbj5jXIpJjTwzhMfMaDmjdejctrbqIncGFauTRsUek_Q') ||
        stored.includes('AKfycbyWznlRrApnINLQHM9FSsokRj6GDUPh0e-7yS_IJniLlPkN4YD1dfCAhnjNClTZAFYLmw') ||
        stored.includes('AKfycbxHUzSQPjsaxcLo-8uQNfSYNqMIlE_5_LniAbVV_n_W5srQbt6vCIsb3HYIWAT3iwOl') ||
        stored.includes('AKfycbxWRUu2VCfdz5z_CYb51qKnPRRd8VI88Y8yazN3VOSAjHF9MHlVdO7xCypdkpsFvmNvRw') ||
        stored.includes('AKfycbzSA6jJe-6e-iqUJVvmhKXbUcVBZkHb5l9NBnz2UaeQMTzoDEkgE3nzHfIR542VE0vKRg') ||
        stored.includes('AKfycbxi2BmVNb-IAzRnUmvqcEERgVrjyJzUijUZSJLPEhhHKgPuWFFK0Tw4PUfjoOaxZfBgFQ') ||
        stored.includes('AKfycbzwA1bsYtS-x4p-EpYuupZrDvYNLqZmClZuYon4DS97duRthDEOr3XwDIIsMkPcONBA') ||
        stored.includes('AKfycbwO7VJlP-gHvS7KzUrtPrJRS39O7S6PLX81dRvL-e4TiBifyg47vNwnpq-RIGgX-MYB9g') ||
        stored.includes('AKfycbznmjyYhnHzS-bJfp0XfnOdgMBf8X5VqdVEw98q56yNjb-gP2cleEykcCZG6QD-SpwYOg')) {
      return 'https://script.google.com/macros/s/AKfycbxeZS3qlxhBpTFGsKQCjPqC5tNOgG9RgvZ6pB3QragZDNIbygXf6Dy7EEpE5pJkQLUM/exec';
    }
    return stored;
  });

  const [sheetTitle, setSheetTitle] = useState(() => {
    return localStorage.getItem('greenzar_sheet_tab_name') || 'Sheet1';
  });

  // Google Sheets API v4 (used for reading data)
  const [v4SpreadsheetId, setV4SpreadsheetId] = useState(() => {
    const stored = localStorage.getItem('greenzar_v4_spreadsheet_id');
    if (!stored || stored === '1mWsUiIiJ-olbfiCvfMY3gnOBaAUkQBWWZqTMK-0MccY' || stored === '1VvluNPAvviO-93-8FntfLc8lTpi-przr6S1OTKUW4gg' || stored === '1sHj-A4tGwcDXVuMjAe5tHblN9qMy1rtjpPHfRDDTapw') {
      return '1hIbrec_nTB3Q6BmPiunFZeWYC133v_uPbsLK8eROnVM';
    }
    return extractSpreadsheetId(stored);
  });

  const [v4ApiKey, setV4ApiKey] = useState(() => {
    return localStorage.getItem('greenzar_v4_api_key') || 'AIzaSyCknGPyQu5Je8GEeneBeSmUjLHdzLQY1U0';
  });

  const [v4Range, setV4Range] = useState(() => {
    const stored = localStorage.getItem('greenzar_v4_range');
    if (!stored || stored === 'Sheet1!A2:C') {
      return 'Sheet1!A2:D';
    }
    return stored;
  });

  // Business States
  const [v4Parties, setV4Parties] = useState<{ partyName: string; outstandingAmount: number; email: string; phone: string; rawOutstanding: string }[]>([]);
  const [rawSheetData, setRawSheetData] = useState<any[][]>([]);
  const [showRawGrid, setShowRawGrid] = useState(false);
  const [localParties, setLocalParties] = useState<Party[]>([]);
  const [activeTab, setActiveTab] = useState<'local' | 'spreadsheet'>('local');
  const [isAutoSyncing, setIsAutoSyncing] = useState(() => {
    return localStorage.getItem('greenzar_realtime_sheet_sync') !== 'false';
  });
  const [isFetching, setIsFetching] = useState(false);
  const [isPushing, setIsPushing] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [lastSynced, setLastSynced] = useState<Date | null>(null);
  const [isConfigOpen, setIsConfigOpen] = useState(false);
  const [showScriptCode, setShowScriptCode] = useState(false);
  const [isReadOnlyMode, setIsReadOnlyMode] = useState(() => {
    return localStorage.getItem('greenzar_sheet_read_only_mode') !== 'false';
  });
  const [isDiagnosing, setIsDiagnosing] = useState(false);
  const [diagnosticLogs, setDiagnosticLogs] = useState<{ type: 'info' | 'success' | 'error'; text: string }[]>([]);

  const toggleAutoSync = (enabled: boolean) => {
    setIsAutoSyncing(enabled);
    localStorage.setItem('greenzar_realtime_sheet_sync', String(enabled));
  };

  const fetchLocalParties = async () => {
    if (!activeLedger?.id) {
      setLocalParties([]);
      return;
    }
    try {
      await syncCollection<Party>('parties', activeLedger.id, 'parties');
      const cachedParties = await getFilteredCacheItems<Party>('parties', p => p.ledgerId === activeLedger.id && p.status !== 'Inactive');
      setLocalParties(cachedParties);
    } catch (e) {
      console.error('Failed to load local parties:', e);
    }
  };

  const getPartySyncStatus = (localParty: Party) => {
    const sheetParty = v4Parties.find(
      p => p.partyName.trim().toLowerCase() === localParty.name.trim().toLowerCase()
    );

    if (!sheetParty) {
      return {
        label: 'Not on Sheet',
        style: 'bg-slate-100 text-slate-600 border-slate-200',
        color: 'text-slate-400'
      };
    }

    const localDue = localParty.currentDue || 0;
    const sheetDue = sheetParty.outstandingAmount || 0;
    const isMatched = Math.abs(localDue - sheetDue) < 0.01;

    if (isMatched) {
      return {
        label: 'In Sync',
        style: 'bg-emerald-50 text-emerald-700 border-emerald-100',
        color: 'text-emerald-500'
      };
    } else {
      return {
        label: 'Out of Sync',
        style: 'bg-amber-50 text-amber-700 border-amber-100',
        color: 'text-amber-500',
        diff: localDue - sheetDue
      };
    }
  };

  // Initialize spreadsheet defaults
  useEffect(() => {
    const stored = localStorage.getItem('greenzar_apps_script_url');
    if (!stored || 
        stored.includes('AKfycbwJLtr0KjDiLo7j4oaTW2Q1mZKhB-VFeMmU3Wkyrk7ZDEVfE_W-qgv4yrpXjfAszaH1Fg') || 
        stored.includes('AKfycbzlXn0Ot87HWFk0i5D0-2zA22YaFTwo83z7nNOYes0dds4dzAegstmnmhfkrkoKJChj6Q') || 
        stored.includes('AKfycbwl0FAyUHSpIhwDPegydP5b8KgFavcQzON_OmzSqeJ9ug8da8fPuSyZ86SZk-Lv7Q_aHA') ||
        stored.includes('AKfycbzf6Ova3trn3HcX4ErVg-mcXRvdkC1TB-txwAYF4ynWC7ZT18juy2yc9xMQbK_UC7MLww') ||
        stored.includes('AKfycbxrvjYS-v8mV-iLmTxqLO7x9sbbj5jXIpJjTwzhMfMaDmjdejctrbqIncGFauTRsUek_Q') ||
        stored.includes('AKfycbyWznlRrApnINLQHM9FSsokRj6GDUPh0e-7yS_IJniLlPkN4YD1dfCAhnjNClTZAFYLmw') ||
        stored.includes('AKfycbxHUzSQPjsaxcLo-8uQNfSYNqMIlE_5_LniAbVV_n_W5srQbt6vCIsb3HYIWAT3iwOl') ||
        stored.includes('AKfycbxWRUu2VCfdz5z_CYb51qKnPRRd8VI88Y8yazN3VOSAjHF9MHlVdO7xCypdkpsFvmNvRw') ||
        stored.includes('AKfycbzSA6jJe-6e-iqUJVvmhKXbUcVBZkHb5l9NBnz2UaeQMTzoDEkgE3nzHfIR542VE0vKRg') ||
        stored.includes('AKfycbxi2BmVNb-IAzRnUmvqcEERgVrjyJzUijUZSJLPEhhHKgPuWFFK0Tw4PUfjoOaxZfBgFQ') ||
        stored.includes('AKfycbzwA1bsYtS-x4p-EpYuupZrDvYNLqZmClZuYon4DS97duRthDEOr3XwDIIsMkPcONBA') ||
        stored.includes('AKfycbwO7VJlP-gHvS7KzUrtPrJRS39O7S6PLX81dRvL-e4TiBifyg47vNwnpq-RIGgX-MYB9g') ||
        stored.includes('AKfycbznmjyYhnHzS-bJfp0XfnOdgMBf8X5VqdVEw98q56yNjb-gP2cleEykcCZG6QD-SpwYOg')) {
      localStorage.setItem('greenzar_apps_script_url', 'https://script.google.com/macros/s/AKfycbxeZS3qlxhBpTFGsKQCjPqC5tNOgG9RgvZ6pB3QragZDNIbygXf6Dy7EEpE5pJkQLUM/exec');
    }
    const storedSheet = localStorage.getItem('greenzar_v4_spreadsheet_id');
    if (!storedSheet || storedSheet === '1mWsUiIiJ-olbfiCvfMY3gnOBaAUkQBWWZqTMK-0MccY' || storedSheet === '1VvluNPAvviO-93-8FntfLc8lTpi-przr6S1OTKUW4gg' || storedSheet === '1sHj-A4tGwcDXVuMjAe5tHblN9qMy1rtjpPHfRDDTapw') {
      localStorage.setItem('greenzar_v4_spreadsheet_id', '1hIbrec_nTB3Q6BmPiunFZeWYC133v_uPbsLK8eROnVM');
    }
    if (!localStorage.getItem('greenzar_v4_api_key')) {
      localStorage.setItem('greenzar_v4_api_key', 'AIzaSyCknGPyQu5Je8GEeneBeSmUjLHdzLQY1U0');
    }
    if (!localStorage.getItem('greenzar_sheet_tab_name')) {
      localStorage.setItem('greenzar_sheet_tab_name', 'Sheet1');
    }
    const storedRange = localStorage.getItem('greenzar_v4_range');
    if (!storedRange || storedRange === 'Sheet1!A2:C' || storedRange === 'Sheet1!A2:D') {
      localStorage.setItem('greenzar_v4_range', 'Sheet1!A2:H');
    }
  }, []);

  // Fetch spreadsheet data from either Apps Script read-proxy or Google Sheets API v4 via backend proxy
  const fetchV4Data = async (silent = false) => {
    const sId = extractSpreadsheetId(v4SpreadsheetId);
    const key = v4ApiKey.trim();
    const rng = v4Range.trim();
    const scriptUrl = appsScriptUrl.trim();

    if (!scriptUrl && (!sId || !key)) {
      if (!silent) {
        setErrorMsg('Please configure either your Apps Script Web App URL or Google Spreadsheet ID and API Key.');
      }
      return;
    }

    if (!silent) {
      setIsFetching(true);
      setErrorMsg(null);
    }

    let parsedParties: { partyName: string; outstandingAmount: number; email: string; phone: string; address: string; rawOutstanding: string }[] = [];
    let fetchMethodUsed = '';
    let lastError: string | null = null;
    let didFetchSucceed = false;

    // Method A: Try Apps Script read-proxy first if available
    if (scriptUrl) {
      try {
        console.log('[Sync] Attempting to fetch data via Apps Script read-proxy...');
        const fetchUrl = `/api/sheets/read-proxy?appsScriptUrl=${encodeURIComponent(scriptUrl)}&sheet=${encodeURIComponent(sheetTitle.trim())}`;
        const res = await fetch(fetchUrl);
        if (!res.ok) {
          throw new Error(`Apps Script proxy responded with status ${res.status}`);
        }
        const resData = await res.json();
        
        let rawRows: any[] = [];
        if (Array.isArray(resData)) {
          rawRows = resData;
        } else if (resData && Array.isArray(resData.data)) {
          rawRows = resData.data;
        } else if (resData && Array.isArray(resData.rows)) {
          rawRows = resData.rows;
        } else if (resData && Array.isArray(resData.values)) {
          rawRows = resData.values;
        } else if (resData && Array.isArray(resData.parties)) {
          rawRows = resData.parties;
        }

        // Store whatever raw structure we got for the UI raw inspector
        setRawSheetData(rawRows);

        if (rawRows.length > 0) {
          didFetchSucceed = true;
          // If rawRows is already an array of structured party objects
          if (rawRows[0] && typeof rawRows[0] === 'object' && !Array.isArray(rawRows[0])) {
            parsedParties = rawRows.map((obj: any) => {
              const partyName = String(obj.partyName || obj.party_name || obj.name || '').trim();
              const rawOutstanding = String(obj.outstandingAmount || obj.outstanding || obj.currentDue || '0').trim();
              const email = String(obj.email || '').trim();
              const phone = formatContactWith91(String(obj.phone || obj.phone_number || obj.contact || obj.contact_number || ''));
              const address = String(obj.address || obj.location || '').trim();
              const cleanNum = rawOutstanding.replace(/[^0-9.-]/g, '');
              const outstandingAmount = parseFloat(cleanNum) || 0;
              return { partyName, outstandingAmount, email, phone, address, rawOutstanding };
            }).filter(p => p.partyName !== '');
          } else {
            // It is a 2D array of cells (rows of columns)
            let nameIdx = 0;
            let addressIdx = -1;
            let outstandingIdx = 1;
            let emailIdx = 2;
            let phoneIdx = 3; // Default fallback to 4th column

            const firstRow = rawRows[0];
            const firstCol = String(firstRow[0] || '').toLowerCase();
            const isHeader = firstCol.includes('name') || firstCol.includes('party') || firstCol.includes('title') || firstCol.includes('outstanding') || firstCol.includes('due') || firstCol.includes('email') || firstCol.includes('contact') || firstCol.includes('address');
            let startIdx = 0;
            if (isHeader) {
              firstRow.forEach((col: any, idx: number) => {
                const text = String(col).toLowerCase();
                // 1. Check phone/contact first to prevent "Contact No." or "Phone No." matching "no."
                if (text.includes('phone') || text.includes('contact') || text.includes('mob') || text.includes('tel') || text.includes('number')) {
                  phoneIdx = idx;
                }
                // 2. Check email
                else if (text.includes('mail') || text.includes('email')) {
                  emailIdx = idx;
                }
                // 3. Check name
                else if (text.includes('name') || text.includes('party')) {
                  nameIdx = idx;
                }
                // 4. Check address
                else if (text.includes('address') || text.includes('location') || text.includes('addr')) {
                  addressIdx = idx;
                }
                // 5. Check outstanding/balance (current due/current balance)
                else if ((text.includes('outstanding') || text.includes('amount') || text.includes('due') || text.includes('balance') || text.includes('no.')) && !text.includes('opening')) {
                  outstandingIdx = idx;
                }
              });
              startIdx = 1; // skip header
            }

            for (let i = startIdx; i < rawRows.length; i++) {
              const row = rawRows[i];
              if (Array.isArray(row) && row.length > 0) {
                const partyName = String(row[nameIdx] || '').trim();
                if (!partyName) continue;
                const rawOutstanding = String(row[outstandingIdx] || '0').trim();
                const email = String(row[emailIdx] || '').trim();
                const phone = phoneIdx !== -1 && phoneIdx < row.length ? formatContactWith91(String(row[phoneIdx] || '')) : '';
                const address = addressIdx !== -1 && addressIdx < row.length ? String(row[addressIdx] || '').trim() : '';
                const cleanNum = rawOutstanding.replace(/[^0-9.-]/g, '');
                const outstandingAmount = parseFloat(cleanNum) || 0;
                parsedParties.push({
                  partyName,
                  outstandingAmount,
                  email,
                  phone,
                  address,
                  rawOutstanding
                });
              }
            }
          }
          fetchMethodUsed = 'Apps Script';
        } else {
          // If connection returns empty array, it still contacted successfully!
          didFetchSucceed = true;
          fetchMethodUsed = 'Apps Script';
        }
      } catch (err: any) {
        console.warn('Apps Script read-proxy failed, falling back to Sheets API v4:', err);
        lastError = err.message || String(err);
      }
    }

    // Method B: Fallback to direct Sheets API v4 via proxy
    if (!didFetchSucceed && sId && key) {
      try {
        console.log('[Sync] Attempting to fetch data via Sheets API v4 proxy...');
        const fetchUrl = `/api/parties/live?spreadsheetId=${encodeURIComponent(sId)}&apiKey=${encodeURIComponent(key)}&range=${encodeURIComponent(rng)}`;
        const res = await fetch(fetchUrl);
        if (!res.ok) {
          throw new Error(`Google Sheets Proxy responded with status ${res.status}`);
        }
        const resData = await res.json();
        if (resData.success && Array.isArray(resData.parties)) {
          parsedParties = resData.parties;
          didFetchSucceed = true;
          fetchMethodUsed = 'Sheets API v4';

          // Simulate raw array structure for direct API
          const simulatedRaw = [['Party Name', 'Address', 'Opening Balance', 'Recent Debit', 'Recent Credit', 'Current Balance', 'Email ID', 'Contact Number'], ...parsedParties.map(p => [p.partyName, p.address || '', '', '', '', p.rawOutstanding, p.email, p.phone || ''])];
          setRawSheetData(simulatedRaw);
        } else {
          throw new Error(resData.error || 'Failed to parse party rows from Sheets API.');
        }
      } catch (err: any) {
        console.error('Sheets API v4 proxy failed:', err);
        lastError = err.message || String(err);
      }
    }

    // Process parsed parties
    if (didFetchSucceed) {
      setV4Parties(parsedParties);
      setLastSynced(new Date());

      // Read-only logic: Update local balances if matching local party exists
      if (isReadOnlyMode) {
        console.log('[Sync] Spreadsheet Read-Only Mode is active. Skipping automatic database overwrite to keep app data secure.');
      } else if (activeLedger?.id && parsedParties.length > 0) {
        await syncCollection<Party>('parties', activeLedger.id, 'parties');
        const localParties = await getFilteredCacheItems<Party>('parties', p => p.ledgerId === activeLedger.id);
        let hasChanges = false;

        for (const sheetParty of parsedParties) {
          const sheetName = String(sheetParty.partyName || '').trim();
          if (!sheetName) continue;

          const matchedLocal = localParties.find(
            p => p.name.trim().toLowerCase() === sheetName.toLowerCase()
          );

          if (matchedLocal) {
            const sheetDue = parseFloat(String(sheetParty.outstandingAmount)) || 0;
            const sheetPhone = String(sheetParty.phone || '').trim();
            const sheetEmail = String(sheetParty.email || '').trim();
            const sheetAddress = String(sheetParty.address || '').trim();
            let isChanged = false;

            const updatedParty: Party = { ...matchedLocal };

            if (matchedLocal.currentDue !== sheetDue) {
              updatedParty.currentDue = sheetDue;
              isChanged = true;
            }
            if (sheetPhone && matchedLocal.phone !== sheetPhone) {
              updatedParty.phone = sheetPhone;
              isChanged = true;
            }
            if (sheetEmail && matchedLocal.email !== sheetEmail) {
              updatedParty.email = sheetEmail;
              isChanged = true;
            }
            if (sheetAddress && matchedLocal.address !== sheetAddress) {
              updatedParty.address = sheetAddress;
              isChanged = true;
            }

            if (isChanged) {
              await setCacheItem<Party>('parties', updatedParty);
              await setDoc(doc(db, 'parties', matchedLocal.id), updatedParty);
              hasChanges = true;
            }
          }
        }

        if (hasChanges) {
          console.log('[Sync] Outstanding balances synchronized successfully.');
          window.dispatchEvent(new CustomEvent('database-synced'));
        }
      }

      if (!silent) {
        if (parsedParties.length === 0) {
          setSuccessMsg(`Connected to Google Sheets successfully! However, no active customer records were found below the headers. Add party rows in your sheet and click Sync Now.`);
        } else {
          setSuccessMsg(`Successfully loaded ${parsedParties.length} records via ${fetchMethodUsed}!`);
        }
        setTimeout(() => setSuccessMsg(null), 4000);
      }
    } else {
      if (!silent) {
        setErrorMsg(lastError || 'Could not fetch records. Check your settings, sheet name, or Apps Script authorization.');
      }
    }

    if (!silent) {
      setIsFetching(false);
    }
  };

  // Import all parties from the Google Sheet into the local ledger database
  const importSheetPartiesToApp = async () => {
    if (!activeLedger?.id) {
      alert('Please select an active ledger first.');
      return;
    }
    if (v4Parties.length === 0) {
      alert('No spreadsheet parties available to import. Please click "Sync Now" first to fetch the data from your spreadsheet.');
      return;
    }

    const confirmImport = window.confirm(`This will import ${v4Parties.length} parties from your Google Sheet into the active ledger "${activeLedger.name}". Any existing parties with the same name will have their outstanding balances updated. Proceed?`);
    if (!confirmImport) return;

    setIsImporting(true);
    setErrorMsg(null);
    setSuccessMsg(null);

    try {
      await syncCollection<Party>('parties', activeLedger.id, 'parties');
      const localPartiesList = await getFilteredCacheItems<Party>('parties', p => p.ledgerId === activeLedger.id);
      
      let importedCount = 0;
      let updatedCount = 0;

      for (const sheetParty of v4Parties) {
        const sheetName = String(sheetParty.partyName || '').trim();
        if (!sheetName) continue;

        const matchedLocal = localPartiesList.find(
          p => p.name.trim().toLowerCase() === sheetName.toLowerCase()
        );

        const sheetDue = parseFloat(String(sheetParty.outstandingAmount)) || 0;
        const sheetEmail = String(sheetParty.email || '').trim();

        if (matchedLocal) {
          // Update existing party
          const updatedParty: Party = {
            ...matchedLocal,
            currentDue: sheetDue,
            email: sheetEmail || matchedLocal.email,
            phone: sheetParty.phone || matchedLocal.phone,
            address: sheetParty.address || matchedLocal.address
          };
          await setCacheItem<Party>('parties', updatedParty);
          await setDoc(doc(db, 'parties', matchedLocal.id), updatedParty);
          updatedCount++;
        } else {
          // Create new party
          const newParty: Party = {
            id: uuidv4(),
            ledgerId: activeLedger.id,
            name: sheetName,
            phone: sheetParty.phone || '',
            address: sheetParty.address || '',
            openingBalance: sheetDue,
            currentDue: sheetDue,
            lastTransaction: Date.now(),
            status: 'Active',
            email: sheetEmail
          };
          await setCacheItem<Party>('parties', newParty);
          await setDoc(doc(db, 'parties', newParty.id), newParty);
          importedCount++;
        }
      }

      await updateDashboardPartiesCount(activeLedger.id, importedCount);
      await fetchLocalParties();

      window.dispatchEvent(new CustomEvent('database-synced'));

      setSuccessMsg(`Import complete! Successfully created ${importedCount} new party accounts and updated ${updatedCount} existing party accounts in the app from your Google Sheet.`);
      setActiveTab('local');
    } catch (err: any) {
      console.error('Failed to import parties:', err);
      setErrorMsg(`Failed to import parties: ${err.message || String(err)}`);
    } finally {
      setIsImporting(false);
    }
  };

  // Push all local parties and current calculated balances to Google Sheet
  const handlePushAppToSheet = async () => {
    if (!activeLedger?.id) {
      alert('Please select an active ledger first.');
      return;
    }
    if (!appsScriptUrl) {
      alert('Please configure your Google Apps Script Web App URL first.');
      return;
    }

    const confirmPush = window.confirm(`This will export and overwrite your Google Sheet with all active parties and their calculated outstanding dues from ledger "${activeLedger.name}". Proceed?`);
    if (!confirmPush) return;

    setIsPushing(true);
    setErrorMsg(null);
    setSuccessMsg(null);

    try {
      await syncCollection<Party>('parties', activeLedger.id, 'parties');
      const activeParties = await getFilteredCacheItems<Party>('parties', p => p.ledgerId === activeLedger.id && p.status !== 'Inactive');

      // Sync transactions to find latest debit and credit
      await syncCollection<Transaction>('transactions', activeLedger.id, 'transactions');
      const activeTransactions = await getFilteredCacheItems<Transaction>('transactions', t => t.ledgerId === activeLedger.id);

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

      // 1. Pre-group transactions by partyId to avoid nested O(N * M) list scanning
      const txByPartyMap = new Map<string, Transaction[]>();
      for (const t of activeTransactions) {
        if (!txByPartyMap.has(t.partyId)) {
          txByPartyMap.set(t.partyId, []);
        }
        txByPartyMap.get(t.partyId)!.push(t);
      }

      // 2. Sort grouped transactions once chronologically (newest first)
      for (const [_, txList] of txByPartyMap.entries()) {
        txList.sort((a, b) => b.timestamp - a.timestamp);
      }

      const updatedRows = activeParties.map(party => {
        // Retrieve pre-sorted, pre-grouped transactions in O(1) constant time
        const partyTx = txByPartyMap.get(party.id) || [];

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

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.error || `Apps Script proxy responded with status ${res.status}`);
      }
      
      const resJson = await res.json();

      if (resJson.status === 'error') {
        throw new Error(resJson.message || 'Apps Script sync returned error.');
      }

      setSuccessMsg(`Successfully exported and pushed ${activeParties.length} parties to your Google Sheet!`);
      alert(`Successfully exported and pushed ${activeParties.length} parties to your Google Sheet!`);
      setTimeout(() => setSuccessMsg(null), 4000);

      // Trigger silent fetch to sync visual list
      await fetchV4Data(true);
    } catch (err: any) {
      console.error(err);
      const errMsg = err.message || String(err);
      setErrorMsg(`Failed to push app data to Google Sheet: ${errMsg}`);
      alert(`Failed to push app data to Google Sheet: ${errMsg}`);
    } finally {
      setIsPushing(false);
    }
  };

  // Save Config parameters to localStorage
  const saveConfig = () => {
    const cleanSpreadsheetId = extractSpreadsheetId(v4SpreadsheetId);
    setV4SpreadsheetId(cleanSpreadsheetId);

    localStorage.setItem('greenzar_v4_spreadsheet_id', cleanSpreadsheetId);
    localStorage.setItem('greenzar_v4_api_key', v4ApiKey.trim());
    localStorage.setItem('greenzar_v4_range', v4Range.trim());
    localStorage.setItem('greenzar_apps_script_url', appsScriptUrl.trim());
    localStorage.setItem('greenzar_sheet_tab_name', sheetTitle.trim());
    localStorage.setItem('greenzar_sheet_read_only_mode', String(isReadOnlyMode));
    
    setIsConfigOpen(false);
    setSuccessMsg('Settings saved successfully!');
    setTimeout(() => setSuccessMsg(null), 2000);
    fetchV4Data();
  };

  // Reset parameters to official application defaults
  const resetToDefaults = () => {
    const defaultUrl = 'https://script.google.com/macros/s/AKfycbxeZS3qlxhBpTFGsKQCjPqC5tNOgG9RgvZ6pB3QragZDNIbygXf6Dy7EEpE5pJkQLUM/exec';
    const defaultSpreadsheetId = '1hIbrec_nTB3Q6BmPiunFZeWYC133v_uPbsLK8eROnVM';
    const defaultApiKey = 'AIzaSyCknGPyQu5Je8GEeneBeSmUjLHdzLQY1U0';
    const defaultTabName = 'Sheet1';
    const defaultRange = 'Sheet1!A2:H';

    setAppsScriptUrl(defaultUrl);
    setV4SpreadsheetId(defaultSpreadsheetId);
    setV4ApiKey(defaultApiKey);
    setSheetTitle(defaultTabName);
    setV4Range(defaultRange);
    setIsReadOnlyMode(true);

    localStorage.setItem('greenzar_apps_script_url', defaultUrl);
    localStorage.setItem('greenzar_v4_spreadsheet_id', defaultSpreadsheetId);
    localStorage.setItem('greenzar_v4_api_key', defaultApiKey);
    localStorage.setItem('greenzar_sheet_tab_name', defaultTabName);
    localStorage.setItem('greenzar_v4_range', defaultRange);
    localStorage.setItem('greenzar_sheet_read_only_mode', 'true');

    setSuccessMsg('Reset all connection parameters to default. Please save config or refresh.');
    setTimeout(() => setSuccessMsg(null), 4000);
  };

  // Run detailed diagnostic test on Google Sheets credentials & API accessibility
  const runDiagnostics = async () => {
    setIsDiagnosing(true);
    const logs: { type: 'info' | 'success' | 'error'; text: string }[] = [];
    const log = (type: 'info' | 'success' | 'error', text: string) => {
      logs.push({ type, text });
      setDiagnosticLogs([...logs]);
    };

    log('info', '🔍 Starting Google Sheets Connection & Credentials Diagnostics...');

    // 1. Verify spreadsheet ID format
    let sId = v4SpreadsheetId.trim();
    if (sId.includes('/spreadsheets/d/')) {
      const parsed = extractSpreadsheetId(sId);
      log('info', `📋 Google Sheets URL detected! Automatically extracted Spreadsheet ID: "${parsed}"`);
      sId = parsed;
    }
    
    if (!sId) {
      log('error', '❌ Spreadsheet ID is empty.');
    } else if (sId.length < 20) {
      log('error', `❌ Spreadsheet ID "${sId}" looks too short. Normally it is a 44-character code.`);
    } else {
      log('info', `📋 Spreadsheet ID format check: "${sId}" matches expected format.`);
    }

    // 2. Verify API key format
    const key = v4ApiKey.trim();
    if (!key) {
      log('error', '❌ Google Sheets API Key is empty.');
    } else if (!key.startsWith('AIzaSy')) {
      log('error', `❌ API Key "${key}" does not start with "AIzaSy" (standard Google Cloud API key prefix).`);
    } else {
      log('success', '✓ API Key starts with standard Google Cloud "AIzaSy" prefix.');
    }

    // 3. Test direct read connection via Google Sheets API Proxy
    if (sId && key) {
      log('info', '📡 Testing read-only connection via Google Sheets API (v4)...');
      try {
        const fetchUrl = `/api/parties/live?spreadsheetId=${encodeURIComponent(sId)}&apiKey=${encodeURIComponent(key)}&range=${encodeURIComponent(v4Range.trim())}`;
        const res = await fetch(fetchUrl);
        const resData = await res.json();
        
        if (res.ok && resData.success) {
          log('success', `✓ Direct Google Sheets API connection is working! Successfully retrieved ${resData.parties?.length || 0} customer records.`);
          if (resData.parties && resData.parties.length > 0) {
            log('info', `   • First record found: "${resData.parties[0].partyName}" with outstanding value ₹${resData.parties[0].outstandingAmount}`);
          } else {
            log('info', '   • Sheet was loaded, but contains no rows or matching party data.');
          }
        } else {
          const errMsg = resData.error || `HTTP ${res.status}`;
          log('error', `❌ Sheets API fetch failed: ${errMsg}`);
          if (errMsg.toLowerCase().includes('permission') || errMsg.toLowerCase().includes('403') || errMsg.toLowerCase().includes('authorized')) {
            log('error', '👉 PROBLEM IDENTIFIED: Your Google Spreadsheet is likely PRIVATE! Open your Google Sheet, click the "Share" button in the top-right corner, and change General Access to "Anyone with the link can view". Google APIs cannot read private sheets.');
          } else if (errMsg.toLowerCase().includes('not found') || errMsg.toLowerCase().includes('404')) {
            log('error', '👉 PROBLEM IDENTIFIED: Spreadsheet not found! Double-check that your Spreadsheet ID matches the long code in your spreadsheet URL exactly, and that the tab name is correct.');
          } else if (errMsg.toLowerCase().includes('api key') || errMsg.toLowerCase().includes('key invalid') || errMsg.toLowerCase().includes('invalid key')) {
            log('error', '👉 PROBLEM IDENTIFIED: Your Google Sheets API Key is invalid or restricted. Please double check that you copied the key correctly without trailing spaces.');
          } else {
            log('error', '👉 SUGGESTION: Verify that your "Sheet Tab Name" (e.g. "Sheet1") exists exactly in your spreadsheet and contains a column for "Party Name" and "Outstanding".');
          }
        }
      } catch (err: any) {
        log('error', `❌ System fetch error: ${err.message || String(err)}`);
      }
    } else {
      log('info', '⚠️ Sheets API Key and/or Spreadsheet ID are missing; skipped direct read-only test.');
    }

    // 4. Test Apps Script Web App Connection (Required for writing / push)
    const scriptUrl = appsScriptUrl.trim();
    if (scriptUrl) {
      log('info', '📡 Testing Apps Script Web App version & caching diagnostics...');
      try {
        const pingUrl = `/api/sheets/read-proxy?appsScriptUrl=${encodeURIComponent(scriptUrl)}&action=ping`;
        const pingRes = await fetch(pingUrl);
        const pingText = await pingRes.text();
        
        let pingParsed: any = null;
        try {
          pingParsed = JSON.parse(pingText);
        } catch (e) {}

        if (pingRes.ok && pingParsed && pingParsed.version === "1.5") {
          log('success', '✓ Apps Script Web App is running the LATEST version (v1.5) with non-destructive row merging and custom column preservation! Everything is set up perfectly.');
        } else if (pingRes.ok && pingParsed && (pingParsed.version === "1.4" || pingParsed.version === "1.3" || pingParsed.version === "1.2" || pingParsed.version === "1.1")) {
          log('error', `⚠️ WARNING: Your Apps Script is running an OLD version (v${pingParsed.version}). Please upgrade to v1.5 to prevent extra rows or manual data in columns I/J from being deleted during synchronization!`);
          log('error', '👉 HOW TO FIX: Scroll down to the "Paste this Apps Script Code" section, click "Copy Script Code", and redeploy with a "New version" (Version 1.5).');
        } else if (pingRes.ok && (Array.isArray(pingParsed) || (pingParsed && !pingParsed.version))) {
          log('error', '⚠️ WARNING: Your Google Sheet Web App is running an OLD version of the script code!');
          log('error', '👉 WHY IT MATTERS: Old script versions delete extra rows, clear custom columns, or misalign data during synchronization.');
          log('error', '👉 HOW TO FIX (Crucial Step):');
          log('error', '   1. Scroll down to the "Paste this Apps Script Code" section and click "Copy Script Code".');
          log('error', '   2. Go to your Google Apps Script editor, select all text, paste the new code, and click Save (Floppy disk icon).');
          log('error', '   3. Click "Deploy" -> "Manage deployments".');
          log('error', '   4. Click the Pencil icon next to your Active Deployment, select the "Version" dropdown, choose "New version" (do not keep it on the old number!), and click "Deploy".');
          log('error', '   5. If you see a new URL, copy it and paste it into the "Apps Script Web App URL" field above, then save settings.');
        } else {
          // Fallback check
          const fetchUrl = `/api/sheets/read-proxy?appsScriptUrl=${encodeURIComponent(scriptUrl)}&sheet=${encodeURIComponent(sheetTitle.trim())}`;
          const res = await fetch(fetchUrl);
          const text = await res.text();
          let parsed;
          try {
            parsed = JSON.parse(text);
          } catch(e) {}

          if (res.ok && parsed && !parsed.error) {
            log('success', '✓ Apps Script Web App is responsive and active, but version could not be verified. Please make sure to redeploy with "New version" to guarantee column preservation.');
          } else {
            const errMsg = parsed?.error || `HTTP ${res.status}`;
            log('error', `❌ Apps Script test failed: ${errMsg}`);
            if (text.includes('google.com') && text.includes('Service Login')) {
              log('error', '👉 PROBLEM IDENTIFIED: The Apps Script Web App was deployed with restricted access ("Only myself"). You MUST click Deploy -> New deployment in Apps Script and change "Who has access" to "Anyone" so the app can communicate with it.');
            } else {
              log('error', '👉 SUGGESTION: Check if the Apps Script code is copied correctly and that the sheet tab matches exactly.');
            }
          }
        }
      } catch (err: any) {
        log('error', `❌ Apps Script fetch error: ${err.message || String(err)}`);
      }
    } else {
      log('info', '⚠️ Apps Script URL is empty; skipped write/push capability tests.');
    }

    log('info', '🏁 Diagnostics check completed.');
    setIsDiagnosing(false);
  };

  // Initial fetch on mount
  useEffect(() => {
    fetchLocalParties();
    if (v4SpreadsheetId && v4ApiKey) {
      fetchV4Data(true);
    }

    const handleSync = () => {
      fetchLocalParties();
    };

    const handleGoogleSheetSynced = () => {
      if (v4SpreadsheetId && v4ApiKey) {
        fetchV4Data(true);
      }
    };

    window.addEventListener('database-synced', handleSync);
    window.addEventListener('google-sheet-synced', handleGoogleSheetSynced);

    return () => {
      window.removeEventListener('database-synced', handleSync);
      window.removeEventListener('google-sheet-synced', handleGoogleSheetSynced);
    };
  }, [activeLedger?.id]);

  return (
    <div className="max-w-4xl mx-auto px-4 py-8 space-y-6">
      {/* Header and Subtext */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-gray-100 pb-5">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-gray-950 flex items-center gap-2">
            <FileSpreadsheet className="text-emerald-600 shrink-0" size={26} />
            <span>Google Sheets Synchronization</span>
          </h1>
          <p className="text-xs sm:text-sm text-gray-500 mt-1">
            Back up ledger accounts permanently or sync outstanding values from your connected spreadsheet.
          </p>
        </div>
      </div>

      {/* Notifications */}
      {errorMsg && (
        <div className="p-4 bg-red-50 border border-red-100 rounded-xl flex items-start gap-3 text-red-800 text-xs sm:text-sm animate-in fade-in duration-150">
          <AlertCircle className="text-red-500 shrink-0 mt-0.5" size={18} />
          <div className="flex-1">
            <span className="font-bold">Sync Error:</span> {errorMsg}
          </div>
          <button onClick={() => setErrorMsg(null)} className="text-red-400 hover:text-red-600 font-bold">&times;</button>
        </div>
      )}

      {successMsg && (
        <div className="p-4 bg-emerald-50 border border-emerald-100 rounded-xl flex items-start gap-3 text-emerald-800 text-xs sm:text-sm animate-in fade-in duration-150">
          <CheckCircle className="text-emerald-500 shrink-0 mt-0.5" size={18} />
          <div className="flex-1">
            <span className="font-bold">Success:</span> {successMsg}
          </div>
          <button onClick={() => setSuccessMsg(null)} className="text-emerald-400 hover:text-emerald-600 font-bold">&times;</button>
        </div>
      )}

      {/* Main Connection Status & Action Console */}
      <div className="bg-white border border-gray-100 rounded-2xl p-6 shadow-xs space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-slate-50 p-4 rounded-xl border border-slate-100">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-emerald-50 text-emerald-600 rounded-xl">
              <FileSpreadsheet size={20} className={isFetching ? "animate-spin" : ""} />
            </div>
            <div>
              <p className="text-xs sm:text-sm font-bold text-gray-950">Active Connected Spreadsheet</p>
              <p className="text-[11px] text-gray-500 mt-0.5">
                {lastSynced ? `Last synchronized: ${lastSynced.toLocaleTimeString()}` : "Not synced in this session"}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 self-stretch sm:self-auto">
            <button
              onClick={() => setIsConfigOpen(!isConfigOpen)}
              className="flex-1 sm:flex-none px-3.5 py-2 border border-gray-200 hover:bg-gray-50 bg-white text-gray-700 text-xs font-semibold rounded-xl transition flex items-center justify-center gap-1.5"
            >
              <Settings size={14} className="text-gray-400" />
              <span>Configure Settings</span>
            </button>

            <button
              onClick={handlePushAppToSheet}
              disabled={isPushing || isFetching || !appsScriptUrl}
              className="flex-1 sm:flex-none px-4 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:bg-emerald-400 text-white text-xs font-bold rounded-xl shadow-xs transition flex items-center justify-center gap-1.5"
              title="Push local data to Google Sheet"
            >
              {isPushing ? <Loader2 size={14} className="animate-spin" /> : <CloudLightning size={14} />}
              <span>Push to Sheet</span>
            </button>

            <button
              onClick={() => fetchV4Data()}
              disabled={isFetching || isPushing}
              className="flex-1 sm:flex-none px-4 py-2 bg-sky-600 hover:bg-sky-700 disabled:bg-sky-400 text-white text-xs font-bold rounded-xl shadow-xs transition flex items-center justify-center gap-1.5"
            >
              {isFetching ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
              <span>Sync Now</span>
            </button>
          </div>
        </div>

        {/* Collapsible Config Block */}
        {isConfigOpen && (
          <div className="bg-white border border-gray-150 rounded-xl p-5 shadow-inner animate-in slide-in-from-top-4 duration-200 space-y-4">
            <h3 className="font-bold text-sm text-gray-950 flex items-center gap-1.5">
              <FileKey className="text-emerald-600" size={16} />
              Google Sheets Connection Parameters
            </h3>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-[10px] font-bold text-gray-500 mb-1 uppercase tracking-wider">Spreadsheet ID</label>
                <input
                  type="text"
                  value={v4SpreadsheetId}
                  onChange={(e) => {
                    const rawVal = e.target.value;
                    const parsed = extractSpreadsheetId(rawVal);
                    setV4SpreadsheetId(parsed);
                    if (rawVal.includes('/spreadsheets/d/') && parsed !== rawVal) {
                      setSuccessMsg('Successfully extracted clean Spreadsheet ID from your URL!');
                      setTimeout(() => setSuccessMsg(null), 3000);
                    }
                  }}
                  placeholder="Spreadsheet ID or full Google Sheets URL"
                  className="w-full px-3 py-2 border border-gray-200 rounded-xl text-xs focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 bg-gray-50/50"
                />
                <p className="text-[9px] text-gray-400 mt-1">
                  You can paste either the clean ID (e.g. <code>1RTaX0V...</code>) or the **entire Google Sheet URL** — the app will automatically extract it!
                </p>
              </div>
              <div>
                <label className="block text-[10px] font-bold text-gray-500 mb-1 uppercase tracking-wider">Sheets API Key</label>
                <input
                  type="password"
                  value={v4ApiKey}
                  onChange={(e) => setV4ApiKey(e.target.value)}
                  placeholder="Google Cloud API Key"
                  className="w-full px-3 py-2 border border-gray-200 rounded-xl text-xs focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 bg-gray-50/50"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="block text-[10px] font-bold text-gray-500 mb-1 uppercase tracking-wider">Sheet Tab Name</label>
                <input
                  type="text"
                  value={sheetTitle}
                  onChange={(e) => setSheetTitle(e.target.value)}
                  placeholder="Sheet1"
                  className="w-full px-3 py-2 border border-gray-200 rounded-xl text-xs focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 bg-gray-50/50"
                />
              </div>
              <div>
                <label className="block text-[10px] font-bold text-gray-500 mb-1 uppercase tracking-wider">Tab Range Selection</label>
                <input
                  type="text"
                  value={v4Range}
                  onChange={(e) => setV4Range(e.target.value)}
                  placeholder="Sheet1!A2:C"
                  className="w-full px-3 py-2 border border-gray-200 rounded-xl text-xs focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 bg-gray-50/50"
                />
              </div>
              <div>
                <label className="block text-[10px] font-bold text-gray-500 mb-1 uppercase tracking-wider">Apps Script Web App URL</label>
                <input
                  type="text"
                  value={appsScriptUrl}
                  onChange={(e) => setAppsScriptUrl(e.target.value)}
                  placeholder="https://script.google.com/macros/s/.../exec"
                  className="w-full px-3 py-2 border border-gray-200 rounded-xl text-xs focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 bg-gray-50/50"
                />
              </div>
            </div>

            {/* Database Security Settings */}
            <div className="p-4 bg-amber-50/50 border border-amber-100 rounded-xl space-y-3">
              <div className="flex items-center justify-between gap-4">
                <div className="space-y-1">
                  <div className="flex items-center gap-1.5 font-bold text-xs text-amber-900">
                    <span>🔒 Database Security: Read-Only Preview Mode</span>
                    <span className="px-1.5 py-0.5 bg-amber-200 text-amber-900 text-[9px] font-bold rounded">Recommended</span>
                  </div>
                  <p className="text-[10px] sm:text-[11px] text-amber-800/80 leading-relaxed max-w-xl">
                    When enabled, editing or typing anything in your Google Sheet will <strong>not</strong> automatically update or overwrite the ledger balances and customer details inside your app's local database. Your local database remains the authoritative master copy.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setIsReadOnlyMode(!isReadOnlyMode)}
                  className={`relative inline-flex h-5 w-10 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                    isReadOnlyMode ? 'bg-amber-600' : 'bg-gray-200'
                  }`}
                  aria-label="Toggle spreadsheet read-only mode"
                >
                  <span
                    className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow-sm ring-0 transition duration-200 ease-in-out ${
                      isReadOnlyMode ? 'translate-x-5' : 'translate-x-0'
                    }`}
                  />
                </button>
              </div>
            </div>

            {/* Collapsible Apps Script Code Section */}
            <div className="border border-emerald-100 rounded-xl overflow-hidden bg-emerald-50/30">
              <button
                type="button"
                onClick={() => setShowScriptCode(!showScriptCode)}
                className="w-full px-4 py-3 bg-emerald-50/50 hover:bg-emerald-50 text-left text-xs font-bold text-emerald-800 flex justify-between items-center transition"
              >
                <span>🛠️ Step-by-Step Guide: How to enable WRITE and Push capabilities?</span>
                <span className="text-emerald-600 underline text-[11px] font-semibold">
                  {showScriptCode ? "Hide Instructions" : "Show Instructions & Code"}
                </span>
              </button>

              {showScriptCode && (
                <div className="p-4 border-t border-emerald-100 space-y-3.5 text-xs text-gray-700 leading-relaxed bg-white">
                  <p>
                    Since Google Sheets API keys are <strong>read-only</strong> by design, you need to set up a short, free Google Apps Script Web App on your sheet to enable writing (exporting/overwriting) data from this application.
                  </p>
                  
                  <div className="space-y-2">
                    <p className="font-bold text-gray-900">Follow these 5 simple steps to set up write support in 1 minute:</p>
                    <ol className="list-decimal list-inside space-y-1.5 text-gray-600 pl-1">
                      <li>Open your Google Sheet, and in the top menu click <strong className="text-gray-950">Extensions</strong> &rarr; <strong className="text-gray-950">Apps Script</strong>.</li>
                      <li>Delete any code in the editor, paste the script code shown below, and click the 💾 <strong className="text-gray-950">Save</strong> icon.</li>
                      <li>Click <strong className="text-gray-950">Deploy</strong> (top right) &rarr; <strong className="text-gray-950">New deployment</strong>.</li>
                      <li>Select type <strong className="text-gray-950">Web app</strong>. Change <em>"Who has access"</em> to <strong className="text-emerald-700">Anyone</strong> (this is crucial for the app to connect) and click <strong className="text-gray-950">Deploy</strong>.</li>
                      <li>Authorize access if prompted, copy the generated <strong className="text-emerald-700">Web app URL</strong>, paste it into the field above, and click <strong className="text-gray-950">Save Configuration</strong>!</li>
                    </ol>
                  </div>

                  {/* Warning alert about Google Apps Script Caching / Deployments */}
                  <div className="p-3.5 bg-amber-50 border border-amber-200 rounded-xl space-y-2">
                    <h5 className="font-bold text-amber-900 flex items-center gap-1.5 text-[12px]">
                      ⚠️ CRITICAL: Did you update your Google Apps Script Deployment? (Caching Alert)
                    </h5>
                    <p className="text-amber-800 text-[11px] leading-relaxed">
                      Google Sheets Web Apps are <strong>heavily cached</strong>. If you simply click "Save" in the script editor without correctly deploying it, Google will <strong>keep running your old code</strong> (which used to clear the whole sheet and erase columns I, J, K, etc.).
                    </p>
                    <p className="text-amber-800 text-[11px] font-semibold leading-relaxed">
                      To apply this fix and preserve columns I, J, K, etc. forever:
                    </p>
                    <ul className="list-disc list-inside text-amber-800 text-[11px] space-y-1 pl-1">
                      <li>Either click <strong className="text-gray-950">Deploy &rarr; New deployment</strong> in Apps Script and copy the <strong>NEW Web App URL</strong>.</li>
                      <li>Or click <strong className="text-gray-950">Deploy &rarr; Manage deployments</strong>, click the pencil edit icon, change the Version dropdown to <strong className="text-amber-950 font-bold">"New version"</strong>, and click <strong className="text-gray-950">Deploy</strong>.</li>
                    </ul>
                  </div>

                  <div className="space-y-1.5">
                    <div className="flex justify-between items-center">
                      <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">Paste this Apps Script Code:</span>
                      <button
                        type="button"
                        onClick={() => {
                          navigator.clipboard.writeText(APPS_SCRIPT_CODE);
                          alert("Apps Script Code copied to clipboard!");
                        }}
                        className="px-2.5 py-1 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 text-[11px] font-bold rounded-lg border border-emerald-200 transition"
                      >
                        Copy Script Code
                      </button>
                    </div>
                    <pre className="p-3 bg-slate-900 text-slate-100 rounded-xl font-mono text-[10px] overflow-x-auto max-h-48 leading-relaxed select-all">
                      {APPS_SCRIPT_CODE}
                    </pre>
                  </div>
                </div>
                )/* END showScriptCode */ }
            </div>

            {/* Live Connection Diagnostics Panel */}
            <div className="border border-sky-100 rounded-xl overflow-hidden bg-sky-50/20 p-4 space-y-3">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <h4 className="text-xs font-bold text-sky-950 flex items-center gap-1.5">
                    <Activity size={14} className="text-sky-600" />
                    <span>Live Connection & Credentials Diagnostics Test</span>
                  </h4>
                  <p className="text-[10px] text-gray-500 mt-0.5">
                    Test your API key, Spreadsheet ID, and Apps Script URL settings instantly with helpful troubleshooters.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={runDiagnostics}
                  disabled={isDiagnosing}
                  className="px-3 py-1.5 bg-sky-600 hover:bg-sky-700 disabled:bg-sky-400 text-white text-xs font-bold rounded-lg transition shrink-0 flex items-center gap-1.5 shadow-xs"
                >
                  {isDiagnosing ? <Loader2 size={12} className="animate-spin" /> : <Play size={12} />}
                  <span>{isDiagnosing ? "Testing..." : "Run Connection Test"}</span>
                </button>
              </div>

              {diagnosticLogs.length > 0 && (
                <div className="p-3 bg-slate-900 rounded-xl font-mono text-[10px] sm:text-[11px] leading-relaxed max-h-56 overflow-y-auto space-y-1.5 select-text text-slate-300">
                  {diagnosticLogs.map((logItem, index) => {
                    let textColor = 'text-slate-300';
                    if (logItem.type === 'success') textColor = 'text-emerald-400 font-bold';
                    if (logItem.type === 'error') textColor = 'text-red-400 font-bold';
                    return (
                      <div key={index} className={`whitespace-pre-wrap ${textColor}`}>
                        {logItem.text}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="flex justify-between items-center bg-gray-50 -mx-5 -mb-5 px-5 py-3 rounded-b-xl border-t border-gray-100">
              {v4SpreadsheetId && (
                <a 
                  href={`https://docs.google.com/spreadsheets/d/${v4SpreadsheetId}/edit`}
                  target="_blank"
                  referrerPolicy="no-referrer"
                  className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-600 hover:text-emerald-700"
                >
                  <span>Open Connected Google Sheet</span>
                  <ExternalLink size={12} />
                </a>
              )}
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={resetToDefaults}
                  className="px-3 py-1.5 border border-amber-200 bg-amber-50 hover:bg-amber-100 text-amber-700 text-xs font-semibold rounded-lg transition"
                  title="Reset connection parameters to default"
                >
                  Reset Defaults
                </button>
                <button
                  onClick={() => setIsConfigOpen(false)}
                  className="px-3 py-1.5 border border-gray-200 bg-white hover:bg-gray-50 text-gray-600 text-xs font-semibold rounded-lg transition"
                >
                  Cancel
                </button>
                <button
                  onClick={saveConfig}
                  className="px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-lg transition"
                >
                  Save Configuration
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Navigation Tabs */}
        <div className="flex border-b border-gray-200">
          <button
            onClick={() => setActiveTab('local')}
            className={`flex-1 sm:flex-none px-6 py-3 font-semibold text-xs sm:text-sm border-b-2 transition-all flex items-center justify-center gap-2 ${
              activeTab === 'local'
                ? 'border-emerald-600 text-emerald-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            <Users size={16} />
            <span>Local Ledger Accounts ({localParties.length})</span>
            {isAutoSyncing && (
              <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" title="Real-time Auto-sync active" />
            )}
          </button>
          <button
            onClick={() => setActiveTab('spreadsheet')}
            className={`flex-1 sm:flex-none px-6 py-3 font-semibold text-xs sm:text-sm border-b-2 transition-all flex items-center justify-center gap-2 ${
              activeTab === 'spreadsheet'
                ? 'border-emerald-600 text-emerald-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            <FileSpreadsheet size={16} />
            <span>Google Sheets Preview ({v4Parties.length})</span>
          </button>
        </div>

        {activeTab === 'local' ? (
          <div className="space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-emerald-50/40 p-4 rounded-xl border border-emerald-100/50">
              <div className="flex items-start gap-2.5 text-emerald-800 text-xs sm:text-sm font-medium">
                <div className="h-2.5 w-2.5 rounded-full bg-emerald-500 animate-pulse shrink-0 mt-1.5" />
                <span>
                  <strong>1-Second Auto-Scanning & Syncing:</strong> Any local ledger changes (new transactions or updated email addresses) are automatically scanned every single second and synchronized to Google Sheets in real-time.
                </span>
              </div>
              <div className="flex items-center gap-2 shrink-0 self-end sm:self-auto">
                <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">Auto-Sync</span>
                <button
                  onClick={() => toggleAutoSync(!isAutoSyncing)}
                  className={`relative inline-flex h-5 w-10 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                    isAutoSyncing ? 'bg-emerald-600' : 'bg-gray-200'
                  }`}
                  aria-label="Toggle auto-sync"
                >
                  <span
                    className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow-sm ring-0 transition duration-200 ease-in-out ${
                      isAutoSyncing ? 'translate-x-5' : 'translate-x-0'
                    }`}
                  />
                </button>
              </div>
            </div>

            <div className="border border-gray-100 rounded-xl overflow-hidden bg-white">
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse table-fixed min-w-[600px]">
                  <thead>
                    <tr className="border-b border-gray-100 text-[10px] uppercase tracking-wider text-gray-400 bg-gray-50/50 font-bold">
                      <th className="p-3 pl-5 font-semibold w-[30%]">Party / Customer Name</th>
                      <th className="p-3 font-semibold w-[30%]">Contact Details</th>
                      <th className="p-3 font-semibold w-[20%] text-center">Sync Status</th>
                      <th className="p-3 text-right font-semibold w-[20%] pr-5">Outstanding (₹)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50 text-xs sm:text-sm">
                    {localParties.length > 0 ? (
                      localParties.map((p, idx) => {
                        const sync = getPartySyncStatus(p);
                        return (
                          <tr key={p.id || idx} className="hover:bg-gray-50/30 transition-colors">
                            <td className="p-3 pl-5 font-medium text-gray-900 truncate">
                              <span className="truncate">{p.name}</span>
                              {p.status === 'Inactive' && (
                                <span className="ml-1.5 px-1.5 py-0.5 bg-gray-100 text-gray-400 text-[9px] font-semibold rounded-md">Inactive</span>
                              )}
                            </td>
                            <td className="p-3 text-gray-500 text-[11px] space-y-1">
                              {p.email ? (
                                <div className="flex items-center gap-1.5 font-mono truncate">
                                  <Mail size={12} className="text-gray-400 shrink-0" />
                                  <span className="truncate">{p.email}</span>
                                </div>
                              ) : (
                                <div className="text-gray-300 italic">No email</div>
                              )}
                              {p.phone ? (
                                <div className="flex items-center gap-1.5 font-mono truncate font-semibold text-slate-700">
                                  <span className="text-xs text-gray-400 font-bold">📞</span>
                                  <span className="truncate">{p.phone}</span>
                                </div>
                              ) : (
                                <div className="text-gray-300 italic">No phone</div>
                              )}
                            </td>
                            <td className="p-3 text-center">
                              <span className={`inline-flex items-center px-2.5 py-0.5 border text-[10px] font-bold rounded-full ${sync.style}`}>
                                {sync.label}
                              </span>
                            </td>
                            <td className="p-3 text-right pr-5 font-bold text-red-600">
                              ₹ {(p.currentDue || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                            </td>
                          </tr>
                        );
                      })
                    ) : (
                      <tr>
                        <td colSpan={4} className="p-10 text-center text-gray-400 text-xs">
                          <p>No active parties found in the current ledger.</p>
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        ) : (
          /* Live Records Viewer (Read-only representation) */
          <div className="space-y-4 animate-in fade-in duration-150">
            {v4Parties.length > 0 && (
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-sky-50/50 p-4 rounded-xl border border-sky-100">
                <div className="space-y-1">
                  <p className="text-xs sm:text-sm font-bold text-sky-950 flex items-center gap-1.5">
                    <UserPlus size={16} className="text-sky-600" />
                    <span>Import these accounts into your App's Party List</span>
                  </p>
                  <p className="text-[11px] text-gray-500">
                    Create actual party records inside the active ledger for any customers found on the Google Sheet.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={importSheetPartiesToApp}
                  disabled={isImporting || isFetching}
                  className="px-4 py-2 bg-sky-600 hover:bg-sky-700 disabled:bg-sky-400 text-white text-xs font-bold rounded-xl shadow-xs transition flex items-center justify-center gap-1.5 self-end sm:self-auto shrink-0"
                >
                  {isImporting ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
                  <span>Import {v4Parties.length} Parties</span>
                </button>
              </div>
            )}

            <div className="flex items-center justify-between">
              <h3 className="font-bold text-xs sm:text-sm text-gray-900 flex items-center gap-1.5">
                <FileSpreadsheet size={16} className="text-gray-400" />
                <span>Spreadsheet Records Preview ({v4Parties.length})</span>
              </h3>
              <span className="text-[10px] text-gray-400 uppercase font-bold tracking-wider">Read Only Representation</span>
            </div>

            <div className="border border-gray-100 rounded-xl overflow-hidden bg-white">
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse table-fixed min-w-[500px]">
                  <thead>
                    <tr className="border-b border-gray-100 text-[10px] uppercase tracking-wider text-gray-400 bg-gray-50/50 font-bold">
                      <th className="p-3 pl-5 font-semibold w-2/5">Party / Customer Name</th>
                      <th className="p-3 font-semibold w-2/5">Contact Details</th>
                      <th className="p-3 text-right font-semibold w-1/5 pr-5">Outstanding (₹)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50 text-xs sm:text-sm">
                    {v4Parties.length > 0 ? (
                      v4Parties.map((p, idx) => {
                        const amount = Number(p.outstandingAmount) || 0;
                        return (
                          <tr key={idx} className="hover:bg-gray-50/30 transition-colors">
                            <td className="p-3 pl-5 font-medium text-gray-900 truncate">{p.partyName}</td>
                            <td className="p-3 text-gray-500 text-[11px] space-y-1">
                              {p.email ? (
                                <div className="flex items-center gap-1.5 font-mono truncate">
                                  <Mail size={12} className="text-gray-400 shrink-0" />
                                  <span className="truncate">{p.email}</span>
                                </div>
                              ) : (
                                <div className="text-gray-300 italic">No email</div>
                              )}
                              {p.phone ? (
                                <div className="flex items-center gap-1.5 font-mono truncate font-semibold text-slate-700">
                                  <span className="text-xs text-gray-400 font-bold">📞</span>
                                  <span className="truncate">{p.phone}</span>
                                </div>
                              ) : (
                                <div className="text-gray-300 italic font-mono">No phone</div>
                              )}
                            </td>
                            <td className="p-3 text-right pr-5 font-bold text-red-600">
                              ₹ {amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                            </td>
                          </tr>
                        );
                      })
                    ) : (
                      <tr>
                        <td colSpan={3} className="p-10 text-center text-gray-400 text-xs">
                          {isFetching ? (
                            <div className="flex flex-col items-center gap-2">
                              <Loader2 size={24} className="animate-spin text-emerald-500" />
                              <p>Loading party accounts from spreadsheet...</p>
                            </div>
                          ) : (
                            <div className="max-w-md mx-auto py-6 px-4 space-y-4 text-center">
                              <div className="mx-auto w-12 h-12 bg-amber-50 rounded-full flex items-center justify-center text-amber-500 animate-pulse">
                                <FileSpreadsheet size={24} />
                              </div>
                              <div className="space-y-1.5">
                                <p className="font-bold text-gray-900 text-sm">Spreadsheet connected successfully!</p>
                                <p className="text-xs text-gray-500 leading-relaxed">
                                  Your Google Sheet was read successfully, but it currently does not contain any customer accounts below row 1 (the headers).
                                </p>
                              </div>
                              <div className="p-3.5 bg-slate-50 border border-slate-150 rounded-xl text-left space-y-2 text-[11px] text-gray-600">
                                <p className="font-bold text-gray-800">To show data here, you can either:</p>
                                <ul className="list-disc list-inside space-y-1.5 pl-1">
                                  <li>
                                    Click <strong className="text-gray-900">Export Ledger to Sheet</strong> under the Local tab to write your app's local party list into the spreadsheet.
                                  </li>
                                  <li>
                                    Open your Google Sheet and add some rows below the headers: <code className="bg-white px-1 py-0.5 border border-gray-200 rounded text-amber-700">Party Name</code>, <code className="bg-white px-1 py-0.5 border border-gray-200 rounded text-amber-700">Address</code>, <code className="bg-white px-1 py-0.5 border border-gray-200 rounded text-amber-700">Opening Balance</code>, <code className="bg-white px-1 py-0.5 border border-gray-200 rounded text-amber-700">Recent Debit</code>, <code className="bg-white px-1 py-0.5 border border-gray-200 rounded text-amber-700">Recent Credit</code>, <code className="bg-white px-1 py-0.5 border border-gray-200 rounded text-amber-700">Current Balance</code>, <code className="bg-white px-1 py-0.5 border border-gray-200 rounded text-amber-700">Email ID</code>, and <code className="bg-white px-1 py-0.5 border border-gray-200 rounded text-amber-700">Contact Number</code>, and then click <strong className="text-gray-900">Sync Now</strong>!
                                  </li>
                                </ul>
                              </div>
                              <div className="flex flex-wrap items-center justify-center gap-2 pt-1">
                                {rawSheetData.length > 0 && (
                                  <button
                                    type="button"
                                    onClick={() => setShowRawGrid(!showRawGrid)}
                                    className="px-3.5 py-2 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 text-xs font-bold rounded-xl transition inline-flex items-center gap-1.5"
                                  >
                                    {showRawGrid ? 'Hide Raw Spreadsheet Data' : 'Inspect Connected Sheet Data'}
                                  </button>
                                )}
                                <a 
                                  href={`https://docs.google.com/spreadsheets/d/${v4SpreadsheetId}/edit`}
                                  target="_blank"
                                  referrerPolicy="no-referrer"
                                  className="px-3.5 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-xl transition inline-flex items-center gap-1.5"
                                >
                                  <span>Open Google Sheet</span>
                                  <ExternalLink size={12} />
                                </a>
                              </div>
                            </div>
                          )}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* RAW SHEET DATA INSPECTOR GRID */}
            {rawSheetData.length > 0 && (
              <div className="border border-sky-100 rounded-2xl bg-sky-50/10 p-5 space-y-4 animate-in fade-in duration-150">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="space-y-1">
                    <p className="text-xs sm:text-sm font-bold text-sky-950 flex items-center gap-1.5">
                      <FileSpreadsheet size={16} className="text-sky-600" />
                      <span>Raw Google Sheet Grid Inspector</span>
                    </p>
                    <p className="text-[11px] text-gray-500">
                      Showing the exact raw cell data retrieved from your spreadsheet. Use this to verify column positions.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowRawGrid(!showRawGrid)}
                    className="px-3.5 py-1.5 bg-white border border-gray-200 hover:bg-gray-50 text-slate-700 text-xs font-bold rounded-xl transition shadow-2xs self-start sm:self-auto shrink-0"
                  >
                    {showRawGrid ? 'Hide Grid' : 'Inspect Raw Columns Grid'}
                  </button>
                </div>

                {showRawGrid && (
                  <div className="border border-slate-150 rounded-xl overflow-hidden bg-white max-h-80 overflow-y-auto shadow-2xs">
                    <div className="overflow-x-auto">
                      <table className="w-full text-left border-collapse font-mono text-[11px] min-w-[500px]">
                        <thead>
                          <tr className="border-b border-slate-200 bg-slate-50 text-slate-500 font-bold">
                            <th className="p-2.5 text-center w-12 border-r border-slate-100 bg-slate-50 font-bold">Row</th>
                            {Array.from({ length: Math.max(...rawSheetData.map(r => Array.isArray(r) ? r.length : 0), 3) }).map((_, colIdx) => (
                              <th key={colIdx} className="p-2.5 border-r border-slate-100 font-bold">
                                Col {colIdx + 1} ({String.fromCharCode(65 + colIdx)})
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {rawSheetData.map((row, rowIdx) => {
                            const isRowArray = Array.isArray(row);
                            const colsCount = Math.max(...rawSheetData.map(r => Array.isArray(r) ? r.length : 0), 3);
                            return (
                              <tr key={rowIdx} className={rowIdx === 0 ? "bg-amber-50/50 text-amber-950 font-bold border-b border-amber-100" : "hover:bg-slate-50/40"}>
                                <td className="p-2.5 text-center text-slate-400 bg-slate-50 border-r border-slate-150 font-bold">{rowIdx + 1}</td>
                                {Array.from({ length: colsCount }).map((_, colIdx) => {
                                  const cellVal = isRowArray ? row[colIdx] : (colIdx === 0 ? row.partyName : (colIdx === 1 ? row.outstandingAmount : row.email));
                                  return (
                                    <td key={colIdx} className="p-2.5 border-r border-slate-100 truncate max-w-[200px]" title={cellVal ? String(cellVal) : ''}>
                                      {cellVal !== undefined ? String(cellVal) : <span className="text-gray-300 italic">Empty</span>}
                                    </td>
                                  );
                                })}
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
