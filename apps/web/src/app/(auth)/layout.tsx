import Link from "next/link";
import { Logo } from "@/components/brand/logo";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="bg-muted/40 flex min-h-screen flex-col items-center justify-center gap-6 p-6">
      <Link href="/">
        <Logo size="lg" />
      </Link>
      <div className="w-full max-w-sm">{children}</div>
    </main>
  );
}
