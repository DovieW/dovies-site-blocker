import {
  destination,
  find,
  live,
  settings,
  type Entry,
  defaults,
} from "./core";
let entries: Entry[] = [];
let prefs = defaults;
const tracked = new Map<HTMLAnchorElement, { title: string | null }>();
const style = document.createElement("style");
style.textContent =
  '.dovie-mark{opacity:.48!important;text-decoration:line-through!important}.dovie-mark::after{content:" ⊘";font-size:.8em}.dovie-hide{display:none!important}';
(document.head || document.documentElement).append(style);
function enabled() {
  if (location.hostname === "mail.google.com") return prefs.gmail;
  if (
    /^www\.google\.[a-z.]+$/.test(location.hostname) &&
    location.pathname === "/search"
  )
    return prefs.search;
  return prefs.links;
}
function restore(a: HTMLAnchorElement) {
  const old = tracked.get(a);
  a.classList.remove("dovie-mark", "dovie-hide");
  if (old) {
    if (old.title === null) a.removeAttribute("title");
    else a.title = old.title;
    tracked.delete(a);
  }
}
function process(a: HTMLAnchorElement) {
  const url = destination(a.href);
  const e = url && enabled() ? find(entries, url) : undefined;
  if (!e) {
    restore(a);
    return;
  }
  if (!tracked.has(a)) tracked.set(a, { title: a.getAttribute("title") });
  a.classList.toggle("dovie-mark", prefs.mode === "mark");
  a.classList.toggle("dovie-hide", prefs.mode === "hide");
  if (prefs.mode !== "warn" && prefs.hover)
    a.title = `Previously blocked: ${e.domain}${e.reason ? " — " + e.reason : ""}`;
  else {
    const t = tracked.get(a)!.title;
    if (t === null) a.removeAttribute("title");
    else a.title = t;
  }
}
const pending = new Set<Element>();
const anchors = new Set<HTMLAnchorElement>();
let timer: number | undefined;
function schedule(el: Element) {
  pending.add(el);
  if (timer === undefined) timer = window.setTimeout(flush, 40);
}
function flush() {
  timer = undefined;
  for (const root of pending) {
    pending.delete(root);
    if (root instanceof HTMLAnchorElement) anchors.add(root);
    for (const a of root.querySelectorAll<HTMLAnchorElement>("a[href]"))
      anchors.add(a);
  }
  let count = 0;
  for (const a of anchors) {
    anchors.delete(a);
    if (a.isConnected) process(a);
    if (++count >= 300) break;
  }
  if (anchors.size) timer = window.setTimeout(flush, 16);
  for (const a of tracked.keys()) if (!a.isConnected) tracked.delete(a);
}
async function load() {
  const data = await chrome.storage.sync.get(null);
  entries = live(data);
  prefs = settings(data);
  schedule(document.documentElement);
}
chrome.storage.onChanged.addListener((_c, area) => {
  if (area === "sync") void load();
});
new MutationObserver((records) => {
  for (const r of records) {
    if (r.type === "attributes") schedule(r.target as Element);
    for (const n of r.addedNodes) if (n instanceof Element) schedule(n);
  }
}).observe(document.documentElement, {
  childList: true,
  subtree: true,
  attributes: true,
  attributeFilter: ["href"],
});
function intercept(event: MouseEvent) {
  if (event.type === "auxclick" && event.button !== 1) return;
  const a = event.composedPath().find((n) => n instanceof HTMLAnchorElement) as
    HTMLAnchorElement | undefined;
  if (!a || !enabled()) return;
  const url = destination(a.href);
  if (!url || !find(entries, url)) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  void chrome.runtime.sendMessage({
    type: "warning",
    url,
    newTab:
      event.ctrlKey ||
      event.metaKey ||
      event.shiftKey ||
      event.button === 1 ||
      a.target === "_blank",
  });
}
window.addEventListener("click", intercept, true);
window.addEventListener("auxclick", intercept, true);
void load();
