import http from "node:http";
import https from "node:https";
import { isIP } from "node:net";
import { resolvePublicHost } from "./net-guard";

/**
 * HTTPS POST to a user-supplied URL without the SSRF time-of-check /
 * time-of-use gap of `fetch`.
 *
 * `fetch` resolves the hostname again when it connects, so a DNS answer that
 * was public when we checked it can be private a moment later (DNS rebinding).
 * Here the name is resolved once, checked, and the socket is opened to exactly
 * that address; the hostname is only used for TLS (SNI + certificate) and the
 * Host header. Redirects are never followed and the response size is capped.
 */
export type PinnedResponse = { status: number; text: string };

export class PinnedRequestError extends Error {
  constructor(
    message: string,
    readonly timedOut = false,
  ) {
    super(message);
    this.name = "PinnedRequestError";
  }
}

export async function postJsonPinned(
  rawUrl: string,
  opts: {
    headers?: Record<string, string>;
    body: string;
    timeoutMs?: number;
    maxResponseBytes?: number;
    /** Local development only: allow http:// and private addresses. */
    allowInsecure?: boolean;
  },
): Promise<PinnedResponse> {
  const url = new URL(rawUrl);
  if (url.protocol !== "https:" && !(opts.allowInsecure && url.protocol === "http:")) {
    throw new PinnedRequestError("The address must use https.");
  }
  if (url.username || url.password) throw new PinnedRequestError("The address must not contain a username or password.");

  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  const { address } = await resolvePublicHost(hostname, { allowPrivate: opts.allowInsecure });
  const family = isIP(address);
  const timeoutMs = opts.timeoutMs ?? 60_000;
  const maxBytes = opts.maxResponseBytes ?? 2_000_000;
  const client = url.protocol === "https:" ? https : http;

  return new Promise<PinnedResponse>((resolve, reject) => {
    let settled = false;
    const done = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn();
    };
    const req = client.request(
      {
        protocol: url.protocol,
        host: hostname,
        port: url.port || (url.protocol === "https:" ? 443 : 80),
        path: `${url.pathname}${url.search}`,
        method: "POST",
        headers: { ...opts.headers, "content-length": String(Buffer.byteLength(opts.body)) },
        // Connect to the address we validated, whatever DNS says now.
        lookup: (_host, options, cb) => {
          const all = typeof options === "object" && options !== null && (options as { all?: boolean }).all;
          if (all) (cb as unknown as (e: null, a: { address: string; family: number }[]) => void)(null, [{ address, family }]);
          else (cb as unknown as (e: null, a: string, f: number) => void)(null, address, family);
        },
        ...(url.protocol === "https:" ? { servername: isIP(hostname) ? undefined : hostname, minVersion: "TLSv1.2" as const } : {}),
        agent: false,
      },
      (res) => {
        const chunks: Buffer[] = [];
        let size = 0;
        res.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > maxBytes) {
            req.destroy();
            done(() => reject(new PinnedRequestError("The response was too large.")));
            return;
          }
          chunks.push(chunk);
        });
        res.on("end", () => done(() => resolve({ status: res.statusCode ?? 0, text: Buffer.concat(chunks).toString("utf8") })));
        res.on("error", () => done(() => reject(new PinnedRequestError("The connection was interrupted."))));
      },
    );
    const timer = setTimeout(() => {
      req.destroy();
      done(() => reject(new PinnedRequestError("The request timed out.", true)));
    }, timeoutMs);
    req.on("error", () => done(() => reject(new PinnedRequestError("Couldn't connect."))));
    req.end(opts.body);
  });
}
