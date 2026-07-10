/**
 * Permanent Google Sheets Configuration for Greenzar App
 * 
 * These settings are hardcoded to ensure that the Google Sheets Dashboard 
 * and synchronization connection work automatically in any deployment environment 
 * (including Render, Netlify, Vercel, and local execution) without depending 
 * on local .env files.
 * 
 * If values are configured in localStorage or process.env, they will take precedence,
 * but these serve as the reliable permanent fallback.
 */

export const GOOGLE_SHEETS_CONFIG = {
  // 1. Google Spreadsheet ID
  // Corresponds to GOOGLE_SPREADSHEET_ID
  SPREADSHEET_ID: "1sHj-A4tGwcDXVuMjAe5tHblN9qMy1rtjpPHfRDDTapw",

  // 2. Google Sheets API Key (V4 API Key)
  // Corresponds to GOOGLE_SHEETS_API_KEY
  API_KEY: "AIzaSyCknGPyQu5Je8GEeneBeSmUjLHdzLQY1U0",

  // 3. Google Apps Script Web App URL
  // Corresponds to GOOGLE_SHEET_URL
  APPS_SCRIPT_URL: "https://script.google.com/macros/s/AKfycbzwA1bsYtS-x4p-EpYuupZrDvYNLqZmClZuYon4DS97duRthDEOr3XwDIIsMkPcONBA/exec",

  // 4. Default Tab Name and Cell Range settings
  DEFAULT_TAB_NAME: "Sheet1",
  DEFAULT_RANGE: "Sheet1!A2:H",

  // 5. Realtime Sync state (enabled by default)
  REALTIME_SYNC_DEFAULT: true
};
