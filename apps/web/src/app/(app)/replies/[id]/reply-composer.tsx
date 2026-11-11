"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { CheckCircle2, RotateCcw, Send, Sparkles } from "lucide-react";
import { findPlaceholders } from "@crm/core/ai";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { AutoRefresh } from "@/components/auto-refresh";
import { redraftReplyAction, sendReplyAction, setReplyHandled } from "../actions";

type Props = {
  replyId: string;
  toName: string;
  toEmail: string;
  fromEmail: string | null;
  draft: string | null;
  draftStatus: string | null;
  draftAt: string | null;
  handled: boolean;
  canSend: boolean;
  /** "on" = AI can draft, "upgrade" = plan without AI, "off" = AI not set up. */
  ai: "on" | "upgrade" | "off";
};

export function ReplyComposer(props: Props) {
  // Remount the editor whenever a new draft arrives so it shows the new text.
  return <Composer key={props.draftAt ?? "none"} {...props} />;
}

function Composer({ replyId, toName, toEmail, fromEmail, draft, draftStatus, handled, canSend, ai }: Props) {
  const [body, setBody] = useState(draft ?? "");
  const [usingDraft, setUsingDraft] = useState(!!draft);
  const [notes, setNotes] = useState("");
  const [sendState, send, sending] = useActionState(sendReplyAction, undefined);
  const [draftState, redraft, drafting] = useActionState(redraftReplyAction, undefined);
  const writing = draftStatus === "pending" && !draft;

  if (sendState?.sent) {
    return (
      <Card className="border-success/40">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <CheckCircle2 className="size-4 text-success" /> Reply sent
          </CardTitle>
          <CardDescription>{sendState.message} It&apos;s in the conversation below.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  if (!canSend) return null;

  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    const holes = findPlaceholders(body);
    if (holes.length && !confirm(`Your reply still has ${holes.join(", ")} in it. Send anyway?`)) e.preventDefault();
  };

  return (
    <Card data-testid="reply-composer">
      <CardHeader>
        <CardTitle className="text-base">
          Reply to {toName}
          {handled && <span className="text-muted-foreground ml-2 text-xs font-normal">(marked as handled)</span>}
        </CardTitle>
        <CardDescription>
          Sends from {fromEmail ?? "the inbox that got this reply"} to {toEmail}, in the same email thread.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        <AutoRefresh active={writing} intervalMs={3000} />
        {writing && (
          <p className="text-muted-foreground flex items-center gap-2 text-sm" data-testid="draft-pending">
            <Sparkles className="size-4 animate-pulse" /> AI is writing a draft reply…
          </p>
        )}
        {draft && usingDraft && (
          <div className="bg-primary/5 border-primary/30 rounded-md border p-3 text-sm" data-testid="draft-ready">
            <div className="flex items-center gap-2 font-medium">
              <Sparkles className="size-4" /> AI drafted a reply. Will this work?
            </div>
            <p className="text-muted-foreground mt-1">Send it as is, edit it below, or write your own.</p>
          </div>
        )}
        {draftStatus === "failed" && !draft && ai === "on" && <p className="text-muted-foreground text-sm">The AI couldn&apos;t draft this one. Write your own, or try again.</p>}

        <form action={send} onSubmit={onSubmit} className="grid gap-3">
          <input type="hidden" name="reply_id" value={replyId} />
          <input type="hidden" name="ai_drafted" value={usingDraft ? "1" : "0"} />
          <textarea
            name="body"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={9}
            placeholder={writing ? "The draft will appear here…" : "Write your reply…"}
            className="border-input bg-background focus-visible:ring-ring rounded-md border px-3 py-2 text-sm focus-visible:ring-2 focus-visible:outline-none"
            aria-label="Reply message"
            maxLength={20000}
          />
          <div className="flex flex-wrap items-center gap-2">
            <Button disabled={sending || !body.trim()}>
              <Send /> {sending ? "Sending…" : "Send reply"}
            </Button>
            {draft && (
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setBody(usingDraft ? "" : draft);
                  setUsingDraft(!usingDraft);
                }}
              >
                {usingDraft ? "Write my own" : "Use the AI draft"}
              </Button>
            )}
            {sendState?.error && <span className="text-destructive text-sm">{sendState.error}</span>}
          </div>
        </form>

        {ai === "on" && (
          <form action={redraft} className="flex flex-wrap items-center gap-2 border-t pt-3">
            <input type="hidden" name="reply_id" value={replyId} />
            <Input
              name="notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder={draft ? "Tell the AI what to change (optional), e.g. shorter, offer Tuesday" : "Anything the AI should know? (optional)"}
              className="min-w-64 flex-1"
              maxLength={1000}
            />
            <Button variant="outline" disabled={drafting}>
              {draft ? <RotateCcw /> : <Sparkles />} {drafting ? "Writing…" : draft ? "Redo with AI" : "Draft with AI"}
            </Button>
            {draftState?.error && <span className="text-destructive text-sm">{draftState.error}</span>}
          </form>
        )}
        {ai === "upgrade" && (
          <p className="text-muted-foreground border-t pt-3 text-sm">
            Want AI to draft replies for you?{" "}
            <Link href="/billing" className="text-foreground underline">
              Upgrade to Pro
            </Link>
            .
          </p>
        )}

        <form action={setReplyHandled} className="border-t pt-3">
          <input type="hidden" name="reply_id" value={replyId} />
          <input type="hidden" name="handled" value={handled ? "0" : "1"} />
          <Button size="sm" variant="ghost">
            {handled ? "Move back to Needs reply" : "No reply needed — mark as handled"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
