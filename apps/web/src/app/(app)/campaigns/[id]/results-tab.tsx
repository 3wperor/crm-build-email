import { AB_MIN_SENDS_PER_VARIANT, formatPct, rate, wilsonInterval } from "@crm/core/analytics";
import { createClient } from "@/lib/supabase/server";
import { loadVariantResults, type StepResults } from "@/lib/analytics";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { setVariantWinner } from "../actions";

type Step = { id: string; step_order: number; variants: { id: string; ab_group: string; is_active: boolean; is_winner: boolean; weight: number }[] };

export async function ResultsTab(props: {
  orgId: string;
  campaignId: string;
  steps: Step[];
  canEdit: boolean;
  tracking: { opens: boolean; clicks: boolean };
  autoPromote: boolean;
}) {
  const supabase = await createClient();
  const results = await loadVariantResults(supabase, props.orgId, props.campaignId, props.steps);
  if (results.length === 0) return <p className="text-muted-foreground text-sm">Add a step to see results.</p>;
  const showOpens = props.tracking.opens || results.some((s) => s.variants.some((v) => v.metrics.opened > 0));
  const showClicks = props.tracking.clicks || results.some((s) => s.variants.some((v) => v.metrics.clicked > 0));

  return (
    <div className="grid gap-4">
      <p className="text-muted-foreground text-sm">
        Variants are compared on <strong>reply rate</strong> (opens are unreliable). A winner needs {AB_MIN_SENDS_PER_VARIANT}+ sends per variant and a
        significant difference (two-proportion z-test, p &lt; 0.05, corrected for the number of variants). Ranges are 95% confidence intervals.
        {props.autoPromote ? " Auto-promote is on: winners are promoted automatically every 30 minutes." : ""}
      </p>
      {results.map((step) => (
        <StepCard key={step.stepId} step={step} {...props} showOpens={showOpens} showClicks={showClicks} />
      ))}
    </div>
  );
}

function StepCard({ step, campaignId, canEdit, showOpens, showClicks }: { step: StepResults; campaignId: string; canEdit: boolean; showOpens: boolean; showClicks: boolean }) {
  const v = step.verdict;
  const winner = step.variants.find((x) => x.id === step.winnerId);
  return (
    <Card data-testid={`results-step-${step.stepOrder}`}>
      <CardHeader>
        <CardTitle className="text-base">Step {step.stepOrder}</CardTitle>
        <CardDescription data-testid="ab-verdict">
          {winner ? (
            <>
              <Badge variant="success">Winner: {winner.ab_group}</Badge> <span className="ml-1">receives every new send for this step.</span>
            </>
          ) : v.status === "winner" ? (
            <>
              <Badge variant="warning">Significant</Badge> <span className="ml-1">{v.message} Promote it to send it to everyone.</span>
            </>
          ) : (
            v.message
          )}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Variant</TableHead>
              <TableHead className="text-right">Sent</TableHead>
              <TableHead className="text-right">Reply rate</TableHead>
              <TableHead className="text-right">Positive</TableHead>
              {showOpens && <TableHead className="text-right">Opened</TableHead>}
              {showClicks && <TableHead className="text-right">Clicked</TableHead>}
              <TableHead className="text-right">Bounced</TableHead>
              <TableHead className="text-right">Unsubscribed</TableHead>
              {canEdit && <TableHead className="sr-only">Actions</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {step.variants.map((variant) => {
              const m = variant.metrics;
              const ci = wilsonInterval(m.replied, m.sent);
              const isWinner = variant.id === step.winnerId;
              const suggested = v.status === "winner" && v.winnerId === variant.id && !step.winnerId;
              return (
                <TableRow key={variant.id} data-testid={`variant-row-${variant.ab_group}`}>
                  <TableCell className="font-medium">
                    {variant.ab_group}
                    {!variant.is_active && (
                      <Badge variant="outline" className="ml-2">
                        inactive
                      </Badge>
                    )}
                    {isWinner && (
                      <Badge variant="success" className="ml-2">
                        winner
                      </Badge>
                    )}
                    {suggested && (
                      <Badge variant="warning" className="ml-2">
                        leading
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{m.sent}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {m.replied} · {formatPct(rate(m.replied, m.sent))}
                    {ci && (
                      <div className="text-muted-foreground text-xs">
                        {formatPct(ci.low)}–{formatPct(ci.high)}
                      </div>
                    )}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{m.positive}</TableCell>
                  {showOpens && <TableCell className="text-right tabular-nums">{formatPct(rate(m.opened, m.sent))}</TableCell>}
                  {showClicks && <TableCell className="text-right tabular-nums">{formatPct(rate(m.clicked, m.sent))}</TableCell>}
                  <TableCell className="text-right tabular-nums">{formatPct(rate(m.bounced, m.sent))}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatPct(rate(m.unsubscribed, m.sent))}</TableCell>
                  {canEdit && (
                    <TableCell className="text-right">
                      {isWinner ? (
                        <WinnerForm campaignId={campaignId} stepId={step.stepId} variantId="" label="Clear winner" reason="manual clear" />
                      ) : variant.is_active && variant.weight > 0 && step.variants.length > 1 ? (
                        <WinnerForm
                          campaignId={campaignId}
                          stepId={step.stepId}
                          variantId={variant.id}
                          label={`Promote ${variant.ab_group}`}
                          reason={suggested ? v.message : "manual"}
                          primary={suggested}
                        />
                      ) : null}
                    </TableCell>
                  )}
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

function WinnerForm(props: { campaignId: string; stepId: string; variantId: string; label: string; reason: string; primary?: boolean }) {
  return (
    <form action={setVariantWinner}>
      <input type="hidden" name="campaign_id" value={props.campaignId} />
      <input type="hidden" name="step_id" value={props.stepId} />
      <input type="hidden" name="variant_id" value={props.variantId} />
      <input type="hidden" name="reason" value={props.reason} />
      <Button size="sm" variant={props.primary ? "default" : "outline"}>
        {props.label}
      </Button>
    </form>
  );
}
