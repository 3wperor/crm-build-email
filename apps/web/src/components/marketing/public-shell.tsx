import Link from "next/link";
import { Button } from "@/components/ui/button";
import { legalEntity } from "@/lib/legal";
import { Logo } from "@/components/brand/logo";

/** Header + footer for public pages (homepage, privacy, terms). */
export function PublicShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="bg-background/80 sticky top-0 z-10 border-b backdrop-blur">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
          <Link href="/">
            <Logo />
          </Link>
          <nav className="flex items-center gap-1 text-sm sm:gap-4">
            <Link href="/#pricing" className="text-muted-foreground hover:text-foreground hidden px-2 sm:inline">
              Pricing
            </Link>
            <Link href="/docs" className="text-muted-foreground hover:text-foreground hidden px-2 sm:inline">
              How it works
            </Link>
            <Link href="/login" className="text-muted-foreground hover:text-foreground px-2">
              Log in
            </Link>
            <Button asChild size="sm">
              <Link href="/signup">Start free trial</Link>
            </Button>
          </nav>
        </div>
      </header>
      <div className="flex-1">{children}</div>
      <footer className="border-t">
        <div className="text-muted-foreground mx-auto flex max-w-6xl flex-col gap-3 px-4 py-8 text-sm sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <div>
            © {new Date().getFullYear()} {legalEntity()}
          </div>
          <nav className="flex flex-wrap gap-4">
            <Link href="/docs" className="hover:text-foreground">
              Docs
            </Link>
            <Link href="/privacy" className="hover:text-foreground">
              Privacy Policy
            </Link>
            <Link href="/terms" className="hover:text-foreground">
              Terms
            </Link>
            <Link href="/login" className="hover:text-foreground">
              Log in
            </Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}
