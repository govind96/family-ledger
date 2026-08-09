import { ensureDatabase } from "@/db/runtime";
import type { IngestionPayload } from "./ingestion-schema";

export async function persistSuccessfulIngestion(input: {
  payload: IngestionPayload;
  normalizedTotalValue: string;
  nonce: string;
  actor: string;
}): Promise<void> {
  const { payload, normalizedTotalValue, nonce, actor } = input;
  const database = await ensureDatabase();
  const now = new Date().toISOString();
  const nonceExpiry = new Date(Date.now() + 10 * 60 * 1000).toISOString();

  const statements: D1PreparedStatement[] = [
    database
      .prepare(
        `INSERT INTO ingest_nonces (nonce, used_at, expires_at)
         VALUES (?, ?, ?)`,
      )
      .bind(nonce, now, nonceExpiry),
    database
      .prepare(
        `INSERT INTO accounts (
          id, owner_label, account_label, broker_label, depository,
          boid_last4, active, view_rights_verified_at,
          last_successful_sync_id, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, 1, ?, NULL, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          owner_label = excluded.owner_label,
          account_label = excluded.account_label,
          broker_label = excluded.broker_label,
          depository = excluded.depository,
          boid_last4 = excluded.boid_last4,
          active = 1,
          view_rights_verified_at = excluded.view_rights_verified_at,
          updated_at = excluded.updated_at`,
      )
      .bind(
        payload.account.id,
        payload.account.ownerLabel,
        payload.account.accountLabel,
        payload.account.brokerLabel,
        payload.account.depository,
        payload.account.boidLast4,
        payload.account.viewRightsVerifiedAt,
        now,
        now,
      ),
    database
      .prepare(
        `INSERT INTO sync_runs (
          id, account_id, status, started_at, completed_at,
          source_as_of_date, price_date, row_count,
          source_total_value, normalized_total_value,
          parser_version, page_signature, error_code
        ) VALUES (?, ?, 'SUCCEEDED', ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
      )
      .bind(
        payload.syncId,
        payload.account.id,
        payload.snapshot.startedAt,
        payload.snapshot.completedAt,
        payload.snapshot.sourceAsOfDate,
        payload.snapshot.priceDate,
        payload.snapshot.holdings.length,
        payload.snapshot.sourceTotalValue,
        normalizedTotalValue,
        payload.snapshot.parserVersion,
        payload.snapshot.pageSignature,
      ),
  ];

  for (const holding of payload.snapshot.holdings) {
    statements.push(
      database
        .prepare(
          `INSERT INTO holdings (
            sync_run_id, account_id, isin, security_name, listing_status,
            paid_up_value, quantity, last_closing_price, holding_value
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          payload.syncId,
          payload.account.id,
          holding.isin,
          holding.securityName,
          holding.listingStatus,
          holding.paidUpValue,
          holding.quantity,
          holding.lastClosingPrice,
          holding.holdingValue,
        ),
    );
  }

  statements.push(
    database
      .prepare(
        `UPDATE accounts
         SET last_successful_sync_id = ?, updated_at = ?
         WHERE id = ?`,
      )
      .bind(payload.syncId, now, payload.account.id),
    database
      .prepare(
        `INSERT INTO audit_events (
          id, actor, action, account_id, outcome, metadata, created_at
        ) VALUES (?, ?, 'HOLDINGS_SYNC', ?, 'SUCCEEDED', ?, ?)`,
      )
      .bind(
        crypto.randomUUID(),
        actor,
        payload.account.id,
        JSON.stringify({
          rowCount: payload.snapshot.holdings.length,
          sourceAsOfDate: payload.snapshot.sourceAsOfDate,
          parserVersion: payload.snapshot.parserVersion,
        }),
        now,
      ),
  );

  await database.batch(statements);
  await database
    .prepare("DELETE FROM ingest_nonces WHERE expires_at < ?")
    .bind(now)
    .run();
}
