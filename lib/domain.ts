export type HoldingRow = {
  isin: string;
  securityName: string;
  listingStatus: string;
  paidUpValue: string | null;
  quantity: string;
  lastClosingPrice: string;
  holdingValue: string;
};

export type AccountSummary = {
  id: string;
  ownerLabel: string;
  accountLabel: string;
  brokerLabel: string;
  boidLast4: string;
  status: "healthy" | "stale" | "needs-attention";
  lastSyncedAt: string;
  sourceAsOfDate: string;
  priceDate: string;
  holdingCount: number;
  totalValue: string;
};

export type AggregatedHolding = {
  isin: string;
  securityName: string;
  listingStatus: string;
  quantity: string;
  lastClosingPrice: string;
  holdingValue: string;
  accountCount: number;
  ownerLabels: string[];
  accountBreakdown: HoldingAccountBreakdown[];
  priceHistory: HoldingPricePoint[];
};

export type HoldingPricePoint = {
  date: string;
  close: string;
};

export type HoldingAccountBreakdown = {
  accountId: string;
  ownerLabel: string;
  accountLabel: string;
  brokerLabel: string;
  boidLast4: string;
  quantity: string;
  holdingValue: string;
};

export type PortfolioView = {
  mode: "live" | "demo" | "empty";
  totalValue: string;
  accountCount: number;
  ownerCount: number;
  healthyAccountCount: number;
  staleAccountCount: number;
  latestSyncAt: string;
  sourceAsOfDate: string;
  priceDate: string;
  holdings: AggregatedHolding[];
  accounts: AccountSummary[];
};
