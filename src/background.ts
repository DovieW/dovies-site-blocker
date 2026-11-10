import {
  domain,
  live,
  settings,
  rules,
  webURL,
  validateEntry,
  importEntries,
} from "./core";
let queue = Promise.resolve();
function serial<T>(f: () => Promise<T>): Promise<T> {
  const p = queue.then(f);
  queue = p.then(
    () => {},
    () => {},
  );
  return p;
}
async function snapshot() {
  const data = await chrome.storage.sync.get(null);
  return { data, entries: live(data), settings: settings(data) };
}
async function reconcile() {
  const s = await snapshot();
  const old = await chrome.declarativeNetRequest.getDynamicRules();
  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: old.map((r) => r.id),
    addRules: rules(s.entries, chrome.runtime.getURL("warning.html")),
  });
  await chrome.storage.local.remove("error");
}
async function write(patch: Record<string, unknown>) {
  const data = await chrome.storage.sync.get(null);
  const merged = { ...data, ...patch };
  // Reserve enough room to delete every active site even at capacity.
  const projected = { ...merged };
  for (const e of live(merged))
    if (!projected[`d:${e.domain}`])
      projected[`d:${e.domain}`] = "x".repeat(36);
  if (
    Object.keys(projected).length > 490 ||
    new TextEncoder().encode(JSON.stringify(projected)).length > 95000
  )
    throw Error(
      "Chrome Sync is nearly full. Export a backup before adding more sites. Deletion markers are retained for safety.",
    );
  await chrome.storage.sync.set(patch);
  await reconcile();
}
async function save(raw: unknown) {
  const input = validateEntry(raw);
  const s = await snapshot();
  const existing = s.entries.find((e) => e.domain === input.domain);
  if (!existing && s.entries.length >= 200)
    throw Error("Maximum 200 sites. Export and remove unused entries.");
  if (existing && input.gen !== existing.gen)
    throw Error("This site changed on another device. Refresh and try again.");
  const tomb = s.data[`d:${input.domain}`] || "";
  if (!existing && input.gen !== tomb)
    throw Error("This site was deleted. Refresh before adding it again.");
  await write({ [`e:${input.domain}`]: { ...input, gen: tomb } });
}
async function remove(dom: string) {
  await write({ [`d:${domain(dom)}`]: crypto.randomUUID() });
}
async function bypass(url: string, tabId: number) {
  const u = webURL(url).href;
  const id = 100000 + tabId;
  await chrome.declarativeNetRequest.updateSessionRules({
    removeRuleIds: [id],
    addRules: [
      {
        id,
        priority: 10,
        action: { type: chrome.declarativeNetRequest.RuleActionType.ALLOW },
        condition: {
          tabIds: [tabId],
          regexFilter: `^${u.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`,
          resourceTypes: [chrome.declarativeNetRequest.ResourceType.MAIN_FRAME],
        },
      },
    ],
  });
  await chrome.alarms.create(`bypass:${id}`, { when: Date.now() + 300000 });
  await chrome.tabs.update(tabId, { url: u });
}
chrome.runtime.onMessage.addListener((msg, sender, respond) => {
  const trusted =
    sender.url?.startsWith(chrome.runtime.getURL("")) &&
    !sender.url?.startsWith(chrome.runtime.getURL("warning.html"));
  serial(async () => {
    if (msg.type === "snapshot") return snapshot();
    if (msg.type === "warning") {
      const url = webURL(msg.url).href;
      const warning = chrome.runtime.getURL("warning.html") + "#" + url;
      if (msg.newTab) await chrome.tabs.create({ url: warning });
      else if (sender.tab?.id !== undefined)
        await chrome.tabs.update(sender.tab.id, { url: warning });
      return;
    }
    if (msg.type === "bypass") {
      if (
        !sender.url?.startsWith(chrome.runtime.getURL("warning.html")) ||
        sender.tab?.id === undefined
      )
        throw Error("Bypass must be requested from the warning page.");
      return bypass(msg.url, sender.tab.id);
    }
    if (
      msg.type === "remove" &&
      (trusted || sender.url?.startsWith(chrome.runtime.getURL("warning.html")))
    )
      return remove(msg.domain);
    if (!trusted)
      throw Error("This action is only available in the extension dashboard.");
    if (msg.type === "save") return save(msg.entry);
    if (msg.type === "settings") {
      const checked = settings(
        Object.fromEntries(
          Object.entries(msg.settings).map(([k, v]) => [`s:${k}`, v]),
        ),
      );
      return write(
        Object.fromEntries(
          Object.entries(checked).map(([k, v]) => [`s:${k}`, v]),
        ),
      );
    }
    if (msg.type === "import") {
      const entries = importEntries(msg.raw);
      const s = await snapshot();
      const patch: Record<string, unknown> = {};
      if (msg.replace)
        for (const e of s.entries)
          if (!entries.some((n) => n.domain === e.domain))
            patch[`d:${e.domain}`] = crypto.randomUUID();
      for (const e of entries)
        patch[`e:${e.domain}`] = { ...e, gen: s.data[`d:${e.domain}`] || "" };
      if (live({ ...s.data, ...patch }).length > 200)
        throw Error("The combined list exceeds 200 sites.");
      return write(patch);
    }
    if (msg.type === "clear") {
      const s = await snapshot();
      return write(
        Object.fromEntries(
          s.entries.map((e) => [`d:${e.domain}`, crypto.randomUUID()]),
        ),
      );
    }
    throw Error("Unknown action");
  }).then(
    (value) => respond({ ok: true, value }),
    (error) => respond({ ok: false, error: String(error.message || error) }),
  );
  return true;
});
function refresh() {
  void serial(reconcile).catch((e) =>
    chrome.storage.local.set({ error: String(e) }),
  );
}
chrome.storage.onChanged.addListener((_changes, area) => {
  if (area === "sync") refresh();
});
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: "site",
      title: "Unsubscribe from this website",
      contexts: ["page"],
    });
    chrome.contextMenus.create({
      id: "link",
      title: "Unsubscribe from link destination",
      contexts: ["link"],
    });
  });
  refresh();
});
chrome.runtime.onStartup.addListener(refresh);
chrome.contextMenus.onClicked.addListener((info) => {
  void chrome.tabs.create({
    url:
      chrome.runtime.getURL("options.html") +
      "#" +
      encodeURIComponent(info.linkUrl || info.pageUrl || ""),
  });
});
chrome.alarms.onAlarm.addListener((a) => {
  if (a.name.startsWith("bypass:"))
    void chrome.declarativeNetRequest.updateSessionRules({
      removeRuleIds: [Number(a.name.slice(7))],
    });
});
chrome.tabs.onRemoved.addListener((id) => {
  void chrome.declarativeNetRequest.updateSessionRules({
    removeRuleIds: [100000 + id],
  });
  void chrome.alarms.clear(`bypass:${100000 + id}`);
});
refresh();
