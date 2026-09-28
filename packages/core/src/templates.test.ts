import { describe, expect, it } from "vitest";
import { buildEmail, renderTemplate, templateTags, textToHtml } from "./templates";

const ctx = {
  lead: { email: "ada@x.io", first_name: "Ada", last_name: "Lovelace", company: "Analytical", title: null, custom_json: { plan: "pro", seats: 12 } },
  sender: { name: "Jane Smith", email: "jane@acme.io" },
};

describe("renderTemplate", () => {
  it("fills built-in, sender and custom tags", () => {
    expect(renderTemplate("Hi {{first_name}} at {{ company }} — {{plan}}/{{custom.seats}} from {{sender_first_name}}", ctx).text).toBe(
      "Hi Ada at Analytical — pro/12 from Jane",
    );
  });

  it("uses fallbacks and reports missing tags", () => {
    const r = renderTemplate("{{title|leader}} {{title}} {{nope}}", ctx);
    expect(r.text).toBe("leader  ");
    expect(r.missing).toEqual(["title", "nope"]);
  });

  it("lists tags", () => {
    expect(templateTags("{{a}} {{ b|x }} {{a}}")).toEqual(["a", "b"]);
  });
});

describe("textToHtml", () => {
  it("escapes and keeps paragraphs/line breaks", () => {
    expect(textToHtml("Hi <b>Ada</b>,\n\nline1\nline2")).toBe("<p>Hi &lt;b&gt;Ada&lt;/b&gt;,</p>\n<p>line1<br>line2</p>");
  });
});

describe("buildEmail", () => {
  const base = { ctx, unsubscribeUrl: "https://app.test/u/tok", physicalAddress: "1 Main St" };

  it("renders subject/body and appends the compliance footer to both parts", () => {
    const e = buildEmail({ ...base, subject: "Quick q, {{first_name}}", body: "Hi {{first_name}}" });
    expect(e.subject).toBe("Quick q, Ada");
    expect(e.text).toBe("Hi Ada\n\n\nNot interested? Unsubscribe: https://app.test/u/tok\n1 Main St\n");
    expect(e.html).toContain('<a href="https://app.test/u/tok"');
    expect(e.html).toContain("1 Main St");
  });

  it("threads follow-ups with an empty subject as Re:", () => {
    expect(buildEmail({ ...base, subject: "", body: "bump", threadSubject: "Quick q, Ada" }).subject).toBe("Re: Quick q, Ada");
    expect(buildEmail({ ...base, subject: " ", body: "bump", threadSubject: "Re: Quick q" }).subject).toBe("Re: Quick q");
  });

  it("strips newlines from subjects (header injection)", () => {
    expect(buildEmail({ ...base, subject: "Hi\r\nBcc: x@evil.io", body: "b" }).subject).toBe("Hi Bcc: x@evil.io");
  });
});
