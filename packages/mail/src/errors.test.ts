import { describe, expect, it } from "vitest";
import { classifyMailError } from "./errors";
import { HostNotAllowedError } from "./net-guard";

const err = (props: Record<string, unknown>) => Object.assign(new Error(String(props.message ?? "")), props);

describe("classifyMailError", () => {
  it("explains Gmail app-password requirements", () => {
    const r = classifyMailError(
      err({ code: "EAUTH", responseCode: 534, response: "534-5.7.9 Application-specific password required." }),
      "smtp",
      "google",
    );
    expect(r.error).toBe("Google rejected the password");
    expect(r.hint).toMatch(/apppasswords/);
  });

  it("detects Gmail IMAP being disabled", () => {
    const r = classifyMailError(err({ message: "[ALERT] Your account is not enabled for IMAP use." }), "imap", "google");
    expect(r.hint).toMatch(/Enable IMAP/);
  });

  it("maps generic auth failures (SMTP and IMAP)", () => {
    expect(classifyMailError(err({ code: "EAUTH", responseCode: 535 }), "smtp", "smtp").error).toBe("SMTP authentication failed");
    expect(classifyMailError(err({ authenticationFailed: true }), "imap", "smtp").error).toBe("IMAP authentication failed");
  });

  it("maps network errors", () => {
    expect(classifyMailError(err({ code: "ENOTFOUND" }), "smtp", "smtp").error).toBe("SMTP host not found");
    expect(classifyMailError(err({ code: "ECONNREFUSED" }), "imap", "smtp").error).toBe("IMAP connection refused");
    expect(classifyMailError(err({ code: "ETIMEDOUT" }), "smtp", "smtp").error).toBe("SMTP connection timed out");
    expect(classifyMailError(err({ code: "CONNECT_TIMEOUT" }), "imap", "smtp").error).toBe("IMAP connection timed out");
  });

  it("explains TLS port mismatches", () => {
    const r = classifyMailError(err({ message: "ssl3_get_record:wrong version number" }), "smtp", "smtp");
    expect(r.error).toBe("SMTP TLS mismatch");
    expect(r.hint).toMatch(/587/);
  });

  it("reports blocked hosts", () => {
    const r = classifyMailError(new HostNotAllowedError("x resolves to a private address"), "smtp", "smtp");
    expect(r.error).toMatch(/private/);
  });

  it("falls back to a truncated message", () => {
    const r = classifyMailError(err({ message: "weird ".repeat(100) }), "smtp", "smtp");
    expect(r.error.startsWith("SMTP error: weird")).toBe(true);
    expect(r.error.length).toBeLessThan(230);
  });
});
