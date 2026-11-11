import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { ConfirmHost } from "@/components/ui/confirm";
import { Toaster } from "@/components/ui/toast";
import "./globals.css";

// Downloaded at build time and served from our own origin (nothing loads from Google in the browser).
const geistSans = Geist({ subsets: ["latin"], variable: "--font-geist-sans", display: "swap" });
const geistMono = Geist_Mono({ subsets: ["latin"], variable: "--font-geist-mono", display: "swap" });

function appUrl(): URL {
  try {
    return new URL(process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000");
  } catch {
    return new URL("http://localhost:3000");
  }
}

export const metadata: Metadata = {
  metadataBase: appUrl(),
  title: { default: "YCAReach", template: "%s · YCAReach" },
  description:
    "Send personal cold emails from your own inbox, follow up automatically, and keep every reply in one place.",
  applicationName: "YCAReach",
  robots: { index: false, follow: false },
};

// Browser chrome matches the page background, so the brand colour stays for actions.
export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#0a0a0a" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable}`}>
      <body className="min-h-screen font-sans">
        {children}
        <ConfirmHost />
        <Toaster />
      </body>
    </html>
  );
}
