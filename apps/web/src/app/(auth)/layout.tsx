import Link from "next/link";
import { CalendarDays, CreditCard, Mail } from "lucide-react";
import { Logo } from "@/components/brand/logo";
import { TRIAL } from "@/lib/plans";

/** Sign in / sign up: the form on one side, what you get on the other (hidden on small screens). */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      <main className="flex flex-col p-6 sm:p-10">
        <Link href="/" className="w-fit">
          <Logo />
        </Link>
        <div className="flex flex-1 items-center justify-center py-10">
          <div className="w-full max-w-sm">{children}</div>
        </div>
      </main>
      <aside className="bg-sidebar hidden border-l p-10 lg:flex lg:flex-col lg:justify-center">
        <div className="mx-auto max-w-md">
          <p className="text-primary text-small font-medium">Cold email for small businesses</p>
          <h2 className="mt-3 text-3xl leading-tight font-semibold tracking-tight text-balance">Win new customers with emails that sound like you.</h2>
          <p className="text-muted-foreground mt-4 text-base">
            YCAReach sends personal emails from your own inbox, follows up for you, and stops the moment someone replies.
          </p>
          <ul className="mt-8 grid gap-4 text-sm">
            <li className="flex items-center gap-3">
              <span className="bg-accent text-primary flex size-9 shrink-0 items-center justify-center rounded-full">
                <CalendarDays className="size-4" />
              </span>
              <span>
                <span className="font-medium">Free for {TRIAL.days} days</span>, with every feature
              </span>
            </li>
            <li className="flex items-center gap-3">
              <span className="bg-accent text-primary flex size-9 shrink-0 items-center justify-center rounded-full">
                <Mail className="size-4" />
              </span>
              <span>
                <span className="font-medium">{TRIAL.emails} emails included</span> to try it properly
              </span>
            </li>
            <li className="flex items-center gap-3">
              <span className="bg-accent text-primary flex size-9 shrink-0 items-center justify-center rounded-full">
                <CreditCard className="size-4" />
              </span>
              <span>
                <span className="font-medium">No card needed</span> to start
              </span>
            </li>
          </ul>
        </div>
      </aside>
    </div>
  );
}
