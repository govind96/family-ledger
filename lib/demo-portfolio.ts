import type {
  AccountSummary,
  AggregatedHolding,
  PortfolioView,
} from "./domain";

type DemoHolding = Omit<AggregatedHolding, "accountBreakdown" | "priceHistory">;

const demoAccounts: AccountSummary[] = [
  {
    id: "demo-1",
    ownerLabel: "Arun",
    accountLabel: "Primary",
    brokerLabel: "Groww",
    boidLast4: "4821",
    status: "healthy",
    lastSyncedAt: "2026-08-08T08:02:00.000+05:30",
    sourceAsOfDate: "2026-08-08",
    priceDate: "2026-08-07",
    holdingCount: 22,
    totalValue: "4110420.15",
  },
  {
    id: "demo-2",
    ownerLabel: "Meera",
    accountLabel: "Long term",
    brokerLabel: "Angel One",
    boidLast4: "1138",
    status: "healthy",
    lastSyncedAt: "2026-08-08T08:05:00.000+05:30",
    sourceAsOfDate: "2026-08-08",
    priceDate: "2026-08-07",
    holdingCount: 18,
    totalValue: "3489730.40",
  },
  {
    id: "demo-3",
    ownerLabel: "Riya",
    accountLabel: "Core",
    brokerLabel: "5paisa",
    boidLast4: "7054",
    status: "healthy",
    lastSyncedAt: "2026-08-08T08:08:00.000+05:30",
    sourceAsOfDate: "2026-08-08",
    priceDate: "2026-08-07",
    holdingCount: 14,
    totalValue: "2419680.80",
  },
  {
    id: "demo-4",
    ownerLabel: "Family HUF",
    accountLabel: "HUF holdings",
    brokerLabel: "Angel One",
    boidLast4: "9240",
    status: "healthy",
    lastSyncedAt: "2026-08-08T08:11:00.000+05:30",
    sourceAsOfDate: "2026-08-08",
    priceDate: "2026-08-07",
    holdingCount: 26,
    totalValue: "3946419.05",
  },
  {
    id: "demo-5",
    ownerLabel: "Arun",
    accountLabel: "Secondary",
    brokerLabel: "5paisa",
    boidLast4: "3316",
    status: "healthy",
    lastSyncedAt: "2026-08-08T08:14:00.000+05:30",
    sourceAsOfDate: "2026-08-08",
    priceDate: "2026-08-07",
    holdingCount: 9,
    totalValue: "910000.00",
  },
];

const demoHoldings: DemoHolding[] = [
  {
    isin: "INE002A01018",
    securityName: "Reliance Industries Limited",
    listingStatus: "Listed",
    quantity: "420",
    lastClosingPrice: "1395.20",
    holdingValue: "585984.00",
    accountCount: 3,
    ownerLabels: ["Arun", "Meera", "Family HUF"],
  },
  {
    isin: "INE040A01034",
    securityName: "HDFC Bank Limited",
    listingStatus: "Listed",
    quantity: "710",
    lastClosingPrice: "1988.40",
    holdingValue: "1411764.00",
    accountCount: 4,
    ownerLabels: ["Arun", "Meera", "Riya", "Family HUF"],
  },
  {
    isin: "INE467B01029",
    securityName: "Tata Consultancy Services Limited",
    listingStatus: "Listed",
    quantity: "310",
    lastClosingPrice: "3054.75",
    holdingValue: "946972.50",
    accountCount: 3,
    ownerLabels: ["Arun", "Meera", "Riya"],
  },
  {
    isin: "INE009A01021",
    securityName: "Infosys Limited",
    listingStatus: "Listed",
    quantity: "860",
    lastClosingPrice: "1512.60",
    holdingValue: "1300836.00",
    accountCount: 3,
    ownerLabels: ["Meera", "Riya", "Family HUF"],
  },
  {
    isin: "INE090A01021",
    securityName: "ICICI Bank Limited",
    listingStatus: "Listed",
    quantity: "940",
    lastClosingPrice: "1462.80",
    holdingValue: "1375032.00",
    accountCount: 4,
    ownerLabels: ["Arun", "Meera", "Riya", "Family HUF"],
  },
  {
    isin: "INF204KB14I2",
    securityName: "Nippon India ETF Nifty BeES",
    listingStatus: "Listed",
    quantity: "9200",
    lastClosingPrice: "287.95",
    holdingValue: "2649140.00",
    accountCount: 5,
    ownerLabels: ["Arun", "Meera", "Riya", "Family HUF"],
  },
  {
    isin: "INE062A01020",
    securityName: "State Bank of India",
    listingStatus: "Listed",
    quantity: "1280",
    lastClosingPrice: "821.35",
    holdingValue: "1051328.00",
    accountCount: 2,
    ownerLabels: ["Arun", "Family HUF"],
  },
];

export const demoPortfolio: PortfolioView = {
  mode: "demo",
  totalValue: "14876250.40",
  accountCount: 5,
  ownerCount: 4,
  healthyAccountCount: 5,
  staleAccountCount: 0,
  latestSyncAt: "2026-08-08T08:14:00.000+05:30",
  sourceAsOfDate: "2026-08-08",
  priceDate: "2026-08-07",
  holdings: demoHoldings.map(withDemoBreakdown),
  accounts: demoAccounts,
};

function withDemoBreakdown(holding: DemoHolding): AggregatedHolding {
  const accounts = demoAccounts
    .filter((account) => holding.ownerLabels.includes(account.ownerLabel))
    .slice(0, holding.accountCount);
  if (accounts.length !== holding.accountCount) {
    throw new Error("INVALID_DEMO_ACCOUNT_BREAKDOWN");
  }

  const quantities = splitDecimal(holding.quantity, accounts.length, 4);
  const values = splitDecimal(holding.holdingValue, accounts.length, 2);
  return {
    ...holding,
    accountBreakdown: accounts.map((account, index) => ({
      accountId: account.id,
      ownerLabel: account.ownerLabel,
      accountLabel: account.accountLabel,
      brokerLabel: account.brokerLabel,
      boidLast4: account.boidLast4,
      quantity: quantities[index]!,
      holdingValue: values[index]!,
    })),
    priceHistory: demoPriceHistory(holding.isin, holding.lastClosingPrice),
  };
}

function demoPriceHistory(isin: string, currentPrice: string) {
  const endingPrice = Number(currentPrice);
  const seed = [...isin].reduce(
    (total, character) => total + character.charCodeAt(0),
    0,
  );
  const dates = businessDaysEndingOn("2026-08-07", 22);
  const points = dates.map((date, index) => {
    const distanceFromEnd = 21 - index;
    const drift = ((seed % 9) - 4) * 0.0022 * distanceFromEnd;
    const wave = Math.sin((seed + index * 3) / 5) * 0.025;
    const close = endingPrice * (1 - drift + wave);
    return {
      date,
      close: close.toFixed(2),
    };
  });
  points[points.length - 1] = {
    date: "2026-08-07",
    close: currentPrice,
  };
  return points;
}

function businessDaysEndingOn(endDate: string, count: number): string[] {
  const cursor = new Date(`${endDate}T00:00:00Z`);
  const dates: string[] = [];
  while (dates.length < count) {
    const day = cursor.getUTCDay();
    if (day !== 0 && day !== 6) {
      dates.push(cursor.toISOString().slice(0, 10));
    }
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }
  return dates.reverse();
}

function splitDecimal(
  value: string,
  parts: number,
  precision: number,
): string[] {
  const scale = 10 ** precision;
  const total = Math.round(Number(value) * scale);
  const base = Math.floor(total / parts);
  const remainder = total % parts;
  return Array.from({ length: parts }, (_, index) =>
    ((base + (index < remainder ? 1 : 0)) / scale).toFixed(precision),
  );
}
