import { canonicalPlatform, normalizeTitle } from "@tracker/core";

export type MCEntry = {
  score: number;
  platform?: string;
  url?: string;
  year?: number;
  genres?: string;
};

type IndexPayload = {
  version: number;
  generatedAt: string;
  count: number;
  delimiter: string;
  bom: boolean;
  index: Record<string, MCEntry>;
};

let indexPromise: Promise<Record<string, MCEntry>> | null = null;

export async function loadMCIndex(): Promise<Record<string, MCEntry>> {
  if (!indexPromise) {
    indexPromise = fetch("/hookdata/metacritic.index.json", { cache: "force-cache" })
      .then((resp) => {
        if (!resp.ok) {
          throw new Error(`Failed to load Metacritic index (${resp.status})`);
        }
        return resp.json() as Promise<IndexPayload>;
      })
      .then((payload) => payload?.index ?? {})
      .catch((err) => {
        indexPromise = null;
        throw err;
      });
  }
  return indexPromise;
}

function tryParseHost(url?: string): string | undefined {
  if (!url) return undefined;
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return undefined;
  }
}

export function mcKey(title: string, platform?: string | null, url?: string | null): string {
  const normalized = normalizeTitle(title ?? "");
  const host = tryParseHost(url ?? undefined);
  const canonical = canonicalPlatform(platform ?? undefined, host);
  return `${normalized}|${canonical}`;
}

