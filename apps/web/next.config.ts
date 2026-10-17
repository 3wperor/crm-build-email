import type { NextConfig } from "next";

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
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
    ];
  },
};

export default nextConfig;
