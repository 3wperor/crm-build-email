import { getOrgContext } from "@/lib/org";
import { formatDate, formatDateTime, formatDay } from "@/lib/format";

/**
 * A moment in time, shown in the workspace's timezone. By default recent times
 * are relative ("2 hours ago") with the exact time on hover. Server components only.
 */
export async function Time({
  value,
  mode = "relative",
  fallback = "–",
  className,
}: {
  value: string | Date | null | undefined;
  mode?: "relative" | "day" | "exact";
  fallback?: string;
  className?: string;
}) {
  if (!value) return <>{fallback}</>;
  const { org } = await getOrgContext();
  const tz = org.default_timezone;
  const iso = value instanceof Date ? value.toISOString() : value;
  const text = mode === "exact" ? formatDateTime(value, tz) : mode === "day" ? formatDay(value, tz) : formatDate(value, tz);
  return (
    <time dateTime={iso} title={formatDateTime(value, tz)} className={className}>
      {text}
    </time>
  );
}
