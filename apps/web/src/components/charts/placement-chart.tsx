"use client";

import { useState } from "react";
import { fmtDay, Frame, niceTicks, PAD, Tooltip, useWidth } from "./daily-charts";

export type PlacementPoint = { day: string; inbox: number; spam: number };

const SERIES = [
  { key: "inbox", label: "Landed in inbox", color: "var(--viz-1)" },
  { key: "spam", label: "Landed in spam", color: "var(--viz-2)" },
] as const;

/** Warmup emails received per day, stacked by where they landed. */
export function PlacementChart({ days }: { days: PlacementPoint[] }) {
  const [ref, W] = useWidth();
  const [hover, setHover] = useState<number | null>(null);
  const H = 190;
  const max = Math.max(0, ...days.map((d) => d.inbox + d.spam));
  const ticks = niceTicks(max);
  const top = ticks[ticks.length - 1]!;
  const band = (W - PAD.left - PAD.right) / days.length;
  const barW = Math.max(2, Math.min(24, band - 4));
  const x = (i: number) => PAD.left + band * i + band / 2;
  const y = (v: number) => PAD.top + (H - PAD.top - PAD.bottom) * (1 - v / top);
  const base = y(0);
  const GAP = 2; // surface gap between stacked segments

  const column = (i: number, lo: number, hi: number, rounded: boolean) => {
    const x0 = x(i) - barW / 2;
    const yTop = y(hi);
    const yBot = y(lo) - (lo > 0 ? GAP : 0);
    const h = yBot - yTop;
    if (h <= 0) return null;
    const r = rounded ? Math.min(4, h, barW / 2) : 0;
    return `M${x0},${yBot} V${yTop + r} Q${x0},${yTop} ${x0 + r},${yTop} H${x0 + barW - r} Q${x0 + barW},${yTop} ${x0 + barW},${yTop + r} V${yBot} Z`;
  };

  return (
    <figure className="relative" ref={ref}>
      <ul className="mb-2 flex flex-wrap gap-4 text-xs" aria-label="Legend">
        {SERIES.map((s) => (
          <li key={s.key} className="text-muted-foreground flex items-center gap-1.5">
            <svg width="10" height="10" aria-hidden="true">
              <rect width="10" height="10" rx="2" fill={s.color} />
            </svg>
            {s.label}
          </li>
        ))}
      </ul>
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} className="block" role="img" aria-label="Warmup emails received per day, by inbox or spam placement">
        <Frame days={days} ticks={ticks} y={y} h={H} x={x} w={W} right={PAD.right} />
        {days.map((d, i) => {
          const inboxPath = column(i, 0, d.inbox, d.spam === 0);
          const spamPath = d.spam > 0 ? column(i, d.inbox, d.inbox + d.spam, true) : null;
          const dim = hover !== null && hover !== i ? 0.55 : 1;
          return (
            <g key={d.day}>
              {inboxPath && <path d={inboxPath} fill="var(--viz-1)" opacity={dim} />}
              {spamPath && <path d={spamPath} fill="var(--viz-2)" opacity={dim} />}
              <rect
                x={PAD.left + band * i}
                y={PAD.top}
                width={band}
                height={H - PAD.top - PAD.bottom}
                fill="transparent"
                tabIndex={0}
                aria-label={`${fmtDay(d.day, true)}: ${d.inbox} in inbox, ${d.spam} in spam`}
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
          <div className="text-muted-foreground mb-1">{fmtDay(days[hover]!.day, true)}</div>
          {SERIES.map((s) => (
            <div key={s.key} className="flex items-center gap-1.5">
              <svg width="12" height="6" aria-hidden="true">
                <line x1="1" x2="11" y1="3" y2="3" stroke={s.color} strokeWidth="2" strokeLinecap="round" />
              </svg>
              <strong className="tabular-nums">{days[hover]![s.key]}</strong>
              <span className="text-muted-foreground">{s.key}</span>
            </div>
          ))}
        </Tooltip>
      )}
    </figure>
  );
}
