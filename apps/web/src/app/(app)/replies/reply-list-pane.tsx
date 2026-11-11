import Link from "next/link";
import { extractReplyText } from "@crm/core";
import { createClient } from "@/lib/supabase/server";
import { Time } from "@/components/time";
import { cn } from "@/lib/utils";

/**
 * The narrow list beside an open conversation (wide screens only), so you can
 * work through replies without going back to the full list each time.
 */
export async function ReplyListPane({ orgId, currentId }: { orgId: string; currentId: string }) {
  const supabase = await createClient();
  const { data: replies } = await supabase
    .from("replies")
    .select("id, from_email, body_text, subject, classification, received_at, handled_at, leads(first_name, last_name)")
    .eq("org_id", orgId)
    .order("received_at", { ascending: false })
    .limit(40);
  if (!replies?.length) return null;

  return (
    <aside aria-label="Other replies" className="sticky top-20 hidden max-h-[calc(100vh-6.5rem)] overflow-y-auto rounded-lg border lg:block">
      <ul className="divide-y">
        {replies.map((r) => {
          const current = r.id === currentId;
          const waiting = !r.handled_at && (r.classification === "positive" || r.classification === "neutral");
          return (
            <li key={r.id}>
              <Link
                href={`/replies/${r.id}`}
                aria-current={current ? "page" : undefined}
                className={cn(
                  "focus-visible:ring-ring/50 relative block px-3.5 py-3 outline-none focus-visible:ring-[3px] focus-visible:ring-inset",
                  current ? "bg-accent" : "hover:bg-muted/50",
                )}
              >
                {waiting && <span aria-hidden="true" className="bg-primary absolute inset-y-0 left-0 w-0.5" />}
                <div className="flex items-baseline justify-between gap-2">
                  <span className={cn("truncate text-sm", waiting ? "font-semibold" : "font-medium")}>
                    {[r.leads?.first_name, r.leads?.last_name].filter(Boolean).join(" ") || r.from_email}
                  </span>
                  <Time value={r.received_at} className="text-muted-foreground text-caption shrink-0 whitespace-nowrap" />
                </div>
                <p className="text-muted-foreground text-small mt-0.5 line-clamp-2">
                  {waiting && <span className="sr-only">Needs reply. </span>}
                  {extractReplyText(r.body_text ?? "").slice(0, 120) || r.subject || "(no message)"}
                </p>
              </Link>
            </li>
          );
        })}
      </ul>
    </aside>
  );
}
