import Papa from "papaparse";
import { normalizeTitleKey } from "@/utils/normalize";

type HltbRow = {
  game_game_name?: string;
  game_comp_main?: string;
  game_comp_main_count?: string;
  platform_platform?: string;
  game_profile_platform?: string;
};

type MetacriticRow = {
  title?: string;
  platform?: string;
  metascore?: string;
  user_score?: string;
};

type HltbEntry = {
  hours: number;
  count: number;
  platforms: string[];
};

type MetacriticEntry = {
  metascore: number | null;
  userScore: number | null;
  platforms: string[];
};

let hltbLoadPromise: Promise<void> | null = null;
const hltbIndex = new Map<string, HltbEntry[]>();

async function ensureHltbLoaded() {
  if (!hltbLoadPromise) {
    hltbLoadPromise = (async () => {
      const resp = await fetch("/hookdata/hltb_data.csv");
      if (!resp.ok) throw new Error(`Failed to load hltb_data.csv (${resp.status})`);
      const text = await resp.text();
      const parsed = Papa.parse<HltbRow>(text, { header: true, skipEmptyLines: true });
      for (const row of parsed.data) {
        if (!row) continue;
        const title = row.game_game_name?.trim();
        if (!title) continue;
        const norm = normalizeTitleKey(title);
        if (!norm) continue;
        const totalSeconds = Number(row.game_comp_main);
        if (!Number.isFinite(totalSeconds) || totalSeconds <= 0) continue;
        const count = Number(row.game_comp_main_count) || 0;
        const hours = Math.round((totalSeconds / 3600) * 10) / 10;
        const platformRaw = row.platform_platform || row.game_profile_platform || "";
        const platforms = platformRaw
          .split(/[,/]/)
          .map((part) => part.trim().toLowerCase())
          .filter((part): part is string => part.length > 0);
        const entries = hltbIndex.get(norm) ?? [];
        entries.push({ hours, count, platforms });
        hltbIndex.set(norm, entries);
      }
    })();
  }
  return hltbLoadPromise;
}

let metacriticLoadPromise: Promise<void> | null = null;
const metacriticIndex = new Map<string, MetacriticEntry[]>();

async function ensureMetacriticLoaded() {
  if (!metacriticLoadPromise) {
    metacriticLoadPromise = (async () => {
      const resp = await fetch("/hookdata/games.csv");
      if (!resp.ok) throw new Error(`Failed to load games.csv (${resp.status})`);
      const text = await resp.text();
      const parsed = Papa.parse<MetacriticRow>(text, { header: true, skipEmptyLines: true });
      for (const row of parsed.data) {
        if (!row) continue;
        const title = row.title?.trim();
        if (!title) continue;
        const norm = normalizeTitleKey(title);
        if (!norm) continue;
        let metascore: number | null = Number.parseInt(row.metascore ?? "", 10);
        if (!Number.isFinite(metascore)) metascore = null;
        let userScore: number | null = Number.parseFloat(row.user_score ?? "");
        if (!Number.isFinite(userScore)) userScore = null;
        const platforms = (row.platform ?? "")
          .split(/[,/]/)
          .map((part) => part.trim().toLowerCase())
          .filter((part): part is string => part.length > 0);
        const entries = metacriticIndex.get(norm) ?? [];
        entries.push({ metascore, userScore, platforms });
        metacriticIndex.set(norm, entries);
      }
    })();
  }
  return metacriticLoadPromise;
}

function pickBestHltb(entries: HltbEntry[], platform?: string): HltbEntry {
  const target = platform?.toLowerCase();
  let candidates = entries;
  if (target) {
    const filtered = entries.filter((entry) =>
      entry.platforms.some((p) => p.includes(target)),
    );
    if (filtered.length) candidates = filtered;
  }
  return candidates.reduce((best, entry) => {
    if (!best) return entry;
    if (entry.count > best.count) return entry;
    return best;
  });
}

function pickBestMetacritic(entries: MetacriticEntry[], platform?: string): MetacriticEntry {
  const target = platform?.toLowerCase();
  let candidates = entries;
  if (target) {
    const filtered = entries.filter((entry) =>
      entry.platforms.some((p) => p.includes(target)),
    );
    if (filtered.length) candidates = filtered;
  }
  return candidates.reduce((best, entry) => {
    if (!best) return entry;
    const bestScore = best.metascore ?? -Infinity;
    const entryScore = entry.metascore ?? -Infinity;
    if (entryScore > bestScore) return entry;
    return best;
  });
}

export async function lookupLocalHLTB(title: string, platform?: string): Promise<number | null> {
  await ensureHltbLoaded();
  const norm = normalizeTitleKey(title);
  if (!norm) return null;
  const entries = hltbIndex.get(norm);
  if (!entries || entries.length === 0) return null;
  const best = pickBestHltb(entries, platform);
  return best?.hours ?? null;
}

export async function lookupLocalMetacritic(title: string, platform?: string): Promise<{
  metascore: number | null;
  userScore: number | null;
} | null> {
  await ensureMetacriticLoaded();
  const norm = normalizeTitleKey(title);
  if (!norm) return null;
  const entries = metacriticIndex.get(norm);
  if (!entries || entries.length === 0) return null;
  const best = pickBestMetacritic(entries, platform);
  return { metascore: best.metascore ?? null, userScore: best.userScore ?? null };
}


