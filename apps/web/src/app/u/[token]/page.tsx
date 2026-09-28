import { resolveUnsubscribe, unsubscribe } from "@/lib/unsubscribe";

export const metadata = { title: "Unsubscribe", robots: { index: false } };

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="bg-muted/40 flex min-h-screen items-center justify-center p-6">
      <div className="bg-card w-full max-w-md rounded-xl border p-8 text-center shadow-sm">{children}</div>
    </main>
  );
}

export default async function UnsubscribePage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ done?: string }>;
}) {
  const [{ token }, { done }] = await Promise.all([params, searchParams]);
  const target = await resolveUnsubscribe(token);

  if (!target) {
    return (
      <Shell>
        <h1 className="text-lg font-semibold">Link not valid</h1>
        <p className="text-muted-foreground mt-2 text-sm">This unsubscribe link is invalid or has expired. Reply to the email and ask to be removed.</p>
      </Shell>
    );
  }

  async function confirm() {
    "use server";
    const t = await resolveUnsubscribe(token);
    if (t) await unsubscribe(t, "link");
    const { redirect } = await import("next/navigation");
    redirect(`/u/${token}?done=1`);
  }

  if (done) {
    return (
      <Shell>
        <h1 className="text-lg font-semibold">You&apos;re unsubscribed</h1>
        <p className="text-muted-foreground mt-2 text-sm">
          {target.email} won&apos;t receive any more emails from {target.orgName}.
        </p>
      </Shell>
    );
  }

  // A button (not an automatic GET) so link scanners can't unsubscribe people by accident.
  return (
    <Shell>
      <h1 className="text-lg font-semibold">Unsubscribe</h1>
      <p className="text-muted-foreground mt-2 text-sm">
        Stop all emails from {target.orgName} to <strong>{target.email}</strong>?
      </p>
      <form action={confirm} className="mt-6">
        <button className="bg-primary text-primary-foreground rounded-md px-4 py-2 text-sm font-medium">Unsubscribe</button>
      </form>
    </Shell>
  );
}
