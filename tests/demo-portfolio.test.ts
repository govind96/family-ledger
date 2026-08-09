import assert from "node:assert/strict";
import test from "node:test";
import Decimal from "decimal.js";
import { demoPortfolio } from "../lib/demo-portfolio";

test("demo holding breakdowns reconcile to each aggregate", () => {
  for (const holding of demoPortfolio.holdings) {
    assert.equal(holding.accountBreakdown.length, holding.accountCount);
    assert.equal(
      holding.accountBreakdown
        .reduce(
          (total, account) => total.plus(account.quantity),
          new Decimal(0),
        )
        .toString(),
      new Decimal(holding.quantity).toString(),
    );
    assert.equal(
      holding.accountBreakdown
        .reduce(
          (total, account) => total.plus(account.holdingValue),
          new Decimal(0),
        )
        .toString(),
      new Decimal(holding.holdingValue).toString(),
    );
    for (const account of holding.accountBreakdown) {
      assert.match(account.boidLast4, /^\d{4}$/);
    }
    assert.ok(holding.priceHistory.length >= 2);
    assert.equal(holding.priceHistory.at(-1)?.close, holding.lastClosingPrice);
    assert.deepEqual(
      [...holding.priceHistory].map((point) => point.date).sort(),
      holding.priceHistory.map((point) => point.date),
    );
  }
});
