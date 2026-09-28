import nodemailer from "nodemailer";
import { ImapFlow } from "imapflow";
import type { CheckResult, ConnectionSettings, ConnectionTestResult, Provider } from "@crm/core";
import { classifyMailError, type Protocol } from "./errors";
import { isIP } from "node:net";
import { resolvePublicHost } from "./net-guard";

// SNI must be a hostname (RFC 6066); omit it when the user typed an IP.
const sni = (host: string) => (isIP(host) ? undefined : host);

export type MailAccountConfig = ConnectionSettings & {
  provider: Provider;
  email: string;
  username: string;
  password: string;
};

export type AdapterOptions = {
  /** Per-step network timeout. Default 10s. */
  timeoutMs?: number;
  /** Allow private/loopback hosts (local dev with Mailpit etc). Never in production. */
  allowPrivateHosts?: boolean;
  /**
   * Allow authenticating over an unencrypted connection when the server offers
   * no STARTTLS. Tests / local dev only: in production credentials must never
   * travel in cleartext.
   */
  allowPlaintextAuth?: boolean;
};

export type OutgoingMessage = {
  fromName: string | null;
  to: string;
  subject: string;
  text: string;
  html: string;
  /** Full RFC 5322 Message-ID including angle brackets; we generate it so replies can be matched. */
  messageId: string;
  inReplyTo?: string | null;
  references?: string[];
  headers?: Record<string, string>;
};

export type SendResult =
  | { ok: true; messageId: string; response: string }
  | {
      ok: false;
      error: string;
      hint?: string;
      /** Recipient permanently rejected (5xx on RCPT/DATA): suppress + stop. */
      hardBounce: boolean;
      /** The account itself is broken (auth, disabled): stop using it until fixed. */
      accountProblem: boolean;
      /** Worth retrying later (4xx, network). */
      retryable: boolean;
    };

/**
 * Provider adapter. Connection checks, sending; inbox sync (Phase 7) will be
 * added to this same interface.
 */
export interface MailAdapter {
  readonly provider: Provider;
  verifySmtp(): Promise<CheckResult>;
  verifyImap(): Promise<CheckResult>;
  send(message: OutgoingMessage): Promise<SendResult>;
}

type SmtpErr = { code?: string; responseCode?: number; response?: string; message?: string; rejected?: string[] };

export function classifySendError(err: unknown, provider: Provider): Extract<SendResult, { ok: false }> {
  const e = (err ?? {}) as SmtpErr;
  const { error, hint } = classifyMailError(err, "smtp", provider);
  const code = e.responseCode ?? 0;
  const text = `${e.response ?? ""} ${e.message ?? ""}`;
  const accountProblem = e.code === "EAUTH" || code === 535 || code === 534 || /daily user sending limit|account.*(disabled|suspended)/i.test(text);
  // 5xx for the recipient (not our auth/quota) = hard bounce.
  const recipientRejected =
    (e.code === "EENVELOPE" || (e.rejected?.length ?? 0) > 0 || /recipient|mailbox|user unknown|no such user|does not exist/i.test(text)) &&
    code >= 500 &&
    code < 600;
  const hardBounce = recipientRejected && !accountProblem;
  const retryable = !hardBounce && !accountProblem && (code === 0 || (code >= 400 && code < 500) || /TIMEOUT|ECONN|ESOCKET/i.test(e.code ?? ""));
  return { ok: false, error: hardBounce ? `Recipient rejected: ${(e.response ?? error).slice(0, 200)}` : error, hint, hardBounce, accountProblem, retryable };
}

export class ProviderNotImplementedError extends Error {
  constructor(provider: Provider) {
    super(`Provider "${provider}" is not implemented yet`);
    this.name = "ProviderNotImplementedError";
  }
}

async function timed(protocol: Protocol, provider: Provider, fn: () => Promise<void>): Promise<CheckResult> {
  const started = Date.now();
  try {
    await fn();
    return { ok: true, latencyMs: Date.now() - started };
  } catch (err) {
    return { ok: false, ...classifyMailError(err, protocol, provider) };
  }
}

/** Generic SMTP + IMAP over app passwords. Used for both `smtp` and `google`. */
export class SmtpImapAdapter implements MailAdapter {
  readonly provider: Provider;
  private readonly timeoutMs: number;

  constructor(
    private readonly config: MailAccountConfig,
    private readonly opts: AdapterOptions = {},
  ) {
    this.provider = config.provider;
    this.timeoutMs = opts.timeoutMs ?? 10_000;
  }

  verifySmtp(): Promise<CheckResult> {
    return timed("smtp", this.provider, async () => {
      const { host, address } = await resolvePublicHost(this.config.smtpHost, { allowPrivate: this.opts.allowPrivateHosts });
      const transport = nodemailer.createTransport({
        host: address,
        port: this.config.smtpPort,
        secure: this.config.smtpSecure,
        requireTLS: !this.config.smtpSecure && !this.opts.allowPlaintextAuth,
        ignoreTLS: false,
        auth: { user: this.config.username, pass: this.config.password },
        tls: { servername: sni(host), minVersion: "TLSv1.2" },
        connectionTimeout: this.timeoutMs,
        greetingTimeout: this.timeoutMs,
        socketTimeout: this.timeoutMs,
        logger: false,
        debug: false,
      });
      try {
        await transport.verify();
      } finally {
        transport.close();
      }
    });
  }

  async send(message: OutgoingMessage): Promise<SendResult> {
    let transport: ReturnType<typeof nodemailer.createTransport> | null = null;
    try {
      const { host, address } = await resolvePublicHost(this.config.smtpHost, { allowPrivate: this.opts.allowPrivateHosts });
      transport = nodemailer.createTransport({
        host: address,
        port: this.config.smtpPort,
        secure: this.config.smtpSecure,
        requireTLS: !this.config.smtpSecure && !this.opts.allowPlaintextAuth,
        auth: { user: this.config.username, pass: this.config.password },
        tls: { servername: sni(host), minVersion: "TLSv1.2" },
        name: this.config.email.split("@")[1],
        connectionTimeout: this.timeoutMs,
        greetingTimeout: this.timeoutMs,
        socketTimeout: this.timeoutMs * 3,
        logger: false,
        debug: false,
      });
      const info = await transport.sendMail({
        from: message.fromName ? { name: message.fromName, address: this.config.email } : this.config.email,
        to: message.to,
        subject: message.subject,
        text: message.text,
        html: message.html,
        messageId: message.messageId,
        inReplyTo: message.inReplyTo ?? undefined,
        references: message.references?.length ? message.references : undefined,
        headers: message.headers,
      });
      if (info.rejected?.length) {
        return classifySendError({ code: "EENVELOPE", responseCode: 550, response: info.response, rejected: info.rejected }, this.provider);
      }
      return { ok: true, messageId: message.messageId, response: info.response };
    } catch (err) {
      return classifySendError(err, this.provider);
    } finally {
      transport?.close();
    }
  }

  verifyImap(): Promise<CheckResult> {
    return timed("imap", this.provider, async () => {
      const { host, address } = await resolvePublicHost(this.config.imapHost, { allowPrivate: this.opts.allowPrivateHosts });
      const client = new ImapFlow({
        host: address,
        port: this.config.imapPort,
        secure: this.config.imapSecure,
        servername: sni(host),
        doSTARTTLS: this.config.imapSecure ? undefined : !this.opts.allowPlaintextAuth,
        auth: { user: this.config.username, pass: this.config.password },
        tls: { servername: sni(host), minVersion: "TLSv1.2" },
        logger: false,
        connectionTimeout: this.timeoutMs,
        greetingTimeout: this.timeoutMs,
        socketTimeout: this.timeoutMs,
        disableAutoIdle: true,
      });
      // imapflow emits 'error' on socket failures; without a listener Node would crash.
      client.on("error", () => {});
      try {
        await client.connect();
        // Reply detection needs INBOX; make sure we can open it (read-only).
        const lock = await client.getMailboxLock("INBOX", { readOnly: true });
        lock.release();
        await client.logout();
      } finally {
        client.close();
      }
    });
  }
}

export function createMailAdapter(config: MailAccountConfig, opts?: AdapterOptions): MailAdapter {
  switch (config.provider) {
    case "google":
    case "smtp":
      return new SmtpImapAdapter(config, opts);
    case "outlook":
      // Microsoft is retiring basic auth; Outlook needs an OAuth/Graph adapter (post-v1).
      throw new ProviderNotImplementedError(config.provider);
  }
}

/** Runs SMTP and IMAP checks in parallel. */
export async function testConnection(adapter: MailAdapter): Promise<ConnectionTestResult> {
  const [smtp, imap] = await Promise.all([adapter.verifySmtp(), adapter.verifyImap()]);
  return { smtp, imap };
}
