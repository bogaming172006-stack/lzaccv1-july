export interface SheetsConfig {
  spreadsheetId: string;
  apiKey: string;
  range: string;
  appsScriptUrl: string;
  sheetTitle: string;
  isReadOnlyMode: boolean;
  isAutoSyncing: boolean;
  isCustom: boolean;
}

let cachedConfig: SheetsConfig | null = null;
let lastFetchTime = 0;
const CACHE_TTL = 10000; // 10 seconds cache TTL for high-performance background scan retrieval

export async function fetchSheetsConfig(forceRefresh = false): Promise<SheetsConfig> {
  if (cachedConfig && !forceRefresh && (Date.now() - lastFetchTime < CACHE_TTL)) {
    return cachedConfig;
  }

  try {
    const res = await fetch('/api/sheets/config');
    if (!res.ok) {
      throw new Error(`HTTP error! status: ${res.status}`);
    }
    const data = await res.json();
    cachedConfig = {
      spreadsheetId: data.spreadsheetId || '',
      apiKey: data.apiKey || '',
      range: data.range || 'Sheet1!A2:H',
      appsScriptUrl: data.appsScriptUrl || '',
      sheetTitle: data.sheetTitle || data.range?.split('!')[0] || 'Sheet1',
      isReadOnlyMode: data.isReadOnlyMode !== undefined ? data.isReadOnlyMode : true,
      isAutoSyncing: data.isAutoSyncing !== undefined ? data.isAutoSyncing : true,
      isCustom: !!data.isCustom
    };
    lastFetchTime = Date.now();
    return cachedConfig;
  } catch (error) {
    console.error('Failed to fetch Sheets config:', error);
    if (cachedConfig) {
      return cachedConfig;
    }
    // Hard fallback if backend call fails completely
    return {
      spreadsheetId: '1hIbrec_nTB3Q6BmPiunFZeWYC133v_uPbsLK8eROnVM',
      apiKey: 'AIzaSyCknGPyQu5Je8GEeneBeSmUjLHdzLQY1U0',
      range: 'Sheet1!A2:H',
      appsScriptUrl: 'https://script.google.com/macros/s/AKfycbxeZS3qlxhBpTFGsKQCjPqC5tNOgG9RgvZ6pB3QragZDNIbygXf6Dy7EEpE5pJkQLUM/exec',
      sheetTitle: 'Sheet1',
      isReadOnlyMode: true,
      isAutoSyncing: true,
      isCustom: false
    };
  }
}

export async function saveSheetsConfig(config: Omit<SheetsConfig, 'isCustom'>): Promise<boolean> {
  try {
    const res = await fetch('/api/sheets/config', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(config)
    });
    if (res.ok) {
      const data = await res.json();
      if (data.success) {
        cachedConfig = { ...config, isCustom: true };
        lastFetchTime = Date.now();
        return true;
      }
    }
    return false;
  } catch (error) {
    console.error('Failed to save Sheets config:', error);
    return false;
  }
}

export async function resetSheetsConfig(): Promise<SheetsConfig> {
  try {
    const res = await fetch('/api/sheets/config', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ reset: true })
    });
    if (res.ok) {
      cachedConfig = null;
      lastFetchTime = 0;
      return await fetchSheetsConfig(true);
    }
  } catch (error) {
    console.error('Failed to reset Sheets config:', error);
  }
  
  cachedConfig = null;
  lastFetchTime = 0;
  return await fetchSheetsConfig(true);
}
