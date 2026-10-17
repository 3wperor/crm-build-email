import Link from "next/link";

export const metadata = { title: "Docs", description: "How to use YCAReach: inboxes, leads, campaigns, replies, analytics and more." };

type Section = { id: string; title: string; body: React.ReactNode };

const Code = ({ children }: { children: React.ReactNode }) => <code className="bg-muted rounded px-1 py-0.5 font-mono text-[0.85em]">{children}</code>;

const SECTIONS: Section[] = [
  {
    id: "getting-started",
    title: "Getting started",
    body: (
      <>
        <p>YCAReach sends personal-looking cold emails from your own inboxes, follows up automatically, and stops the moment someone replies. The basic flow:</p>
        <ol>
          <li>
            <strong>Connect an inbox</strong> (Inboxes → Add inbox) and fill in your mailing address under Settings (it&apos;s required in every email).
          </li>
          <li>
            <strong>Add leads</strong>: upload a CSV or Excel file, or paste them in.
          </li>
          <li>
            <strong>Create a campaign</strong>: write the first email and a follow-up or two.
          </li>
          <li>
            <strong>Send yourself a test email</strong> to check how it looks.
          </li>
          <li>
            <strong>Add leads to the campaign and press Start.</strong> Replies show up under Replies and in the Pipeline.
          </li>
        </ol>
      </>
    ),
  },
  {
    id: "inboxes",
    title: "Connecting an inbox",
    body: (
      <>
        <p>YCAReach sends and reads mail through your inbox with an <em>app password</em>. Your normal password is never used, and the app password is stored encrypted.</p>
        <h4>Gmail / Google Workspace</h4>
        <ol>
          <li>Turn on 2-Step Verification for the Google account.</li>
          <li>
            Open <Code>myaccount.google.com/apppasswords</Code>, create an app password named &ldquo;YCAReach&rdquo; and copy the 16 characters.
          </li>
          <li>In Gmail settings → Forwarding and POP/IMAP, make sure IMAP is enabled.</li>
          <li>In YCAReach: Inboxes → Add inbox → Google, paste the app password, then <strong>Test connection</strong> and save.</li>
        </ol>
        <h4>Other providers</h4>
        <p>Choose &ldquo;Other SMTP&rdquo; and enter the SMTP and IMAP host/port from your provider (usually SMTP 465 or 587, IMAP 993).</p>
        <h4>Daily cap</h4>
        <p>
          Each inbox has a daily cap (default 30) that covers everything it sends, including warmup. New inboxes should start low (20–30) and grow
          slowly. Emails from one inbox are spaced 3–7 minutes apart.
        </p>
      </>
    ),
  },
  {
    id: "domain",
    title: "Domain setup (SPF, DKIM, DMARC)",
    body: (
      <>
        <p>Before sending real volume, make sure the domain you send from is set up, or your mail will land in spam:</p>
        <ul>
          <li>
            <strong>SPF</strong> says which servers may send for your domain (Google Workspace: include <Code>_spf.google.com</Code>).
          </li>
          <li>
            <strong>DKIM</strong> signs each email (Google Admin → Apps → Gmail → Authenticate email).
          </li>
          <li>
            <strong>DMARC</strong> tells receivers what to do with mail that fails the checks (start with <Code>p=none</Code>).
          </li>
        </ul>
        <p>Tip: use a separate domain for cold email (e.g. <Code>getacme.com</Code> instead of <Code>acme.com</Code>) so your main domain&apos;s reputation stays safe.</p>
      </>
    ),
  },
  {
    id: "leads",
    title: "Adding leads",
    body: (
      <>
        <h4>Upload a spreadsheet</h4>
        <p>
          Leads → <strong>Import CSV or Excel</strong>, or the <strong>Upload CSV or Excel</strong> button in a campaign&apos;s Leads tab. Both <Code>.csv</Code> and
          Excel <Code>.xlsx</Code> work. From <strong>Google Sheets</strong>: File → Download → Microsoft Excel (.xlsx) or CSV, then upload that file. The first row must be
          column names; YCAReach guesses which column is the email, first name, company and so on, and you can change it before importing. Extra columns
          (e.g. &ldquo;LinkedIn URL&rdquo;) can be kept as custom fields.
        </p>
        <h4>Type or paste</h4>
        <p>
          Leads → <strong>Add leads by hand</strong>, or the box in a campaign&apos;s Leads tab. One lead per line: <Code>email, first name, last name, company, title</Code>.
          Only the email is required. You can also copy rows straight out of Excel or Google Sheets and paste them in.
        </p>
        <h4>What gets skipped</h4>
        <p>
          Duplicates (in the file and against leads you already have) and anything on your suppression list are skipped automatically. Every import has a
          summary page, and you can download the rows that didn&apos;t make it.
        </p>
      </>
    ),
  },
  {
    id: "verification",
    title: "Email verification",
    body: (
      <>
        <p>New leads are checked automatically (syntax, the domain&apos;s mail servers, disposable and role addresses like info@). Each lead gets a status:</p>
        <ul>
          <li>
            <strong>Valid</strong>: the domain accepts mail. Safe to send.
          </li>
          <li>
            <strong>Risky</strong>: a role address (info@, sales@) or a domain without mail servers. Skipped unless you allow risky leads in the campaign settings.
          </li>
          <li>
            <strong>Invalid</strong>: never emailed.
          </li>
          <li>
            <strong>Unknown</strong>: the check couldn&apos;t finish (e.g. DNS timeout). These are sent to.
          </li>
        </ul>
        <p>Verification usually takes under a minute. Leads that are still being checked can&apos;t be added to a campaign yet.</p>
      </>
    ),
  },
  {
    id: "campaigns",
    title: "Campaigns and sequences",
    body: (
      <>
        <p>
          A campaign is a <strong>sequence</strong>: step 1 is the first email, and later steps are follow-ups sent a set number of days later. A follow-up
          with an empty subject is sent as a reply in the same thread (&ldquo;Re: …&rdquo;), which usually gets more replies.
        </p>
        <h4>Personalisation (merge tags)</h4>
        <p>
          Write <Code>{"{{first_name}}"}</Code> and it&apos;s replaced with each lead&apos;s first name. Add a fallback for leads without one:{" "}
          <Code>{"{{first_name|there}}"}</Code> becomes &ldquo;there&rdquo;. Available tags: <Code>first_name</Code>, <Code>last_name</Code>, <Code>full_name</Code>,{" "}
          <Code>company</Code>, <Code>title</Code>, <Code>email</Code>, <Code>sender_name</Code>, <Code>sender_first_name</Code>, <Code>sender_email</Code>, plus any
          custom field from your import (e.g. <Code>{"{{linkedin_url}}"}</Code>).
        </p>
        <h4>Settings</h4>
        <ul>
          <li>
            <strong>Send window</strong>: the hours and days emails may go out, in the campaign&apos;s timezone.
          </li>
          <li>
            <strong>Daily limit</strong>: the maximum per day for the campaign, and per inbox for this campaign. Each inbox&apos;s own daily cap still applies.
          </li>
          <li>
            <strong>Inboxes</strong>: new conversations rotate across the selected inboxes; follow-ups always come from the inbox that sent step 1.
          </li>
        </ul>
        <h4>Adding leads to a campaign</h4>
        <p>
          In the campaign&apos;s <strong>Leads</strong> tab: upload a file, paste leads, or add leads you already have (a list or all of them). Leads are skipped
          if they&apos;re invalid, suppressed, have already replied, or are already in another running campaign. YCAReach tells you how many were skipped and
          why.
        </p>
        <h4>Test, start, pause</h4>
        <p>
          Use <strong>Send test</strong> on any email to see it exactly as a lead would (subject marked [TEST]). <strong>Start</strong> checks that everything is
          ready (copy, an inbox, leads, your mailing address). <strong>Pause campaign</strong> stops it; resuming continues where it left off.
        </p>
      </>
    ),
  },
  {
    id: "safety",
    title: "Sending rules and safety",
    body: (
      <ul>
        <li>
          <strong>Stop on reply</strong>: when a lead replies, every follow-up to them stops.
        </li>
        <li>
          <strong>Unsubscribe</strong>: every email has an unsubscribe link (and one-click unsubscribe for Gmail/Yahoo). Unsubscribed addresses are never
          emailed again.
        </li>
        <li>
          <strong>Bounces</strong>: hard bounces are suppressed automatically.
        </li>
        <li>
          <strong>Pause all sending</strong> (top right) is the kill switch: it stops everything in the workspace at once, including test emails and warmup.
          Only owners and admins can resume.
        </li>
        <li>Emails only go out inside each campaign&apos;s send window, within daily caps, spaced 3–7 minutes apart per inbox.</li>
      </ul>
    ),
  },
  {
    id: "replies",
    title: "Replies and the pipeline",
    body: (
      <>
        <p>
          YCAReach checks your inboxes (including the spam folder) every few minutes, matches replies to the email they answer, and sorts them:{" "}
          <strong>positive</strong>, <strong>neutral</strong>, <strong>negative</strong>, <strong>out of office</strong> or <strong>unsubscribe</strong>. You can change
          the label on any reply.
        </p>
        <ul>
          <li>Positive and neutral replies land in the first column of the <strong>Pipeline</strong>; negative ones go to Closed Lost.</li>
          <li>Out-of-office replies don&apos;t stop the sequence: the next email waits until they&apos;re back.</li>
          <li>Unsubscribe replies are added to the suppression list.</li>
        </ul>
        <p>
          Drag cards between stages (or use the keyboard, or the &ldquo;Move to&rdquo; menu). Click a lead to see the whole conversation, add notes and edit
          their details. Owners and admins can rename and reorder stages.
        </p>
      </>
    ),
  },
  {
    id: "analytics",
    title: "Analytics and A/B tests",
    body: (
      <>
        <p>
          <strong>Analytics</strong> shows sends, replies, bounces and unsubscribes over 7, 30 or 90 days, by campaign, inbox and email variant. Keep the
          bounce rate under 3%.
        </p>
        <p>
          <strong>A/B tests</strong>: add variants B, C… to any step and new leads are split between them. A campaign&apos;s <strong>Results</strong> tab compares
          reply rates and marks a winner once the difference is statistically meaningful (after at least 100 sends per variant). Promote the winner to send
          it to everyone, or turn on auto-promote in the campaign settings.
        </p>
        <p>
          Open and click tracking is off by default because it can hurt deliverability. Turn it on per campaign if you want it, but judge results by replies.
        </p>
      </>
    ),
  },
  {
    id: "warmup",
    title: "Warmup (beta)",
    body: (
      <p>
        Warmup builds a new inbox&apos;s reputation: your own inboxes send each other a few ordinary emails a day, open them, move them out of spam and reply to
        some, slowly ramping up to a daily target. You need at least two inboxes. Warmup counts toward each inbox&apos;s daily cap and pauses itself if too
        much lands in spam. Warmup emails never show up in Replies or Analytics.
      </p>
    ),
  },
  {
    id: "suppression",
    title: "Suppression list",
    body: (
      <p>
        Addresses on the suppression list are never emailed, by any campaign. Unsubscribes and hard bounces are added automatically. To add your own (current
        customers, competitors, a do-not-contact list), go to <strong>Suppression</strong> and upload a CSV or Excel file (the email column is found
        automatically) or paste addresses.
      </p>
    ),
  },
  {
    id: "team",
    title: "Team and roles",
    body: (
      <ul>
        <li>
          <strong>Owner</strong>: everything, including members.
        </li>
        <li>
          <strong>Admin</strong>: everything except managing members: inboxes, settings, pipeline stages, integrations, API keys, resuming sending.
        </li>
        <li>
          <strong>Sender</strong>: leads, campaigns, replies and the pipeline; can pause (not resume) sending.
        </li>
        <li>
          <strong>Viewer</strong>: read-only.
        </li>
      </ul>
    ),
  },
  {
    id: "integrations",
    title: "HubSpot and the AI agent",
    body: (
      <>
        <p>
          <strong>HubSpot</strong> (Settings → Integrations): paste a private app token and every lead in your pipeline is created in HubSpot as a contact with a
          deal in the matching stage. It syncs every 15 minutes.
        </p>
        <p>
          <strong>AI agent</strong> (Settings → AI agent): create an API key to let Claude or another AI assistant work in YCAReach through the MCP server. By
          default, anything that would send email waits for your approval on that page. Every action the agent takes is in the audit log.
        </p>
      </>
    ),
  },
  {
    id: "faq",
    title: "Troubleshooting",
    body: (
      <dl className="grid gap-3">
        <div>
          <dt className="font-medium">&ldquo;Added 0 leads&rdquo; when adding leads to a campaign</dt>
          <dd>
            The message says why each lead was skipped. Most often the list is empty, the leads are still being verified (wait a minute), or they&apos;re
            already in another running campaign.
          </dd>
        </div>
        <div>
          <dt className="font-medium">The campaign is running but nothing sends</dt>
          <dd>
            Check the &ldquo;Next send&rdquo; box on the campaign: outside the send window, daily limit reached, or sending paused (red banner at the top).
            Also check the inbox&apos;s health on the Inboxes page.
          </dd>
        </div>
        <div>
          <dt className="font-medium">Gmail says the password is wrong</dt>
          <dd>Use an app password (not your normal password), make sure 2-Step Verification and IMAP are on, and paste it without spaces.</dd>
        </div>
        <div>
          <dt className="font-medium">My Excel file won&apos;t upload</dt>
          <dd>Save it as .xlsx (old .xls files aren&apos;t supported) or as CSV. The first row must be the column names.</dd>
        </div>
      </dl>
    ),
  },
];

export default function DocsPage() {
  return (
    <div className="bg-background min-h-screen">
      <header className="bg-background/80 sticky top-0 z-10 border-b backdrop-blur">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-6">
          <Link href="/docs" className="text-base font-bold tracking-tight">
            YCA<span className="text-primary/60">Reach</span> <span className="text-muted-foreground font-normal">Docs</span>
          </Link>
          <Link href="/dashboard" className="text-sm underline underline-offset-4">
            Open the app →
          </Link>
        </div>
      </header>
      <div className="mx-auto grid max-w-6xl gap-10 px-6 py-10 md:grid-cols-[200px_minmax(0,1fr)]">
        <nav aria-label="On this page" className="hidden md:block">
          <ul className="sticky top-24 grid gap-1 text-sm">
            {SECTIONS.map((s) => (
              <li key={s.id}>
                <a href={`#${s.id}`} className="text-muted-foreground hover:text-foreground">
                  {s.title}
                </a>
              </li>
            ))}
          </ul>
        </nav>
        <main className="grid max-w-3xl gap-12">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight">How to use YCAReach</h1>
            <p className="text-muted-foreground mt-2">Everything you need to go from a spreadsheet of leads to booked meetings.</p>
          </div>
          {SECTIONS.map((s) => (
            <section
              key={s.id}
              id={s.id}
              className="scroll-mt-20 text-sm leading-6 [&_dd]:text-muted-foreground [&_h4]:mt-4 [&_h4]:mb-1 [&_h4]:font-semibold [&_li]:mt-1 [&_ol]:ml-5 [&_ol]:list-decimal [&_p]:mt-2 [&_ul]:ml-5 [&_ul]:list-disc"
            >
              <h2 className="text-xl font-semibold tracking-tight">{s.title}</h2>
              {s.body}
            </section>
          ))}
        </main>
      </div>
    </div>
  );
}
