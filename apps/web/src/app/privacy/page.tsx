import type { Metadata } from "next";
import Link from "next/link";
import { ContactEmail, Entity, LegalPage, type LegalSection } from "@/components/marketing/legal-page";
import { legalEntityConfigured } from "@/lib/legal";

export const metadata: Metadata = { title: "Privacy Policy", robots: { index: true, follow: true } };

const sections: LegalSection[] = [
  {
    id: "who",
    title: "Who we are",
    body: (
      <>
        <p>
          {legalEntityConfigured() ? (
            <>
              YCAReach is provided by <Entity />, based in the United Kingdom
            </>
          ) : (
            "YCAReach is based in the United Kingdom"
          )}{" "}
          (&ldquo;we&rdquo;, &ldquo;us&rdquo;). For questions about this policy or your data,
          email <ContactEmail />.
        </p>
        <p>We play two roles under UK data protection law (the UK GDPR and the Data Protection Act 2018):</p>
        <ul>
          <li>
            <strong>Controller</strong> for information about our own customers: your account, your workspace and your billing.
          </li>
          <li>
            <strong>Processor</strong> for the information you put into YCAReach about other people, such as your leads, your emails and the replies you
            receive. You (our customer) are the controller of that information and decide how it&apos;s used; we only process it to provide the service to
            you.
          </li>
        </ul>
      </>
    ),
  },
  {
    id: "collect",
    title: "What we collect",
    body: (
      <ul>
        <li>
          <strong>Account details:</strong> your name, email address and password (stored only as a secure hash by our sign-in provider).
        </li>
        <li>
          <strong>Workspace details:</strong> your workspace name, business address (shown in your email footers), settings, and your answers to our
          welcome questions (such as what you sell and your monthly goal).
        </li>
        <li>
          <strong>Billing details:</strong> your plan, billing period and payment status. Card details go directly to Stripe; we never see or store them.
        </li>
        <li>
          <strong>Inbox connection details:</strong> the email address, server settings and app password of each inbox you connect. App passwords and API
          keys are encrypted before they are stored.
        </li>
        <li>
          <strong>Content you add:</strong> leads (such as names, emails, companies and job titles), campaigns and email text, replies we collect from your
          connected inboxes, notes and pipeline stages.
        </li>
        <li>
          <strong>Usage and technical data:</strong> sign-in records, actions taken in your workspace (kept in an audit log), basic server logs (such as IP
          address and browser type) and, if you turn on open or click tracking for a campaign, whether recipients opened or clicked.
        </li>
      </ul>
    ),
  },
  {
    id: "why",
    title: "Why we use it, and our legal basis",
    body: (
      <ul>
        <li>
          <strong>To provide the service you signed up for</strong> (sending your campaigns, syncing replies, AI features, billing): necessary for our
          contract with you.
        </li>
        <li>
          <strong>To keep YCAReach secure and reliable</strong>, prevent abuse and spam, and fix problems: our legitimate interests.
        </li>
        <li>
          <strong>To send you service emails</strong> (sign-in links, trial and payment reminders): necessary for our contract with you.
        </li>
        <li>
          <strong>To keep financial records</strong>: a legal obligation.
        </li>
      </ul>
    ),
  },
  {
    id: "ai",
    title: "AI features",
    body: (
      <>
        <p>
          On Pro plans and during the trial, some features send text to an AI provider: writing campaign emails (your description of what you sell and
          who to), sorting replies, and drafting answers (the reply, your original email and the lead&apos;s first name, company and title). We send only
          what the task needs.
        </p>
        <p>
          The AI included with YCAReach is provided by DeepSeek, which processes data in China. If you connect your own AI key (for example Anthropic or
          OpenAI), that provider is used instead, under your own agreement with them. You can turn AI reply sorting and drafting off in Settings → AI. We
          don&apos;t use your data to train AI models.
        </p>
      </>
    ),
  },
  {
    id: "sharing",
    title: "Who we share it with",
    body: (
      <>
        <p>We don&apos;t sell your data. We use these service providers (&ldquo;sub-processors&rdquo;) to run YCAReach:</p>
        <ul>
          <li>
            <strong>Supabase</strong>: database, file storage and sign-in.
          </li>
          <li>
            <strong>Vercel</strong>: website and application hosting.
          </li>
          <li>
            <strong>Inngest</strong>: scheduling of background jobs (receives technical job data).
          </li>
          <li>
            <strong>Stripe</strong>: payments and subscriptions.
          </li>
          <li>
            <strong>DeepSeek</strong>: included AI features (see above).
          </li>
          <li>
            <strong>Your own email provider</strong> (for example Google): sends your emails and holds the replies we read, using the access you give us.
          </li>
          <li>
            <strong>Services you choose to connect</strong>, such as HubSpot or your own AI provider, receive the data needed for that connection.
          </li>
        </ul>
        <p>We may also share information if the law requires it, or to protect the rights and safety of our users and others.</p>
      </>
    ),
  },
  {
    id: "transfers",
    title: "International transfers",
    body: (
      <p>
        Some providers store or process data outside the UK, including in the United States and, for included AI features, China. Where the UK
        doesn&apos;t consider a country&apos;s protection equivalent, we rely on safeguards such as the UK International Data Transfer Agreement or
        Addendum, and we limit what we send. China is not covered by a UK adequacy decision: if you don&apos;t want data processed there, turn AI off or
        use your own AI key.
      </p>
    ),
  },
  {
    id: "retention",
    title: "How long we keep it",
    body: (
      <ul>
        <li>Your account and workspace data: while your account is open. When it&apos;s closed, we delete it within 90 days.</li>
        <li>Leads, emails and replies: until you delete them or close your workspace.</li>
        <li>Unsubscribes and bounces: kept on your suppression list so those people aren&apos;t emailed again, until you remove them.</li>
        <li>Billing records: 6 years, as UK tax law requires.</li>
        <li>Server logs: up to 30 days.</li>
      </ul>
    ),
  },
  {
    id: "security",
    title: "How we protect it",
    body: (
      <p>
        Data is encrypted in transit. Inbox passwords and API keys are encrypted at rest with a key only our servers hold. Each workspace&apos;s data is
        kept separate by database rules, team members get only the access their role allows, and important actions are recorded in an audit log.
      </p>
    ),
  },
  {
    id: "rights",
    title: "Your rights",
    body: (
      <>
        <p>
          You can ask to access, correct, delete or receive a copy of your personal data, and object to or ask us to restrict how we use it. Email{" "}
          <ContactEmail />. We&apos;ll reply within one month.
        </p>
        <p>
          If you&apos;re unhappy with how we&apos;ve handled your data, you can complain to the Information Commissioner&apos;s Office (ico.org.uk). We&apos;d
          appreciate the chance to put it right first.
        </p>
      </>
    ),
  },
  {
    id: "recipients",
    title: "If you received an email sent with YCAReach",
    body: (
      <p>
        That email was sent by one of our customers, who decides who to contact and is responsible for doing so lawfully. To stop their emails, use the
        unsubscribe link at the bottom of the email: you&apos;ll be added to their do-not-email list straight away. For any other request about your data,
        contact the sender. If you can&apos;t reach them, email <ContactEmail /> and we&apos;ll help.
      </p>
    ),
  },
  {
    id: "cookies",
    title: "Cookies",
    body: (
      <p>
        We only use cookies that are needed to make YCAReach work, such as keeping you signed in and remembering your workspace. We don&apos;t use
        advertising or tracking cookies.
      </p>
    ),
  },
  {
    id: "changes",
    title: "Changes to this policy",
    body: (
      <p>
        We&apos;ll update this page when things change and, for important changes, tell account owners by email. See also our{" "}
        <Link href="/terms" className="underline">
          Terms
        </Link>
        .
      </p>
    ),
  },
];

export default function PrivacyPage() {
  return <LegalPage title="Privacy Policy" intro="How YCAReach collects, uses and protects personal data." sections={sections} />;
}
