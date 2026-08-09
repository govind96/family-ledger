"use client";

import { TrendingDown, TrendingUp } from "lucide-react";
import { useId, useMemo, useState } from "react";
import type { HoldingPricePoint } from "@/lib/domain";

type PriceChartProps = {
  history: HoldingPricePoint[];
  securityName: string;
  formatMoney: (value: number) => string;
  formatDate: (value: string) => string;
};

/* Plot geometry in user units. The SVG scales to its container; strokes are
   pinned with vector-effect so line weight stays honest at any width. */
const VIEW_WIDTH = 720;
const VIEW_HEIGHT = 200;
const PAD_TOP = 18;
const PAD_BOTTOM = 16;
const PAD_X = 8;

export function PriceChart({
  history,
  securityName,
  formatMoney,
  formatDate,
}: PriceChartProps) {
  const gradientId = useId();
  const points = useMemo(() => history.slice(-60), [history]);
  const [activeIndex, setActiveIndex] = useState<number | null>(null);

  const geometry = useMemo(() => {
    const closes = points.map((point) => Number(point.close));
    const low = Math.min(...closes);
    const high = Math.max(...closes);
    const span = high - low || Math.max(high * 0.02, 1);
    const plotHeight = VIEW_HEIGHT - PAD_TOP - PAD_BOTTOM;
    const step =
      points.length > 1 ? (VIEW_WIDTH - PAD_X * 2) / (points.length - 1) : 0;

    const coords = closes.map((close, index) => ({
      x: PAD_X + step * index,
      y: PAD_TOP + plotHeight - ((close - low) / span) * plotHeight,
      close,
    }));

    return { closes, low, high, coords };
  }, [points]);

  if (points.length < 2) {
    return (
      <section
        className="flex flex-wrap items-center justify-between gap-3 border-b border-line bg-raised px-5 py-4"
        aria-label="Closing price history"
      >
        <div>
          <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-accent">
            Price history
          </p>
          <p className="mt-0.5 text-[15px] font-semibold text-ink">
            Awaiting another daily snapshot
          </p>
        </div>
        <p className="max-w-xs text-[12.5px] leading-relaxed text-ink-muted">
          The trend line is drawn only from reconciled CDSL closes, so it
          appears once two price dates exist.
        </p>
      </section>
    );
  }

  const { closes, low, high, coords } = geometry;
  const first = closes[0]!;
  const latest = closes.at(-1)!;
  const change = first ? ((latest - first) / first) * 100 : 0;
  const rising = change >= 0;
  const trendColor = rising ? "var(--positive)" : "var(--negative)";

  const linePath = coords
    .map((point, index) => `${index ? "L" : "M"}${point.x} ${point.y}`)
    .join(" ");
  const areaPath = `${linePath} L${coords.at(-1)!.x} ${VIEW_HEIGHT - PAD_BOTTOM} L${coords[0]!.x} ${VIEW_HEIGHT - PAD_BOTTOM} Z`;

  const activePoint = activeIndex === null ? null : points[activeIndex];
  const activeCoord = activeIndex === null ? null : coords[activeIndex]!;
  const markerCoord = activeCoord ?? coords.at(-1)!;
  const readoutIndex = activeIndex ?? points.length - 1;
  const readoutPoint = points[readoutIndex]!;

  const trackFromPointer = (clientX: number, target: SVGSVGElement) => {
    const box = target.getBoundingClientRect();
    if (!box.width) return;
    const ratio = (clientX - box.left) / box.width;
    const index = Math.round(ratio * (points.length - 1));
    setActiveIndex(Math.min(points.length - 1, Math.max(0, index)));
  };

  const onKeyDown = (event: React.KeyboardEvent<SVGSVGElement>) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const current = activeIndex ?? points.length - 1;
    const next = event.key === "ArrowLeft" ? current - 1 : current + 1;
    setActiveIndex(Math.min(points.length - 1, Math.max(0, next)));
  };

  return (
    <section
      className="border-b border-line bg-raised px-5 pb-4 pt-4"
      aria-label={`Closing price history for ${securityName}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-accent">
            Price history
          </p>
          <p className="mt-0.5 text-[15px] font-semibold text-ink">
            Last {points.length} reconciled closes
          </p>
        </div>

        <dl className="flex items-center gap-5">
          <div>
            <dt className="text-[11px] uppercase tracking-wide text-ink-faint">
              {activeIndex === null
                ? "Latest close"
                : formatDate(readoutPoint.date)}
            </dt>
            <dd className="numeric mt-0.5 text-[17px] font-bold text-ink">
              {formatMoney(Number(readoutPoint.close))}
            </dd>
          </div>
          <div>
            <dt className="text-[11px] uppercase tracking-wide text-ink-faint">
              Period change
            </dt>
            <dd
              className="numeric mt-0.5 flex items-center gap-1 text-[17px] font-bold"
              style={{ color: trendColor }}
            >
              {rising ? (
                <TrendingUp size={14} aria-hidden="true" />
              ) : (
                <TrendingDown size={14} aria-hidden="true" />
              )}
              {rising ? "+" : "−"}
              {Math.abs(change).toFixed(1)}%
            </dd>
          </div>
          <div className="hidden sm:block">
            <dt className="text-[11px] uppercase tracking-wide text-ink-faint">
              Range
            </dt>
            <dd className="numeric mt-0.5 text-[17px] font-bold text-ink-soft">
              {formatMoney(low)} – {formatMoney(high)}
            </dd>
          </div>
        </dl>
      </div>

      <div className="relative mt-3">
        <svg
          className="block h-[190px] w-full touch-none"
          viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`}
          preserveAspectRatio="none"
          role="img"
          tabIndex={0}
          aria-label={`Closing prices for ${securityName} from ${formatDate(points[0]!.date)} to ${formatDate(points.at(-1)!.date)}. Latest close ${formatMoney(latest)}, ${rising ? "up" : "down"} ${Math.abs(change).toFixed(1)} percent over the period. Use the left and right arrow keys to read individual closes.`}
          onKeyDown={onKeyDown}
          onPointerMove={(event) =>
            trackFromPointer(event.clientX, event.currentTarget)
          }
          onPointerLeave={() => setActiveIndex(null)}
          onBlur={() => setActiveIndex(null)}
        >
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={trendColor} stopOpacity="0.22" />
              <stop offset="100%" stopColor={trendColor} stopOpacity="0" />
            </linearGradient>
          </defs>

          {/* Recessive baseline — one shade off the surface, solid hairline. */}
          <line
            x1="0"
            y1={VIEW_HEIGHT - PAD_BOTTOM}
            x2={VIEW_WIDTH}
            y2={VIEW_HEIGHT - PAD_BOTTOM}
            stroke="var(--line)"
            strokeWidth="1"
            vectorEffect="non-scaling-stroke"
          />

          <path d={areaPath} fill={`url(#${gradientId})`} />
          <path
            d={linePath}
            fill="none"
            stroke={trendColor}
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />

          {activeCoord ? (
            <line
              x1={activeCoord.x}
              y1={PAD_TOP - 12}
              x2={activeCoord.x}
              y2={VIEW_HEIGHT - PAD_BOTTOM}
              stroke="var(--line-strong)"
              strokeWidth="1"
              vectorEffect="non-scaling-stroke"
            />
          ) : null}
        </svg>

        {/* Markers live in HTML: the plot is stretched to its container, so an
            SVG circle would render as an ellipse. */}
        <span
          className="pointer-events-none absolute size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2"
          style={{
            left: `${(markerCoord.x / VIEW_WIDTH) * 100}%`,
            top: `${(markerCoord.y / VIEW_HEIGHT) * 100}%`,
            backgroundColor: trendColor,
            borderColor: "var(--surface-raised)",
          }}
          aria-hidden="true"
        />

        {activePoint ? (
          <div
            className="pointer-events-none absolute -top-1 z-10 -translate-x-1/2 whitespace-nowrap rounded-lg border border-line bg-surface px-2.5 py-1.5 shadow-md"
            style={{
              left: `${Math.min(90, Math.max(10, (activeCoord!.x / VIEW_WIDTH) * 100))}%`,
            }}
          >
            <p className="numeric text-[15px] font-bold text-ink">
              {formatMoney(Number(activePoint.close))}
            </p>
            <p className="text-[11px] text-ink-muted">
              {formatDate(activePoint.date)}
            </p>
          </div>
        ) : null}
      </div>

      <div className="mt-1 flex items-center justify-between text-[11px] text-ink-faint">
        <span>{formatDate(points[0]!.date)}</span>
        <span>{formatDate(points.at(-1)!.date)}</span>
      </div>

      {/* Accessible twin: every plotted value is readable without the chart. */}
      <details className="mt-2 group" data-print="hide">
        <summary className="w-fit cursor-pointer list-none text-[11px] font-semibold uppercase tracking-wide text-ink-faint hover:text-accent">
          Show closes as a table
        </summary>
        <div className="scroll-x mt-2 max-h-44 overflow-y-auto rounded-lg border border-line">
          <table className="w-full border-collapse text-left">
            <caption className="sr-only">
              Reconciled closing prices for {securityName}
            </caption>
            <thead className="sticky top-0 bg-sunken">
              <tr>
                <th className="px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
                  Price date
                </th>
                <th className="px-3 py-2 text-right text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
                  Close
                </th>
              </tr>
            </thead>
            <tbody>
              {[...points].reverse().map((point) => (
                <tr key={point.date} className="border-t border-line">
                  <td className="px-3 py-2 text-[12.5px] text-ink-soft">
                    {formatDate(point.date)}
                  </td>
                  <td className="numeric px-3 py-2 text-right text-[12.5px] text-ink">
                    {formatMoney(Number(point.close))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </section>
  );
}
