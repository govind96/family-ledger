import {
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
} from "drizzle-orm/sqlite-core";

export const accounts = sqliteTable(
  "accounts",
  {
    id: text("id").primaryKey(),
    ownerLabel: text("owner_label").notNull(),
    accountLabel: text("account_label").notNull(),
    brokerLabel: text("broker_label").notNull(),
    depository: text("depository").notNull().default("CDSL"),
    boidLast4: text("boid_last4").notNull(),
    active: integer("active", { mode: "boolean" }).notNull().default(true),
    viewRightsVerifiedAt: text("view_rights_verified_at").notNull(),
    lastSuccessfulSyncId: text("last_successful_sync_id"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [index("idx_accounts_active").on(table.active)],
);

export const syncRuns = sqliteTable(
  "sync_runs",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    status: text("status").notNull(),
    startedAt: text("started_at").notNull(),
    completedAt: text("completed_at").notNull(),
    sourceAsOfDate: text("source_as_of_date").notNull(),
    priceDate: text("price_date").notNull(),
    rowCount: integer("row_count").notNull(),
    sourceTotalValue: text("source_total_value").notNull(),
    normalizedTotalValue: text("normalized_total_value").notNull(),
    parserVersion: text("parser_version").notNull(),
    pageSignature: text("page_signature").notNull(),
    errorCode: text("error_code"),
  },
  (table) => [
    index("idx_sync_runs_account_completed").on(
      table.accountId,
      table.completedAt,
    ),
  ],
);

export const holdings = sqliteTable(
  "holdings",
  {
    syncRunId: text("sync_run_id")
      .notNull()
      .references(() => syncRuns.id, { onDelete: "cascade" }),
    accountId: text("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    isin: text("isin").notNull(),
    securityName: text("security_name").notNull(),
    listingStatus: text("listing_status").notNull(),
    paidUpValue: text("paid_up_value"),
    quantity: text("quantity").notNull(),
    lastClosingPrice: text("last_closing_price").notNull(),
    holdingValue: text("holding_value").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.syncRunId, table.isin] }),
    index("idx_holdings_account_sync").on(table.accountId, table.syncRunId),
    index("idx_holdings_isin_sync").on(table.isin, table.syncRunId),
  ],
);

export const ingestNonces = sqliteTable("ingest_nonces", {
  nonce: text("nonce").primaryKey(),
  usedAt: text("used_at").notNull(),
  expiresAt: text("expires_at").notNull(),
});

export const auditEvents = sqliteTable(
  "audit_events",
  {
    id: text("id").primaryKey(),
    actor: text("actor").notNull(),
    action: text("action").notNull(),
    accountId: text("account_id"),
    outcome: text("outcome").notNull(),
    metadata: text("metadata").notNull().default("{}"),
    createdAt: text("created_at").notNull(),
  },
  (table) => [index("idx_audit_events_created").on(table.createdAt)],
);
