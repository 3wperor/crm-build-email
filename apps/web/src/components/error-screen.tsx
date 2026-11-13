import { Logo } from "@/components/brand/logo";

/** A calm, branded "something's wrong" screen: one line of explanation and a way back. */
export function ErrorScreen({
  code,
  title,
  description,
  children,
  fullPage = true,
}: {
  code?: string;
  title: string;
  description: string;
  /** Buttons / links back to safety. */
  children: React.ReactNode;
  fullPage?: boolean;
}) {
  return (
    <div className={fullPage ? "flex min-h-screen flex-col items-center justify-center p-6" : "flex flex-col items-center py-16"}>
      {fullPage && <Logo size="lg" className="mb-10" />}
      <div className="max-w-md text-center">
        {code && <p className="text-primary text-small font-medium tabular-nums">{code}</p>}
        <h1 className="text-page-title mt-2">{title}</h1>
        <p className="text-muted-foreground mt-2 text-sm text-balance">{description}</p>
        <div className="mt-6 flex flex-wrap items-center justify-center gap-2">{children}</div>
      </div>
    </div>
  );
}
