import Decimal from "decimal.js";
import { ensureDatabase } from "@/db/runtime";
import type {
  AccountSummary,
  AggregatedHolding,
  PortfolioView,
} from "./domain";
import {
  buildHoldingPriceHistory,
  includeCurrentPrice,
  type HistoricalPriceRow,
} from "./holding-history";

type JoinedHoldingRow = {
  account_id: string;
  owner_label: string;
  account_label: string;
  broker_label: string;
  boid_last4: string;
  sync_id: string;
  completed_at: string;
  source_as_of_date: string;
  price_date: string;
  row_count: number;
  source_total_value: string;
  isin: string | null;
  security_name: string | null;
  listing_status: string | null;
  quantity: string | null;
  last_closing_price: string | null;
  holding_value: string | null;
};

type HistoricalHoldingRow = {
  isin: string;
  price_date: string;
  completed_at: string;
  last_closing_price: string;
};

export async function getPortfolioView(): Promise<PortfolioView> {
  const database = await ensureDatabase();
  const result = await database
    .prepare(
      `SELECT
        a.id AS account_id,
        a.owner_label,
        a.account_label,
        a.broker_label,
        a.boid_last4,
        s.id AS sync_id,
        s.completed_at,
        s.source_as_of_date,
        s.price_date,
        s.row_count,
        s.source_total_value,
        h.isin,
        h.security_name,
        h.listing_status,
        h.quantity,
        h.last_closing_price,
        h.holding_value
      FROM accounts a
      JOIN sync_runs s ON s.id = a.last_successful_sync_id
      LEFT JOIN holdings h ON h.sync_run_id = s.id
      WHERE a.active = 1
      ORDER BY a.owner_label, a.account_label, h.holding_value DESC`,
    )
    .all<JoinedHoldingRow>();

  if (!result.results.length) {
    return emptyPortfolio();
  }

  const accountMap = new Map<string, AccountSummary>();
  const aggregateMap = new Map<
    string,
    Omit<AggregatedHolding, "priceHistory"> & { owners: Set<string> }
  >();

  for (const row of result.results) {
    if (!accountMap.has(row.account_id)) {
      const ageHours =
        (Date.now() - Date.parse(row.completed_at)) / (60 * 60 * 1000);
      accountMap.set(row.account_id, {
        id: row.account_id,
        ownerLabel: row.owner_label,
        accountLabel: row.account_label,
        brokerLabel: row.broker_label,
        boidLast4: row.boid_last4,
        status: ageHours > 36 ? "stale" : "healthy",
        lastSyncedAt: row.completed_at,
        sourceAsOfDate: row.source_as_of_date,
        priceDate: row.price_date,
        holdingCount: row.row_count,
        totalValue: row.source_total_value,
      });
    }

    if (
      !row.isin ||
      !row.security_name ||
      !row.listing_status ||
      row.quantity === null ||
      row.last_closing_price === null ||
      row.holding_value === null
    ) {
      continue;
    }

    const existing = aggregateMap.get(row.isin);
    const accountHolding = {
      accountId: row.account_id,
      ownerLabel: row.owner_label,
      accountLabel: row.account_label,
      brokerLabel: row.broker_label,
      boidLast4: row.boid_last4,
      quantity: row.quantity,
      holdingValue: row.holding_value,
    };
    if (existing) {
      existing.quantity = new Decimal(existing.quantity)
        .plus(row.quantity)
        .toString();
      existing.holdingValue = new Decimal(existing.holdingValue)
        .plus(row.holding_value)
        .toString();
      existing.accountCount += 1;
      existing.owners.add(row.owner_label);
      existing.accountBreakdown.push(accountHolding);
    } else {
      aggregateMap.set(row.isin, {
        isin: row.isin,
        securityName: row.security_name,
        listingStatus: row.listing_status,
        quantity: row.quantity,
        lastClosingPrice: row.last_closing_price,
        holdingValue: row.holding_value,
        accountCount: 1,
        ownerLabels: [],
        accountBreakdown: [accountHolding],
        owners: new Set([row.owner_label]),
      });
    }
  }

  const accounts = [...accountMap.values()];
  const holdingsWithoutHistory = [...aggregateMap.values()]
    .map(({ owners, ...holding }) => ({
      ...holding,
      ownerLabels: [...owners].sort(),
      accountBreakdown: holding.accountBreakdown.sort((left, right) =>
        new Decimal(right.holdingValue).comparedTo(left.holdingValue),
      ),
    }))
    .sort((left, right) =>
      new Decimal(right.holdingValue).comparedTo(left.holdingValue),
    );
  const historyStart = new Date(Date.now() - 180 * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
  const currentIsins = holdingsWithoutHistory.map((holding) => holding.isin);
  const historicalRows: HistoricalPriceRow[] = currentIsins.length
    ? (
        await database
          .prepare(
            `SELECT
              h.isin,
              s.price_date,
              s.completed_at,
              h.last_closing_price
            FROM holdings h
            JOIN sync_runs s ON s.id = h.sync_run_id
            JOIN accounts a ON a.id = h.account_id
            WHERE a.active = 1
              AND s.status = 'SUCCEEDED'
              AND s.price_date >= ?
              AND h.isin IN (${currentIsins.map(() => "?").join(", ")})
            ORDER BY h.isin ASC, s.price_date ASC, s.completed_at ASC`,
          )
          .bind(historyStart, ...currentIsins)
          .all<HistoricalHoldingRow>()
      ).results.map((row) => ({
        isin: row.isin,
        priceDate: row.price_date,
        completedAt: row.completed_at,
        lastClosingPrice: row.last_closing_price,
      }))
    : [];
  const histories = buildHoldingPriceHistory(historicalRows, currentIsins);
  const holdings = holdingsWithoutHistory.map((holding) => ({
    ...holding,
    priceHistory: includeCurrentPrice(histories.get(holding.isin) ?? [], {
      date: priceDateForHolding(holding, accounts),
      close: holding.lastClosingPrice,
    }),
  }));
  const totalValue = accounts
    .reduce((total, account) => total.plus(account.totalValue), new Decimal(0))
    .toString();
  const sortedSyncs = accounts
    .map((account) => account.lastSyncedAt)
    .sort((left, right) => right.localeCompare(left));
  const sourceDates = accounts
    .map((account) => account.sourceAsOfDate)
    .sort((left, right) => right.localeCompare(left));
  const priceDates = accounts
    .map((account) => account.priceDate)
    .sort((left, right) => right.localeCompare(left));

  return {
    mode: "live",
    totalValue,
    accountCount: accounts.length,
    ownerCount: new Set(accounts.map((account) => account.ownerLabel)).size,
    healthyAccountCount: accounts.filter(
      (account) => account.status === "healthy",
    ).length,
    staleAccountCount: accounts.filter((account) => account.status === "stale")
      .length,
    latestSyncAt: sortedSyncs[0],
    sourceAsOfDate: sourceDates[0],
    priceDate: priceDates[0],
    holdings,
    accounts,
  };
}

function priceDateForHolding(
  holding: Pick<AggregatedHolding, "accountBreakdown">,
  accounts: AccountSummary[],
): string {
  const relevantAccountIds = new Set(
    holding.accountBreakdown.map((account) => account.accountId),
  );
  return (
    accounts
      .filter((account) => relevantAccountIds.has(account.id))
      .map((account) => account.priceDate)
      .sort((left, right) => right.localeCompare(left))[0] ?? ""
  );
}

function emptyPortfolio(): PortfolioView {
  return {
    mode: "empty",
    totalValue: "0",
    accountCount: 0,
    ownerCount: 0,
    healthyAccountCount: 0,
    staleAccountCount: 0,
    latestSyncAt: "",
    sourceAsOfDate: "",
    priceDate: "",
    holdings: [],
    accounts: [],
  };
}
