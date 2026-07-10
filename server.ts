import express from "express";
import path from "path";
import dotenv from "dotenv";
import { createClient } from "@libsql/client";

// Load environment variables
dotenv.config({ override: true });

const app = express();
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;

// Rewrite Netlify Functions path prefix to standard API routes before any routing
app.use((req, res, next) => {
  if (req.url.startsWith("/.netlify/functions/api")) {
    req.url = req.url.replace("/.netlify/functions/api", "/api");
  }
  next();
});

// Enable CORS for external frontends like Netlify
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") {
    return res.sendStatus(200);
  }
  next();
});

// Body parser with 50mb limit for database backup/restore operations
app.use(express.json({ limit: "50mb" }));

// Predefined Tables
const TABLES = [
  "users", 
  "ledgers", 
  "parties", 
  "products", 
  "tracked_invoices", 
  "settings", 
  "transactions", 
  "balances", 
  "daily_summaries", 
  "dashboard_summary", 
  "cache_versions"
];

// Turso client instance
let tursoClientInstance: any = null;
let useLocalFallback = false;

function getTurso() {
  if (useLocalFallback) {
    if (!tursoClientInstance || tursoClientInstance._isRemote) {
      console.log("[Database] Using local SQLite file-based fallback database (file:local.db)");
      tursoClientInstance = createClient({
        url: "file:local.db"
      });
      tursoClientInstance._isRemote = false;
    }
    return tursoClientInstance;
  }

  if (!tursoClientInstance) {
    let url = (process.env.TURSO_DB_URL || "").trim().replace(/[\r\n]/g, "");
    let authToken = (process.env.TURSO_DB_AUTH_TOKEN || "").trim().replace(/[\r\n]/g, "");
    
    // Hardcode fallback Turso credentials to permanently connect the database even if .env is missing/deleted
    if (!url || url === "libsql://placeholder.turso.io" || url.includes("placeholder")) {
      url = "libsql://greenzardbv2-greenzaraccountdpv2.aws-ap-south-1.turso.io";
      authToken = "eyJhbGciOiJFZERTQSIsInR5cCI6IkpXVCJ9.eyJhIjoicnciLCJpYXQiOjE3ODI5ODgwOTQsImlkIjoiMDE5ZjIyNWUtMzYwMS03MjViLWFmZDUtMGU0MTQ0OTI4MmMxIiwia2lkIjoicGhNRTdpT0xCWDFMMnI2blJmVDJHanJjN1ZWNzRldURLSjNXTWdwYVFfYyIsInJpZCI6IjI5MGZjODJiLWZmOWUtNGFkZi1iM2U2LTA0MGZjYWIyM2Y1ZiJ9.jxqQcPtg-DF6rFxzkK8P7qtjd5pSl3lKiNHSWRRnKzjcLHexOpqOKTnYSC_1q4zkt2GPZKwSCv5sG6SMyz41BA";
    }

    if (!url || url === "libsql://placeholder.turso.io" || url.includes("placeholder")) {
      console.log("[Database] No valid TURSO_DB_URL configured. Falling back to local SQLite file:local.db");
      useLocalFallback = true;
      tursoClientInstance = createClient({
        url: "file:local.db"
      });
      tursoClientInstance._isRemote = false;
    } else {
      console.log("[Database] Initializing Turso connection to:", url);
      tursoClientInstance = createClient({ 
        url, 
        authToken: authToken || undefined 
      });
      tursoClientInstance._isRemote = true;
    }
  }
  return tursoClientInstance;
}

// Wrapper client to support seamless, automatic local fallback if remote Turso returns 401/unauthorized or other server errors
class SafeLibsqlClient {
  private getUnderlyingClient() {
    return getTurso();
  }

  async execute(stmt: any) {
    try {
      const client = this.getUnderlyingClient();
      return await client.execute(stmt);
    } catch (err: any) {
      if (this.isAuthOrServerError(err)) {
        await this.triggerFallback();
        return await this.getUnderlyingClient().execute(stmt);
      }
      throw err;
    }
  }

  async batch(stmts: any[], mode?: any) {
    try {
      const client = this.getUnderlyingClient();
      return await client.batch(stmts, mode);
    } catch (err: any) {
      if (this.isAuthOrServerError(err)) {
        await this.triggerFallback();
        return await this.getUnderlyingClient().batch(stmts, mode);
      }
      throw err;
    }
  }

  async transaction(mode?: any) {
    try {
      const client = this.getUnderlyingClient();
      const tx = await client.transaction(mode);
      return this.wrapTransaction(tx);
    } catch (err: any) {
      if (this.isAuthOrServerError(err)) {
        await this.triggerFallback();
        const client = this.getUnderlyingClient();
        const tx = await client.transaction(mode);
        return this.wrapTransaction(tx);
      }
      throw err;
    }
  }

  private isAuthOrServerError(err: any): boolean {
    const msg = (err?.message || String(err)).toLowerCase();
    return msg.includes("401") || msg.includes("unauthorized") || msg.includes("server_error") || msg.includes("forbidden") || msg.includes("invalid client") || msg.includes("failed to fetch");
  }

  private async triggerFallback() {
    if (!useLocalFallback) {
      console.warn("[Database Fallback] Remote Turso connection failed with authentication or server error. Switching to local SQLite fallback database (file:local.db)...");
      useLocalFallback = true;
      tursoClientInstance = null; // force recreation of getTurso() with file:local.db
      tablesInitialized = false; // force re-initialization of tables
      const client = getTurso();
      await ensureTablesExist(client);
    }
  }

  private wrapTransaction(tx: any) {
    return {
      execute: async (stmt: any) => {
        try {
          return await tx.execute(stmt);
        } catch (err: any) {
          if (this.isAuthOrServerError(err)) {
            console.warn("[Database Fallback] Transaction execute failed with auth/server error, triggering fallback...");
            await this.triggerFallback();
            throw new Error("Database fallback triggered. Please retry operation.");
          }
          throw err;
        }
      },
      commit: async () => {
        try {
          return await tx.commit();
        } catch (err: any) {
          if (this.isAuthOrServerError(err)) {
            console.warn("[Database Fallback] Transaction commit failed with auth/server error, triggering fallback...");
            await this.triggerFallback();
            throw new Error("Database fallback triggered. Please retry operation.");
          }
          throw err;
        }
      },
      rollback: async () => {
        try {
          return await tx.rollback();
        } catch (err: any) {
          console.warn("[Database Fallback] Transaction rollback failed:", err.message);
        }
      }
    };
  }
}

const safeClient = new SafeLibsqlClient();

// Compile a query structure into SQLite SQL
function compileQueryToSql(colName: string, clauses: any[]): { sql: string; args: any[] } {
  let sql = `SELECT data FROM ${colName}`;
  const args: any[] = [];
  const whereParts: string[] = [];
  let orderByPart = "";
  let limitPart = "";

  const clausesList = clauses || [];
  for (const clause of clausesList) {
    if (clause.type === "where") {
      const { field, op, value } = clause;
      if (/^[a-zA-Z0-9_]+$/.test(field)) {
        const sqlField = `json_extract(data, '$.${field}')`;
        if (op === "==" || op === "=") {
          whereParts.push(`${sqlField} = ?`);
          args.push(typeof value === "boolean" ? (value ? 1 : 0) : value);
        } else if (op === "in") {
          if (Array.isArray(value) && value.length > 0) {
            const placeholders = value.map(() => "?").join(", ");
            whereParts.push(`${sqlField} IN (${placeholders})`);
            args.push(...value);
          } else {
            whereParts.push("1 = 0");
          }
        } else {
          whereParts.push(`${sqlField} ${op} ?`);
          args.push(value);
        }
      }
    } else if (clause.type === "orderBy") {
      const { field, direction } = clause;
      if (/^[a-zA-Z0-9_]+$/.test(field)) {
        orderByPart = ` ORDER BY json_extract(data, '$.${field}') ${direction.toUpperCase()}`;
      }
    } else if (clause.type === "limit") {
      const limitVal = Number(clause.value);
      if (!isNaN(limitVal)) {
        limitPart = ` LIMIT ${limitVal}`;
      }
    }
  }

  if (whereParts.length > 0) {
    sql += ` WHERE ${whereParts.join(" AND ")}`;
  }
  sql += orderByPart;
  sql += limitPart;

  return { sql, args };
}

let tablesInitialized = false;
async function ensureTablesExist(client: any) {
  if (tablesInitialized) return;
  for (const col of TABLES) {
    await client.execute(`CREATE TABLE IF NOT EXISTS ${col} (id TEXT PRIMARY KEY, data TEXT)`);
  }
  await ensureIndexesExist(client);
  tablesInitialized = true;
}

async function ensureIndexesExist(client: any) {
  const indexStatements = [
    "CREATE INDEX IF NOT EXISTS idx_parties_ledgerId ON parties(json_extract(data, '$.ledgerId'))",
    "CREATE INDEX IF NOT EXISTS idx_transactions_ledgerId ON transactions(json_extract(data, '$.ledgerId'))",
    "CREATE INDEX IF NOT EXISTS idx_transactions_partyId ON transactions(json_extract(data, '$.partyId'))",
    "CREATE INDEX IF NOT EXISTS idx_transactions_invoiceNo ON transactions(json_extract(data, '$.invoiceNo'))",
    "CREATE INDEX IF NOT EXISTS idx_balances_ledgerId ON balances(json_extract(data, '$.ledgerId'))",
    "CREATE INDEX IF NOT EXISTS idx_balances_partyId ON balances(json_extract(data, '$.partyId'))",
    "CREATE INDEX IF NOT EXISTS idx_tracked_invoices_ledgerId ON tracked_invoices(json_extract(data, '$.ledgerId'))",
    "CREATE INDEX IF NOT EXISTS idx_tracked_invoices_invoiceNo ON tracked_invoices(json_extract(data, '$.invoiceNo'))",
    "CREATE INDEX IF NOT EXISTS idx_products_ledgerId ON products(json_extract(data, '$.ledgerId'))"
  ];
  for (const stmt of indexStatements) {
    try {
      await client.execute(stmt);
    } catch (e: any) {
      console.warn(`[Database] Failed to create index statement: ${stmt}. Error:`, e.message);
    }
  }
}

// ---------------------------------------------------------
// REST API ROUTES
// ---------------------------------------------------------

// Middleware to ensure Turso tables are initialized before handling any /api/db request
app.use("/api/db", async (req, res, next) => {
  if (req.path === "/connection-status") {
    return next();
  }
  try {
    const client = safeClient;
    await ensureTablesExist(client);
    next();
  } catch (err: any) {
    console.error("[Database Middleware] Failed to initialize tables:", err.message);
    next();
  }
});

// Connection check / diagnosis
app.get("/api/db/connection-status", async (req, res) => {
  let url = process.env.TURSO_DB_URL;
  if (!url || url.trim() === "" || url === "libsql://placeholder.turso.io") {
    url = "libsql://greenzardbv2-greenzaraccountdpv2.aws-ap-south-1.turso.io";
  }

  try {
    if (useLocalFallback) {
      return res.json({ status: "connected", url: "Local SQLite Fallback (file:local.db)", isFallback: true });
    }
    const client = getTurso();
    await client.execute("SELECT 1");
    res.json({ status: "connected", url });
  } catch (err: any) {
    console.warn("[Diagnostic] Connection fail:", err.message || String(err));
    res.json({ 
      status: "connection_error", 
      url: "Turso", 
      error: err.message || String(err) 
    });
  }
});

// Fetch single document
app.get("/api/db/:collectionName/:id", async (req, res) => {
  const { collectionName, id } = req.params;
  try {
    const client = safeClient;
    const result = await client.execute({
      sql: `SELECT data FROM ${collectionName} WHERE id = ?`,
      args: [id]
    });
    if (result.rows.length > 0) {
      const rawData = result.rows[0].data as string;
      res.json({ exists: true, data: JSON.parse(rawData) });
    } else {
      res.json({ exists: false, data: null });
    }
  } catch (error: any) {
    console.error(`Error fetching doc ${collectionName}/${id}:`, error);
    res.json({ error: error.message || String(error), exists: false, data: null });
  }
});

// Query multiple documents
app.post("/api/db/query", async (req, res) => {
  const { collection: colName, clauses } = req.body;
  try {
    const client = safeClient;
    const { sql, args } = compileQueryToSql(colName, clauses);
    const result = await client.execute({ sql, args });
    const docs = result.rows.map(row => JSON.parse(row.data as string));
    res.json({ docs });
  } catch (error: any) {
    console.error(`Query failed on table "${colName}":`, error);
    res.json({ error: error.message || String(error), docs: [] });
  }
});

// Batch write operations
app.post("/api/db/batch", async (req, res) => {
  const { operations } = req.body;
  if (!Array.isArray(operations)) {
    return res.json({ error: "Operations must be an array" });
  }

  try {
    const client = safeClient;
    const transaction = await client.transaction("write");
    try {
      for (const op of operations) {
        const { type, collection: colName, id, data, options } = op;
        if (type === "set") {
          let finalData = { ...data, id };
          if (options?.merge) {
            const current = await transaction.execute({
              sql: `SELECT data FROM ${colName} WHERE id = ?`,
              args: [id]
            });
            if (current.rows.length > 0) {
              const parsed = JSON.parse(current.rows[0].data as string);
              finalData = { ...parsed, ...data, id };
            }
          }
          await transaction.execute({
            sql: `INSERT OR REPLACE INTO ${colName} (id, data) VALUES (?, ?)`,
            args: [id, JSON.stringify(finalData)]
          });
        } else if (type === "update") {
          const current = await transaction.execute({
            sql: `SELECT data FROM ${colName} WHERE id = ?`,
            args: [id]
          });
          if (current.rows.length > 0) {
            const parsed = JSON.parse(current.rows[0].data as string);
            const finalData = { ...parsed, ...data, id };
            await transaction.execute({
              sql: `INSERT OR REPLACE INTO ${colName} (id, data) VALUES (?, ?)`,
              args: [id, JSON.stringify(finalData)]
            });
          }
        } else if (type === "delete") {
          await transaction.execute({
            sql: `DELETE FROM ${colName} WHERE id = ?`,
            args: [id]
          });
        }
      }
      await transaction.commit();
    } catch (err) {
      await transaction.rollback();
      throw err;
    }
    res.json({ success: true });
  } catch (error: any) {
    console.error("Batch operations failed:", error);
    res.json({ error: error.message || String(error) });
  }
});

// Admin utilities - recreate tables
app.post("/api/db/recreate-tables", async (req, res) => {
  try {
    const client = safeClient;
    for (const col of TABLES) {
      await client.execute(`CREATE TABLE IF NOT EXISTS ${col} (id TEXT PRIMARY KEY, data TEXT)`);
    }
    await ensureIndexesExist(client);
    res.json({ success: true, message: "Turso database tables and indexes successfully initialized!" });
  } catch (error: any) {
    res.json({ error: error.message || String(error) });
  }
});

// Admin utilities - wipe tables
app.post("/api/db/wipe-tables", async (req, res) => {
  try {
    const client = safeClient;
    for (const col of TABLES) {
      await client.execute(`DELETE FROM ${col}`);
    }
    res.json({ success: true, message: "Database reset complete! All data cleared from Turso tables." });
  } catch (error: any) {
    res.json({ error: error.message || String(error) });
  }
});

// Admin utilities - get stats
app.get("/api/db/stats", async (req, res) => {
  try {
    const client = safeClient;
    const stats = [];
    for (const col of TABLES) {
      try {
        const resQuery = await client.execute(`SELECT count(*) as count FROM ${col}`);
        const count = Number(resQuery.rows[0].count);
        stats.push({ tableName: col, count, exists: true });
      } catch (e) {
        stats.push({ tableName: col, count: 0, exists: false });
      }
    }
    res.json({ success: true, stats });
  } catch (error: any) {
    res.json({ error: error.message || String(error), stats: [] });
  }
});

// Admin utilities - backup
app.get("/api/db/backup", async (req, res) => {
  try {
    const client = safeClient;
    const backupData: any = {};
    for (const col of TABLES) {
      const result = await client.execute(`SELECT data FROM ${col}`);
      backupData[col] = result.rows.map(row => JSON.parse(row.data as string));
    }
    res.json(backupData);
  } catch (error: any) {
    res.json({ error: error.message || String(error) });
  }
});

// Admin utilities - restore
app.post("/api/db/restore", async (req, res) => {
  const backupData = req.body;
  if (!backupData || typeof backupData !== "object") {
    return res.json({ error: "Invalid backup data: must be an object." });
  }

  try {
    const client = safeClient;
    for (const col of TABLES) {
      await client.execute(`DELETE FROM ${col}`);
      const rows = backupData[col];
      if (Array.isArray(rows)) {
        for (const row of rows) {
          await client.execute({
            sql: `INSERT OR REPLACE INTO ${col} (id, data) VALUES (?, ?)`,
            args: [row.id, JSON.stringify(row)]
          });
        }
      }
    }
    res.json({ success: true, message: "Database restore completed successfully!" });
  } catch (error: any) {
    res.json({ error: error.message || String(error) });
  }
});

// ---------------------------------------------------------
// GOOGLE SHEETS LIVE PARTY LOOKUP (READ-ONLY PROXY API)
// ---------------------------------------------------------
app.get("/api/parties/export", async (req, res) => {
  const apiKey = (req.query.apiKey as string || req.headers["x-api-key"] as string || "").trim();
  const expectedKey = (process.env.GOOGLE_SHEETS_API_KEY || "AIzaSyCknGPyQu5Je8GEeneBeSmUjLHdzLQY1U0").trim();
  
  if (expectedKey && apiKey !== expectedKey) {
    return res.status(401).json({ error: "Unauthorized: Invalid API Key" });
  }

  try {
    const client = safeClient;
    const result = await client.execute("SELECT data FROM parties");
    const parties = result.rows.map(row => {
      try {
        const p = JSON.parse(row.data as string);
        return {
          party_name: p.name || p.partyName || "",
          outstanding: Number(p.currentDue || p.outstandingAmount || 0),
          email: p.email || ""
        };
      } catch (e) {
        return null;
      }
    }).filter(p => p !== null && p.party_name !== "");

    res.json(parties);
  } catch (error: any) {
    console.error("Failed to export parties:", error);
    res.status(500).json({ error: error.message || String(error) });
  }
});

// ---------------------------------------------------------
// GOOGLE SHEETS SYNC PROXY (WRITE PROXY API)
// ---------------------------------------------------------
app.post("/api/sheets/sync-proxy", async (req, res) => {
  const { appsScriptUrl, action, sheet, rows } = req.body;

  if (!appsScriptUrl) {
    return res.status(400).json({ error: "Missing appsScriptUrl" });
  }

  try {
    const response = await fetch(appsScriptUrl.trim(), {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ action, sheet, rows }),
      redirect: "follow"
    });

    const text = await response.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch (e) {
      return res.status(response.status).json({
        error: "Google Apps Script Web App did not return JSON. Please ensure your Web App is deployed with 'Anyone' access (not 'Only myself') and you have authorized the Google permissions.",
        rawText: text.substring(0, 500)
      });
    }

    res.status(response.status).json(data);
  } catch (error: any) {
    console.error("Google Sheets Sync Proxy Error:", error);
    res.status(500).json({ error: error.message || String(error) });
  }
});

// ---------------------------------------------------------
// GOOGLE SHEETS READ PROXY (READ PROXY API)
// ---------------------------------------------------------
app.get("/api/sheets/read-proxy", async (req, res) => {
  const appsScriptUrl = req.query.appsScriptUrl as string;
  const sheet = req.query.sheet as string || "Sheet1";

  if (!appsScriptUrl) {
    return res.status(400).json({ error: "Missing appsScriptUrl parameter" });
  }

  try {
    const separator = appsScriptUrl.includes("?") ? "&" : "?";
    const fetchUrl = `${appsScriptUrl.trim()}${separator}sheet=${encodeURIComponent(sheet.trim())}`;
    
    const response = await fetch(fetchUrl, {
      method: "GET",
      redirect: "follow"
    });

    const text = await response.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch (e) {
      return res.status(response.status).json({
        error: "Google Apps Script Web App did not return JSON. Please ensure your Web App is deployed with 'Anyone' access and you have authorized the Google permissions.",
        rawText: text.substring(0, 500)
      });
    }

    res.status(response.status).json(data);
  } catch (error: any) {
    console.error("Google Sheets Read Proxy Error:", error);
    res.status(500).json({ error: error.message || String(error) });
  }
});

// ---------------------------------------------------------
// GOOGLE SHEETS LIVE PARTY LOOKUP (READ-ONLY PROXY API)
// ---------------------------------------------------------
app.get("/api/parties/live", async (req, res) => {
  const spreadsheetId = (req.query.spreadsheetId as string || process.env.GOOGLE_SPREADSHEET_ID || "1sHj-A4tGwcDXVuMjAe5tHblN9qMy1rtjpPHfRDDTapw").trim();
  const apiKey = (req.query.apiKey as string || process.env.GOOGLE_SHEETS_API_KEY || "AIzaSyCknGPyQu5Je8GEeneBeSmUjLHdzLQY1U0").trim();
  const range = (req.query.range as string || "Sheet1!A2:H").trim();

  if (!spreadsheetId) {
    return res.status(400).json({ error: "Missing Google Spreadsheet ID. Please configure it in Settings or the configuration block." });
  }
  if (!apiKey) {
    return res.status(400).json({ error: "Missing Google Sheets API Key. Please configure it in Settings or the configuration block." });
  }

  try {
    const sheetsUrl = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}?key=${encodeURIComponent(apiKey)}`;
    const response = await fetch(sheetsUrl);
    
    if (!response.ok) {
      const errText = await response.text();
      let parsedErr;
      try {
        parsedErr = JSON.parse(errText);
      } catch (e) {
        parsedErr = { error: { message: errText } };
      }
      const errMsg = parsedErr.error?.message || `Google API responded with HTTP status ${response.status}`;
      return res.status(response.status).json({ error: errMsg });
    }

    const data = await response.json();
    const rows = data.values || [];

    const parties = rows.map((row: any[]) => {
      let partyName = "";
      let rawOutstanding = "0";
      let email = "";
      let phone = "";
      let address = "";

      if (row.length >= 8) {
        // 8-column standard: Party Name, Address, Opening Balance, Recent Debit, Recent Credit, Current Balance, Email ID, Contact Number
        partyName = String(row[0] || '').trim();
        address = String(row[1] || '').trim();
        rawOutstanding = String(row[5] || '0').trim();
        email = String(row[6] || '').trim();
        phone = String(row[7] || '').trim();
      } else {
        // 4-column fallback: Party Name, Outstanding (No.), Email Address, Contact Number
        partyName = String(row[0] || '').trim();
        rawOutstanding = String(row[1] || '0').trim();
        email = String(row[2] || '').trim();
        phone = String(row[3] || '').trim();
      }

      // Clean outstanding amount from commas, spaces, currency symbols
      const cleanNum = rawOutstanding.replace(/[^0-9.-]/g, '');
      const outstandingAmount = parseFloat(cleanNum) || 0;

      return {
        partyName,
        outstandingAmount,
        email,
        phone,
        address,
        rawOutstanding
      };
    }).filter((p: any) => p.partyName !== '');

    res.json({ success: true, parties });
  } catch (err: any) {
    console.error("Error proxying Google Sheets API v4 request:", err);
    res.status(500).json({ error: err.message || "An unexpected error occurred while communicating with Google Sheets." });
  }
});

// ---------------------------------------------------------
// STARTUP AND VITE SERVING
// ---------------------------------------------------------

async function startServer() {
  // Caching middleware for critical loading assets to make them load instantly
  app.use((req, res, next) => {
    if (req.path === "/loading.webm" || req.path === "/loading.mp4" || req.path === "/logo.png") {
      res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    }
    next();
  });

  if (process.env.NODE_ENV !== "production") {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  // Pre-initialize database tables and indexes
  try {
    console.log("[Startup] Initializing Turso (LibSQL) database tables and indexes...");
    const client = safeClient;
    for (const col of TABLES) {
      await client.execute(`CREATE TABLE IF NOT EXISTS ${col} (id TEXT PRIMARY KEY, data TEXT)`);
    }
    await ensureIndexesExist(client);
    console.log("[Startup] Turso database and index initialization completed successfully.");
  } catch (err: any) {
    console.warn("[Startup] Failed to initialize Turso database tables/indexes:", err.message);
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

if (!process.env.NETLIFY) {
  startServer();
}

export { app, getTurso, TABLES };
