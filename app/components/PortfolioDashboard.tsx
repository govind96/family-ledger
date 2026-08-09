"use client";

import {
  ArrowDown,
  ArrowDownToLine,
  Building2,
  CalendarClock,
  ChevronDown,
  FileDown,
  Fingerprint,
  Layers3,
  LockKeyhole,
  Search,
  ShieldCheck,
  Sparkles,
  UserPlus,
  Users,
  WalletCards,
} from "lucide-react";
import {
  Fragment,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { AggregatedHolding, PortfolioView } from "@/lib/domain";
import {
  applyLivePrices,
  isLocalPriceSnapshot,
  LIVE_PRICE_REFRESH_MS,
  type NseMarketState,
  type LocalPriceSnapshot,
} from "@/lib/live-prices";
import { scopeHoldingsToAccounts } from "@/lib/holdings-scope";
import { displaySecurityName } from "@/lib/security-name";
import { PriceChart } from "./PriceChart";
import { ThemeToggle } from "./ThemeToggle";

type PortfolioDashboardProps = {
  portfolio: PortfolioView;
  viewerName: string;
  localOnboardingUrl?: string;
  localPriceFeedUrl?: string;
};

type HoldingSort =
  "value" | "name" | "quantity" | "price" | "accounts" | "allocation";
type SortDirection = "asc" | "desc";

const moneyFormatter = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0,
});

const decimalFormatter = new Intl.NumberFormat("en-IN", {
  maximumFractionDigits: 4,
});

const dateFormatter = new Intl.DateTimeFormat("en-IN", {
  day: "2-digit",
  month: "short",
  year: "numeric",
  timeZone: "Asia/Kolkata",
});

const dateTimeFormatter = new Intl.DateTimeFormat("en-IN", {
  day: "2-digit",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Asia/Kolkata",
});

const CARD =
  "rounded-2xl border border-line bg-surface shadow-sm transition-shadow";
const LABEL =
  "text-[11px] font-bold uppercase tracking-[0.13em] text-ink-faint";
const BUTTON_BASE =
  "inline-flex h-10 cursor-pointer items-center justify-center gap-2 rounded-lg px-3.5 text-[13.5px] font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-45";

export function PortfolioDashboard({
  portfolio,
  viewerName,
  localOnboardingUrl,
  localPriceFeedUrl,
}: PortfolioDashboardProps) {
  const [query, setQuery] = useState("");
  const [owner, setOwner] = useState("all");
  const [accountId, setAccountId] = useState("all");
  const [activeView, setActiveView] = useState<"holdings" | "accounts">(
    "holdings",
  );
  const [holdingSort, setHoldingSort] = useState<HoldingSort>("value");
  const [holdingSortDirection, setHoldingSortDirection] =
    useState<SortDirection>("desc");
  const [liveSnapshot, setLiveSnapshot] = useState<LocalPriceSnapshot | null>(
    null,
  );
  const [livePriceUnavailable, setLivePriceUnavailable] = useState(false);

  const priceRequest = useMemo(
    () => ({
      holdings: portfolio.holdings.map((holding) => ({
        isin: holding.isin,
        securityName: holding.securityName,
      })),
    }),
    [portfolio.holdings],
  );

  useEffect(() => {
    if (!localPriceFeedUrl || !priceRequest.holdings.length) return;
    let cancelled = false;
    let inFlight = false;
    let controller: AbortController | null = null;
    let timer: number | null = null;
    let nextRefreshAt = 0;

    const schedule = (delay: number) => {
      if (cancelled) return;
      if (timer !== null) window.clearTimeout(timer);
      nextRefreshAt = Date.now() + delay;
      timer = window.setTimeout(() => void refresh(), delay);
    };

    const refresh = async () => {
      if (cancelled || inFlight) return;
      inFlight = true;
      controller = new AbortController();
      let nextDelay = LIVE_PRICE_REFRESH_MS;
      try {
        const response = await fetch(localPriceFeedUrl, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(priceRequest),
          cache: "no-store",
          credentials: "omit",
          referrerPolicy: "no-referrer",
          signal: controller.signal,
        });
        const payload: unknown = await response.json();
        if (!response.ok || !isLocalPriceSnapshot(payload)) {
          throw new Error("LOCAL_PRICE_RESPONSE_INVALID");
        }
        if (!cancelled) {
          setLiveSnapshot(payload);
          setLivePriceUnavailable(false);
        }
        nextDelay = nextPriceRefreshDelay(payload);
      } catch {
        if (!cancelled && !controller?.signal.aborted) {
          setLivePriceUnavailable(true);
        }
      } finally {
        inFlight = false;
        schedule(nextDelay);
      }
    };

    const refreshWhenDue = () => {
      if (
        document.visibilityState === "visible" &&
        !inFlight &&
        Date.now() >= nextRefreshAt
      ) {
        if (timer !== null) window.clearTimeout(timer);
        timer = null;
        void refresh();
      }
    };

    document.addEventListener("visibilitychange", refreshWhenDue);
    void refresh();
    return () => {
      cancelled = true;
      controller?.abort();
      if (timer !== null) window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", refreshWhenDue);
    };
  }, [localPriceFeedUrl, priceRequest]);

  const { portfolio: displayedPortfolio, summary: livePricing } = useMemo(
    () => applyLivePrices(portfolio, liveSnapshot),
    [portfolio, liveSnapshot],
  );
  const isLivePricing = Boolean(livePricing?.liveCount);
  const priceLabel = isLivePricing
    ? labelForNsePrice(livePricing?.marketState)
    : "Last close";
  const nseMarketLabel = marketLabel(
    livePricing?.marketState ?? liveSnapshot?.marketState,
  );

  const ownerOptions = useMemo(
    () =>
      [
        ...new Set(
          displayedPortfolio.accounts.map((account) => account.ownerLabel),
        ),
      ].sort((left, right) => left.localeCompare(right)),
    [displayedPortfolio.accounts],
  );

  const accountOptions = useMemo(
    () =>
      displayedPortfolio.accounts
        .filter((account) => owner === "all" || account.ownerLabel === owner)
        .sort((left, right) =>
          `${left.ownerLabel} ${left.accountLabel}`.localeCompare(
            `${right.ownerLabel} ${right.accountLabel}`,
          ),
        ),
    [displayedPortfolio.accounts, owner],
  );

  const scopedAccountIds = useMemo(() => {
    if (accountId !== "all") return new Set([accountId]);
    if (owner === "all") return null;
    return new Set(
      displayedPortfolio.accounts
        .filter((account) => account.ownerLabel === owner)
        .map((account) => account.id),
    );
  }, [accountId, displayedPortfolio.accounts, owner]);

  const scopedHoldings = useMemo(
    () => scopeHoldingsToAccounts(displayedPortfolio.holdings, scopedAccountIds),
    [displayedPortfolio.holdings, scopedAccountIds],
  );

  const holdingsScopeTotal = useMemo(() => {
    if (scopedAccountIds === null) return Number(displayedPortfolio.totalValue);
    return displayedPortfolio.accounts
      .filter((account) => scopedAccountIds.has(account.id))
      .reduce((total, account) => total + Number(account.totalValue), 0);
  }, [displayedPortfolio.accounts, displayedPortfolio.totalValue, scopedAccountIds]);

  const handleOwnerChange = (value: string) => {
    setOwner(value);
    setAccountId("all");
  };

  const filteredHoldings = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return scopedHoldings.filter((holding) => {
      const queryMatch =
        !normalized ||
        holding.securityName.toLowerCase().includes(normalized) ||
        holding.isin.toLowerCase().includes(normalized);
      return queryMatch;
    });
  }, [query, scopedHoldings]);

  const filteredAccounts = useMemo(
    () =>
      displayedPortfolio.accounts.filter(
        (account) => owner === "all" || account.ownerLabel === owner,
      ),
    [displayedPortfolio.accounts, owner],
  );

  const visibleHoldings = useMemo(
    () => sortHoldings(filteredHoldings, holdingSort, holdingSortDirection),
    [filteredHoldings, holdingSort, holdingSortDirection],
  );

  const selectHoldingSort = (sort: HoldingSort) => {
    setHoldingSort(sort);
    setHoldingSortDirection(defaultSortDirection(sort));
  };

  const toggleHoldingSort = (sort: HoldingSort) => {
    if (sort === holdingSort) {
      setHoldingSortDirection((direction) =>
        direction === "asc" ? "desc" : "asc",
      );
      return;
    }
    selectHoldingSort(sort);
  };

  const downloadCsv = () => {
    const headers = [
      "ISIN",
      "Security name",
      "Quantity",
      isLivePricing ? "NSE experimental price" : "Last closing price",
      "Holding value",
      "Accounts",
      "Owners",
      "Holdings as of",
      "Price date",
    ];
    const rows = visibleHoldings.map((holding) => [
      holding.isin,
      holding.securityName,
      holding.quantity,
      holding.lastClosingPrice,
      holding.holdingValue,
      String(holding.accountCount),
      holding.ownerLabels.join(" | "),
      displayedPortfolio.sourceAsOfDate,
      displayedPortfolio.priceDate,
    ]);
    const csv = [headers, ...rows]
      .map((row) => row.map(escapeCsvCell).join(","))
      .join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `family-holdings-${displayedPortfolio.sourceAsOfDate || "export"}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const portfolioTotal = Number(displayedPortfolio.totalValue);
  const sourceLabel =
    displayedPortfolio.mode === "demo" ? "Safe preview" : "CDSL reconciled";
  const needsAttention = Boolean(
    displayedPortfolio.staleAccountCount || !displayedPortfolio.accountCount,
  );
  const healthLabel = displayedPortfolio.staleAccountCount
    ? `${displayedPortfolio.staleAccountCount} need${displayedPortfolio.staleAccountCount === 1 ? "s" : ""} attention`
    : displayedPortfolio.accountCount
      ? "All current"
      : "Not synced";

  return (
    <div className="grain min-h-dvh">
      <header
        className="sticky top-0 z-30 border-b border-line bg-canvas-veil backdrop-blur-xl backdrop-saturate-150"
        data-print="hide"
      >
        <div className="mx-auto flex h-16 w-[min(1500px,100%-2rem)] items-center justify-between gap-4 sm:w-[min(1500px,100%-3rem)]">
          <div className="flex min-w-0 items-center gap-2.5">
            <div
              className="grid size-9 flex-none place-items-center rounded-[11px] bg-inverse text-[12px] font-extrabold tracking-[-0.08em] text-ink-inverse"
              aria-hidden="true"
            >
              FL
            </div>
            <div className="min-w-0">
              <p className="text-[16px] font-extrabold leading-tight tracking-tight text-ink">
                Family Ledger
              </p>
              <p className="hidden text-[12px] leading-tight text-ink-faint sm:block">
                Consolidated demat holdings
              </p>
            </div>
          </div>

          <div className="flex flex-none items-center gap-3 sm:gap-4">
            <span className="hidden items-center gap-1.5 text-[12.5px] font-semibold text-ink-muted md:inline-flex">
              <ShieldCheck
                size={14}
                className="text-ink-faint"
                aria-hidden="true"
              />
              {sourceLabel}
            </span>
            <ThemeToggle />
            <div
              className="flex min-w-0 items-center gap-2 border-l border-line pl-2 sm:pl-3"
              title={viewerName}
            >
              <span
                className="grid size-8 flex-none place-items-center rounded-full bg-sunken text-[12px] font-extrabold text-ink-soft ring-1 ring-line"
                aria-hidden="true"
              >
                {initials(viewerName)}
              </span>
              <div className="hidden min-w-0 lg:block">
                <p className="text-[11px] leading-tight text-ink-faint">
                  Viewing as
                </p>
                <p className="truncate text-[13px] font-semibold leading-tight text-ink-soft">
                  {viewerName}
                </p>
              </div>
            </div>
          </div>
        </div>
      </header>

      <main className="mx-auto w-[min(1500px,100%-2rem)] pb-12 pt-5 sm:w-[min(1500px,100%-3rem)]">
        {displayedPortfolio.mode === "demo" ? (
          <p
            className="mb-5 inline-flex items-center gap-2 rounded-lg border border-warning/25 bg-warning-soft px-3 py-1.5 text-[11.5px] font-semibold text-warning"
            role="status"
          >
            <Sparkles size={14} aria-hidden="true" />
            Demo data · no real accounts or stored secrets are loaded
          </p>
        ) : null}

        {/* Page heading -------------------------------------------------- */}
        <section
          className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between"
          aria-labelledby="portfolio-title"
        >
          <div>
            <h1
              id="portfolio-title"
            className="text-[clamp(30px,3vw,38px)] font-extrabold leading-tight tracking-[-0.035em] text-ink"
            >
              Family portfolio
            </h1>
            <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-ink-muted">
              <CalendarClock size={14} aria-hidden="true" />
              Holdings {formatDate(displayedPortfolio.sourceAsOfDate)}
              <span className="text-ink-faint" aria-hidden="true">
                ·
              </span>
              {localPriceFeedUrl ? (
                <span aria-live="polite">
                  {isLivePricing
                    ? `${nseMarketLabel} · ${livePricing!.liveCount} ${labelForNsePrice(livePricing!.marketState).toLowerCase()}${livePricing!.liveCount === 1 ? "" : "s"} · ${formatDateTime(livePricing!.fetchedAt)}`
                    : liveSnapshot || livePriceUnavailable
                      ? `${nseMarketLabel} · NSE price unavailable · showing last close`
                      : "NSE price check in progress"}
                </span>
              ) : (
                <span>Prices {formatDate(displayedPortfolio.priceDate)}</span>
              )}
            </p>
          </div>

          <div className="flex flex-wrap gap-2" data-print="hide">
            {localOnboardingUrl ? (
              <a
                className={`${BUTTON_BASE} border border-line bg-surface text-ink-soft hover:border-line-strong hover:text-ink`}
                href={localOnboardingUrl}
                target="_blank"
                rel="noreferrer"
              >
                <UserPlus size={16} aria-hidden="true" />
                Add account
              </a>
            ) : null}
            <button
              className={`${BUTTON_BASE} border border-line bg-surface text-ink-soft hover:border-line-strong hover:text-ink`}
              type="button"
              onClick={() => window.print()}
            >
              <FileDown size={16} aria-hidden="true" />
              Print / PDF
            </button>
            <button
              className={`${BUTTON_BASE} border border-line bg-surface text-ink-soft hover:border-line-strong hover:text-ink`}
              type="button"
              onClick={downloadCsv}
              disabled={!visibleHoldings.length}
            >
              <ArrowDownToLine size={16} aria-hidden="true" />
              Download CSV
            </button>
          </div>
        </section>

        {/* Summary ------------------------------------------------------- */}
        <section
          className="mb-4 grid grid-cols-1 divide-y divide-line overflow-hidden rounded-2xl border border-line bg-surface md:grid-cols-[1.6fr_1.2fr_1fr] md:divide-x md:divide-y-0"
          aria-label="Portfolio summary"
          data-print="flat"
        >
          <div className="px-5 py-4">
            <p className={LABEL}>Total portfolio value</p>
            <p className="figure mt-2 text-[clamp(36px,3.8vw,48px)] font-extrabold leading-none text-ink">
              {moneyFormatter.format(portfolioTotal)}
            </p>
            <p className="mt-1.5 text-[12.5px] text-ink-muted">
              {isLivePricing
                ? `${nseValueLabel(livePricing!.marketState)} · ${livePricing!.liveCount} price${livePricing!.liveCount === 1 ? "" : "s"}`
                : `Settled holdings · ${formatDate(displayedPortfolio.priceDate)} close`}
            </p>
          </div>

          <SummaryCell
            label="Portfolio coverage"
            icon={<Layers3 size={14} aria-hidden="true" />}
          >
            <p className="mt-2 text-[16px] font-bold leading-snug text-ink">
              {displayedPortfolio.holdings.length} securities
            </p>
            <p className="mt-1 text-[12.5px] text-ink-muted">
              {displayedPortfolio.accountCount}{" "}
              {displayedPortfolio.accountCount === 1 ? "account" : "accounts"} ·{" "}
              {displayedPortfolio.ownerCount}{" "}
              {displayedPortfolio.ownerCount === 1 ? "member" : "members"}
            </p>
          </SummaryCell>

          <SummaryCell
            label="Data status"
            icon={<CalendarClock size={14} aria-hidden="true" />}
          >
            <p className="mt-2 flex items-center gap-2 text-[16px] font-bold leading-tight text-ink">
              <span
                className="size-1.5 flex-none rounded-full"
                style={{
                  backgroundColor: needsAttention
                    ? "var(--warning)"
                    : "var(--positive)",
                }}
                aria-hidden="true"
              />
              {healthLabel}
            </p>
            <p className="mt-1 truncate text-[12.5px] text-ink-muted">
              Synced {formatDateTime(displayedPortfolio.latestSyncAt)}
            </p>
          </SummaryCell>
        </section>

        {/* Workspace ----------------------------------------------------- */}
        <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
          <section
            className={`${CARD} order-1 min-w-0 overflow-hidden lg:order-2 xl:order-1`}
            aria-labelledby="workspace-title"
            data-print="flat"
          >
            <div className="flex flex-col gap-3 border-b border-line px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
              <h2
                id="workspace-title"
                className="text-[19px] font-bold tracking-tight text-ink"
              >
                Portfolio holdings
              </h2>
              <div
                className="flex gap-1 rounded-xl border border-line bg-sunken p-1"
                role="tablist"
                aria-label="Portfolio views"
                data-print="hide"
              >
                {(
                  [
                    ["holdings", "Holdings", displayedPortfolio.holdings.length],
                    ["accounts", "Accounts", displayedPortfolio.accounts.length],
                  ] as const
                ).map(([value, label, count]) => {
                  const active = activeView === value;
                  return (
                    <button
                      key={value}
                      id={`${value}-tab`}
                      type="button"
                      role="tab"
                      aria-selected={active}
                      aria-controls={`${value}-panel`}
                      onClick={() => setActiveView(value)}
                      className={`flex h-9 flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-lg px-3.5 text-[13.5px] font-semibold transition-colors ${
                        active
                          ? "bg-surface text-ink shadow-xs"
                          : "text-ink-muted hover:text-ink-soft"
                      }`}
                    >
                      {label}
                      <span
                        className={`numeric rounded-full px-1.5 py-px text-[11.5px] ${
                          active
                            ? "bg-accent-soft text-accent-ink"
                            : "bg-line text-ink-muted"
                        }`}
                      >
                        {count}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div
              className="border-b border-line bg-raised px-5 py-3"
              data-print="hide"
            >
              <div className="flex w-full flex-col gap-2 sm:flex-row">
                {activeView === "holdings" ? (
                  <label className="flex h-10 items-center gap-2 rounded-lg border border-line bg-surface px-3 text-ink-faint focus-within:border-accent sm:min-w-0 sm:flex-1">
                    <span className="sr-only">Search holdings</span>
                    <Search size={15} aria-hidden="true" />
                    <input
                      type="search"
                      placeholder="Search security or ISIN"
                      value={query}
                      onChange={(event) => setQuery(event.target.value)}
                      className="w-full bg-transparent text-[13.5px] text-ink outline-none placeholder:text-ink-faint"
                    />
                  </label>
                ) : null}
                <SelectField
                  srLabel="Filter by owner"
                  value={owner}
                  onChange={handleOwnerChange}
                  icon={<Users size={15} aria-hidden="true" />}
                >
                  <option value="all">All owners</option>
                  {ownerOptions.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </SelectField>
                {activeView === "holdings" ? (
                  <SelectField
                    srLabel="Filter by account"
                    value={accountId}
                    onChange={setAccountId}
                    icon={<WalletCards size={15} aria-hidden="true" />}
                  >
                    <option value="all">All accounts</option>
                    {accountOptions.map((account) => (
                      <option key={account.id} value={account.id}>
                        {account.ownerLabel} · {account.accountLabel || "CDSL EASI"}
                      </option>
                    ))}
                  </SelectField>
                ) : null}
                {activeView === "holdings" ? (
                  <SelectField
                    srLabel="Sort holdings"
                    value={holdingSort}
                    onChange={(value) =>
                      selectHoldingSort(value as HoldingSort)
                    }
                  >
                    <option value="value">Largest value</option>
                    <option value="name">Security name</option>
                    <option value="quantity">Highest quantity</option>
                    <option value="price">Highest last close</option>
                    <option value="accounts">Most accounts</option>
                  </SelectField>
                ) : null}
              </div>
            </div>

            {activeView === "holdings" ? (
              <div
                id="holdings-panel"
                role="tabpanel"
                aria-labelledby="holdings-tab"
              >
                <HoldingsTable
                  holdings={visibleHoldings}
                  totalValue={holdingsScopeTotal}
                  isPortfolioEmpty={displayedPortfolio.mode === "empty"}
                  priceLabel={priceLabel}
                  ownershipLabel={
                    accountId !== "all"
                      ? "In this account"
                      : owner !== "all"
                        ? "For this owner"
                        : "Across family"
                  }
                  sort={holdingSort}
                  sortDirection={holdingSortDirection}
                  onSort={toggleHoldingSort}
                />
              </div>
            ) : (
              <div
                id="accounts-panel"
                role="tabpanel"
                aria-labelledby="accounts-tab"
              >
                <AccountsView
                  accounts={filteredAccounts}
                  totalValue={portfolioTotal}
                  holdings={displayedPortfolio.holdings}
                />
              </div>
            )}
          </section>

          <PortfolioAside portfolio={displayedPortfolio} totalValue={portfolioTotal} />
        </div>

        <footer className="mt-6 flex flex-col gap-2 border-t border-line pt-5 text-[13px] text-ink-muted sm:flex-row sm:items-center sm:justify-between">
          <p className="flex items-center gap-2">
            <LockKeyhole size={14} className="text-accent" aria-hidden="true" />
            Sign-in secrets stay in the local OS vault, never in this dashboard
          </p>
          <p>Read-only settled holdings</p>
        </footer>
      </main>
    </div>
  );
}

/* ---------------------------------------------------------------- pieces */

function SummaryCell({
  label,
  icon,
  children,
}: {
  label: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="px-5 py-4">
      <div className="flex items-center justify-between">
        <p className={LABEL}>{label}</p>
        <span className="text-ink-faint">{icon}</span>
      </div>
      {children}
    </div>
  );
}

function SelectField({
  srLabel,
  value,
  onChange,
  icon,
  children,
}: {
  srLabel: string;
  value: string;
  onChange: (value: string) => void;
  icon?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <label className="relative flex h-10 items-center gap-2 rounded-lg border border-line bg-surface pl-3 text-ink-faint focus-within:border-accent">
      <span className="sr-only">{srLabel}</span>
      {icon}
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-full w-full min-w-[9.5rem] cursor-pointer appearance-none bg-transparent pr-7 text-[13.5px] font-medium text-ink-soft outline-none"
      >
        {children}
      </select>
      <ChevronDown
        size={14}
        className="pointer-events-none absolute right-2.5"
        aria-hidden="true"
      />
    </label>
  );
}

function HoldingsTable({
  holdings,
  totalValue,
  isPortfolioEmpty,
  priceLabel,
  ownershipLabel,
  sort,
  sortDirection,
  onSort,
}: {
  holdings: AggregatedHolding[];
  totalValue: number;
  isPortfolioEmpty: boolean;
  priceLabel: string;
  ownershipLabel: string;
  sort: HoldingSort;
  sortDirection: SortDirection;
  onSort: (sort: HoldingSort) => void;
}) {
  const [expandedIsins, setExpandedIsins] = useState<Set<string>>(
    () => new Set(),
  );

  const toggleHolding = (isin: string) => {
    setExpandedIsins((current) => {
      const next = new Set(current);
      if (next.has(isin)) {
        next.delete(isin);
      } else {
        next.add(isin);
      }
      return next;
    });
  };

  if (!holdings.length) {
    return (
      <EmptyState
        icon={
          isPortfolioEmpty ? (
            <Layers3 size={22} aria-hidden="true" />
          ) : (
            <Search size={22} aria-hidden="true" />
          )
        }
        title={
          isPortfolioEmpty
            ? "No synced holdings yet"
            : "No holdings match this filter"
        }
        body={
          isPortfolioEmpty
            ? "Add an authorized EASI account and complete its first sync."
            : "Try another owner, security name, or ISIN."
        }
      />
    );
  }

  return (
    <>
      {/* Desktop table */}
      <div className="scroll-x hidden lg:block" data-print="block">
        <table className="w-full min-w-[820px] table-fixed border-collapse text-left">
          <caption className="sr-only">
            Consolidated family demat holdings
          </caption>
          <colgroup>
            <col className="w-[34%]" />
            <col className="w-[10%]" />
            <col className="w-[11%]" />
            <col className="w-[14%]" />
            <col className="w-[18%]" />
            <col className="w-[13%]" />
          </colgroup>
          <thead>
            <tr className="border-b border-line bg-sunken">
              <Th
                className="pl-5"
                sort="name"
                activeSort={sort}
                sortDirection={sortDirection}
                onSort={onSort}
              >
                Security
              </Th>
              <Th
                align="right"
                sort="quantity"
                activeSort={sort}
                sortDirection={sortDirection}
                onSort={onSort}
              >
                Quantity
              </Th>
              <Th
                align="right"
                sort="price"
                activeSort={sort}
                sortDirection={sortDirection}
                onSort={onSort}
              >
                {priceLabel}
              </Th>
              <Th
                align="right"
                sort="value"
                activeSort={sort}
                sortDirection={sortDirection}
                onSort={onSort}
              >
                Holding value
              </Th>
              <Th
                sort="accounts"
                activeSort={sort}
                sortDirection={sortDirection}
                onSort={onSort}
              >
                {ownershipLabel}
              </Th>
              <Th
                align="right"
                className="pr-5"
                sort="allocation"
                activeSort={sort}
                sortDirection={sortDirection}
                onSort={onSort}
              >
                Allocation
              </Th>
            </tr>
          </thead>
          <tbody>
            {holdings.map((holding) => {
              const allocation = allocationFor(holding, totalValue);
              const securityName = displaySecurityName(holding.securityName);
              const isExpanded = expandedIsins.has(holding.isin);
              const detailId = `holding-detail-${holding.isin}`;
              return (
                <Fragment key={holding.isin}>
                  <tr
                    className="cursor-pointer border-b border-line transition-colors hover:bg-raised focus-visible:bg-raised"
                    role="button"
                    tabIndex={0}
                    onClick={() => toggleHolding(holding.isin)}
                    onKeyDown={(event) => {
                      if (event.key !== "Enter" && event.key !== " ") return;
                      event.preventDefault();
                      toggleHolding(holding.isin);
                    }}
                    aria-label={`${isExpanded ? "Hide" : "View"} ${securityName} details`}
                    aria-expanded={isExpanded}
                    aria-controls={detailId}
                  >
                    <td className="py-3.5 pl-5 pr-4">
                      <span className="flex w-full items-center justify-between gap-3 text-left">
                        <SecurityIdentity name={securityName} />
                        <ChevronDown
                          size={15}
                          aria-hidden="true"
                          className={`flex-none text-ink-faint transition-transform ${
                            isExpanded ? "rotate-180 text-accent" : ""
                          }`}
                        />
                      </span>
                    </td>
                    <td className="numeric px-4 py-3.5 text-right text-[15px] font-bold text-ink-soft">
                      {decimalFormatter.format(Number(holding.quantity))}
                    </td>
                    <td className="numeric px-4 py-3.5 text-right text-[15px] font-semibold text-ink-soft">
                      {moneyFormatter.format(Number(holding.lastClosingPrice))}
                    </td>
                    <td className="numeric px-4 py-3.5 text-right text-[16px] font-extrabold text-ink">
                      {moneyFormatter.format(Number(holding.holdingValue))}
                    </td>
                    <td className="px-4 py-3.5">
                      <p className="text-[13.5px] font-bold text-ink-soft">
                        {holding.accountCount}{" "}
                        {holding.accountCount === 1 ? "account" : "accounts"}
                      </p>
                      <p className="mt-0.5 max-w-[13rem] truncate text-[12px] text-ink-muted">
                        {holding.ownerLabels.slice(0, 3).join(" · ")}
                      </p>
                    </td>
                    <td className="py-3.5 pl-4 pr-5 text-right">
                      <span className="numeric text-[14px] font-bold text-ink-soft">
                        {allocation.toFixed(1)}%
                      </span>
                      <Track
                        value={allocation}
                        className="ml-auto mt-1.5 w-20"
                      />
                    </td>
                  </tr>
                  {isExpanded ? (
                    <tr>
                      <td colSpan={6} className="border-b border-line p-0">
                        <HoldingInlineDetails id={detailId} holding={holding} />
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Mobile cards */}
      <div
        className="grid gap-2.5 bg-sunken p-3 lg:hidden"
        aria-label="Consolidated holdings"
        data-print="hide"
      >
        {holdings.map((holding) => {
          const allocation = allocationFor(holding, totalValue);
          const securityName = displaySecurityName(holding.securityName);
          const isExpanded = expandedIsins.has(holding.isin);
          const detailId = `mobile-holding-detail-${holding.isin}`;
          return (
            <article
              key={holding.isin}
              className={`overflow-hidden rounded-xl border bg-surface transition-[transform,box-shadow] duration-150 hover:-translate-y-px hover:shadow-sm ${
                isExpanded
                  ? "border-accent-line shadow-md"
                  : "border-line shadow-xs"
              }`}
            >
              <div className="p-4">
                <button
                  className="group -m-1 flex w-[calc(100%+0.5rem)] cursor-pointer items-start justify-between gap-3 rounded-lg p-1 text-left"
                  type="button"
                  onClick={() => toggleHolding(holding.isin)}
                  aria-label={`${isExpanded ? "Hide" : "View"} ${securityName} details`}
                  aria-expanded={isExpanded}
                  aria-controls={detailId}
                >
                  <SecurityIdentity name={securityName} />
                  <ChevronDown
                    size={16}
                    aria-hidden="true"
                    className={`mt-2 flex-none text-ink-faint transition-transform duration-150 group-hover:text-accent ${isExpanded ? "rotate-180 text-accent" : ""}`}
                  />
                </button>

                <p className="numeric mt-3 text-[23px] font-extrabold text-ink">
                  {moneyFormatter.format(Number(holding.holdingValue))}
                </p>

                <dl className="mt-3 grid grid-cols-3 gap-3">
                  {[
                    [
                      "Quantity",
                      decimalFormatter.format(Number(holding.quantity)),
                    ],
                    [
                      priceLabel,
                      moneyFormatter.format(Number(holding.lastClosingPrice)),
                    ],
                    ["Allocation", `${allocation.toFixed(1)}%`],
                  ].map(([label, value]) => (
                    <div key={label}>
                      <dt className="text-[11px] uppercase tracking-wide text-ink-faint">
                        {label}
                      </dt>
                      <dd className="numeric mt-0.5 text-[14px] font-bold text-ink-soft">
                        {value}
                      </dd>
                    </div>
                  ))}
                </dl>

                <Track value={allocation} className="mt-3 w-full" />
                <p className="mt-2 truncate text-[12px] text-ink-muted">
                  {ownershipLabel} · {holding.accountCount}{" "}
                  {holding.accountCount === 1 ? "account" : "accounts"} ·{" "}
                  {holding.ownerLabels.slice(0, 3).join(" · ")}
                </p>
              </div>
              {isExpanded ? (
                <HoldingInlineDetails id={detailId} holding={holding} />
              ) : null}
            </article>
          );
        })}
      </div>
    </>
  );
}

function Th({
  children,
  align = "left",
  className = "",
  sort,
  activeSort,
  sortDirection,
  onSort,
}: {
  children: React.ReactNode;
  align?: "left" | "right";
  className?: string;
  sort?: HoldingSort;
  activeSort?: HoldingSort;
  sortDirection?: SortDirection;
  onSort?: (sort: HoldingSort) => void;
}) {
  const isSortable = Boolean(sort && onSort);
  const isActive = sort === activeSort;

  return (
    <th
      scope="col"
      aria-sort={
        isActive
          ? sortDirection === "asc"
            ? "ascending"
            : "descending"
          : "none"
      }
      className={`px-4 py-3 text-[11.5px] font-bold uppercase tracking-[0.09em] text-ink-muted ${
        align === "right" ? "text-right" : "text-left"
      } ${className}`}
    >
      {isSortable && sort ? (
        <button
          type="button"
          className={`group inline-flex w-full cursor-pointer items-center gap-1 transition-colors hover:text-ink focus-visible:text-ink ${
            align === "right" ? "justify-end" : "justify-start"
          } ${isActive ? "text-ink" : ""}`}
          onClick={() => onSort?.(sort)}
          aria-label={`Sort by ${String(children)}, ${
            isActive
              ? sortDirection === "asc"
                ? "ascending"
                : "descending"
              : "not currently sorted"
          }`}
        >
          <span>{children}</span>
          <ArrowDown
            size={12}
            aria-hidden="true"
            className={`transition-all ${
              isActive
                ? sortDirection === "asc"
                  ? "rotate-180 text-accent"
                  : "text-accent"
                : "opacity-0 group-hover:opacity-50 group-focus-visible:opacity-50"
            }`}
          />
        </button>
      ) : (
        children
      )}
    </th>
  );
}

function SecurityIdentity({ name }: { name: string }) {
  return (
    <span className="flex min-w-0 items-center gap-3">
      <span
        className="grid size-10 flex-none place-items-center rounded-lg bg-sunken text-[11.5px] font-extrabold text-ink-soft"
        aria-hidden="true"
      >
        {securityInitials(name)}
      </span>
      <span className="min-w-0">
        <span
          className="block truncate text-[15px] font-bold tracking-tight text-ink"
          title={name}
        >
          {name}
        </span>
      </span>
    </span>
  );
}

function Track({
  value,
  className = "",
  color = "var(--accent)",
}: {
  value: number;
  className?: string;
  color?: string;
}) {
  return (
    <span
      className={`block h-1 overflow-hidden rounded-full bg-line ${className}`}
      aria-hidden="true"
    >
      <span
        className="block h-full rounded-full"
        style={{
          width: `${Math.max(Math.min(value, 100), 1.5)}%`,
          backgroundColor: color,
        }}
      />
    </span>
  );
}

function EmptyState({
  icon,
  title,
  body,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
}) {
  return (
    <div className="flex min-h-64 flex-col items-center justify-center px-6 py-14 text-center">
      <span className="grid size-11 place-items-center rounded-xl bg-accent-soft text-accent">
        {icon}
      </span>
      <p className="mt-3.5 text-[15px] font-bold text-ink">{title}</p>
      <p className="mt-1.5 max-w-sm text-[12.5px] leading-relaxed text-ink-muted">
        {body}
      </p>
    </div>
  );
}

/* ------------------------------------------------------------- accounts */

function AccountsView({
  accounts,
  totalValue,
  holdings,
}: {
  accounts: PortfolioView["accounts"];
  totalValue: number;
  holdings: PortfolioView["holdings"];
}) {
  const [expandedAccountId, setExpandedAccountId] = useState<string | null>(
    null,
  );
  const scrollPositionRef = useRef<number | null>(null);

  useLayoutEffect(() => {
    if (scrollPositionRef.current === null) return;
    window.scrollTo({ top: scrollPositionRef.current, behavior: "auto" });
    scrollPositionRef.current = null;
  }, [expandedAccountId]);

  const toggleAccount = (accountId: string) => {
    scrollPositionRef.current = window.scrollY;
    setExpandedAccountId((current) =>
      current === accountId ? null : accountId,
    );
  };

  if (!accounts.length) {
    return (
      <EmptyState
        icon={<Users size={22} aria-hidden="true" />}
        title="No accounts match this owner"
        body="Choose another owner to see their demat accounts."
      />
    );
  }

  return (
    <div className="grid gap-3 bg-sunken p-4 lg:grid-cols-2">
      {accounts.map((account) => (
        <AccountCard
          key={account.id}
          account={account}
          totalValue={totalValue}
          holdings={holdings}
          isExpanded={expandedAccountId === account.id}
          onToggle={() => toggleAccount(account.id)}
        />
      ))}
    </div>
  );
}

function AccountCard({
  account,
  totalValue,
  holdings,
  isExpanded,
  onToggle,
}: {
  account: PortfolioView["accounts"][number];
  totalValue: number;
  holdings: PortfolioView["holdings"];
  isExpanded: boolean;
  onToggle: () => void;
}) {
  const share = totalValue
    ? (Number(account.totalValue) / totalValue) * 100
    : 0;
  const isHealthy = account.status === "healthy";
  const detailId = `account-detail-${account.id}`;
  const accountHoldings = holdings
    .flatMap((holding) => {
      const accountHolding = holding.accountBreakdown.find(
        (breakdown) => breakdown.accountId === account.id,
      );
      return accountHolding ? [{ holding, accountHolding }] : [];
    })
    .sort(
      (left, right) =>
        Number(right.accountHolding.holdingValue) -
        Number(left.accountHolding.holdingValue),
    );

  return (
    <article
      className={`overflow-hidden rounded-xl border bg-surface transition-[box-shadow,border-color] duration-150 ${
        isExpanded ? "border-accent-line shadow-md" : "border-line shadow-xs"
      }`}
    >
      <div
        className="cursor-pointer p-5 transition-colors hover:bg-raised focus-visible:bg-raised"
        role="button"
        tabIndex={0}
        onClick={onToggle}
        onKeyDown={(event) => {
          if (event.key !== "Enter" && event.key !== " ") return;
          event.preventDefault();
          onToggle();
        }}
        aria-label={`${isExpanded ? "Hide" : "View"} ${account.ownerLabel}'s account holdings`}
        aria-expanded={isExpanded}
        aria-controls={detailId}
      >
        <div className="flex items-center gap-3">
          <span
            className="grid size-10 flex-none place-items-center rounded-lg bg-sunken text-[11px] font-extrabold text-ink-soft"
            aria-hidden="true"
          >
            {initials(account.ownerLabel)}
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[15px] font-bold text-ink">
              {account.ownerLabel}
            </p>
            <p className="truncate text-[12.5px] text-ink-faint">
              {account.accountLabel}
            </p>
          </div>
          <span
            className="inline-flex flex-none items-center gap-1.5 rounded-full px-2 py-1 text-[11.5px] font-bold"
            style={{
              color: isHealthy ? "var(--positive)" : "var(--warning)",
              backgroundColor: isHealthy
                ? "var(--accent-soft)"
                : "var(--warning-soft)",
            }}
          >
            <span
              className="size-1.5 rounded-full bg-current"
              aria-hidden="true"
            />
            {isHealthy ? "Current" : "Stale"}
          </span>
          <ChevronDown
            size={16}
            aria-hidden="true"
            className={`flex-none text-ink-faint transition-transform duration-150 ${
              isExpanded ? "rotate-180 text-accent" : ""
            }`}
          />
        </div>

        <p className="figure mt-4 text-[30px] font-extrabold leading-none text-ink">
          {moneyFormatter.format(Number(account.totalValue))}
        </p>
        <p className="mt-1.5 text-[12.5px] text-ink-muted">
          {share.toFixed(1)}% of the family portfolio
        </p>
        <Track value={share} className="mt-3" />

        <dl className="mt-4 grid grid-cols-3 gap-3 border-t border-line pt-3.5">
          {[
            [
              <Building2 key="b" size={13} aria-hidden="true" />,
              "Broker",
              account.brokerLabel,
            ],
            [
              <Fingerprint key="f" size={13} aria-hidden="true" />,
              "Demat",
              account.boidLast4 ? `•••• ${account.boidLast4}` : "Not added",
            ],
            [
              <WalletCards key="w" size={13} aria-hidden="true" />,
              "Holdings",
              String(account.holdingCount),
            ],
          ].map(([icon, label, value]) => (
            <div key={String(label)} className="min-w-0">
              <dt className="flex items-center gap-1 text-[11px] text-ink-faint">
                {icon}
                {label}
              </dt>
              <dd className="mt-1 truncate text-[13px] font-semibold text-ink-soft">
                {value}
              </dd>
            </div>
          ))}
        </dl>

        <p className="mt-3 flex items-center gap-1.5 text-[11.5px] text-ink-faint">
          <ShieldCheck size={13} className="text-accent" aria-hidden="true" />
          Reconciled {formatDateTime(account.lastSyncedAt)}
        </p>
      </div>

      {isExpanded ? (
        <div id={detailId} className="border-t border-line px-5 pb-5 pt-4">
          <div className="mb-2.5 flex items-center justify-between gap-3">
            <p className={LABEL}>Account holdings</p>
            <p className="text-[12px] font-medium text-ink-muted">
              {accountHoldings.length} securities
            </p>
          </div>
          {accountHoldings.length ? (
            <div className="divide-y divide-line border-y border-line">
              {accountHoldings.map(({ holding, accountHolding }) => (
                <div
                  key={holding.isin}
                  className="flex items-center justify-between gap-3 py-2.5"
                >
                  <div className="min-w-0">
                    <p
                      className="truncate text-[13px] font-semibold text-ink-soft"
                      title={displaySecurityName(holding.securityName)}
                    >
                      {displaySecurityName(holding.securityName)}
                    </p>
                    <p className="mt-0.5 text-[11.5px] text-ink-muted">
                      {decimalFormatter.format(Number(accountHolding.quantity))}{" "}
                      shares
                    </p>
                  </div>
                  <p className="numeric flex-none text-[13.5px] font-bold text-ink">
                    {moneyFormatter.format(Number(accountHolding.holdingValue))}
                  </p>
                </div>
              ))}
            </div>
          ) : (
            <p className="rounded-lg bg-raised px-3 py-2.5 text-[12.5px] text-ink-muted">
              No reconciled security lines are available for this account yet.
            </p>
          )}
        </div>
      ) : null}
    </article>
  );
}

/* ------------------------------------------------------------- insights */

function PortfolioAside({
  portfolio,
  totalValue,
}: {
  portfolio: PortfolioView;
  totalValue: number;
}) {
  const topPositions = [...portfolio.holdings]
    .sort(
      (left, right) => Number(right.holdingValue) - Number(left.holdingValue),
    )
    .slice(0, 5);
  const topPositionValue = topPositions.reduce(
    (total, holding) => total + Number(holding.holdingValue),
    0,
  );
  const topPositionShare = totalValue
    ? (topPositionValue / totalValue) * 100
    : 0;
  const restShare = Math.max(100 - topPositionShare, 0);

  return (
    <aside
      className="order-2 grid self-start gap-4 lg:order-1 xl:sticky xl:top-20 xl:order-2"
      aria-label="Portfolio insights"
    >
      <section className={`${CARD} overflow-hidden`} data-print="flat">
        <div className="border-b border-line px-5 py-4">
          <h2 className="text-[17px] font-bold tracking-tight text-ink">
            Top positions
          </h2>
          <p className="mt-0.5 text-[12.5px] text-ink-muted">
            Where the portfolio is concentrated
          </p>
        </div>

        {topPositions.length ? (
          <>
            <div className="border-b border-line bg-raised px-5 py-4">
              <div className="flex items-baseline justify-between">
                <p className="figure text-[28px] font-extrabold leading-none text-ink">
                  {topPositionShare.toFixed(1)}%
                </p>
                <p className="text-[12px] font-semibold text-ink-muted">
                  in the top {topPositions.length}
                </p>
              </div>

              {/* Part-to-whole at a glance: top holdings vs the remainder. */}
              <div className="mt-3 flex h-2.5 gap-0.5 overflow-hidden rounded-full">
                {topPositions.map((holding, index) => (
                  <span
                    key={holding.isin}
                    style={{
                      flex: `${Math.max(allocationFor(holding, totalValue), 0.6)} 0 0`,
                      backgroundColor: "var(--accent)",
                      opacity: 1 - index * 0.14,
                    }}
                    aria-hidden="true"
                  />
                ))}
                {restShare > 0.5 ? (
                  <span
                    style={{ flex: `${restShare} 0 0` }}
                    className="bg-line-strong"
                    aria-hidden="true"
                  />
                ) : null}
              </div>
              <p className="mt-2.5 text-[12px] leading-relaxed text-ink-muted">
                The remaining {restShare.toFixed(1)}% is spread across{" "}
                {Math.max(portfolio.holdings.length - topPositions.length, 0)}{" "}
                other{" "}
                {portfolio.holdings.length - topPositions.length === 1
                  ? "security"
                  : "securities"}
                .
              </p>
            </div>

            <ol className="px-5 py-1">
              {topPositions.map((holding, index) => {
                const allocation = allocationFor(holding, totalValue);
                return (
                  <li
                    key={holding.isin}
                    className="flex items-center gap-3 border-b border-line py-3 last:border-b-0"
                  >
                    <span className="numeric grid size-6 flex-none place-items-center rounded-md bg-sunken font-mono text-[10px] text-ink-muted">
                      {String(index + 1).padStart(2, "0")}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-baseline justify-between gap-3">
                        <span
                          className="truncate text-[13.5px] font-semibold text-ink-soft"
                          title={displaySecurityName(holding.securityName)}
                        >
                          {displaySecurityName(holding.securityName)}
                        </span>
                        <span className="numeric flex-none text-[13.5px] font-bold text-ink">
                          {allocation.toFixed(1)}%
                        </span>
                      </span>
                      <Track value={allocation} className="mt-1.5" />
                    </span>
                  </li>
                );
              })}
            </ol>
          </>
        ) : (
          <p className="px-5 py-8 text-[13.5px] leading-relaxed text-ink-muted">
            Top positions appear after the first sync.
          </p>
        )}
      </section>
    </aside>
  );
}

/* --------------------------------------------------------- inline detail */

function HoldingInlineDetails({
  id,
  holding,
}: {
  id: string;
  holding: AggregatedHolding;
}) {
  const securityName = displaySecurityName(holding.securityName);
  const holdingTotal = Number(holding.holdingValue);

  return (
    <section
      id={id}
      className="border-t border-line bg-sunken"
      aria-label={`${securityName} account breakdown`}
    >
      <PriceChart
        history={holding.priceHistory}
        securityName={securityName}
        formatMoney={(value) => moneyFormatter.format(value)}
        formatDate={formatDate}
      />

      <div className="px-5 pb-5 pt-4">
        <div className="flex items-baseline justify-between gap-3">
          <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-accent">
            Ownership
          </p>
          <p className="text-[12.5px] font-semibold text-ink-muted">
            {holding.accountBreakdown.length}{" "}
            {holding.accountBreakdown.length === 1 ? "account" : "accounts"}
          </p>
        </div>

        <ul className="mt-3 grid gap-2">
          {holding.accountBreakdown.map((accountHolding) => (
            <OwnershipRow
              key={accountHolding.accountId}
              accountHolding={accountHolding}
              holdingTotal={holdingTotal}
            />
          ))}
        </ul>
      </div>
    </section>
  );
}

function OwnershipRow({
  accountHolding,
  holdingTotal,
}: {
  accountHolding: AggregatedHolding["accountBreakdown"][number];
  holdingTotal: number;
}) {
  const accountValue = Number(accountHolding.holdingValue);
  const accountShare = holdingTotal ? (accountValue / holdingTotal) * 100 : 0;

  return (
    <li className="grid gap-3 rounded-xl border border-line bg-surface p-3.5 md:grid-cols-[minmax(0,1.1fr)_minmax(0,1.5fr)_auto] md:items-center">
      <div className="flex min-w-0 items-center gap-2.5">
        <span
          className="grid size-10 flex-none place-items-center rounded-lg bg-sunken text-[11px] font-extrabold text-ink-soft"
          aria-hidden="true"
        >
          {initials(accountHolding.ownerLabel)}
        </span>
        <div className="min-w-0">
          <p className="truncate text-[14px] font-bold text-ink">
            {accountHolding.ownerLabel}
          </p>
          <p className="truncate text-[12px] text-ink-faint">
            {accountHolding.accountLabel}
          </p>
        </div>
      </div>

      <dl className="grid grid-cols-3 gap-3">
        {[
          ["Broker / DP", accountHolding.brokerLabel],
          [
            "Demat",
            accountHolding.boidLast4
              ? `•••• ${accountHolding.boidLast4}`
              : "Not added",
          ],
          [
            "Quantity",
            decimalFormatter.format(Number(accountHolding.quantity)),
          ],
        ].map(([label, value]) => (
          <div key={label} className="min-w-0">
            <dt className="text-[11px] text-ink-faint">{label}</dt>
            <dd className="numeric mt-0.5 truncate text-[12.5px] font-semibold text-ink-soft">
              {value}
            </dd>
          </div>
        ))}
      </dl>

      <div className="md:text-right">
        <p className="numeric text-[15px] font-extrabold text-ink">
          {moneyFormatter.format(accountValue)}
        </p>
        <p className="numeric mt-0.5 text-[12px] text-ink-faint">
          {accountShare.toFixed(1)}% of this holding
        </p>
        <Track
          value={accountShare}
          className="mt-1.5 w-full md:ml-auto md:w-24"
        />
      </div>
    </li>
  );
}

/* ------------------------------------------------------------- helpers */

function allocationFor(holding: AggregatedHolding, totalValue: number): number {
  return totalValue ? (Number(holding.holdingValue) / totalValue) * 100 : 0;
}

function sortHoldings(
  holdings: AggregatedHolding[],
  sort: HoldingSort,
  direction: SortDirection,
): AggregatedHolding[] {
  return [...holdings].sort((left, right) => {
    let result: number;
    if (sort === "name") {
      result = displaySecurityName(left.securityName).localeCompare(
        displaySecurityName(right.securityName),
      );
    } else if (sort === "quantity") {
      result = Number(left.quantity) - Number(right.quantity);
    } else if (sort === "price") {
      result = Number(left.lastClosingPrice) - Number(right.lastClosingPrice);
    } else if (sort === "accounts") {
      result = left.accountCount - right.accountCount;
    } else {
      result = Number(left.holdingValue) - Number(right.holdingValue);
    }
    return direction === "asc" ? result : -result;
  });
}

function defaultSortDirection(sort: HoldingSort): SortDirection {
  return sort === "name" ? "asc" : "desc";
}

function marketLabel(marketState: NseMarketState | undefined): string {
  if (marketState === "open") return "NSE open";
  if (marketState === "pre-open") return "NSE pre-open";
  if (marketState === "closed") return "Market closed";
  return "NSE market status unavailable";
}

function labelForNsePrice(marketState: NseMarketState | undefined): string {
  if (marketState === "open") return "Live price";
  if (marketState === "pre-open") return "Indicative price";
  return "Last NSE price";
}

function nseValueLabel(marketState: NseMarketState): string {
  if (marketState === "open") return "Indicative NSE value";
  if (marketState === "pre-open") return "Indicative pre-open value";
  return "Last available NSE value";
}

function nextPriceRefreshDelay(snapshot: LocalPriceSnapshot | null): number {
  if (!snapshot) return LIVE_PRICE_REFRESH_MS;
  const nextRefreshAt = Date.parse(snapshot.nextRefreshAt);
  if (!Number.isNaN(nextRefreshAt)) {
    return Math.max(1_000, nextRefreshAt - Date.now());
  }
  return LIVE_PRICE_REFRESH_MS;
}

function formatDate(value: string): string {
  if (!value) return "Not available";
  const parsed = new Date(`${value}T00:00:00+05:30`);
  return Number.isNaN(parsed.getTime())
    ? "Not available"
    : dateFormatter.format(parsed);
}

function formatDateTime(value: string): string {
  if (!value) return "Not synced";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime())
    ? "Not synced"
    : dateTimeFormatter.format(parsed);
}

function initials(value: string): string {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}

function securityInitials(value: string): string {
  const ignored = new Set(["limited", "ltd", "india", "the", "bank"]);
  const parts = value
    .toLowerCase()
    .split(/\s+/)
    .map((part) => part.replace(/[^a-z0-9]/g, ""))
    .filter((part) => part && !ignored.has(part));
  const abbreviation =
    parts.length > 1 ? `${parts[0][0]}${parts[1][0]}` : parts[0]?.slice(0, 2);
  return (abbreviation ?? "SE").toUpperCase();
}

function escapeCsvCell(value: string): string {
  const safeValue = /^[=+\-@]/.test(value) ? `'${value}` : value;
  return `"${safeValue.replaceAll('"', '""')}"`;
}
