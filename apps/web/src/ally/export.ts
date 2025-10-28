import { db, getSetting } from "@/db";
import type { Identity, LibraryItem, Status } from "@tracker/core";
import { canonicalPlatform } from "@tracker/core";
import type {
  ExportAchievements,
  ExportHeader,
  ExportLibrary,
  ExportPrices,
  ExportProfile,
  ExportIdentity,
  ExportLibraryItem,
} from "@tracker/core/src/ally/schemas";
import { allyWriteExport } from "@/desktop/allyBridge";

const SCHEMA_VERSION = 1 as const;
const LABEL_DEFAULT = "my_library" as const;

function header(): ExportHeader {
  return { schemaVersion: SCHEMA_VERSION, generatedAtISO: new Date().toISOString() };
}

function mapStatus(status?: Status): ExportLibraryItem["status"] {
  if (!status) return undefined;
  switch (status) {
    case "Backlog":
      return "backlog";
    case "Playing":
      return "playing";
    case "Beaten":
      return "finished";
    case "Abandoned":
      return "dropped";
    case "Wishlist":
      return "wishlist";
    case "Owned":
      return "owned";
    default:
      return undefined;
  }
}

function mapTtbSource(source?: Identity["ttbSource"]): ExportIdentity["ttbSource"] {
  switch (source) {
    case "hltb":
    case "hltb-cache":
    case "hltb-local":
      return "hltb-vendor";
    case "html":
      return "hltb-live";
    case "rawg":
      return "rawg";
    default:
      return null;
  }
}

function mapCriticSource(source?: Identity["criticScoreSource"]): ExportIdentity["criticScoreSource"] {
  switch (source) {
    case "metacritic":
      return "mc-vendor";
    case "opencritic":
      return "oc";
    case "rawg":
      return "rawg-mc";
    default:
      return null;
  }
}

function toIso(input?: string | null): string | undefined {
  if (!input) return undefined;
  const date = new Date(input);
  if (Number.isNaN(date.getTime())) return undefined;
  return date.toISOString();
}

function sizeToMb(value?: number | null): number | undefined {
  if (value == null || !Number.isFinite(value)) return undefined;
  const mb = value / (1024 * 1024);
  return Math.round(mb * 100) / 100;
}

export async function exportLibrary(label: string = LABEL_DEFAULT) {
  const [identities, libraryItems] = await Promise.all([
    db.identities.toArray(),
    db.library.toArray(),
  ]);

  const itemsByIdentity = new Map<string, LibraryItem[]>();
  for (const item of libraryItems) {
    const bucket = itemsByIdentity.get(item.identityId);
    if (bucket) {
      bucket.push(item);
    } else {
      itemsByIdentity.set(item.identityId, [item]);
    }
  }

  const exportIdentities: ExportIdentity[] = identities.map((identity) => {
    const items = itemsByIdentity.get(identity.id) ?? [];
    const primary = items[0];
    const services = new Set<string>();
    for (const entry of items) {
      (entry.services ?? []).forEach((svc) => services.add(svc));
    }

    const criticSource = mapCriticSource(identity.criticScoreSource);
    const criticScore = (() => {
      switch (criticSource) {
        case "mc-vendor":
          return identity.mcScore ?? null;
        case "oc":
          return identity.ocScore ?? null;
        case "rawg-mc":
          return identity.mcScore ?? identity.ocScore ?? null;
        default:
          return null;
      }
    })();

    return {
      identityId: identity.id,
      title: identity.title,
      platform: canonicalPlatform(identity.platform ?? undefined),
      appid: identity.appid,
      services: services.size ? Array.from(services) : undefined,
      tags: undefined,
      releaseYear: undefined,
      installed: items.some((entry) => Boolean(entry.installed)),
      installDir: primary?.installDir ?? primary?.installPath ?? undefined,
      sizeOnDiskMB: sizeToMb(primary?.sizeOnDisk ?? null),
      price: primary?.priceTRY ?? null,
      currencyCode: primary?.currencyCode ?? null,
      ttbMainH: identity.ttbMedianMainH ?? primary?.ttbMedianMainH ?? null,
      ttbSource: mapTtbSource(identity.ttbSource),
      criticScore,
      criticScoreSource: criticSource,
      ocScoreRaw: identity.ocScore ?? null,
      mcScoreRaw: identity.mcScore ?? null,
      rawgId: identity.rawgId ?? null,
      rawgSlug: identity.rawgSlug ?? null,
    } satisfies ExportIdentity;
  });

  const exportLibraryItems: ExportLibraryItem[] = libraryItems.map((item) => ({
    id: item.id,
    identityId: item.identityId,
    acquiredAtISO: toIso(item.acquiredAt ?? null) ?? undefined,
    status: mapStatus(item.status),
    playtimeForeverMin: item.playtimeForeverMin ?? null,
    playtime2WMin: item.playtimeTwoWeeksMin ?? null,
    lastPlayedAtISO: toIso(item.lastPlayedAtISO ?? null),
    price: item.priceTRY ?? null,
    currencyCode: item.currencyCode ?? null,
  }));

  const payload: ExportLibrary = {
    ...header(),
    identities: exportIdentities,
    libraryItems: exportLibraryItems,
  };
  const json = JSON.stringify(payload, null, 2);
  const bytes = await allyWriteExport(label, "library.json", json);
  return { file: "library.json", bytes };
}

export async function exportAchievements(label: string = LABEL_DEFAULT) {
  const rows = await db.steamAchievements.toArray();
  const byApp = new Map<string, { data: ExportAchievements["byApp"][string]; fetched: number }>();

  for (const row of rows) {
    const key = String(row.appid);
    const fetched = row.lastFetchedISO ? Date.parse(row.lastFetchedISO) : 0;
    const recent = (row.items ?? []).slice(0, 10).map((item) => ({
      apiName: item.apiName,
      achieved: Boolean(item.achieved),
      unlockTimeISO:
        item.unlockTime != null && Number.isFinite(item.unlockTime)
          ? new Date((item.unlockTime ?? 0) * 1000).toISOString()
          : undefined,
    }));

    const record = {
      unlocked: row.unlocked,
      total: row.total,
      recent: recent.length ? recent : undefined,
    };

    const existing = byApp.get(key);
    if (!existing || fetched > existing.fetched) {
      byApp.set(key, { data: record, fetched });
    }
  }

  const payload: ExportAchievements = {
    ...header(),
    byApp: Object.fromEntries(Array.from(byApp.entries()).map(([appid, value]) => [appid, value.data])),
  };

  const json = JSON.stringify(payload, null, 2);
  const bytes = await allyWriteExport(label, "achievements.json", json);
  return { file: "achievements.json", bytes };
}

export async function exportPrices(label: string = LABEL_DEFAULT) {
  const rows = await db.steamPrices.toArray();
  const byApp: Record<string, ExportPrices["byApp"][string]> = {};

  for (const row of rows) {
    const key = String(row.appid);
    byApp[key] = {
      price: Number.isFinite(row.final) ? row.final / 100 : null,
      currency: row.currency ?? null,
      discountPercent: Number.isFinite(row.discountPercent) ? row.discountPercent : null,
      lastFetchedISO: row.lastFetchedISO ?? null,
    };
  }

  const payload: ExportPrices = { ...header(), byApp };
  const json = JSON.stringify(payload, null, 2);
  const bytes = await allyWriteExport(label, "prices.json", json);
  return { file: "prices.json", bytes };
}

export async function exportProfile(label: string = LABEL_DEFAULT) {
  const [region, language, availableMinutes, preferredGenres, sliders] = await Promise.all([
    getSetting<string>("steam.region"),
    getSetting<string>("steam.lang"),
    getSetting<number>("profile.availableMinutes"),
    getSetting<string[]>("profile.preferredGenres"),
    getSetting<Record<string, number>>("profile.sliders"),
  ]);

  const payload: ExportProfile = {
    ...header(),
    regionCC: region ?? undefined,
    language: language ?? undefined,
    availableMinutes: availableMinutes ?? undefined,
    preferredGenres: preferredGenres ?? [],
    sliders: sliders ?? {},
  };

  const json = JSON.stringify(payload, null, 2);
  const bytes = await allyWriteExport(label, "profile.json", json);
  return { file: "profile.json", bytes };
}

export async function exportAll(label: string = LABEL_DEFAULT) {
  const results = [] as Array<{ file: string; bytes: number }>;
  results.push(await exportLibrary(label));
  results.push(await exportAchievements(label));
  results.push(await exportPrices(label));
  results.push(await exportProfile(label));
  return results;
}
