import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Outreach CRM", template: "%s · Outreach CRM" },
  description: "Cold email outreach CRM",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen font-sans">{children}</body>
    </html>
  );
}
