import { describe, expect, it } from "vitest";
import { HostNotAllowedError, isPrivateAddress, resolvePublicHost } from "./net-guard";

describe("isPrivateAddress", () => {
  it.each(["127.0.0.1", "10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "::1", "fd00::1", "fe80::1", "::ffff:127.0.0.1", "::ffff:10.0.0.1", "::ffff:7f00:1", "0:0:0:0:0:ffff:a00:1", "::127.0.0.1", "::a00:1", "2002:7f00:1::", "2002:a9fe:a9fe::1", "64:ff9b::a9fe:a9fe", "2001:0:7f00:1::", "2001:0:808:808::f5ff:fffe", "fe80::1%eth0", "::"])(
    "blocks %s",
    (ip) => expect(isPrivateAddress(ip)).toBe(true),
  );

  it.each(["8.8.8.8", "142.250.102.108", "172.32.0.1", "2607:f8b0:4004::6c", "::ffff:8.8.8.8", "2002:808:808::1", "2001:4860:4860::8888"])("allows %s", (ip) =>
    expect(isPrivateAddress(ip)).toBe(false),
  );
});

describe("resolvePublicHost", () => {
  it("rejects private IP literals and localhost", async () => {
    await expect(resolvePublicHost("169.254.169.254")).rejects.toBeInstanceOf(HostNotAllowedError);
    await expect(resolvePublicHost("localhost")).rejects.toBeInstanceOf(HostNotAllowedError);
  });

  it("allows private hosts when explicitly permitted", async () => {
    await expect(resolvePublicHost("127.0.0.1", { allowPrivate: true })).resolves.toEqual({ host: "127.0.0.1", address: "127.0.0.1" });
  });

  it("passes public IP literals through", async () => {
    await expect(resolvePublicHost("8.8.8.8")).resolves.toEqual({ host: "8.8.8.8", address: "8.8.8.8" });
  });
});
