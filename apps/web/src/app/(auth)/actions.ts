"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { publicEnv } from "@/lib/env";
import { safeNextPath } from "@/lib/safe-redirect";

export type AuthState = { error?: string; message?: string } | undefined;

function str(formData: FormData, key: string): string {
  const v = formData.get(key);
  return typeof v === "string" ? v.trim() : "";
}

export async function signInWithPassword(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const email = str(formData, "email");
  const password = formData.get("password");
  if (!email || typeof password !== "string" || !password) return { error: "Email and password are required." };

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return { error: error.message };

  redirect(safeNextPath(formData.get("next")));
}

export async function signInWithMagicLink(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const email = str(formData, "email");
  if (!email) return { error: "Email is required." };

  const next = safeNextPath(formData.get("next"));
  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: {
      shouldCreateUser: false,
      emailRedirectTo: `${publicEnv.appUrl}/auth/callback?next=${encodeURIComponent(next)}`,
    },
  });
  // Same answer whether or not the address has an account, so this form can't be
  // used to find out who is a customer. Rate limits are still reported.
  if (error && (error.status === 429 || /rate limit|security purposes/i.test(error.message))) {
    return { error: "Too many attempts. Please wait a minute and try again." };
  }
  if (error) console.warn(`magic link not sent: ${error.message}`);
  return { message: "If that email has an account, a sign-in link is on its way." };
}

export async function signUp(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const email = str(formData, "email");
  const fullName = str(formData, "full_name");
  const password = formData.get("password");
  if (!email || typeof password !== "string") return { error: "Email and password are required." };
  if (email.length > 320 || fullName.length > 200) return { error: "That name or email is too long." };
  if (password.length < 10) return { error: "Password must be at least 10 characters." };
  // bcrypt only reads the first 72 bytes; refuse longer input instead of silently truncating it.
  if (Buffer.byteLength(password) > 72) return { error: "Password must be at most 72 characters." };

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: { full_name: fullName || null },
      emailRedirectTo: `${publicEnv.appUrl}/auth/callback?next=/onboarding`,
    },
  });
  if (error) return { error: error.message };

  // Email confirmation disabled (local dev): we already have a session.
  if (data.session) redirect("/onboarding");
  return { message: "Check your email to confirm your account." };
}
