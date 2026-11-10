# Dovie's Site Blocker

An unsubscribe list for the web. A private, open-source Chrome extension that remembers websites you chose to stop reading, identifies their links, and reminds you why before you return.

## Install in Chrome

1. Download this repository (Code → Download ZIP) and extract it.
2. Open `chrome://extensions` and turn on **Developer mode**.
3. Click **Load unpacked** and select the repository's **dist** folder.
4. Pin Dovie's Site Blocker from Chrome's extensions menu.
5. Open a publication, click the extension, optionally enter your reason, and click **Block This Site**.

`dist/` is the built extension, included for installation without Node. Keep it in place after loading. After updating files, click Reload on the extension card. Reload existing web pages to start link treatment on pages that were open before installation.

## Everyday use

The popup suggests the registrable domain using the maintained `tldts` Public Suffix List (including private suffixes). Edit this field to select a specific subdomain. `www` is treated as an alias; ports don't affect domain matching. Include subdomains is on by default. The dashboard supports search, sorting, editing, manual additions, deletion, backup import/export, and preferences. Context-menu actions open a prefilled add form so you can review the domain and supply a reason.

The warning quotes your saved reason and original block date. **Visit Anyway** allows one exact URL in the current tab for five minutes, including reloads. Other paths and other tabs remain protected. Returning after expiration prompts again. Unblock removes the decision from your active list.

Link modes: **Mark** dims and strikes through anchors with a small ⊘ indicator; **Hide** hides only the anchor, preserving surrounding content; **Warn on click** leaves anchors unchanged and intercepts clicks. Hover explanations are configurable. Search and Gmail settings take precedence over the general website link setting. These settings never turn off navigation protection.

## Sync and backup

All decisions, reasons, dates, and preferences live in `chrome.storage.sync`. Enable extension synchronization in Chrome on both installations, using the same Google account. This manifest includes a fixed public key so unpacked installations share an extension ID; retain that key. If publishing to the Chrome Web Store, use the store-assigned key and coordinate migration before distributing a different ID.

Chrome decides when to synchronize. When Sync is disabled, the storage API still works locally but changes won't reach other installations. The extension can't certify remote delivery. No two-account/device Sync test was performed in development; test your own installations before relying on it as your only backup. Export JSON periodically. Backups contain your private reasons; keep them somewhere appropriate.

Import validates every entry before writing, supports merge or replace, and deduplicates domains using the last backup record. A merge updates duplicate domains from the backup. A replace unblocks missing domains. Preferences are exported for reference; import restores sites only. Clear-all requires confirmation and preserves deletion markers.

## Development

Node 22+ and npm:

```sh
npm ci
npm run check
npx playwright install chromium
npm run test:browser
```

`npm run check` runs strict TypeScript checks, ESLint, unit tests, and the build. `npm run format` formats source and configuration. The browser test loads the actual unpacked extension into Chromium, exercises the dashboard, DNR redirect, saved reason, Visit Anyway, reloads and tab isolation, dynamic link insertion, Google redirect unwrapping, link settings, click warnings, and deletion. It writes screenshots to `artifacts/`.

Gmail integration is generic anchor processing in its dynamically rendered DOM; no Gmail account or email contents are needed. Gmail controls without matching HTTP anchors are untouched. Authenticated live Gmail and live Google Search layout variants require manual verification; automated tests use representative links and dynamic DOM fixtures.

## Architecture and security

- `src/core.ts`: validated schemas, PSL domain handling, matching, local redirect resolution, backup parsing, declarative rules.
- `src/background.ts`: serialized mutations, sync storage, rule reconciliation, context menus, temporary tab-scoped allowances.
- `src/content.ts`: isolated-world anchor treatment, delegated clicks, batched mutation processing (300 anchors per task).
- `src/ui.ts`: popup, dashboard, and warning, using safe DOM creation and textContent.

No analytics, telemetry, advertisements, remote code, accounts, backend, or runtime network requests. The browser of course makes requests when you choose to visit a website. No email text is read or stored. Only link URLs are inspected locally. No history is collected; temporary bypass state contains an exact destination in a Chrome session rule, not synchronized storage.

Permissions: storage for sync and operational error state; activeTab for the popup's current URL; contextMenus for add shortcuts; declarativeNetRequestWithHostAccess for redirects; alarms for bypass expiration. HTTP/HTTPS host access is necessary to redirect arbitrary blocked publications and treat links across websites. No tabs, history, webRequest, scripting, or remote service permissions. Broad host access necessarily produces Chrome's site-access warning. CSP allows only bundled scripts; no eval, inline scripts, or untrusted HTML.

See [ARCHITECTURE.md](ARCHITECTURE.md) for conflict handling, quotas, and browser limitations.

## License

MIT. Contributions welcome; run checks and browser tests before opening a pull request.
