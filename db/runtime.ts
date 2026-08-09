import { env } from "cloudflare:workers";

let schemaPromise: Promise<void> | null = null;

export function getEnvironment(): Cloudflare.Env {
  return env;
}

export function getRawDatabase(): D1Database {
  const database = getEnvironment().DB;
  if (!database) {
    throw new Error("DATABASE_UNAVAILABLE");
  }
  return database;
}

export async function ensureDatabase(): Promise<D1Database> {
  const database = getRawDatabase();
  schemaPromise ??= initializeSchema(database).catch((error) => {
    schemaPromise = null;
    throw error;
  });
  await schemaPromise;
  return database;
}

async function initializeSchema(database: D1Database): Promise<void> {
  const statements = [
    `CREATE TABLE IF NOT EXISTS accounts (
      id TEXT PRIMARY KEY NOT NULL,
      owner_label TEXT NOT NULL,
      account_label TEXT NOT NULL,
      broker_label TEXT NOT NULL,
      depository TEXT NOT NULL DEFAULT 'CDSL',
      boid_last4 TEXT NOT NULL,
      active INTEGER NOT NULL DEFAULT 1,
      view_rights_verified_at TEXT NOT NULL,
      last_successful_sync_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS sync_runs (
      id TEXT PRIMARY KEY NOT NULL,
      account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      status TEXT NOT NULL,
      started_at TEXT NOT NULL,
      completed_at TEXT NOT NULL,
      source_as_of_date TEXT NOT NULL,
      price_date TEXT NOT NULL,
      row_count INTEGER NOT NULL,
      source_total_value TEXT NOT NULL,
      normalized_total_value TEXT NOT NULL,
      parser_version TEXT NOT NULL,
      page_signature TEXT NOT NULL,
      error_code TEXT
    )`,
    `CREATE TABLE IF NOT EXISTS holdings (
      sync_run_id TEXT NOT NULL REFERENCES sync_runs(id) ON DELETE CASCADE,
      account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      isin TEXT NOT NULL,
      security_name TEXT NOT NULL,
      listing_status TEXT NOT NULL,
      paid_up_value TEXT,
      quantity TEXT NOT NULL,
      last_closing_price TEXT NOT NULL,
      holding_value TEXT NOT NULL,
      PRIMARY KEY (sync_run_id, isin)
    )`,
    `CREATE TABLE IF NOT EXISTS ingest_nonces (
      nonce TEXT PRIMARY KEY NOT NULL,
      used_at TEXT NOT NULL,
      expires_at TEXT NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS audit_events (
      id TEXT PRIMARY KEY NOT NULL,
      actor TEXT NOT NULL,
      action TEXT NOT NULL,
      account_id TEXT,
      outcome TEXT NOT NULL,
      metadata TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL
    )`,
    "CREATE INDEX IF NOT EXISTS idx_accounts_active ON accounts(active)",
    "CREATE INDEX IF NOT EXISTS idx_sync_runs_account_completed ON sync_runs(account_id, completed_at)",
    "CREATE INDEX IF NOT EXISTS idx_holdings_account_sync ON holdings(account_id, sync_run_id)",
    "CREATE INDEX IF NOT EXISTS idx_holdings_isin_sync ON holdings(isin, sync_run_id)",
    "CREATE INDEX IF NOT EXISTS idx_audit_events_created ON audit_events(created_at)",
  ];

  await database.batch(
    statements.map((statement) => database.prepare(statement)),
  );
  await database.prepare("PRAGMA optimize").run();
}
