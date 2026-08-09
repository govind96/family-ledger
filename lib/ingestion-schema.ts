import Decimal from "decimal.js";
import { z } from "zod";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const decimalValue = z
  .string()
  .min(1)
  .max(48)
  .regex(/^(?:0|[1-9]\d*)(?:\.\d{1,8})?$/);

const holdingSchema = z
  .object({
    isin: z.string().regex(/^[A-Z]{2}[A-Z0-9]{9}[0-9]$/),
    securityName: z.string().trim().min(1).max(240),
    listingStatus: z.string().trim().min(1).max(48),
    paidUpValue: decimalValue.nullable(),
    quantity: decimalValue,
    lastClosingPrice: decimalValue,
    holdingValue: decimalValue,
  })
  .strict();

export const ingestionSchema = z
  .object({
    syncId: z.string().uuid(),
    account: z
      .object({
        id: z.string().uuid(),
        ownerLabel: z.string().trim().min(1).max(80),
        accountLabel: z.string().trim().min(1).max(80),
        brokerLabel: z.string().trim().min(1).max(80),
        depository: z.literal("CDSL"),
        boidLast4: z.string().regex(/^(?:\d{4})?$/),
        viewRightsVerifiedAt: z.string().datetime(),
      })
      .strict(),
    snapshot: z
      .object({
        startedAt: z.string().datetime(),
        completedAt: z.string().datetime(),
        sourceAsOfDate: isoDate,
        priceDate: isoDate,
        sourceTotalValue: decimalValue,
        parserVersion: z.string().trim().min(1).max(32),
        pageSignature: z.string().regex(/^[a-f0-9]{64}$/),
        holdings: z.array(holdingSchema).min(1).max(1000),
      })
      .strict(),
  })
  .strict();

export type IngestionPayload = z.infer<typeof ingestionSchema>;

export function validateSnapshotConsistency(payload: IngestionPayload): {
  normalizedTotalValue: string;
} {
  const startedAt = Date.parse(payload.snapshot.startedAt);
  const completedAt = Date.parse(payload.snapshot.completedAt);
  if (
    completedAt < startedAt ||
    completedAt - startedAt > 15 * 60 * 1000 ||
    completedAt > Date.now() + 5 * 60 * 1000
  ) {
    throw new Error("INVALID_SYNC_WINDOW");
  }

  const seen = new Set<string>();
  let normalizedTotal = new Decimal(0);

  for (const holding of payload.snapshot.holdings) {
    if (seen.has(holding.isin)) {
      throw new Error("DUPLICATE_ISIN");
    }
    seen.add(holding.isin);
    normalizedTotal = normalizedTotal.plus(holding.holdingValue);
  }

  const sourceTotal = new Decimal(payload.snapshot.sourceTotalValue);
  const difference = sourceTotal.minus(normalizedTotal).abs();
  const tolerance = Decimal.max(
    new Decimal(1),
    new Decimal(payload.snapshot.holdings.length).mul("0.02"),
  );

  if (difference.greaterThan(tolerance)) {
    throw new Error("TOTAL_RECONCILIATION_FAILED");
  }

  return { normalizedTotalValue: normalizedTotal.toFixed(4) };
}
