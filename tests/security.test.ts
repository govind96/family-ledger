import assert from "node:assert/strict";
import test from "node:test";
import {
  ingestionSchema,
  validateSnapshotConsistency,
} from "../lib/ingestion-schema";
import {
  signIngestionBody,
  verifyIngestionSignature,
} from "../lib/security/hmac";

const secret = "S".repeat(48);
const timestamp = 2_000_000_000;
const nonce = "R".repeat(32);
const body = '{"safe":true}';

test("accepts a current valid HMAC signature", async () => {
  const signature = await signIngestionBody({ body, nonce, secret, timestamp });
  const headers = new Headers({
    "x-sync-timestamp": String(timestamp),
    "x-sync-nonce": nonce,
    "x-sync-signature": signature,
  });
  const result = await verifyIngestionSignature({
    body,
    headers,
    secret,
    nowSeconds: timestamp,
  });
  assert.deepEqual(result, { ok: true, timestamp, nonce });
});

test("rejects tampered and expired requests", async () => {
  const signature = await signIngestionBody({ body, nonce, secret, timestamp });
  const headers = new Headers({
    "x-sync-timestamp": String(timestamp),
    "x-sync-nonce": nonce,
    "x-sync-signature": signature,
  });
  const tampered = await verifyIngestionSignature({
    body: `${body} `,
    headers,
    secret,
    nowSeconds: timestamp,
  });
  assert.equal(tampered.ok, false);
  if (!tampered.ok) assert.equal(tampered.code, "INVALID_SIGNATURE");

  const expired = await verifyIngestionSignature({
    body,
    headers,
    secret,
    nowSeconds: timestamp + 301,
  });
  assert.equal(expired.ok, false);
  if (!expired.ok) assert.equal(expired.code, "EXPIRED_SIGNATURE");
});

test("rejects short or missing ingestion secrets", async () => {
  const result = await verifyIngestionSignature({
    body,
    headers: new Headers(),
    secret: "short",
    nowSeconds: timestamp,
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, "INGESTION_NOT_CONFIGURED");
});

test("ingestion schema refuses credential-shaped fields", () => {
  const payload = validPayload();
  const result = ingestionSchema.safeParse({
    ...payload,
    account: {
      ...payload.account,
      username: "should-never-enter-dashboard",
      password: "should-never-enter-dashboard",
      pan: "ABCDE1234F",
    },
  });
  assert.equal(result.success, false);
});

test("reconciles exact decimal totals and rejects unexplained differences", () => {
  const payload = validPayload();
  const parsed = ingestionSchema.parse(payload);
  assert.deepEqual(validateSnapshotConsistency(parsed), {
    normalizedTotalValue: "1234.5600",
  });

  const mismatched = ingestionSchema.parse({
    ...payload,
    snapshot: { ...payload.snapshot, sourceTotalValue: "2000" },
  });
  assert.throws(
    () => validateSnapshotConsistency(mismatched),
    /TOTAL_RECONCILIATION_FAILED/,
  );
});

function validPayload() {
  const now = new Date();
  const started = new Date(now.getTime() - 10_000);
  return {
    syncId: "10000000-0000-4000-8000-000000000001",
    account: {
      id: "10000000-0000-4000-8000-000000000002",
      ownerLabel: "Example owner",
      accountLabel: "Primary",
      brokerLabel: "Example DP",
      depository: "CDSL" as const,
      boidLast4: "1234",
      viewRightsVerifiedAt: now.toISOString(),
    },
    snapshot: {
      startedAt: started.toISOString(),
      completedAt: now.toISOString(),
      sourceAsOfDate: "2026-08-08",
      priceDate: "2026-08-07",
      sourceTotalValue: "1234.56",
      parserVersion: "test-v1",
      pageSignature: "a".repeat(64),
      holdings: [
        {
          isin: "INE002A01018",
          securityName: "Example Limited",
          listingStatus: "Listed",
          paidUpValue: "10",
          quantity: "12",
          lastClosingPrice: "102.88",
          holdingValue: "1234.56",
        },
      ],
    },
  };
}
