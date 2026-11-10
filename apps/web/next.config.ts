import type { NextConfig } from "next";

const dev = process.env.NODE_ENV !== "production";

/** Origins the browser talks to besides our own: Supabase (auth, storage uploads, realtime). */
function supabaseOrigins(): string[] {
  try {
    const url = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "");
    return [url.origin, `${url.protocol === "https:" ? "wss:" : "ws:"}//${url.host}`];
  } catch {
    return [];
  }
}

/**
 * Content Security Policy. Everything is served from our own origin; nothing
 * may frame the app, post forms elsewhere or load plugins. Inline scripts stay
 * allowed because Next.js bootstraps pages with them (no nonce setup here), so
 * this limits where code and data can go rather than replacing output escaping.
 */
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${dev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  `connect-src 'self' ${supabaseOrigins().join(" ")}${dev ? " ws: http://localhost:* http://127.0.0.1:*" : ""}`.trim(),
  "frame-src 'none'",
  "frame-ancestors 'none'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join("; ");

const nextConfig: NextConfig = {
  // Workspace packages ship TypeScript source.
  transpilePackages: ["@crm/core", "@crm/db", "@crm/mail"],
  // Node-only mail libraries: load from node_modules at runtime instead of bundling.
  serverExternalPackages: ["nodemailer", "imapflow", "mailparser"],
  poweredByHeader: false,
  experimental: {
    // Revisiting a page within 30 s renders instantly from the browser's cache
    // (any save/server action still refreshes it). Prefetched pages stay 5 min.
    staleTimes: { dynamic: 30, static: 300 },
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=(), browsing-topics=()" },
          { key: "Content-Security-Policy", value: csp },
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
          { key: "X-DNS-Prefetch-Control", value: "off" },
          // Browsers ignore this over plain http, so local development is unaffected.
          { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
        ],
      },
      {
        // Signed links from emails: never cache, never leak the token in a Referer, keep out of search engines.
        source: "/(u|t)/:path*",
        headers: [
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "X-Robots-Tag", value: "noindex, nofollow" },
        ],
      },
      {
        source: "/api/:path*",
        headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }],
      },
    ];
  },
};

export default nextConfig;
