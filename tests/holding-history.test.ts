import assert from "node:assert/strict";
import test from "node:test";
import {
  buildHoldingPriceHistory,
  includeCurrentPrice,
} from "../lib/holding-history";

test("builds one trusted closing price per ISIN and price date", () => {
  const histories = buildHoldingPriceHistory(
    [
      {
        isin: "INE001",
        priceDate: "2026-08-04",
        completedAt: "2026-08-05T08:00:00.000Z",
        lastClosingPrice: "101.20",
      },
      {
        isin: "INE001",
        priceDate: "2026-08-04",
        completedAt: "2026-08-05T10:00:00.000Z",
        lastClosingPrice: "101.25",
      },
      {
        isin: "INE001",
        priceDate: "2026-08-05",
        completedAt: "2026-08-06T09:00:00.000Z",
        lastClosingPrice: "103.00",
      },
      {
        isin: "INE002",
        priceDate: "2026-08-05",
        completedAt: "2026-08-06T09:00:00.000Z",
        lastClosingPrice: "99.00",
      },
      {
        isin: "INE001",
        priceDate: "not-a-date",
        completedAt: "2026-08-06T10:00:00.000Z",
        lastClosingPrice: "104.00",
      },
    ],
    ["INE001"],
  );

  assert.deepEqual(histories.get("INE001"), [
    { date: "2026-08-04", close: "101.25" },
    { date: "2026-08-05", close: "103.00" },
  ]);
  assert.deepEqual(histories.get("INE002"), undefined);
});

test("includes the current price without duplicating its price date", () => {
  const history = includeCurrentPrice(
    [{ date: "2026-08-05", close: "100.00" }],
    { date: "2026-08-05", close: "101.00" },
  );
  assert.deepEqual(history, [{ date: "2026-08-05", close: "101.00" }]);
});
