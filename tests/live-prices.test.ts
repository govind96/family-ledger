import assert from "node:assert/strict";
import test from "node:test";
import type { PortfolioView } from "../lib/domain";
import { applyLivePrices, isLocalPriceSnapshot } from "../lib/live-prices";

const portfolio: PortfolioView = {
  mode: "live",
  totalValue: "1500.00",
  accountCount: 1,
  ownerCount: 1,
  healthyAccountCount: 1,
  staleAccountCount: 0,
  latestSyncAt: "2026-08-08T12:00:00.000Z",
  sourceAsOfDate: "2026-08-08",
  priceDate: "2026-08-07",
  accounts: [
    {
      id: "account-1",
      ownerLabel: "Example",
      accountLabel: "Primary",
      brokerLabel: "Example DP",
      boidLast4: "1234",
      status: "healthy",
      lastSyncedAt: "2026-08-08T12:00:00.000Z",
      sourceAsOfDate: "2026-08-08",
      priceDate: "2026-08-07",
      holdingCount: 1,
      totalValue: "1500.00",
    },
  ],
  holdings: [
    {
      isin: "INE002A01018",
      securityName: "Example Limited",
      listingStatus: "Listed",
      quantity: "10",
      lastClosingPrice: "150",
      holdingValue: "1500",
      accountCount: 1,
      ownerLabels: ["Example"],
      accountBreakdown: [
        {
          accountId: "account-1",
          ownerLabel: "Example",
          accountLabel: "Primary",
          brokerLabel: "Example DP",
          boidLast4: "1234",
          quantity: "10",
          holdingValue: "1500",
        },
      ],
      priceHistory: [],
    },
  ],
};

test("only verified live prices change the indicative portfolio value", () => {
  const result = applyLivePrices(portfolio, {
    source: "nse-experimental",
    fetchedAt: "2026-08-08T12:05:00.000Z",
    marketState: "open",
    nextRefreshAt: "2026-08-08T12:06:00.000Z",
    prices: [
      {
        isin: "INE002A01018",
        status: "live",
        price: "155.5",
        symbol: "EXAMPLE",
      },
    ],
  });

  assert.equal(result.portfolio.totalValue, "1555.00");
  assert.equal(result.portfolio.holdings[0]?.holdingValue, "1555.00");
  assert.equal(result.portfolio.accounts[0]?.totalValue, "1555.00");
  assert.deepEqual(result.summary, {
    liveCount: 1,
    unavailableCount: 0,
    fetchedAt: "2026-08-08T12:05:00.000Z",
    marketState: "open",
    nextRefreshAt: "2026-08-08T12:06:00.000Z",
  });
});

test("refuses malformed price snapshots and preserves CDSL values", () => {
  assert.equal(
    isLocalPriceSnapshot({
      source: "nse-experimental",
      fetchedAt: "now",
      marketState: "open",
      nextRefreshAt: "2026-08-08T12:06:00.000Z",
      prices: [{ isin: "INE002A01018", status: "live", price: "not-a-price" }],
    }),
    false,
  );

  const result = applyLivePrices(portfolio, {
    source: "nse-experimental",
    fetchedAt: "2026-08-08T12:05:00.000Z",
    marketState: "closed",
    nextRefreshAt: "2026-08-10T03:30:00.000Z",
    prices: [{ isin: "INE002A01018", status: "unavailable" }],
  });
  assert.equal(result.portfolio, portfolio);
  assert.equal(result.portfolio.totalValue, "1500.00");
});
