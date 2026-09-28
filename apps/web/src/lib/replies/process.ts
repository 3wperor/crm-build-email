import "server-only";
import { simpleParser, type AddressObject, type ParsedMail } from "mailparser";
import {
  classifyReplyHeuristic,
  extractMessageIds,
  extractReplyText,
  isBounceMessage,
  normalizeEmail,
  parseBounce,
  pickReplyMatch,
  FROM_EMAIL_MATCH_WINDOW_DAYS,
  type MatchCandidate,
  type ReplyClass,
} from "@crm/core";
import type { FetchedMessage, MailboxCursor } from "@crm/mail";
import { createMailAdapter } from "@crm/mail";
import { createAdminClient } from "@/lib/supabase/admin";
import { ACCOUNT_CONNECTION_COLUMNS, loadAccountPassword, mailAdapterOptions, toMailConfig } from "@/lib/sending-accounts";
import { aiClassifierAvailable, classifyReplyWithAi } from "./ai-classifier";

type Admin = ReturnType<typeof createAdminClient>;

export type MessageOutcome = "reply" | "bounce" | "ignored_own" | "ignored_duplicate" | "ignored_unmatched" | "ignored_internal";

const MAX_BODY = 50_000;

function firstAddress(a: AddressObject | AddressObject[] | undefined): { address: string; name: string } | null {
  const obj = Array.isArray(a) ? a[0] : a;
  const v = obj?.value?.[0];
  return v?.address ? { address: normalizeEmail(v.address), name: v.name ?? "" } : null;
}

function headerMap(parsed: ParsedMail): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of parsed.headers) out[k] = typeof v === "string" ? v : JSON.stringify(v);
  return out;
}

function refsOf(parsed: ParsedMail): string[] {
  const r = parsed.references;
  return (Array.isArray(r) ? r : r ? [r] : []).flatMap((x) => x.split(/\s+/)).filter(Boolean);
}

/** Looks up our sends by Message-ID (org-scoped). */
async function sendsByMessageIds(admin: Admin, orgId: string, ids: string[]): Promise<MatchCandidate[]> {
  if (!ids.length) return [];
  const { data } = await admin
    .from("sends")
    .select("id, lead_id, message_id, sent_at, leads!inner(email)")
    .eq("org_id", orgId)
    .in("message_id", ids.slice(0, 100));
  return (data ?? []).map((s) => ({ sendId: s.id, leadId: s.lead_id, leadEmail: s.leads.email, messageId: s.message_id, sentAt: s.sent_at }));
}

/**
 * Processes one fetched message for one inbox. Idempotent per Message-ID:
 * replies are unique per org, bounces act through idempotent upserts.
 */
export async function processMessage(
  admin: Admin,
  account: { id: string; org_id: string; email: string },
  msg: FetchedMessage,
  opts: { aiEnabled: boolean },
): Promise<MessageOutcome> {
  const raw = msg.source.toString("utf8");
  const parsed = await simpleParser(msg.source, { skipImageLinks: true, skipTextToHtml: true });
  const from = firstAddress(parsed.from);
  const headers = headerMap(parsed);
  const messageId = parsed.messageId ?? `<no-id-${account.id}-${msg.mailbox}-${msg.uid}@ycareach.local>`;
  const receivedAt = parsed.date ?? new Date();
  const subject = parsed.subject ?? "";

  // Our own mail (test emails, warmup, sent copies) never counts as a reply.
  if (headers["x-ycareach-test"] || headers["x-ycareach-warmup"]) return "ignored_internal";
  if (!from || from.address === account.email) return "ignored_own";

  // --- Bounces (DSN) -------------------------------------------------------------
  if (isBounceMessage({ from: `${from.name} <${from.address}>`, subject, contentType: headers["content-type"], raw })) {
    const bounce = parseBounce(raw);
    const matches = await sendsByMessageIds(admin, account.org_id, extractMessageIds(raw).filter((id) => id !== messageId));
    const send = matches[0];
    if (!send) return "ignored_unmatched";
    const { data: existing } = await admin.from("events").select("id").eq("send_id", send.sendId).eq("type", "bounce").limit(1);
    if (!existing?.length) {
      await admin.from("events").insert({
        org_id: account.org_id,
        send_id: send.sendId,
        type: "bounce",
        meta: { stage: "dsn", permanent: bounce.permanent, status: bounce.status, diagnostic: bounce.diagnostic, recipient: bounce.recipient },
      });
    }
    if (bounce.permanent) {
      await admin.from("sends").update({ status: "bounced", error: bounce.diagnostic ?? `bounce ${bounce.status ?? ""}`.trim() }).eq("id", send.sendId);
      await admin
        .from("suppression_list")
        .upsert(
          { org_id: account.org_id, email: send.leadEmail, reason: "hard_bounce", source: `dsn:${send.sendId}` },
          { onConflict: "org_id,email", ignoreDuplicates: true },
        );
      await admin.rpc("stop_lead_sequences", { p_org_id: account.org_id, p_lead_id: send.leadId, p_status: "bounced", p_reason: "hard_bounce" });
    }
    return "bounce";
  }

  // --- Replies --------------------------------------------------------------------
  const { data: dup } = await admin.from("replies").select("id").eq("org_id", account.org_id).eq("message_id", messageId).maybeSingle();
  if (dup) return "ignored_duplicate";

  const inReplyTo = parsed.inReplyTo?.trim() ?? null;
  const references = refsOf(parsed);
  const byMessageId = await sendsByMessageIds(admin, account.org_id, [...(inReplyTo ? [inReplyTo] : []), ...references]);
  let byLeadEmail: MatchCandidate[] = [];
  if (!byMessageId.length) {
    const since = new Date(receivedAt.getTime() - FROM_EMAIL_MATCH_WINDOW_DAYS * 864e5).toISOString();
    const { data } = await admin
      .from("sends")
      .select("id, lead_id, message_id, sent_at, leads!inner(email)")
      .eq("org_id", account.org_id)
      .eq("sending_account_id", account.id)
      .eq("leads.email", from.address)
      .eq("status", "sent")
      .gte("sent_at", since)
      .order("sent_at", { ascending: false })
      .limit(5);
    byLeadEmail = (data ?? []).map((s) => ({ sendId: s.id, leadId: s.lead_id, leadEmail: s.leads.email, messageId: s.message_id, sentAt: s.sent_at }));
  }
  const match = pickReplyMatch({ inReplyTo, references, fromEmail: from.address, receivedAt, byMessageId, byLeadEmail });
  // Unrelated inbox mail is never stored.
  if (!match) return "ignored_unmatched";

  const text = (parsed.text ?? "").slice(0, MAX_BODY);
  const heuristic = classifyReplyHeuristic({ subject, text, headers, receivedAt });
  let classification: ReplyClass = heuristic.classification;
  let source: "heuristic" | "ai" = "heuristic";
  let reason = heuristic.reason;
  if (heuristic.confidence === "low" && opts.aiEnabled && aiClassifierAvailable()) {
    const ai = await classifyReplyWithAi({ subject, replyText: extractReplyText(text) });
    if (ai) {
      classification = ai.classification;
      source = "ai";
      reason = ai.reason;
    }
  }

  const { data: reply, error } = await admin
    .from("replies")
    .insert({
      org_id: account.org_id,
      sending_account_id: account.id,
      send_id: match.sendId,
      lead_id: match.leadId,
      message_id: messageId,
      in_reply_to: inReplyTo,
      references,
      from_email: from.address,
      subject,
      body_text: text,
      body_html: typeof parsed.html === "string" ? parsed.html.slice(0, MAX_BODY) : null,
      classification,
      classification_source: source,
      classification_reason: reason.slice(0, 300),
      match_method: match.method,
      mailbox: msg.mailbox,
      received_at: receivedAt.toISOString(),
    })
    .select("id")
    .single();
  if (error) {
    if (error.code === "23505") return "ignored_duplicate"; // raced with another sync
    throw new Error(error.message);
  }

  await admin.from("events").insert({ org_id: account.org_id, send_id: match.sendId, type: "reply", meta: { reply_id: reply.id, classification } });
  const { error: outcomeError } = await admin.rpc("apply_reply_outcome", {
    p_org_id: account.org_id,
    p_reply_id: reply.id,
    ...(heuristic.oooUntil && classification === "out_of_office" ? { p_ooo_until: heuristic.oooUntil.toISOString() } : {}),
  });
  if (outcomeError) throw new Error(outcomeError.message);
  return "reply";
}

export type SyncSummary = { fetched: number; initialized: string[]; outcomes: Partial<Record<MessageOutcome, number>> };

/** Pull new mail for one inbox, process it, advance the cursors. */
export async function syncAccount(orgId: string, accountId: string): Promise<SyncSummary> {
  const admin = createAdminClient();
  const { data: account } = await admin
    .from("sending_accounts")
    .select(`${ACCOUNT_CONNECTION_COLUMNS}, imap_cursors, status, organizations!inner(ai_classification_enabled)`)
    .eq("org_id", orgId)
    .eq("id", accountId)
    .maybeSingle();
  if (!account || account.status === "disconnected") return { fetched: 0, initialized: [], outcomes: {} };

  const password = await loadAccountPassword(orgId, account.id);
  const adapter = createMailAdapter(toMailConfig(account, password), mailAdapterOptions());
  let result;
  try {
    result = await adapter.fetchNewMessages((account.imap_cursors ?? {}) as Record<string, MailboxCursor>, {
      includeJunk: true,
      limitPerMailbox: 100,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await admin
      .from("sending_accounts")
      .update({ imap_last_error: message.slice(0, 300), health: "degraded", health_detail: `IMAP sync: ${message}`.slice(0, 300) })
      .eq("id", account.id);
    throw e;
  }

  const outcomes: SyncSummary["outcomes"] = {};
  for (const msg of result.messages) {
    const o = await processMessage(admin, { id: account.id, org_id: orgId, email: account.email }, msg, {
      aiEnabled: account.organizations.ai_classification_enabled,
    });
    outcomes[o] = (outcomes[o] ?? 0) + 1;
  }

  // Cursors advance only after every message in the batch was processed.
  await admin
    .from("sending_accounts")
    .update({ imap_cursors: result.cursors, imap_last_synced_at: new Date().toISOString(), imap_last_error: null })
    .eq("id", account.id);
  return { fetched: result.messages.length, initialized: result.initialized, outcomes };
}
