import { BlockList, isIP } from "node:net";
import { lookup } from "node:dns/promises";

/**
 * SSRF guard for user-supplied SMTP/IMAP hosts.
 *
 * The server connects to whatever host a user types in, so without this a
 * user could make us probe internal services (cloud metadata, localhost,
 * VPC-internal hosts). We resolve the hostname ONCE, reject private/reserved
 * ranges, and then connect to that exact IP (passing the hostname only as the
 * TLS servername) so a DNS rebind between check and connect cannot bypass it.
 */
const blocked = new BlockList();
for (const [net, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const) {
  blocked.addSubnet(net, prefix, "ipv4");
}
for (const [net, prefix] of [
  ["::", 128],
  ["::1", 128],
  ["64:ff9b::", 96],
  ["100::", 64],
  ["2001:db8::", 32],
  ["fc00::", 7],
  ["fe80::", 10],
  ["ff00::", 8],
] as const) {
  blocked.addSubnet(net, prefix, "ipv6");
}

export function isPrivateAddress(ip: string): boolean {
  const family = isIP(ip);
  if (family === 0) throw new Error(`Not an IP address: ${ip}`);
  if (family === 6) {
    // IPv4-mapped IPv6 (::ffff:a.b.c.d) — judge by the embedded IPv4.
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip);
    if (mapped) return blocked.check(mapped[1]!, "ipv4");
    return blocked.check(ip, "ipv6");
  }
  return blocked.check(ip, "ipv4");
}

export class HostNotAllowedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HostNotAllowedError";
  }
}

export type ResolvedHost = { host: string; address: string };

export async function resolvePublicHost(host: string, opts: { allowPrivate?: boolean } = {}): Promise<ResolvedHost> {
  const addresses = isIP(host) ? [host] : (await lookup(host, { all: true, verbatim: true })).map((a) => a.address);
  if (addresses.length === 0) throw new HostNotAllowedError(`Could not resolve ${host}`);

  if (!opts.allowPrivate) {
    // Reject if ANY record is private: an attacker could mix public and private records.
    const bad = addresses.find(isPrivateAddress);
    if (bad) throw new HostNotAllowedError(`${host} resolves to a private or reserved address (${bad})`);
  }
  return { host, address: addresses[0]! };
}
