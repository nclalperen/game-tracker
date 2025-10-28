import { canonicalPlatform, normalizeTitle } from "@tracker/core";

export type MCEntry = {
  score: number;
  platform?: string;
  url?: string;
  year?: number;
  genres?: string[];
};

type ShardManifest = Record<string, string>;

type IndexPayload = {
  version: number;
  generatedAt: string;
  count: number;
  delimiter?: string;
  bom?: boolean;
  index?: Record<string, MCEntry>;
  shards?: ShardManifest;
};

const INDEX_URL = "/hookdata/metacritic.index.json";
const SHARD_ROOT = "/hookdata/";
const LRU_LIMIT = 512;

let manifestPromise: Promise<IndexPayload> | null = null;
const shardPromises = new Map<string, Promise<Record<string, MCEntry>>>();
const entryLru = new Map<string, MCEntry>();

function remember(key: string, value: MCEntry) {
  if (entryLru.has(key)) entryLru.delete(key);
  entryLru.set(key, value);
  if (entryLru.size > LRU_LIMIT) {
    const oldest = entryLru.keys().next().value as string | undefined;
    if (oldest) entryLru.delete(oldest);
  }
}

async function fetchJson<T>(url: string): Promise<T> {
  const resp = await fetch(url, { cache: "force-cache" });
  if (!resp.ok) {
    throw new Error(`Failed to load ${url} (${resp.status})`);
  }
  return (await resp.json()) as T;
}

async function ensureManifest(): Promise<IndexPayload> {
  if (!manifestPromise) {
    manifestPromise = fetchJson<IndexPayload>(INDEX_URL).catch((err) => {
      manifestPromise = null;
      throw err;
    });
  }
  return manifestPromise;
}

function resolveShardPath(file: string): string {
  if (file.startsWith("http://") || file.startsWith("https://") || file.startsWith("/")) {
    return file;
  }
  return `${SHARD_ROOT}${file}`;
}

async function ensureShard(bucket: string, file: string): Promise<Record<string, MCEntry>> {
  if (!shardPromises.has(bucket)) {
    shardPromises.set(
      bucket,
      fetchJson<Record<string, MCEntry>>(resolveShardPath(file)).catch((err) => {
        shardPromises.delete(bucket);
        throw err;
      }),
    );
  }
  return shardPromises.get(bucket)!;
}

export async function loadMCIndex(): Promise<Record<string, MCEntry>> {
  const manifest = await ensureManifest();
  if (manifest.index) {
    return manifest.index;
  }
  if (!manifest.shards) {
    return {};
  }

  if (!manifest.index) {
    const aggregate: Record<string, MCEntry> = {};
    const entries = Object.entries(manifest.shards);
    for (const [bucket, file] of entries) {
      const shard = await ensureShard(bucket, file);
      Object.assign(aggregate, shard);
    }
    manifest.index = aggregate;
  }
  return manifest.index ?? {};
}

export async function getMCEntry(key: string): Promise<MCEntry | undefined> {
  if (entryLru.has(key)) {
    const cached = entryLru.get(key)!;
    entryLru.delete(key);
    entryLru.set(key, cached);
    return cached;
  }

  const manifest = await ensureManifest();
  if (manifest.index) {
    const found = manifest.index[key];
    if (found) remember(key, found);
    return found;
  }

  if (!manifest.shards) {
    return undefined;
  }

  const shardId = shardForKey(key);
  const shardPath = manifest.shards[shardId];
  if (!shardPath) {
    return undefined;
  }

  const shard = await ensureShard(shardId, shardPath);
  const found = shard[key];
  if (found) {
    remember(key, found);
  }
  return found;
}

function shardForKey(key: string): string {
  const bucketKey = key.split("|", 1)[0]?.[0]?.toLowerCase() ?? "";
  if (bucketKey >= "a" && bucketKey <= "z") return bucketKey;
  if (bucketKey >= "0" && bucketKey <= "9") return "0";
  return "misc";
}

function tryParseHost(url?: string | null): string | undefined {
  if (!url) return undefined;
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return undefined;
  }
}

export function mcKey(title: string, platform?: string | null, url?: string | null): string {
  const normalized = normalizeTitle(title ?? "");
  const host = tryParseHost(url);
  const canonical = canonicalPlatform(platform ?? undefined, host, undefined);
  return `${normalized}|${canonical}`;
}

export function resetMCIndexCache(): void {
  manifestPromise = null;
  shardPromises.clear();
  entryLru.clear();
}
