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
  ["192.88.99.0", 24],
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
  ["2001:2::", 48],
  ["2001:10::", 28],
  ["2001:db8::", 32],
  ["fc00::", 7],
  ["fe80::", 10],
  ["ff00::", 8],
] as const) {
  blocked.addSubnet(net, prefix, "ipv6");
}

/** Expands any textual IPv6 address to its eight 16-bit groups. */
function ipv6Groups(ip: string): number[] {
  let text = ip.split("%")[0]!.toLowerCase();
  // A dotted IPv4 tail (::ffff:1.2.3.4) is the last 32 bits.
  const dotted = /^(.*:)(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(text);
  if (dotted) {
    const [a, b, c, d] = dotted.slice(2).map(Number) as [number, number, number, number];
    text = `${dotted[1]}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const [head = "", tail] = text.split("::");
  const left = head ? head.split(":") : [];
  const right = tail ? tail.split(":") : [];
  const fill = tail === undefined ? 0 : 8 - left.length - right.length;
  return [...left, ...Array<string>(Math.max(fill, 0)).fill("0"), ...right].map((g) => parseInt(g, 16) || 0);
}

const v4 = (hi: number, lo: number) => `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;

/**
 * IPv4 addresses carried inside an IPv6 one. Each of these forms can end up
 * delivering to the embedded IPv4 host, so that host has to be public too:
 * IPv4-mapped (::ffff:0:0/96), IPv4-compatible (::/96), NAT64 (64:ff9b::/96),
 * 6to4 (2002::/16) and Teredo (2001::/32, client address stored inverted).
 */
function embeddedIpv4(ip: string): string[] {
  const g = ipv6Groups(ip);
  if (g.length !== 8) return [];
  const zeros = (n: number) => g.slice(0, n).every((x) => x === 0);
  const out: string[] = [];
  if (zeros(5) && g[5] === 0xffff) out.push(v4(g[6]!, g[7]!));
  if (zeros(6) && (g[6] !== 0 || g[7]! > 1)) out.push(v4(g[6]!, g[7]!));
  if (g[0] === 0x64 && g[1] === 0xff9b && g.slice(2, 6).every((x) => x === 0)) out.push(v4(g[6]!, g[7]!));
  if (g[0] === 0x2002) out.push(v4(g[1]!, g[2]!));
  if (g[0] === 0x2001 && g[1] === 0) out.push(v4(g[2]!, g[3]!), v4(g[6]! ^ 0xffff, g[7]! ^ 0xffff));
  return out;
}

export function isPrivateAddress(ip: string): boolean {
  const family = isIP(ip);
  if (family === 0) throw new Error(`Not an IP address: ${ip}`);
  if (family === 6) {
    if (blocked.check(ip.split("%")[0]!, "ipv6")) return true;
    // Judge transition addresses by the IPv4 host they point at.
    return embeddedIpv4(ip).some((addr) => blocked.check(addr, "ipv4"));
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
