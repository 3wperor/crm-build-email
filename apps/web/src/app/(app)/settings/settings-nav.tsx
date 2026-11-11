"use client";

import { usePathname } from "next/navigation";
import { LinkTabs } from "@/components/ui/link-tabs";

const TABS = [
  { href: "/settings", label: "Workspace" },
  { href: "/settings/ai", label: "AI" },
  { href: "/settings/agent", label: "Claude & MCP" },
  { href: "/settings/integrations", label: "Integrations" },
  { href: "/settings/audit-log", label: "Audit log" },
];

export function SettingsNav() {
  const pathname = usePathname();
  return <LinkTabs label="Settings sections" items={TABS.map((t) => ({ ...t, active: pathname === t.href }))} />;
}
