import { parse } from "tldts";
export interface Entry {
  v: 1;
  domain: string;
  reason: string;
  sub: boolean;
  at: number;
  gen: string;
}
export interface Settings {
  mode: "mark" | "hide" | "warn";
  sub: boolean;
  gmail: boolean;
  search: boolean;
  links: boolean;
  hover: boolean;
  theme: "system" | "light" | "dark";
}
export const defaults: Settings = {
  mode: "mark",
  sub: true,
  gmail: true,
  search: true,
  links: true,
  hover: true,
  theme: "system",
};
export function webURL(raw: string): URL {
  const u = new URL(raw);
  if (!["http:", "https:"].includes(u.protocol) || u.username || u.password)
    throw Error("Use an HTTP or HTTPS address without credentials.");
  return u;
}
export function domain(raw: string): string {
  const u = webURL(raw.includes("://") ? raw.trim() : `https://${raw.trim()}`);
  const h = u.hostname
    .toLowerCase()
    .replace(/\.$/, "")
    .replace(/^www\./, "");
  const p = parse(h, { allowPrivateDomains: true });
  if (
    !p.domain ||
    p.isIp ||
    !p.publicSuffix ||
    !h.includes(".") ||
    h.length > 253 ||
    !h.split(".").every((x) => /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(x))
  )
    throw Error(
      "Enter a valid website domain, not an IP address or public suffix.",
    );
  return h;
}
export function suggested(raw: string): string {
  const h = domain(raw);
  return parse(h, { allowPrivateDomains: true }).domain || h;
}
export function matches(e: Entry, host: string): boolean {
  host = host
    .toLowerCase()
    .replace(/\.$/, "")
    .replace(/^www\./, "");
  return host === e.domain || (e.sub && host.endsWith(`.${e.domain}`));
}
export function find(entries: Entry[], url: string): Entry | undefined {
  try {
    const h = webURL(url).hostname;
    return entries
      .filter((e) => matches(e, h))
      .sort((a, b) => b.domain.length - a.domain.length)[0];
  } catch {
    return;
  }
}
const googleRedirectHosts = new Set([
  "www.google.com",
  "www.google.co.uk",
  "www.google.ca",
  "www.google.de",
  "www.google.fr",
  "www.google.com.au",
  "www.google.co.in",
  "www.google.co.jp",
  "www.google.es",
  "www.google.it",
  "www.google.nl",
  "www.google.com.br",
]);
export function destination(raw: string, base?: string): string | undefined {
  try {
    let u = webURL(new URL(raw, base).href);
    for (let i = 0; i < 3; i++) {
      let next: string | null = null;
      if (googleRedirectHosts.has(u.hostname) && u.pathname === "/url")
        next = u.searchParams.get("q") || u.searchParams.get("url");
      if (u.hostname === "www.google.com" && u.pathname === "/imgres")
        next = u.searchParams.get("imgrefurl");
      if (!next) break;
      u = webURL(next);
    }
    return u.href;
  } catch {
    return;
  }
}
export function validateEntry(value: unknown): Entry {
  if (!value || typeof value !== "object") throw Error("Invalid entry");
  const e = value as Entry;
  if (
    e.v !== 1 ||
    domain(e.domain) !== e.domain ||
    typeof e.reason !== "string" ||
    e.reason.length > 500 ||
    typeof e.sub !== "boolean" ||
    !Number.isSafeInteger(e.at) ||
    e.at < 0 ||
    typeof e.gen !== "string" ||
    e.gen.length > 100
  )
    throw Error("Invalid entry");
  return e;
}
export function live(data: Record<string, unknown>): Entry[] {
  const out: Entry[] = [];
  for (const [k, v] of Object.entries(data))
    if (k.startsWith("e:")) {
      try {
        const e = validateEntry(v);
        if (k === `e:${e.domain}` && e.gen === (data[`d:${e.domain}`] || ""))
          out.push(e);
      } catch {
        /* Ignore unsupported or damaged records without overwriting them. */
      }
    }
  return out;
}
export function settings(data: Record<string, unknown>): Settings {
  const s = { ...defaults };
  for (const k of Object.keys(s) as (keyof Settings)[]) {
    const v = data[`s:${k}`];
    if (k === "mode" && ["mark", "hide", "warn"].includes(v as string))
      s.mode = v as Settings["mode"];
    else if (k === "theme" && ["system", "light", "dark"].includes(v as string))
      s.theme = v as Settings["theme"];
    else if (typeof s[k] === "boolean" && typeof v === "boolean")
      Object.assign(s, { [k]: v });
  }
  return s;
}
export function importEntries(raw: string): Entry[] {
  const obj = JSON.parse(raw);
  if (
    obj.version !== 1 ||
    !Array.isArray(obj.entries) ||
    obj.entries.length > 200
  )
    throw Error("Expected a version 1 backup with at most 200 sites.");
  const map = new Map<string, Entry>();
  for (const item of obj.entries) {
    const e = validateEntry({ ...item, gen: "" });
    map.set(e.domain, e);
  }
  return [...map.values()];
}
export const escapeRegex = (s: string) =>
  s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
export function rules(
  entries: Entry[],
  warning: string,
): chrome.declarativeNetRequest.Rule[] {
  return entries.map((e, i) => ({
    id: i + 1,
    priority: 1,
    action: {
      type: chrome.declarativeNetRequest.RuleActionType.REDIRECT,
      redirect: { regexSubstitution: `${warning}#\\1` },
    },
    condition: {
      regexFilter: `^(https?://${e.sub ? "([^/]+\\.)?" : "(www\\.)?"}${escapeRegex(e.domain)}\\.?(:[0-9]+)?([/?#].*)?)$`,
      resourceTypes: [chrome.declarativeNetRequest.ResourceType.MAIN_FRAME],
    },
  }));
}
