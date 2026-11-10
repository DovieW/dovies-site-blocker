import { describe, it, expect, vi } from "vitest";
import {
  domain,
  suggested,
  matches,
  destination,
  live,
  importEntries,
  settings,
  defaults,
  rules,
  type Entry,
} from "../src/core";
const e: Entry = {
  v: 1,
  domain: "example.co.uk",
  reason: "Less noise",
  sub: true,
  at: 100,
  gen: "",
};
describe("domain boundaries", () => {
  it("uses PSL and IDNA", () => {
    expect(suggested("https://news.example.co.uk:443/x")).toBe("example.co.uk");
    expect(domain("WWW.BÜCHER.de:8080")).toBe("xn--bcher-kva.de");
    expect(suggested("alice.github.io")).toBe("alice.github.io");
  });
  it("rejects public suffixes and unsafe URLs", () => {
    for (const s of [
      "co.uk",
      "localhost",
      "127.0.0.1",
      "javascript:alert(1)",
      "https://u:p@example.com",
    ])
      expect(() => domain(s)).toThrow();
  });
  it("honors exact and subdomain scopes", () => {
    expect(matches(e, "news.example.co.uk")).toBe(true);
    expect(matches(e, "evil-example.co.uk")).toBe(false);
    expect(matches(e, "example.co.uk.evil.org")).toBe(false);
    expect(matches({ ...e, sub: false }, "news.example.co.uk")).toBe(false);
    expect(matches({ ...e, sub: false }, "www.example.co.uk")).toBe(true);
  });
});
describe("local redirect resolution", () => {
  it("unwraps recognized Google URLs only", () => {
    expect(
      destination("https://www.google.com/url?q=https%3A%2F%2Fexample.com%2Fa"),
    ).toBe("https://example.com/a");
    expect(
      destination("https://tracker.example/c?url=https://example.com"),
    ).toBe("https://tracker.example/c?url=https://example.com");
    expect(
      destination("https://www.google.com.evil.org/url?q=https://example.com"),
    ).toBe("https://www.google.com.evil.org/url?q=https://example.com");
    expect(destination("javascript:alert(1)")).toBeUndefined();
    expect(
      destination("https://www.google.com/url?q=javascript:alert(1)"),
    ).toBeUndefined();
  });
});
describe("sync conflict semantics", () => {
  it("keeps stale edits deleted until explicitly readded", () => {
    const data = { "e:example.co.uk": e, "d:example.co.uk": "deletion" };
    expect(live(data)).toEqual([]);
    expect(
      live({ ...data, "e:example.co.uk": { ...e, reason: "stale" } }),
    ).toEqual([]);
    expect(
      live({ ...data, "e:example.co.uk": { ...e, gen: "deletion" } }),
    ).toHaveLength(1);
  });
  it("ignores malformed and future records", () => {
    expect(live({ "e:example.co.uk": { ...e, v: 2 } })).toEqual([]);
    expect(settings({ "s:mode": "unsafe" })).toEqual(defaults);
  });
});
describe("backups", () => {
  it("validates and deduplicates", () => {
    expect(
      importEntries(
        JSON.stringify({ version: 1, entries: [e, { ...e, reason: "last" }] }),
      )[0].reason,
    ).toBe("last");
    expect(() => importEntries('{"version":2}')).toThrow();
    expect(() =>
      importEntries(
        JSON.stringify({
          version: 1,
          entries: [{ ...e, reason: "x".repeat(501) }],
        }),
      ),
    ).toThrow();
  });
});
it("builds bounded navigation rules", () => {
  vi.stubGlobal("chrome", {
    declarativeNetRequest: {
      RuleActionType: { REDIRECT: "redirect" },
      ResourceType: { MAIN_FRAME: "main_frame" },
    },
  });
  const r = rules([e], "chrome-extension://id/warning.html")[0];
  const re = new RegExp(r.condition.regexFilter!);
  expect(re.test("https://news.example.co.uk/article")).toBe(true);
  expect(re.test("https://evil-example.co.uk")).toBe(false);
  expect(
    "https://news.example.co.uk/article".replace(
      re,
      r.action.redirect!.regexSubstitution!.replace("\\1", "$1"),
    ),
  ).toBe(
    "chrome-extension://id/warning.html#https://news.example.co.uk/article",
  );
});
