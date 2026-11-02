import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";

/** Opens the payment link in a new tab. Renders nothing when no link is configured. */
export function UpgradeButton({ href, size = "sm" }: { href: string | null; size?: "sm" | "default" }) {
  if (!href) return null;
  return (
    <Button asChild size={size}>
      <a href={href} target="_blank" rel="noopener noreferrer">
        <Sparkles /> Upgrade
      </a>
    </Button>
  );
}
