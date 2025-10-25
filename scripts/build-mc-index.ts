import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseCsvStream, sniffCsv } from "./csv/smartCsv";
import { canonicalPlatform } from "../packages/core/src/data/platforms";
import { normalizeTitle } from "../packages/core/src/data/normalizeTitle";

type MCValue = {
  score: number;
  platform?: string;
  url?: string;
  year?: number;
  genres?: string;
};

type Candidate = {
  key: string;
  score: number;
  canonicalPlatform: string;
  url?: string;
  year?: number;
  genres?: string[];
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");
const INPUT = path.resolve(ROOT, "apps/web/public/hookdata/games.csv");
const OUTPUT = path.resolve(ROOT, "apps/web/public/hookdata/metacritic.index.json");

const COLUMN_ALIASES: Record<string, string[]> = {
  title: ["title", "name"],
  platform: ["platform", "platform_name", "system"],
  score: ["metascore", "score", "metacritic"],
  url: ["url", "link"],
  year: ["year", "release_year", "released", "date"],
  genres: ["genres", "tags"],
};

function readColumn(row: Record<string, string>, key: keyof typeof COLUMN_ALIASES): string | undefined {
  const lookup = COLUMN_ALIASES[key];
  for (const candidate of lookup) {
    const value = row[candidate];
    if (value != null && value !== "") {
      return value.trim();
    }
  }
  return undefined;
}

function parseYear(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const cleaned = value.trim().slice(0, 4);
  const parsed = Number.parseInt(cleaned, 10);
  if (!Number.isFinite(parsed)) return undefined;
  if (parsed < 1970 || parsed > 2100) return undefined;
  return parsed;
}

function parseScore(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const cleaned = value.replace(/[^\d.]/g, "");
  if (!cleaned) return undefined;
  const parsed = Number.parseFloat(cleaned);
  if (!Number.isFinite(parsed)) return undefined;
  return Math.round(parsed);
}

function parseGenres(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(/[;,|]/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function tryParseHost(raw?: string): string | undefined {
  if (!raw) return undefined;
  try {
    const url = new URL(raw);
    return url.hostname.toLowerCase();
  } catch {
    return undefined;
  }
}

function chooseBetter(existing: Candidate, next: Candidate): Candidate {
  if (existing.canonicalPlatform === "unknown" && next.canonicalPlatform !== "unknown") {
    return next;
  }
  if (next.canonicalPlatform === "unknown" && existing.canonicalPlatform !== "unknown") {
    return existing;
  }

  if (next.score > existing.score) return next;
  if (existing.score > next.score) return existing;

  if (next.year != null && existing.year == null) return next;
  if (existing.year != null && next.year == null) return existing;

  if (next.url && !existing.url) return next;
  if (existing.url && !next.url) return existing;

  return existing;
}

async function main() {
  const sampleHead = await fs
    .readFile(INPUT, { encoding: "utf8", flag: "r" })
    .then((buffer) => buffer.slice(0, 128 * 1024));
  const sniff = sniffCsv(sampleHead);
  console.log(
    `[build-mc-index] sniff: delimiter=${sniff.delimiter} bom=${sniff.hasBOM} recordDelimiter=${sniff.recordDelimiter}`,
  );

  const index = new Map<string, Candidate>();
  let processedRows = 0;

  for await (const row of parseCsvStream(INPUT, { columnsCase: "lower", tolerateUnbalancedQuotes: true })) {
    processedRows += 1;
    const titleRaw = readColumn(row, "title");
    const scoreRaw = readColumn(row, "score");
    if (!titleRaw || !scoreRaw) continue;

    const normalizedTitle = normalizeTitle(titleRaw);
    if (!normalizedTitle) continue;

    const urlRaw = readColumn(row, "url");
    const host = tryParseHost(urlRaw);
    const platformRaw = readColumn(row, "platform");
    const platform = canonicalPlatform(platformRaw, host);

    const score = parseScore(scoreRaw);
    if (score == null) continue;

    const year = parseYear(readColumn(row, "year"));
    const genres = parseGenres(readColumn(row, "genres"));

    const key = `${normalizedTitle}|${platform}`;

    const candidate: Candidate = {
      key,
      score,
      canonicalPlatform: platform,
      url: urlRaw || undefined,
      year,
      genres: genres.length ? genres : undefined,
    };

    const existing = index.get(key);
    if (!existing) {
      index.set(key, candidate);
    } else {
      index.set(key, chooseBetter(existing, candidate));
    }
  }

  const finalIndex: Record<string, MCValue> = {};
  for (const [key, value] of index.entries()) {
    finalIndex[key] = {
      score: value.score,
      platform: value.canonicalPlatform !== "unknown" ? value.canonicalPlatform : undefined,
      url: value.url,
      year: value.year,
      genres: value.genres?.join(", "),
    };
  }

  const payload = {
    version: 1,
    generatedAt: new Date().toISOString(),
    count: index.size,
    delimiter: sniff.delimiter,
    bom: sniff.hasBOM,
    index: finalIndex,
  };

  const dir = path.dirname(OUTPUT);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(OUTPUT, JSON.stringify(payload, null, 2), "utf8");

  const stats = await fs.stat(OUTPUT);
  const sizeKb = (stats.size / 1024).toFixed(1);
  console.log(
    `Metacritic index compiled: ${index.size} entries (processed ${processedRows} rows) -> ${path.relative(
      ROOT,
      OUTPUT,
    )} (${sizeKb} kB)`,
  );
}

main().catch((err) => {
  console.error("[build-mc-index] failed:", err);
  process.exit(1);
});
