import assert from "node:assert/strict";
import test from "node:test";
import {
  extractCdslCsvAsOfDate,
  parseCdslHoldingsCsv,
  parseCsvDocument,
} from "../scripts/lib/cdsl-csv";
import { normalizeHoldingTable } from "../scripts/lib/holdings-parser";

const sampleCsv = [
  [
    "As Of Date",
    "ISIN",
    "Security Name",
    "Listing Status",
    "Paid Up Value",
    "Balance Quantity",
    "Last Closing Price INR",
    "Holding Value INR",
  ].join(","),
  '2026-08-07,INE002A01018,"Example, Limited",Listed,10,2,100.25,200.50',
].join("\r\n");

test("parses the live CDSL CSV schema including quoted security names", () => {
  const matrix = parseCdslHoldingsCsv(new TextEncoder().encode(sampleCsv));
  const normalized = normalizeHoldingTable(matrix);

  assert.deepEqual(matrix.headers, [
    "As Of Date",
    "ISIN",
    "Security Name",
    "Listing Status",
    "Paid Up Value",
    "Balance Quantity",
    "Last Closing Price INR",
    "Holding Value INR",
  ]);
  assert.equal(normalized.holdings.length, 1);
  assert.equal(normalized.holdings[0].securityName, "Example, Limited");
  assert.equal(normalized.sourceTotalValue, "200.5000");
  assert.equal(extractCdslCsvAsOfDate(matrix), "2026-08-07");
});

test("accepts UTF-16LE CDSL CSV downloads with a byte-order mark", () => {
  const bytes = Buffer.from(`\uFEFF${sampleCsv}`, "utf16le");
  const matrix = parseCdslHoldingsCsv(bytes);
  assert.equal(matrix.rows.length, 1);
  assert.equal(matrix.rows[0][1], "INE002A01018");
});

test("rejects malformed or unrelated CSV content", () => {
  assert.throws(
    () => parseCsvDocument('ISIN,"unterminated'),
    /CDSL_CSV_UNTERMINATED_QUOTE/,
  );
  assert.throws(
    () => parseCdslHoldingsCsv(new TextEncoder().encode("Name,Value\nA,1")),
    /CDSL_CSV_HOLDINGS_HEADER_NOT_FOUND/,
  );
});

test("normalizes CDSL's Indian date formats and rejects mixed snapshots", () => {
  const matrix = parseCdslHoldingsCsv(
    new TextEncoder().encode(sampleCsv.replace("2026-08-07", "07-Aug-2026")),
  );
  assert.equal(extractCdslCsvAsOfDate(matrix), "2026-08-07");

  assert.throws(
    () =>
      extractCdslCsvAsOfDate({
        ...matrix,
        rows: [matrix.rows[0], ["08-Aug-2026", ...matrix.rows[0].slice(1)]],
      }),
    /CDSL_CSV_AS_OF_DATE_MISMATCH/,
  );
});
