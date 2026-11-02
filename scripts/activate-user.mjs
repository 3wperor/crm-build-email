#!/usr/bin/env node
/**
 * Admin only: set the plan of every workspace a user OWNS, by their email.
 * Stripe normally does this automatically; use it for your own account,
 * friends, refunds or fixing a stuck payment.
 *
 *   pnpm activate-user user@example.com            # pro
 *   pnpm activate-user user@example.com standard
 *   pnpm activate-user user@example.com trial      # fresh 7-day trial
 *   pnpm activate-user user@example.com expired    # stop sending
 *
 * Needs NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (environment or
 * apps/web/.env.local). Runs on your machine only; it has no URL. A workspace
 * with a Stripe subscription gets overwritten by Stripe's next update.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const envFile = join(dirname(fileURLToPath(import.meta.url)), "..", "apps", "web", ".env.local");
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, "$2");
  }
}

const PLANS = ["pro", "standard", "trial", "expired"];
const args = process.argv.slice(2);
const email = args.find((a) => a.includes("@"))?.trim().toLowerCase();
const plan = (args.find((a) => PLANS.includes(a)) ?? (args.includes("--revoke") ? "expired" : "pro"));
const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/+$/, "");
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!email) {
  console.error("Usage: pnpm activate-user <email> [pro|standard|trial|expired]");
  process.exit(1);
}
if (!url || !key) {
  console.error("Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (env or apps/web/.env.local).");
  process.exit(1);
}

async function rest(method, path, body) {
  const res = await fetch(`${url}/rest/v1/${path}`, {
    method,
    headers: { apikey: key, authorization: `Bearer ${key}`, "content-type": "application/json", prefer: "return=representation" },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!res.ok) {
    console.error(`Failed (${res.status}): ${await res.text()}`);
    process.exit(1);
  }
  return res.json();
}

const users = await rest("GET", `users?email=eq.${encodeURIComponent(email)}&select=id`);
if (users.length === 0) {
  console.error(`No user with email ${email}. They need to sign up first.`);
  process.exit(1);
}
const owned = await rest("GET", `memberships?user_id=eq.${users[0].id}&role=eq.owner&select=org_id`);
if (owned.length === 0) {
  console.error(`${email} doesn't own a workspace.`);
  process.exit(1);
}
const patch = plan === "trial" ? { plan, trial_ends_at: new Date(Date.now() + 7 * 864e5).toISOString() } : { plan };
const ids = owned.map((m) => m.org_id).join(",");
const orgs = await rest("PATCH", `organizations?id=in.(${ids})&select=name,plan`, patch);
for (const o of orgs) console.log(`${o.name}: now ${o.plan.toUpperCase()}`);
