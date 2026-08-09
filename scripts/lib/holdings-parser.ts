import { createHash } from "node:crypto";
import Decimal from "decimal.js";
import type { HoldingRow } from "@/lib/domain";

export type TableMatrix = {
  headers: string[];
  rows: string[][];
};

const aliases = {
  isin: ["isin"],
  securityName: [
    "isin name",
    "name of company",
    "company name",
    "security name",
    "security description",
    "description",
  ],
  listingStatus: [
    "isin listing",
    "listing status",
    "listed status",
    "status",
  ],
  paidUpValue: ["paid up value", "paid-up value", "face value"],
  quantity: [
    "balance (numbers)",
    "balance numbers",
    "balance quantity",
    "quantity",
    "current balance",
    "balance qty",
  ],
  lastClosingPrice: ["last closing price", "closing price", "last close"],
  holdingValue: ["holding value", "market value"],
} as const;

export function normalizeHoldingTable(matrix: TableMatrix): {
  holdings: HoldingRow[];
  sourceTotalValue: string;
  pageSignature: string;
} {
  const normalizedHeaders = matrix.headers.map(normalizeHeader);
  const indices = {
    isin: findHeader(normalizedHeaders, aliases.isin),
    securityName: findHeader(normalizedHeaders, aliases.securityName),
    listingStatus: findHeader(normalizedHeaders, aliases.listingStatus),
    paidUpValue: findHeader(normalizedHeaders, aliases.paidUpValue, false),
    quantity: findHeader(normalizedHeaders, aliases.quantity),
    lastClosingPrice: findHeader(normalizedHeaders, aliases.lastClosingPrice),
    holdingValue: findHeader(normalizedHeaders, aliases.holdingValue),
  };

  const holdings: HoldingRow[] = [];
  const seen = new Set<string>();
  let total = new Decimal(0);

  for (const row of matrix.rows) {
    const isin = cleanText(row[indices.isin] ?? "").toUpperCase();
    if (!/^[A-Z]{2}[A-Z0-9]{9}[0-9]$/.test(isin)) continue;
    if (seen.has(isin)) throw new Error("DUPLICATE_ISIN");
    seen.add(isin);

    const holding: HoldingRow = {
      isin,
      securityName: requireText(row[indices.securityName], "SECURITY_NAME_MISSING"),
      listingStatus: requireText(
        row[indices.listingStatus],
        "LISTING_STATUS_MISSING",
      ),
      paidUpValue:
        indices.paidUpValue === -1
          ? null
          : normalizeDecimal(row[indices.paidUpValue], true),
      quantity: normalizeDecimal(row[indices.quantity]),
      lastClosingPrice: normalizeDecimal(row[indices.lastClosingPrice]),
      holdingValue: normalizeDecimal(row[indices.holdingValue]),
    };
    total = total.plus(holding.holdingValue);
    holdings.push(holding);
  }

  if (!holdings.length) throw new Error("NO_HOLDINGS_ROWS");

  const signatureMaterial = JSON.stringify({
    headers: normalizedHeaders,
    columnCount: normalizedHeaders.length,
  });

  return {
    holdings,
    sourceTotalValue: total.toFixed(4),
    pageSignature: createHash("sha256").update(signatureMaterial).digest("hex"),
  };
}

function normalizeHeader(value: string): string {
  return cleanText(value)
    .toLowerCase()
    .replace(/[._/\\-]+/g, " ")
    .replace(/\s+/g, " ");
}

function findHeader(
  headers: string[],
  expected: readonly string[],
  required = true,
): number {
  const exact = headers.findIndex((header) => expected.includes(header));
  if (exact >= 0) return exact;
  const partial = headers.findIndex((header) =>
    expected.some((candidate) => header.includes(candidate)),
  );
  if (partial >= 0) return partial;
  if (!required) return -1;
  throw new Error(`REQUIRED_COLUMN_MISSING:${expected[0]}`);
}

function normalizeDecimal(value: string | undefined, nullable?: false): string;
function normalizeDecimal(value: string | undefined, nullable: true): string | null;
function normalizeDecimal(value: string | undefined, nullable = false): string | null {
  const cleaned = cleanText(value ?? "")
    .replace(/[₹,\s]/g, "")
    .replace(/^\((.*)\)$/, "-$1");
  if (!cleaned && nullable) return null;
  if (!/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(cleaned)) {
    throw new Error("INVALID_DECIMAL_VALUE");
  }
  const decimal = new Decimal(cleaned);
  if (decimal.isNegative()) throw new Error("NEGATIVE_HOLDING_VALUE");
  return decimal.toString();
}

function cleanText(value: string): string {
  return value.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
}

function requireText(value: string | undefined, code: string): string {
  const cleaned = cleanText(value ?? "");
  if (!cleaned) throw new Error(code);
  return cleaned.slice(0, 240);
}
