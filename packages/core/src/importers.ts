import { parseCSV } from "./csv";
import type { LibraryItem, Identity, Platform, Status } from "./types";
import { nanoid } from "./uid";
import { normalizePlatform, normalizeStatus } from "./normalize";

export type IncomingRow = Record<string, string>;
export type FieldMap = {
  title?: string;
  platform?: string;
  status?: string;
  memberId?: string;
  accountId?: string;
  priceTRY?: string;
  acquiredAt?: string;
  ocScore?: string;
  ttbMedianMainH?: string;
  services?: string;
};

export function readCSV(text: string) {
  return parseCSV(text);
}

export function extractTitle(s: string): string {
  if (!s) return "";
  // strip any URLs (e.g., Steam links) first
  const withoutUrl = s.replace(/https?:\/\/\S+/g, "").trim();
  // take the part before common separators (":", "–", "—", "-")
  const first = withoutUrl.split(/\s*[:|\u2013|\u2014|-]\s*/)[0]?.trim();
  return first || withoutUrl;
}

export function detectAccountFromText(
  s?: string
): { label: string; platform: Platform } | undefined {
  if (!s) return;
  const t = s.toLowerCase();
  if (t.includes("store.steampowered.com") || t.includes("steam://")) {
    return { label: "Steam", platform: "PC" };
  }
  return undefined;
}

/** Pull appid from any string field containing a Steam store link */
function extractSteamAppIdFromRow(row: Record<string, unknown>): number | undefined {
  const re = /store\.steampowered\.com\/app\/(\d+)/i;
  for (const v of Object.values(row)) {
    if (typeof v === "string") {
      const m = v.match(re);
      if (m) return Number(m[1]);
    }
  }
  return undefined;
}

export function rowsToEntities(rows: IncomingRow[], map: FieldMap) {
  const identities: Identity[] = [];
  const library: LibraryItem[] = [];
  const idByKey = new Map<string, string>();
  const identityById = new Map<string, Identity>(); // keep reference to update existing

  for (const r of rows) {
    // Title
    const raw = (map.title ? r[map.title] : "")?.trim() || "";
    const title = extractTitle(raw);
    if (!title) continue;

    // Platform
    const platform =
      normalizePlatform(map.platform ? r[map.platform] : undefined) ?? "PC";

    // Identity key (title+platform)
    const key = `${title.toLowerCase()}__${platform}`;
    let identityId = idByKey.get(key);

    // Try to extract Steam appid from this row
    const appid = extractSteamAppIdFromRow(r);

    if (!identityId) {
      identityId = `id-${nanoid()}`;
      const identity: Identity = {
        id: identityId,
        title,
        platform,
        ...(typeof appid === "number" ? { appid } : {}),
      };
      identities.push(identity);
      identityById.set(identityId, identity);
      idByKey.set(key, identityId);
    } else {
      // If the identity already exists and we found an appid, fill it if missing
      const existing = identityById.get(identityId);
      if (existing && typeof appid === "number" && existing.appid == null) {
        existing.appid = appid;
      }
    }

    // Status / member
    const status: Status =
      normalizeStatus(map.status ? r[map.status] : undefined) ?? "Backlog";
    const memberId = (map.memberId ? r[map.memberId] : "")?.trim() || "everyone";

    // Account
    let accountIdText = (map.accountId ? r[map.accountId] : "")?.trim();
    if (!accountIdText) {
      const acc = detectAccountFromText(raw);
      if (acc) accountIdText = acc.label;
    }

    // Numbers & misc
    const priceTRY =
      map.priceTRY && r[map.priceTRY] ? Number(r[map.priceTRY]) : undefined;
    const acquiredAt = map.acquiredAt ? (r[map.acquiredAt] || undefined) : undefined;
    const ocScore =
      map.ocScore && r[map.ocScore] ? Number(r[map.ocScore]) : undefined;
    const ttb =
      map.ttbMedianMainH && r[map.ttbMedianMainH]
        ? Number(r[map.ttbMedianMainH])
        : undefined;
    const services =
      map.services && r[map.services]
        ? (r[map.services]
            .split(/[,;]/)
            .map((s) => s.trim())
            .filter(Boolean) as any[])
        : undefined;

    // Library item
    library.push({
      id: nanoid(),
      identityId,
      accountId: accountIdText || undefined,
      memberId,
      status,
      priceTRY,
      acquiredAt,
      services,
      ocScore,
      ttbMedianMainH: ttb,
    });
  }

  return { identities, library };
}
