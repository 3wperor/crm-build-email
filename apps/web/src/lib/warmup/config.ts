/** Random delay before a planned warmup email goes out (spreads sends inside the tick). */
export function warmupJitterSeconds(): number {
  const max = Number(process.env.WARMUP_JITTER_SECONDS ?? 540);
  return Math.floor(Math.random() * (Number.isFinite(max) ? Math.max(0, max) : 540));
}

/** Replies go out a while after the email "was read", like a person would. Overridable for local testing only. */
export function warmupReplyDelaySeconds(): number {
  const min = Number(process.env.WARMUP_REPLY_DELAY_MIN_SECONDS ?? 300);
  const max = Number(process.env.WARMUP_REPLY_DELAY_MAX_SECONDS ?? 2400);
  const lo = Number.isFinite(min) ? Math.max(0, min) : 300;
  const hi = Number.isFinite(max) ? Math.max(lo, max) : 2400;
  return lo + Math.floor(Math.random() * (hi - lo + 1));
}

/** At most this many new warmup emails per inbox per tick. */
export const WARMUP_MAX_PER_TICK = 3;
