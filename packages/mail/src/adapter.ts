import nodemailer from "nodemailer";
import { ImapFlow } from "imapflow";
import type { CheckResult, ConnectionSettings, ConnectionTestResult, Provider } from "@crm/core";
import { classifyMailError, type Protocol } from "./errors";
import { resolvePublicHost } from "./net-guard";

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

/**
 * Provider adapter. Phase 2 implements connection checks; `send` (Phases 5–6)
 * and inbox sync (Phase 7) are added to this same interface.
 */
export interface MailAdapter {
  readonly provider: Provider;
  verifySmtp(): Promise<CheckResult>;
  verifyImap(): Promise<CheckResult>;
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
        tls: { servername: host, minVersion: "TLSv1.2" },
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

  verifyImap(): Promise<CheckResult> {
    return timed("imap", this.provider, async () => {
      const { host, address } = await resolvePublicHost(this.config.imapHost, { allowPrivate: this.opts.allowPrivateHosts });
      const client = new ImapFlow({
        host: address,
        port: this.config.imapPort,
        secure: this.config.imapSecure,
        servername: host,
        doSTARTTLS: this.config.imapSecure ? undefined : !this.opts.allowPlaintextAuth,
        auth: { user: this.config.username, pass: this.config.password },
        tls: { servername: host, minVersion: "TLSv1.2" },
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
