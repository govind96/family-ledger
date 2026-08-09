import assert from "node:assert/strict";
import test from "node:test";
import { normalizeHoldingTable } from "../scripts/lib/holdings-parser";

const headers = [
  "ISIN",
  "Name of Company",
  "Listing Status",
  "Paid Up Value",
  "Balance Quantity",
  "Last Closing Price",
  "Holding Value",
  "Transaction Details",
];

test("normalizes CDSL account-details rows using exact decimals", () => {
  const result = normalizeHoldingTable({
    headers,
    rows: [
      [
        "INE002A01018",
        "Reliance Industries Limited",
        "Listed",
        "10.00",
        "1,250.5000",
        "₹1,395.20",
        "1,744,697.60",
        "View",
      ],
      [
        "INE040A01034",
        "HDFC Bank Limited",
        "Listed",
        "1",
        "100",
        "1,988.40",
        "198,840.00",
        "View",
      ],
    ],
  });

  assert.equal(result.holdings.length, 2);
  assert.equal(result.holdings[0].quantity, "1250.5");
  assert.equal(result.holdings[0].lastClosingPrice, "1395.2");
  assert.equal(result.sourceTotalValue, "1943537.6000");
  assert.match(result.pageSignature, /^[a-f0-9]{64}$/);
});

test("accepts the live CDSL account-details column labels", () => {
  const result = normalizeHoldingTable({
    headers: [
      "ISIN",
      "ISIN Name",
      "ISIN Listing",
      "Paid up Value",
      "Balance (Numbers)",
      "Last Closing Price (in INR)",
      "Current Holding Value (in INR)",
    ],
    rows: [
      [
        "INE002A01018",
        "Example Limited",
        "Listed",
        "10",
        "2",
        "100.25",
        "200.50",
      ],
    ],
  });

  assert.equal(result.holdings.length, 1);
  assert.equal(result.holdings[0].quantity, "2");
  assert.equal(result.sourceTotalValue, "200.5000");
});

test("fails closed when a required holdings column disappears", () => {
  assert.throws(
    () =>
      normalizeHoldingTable({
        headers: headers.filter((header) => header !== "Holding Value"),
        rows: [],
      }),
    /REQUIRED_COLUMN_MISSING:holding value/,
  );
});

test("rejects duplicate ISIN rows instead of silently double-counting", () => {
  const row = [
    "INE002A01018",
    "Reliance Industries Limited",
    "Listed",
    "10",
    "10",
    "100",
    "1000",
    "View",
  ];
  assert.throws(
    () => normalizeHoldingTable({ headers, rows: [row, row] }),
    /DUPLICATE_ISIN/,
  );
});

test("rejects negative or malformed financial values", () => {
  assert.throws(
    () =>
      normalizeHoldingTable({
        headers,
        rows: [
          [
            "INE002A01018",
            "Reliance Industries Limited",
            "Listed",
            "10",
            "-1",
            "100",
            "-100",
            "View",
          ],
        ],
      }),
    /INVALID_DECIMAL_VALUE|NEGATIVE_HOLDING_VALUE/,
  );
});
