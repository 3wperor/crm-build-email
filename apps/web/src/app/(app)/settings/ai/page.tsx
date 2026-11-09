import Link from "next/link";
import { can } from "@crm/core";
import { hasProAccess } from "@crm/core/billing";
import { getOrgContext } from "@/lib/org";
import { createClient } from "@/lib/supabase/server";
import { getBillingStatus } from "@/lib/billing";
import { includedAiConfigured, ownAiKeyHint } from "@/lib/ai/provider";
import { PageHeader } from "@/components/coming-soon";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { switchToIncludedAi } from "./actions";
import { AiTogglesForm, OwnKeyForm } from "./ai-forms";

export const metadata = { title: "AI" };

export default async function AiSettingsPage() {
  const { org, role } = await getOrgContext();
  const supabase = await createClient();
  const [billing, { data: settings }] = await Promise.all([
    getBillingStatus(org.id),
    supabase.from("organizations").select("ai_classification_enabled, ai_drafts_enabled, ai_provider, ai_model, ai_base_url").eq("id", org.id).single(),
  ]);
  const pro = hasProAccess(billing);
  const canEdit = can(role, "org.update");
  const ownKey = settings && settings.ai_provider !== "included" ? await ownAiKeyHint(org.id) : null;
  const usingOwn = !!ownKey;

  return (
    <>
      <PageHeader title="AI" description="AI writes your campaign emails, sorts replies and drafts answers for you to send." />
      {!pro ? (
        <Card className="border-dashed">
          <CardHeader>
            <CardTitle className="text-base">AI is part of Pro</CardTitle>
            <CardDescription>
              Pro adds AI that writes your sequences, sorts replies, and drafts answers you can send in one click. You can also connect Claude to control
              YCAReach from chat.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild>
              <Link href="/billing">See plans</Link>
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                Which AI {usingOwn ? <Badge variant="secondary">Your own key</Badge> : <Badge variant="success">Included</Badge>}
              </CardTitle>
              <CardDescription>
                {usingOwn ? (
                  <>
                    Using your {settings?.ai_provider === "anthropic" ? "Claude" : "OpenAI-compatible"} key <code>{ownKey}</code>
                    {settings?.ai_model ? (
                      <>
                        {" "}
                        with <code>{settings.ai_model}</code>
                      </>
                    ) : null}
                    . Usage is billed by your provider.
                  </>
                ) : includedAiConfigured() ? (
                  "YCAReach AI is included with your plan. Nothing to set up."
                ) : (
                  "Included AI isn't switched on yet. You can connect your own key below."
                )}
              </CardDescription>
            </CardHeader>
            {usingOwn && canEdit && (
              <CardContent>
                <form action={switchToIncludedAi}>
                  <Button variant="outline" size="sm">
                    Remove my key and use the included AI
                  </Button>
                </form>
              </CardContent>
            )}
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
              <CardTitle className="text-base">Use a better model with your own key</CardTitle>
              <CardDescription>
                Optional. Paste an API key from Anthropic (Claude) or any OpenAI-compatible provider. We test it, store it encrypted, and use it for all AI in
                this workspace.
              </CardDescription>
            </CardHeader>
            <CardContent>{canEdit ? <OwnKeyForm current={settings?.ai_provider ?? "included"} /> : <p className="text-muted-foreground text-sm">Ask an owner or admin to connect a key.</p>}</CardContent>
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
