import { PublicShell } from "./public-shell";
import { LEGAL_LAST_UPDATED, legalContact, legalEntity } from "@/lib/legal";

export type LegalSection = { id: string; title: string; body: React.ReactNode };

export function ContactEmail() {
  const email = legalContact();
  return email ? (
    <a className="underline" href={`mailto:${email}`}>
      {email}
    </a>
  ) : (
    <span>the email address we send your account emails from</span>
  );
}

export function Entity() {
  return <>{legalEntity()}</>;
}

/** Long-form legal page with a contents list. */
export function LegalPage({ title, intro, sections }: { title: string; intro: React.ReactNode; sections: LegalSection[] }) {
  return (
    <PublicShell>
      <main className="mx-auto grid max-w-3xl gap-8 px-4 py-12 sm:px-6">
        <header className="grid gap-2">
          <h1 className="text-3xl font-bold tracking-tight">{title}</h1>
          <p className="text-muted-foreground text-sm">Last updated: {LEGAL_LAST_UPDATED}</p>
          <div className="text-muted-foreground">{intro}</div>
        </header>
        <nav aria-label="Contents" className="bg-muted/40 rounded-md border p-4 text-sm">
          <ol className="grid list-decimal gap-1 pl-5">
            {sections.map((s) => (
              <li key={s.id}>
                <a href={`#${s.id}`} className="hover:underline">
                  {s.title}
                </a>
              </li>
            ))}
          </ol>
        </nav>
        {sections.map((s, i) => (
          <section key={s.id} id={s.id} className="grid scroll-mt-20 gap-3 text-sm leading-6 [&_li]:ml-5 [&_li]:list-disc [&_ul]:grid [&_ul]:gap-1">
            <h2 className="text-lg font-semibold">
              {i + 1}. {s.title}
            </h2>
            {s.body}
          </section>
        ))}
      </main>
    </PublicShell>
  );
}
