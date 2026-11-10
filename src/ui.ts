import {
  domain,
  suggested,
  find,
  type Entry,
  type Settings,
  defaults,
} from "./core";
const app = document.querySelector<HTMLElement>("#app")!;
const page = document.body.dataset.page;
let entries: Entry[] = [];
let prefs: Settings = defaults;
let data: Record<string, unknown> = {};
let tab: chrome.tabs.Tab | undefined;
function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  text?: string,
  parent: HTMLElement = app,
) {
  const e = document.createElement(tag);
  if (text) e.textContent = text;
  parent.append(e);
  return e;
}
function button(
  text: string,
  action: () => void | Promise<void>,
  parent = app,
  cls = "",
) {
  const b = el("button", text, parent);
  b.className = cls;
  b.type = "button";
  b.onclick = () => {
    b.disabled = true;
    Promise.resolve()
      .then(action)
      .catch(error)
      .finally(() => {
        b.disabled = false;
      });
  };
  return b;
}
function error(e: unknown) {
  document.querySelector("#status")!.textContent = String(
    e instanceof Error ? e.message : e,
  );
}
async function call(type: string, args: Record<string, unknown> = {}) {
  const r = await chrome.runtime.sendMessage({ type, ...args });
  if (!r.ok) throw Error(r.error);
  return r.value;
}
function input(
  label: string,
  value: string,
  parent: HTMLElement = app,
  tag: "input" | "textarea" = "input",
) {
  const l = el("label", label, parent);
  const i = el(tag, undefined, parent);
  i.value = value;
  i.id = crypto.randomUUID();
  l.htmlFor = i.id;
  return i;
}
function check(text: string, value: boolean, parent: HTMLElement) {
  const l = el("label", undefined, parent);
  l.className = "check";
  const i = el("input", undefined, l);
  i.type = "checkbox";
  i.checked = value;
  l.append(document.createTextNode(text));
  return i;
}
function select<T extends string>(
  label: string,
  values: T[],
  value: T,
  parent: HTMLElement,
) {
  const l = el("label", label, parent);
  const s = el("select", undefined, parent);
  s.id = crypto.randomUUID();
  l.htmlFor = s.id;
  for (const v of values) {
    const o = el(
      "option",
      v === "warn" ? "Warn on click" : v[0].toUpperCase() + v.slice(1),
      s,
    );
    o.value = v;
  }
  s.value = value;
  return s;
}
async function load() {
  const s = await call("snapshot");
  entries = s.entries;
  prefs = s.settings;
  data = s.data;
  document.body.dataset.theme = prefs.theme;
}
function editor(parent: HTMLElement, dom: string, entry?: Entry) {
  const d = input("Website domain", entry?.domain || dom, parent);
  d.disabled = !!entry;
  const reason = input(
    "Your reason (optional)",
    entry?.reason || "",
    parent,
    "textarea",
  );
  reason.maxLength = 500;
  const sub = check("Include subdomains", entry?.sub ?? prefs.sub, parent);
  const actions = el("div", undefined, parent);
  actions.className = "actions";
  button(
    entry ? "Save changes" : "Block This Site",
    async () => {
      const host = domain(d.value);
      await call("save", {
        entry: {
          v: 1,
          domain: host,
          reason: reason.value.trim(),
          sub: sub.checked,
          at: entry?.at || Date.now(),
          gen: entry?.gen || data[`d:${host}`] || "",
        },
      });
      await render();
    },
    actions,
    "primary",
  );
  if (entry)
    button(
      "Unblock",
      async () => {
        await call("remove", { domain: entry.domain });
        await render();
      },
      actions,
    );
}
async function warning() {
  let url: string;
  try {
    url = new URL(location.hash.slice(1)).href;
  } catch {
    el("h1", "This destination is unavailable.");
    return;
  }
  const e = find(entries, url);
  el("div", "Dovie’s Site Blocker").className = "brand";
  el("div", "⊘").className = "symbol";
  el("h1", e ? "You already chose to skip this." : "Your list has changed.");
  el(
    "p",
    e
      ? `You unsubscribed from ${e.domain}. This is a reminder of your own decision.`
      : "This website is no longer on your blocked list.",
  );
  if (e?.reason) el("blockquote", e.reason);
  if (e) el("small", `Blocked ${new Date(e.at).toLocaleString()}`);
  el("p", new URL(url).hostname).className = "muted";
  const actions = el("div");
  actions.className = "actions";
  button(
    "Go Back",
    () => {
      if (history.length > 1) history.back();
      else window.close();
    },
    actions,
    "primary",
  );
  button(
    "Visit Anyway",
    async () => {
      if (e) await call("bypass", { url });
      else location.replace(url);
    },
    actions,
  );
  if (e)
    button(
      "Unblock Site",
      async () => {
        await call("remove", { domain: e.domain });
        location.replace(url);
      },
      actions,
    );
  el(
    "p",
    "Visit Anyway allows this exact address in this tab for five minutes. Your decision stays saved.",
  );
}
async function popup() {
  [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  el("div", "Dovie’s Site Blocker").className = "brand";
  let dom = "";
  try {
    dom = suggested(tab?.url || "");
  } catch {
    /* Restricted page. */
  }
  const entry = tab?.url ? find(entries, tab.url) : undefined;
  el("h1", entry?.domain || dom || "Your attention, your choice.");
  el(
    "p",
    entry
      ? "You have unsubscribed from this website."
      : dom
        ? "Make one decision. Remember it everywhere."
        : "Open a website to unsubscribe from it.",
  );
  if (dom) editor(app, dom, entry);
  button("Manage blocked sites", () => chrome.runtime.openOptionsPage());
  el(
    "p",
    `${entries.length} blocked ${entries.length === 1 ? "website" : "websites"} · Chrome Sync storage`,
  );
}
async function options() {
  el("div", "Dovie’s Site Blocker").className = "brand";
  el("h1", "An unsubscribe list for the web.");
  el(
    "p",
    `${entries.length} ${entries.length === 1 ? "website" : "websites"} you’ve decided ${entries.length === 1 ? "isn’t" : "aren’t"} worth your attention.`,
  );
  const add = el("details");
  if (location.hash) add.open = true;
  el("summary", "Add a website", add);
  let initial = "";
  try {
    initial = suggested(decodeURIComponent(location.hash.slice(1)));
  } catch {
    /* Empty manual form. */
  }
  editor(add, initial);
  const list = el("section");
  el("h2", "Your websites", list);
  const row = el("div", undefined, list);
  row.className = "row";
  const search = input("Search domains and reasons", "", row);
  const sort = select("Sort", ["newest", "oldest", "domain"], "newest", row);
  const items = el("div", undefined, list);
  function draw() {
    items.replaceChildren();
    const visible = entries
      .filter((e) =>
        (e.domain + " " + e.reason)
          .toLowerCase()
          .includes(search.value.toLowerCase()),
      )
      .sort((a, b) =>
        sort.value === "domain"
          ? a.domain.localeCompare(b.domain)
          : sort.value === "oldest"
            ? a.at - b.at
            : b.at - a.at,
      );
    if (!visible.length)
      el(
        "p",
        entries.length
          ? "No matching websites."
          : "Nothing here yet. Add a website you’re ready to stop reading.",
        items,
      );
    for (const e of visible) {
      const card = el("div", undefined, items);
      card.className = "site";
      const copy = el("div", undefined, card);
      el("strong", e.domain, copy);
      if (e.reason) el("p", e.reason, copy);
      el(
        "small",
        `${new Date(e.at).toLocaleDateString()} · ${e.sub ? "Includes subdomains" : "Exact domain"}`,
        copy,
      );
      const actions = el("div", undefined, card);
      button(
        "Edit",
        () => {
          card.replaceChildren();
          editor(card, e.domain, e);
        },
        actions,
      );
      button(
        "Delete",
        async () => {
          await call("remove", { domain: e.domain });
          await render();
        },
        actions,
      );
    }
  }
  search.oninput = draw;
  sort.onchange = draw;
  draw();
  const section = el("section");
  el("h2", "Preferences", section);
  const mode = select(
    "Link treatment",
    ["mark", "hide", "warn"],
    prefs.mode,
    section,
  );
  const theme = select(
    "Appearance",
    ["system", "light", "dark"],
    prefs.theme,
    section,
  );
  const checks = Object.fromEntries(
    (["sub", "gmail", "search", "links", "hover"] as const).map((key, i) => [
      key,
      check(
        [
          "Include subdomains by default",
          "Treat links in Gmail",
          "Treat Google Search links",
          "Treat links on other websites",
          "Show saved reasons on hover",
        ][i],
        prefs[key],
        section,
      ),
    ]),
  ) as Record<"sub" | "gmail" | "search" | "links" | "hover", HTMLInputElement>;
  button(
    "Save preferences",
    async () => {
      await call("settings", {
        settings: {
          ...prefs,
          mode: mode.value,
          theme: theme.value,
          ...Object.fromEntries(
            Object.entries(checks).map(([k, v]) => [k, v.checked]),
          ),
        },
      });
      await render();
    },
    section,
    "primary",
  );
  el(
    "p",
    "Navigation blocking always stays active. Link settings control how destinations appear on pages.",
    section,
  );
  const backup = el("section");
  el("h2", "Backup & restore", backup);
  button(
    "Export JSON",
    () => {
      const blob = new Blob(
        [JSON.stringify({ version: 1, entries, settings: prefs }, null, 2)],
        { type: "application/json" },
      );
      const url = URL.createObjectURL(blob);
      const a = el("a");
      a.href = url;
      a.download = "dovies-site-blocker.json";
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    },
    backup,
  );
  const file = input(
    "Import a version 1 JSON backup",
    "",
    backup,
  ) as HTMLInputElement;
  file.type = "file";
  file.accept = ".json,application/json";
  const method = select(
    "Import behavior",
    ["merge", "replace"],
    "merge",
    backup,
  );
  button(
    "Import sites",
    async () => {
      if (!file.files?.[0]) throw Error("Choose a JSON backup first.");
      if (file.files[0].size > 300000) throw Error("Backup is too large.");
      if (
        method.value === "replace" &&
        !confirm("Replace all currently blocked sites with this backup?")
      )
        return;
      await call("import", {
        raw: await file.files[0].text(),
        replace: method.value === "replace",
      });
      await render();
    },
    backup,
  );
  el(
    "p",
    "Import restores websites and reasons; preferences stay as currently configured. Duplicate domains use the last entry in the backup.",
    backup,
  );
  button(
    "Clear all blocked websites",
    async () => {
      if (
        confirm(
          "Unblock every website? Export a backup first if you may want them later.",
        )
      ) {
        await call("clear");
        await render();
      }
    },
    backup,
    "danger",
  );
  el(
    "p",
    "Private by design. No accounts, analytics, or external services. Chrome handles synchronization; it may be delayed or disabled in browser settings.",
  );
}
async function render() {
  await load();
  app.replaceChildren();
  const status = el("p");
  status.id = "status";
  status.setAttribute("role", "status");
  if (page === "warning") await warning();
  else if (page === "popup") await popup();
  else await options();
  const operational = await chrome.storage.local.get("error");
  if (operational.error)
    error("Navigation rules need attention: " + operational.error);
}
let syncTimer: number | undefined;
chrome.storage.onChanged.addListener((_c, area) => {
  if (area !== "sync") return;
  window.clearTimeout(syncTimer);
  syncTimer = window.setTimeout(() => {
    const editing =
      document.activeElement instanceof HTMLInputElement ||
      document.activeElement instanceof HTMLTextAreaElement ||
      document.activeElement instanceof HTMLSelectElement;
    if (editing && page !== "warning") {
      const status = document.querySelector<HTMLElement>("#status");
      if (status) {
        status.replaceChildren();
        status.append(
          document.createTextNode("Your synchronized list changed. "),
        );
        button("Load latest changes", render, status);
      }
    } else void render().catch(error);
  }, 150);
});
void render().catch(error);
