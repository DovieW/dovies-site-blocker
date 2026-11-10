import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
const dir = await mkdtemp(join(tmpdir(), "dovie-test-"));
const context = await chromium.launchPersistentContext(dir, {
  channel: "chromium",
  headless: true,
  args: [
    `--disable-extensions-except=${resolve("dist")}`,
    `--load-extension=${resolve("dist")}`,
  ],
});
try {
  const worker =
    context.serviceWorkers()[0] ||
    (await context.waitForEvent("serviceworker"));
  const id = new URL(worker.url()).hostname;
  const page = await context.newPage();
  await page.goto(`chrome-extension://${id}/options.html`);
  await page.getByText("Add a website", { exact: true }).click();
  await page.getByLabel("Website domain").fill("example.com");
  await page
    .getByLabel("Your reason (optional)")
    .fill("I have better things to read.");
  await page
    .getByRole("button", { name: "Block This Site", exact: true })
    .click();
  await page
    .locator(".site strong")
    .filter({ hasText: "example.com" })
    .waitFor();
  const rules = await worker.evaluate(() =>
    chrome.declarativeNetRequest.getDynamicRules(),
  );
  assert.equal(rules.length, 1);
  const blocked = await context.newPage();
  await blocked.goto("https://example.com/").catch(() => {});
  await blocked.waitForURL(`chrome-extension://${id}/warning.html#**`);
  await blocked
    .getByText("I have better things to read.", { exact: true })
    .waitFor();
  await mkdir("artifacts", { recursive: true });
  await blocked.screenshot({ path: "artifacts/warning.png" });
  await blocked
    .getByRole("button", { name: "Visit Anyway", exact: true })
    .click();
  await blocked.waitForURL("https://example.com/");
  const session = await worker.evaluate(() =>
    chrome.declarativeNetRequest.getSessionRules(),
  );
  assert.equal(session.length, 1);
  assert.equal(session[0].condition.tabIds.length, 1);
  await blocked.reload();
  assert.equal(blocked.url(), "https://example.com/");
  const other = await context.newPage();
  await other.goto("https://example.com/").catch(() => {});
  await other.waitForURL(`chrome-extension://${id}/warning.html#**`);
  // A page fixture on an unblocked host exercises real isolated-world content scripts.
  await context.route("https://fixture.test/**", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: '<!doctype html><title>Link fixture</title><a href="https://example.com/a">Publication</a><button>Unrelated control</button>',
    }),
  );
  const fixture = await context.newPage();
  await fixture.goto("https://fixture.test/");
  await fixture.locator("a.dovie-mark").waitFor();
  assert.match(
    await fixture.locator("a").getAttribute("title"),
    /better things/,
  );
  await fixture.evaluate(() => {
    const a = document.createElement("a");
    a.href = "https://www.google.com/url?q=https%3A%2F%2Fexample.com%2Fb";
    a.textContent = "Dynamic";
    document.body.append(a);
  });
  await fixture.locator("a.dovie-mark").nth(1).waitFor();
  await worker.evaluate(() => chrome.storage.sync.set({ "s:mode": "hide" }));
  await fixture.locator("a.dovie-hide").first().waitFor({ state: "attached" });
  await worker.evaluate(() => chrome.storage.sync.set({ "s:mode": "warn" }));
  await fixture.waitForFunction(
    () => document.querySelector("a").className === "",
  );
  await fixture.getByText("Publication", { exact: true }).click();
  await fixture.waitForURL(`chrome-extension://${id}/warning.html#**`);
  // Gmail-shaped dynamic conversations and Google results use the same isolated-world path.
  await context.route("https://mail.google.com/**", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: '<!doctype html><title>Gmail fixture</title><button>Archive</button><div id="conversation"></div>',
    }),
  );
  const gmail = await context.newPage();
  await gmail.goto("https://mail.google.com/mail/u/0/");
  await worker.evaluate(() => chrome.storage.sync.set({ "s:mode": "mark" }));
  await gmail.evaluate(() => {
    document.querySelector("#conversation").innerHTML =
      '<a href="https://example.com/story">Email publication</a>';
  });
  await gmail.locator("a.dovie-mark").waitFor();
  assert.equal(
    await gmail.getByRole("button", { name: "Archive" }).isEnabled(),
    true,
  );
  await worker.evaluate(() => chrome.storage.sync.set({ "s:gmail": false }));
  await gmail.waitForFunction(
    () => document.querySelector("a").className === "",
  );
  await context.route("https://www.google.com/search**", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: '<!doctype html><a href="https://www.google.com/url?q=https%3A%2F%2Fexample.com%2Fstory">Search result</a>',
    }),
  );
  const search = await context.newPage();
  await search.goto("https://www.google.com/search?q=test");
  await search.locator("a.dovie-mark").waitFor();
  await page.screenshot({ path: "artifacts/dashboard.png", fullPage: true });
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  await page.getByText("Nothing here yet.", { exact: false }).waitFor();
  assert.equal(
    (
      await worker.evaluate(() =>
        chrome.declarativeNetRequest.getDynamicRules(),
      )
    ).length,
    0,
  );
  console.log(
    "PASS: UI save, DNR redirect, reason, scoped bypass, reload, second tab isolation, dynamic links, local Google unwrap, modes, click warning, deletion.",
  );
} finally {
  await context.close();
  await rm(dir, { recursive: true, force: true });
}
