import type { Identity } from "./types";

/** Simple dedupe by (normalized title, normalized platform) keeping the first. */
export function dedupeIdentities(list: Identity[]): Identity[] {
  const key = (t: string, p?: string) =>
    `${t.trim().toLowerCase()}::${(p ?? "").trim().toLowerCase()}`;
  const seen = new Set<string>();
  const out: Identity[] = [];
  for (const item of list) {
    const k = key(item.title, item.platform);
    if (!seen.has(k)) {
      seen.add(k);
      out.push(item);
    }
  }
  return out;
}
