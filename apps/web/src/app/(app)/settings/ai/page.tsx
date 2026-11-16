import Link from "next/link";
import { can } from "@crm/core";
import { hasProAccess } from "@crm/core/billing";
import { getOrgContext } from "@/lib/org";
import { createClient } from "@/lib/supabase/server";
import { getBillingStatus } from "@/lib/billing";
import { includedAiConfigured } from "@/lib/ai/provider";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { AiTogglesForm } from "./ai-forms";
import { AiSetupCheck } from "./setup-check";
import { isSiteAdmin } from "@/lib/site-admin";
import { EmptyState } from "@/components/ui/empty-state";
import { Sparkles } from "lucide-react";

export const metadata = { title: "AI" };
// AI actions on this page can take up to ~50s; Vercel stops a request at its time limit.
export const maxDuration = 60;

export default async function AiSettingsPage() {
  const { org, role, user } = await getOrgContext();
  const supabase = await createClient();
  const [billing, { data: settings }] = await Promise.all([
    getBillingStatus(org.id),
    supabase.from("organizations").select("ai_classification_enabled, ai_drafts_enabled").eq("id", org.id).single(),
  ]);
  const pro = hasProAccess(billing);
  const canEdit = can(role, "org.update");

  return (
    <>
      <PageHeader title="AI" description="AI writes your campaign emails, sorts replies and drafts answers for you to send." />
      {isSiteAdmin(user.email) && (
        <div className="mb-6">
          <AiSetupCheck />
        </div>
      )}
      {!pro ? (
        <EmptyState
          icon={Sparkles}
          title="AI is part of Pro"
          description="Pro adds AI that writes your sequences, sorts replies, and drafts answers you can send in one click. You can also connect Claude to control YCAReach from chat."
          action={
            <Button asChild>
              <Link href="/billing">See plans</Link>
            </Button>
          }
        />
      ) : (
        <div className="grid gap-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                YCAReach AI <Badge variant={includedAiConfigured() ? "success" : "secondary"}>{includedAiConfigured() ? "Included" : "Not switched on yet"}</Badge>
              </CardTitle>
              <CardDescription>
                {includedAiConfigured()
                  ? "AI is included with your plan. Nothing to set up."
                  : "AI isn't switched on for this site yet. Please check back soon."}
              </CardDescription>
            </CardHeader>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">What AI does</CardTitle>
            </CardHeader>
            <CardContent>
              {settings && <AiTogglesForm classify={settings.ai_classification_enabled} drafts={settings.ai_drafts_enabled} disabled={!canEdit} />}
              <p className="text-muted-foreground mt-3 text-xs">
                Writing emails with AI is on every campaign&apos;s Sequence tab (&quot;Write with AI&quot;).
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Control YCAReach from Claude</CardTitle>
              <CardDescription>
                Connect Claude (Claude Desktop, Claude Code, or any MCP app) and ask it in plain English: &quot;import these leads&quot;, &quot;write a campaign for
                dentists&quot;, &quot;answer my positive replies&quot;. Big actions wait for your approval.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button asChild variant="outline">
                <Link href="/settings/agent">Set up Claude &amp; MCP</Link>
              </Button>
            </CardContent>
          </Card>
        </div>
      )}
    </>
  );
}
