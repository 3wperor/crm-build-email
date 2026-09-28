"use client";

import { useEffect, useId, useRef, useState } from "react";

export type DailyPoint = { day: string; sent: number; replied: number; bounced: number; unsubscribed: number };

const PAD = { top: 12, right: 16, bottom: 26, left: 40 };

/** Renders at the container's real pixel width, so 11px text stays 11px (no viewBox scaling). */
function useWidth(fallback = 560) {
  const ref = useRef<HTMLElement>(null);
  const [width, setWidth] = useState(fallback);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setWidth(Math.max(240, Math.round(entry!.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width] as const;
}

function niceTicks(max: number, count = 4): number[] {
  if (max <= 0) return [0, 1];
  const raw = max / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw;
  const ticks: number[] = [];
  for (let v = 0; v <= max + step * 0.001; v += step) ticks.push(Math.round(v * 1e6) / 1e6);
  if (ticks[ticks.length - 1]! < max) ticks.push(ticks[ticks.length - 1]! + step);
  return ticks;
}

function fmtDay(day: string, long = false): string {
  const d = new Date(`${day}T12:00:00Z`);
  return d.toLocaleDateString("en-US", { timeZone: "UTC", month: "short", day: "numeric", ...(long ? { weekday: "short" } : {}) });
}

/** Axis frame shared by both charts: hairline gridlines, y tick labels, a few x labels. */
function Frame({ days, ticks, y, h, x, w, right }: { days: DailyPoint[]; ticks: number[]; y: (v: number) => number; h: number; x: (i: number) => number; w: number; right: number }) {
  const xLabels = days.length <= 7 ? days.map((_, i) => i) : [0, Math.floor((days.length - 1) / 2), days.length - 1];
  return (
    <g aria-hidden="true">
      {ticks.map((t) => (
        <g key={t}>
          <line x1={PAD.left} x2={w - right} y1={y(t)} y2={y(t)} stroke="var(--border)" strokeWidth={1} />
          <text x={PAD.left - 6} y={y(t)} dy="0.32em" textAnchor="end" className="fill-muted-foreground text-[11px] tabular-nums">
            {t.toLocaleString()}
          </text>
        </g>
      ))}
      {xLabels.map((i) => (
        <text key={i} x={x(i)} y={h - 6} textAnchor={i === 0 && days.length > 7 ? "start" : i === days.length - 1 && days.length > 7 ? "end" : "middle"} className="fill-muted-foreground text-[11px]">
          {fmtDay(days[i]!.day)}
        </text>
      ))}
    </g>
  );
}

function Tooltip({ left, children }: { left: number; children: React.ReactNode }) {
  // left is a fraction of the chart width; keep the box inside the card.
  const clamped = Math.min(Math.max(left, 0.12), 0.88);
  return (
    <div
      role="status"
      className="bg-popover text-popover-foreground pointer-events-none absolute top-0 z-10 -translate-x-1/2 rounded-md border px-2.5 py-1.5 text-xs shadow-sm"
      style={{ left: `${clamped * 100}%` }}
    >
      {children}
    </div>
  );
}

/** Sends per day: one series, columns from a shared baseline. */
export function SentChart({ days }: { days: DailyPoint[] }) {
  const [ref, W] = useWidth();
  const [hover, setHover] = useState<number | null>(null);
  const H = 180;
  const max = Math.max(0, ...days.map((d) => d.sent));
  const ticks = niceTicks(max);
  const top = ticks[ticks.length - 1]!;
  const band = (W - PAD.left - PAD.right) / days.length;
  const barW = Math.max(2, Math.min(24, band - 2)); // ≤ 24px, ≥ 2px surface gap
  const x = (i: number) => PAD.left + band * i + band / 2;
  const y = (v: number) => PAD.top + (H - PAD.top - PAD.bottom) * (1 - v / top);
  const base = y(0);
  const total = days.reduce((n, d) => n + d.sent, 0);

  return (
    <figure className="relative" ref={ref}>
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} className="block" role="img" aria-label={`Emails sent per day, ${total} in total`}>
        <Frame days={days} ticks={ticks} y={y} h={H} x={x} w={W} right={PAD.right} />
        {days.map((d, i) => {
          const h = base - y(d.sent);
          const r = Math.min(4, h, barW / 2);
          const x0 = x(i) - barW / 2;
          return (
            <g key={d.day}>
              {d.sent > 0 && (
                <path
                  d={`M${x0},${base} V${base - h + r} Q${x0},${base - h} ${x0 + r},${base - h} H${x0 + barW - r} Q${x0 + barW},${base - h} ${x0 + barW},${base - h + r} V${base} Z`}
                  fill="var(--viz-1)"
                  opacity={hover === null || hover === i ? 1 : 0.55}
                />
              )}
              <rect
                x={PAD.left + band * i}
                y={PAD.top}
                width={band}
                height={H - PAD.top - PAD.bottom}
                fill="transparent"
                tabIndex={0}
                aria-label={`${fmtDay(d.day, true)}: ${d.sent} sent`}
                onPointerEnter={() => setHover(i)}
                onPointerLeave={() => setHover(null)}
                onFocus={() => setHover(i)}
                onBlur={() => setHover(null)}
                className="outline-none"
              />
            </g>
          );
        })}
        <line x1={PAD.left} x2={W - PAD.right} y1={base} y2={base} stroke="var(--muted-foreground)" strokeWidth={1} aria-hidden="true" />
      </svg>
      {hover !== null && (
        <Tooltip left={x(hover) / W}>
          <strong className="text-sm tabular-nums">{days[hover]!.sent.toLocaleString()}</strong> <span className="text-muted-foreground">sent</span>
          <div className="text-muted-foreground">{fmtDay(days[hover]!.day, true)}</div>
        </Tooltip>
      )}
    </figure>
  );
}

const RESPONSE_SERIES = [
  { key: "replied", label: "Replies", color: "var(--viz-1)" },
  { key: "bounced", label: "Bounces", color: "var(--viz-2)" },
  { key: "unsubscribed", label: "Unsubscribes", color: "var(--viz-3)" },
] as const;

/** Replies, bounces and unsubscribes per day: three lines on one count axis, crosshair readout. */
export function ResponsesChart({ days }: { days: DailyPoint[] }) {
  const [ref, W] = useWidth();
  const [hover, setHover] = useState<number | null>(null);
  const clipId = useId();
  const H = 200;
  const max = Math.max(0, ...days.flatMap((d) => RESPONSE_SERIES.map((s) => d[s.key])));
  const ticks = niceTicks(max);
  const top = ticks[ticks.length - 1]!;
  const RIGHT = 104; // room for the direct labels at the line ends
  const plotW = W - PAD.left - RIGHT;
  const x = (i: number) => PAD.left + (days.length === 1 ? plotW / 2 : (plotW * i) / (days.length - 1));
  const y = (v: number) => PAD.top + (H - PAD.top - PAD.bottom) * (1 - v / top);

  // Direct labels at the line ends, dropped (legend still names them) where they would collide.
  const last = days.length - 1;
  const ends = RESPONSE_SERIES.map((s) => ({ ...s, value: days[last]![s.key], y: y(days[last]![s.key]) })).sort((a, b) => a.y - b.y);
  const labeled = ends.filter((e, i) => i === 0 || e.y - ends[i - 1]!.y >= 13);

  function onMove(e: React.PointerEvent<SVGRectElement>) {
    const box = e.currentTarget.ownerSVGElement!.getBoundingClientRect();
    const px = ((e.clientX - box.left) / box.width) * W;
    const i = days.length === 1 ? 0 : Math.round(((px - PAD.left) / plotW) * (days.length - 1));
    setHover(Math.max(0, Math.min(last, i)));
  }

  return (
    <figure className="relative" ref={ref}>
      <ul className="mb-2 flex flex-wrap gap-4 text-xs" aria-label="Legend">
        {RESPONSE_SERIES.map((s) => (
          <li key={s.key} className="text-muted-foreground flex items-center gap-1.5">
            <svg width="16" height="8" aria-hidden="true">
              <line x1="1" x2="15" y1="4" y2="4" stroke={s.color} strokeWidth="2" strokeLinecap="round" />
            </svg>
            {s.label}
          </li>
        ))}
      </ul>
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} className="block" role="img" aria-label="Replies, bounces and unsubscribes per day">
        <clipPath id={clipId}>
          <rect x={PAD.left - 4} y={0} width={plotW + 8} height={H} />
        </clipPath>
        <Frame days={days} ticks={ticks} y={y} h={H} x={x} w={W} right={RIGHT} />
        {hover !== null && <line x1={x(hover)} x2={x(hover)} y1={PAD.top} y2={H - PAD.bottom} stroke="var(--muted-foreground)" strokeWidth={1} aria-hidden="true" />}
        <g clipPath={`url(#${clipId})`}>
          {RESPONSE_SERIES.map((s) => (
            <polyline
              key={s.key}
              points={days.map((d, i) => `${x(i)},${y(d[s.key])}`).join(" ")}
              fill="none"
              stroke={s.color}
              strokeWidth={2}
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          ))}
        </g>
        {hover !== null &&
          RESPONSE_SERIES.map((s) => (
            <circle key={s.key} cx={x(hover)} cy={y(days[hover]![s.key])} r={4.5} fill={s.color} stroke="var(--card)" strokeWidth={2} aria-hidden="true" />
          ))}
        {labeled.map((e) => (
          <text key={e.key} x={W - RIGHT + 8} y={e.y} dy="0.32em" className="fill-foreground text-[11px]">
            <tspan className="font-semibold tabular-nums">{e.value}</tspan> <tspan className="fill-muted-foreground">{e.label.toLowerCase()}</tspan>
          </text>
        ))}
        <rect
          x={PAD.left}
          y={PAD.top}
          width={plotW}
          height={H - PAD.top - PAD.bottom}
          fill="transparent"
          tabIndex={0}
          aria-label="Use the left and right arrow keys to read values per day"
          onPointerMove={onMove}
          onPointerLeave={() => setHover(null)}
          onFocus={() => setHover(last)}
          onBlur={() => setHover(null)}
          onKeyDown={(e) => {
            if (e.key === "ArrowLeft") setHover((h) => Math.max(0, (h ?? last) - 1));
            if (e.key === "ArrowRight") setHover((h) => Math.min(last, (h ?? last) + 1));
          }}
          className="outline-none focus-visible:stroke-[var(--ring)]"
        />
      </svg>
      {hover !== null && (
        <Tooltip left={x(hover) / W}>
          <div className="text-muted-foreground mb-1">{fmtDay(days[hover]!.day, true)}</div>
          {RESPONSE_SERIES.map((s) => (
            <div key={s.key} className="flex items-center gap-1.5">
              <svg width="12" height="6" aria-hidden="true">
                <line x1="1" x2="11" y1="3" y2="3" stroke={s.color} strokeWidth="2" strokeLinecap="round" />
              </svg>
              <strong className="tabular-nums">{days[hover]![s.key]}</strong>
              <span className="text-muted-foreground">{s.label.toLowerCase()}</span>
            </div>
          ))}
        </Tooltip>
      )}
    </figure>
  );
}
