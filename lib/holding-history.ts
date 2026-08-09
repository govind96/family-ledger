import Decimal from "decimal.js";
import type { HoldingPricePoint } from "./domain";

export type HistoricalPriceRow = {
  isin: string;
  priceDate: string;
  completedAt: string;
  lastClosingPrice: string;
};

const isoDatePattern = /^\d{4}-\d{2}-\d{2}$/;

export function buildHoldingPriceHistory(
  rows: HistoricalPriceRow[],
  currentIsins: Iterable<string>,
  maxPoints = 60,
): Map<string, HoldingPricePoint[]> {
  const allowedIsins = new Set(currentIsins);
  const latestByDate = new Map<string, Map<string, HistoricalPriceRow>>();

  for (const row of rows) {
    if (!allowedIsins.has(row.isin) || !isoDatePattern.test(row.priceDate)) {
      continue;
    }
    let close: Decimal;
    try {
      close = new Decimal(row.lastClosingPrice);
    } catch {
      continue;
    }
    if (!close.isFinite() || close.lessThanOrEqualTo(0)) continue;

    const byDate =
      latestByDate.get(row.isin) ?? new Map<string, HistoricalPriceRow>();
    const existing = byDate.get(row.priceDate);
    if (!existing || row.completedAt > existing.completedAt) {
      byDate.set(row.priceDate, row);
    }
    latestByDate.set(row.isin, byDate);
  }

  const histories = new Map<string, HoldingPricePoint[]>();
  for (const isin of allowedIsins) {
    const points = [...(latestByDate.get(isin)?.values() ?? [])]
      .sort((left, right) => left.priceDate.localeCompare(right.priceDate))
      .slice(-maxPoints)
      .map((row) => ({ date: row.priceDate, close: row.lastClosingPrice }));
    histories.set(isin, points);
  }
  return histories;
}

export function includeCurrentPrice(
  history: HoldingPricePoint[],
  current: HoldingPricePoint,
): HoldingPricePoint[] {
  if (!isoDatePattern.test(current.date)) return history;
  let close: Decimal;
  try {
    close = new Decimal(current.close);
  } catch {
    return history;
  }
  if (!close.isFinite() || close.lessThanOrEqualTo(0)) return history;

  const byDate = new Map(history.map((point) => [point.date, point]));
  byDate.set(current.date, current);
  return [...byDate.values()]
    .sort((left, right) => left.date.localeCompare(right.date))
    .slice(-60);
}
