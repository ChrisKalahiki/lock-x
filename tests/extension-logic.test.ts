import { describe, expect, test } from "bun:test";

await import("../extension/background.js");
await import("../extension/content.js");

const bg = (globalThis as any).__lockXBackgroundTest;
const content = (globalThis as any).__lockXContentTest;

describe("hostname matching", () => {
  test("normalizes common subdomains", () => {
    expect(bg.normalizeHostname("www.x.com")).toBe("x.com");
    expect(bg.normalizeHostname("m.reddit.com")).toBe("reddit.com");
    expect(bg.normalizeHostname("mobile.youtube.com")).toBe("youtube.com");
  });

  test("matches blocked domains and subdomains", () => {
    const sites = ["x.com", "reddit.com"];
    expect(bg.isBlockedHostname("x.com", sites)).toBe(true);
    expect(bg.isBlockedHostname("news.reddit.com", sites)).toBe(true);
    expect(bg.isBlockedHostname("example.com", sites)).toBe(false);
  });
});

describe("fail-closed decisioning", () => {
  test("allows only when status explicitly says not blocked", () => {
    const statusAllow = { shouldBlock: false };
    const siteIrrelevant = { isBlocked: true };
    expect(content.shouldBlockPage(statusAllow, siteIrrelevant)).toBe(false);
  });

  test("blocks on status uncertainty", () => {
    const statusUnknown = { error: "timeout" };
    const siteBlocked = { isBlocked: true };
    expect(content.shouldBlockPage(statusUnknown, siteBlocked)).toBe(true);
  });

  test("blocks when site check fails", () => {
    const statusBlock = { shouldBlock: true };
    expect(content.shouldBlockPage(statusBlock, { error: "timeout" })).toBe(true);
  });
});
