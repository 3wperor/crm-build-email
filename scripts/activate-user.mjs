#!/usr/bin/env node
/**
 * Admin only: mark a user as paid (or unpaid) by email.
 *
 *   pnpm activate-user user@example.com
 *   pnpm activate-user user@example.com --revoke
 *
 * Needs NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY, from the
 * environment or apps/web/.env.local. This runs on your machine only; it is not
 * part of the web app and has no URL. Anyone holding the service-role key can
 * already do anything in the database, so keep that key private.
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

const args = process.argv.slice(2);
const email = args.find((a) => !a.startsWith("--"))?.trim().toLowerCase();
const paid = !args.includes("--revoke");
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!email || !email.includes("@")) {
  console.error("Usage: pnpm activate-user <email> [--revoke]");
  process.exit(1);
}
if (!url || !key) {
  console.error("Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (env or apps/web/.env.local).");
  process.exit(1);
}

const res = await fetch(`${url.replace(/\/+$/, "")}/rest/v1/users?email=eq.${encodeURIComponent(email)}&select=id,email,is_paid`, {
  method: "PATCH",
  headers: {
    apikey: key,
    authorization: `Bearer ${key}`,
    "content-type": "application/json",
    prefer: "return=representation",
  },
  body: JSON.stringify({ is_paid: paid }),
});
if (!res.ok) {
  console.error(`Failed (${res.status}): ${await res.text()}`);
  process.exit(1);
}
const rows = await res.json();
if (rows.length === 0) {
  console.error(`No user with email ${email}. They need to sign up first.`);
  process.exit(1);
}
console.log(`${rows[0].email} is now ${rows[0].is_paid ? "PAID: campaigns can be started" : "UNPAID"}.`);
