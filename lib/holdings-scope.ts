import Decimal from "decimal.js";
import type { AggregatedHolding } from "./domain";

/**
 * Produces security rows for a selected set of accounts. The original portfolio
 * remains family-wide; this only changes the view used by the holdings table.
 */
export function scopeHoldingsToAccounts(
  holdings: AggregatedHolding[],
  accountIds: ReadonlySet<string> | null,
): AggregatedHolding[] {
  if (accountIds === null) return holdings;

  return holdings.flatMap((holding) => {
    const accountBreakdown = holding.accountBreakdown.filter((account) =>
      accountIds.has(account.accountId),
    );
    if (!accountBreakdown.length) return [];

    return [
      {
        ...holding,
        quantity: sum(accountBreakdown.map((account) => account.quantity)),
        holdingValue: sum(
          accountBreakdown.map((account) => account.holdingValue),
        ),
        accountCount: accountBreakdown.length,
        ownerLabels: [
          ...new Set(accountBreakdown.map((account) => account.ownerLabel)),
        ].sort((left, right) => left.localeCompare(right)),
        accountBreakdown,
      },
    ];
  });
}

function sum(values: string[]): string {
  return values
    .reduce((total, value) => total.plus(value), new Decimal(0))
    .toString();
}
