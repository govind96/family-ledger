import { randomBytes } from "node:crypto";
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import { ApiList, NseIndia } from "stock-nse-india";
import type {
  LocalPrice,
  LocalPriceSnapshot,
  NseMarketState,
} from "../../lib/live-prices";

const MAX_BODY_BYTES = 16 * 1024;
const MAX_HOLDINGS = 64;
const OPEN_MARKET_CACHE_MS = 55_000;
const UNKNOWN_MARKET_CACHE_MS = 14 * 60_000;
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1_000;
const REQUEST_TIMEOUT_MS = 10_000;

type PriceHoldingRequest = {
  isin: string;
  securityName: string;
};

type CachedSnapshot = {
  requestKey: string;
  expiresAt: number;
  snapshot: LocalPriceSnapshot;
};

export type NsePriceServer = {
  url: string;
  close: () => Promise<void>;
};

/**
 * A deliberately narrow localhost-only bridge to the public NSE pages used by
 * stock-nse-india. It is not a general REST or GraphQL proxy: it accepts only
 * the securities already rendered in this dashboard and returns only a price
 * or a safe availability state.
 */
export async function startNsePriceServer(options: {
  dashboardUrl: string;
}): Promise<NsePriceServer> {
  const dashboardOrigin = safeDashboardOrigin(options.dashboardUrl);
  if (!dashboardOrigin) throw new Error("INVALID_DASHBOARD_ORIGIN");

  const token = randomBytes(32).toString("base64url");
  const basePath = `/local-price-feed/${token}/snapshot`;
  const nse = new NseIndia();
  const resolvedSymbols = new Map<string, string>();
  let preOpenMarket: { expiresAt: number; data: unknown } | null = null;
  let cached: CachedSnapshot | null = null;
  let refreshing: Promise<LocalPriceSnapshot> | null = null;
  let origin = "";

  const server = createServer((request, response) => {
    void handleRequest({
      request,
      response,
      origin,
      basePath,
      dashboardOrigin,
      getSnapshot: async (holdings) => {
        const requestKey = holdings.map((holding) => holding.isin).sort().join(",");
        if (
          cached &&
          cached.requestKey === requestKey &&
          cached.expiresAt > Date.now()
        ) {
          return cached.snapshot;
        }
        refreshing ??= buildSnapshot({
          nse,
          holdings,
          resolvedSymbols,
          getPreOpenQuote: async (symbol, marketState) => {
            if (!preOpenMarket || preOpenMarket.expiresAt <= Date.now()) {
              preOpenMarket = {
                data: await withinTimeout(
                  nse.getDataByEndpoint(ApiList.MARKET_DATA_PRE_OPEN),
                ),
                expiresAt: Date.now() + cacheDurationFor(marketState),
              };
            }
            return findPreOpenQuote(preOpenMarket.data, symbol);
          },
        }).then(
          (snapshot) => {
            cached = {
              requestKey,
              snapshot,
              expiresAt:
                Date.parse(snapshot.nextRefreshAt) - 1_000,
            };
            return snapshot;
          },
        ).finally(() => {
          refreshing = null;
        });
        return refreshing;
      },
    }).catch(() => {
      if (!response.headersSent) sendPlain(response, 500, "PRICE_FEED_UNAVAILABLE");
      else response.destroy();
    });
  });
  server.requestTimeout = 15_000;
  server.headersTimeout = 10_000;
  server.keepAliveTimeout = 2_000;

  await listenOnLoopback(server);
  const address = server.address();
  if (!address || typeof address === "string") {
    await closeServer(server);
    throw new Error("NSE_PRICE_HELPER_BIND_FAILED");
  }
  origin = `http://127.0.0.1:${address.port}`;

  return {
    url: `${origin}${basePath}`,
    close: () => closeServer(server),
  };
}

async function handleRequest(input: {
  request: IncomingMessage;
  response: ServerResponse;
  origin: string;
  basePath: string;
  dashboardOrigin: string;
  getSnapshot: (holdings: PriceHoldingRequest[]) => Promise<LocalPriceSnapshot>;
}): Promise<void> {
  const { request, response, origin, basePath, dashboardOrigin, getSnapshot } = input;
  if (!origin || !isLoopbackRequest(request)) {
    sendPlain(response, 421, "LOOPBACK_REQUEST_REQUIRED");
    return;
  }

  const requestUrl = new URL(request.url ?? "/", origin);
  if (requestUrl.pathname !== basePath) {
    sendPlain(response, 404, "NOT_FOUND");
    return;
  }

  if (!isAllowedOrigin(request, dashboardOrigin)) {
    sendPlain(response, 403, "INVALID_PRICE_FEED_ORIGIN");
    return;
  }

  if (request.method === "OPTIONS") {
    response.writeHead(204, corsHeaders(dashboardOrigin));
    response.end();
    return;
  }
  if (request.method !== "POST") {
    sendPlain(response, 405, "METHOD_NOT_ALLOWED", {
      Allow: "POST, OPTIONS",
      ...corsHeaders(dashboardOrigin),
    });
    return;
  }
  if (!hasJsonContentType(request)) {
    sendPlain(response, 415, "JSON_BODY_REQUIRED", corsHeaders(dashboardOrigin));
    return;
  }

  const body = await readJsonBody(request);
  const holdings = parseHoldings(body);
  if (!holdings) {
    sendPlain(response, 400, "INVALID_PRICE_REQUEST", corsHeaders(dashboardOrigin));
    return;
  }

  const snapshot = await getSnapshot(holdings);
  const payload = JSON.stringify(snapshot);
  response.writeHead(200, {
    ...corsHeaders(dashboardOrigin),
    "cache-control": "no-store",
    "content-type": "application/json; charset=utf-8",
    "referrer-policy": "no-referrer",
    "x-content-type-options": "nosniff",
  });
  response.end(payload);
}

async function buildSnapshot(input: {
  nse: NseIndia;
  holdings: PriceHoldingRequest[];
  resolvedSymbols: Map<string, string>;
  getPreOpenQuote: (
    symbol: string,
    marketState: NseMarketState,
  ) => Promise<{ price: number; asOf?: string } | null>;
}): Promise<LocalPriceSnapshot> {
  const marketState = await getMarketState(input.nse);
  const nextRefreshAt = nextRefreshAtFor(marketState);
  const prices = await mapWithConcurrency(input.holdings, 2, async (holding) =>
    getPrice({ ...input, holding, marketState }),
  );
  return {
    source: "nse-experimental",
    fetchedAt: new Date().toISOString(),
    marketState,
    nextRefreshAt,
    prices,
  };
}

async function getPrice(input: {
  nse: NseIndia;
  holding: PriceHoldingRequest;
  resolvedSymbols: Map<string, string>;
  marketState: NseMarketState;
  getPreOpenQuote: (
    symbol: string,
    marketState: NseMarketState,
  ) => Promise<{ price: number; asOf?: string } | null>;
}): Promise<LocalPrice> {
  const { nse, holding, resolvedSymbols, getPreOpenQuote, marketState } = input;
  let symbol = resolvedSymbols.get(holding.isin);

  try {
    if (!symbol) {
      const match = await withinTimeout(
        nse.getEquitySymbolInfo(holding.securityName),
      );
      if (!matchesSecurityName(holding.securityName, readString(match, "description"))) {
        return { isin: holding.isin, status: "unmapped" };
      }
      symbol = baseNseSymbol(readString(match, "symbol"));
      if (!symbol) return { isin: holding.isin, status: "unmapped" };
    }

    try {
      const details = await withinTimeout(nse.getEquityDetails(symbol));
      const returnedIsin = readString(details.metadata, "isin").toUpperCase();
      const price = Number(details.priceInfo?.lastPrice);
      if (returnedIsin !== holding.isin) {
        return { isin: holding.isin, status: "unmapped" };
      }
      if (!Number.isFinite(price) || price <= 0) {
        return { isin: holding.isin, status: "unavailable", symbol };
      }
      resolvedSymbols.set(holding.isin, symbol);
      return {
        isin: holding.isin,
        status: "live",
        symbol,
        price: formatPrice(price),
        asOf: readString(details.metadata, "lastUpdateTime") || undefined,
      };
    } catch {
      const verifiedIsin = await getIsinFromCorporateResults(nse, symbol);
      if (!verifiedIsin) return { isin: holding.isin, status: "unavailable", symbol };
      if (verifiedIsin !== holding.isin) {
        return { isin: holding.isin, status: "unmapped" };
      }

      const quote = await getPreOpenQuote(symbol, marketState);
      if (!quote) return { isin: holding.isin, status: "unavailable", symbol };
      resolvedSymbols.set(holding.isin, symbol);
      return {
        isin: holding.isin,
        status: "live",
        symbol,
        price: formatPrice(quote.price),
        ...(quote.asOf ? { asOf: quote.asOf } : {}),
      };
    }
  } catch {
    return { isin: holding.isin, status: "unavailable", ...(symbol ? { symbol } : {}) };
  }
}

async function getMarketState(nse: NseIndia): Promise<NseMarketState> {
  try {
    const status = await withinTimeout(nse.getMarketStatus());
    const capitalMarket = status.marketState?.find(
      (market) => market.market === "Capital Market",
    );
    const label = capitalMarket?.marketStatus.toLowerCase() ?? "";
    if (label.includes("pre") && label.includes("open")) return "pre-open";
    if (label.includes("open")) return "open";
    if (label.includes("close")) return "closed";
  } catch {
    // The price bridge remains fail-safe if NSE's market-status page is down.
  }
  return "unknown";
}

function cacheDurationFor(marketState: NseMarketState): number {
  if (marketState === "open" || marketState === "pre-open") {
    return OPEN_MARKET_CACHE_MS;
  }
  if (marketState === "closed") {
    return Math.max(1_000, Date.parse(nextRefreshAtFor(marketState)) - Date.now());
  }
  return UNKNOWN_MARKET_CACHE_MS;
}

function nextRefreshAtFor(marketState: NseMarketState, now = new Date()): string {
  if (marketState === "open" || marketState === "pre-open") {
    return new Date(now.getTime() + OPEN_MARKET_CACHE_MS + 5_000).toISOString();
  }
  if (marketState === "closed") return nextWeekdayPreOpenAt(now).toISOString();
  return new Date(now.getTime() + UNKNOWN_MARKET_CACHE_MS).toISOString();
}

function nextWeekdayPreOpenAt(now: Date): Date {
  const indiaParts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const getPart = (type: Intl.DateTimeFormatPartTypes) =>
    Number(indiaParts.find((part) => part.type === type)?.value ?? "0");
  const year = getPart("year");
  const month = getPart("month");
  const day = getPart("day");
  const hour = getPart("hour");
  const minute = getPart("minute");
  const second = getPart("second");
  const currentIndiaTime = Date.UTC(year, month - 1, day, hour, minute, second);
  const candidate = new Date(Date.UTC(year, month - 1, day, 9, 0, 0));

  if (currentIndiaTime >= candidate.getTime()) {
    candidate.setUTCDate(candidate.getUTCDate() + 1);
  }
  while (candidate.getUTCDay() === 0 || candidate.getUTCDay() === 6) {
    candidate.setUTCDate(candidate.getUTCDate() + 1);
  }
  return new Date(candidate.getTime() - IST_OFFSET_MS);
}

async function getIsinFromCorporateResults(
  nse: NseIndia,
  symbol: string,
): Promise<string | null> {
  const rows = await withinTimeout(
    nse.getDataByEndpoint(
      `/api/corporates-financial-results?index=equities&symbol=${encodeURIComponent(symbol)}`,
    ),
  );
  if (!Array.isArray(rows)) return null;
  for (const row of rows) {
    const isin = readString(row, "isin").toUpperCase();
    if (/^INE[A-Z0-9]{9}$/u.test(isin)) return isin;
  }
  return null;
}

function findPreOpenQuote(
  value: unknown,
  symbol: string,
): { price: number; asOf?: string } | null {
  if (!value || typeof value !== "object") return null;
  const rows = (value as { data?: unknown }).data;
  if (!Array.isArray(rows)) return null;
  const row = rows.find((entry) => {
    const metadata = readRecord(entry, "metadata") ?? entry;
    return readString(metadata, "symbol").toUpperCase() === symbol;
  });
  if (!row) return null;
  const metadata = readRecord(row, "metadata") ?? row;
  const detail = readRecord(row, "detail");
  const preOpen = detail ? readRecord(detail, "preOpenMarket") : null;
  const price = Number(
    readNumber(metadata, "lastPrice") ?? readNumber(row, "lastPrice"),
  );
  if (!Number.isFinite(price) || price <= 0) return null;
  return {
    price,
    asOf:
      readString(preOpen, "lastUpdateTime") ||
      readString(metadata, "lastUpdateTime") ||
      undefined,
  };
}

function readRecord(value: unknown, key: string): Record<string, unknown> | null {
  if (!value || typeof value !== "object") return null;
  const candidate = (value as Record<string, unknown>)[key];
  return candidate && typeof candidate === "object"
    ? (candidate as Record<string, unknown>)
    : null;
}

function readNumber(value: unknown, key: string): number | null {
  if (!value || typeof value !== "object") return null;
  const candidate = (value as Record<string, unknown>)[key];
  return typeof candidate === "number" && Number.isFinite(candidate)
    ? candidate
    : null;
}

function formatPrice(price: number): string {
  return price.toFixed(4).replace(/\.?0+$/, "");
}

function baseNseSymbol(value: string): string | null {
  const symbol = value.toUpperCase().replace(/-(EQ|BE|SM|ST)$/u, "");
  return /^[A-Z0-9&-]{1,32}$/u.test(symbol) ? symbol : null;
}

function readString(value: unknown, key: string): string {
  if (!value || typeof value !== "object") return "";
  const candidate = (value as Record<string, unknown>)[key];
  return typeof candidate === "string" ? candidate.trim() : "";
}

function matchesSecurityName(sourceName: string, candidateName: string): boolean {
  const source = significantNameTokens(sourceName);
  const candidate = new Set(significantNameTokens(candidateName));
  if (!source.length || !candidate.size) return false;
  const overlap = source.filter((token) => candidate.has(token)).length;
  return source.length === 1 ? overlap === 1 : overlap >= 2;
}

function significantNameTokens(value: string): string[] {
  const ignored = new Set([
    "LIMITED",
    "LTD",
    "EQUITY",
    "SHARE",
    "SHARES",
    "THE",
    "OF",
    "INDIA",
  ]);
  return value
    .toUpperCase()
    .split(/[^A-Z0-9]+/u)
    .filter((token) => token.length >= 3 && !ignored.has(token));
}

async function withinTimeout<T>(promise: Promise<T>): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("NSE_PRICE_REQUEST_TIMED_OUT")), REQUEST_TIMEOUT_MS);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function mapWithConcurrency<T, R>(
  values: T[],
  limit: number,
  mapper: (value: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(values.length);
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(limit, values.length) }, async () => {
    while (nextIndex < values.length) {
      const index = nextIndex++;
      results[index] = await mapper(values[index]!);
    }
  });
  await Promise.all(workers);
  return results;
}

function parseHoldings(value: unknown): PriceHoldingRequest[] | null {
  if (!value || typeof value !== "object") return null;
  const holdings = (value as { holdings?: unknown }).holdings;
  if (!Array.isArray(holdings) || !holdings.length || holdings.length > MAX_HOLDINGS) {
    return null;
  }
  const seen = new Set<string>();
  const parsed: PriceHoldingRequest[] = [];
  for (const holding of holdings) {
    if (!holding || typeof holding !== "object") return null;
    const { isin, securityName } = holding as Record<string, unknown>;
    if (
      typeof isin !== "string" ||
      !/^INE[A-Z0-9]{9}$/u.test(isin) ||
      typeof securityName !== "string" ||
      !securityName.trim() ||
      securityName.length > 180 ||
      seen.has(isin)
    ) {
      return null;
    }
    seen.add(isin);
    parsed.push({ isin, securityName: securityName.trim() });
  }
  return parsed;
}

function hasJsonContentType(request: IncomingMessage): boolean {
  return /^application\/json(?:;|$)/iu.test(request.headers["content-type"] ?? "");
}

function isAllowedOrigin(request: IncomingMessage, dashboardOrigin: string): boolean {
  return request.headers.origin === dashboardOrigin;
}

function corsHeaders(dashboardOrigin: string): Record<string, string> {
  return {
    "access-control-allow-origin": dashboardOrigin,
    "access-control-allow-methods": "POST, OPTIONS",
    "access-control-allow-headers": "content-type",
    "access-control-max-age": "600",
    vary: "Origin",
  };
}

function isLoopbackRequest(request: IncomingMessage): boolean {
  const address = request.socket.remoteAddress;
  return address === "127.0.0.1" || address === "::1" || address === "::ffff:127.0.0.1";
}

function safeDashboardOrigin(value: string): string | null {
  try {
    const url = new URL(value);
    if (
      url.protocol !== "http:" ||
      !["localhost", "127.0.0.1"].includes(url.hostname) ||
      !/^\d{1,5}$/u.test(url.port) ||
      url.pathname !== "/" ||
      url.search ||
      url.hash ||
      url.username ||
      url.password
    ) {
      return null;
    }
    return url.origin;
  } catch {
    return null;
  }
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let length = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    length += buffer.length;
    if (length > MAX_BODY_BYTES) throw new Error("PRICE_REQUEST_TOO_LARGE");
    chunks.push(buffer);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new Error("INVALID_PRICE_REQUEST_JSON");
  }
}

function sendPlain(
  response: ServerResponse,
  status: number,
  body: string,
  headers: Record<string, string> = {},
): void {
  response.writeHead(status, {
    ...headers,
    "cache-control": "no-store",
    "content-type": "text/plain; charset=utf-8",
    "referrer-policy": "no-referrer",
    "x-content-type-options": "nosniff",
  });
  response.end(body);
}

function listenOnLoopback(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    const onError = (error: Error) => {
      server.off("listening", onListening);
      reject(error);
    };
    const onListening = () => {
      server.off("error", onError);
      resolve();
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(0, "127.0.0.1");
  });
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}
