import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { HostNotAllowedError } from "./net-guard";
import { PinnedRequestError, postJsonPinned } from "./pinned-http";

let server: http.Server;
let port: number;
const seen: { host?: string; body: string }[] = [];

beforeAll(async () => {
  server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      seen.push({ host: req.headers.host, body });
      if (req.url === "/redirect") {
        res.writeHead(302, { location: "http://169.254.169.254/latest/meta-data/" }).end();
      } else if (req.url === "/big") {
        res.writeHead(200).end("x".repeat(5000));
      } else if (req.url === "/slow") {
        // never answers
      } else {
        res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ ok: true }));
      }
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  port = (server.address() as AddressInfo).port;
});
afterAll(() => {
  server.closeAllConnections();
  server.close();
});

describe("postJsonPinned", () => {
  it("refuses http and private addresses by default", async () => {
    await expect(postJsonPinned(`http://127.0.0.1:${port}/`, { body: "{}" })).rejects.toBeInstanceOf(PinnedRequestError);
    await expect(postJsonPinned("https://127.0.0.1/", { body: "{}" })).rejects.toBeInstanceOf(HostNotAllowedError);
    await expect(postJsonPinned("https://localhost/", { body: "{}" })).rejects.toBeInstanceOf(HostNotAllowedError);
    await expect(postJsonPinned("https://[::ffff:169.254.169.254]/", { body: "{}" })).rejects.toBeInstanceOf(HostNotAllowedError);
    expect(seen).toHaveLength(0);
  });

  it("refuses credentials in the address", async () => {
    await expect(postJsonPinned("https://user:pass@example.com/", { body: "{}" })).rejects.toThrow(/username or password/);
  });

  it("posts to the validated address and keeps the Host header", async () => {
    const res = await postJsonPinned(`http://127.0.0.1:${port}/v1`, { body: '{"a":1}', headers: { "content-type": "application/json" }, allowInsecure: true });
    expect(res).toEqual({ status: 200, text: '{"ok":true}' });
    expect(seen.at(-1)).toEqual({ host: `127.0.0.1:${port}`, body: '{"a":1}' });
  });

  it("does not follow redirects", async () => {
    const res = await postJsonPinned(`http://127.0.0.1:${port}/redirect`, { body: "{}", allowInsecure: true });
    expect(res.status).toBe(302);
  });

  it("caps the response size and times out", async () => {
    await expect(postJsonPinned(`http://127.0.0.1:${port}/big`, { body: "{}", allowInsecure: true, maxResponseBytes: 1000 })).rejects.toThrow(/too large/);
    await expect(postJsonPinned(`http://127.0.0.1:${port}/slow`, { body: "{}", allowInsecure: true, timeoutMs: 100 })).rejects.toMatchObject({ timedOut: true });
  });
});
