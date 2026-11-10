import type { Metadata } from "next";
import Link from "next/link";
import { ContactEmail, Entity, LegalPage, type LegalSection } from "@/components/marketing/legal-page";
import { PRICES, TRIAL } from "@/lib/plans";

export const metadata: Metadata = { title: "Terms of Service", robots: { index: true, follow: true } };

const sections: LegalSection[] = [
  {
    id: "about",
    title: "About these terms",
    body: (
      <>
        <p>
          These terms are an agreement between you and <Entity /> (&ldquo;we&rdquo;, &ldquo;us&rdquo;) for the use of YCAReach. By creating an account
          you accept them. If you accept them for a business, you confirm you&apos;re allowed to bind that business.
        </p>
        <p>
          YCAReach is for business use. You must be at least 18. You can use it from anywhere in the world, as long as you follow the laws that apply to
          you and the people you email.
        </p>
      </>
    ),
  },
  {
    id: "account",
    title: "Your account",
    body: (
      <p>
        Keep your login details safe and tell us straight away at <ContactEmail /> if you think someone else has access. You&apos;re responsible for
        what happens in your workspace, including what your team members do.
      </p>
    ),
  },
  {
    id: "trial-plans",
    title: "Free trial, plans and payment",
    body: (
      <ul>
        <li>
          New workspaces get a free {TRIAL.days}-day trial with up to {TRIAL.emails} campaign emails. No card is needed. When it ends, sending pauses
          until you choose a plan; your data is kept.
        </li>
        <li>
          Plans are per workspace: Standard (£{PRICES.standard.month}/month or £{PRICES.standard.year}/year) and Pro (£{PRICES.pro.month}/month or £
          {PRICES.pro.year}/year). Prices are shown before you pay and may include VAT where it applies.
        </li>
        <li>Payments are taken by Stripe. Subscriptions renew automatically at the end of each month or year until you cancel.</li>
        <li>You can cancel any time in Billing. Your plan stays active until the end of the period you&apos;ve paid for, then sending pauses.</li>
        <li>
          Fees already paid aren&apos;t refunded, except where the law requires it or we agree otherwise. If you switch plans, Stripe adjusts the
          charge for the rest of the period.
        </li>
        <li>If a payment fails, sending pauses until it&apos;s fixed.</li>
        <li>We may change prices. We&apos;ll give at least 30 days&apos; notice, and changes apply from your next renewal.</li>
      </ul>
    ),
  },
  {
    id: "acceptable-use",
    title: "Sending email responsibly",
    body: (
      <>
        <p>You&apos;re responsible for every email sent from your workspace. You agree to:</p>
        <ul>
          <li>
            follow the laws that apply to your emails, such as the UK GDPR and the Privacy and Electronic Communications Regulations (PECR), the EU
            GDPR, CAN-SPAM in the US, and the rules wherever your recipients are;
          </li>
          <li>
            only email people you&apos;re allowed to contact (for example, business contacts with relevant offers where the law permits it), and have a
            lawful basis for using their details;
          </li>
          <li>identify yourself honestly, keep your business address in every email, and never hide or disable the unsubscribe link;</li>
          <li>respect every unsubscribe and never re-upload people who have opted out;</li>
          <li>only connect inboxes you own or are authorised to use, and follow your email provider&apos;s rules;</li>
        </ul>
        <p>You must not use YCAReach to:</p>
        <ul>
          <li>send spam to people with no relevant business connection, or use bought or scraped lists where the law doesn&apos;t allow it;</li>
          <li>send misleading, fraudulent, phishing, harassing, hateful or illegal content, or malware;</li>
          <li>impersonate anyone, or use misleading subject lines or sender names;</li>
          <li>get around sending limits, security measures or another customer&apos;s access;</li>
          <li>resell or copy the service, or overload or attack it.</li>
        </ul>
        <p>
          We may pause sending or suspend an account that breaks these rules, gets an unusual number of complaints or bounces, or puts other customers&apos;
          email reputation at risk. Where we reasonably can, we&apos;ll tell you first.
        </p>
      </>
    ),
  },
  {
    id: "data",
    title: "Your data",
    body: (
      <>
        <p>
          You own the content you add to YCAReach, such as your leads, emails and replies. You allow us to use it only to provide and improve the service
          for you. You can delete it at any time, or ask us for a copy.
        </p>
        <p>
          For personal data about your leads and recipients, you are the controller and we are your processor. We process it only on your instructions
          (which are these terms and how you use YCAReach), keep it confidential and secure, use the sub-processors listed in our{" "}
          <Link href="/privacy" className="underline">
            Privacy Policy
          </Link>
          , help you respond to people&apos;s requests about their data, tell you without undue delay about any personal data breach, and delete it
          when you close your account. Email <ContactEmail /> if you need a signed data processing agreement.
        </p>
      </>
    ),
  },
  {
    id: "ai",
    title: "AI features",
    body: (
      <p>
        AI-written emails and reply drafts can be wrong or unsuitable. Read them before you send them: you&apos;re responsible for what you send. Included
        AI is provided as part of Pro and the trial on a fair-use basis and may be temporarily unavailable. If you connect your own AI key, your
        agreement with that provider applies, and you pay them for what you use.
      </p>
    ),
  },
  {
    id: "service",
    title: "The service",
    body: (
      <p>
        We work hard to keep YCAReach running, secure and improving, but we can&apos;t promise it will always be available or free of errors, and no
        one can guarantee that emails will reach the inbox or get replies. We may change features over time; if we remove something important to your
        plan, we&apos;ll give you reasonable notice. YCAReach relies on services we don&apos;t control, such as your email provider.
      </p>
    ),
  },
  {
    id: "liability",
    title: "Liability",
    body: (
      <>
        <p>
          Nothing in these terms limits liability for death or personal injury caused by negligence, fraud, or anything else that can&apos;t be limited by
          law.
        </p>
        <p>
          Otherwise, we aren&apos;t liable for loss of profits, revenue, business, goodwill or data, or for indirect or consequential losses. Our total
          liability to you in any 12-month period is limited to the fees you paid us in those 12 months.
        </p>
        <p>
          You&apos;ll cover our reasonable costs and losses if someone makes a claim against us because of emails you sent or content you added in
          breach of these terms or the law.
        </p>
      </>
    ),
  },
  {
    id: "ending",
    title: "Ending the agreement",
    body: (
      <p>
        You can stop using YCAReach and close your account at any time. We may end or suspend your account if you seriously or repeatedly break these
        terms, or with 30 days&apos; notice for any other reason (refunding any fees paid for time after it ends). After closing, we delete your data as
        described in our Privacy Policy.
      </p>
    ),
  },
  {
    id: "changes",
    title: "Changes to these terms",
    body: (
      <p>
        We may update these terms. For important changes we&apos;ll tell account owners by email at least 30 days before they apply. If you keep using
        YCAReach after that, the new terms apply; if you don&apos;t agree, you can cancel.
      </p>
    ),
  },
  {
    id: "law",
    title: "Law and disputes",
    body: (
      <p>
        These terms are governed by the law of England and Wales, and the courts of England and Wales will deal with any dispute. If you&apos;re based
        elsewhere, any mandatory protections of your local law still apply. Please contact us at <ContactEmail /> first: most problems can be sorted
        out quickly.
      </p>
    ),
  },
];

export default function TermsPage() {
  return <LegalPage title="Terms of Service" intro="The rules for using YCAReach." sections={sections} />;
}
