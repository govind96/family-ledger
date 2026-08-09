import assert from "node:assert/strict";
import test from "node:test";
import type { AggregatedHolding } from "../lib/domain";
import { scopeHoldingsToAccounts } from "../lib/holdings-scope";

const sharedHolding: AggregatedHolding = {
  isin: "INE000A01001",
  securityName: "Example Industries Limited",
  listingStatus: "Listed",
  quantity: "125",
  lastClosingPrice: "100",
  holdingValue: "12500",
  accountCount: 2,
  ownerLabels: ["Anya", "Bharat"],
  priceHistory: [],
  accountBreakdown: [
    {
      accountId: "anya-primary",
      ownerLabel: "Anya",
      accountLabel: "Primary",
      brokerLabel: "Example DP",
      boidLast4: "1111",
      quantity: "25",
      holdingValue: "2500",
    },
    {
      accountId: "bharat-primary",
      ownerLabel: "Bharat",
      accountLabel: "Primary",
      brokerLabel: "Example DP",
      boidLast4: "2222",
      quantity: "100",
      holdingValue: "10000",
    },
  ],
};

test("scopes a shared security to the selected account instead of its family aggregate", () => {
  const [holding] = scopeHoldingsToAccounts(
    [sharedHolding],
    new Set(["anya-primary"]),
  );

  assert.equal(holding?.quantity, "25");
  assert.equal(holding?.holdingValue, "2500");
  assert.equal(holding?.accountCount, 1);
  assert.deepEqual(holding?.ownerLabels, ["Anya"]);
  assert.deepEqual(holding?.accountBreakdown, [sharedHolding.accountBreakdown[0]]);
});

test("omits securities that are not held by the selected account", () => {
  assert.deepEqual(
    scopeHoldingsToAccounts([sharedHolding], new Set(["unknown-account"])),
    [],
  );
});

test("keeps the unfiltered family view unchanged", () => {
  const holdings = [sharedHolding];
  assert.equal(scopeHoldingsToAccounts(holdings, null), holdings);
});
