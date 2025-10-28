import { normalizeTitle } from "./normalizeTitle";

export type SteamIndexEntry = {
  appId: number;
  name: string;
};

export type SteamIndex = {
  byKey: Map<string, number>;
  byId: Map<number, string>;
};

function buildKeyVariants(name: string): string[] {
  const base = normalizeTitle(name);
  if (!base) return [];

  const variants = new Set<string>();
  variants.add(base);

  // Some Steam entries include edition markers inside parentheses.
  const withoutParens = base.replace(/\s*\(.+?\)\s*/g, " ").trim();
  if (withoutParens && withoutParens !== base) {
    variants.add(withoutParens.replace(/\s+/g, " "));
  }

  // Handle subtitles separated by dash.
  const dashIndex = base.indexOf(" - ");
  if (dashIndex > 0) {
    variants.add(base.slice(0, dashIndex).trim());
  }

  return Array.from(variants);
}

export function createSteamIndex(entries: SteamIndexEntry[]): SteamIndex {
  const byKey = new Map<string, number>();
  const byId = new Map<number, string>();
  for (const entry of entries) {
    if (!entry || typeof entry.appId !== "number") continue;
    const name = entry.name ?? "";
    if (!name.trim()) continue;

    byId.set(entry.appId, name);
    const variants = buildKeyVariants(name);
    for (const key of variants) {
      if (!byKey.has(key)) {
        byKey.set(key, entry.appId);
      }
    }
  }
  return { byKey, byId };
}

export function mergeSteamIndex(base: SteamIndex | null, entries: SteamIndexEntry[]): SteamIndex {
  if (!base) return createSteamIndex(entries);
  const merged: SteamIndex = {
    byKey: new Map(base.byKey),
    byId: new Map(base.byId),
  };
  for (const entry of entries) {
    if (!entry || !entry.name?.trim()) continue;
    merged.byId.set(entry.appId, entry.name);
    for (const key of buildKeyVariants(entry.name)) {
      if (!merged.byKey.has(key)) {
        merged.byKey.set(key, entry.appId);
      }
    }
  }
  return merged;
}

export function resolveSteamAppId(index: SteamIndex | null | undefined, title: string): number | null {
  if (!index) return null;
  const key = normalizeTitle(title);
  if (!key) return null;
  return index.byKey.get(key) ?? null;
}

export function getSteamName(index: SteamIndex | null | undefined, appId: number): string | undefined {
  if (!index) return undefined;
  return index.byId.get(appId);
}
