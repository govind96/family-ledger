import type { PortfolioView } from "./domain";

export const LIVE_PRICE_REFRESH_MS = 60_000;

export type LocalPriceStatus = "live" | "unmapped" | "unavailable";
export type NseMarketState = "open" | "pre-open" | "closed" | "unknown";

export type LocalPrice = {
  isin: string;
  status: LocalPriceStatus;
  price?: string;
  symbol?: string;
  asOf?: string;
};

export type LocalPriceSnapshot = {
  source: "nse-experimental";
  fetchedAt: string;
  marketState: NseMarketState;
  nextRefreshAt: string;
  prices: LocalPrice[];
};

export type LivePricingSummary = {
  liveCount: number;
  unavailableCount: number;
  fetchedAt: string;
  marketState: NseMarketState;
  nextRefreshAt: string;
};

export function isLocalPriceSnapshot(value: unknown): value is LocalPriceSnapshot {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<LocalPriceSnapshot>;
  if (
    candidate.source !== "nse-experimental" ||
    typeof candidate.fetchedAt !== "string" ||
    !isNseMarketState(candidate.marketState) ||
    typeof candidate.nextRefreshAt !== "string" ||
    Number.isNaN(Date.parse(candidate.nextRefreshAt)) ||
    !Array.isArray(candidate.prices)
  ) {
    return false;
  }

  return candidate.prices.every((price) => {
    if (!price || typeof price !== "object") return false;
    const entry = price as Partial<LocalPrice>;
    return (
      typeof entry.isin === "string" &&
      (entry.status === "live" ||
        entry.status === "unmapped" ||
        entry.status === "unavailable") &&
      (entry.price === undefined ||
        (typeof entry.price === "string" && isPositiveDecimal(entry.price))) &&
      (entry.symbol === undefined || typeof entry.symbol === "string") &&
      (entry.asOf === undefined || typeof entry.asOf === "string")
    );
  });
}

export function applyLivePrices(
  portfolio: PortfolioView,
  snapshot: LocalPriceSnapshot | null,
): { portfolio: PortfolioView; summary: LivePricingSummary | null } {
  if (!snapshot) return { portfolio, summary: null };

  const prices = new Map(
    snapshot.prices
      .filter(
        (entry): entry is LocalPrice & { price: string } =>
          entry.status === "live" && Boolean(entry.price),
      )
      .map((entry) => [entry.isin, Number(entry.price)]),
  );
  const liveCount = prices.size;
  const unavailableCount = snapshot.prices.length - liveCount;

  if (!liveCount) {
    return {
      portfolio,
      summary: {
        liveCount,
        unavailableCount,
        fetchedAt: snapshot.fetchedAt,
        marketState: snapshot.marketState,
        nextRefreshAt: snapshot.nextRefreshAt,
      },
    };
  }

  let totalDelta = 0;
  const accountDeltas = new Map<string, number>();
  const holdings = portfolio.holdings.map((holding) => {
    const price = prices.get(holding.isin);
    if (!price || !Number.isFinite(price) || price <= 0) return holding;

    const previousValue = Number(holding.holdingValue);
    const holdingValue = toMoney(Number(holding.quantity) * price);
    totalDelta += holdingValue - previousValue;
    const accountBreakdown = holding.accountBreakdown.map((accountHolding) => {
      const previousAccountValue = Number(accountHolding.holdingValue);
      const nextAccountValue = toMoney(Number(accountHolding.quantity) * price);
      accountDeltas.set(
        accountHolding.accountId,
        (accountDeltas.get(accountHolding.accountId) ?? 0) +
          nextAccountValue -
          previousAccountValue,
      );
      return {
        ...accountHolding,
        holdingValue: nextAccountValue.toFixed(2),
      };
    });

    return {
      ...holding,
      lastClosingPrice: trimDecimal(price),
      holdingValue: holdingValue.toFixed(2),
      accountBreakdown,
    };
  });

  return {
    portfolio: {
      ...portfolio,
      totalValue: toMoney(Number(portfolio.totalValue) + totalDelta).toFixed(2),
      holdings,
      accounts: portfolio.accounts.map((account) => ({
        ...account,
        totalValue: toMoney(
          Number(account.totalValue) + (accountDeltas.get(account.id) ?? 0),
        ).toFixed(2),
      })),
    },
    summary: {
      liveCount,
      unavailableCount,
      fetchedAt: snapshot.fetchedAt,
      marketState: snapshot.marketState,
      nextRefreshAt: snapshot.nextRefreshAt,
    },
  };
}

function toMoney(value: number): number {
  return Number.isFinite(value) ? Math.round((value + Number.EPSILON) * 100) / 100 : 0;
}

function trimDecimal(value: number): string {
  return value.toFixed(4).replace(/(?:\.0+|(?<=\..*?)0+)$/, "");
}

function isPositiveDecimal(value: string): boolean {
  const number = Number(value);
  return Number.isFinite(number) && number > 0;
}

function isNseMarketState(value: unknown): value is NseMarketState {
  return (
    value === "open" ||
    value === "pre-open" ||
    value === "closed" ||
    value === "unknown"
  );
}
