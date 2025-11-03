import { allyChat } from "../desktop/allyBridge";
import { getOrCreateSession } from "./session";
import {
  SYSTEM_COACH,
  SYSTEM_DEALS,
  SYSTEM_QA,
  FEWSHOT_RESULTS_ONLY,
  type CoachMode,
  ZReply,
  type Reply,
  extractJsonCandidates,
} from "@tracker/core";

export type AISuggestOptions = {
  allowWeb?: boolean;
  mode?: CoachMode;
  timeboxMin?: number | null;
  mustTags?: string[];
  avoidTags?: string[];
  strictJson?: boolean;
};

export type CandidateFeatures = {
  remainingH: number | null;
  valuePerHour: number | null;
  recencyDays: number | null;
  installed: boolean;
};

export type AICandidate = {
  id: string;
  title: string;
  appid?: number;
  installed?: boolean;
  platform?: string;
  ttbMainH?: number | null;
  criticScore?: number | null;
  price?: number | null;
  currencyCode?: string | null;
  tags?: string[];
  services?: string[];
  status?: string;
  playtimeForeverMin?: number | null;
  lastPlayedAtISO?: string | null;
  discountPercent?: number | null;
  final?: number | null;
  initial?: number | null;
  saleEndISO?: string | null;
  valuePerHour?: number | null;
  wishlist?: boolean;
  features?: CandidateFeatures;
};

export type AIRanked = { id: string; rank: number; reason: string };

export type AIRankedResponse = {
  results: AIRanked[];
  charts?: Reply["charts"];
  notes?: string;
  warning?: string | null;
  rawText: string;
  parsed?: Reply | null;
};

const MAX_CANDIDATES = 50;
const FALLBACK_RESULTS = 10;

function resolveSystem(mode: CoachMode | undefined): string {
  switch (mode) {
    case "deals":
      return SYSTEM_DEALS;
    case "qa":
      return SYSTEM_QA;
    case "coach":
    default:
      return SYSTEM_COACH;
  }
}

function friendlyWarning(message: string): string {
  if (message.startsWith("AI reply failed schema validation")) {
    return "Ally replied, but the format looked off. We repaired what we could; rerun if the picks seem odd.";
  }
  return message;
}

function toNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const numeric = Number.parseFloat(value.replace(/[^0-9.\-]+/g, ""));
    if (Number.isFinite(numeric)) return numeric;
  }
  return null;
}

function formatReason(candidate: AICandidate, game: any): string {
  const parts: string[] = [];
  if (candidate.installed) {
    parts.push("Installed");
  }
  const criticRaw =
    toNumber(game?.critic_score) ??
    toNumber(game?.metacritic) ??
    toNumber(candidate.criticScore ?? null);
  const critic = criticRaw !== null && criticRaw >= 0 && criticRaw <= 100 ? criticRaw : null;
  if (critic !== null) {
    parts.push(`Critic ${critic}`);
  }
  const playRaw =
    toNumber(game?.playtime_forever) ??
    toNumber(game?.playtime_forever_min) ??
    toNumber(game?.playtime) ??
    (toNumber(game?.hours_played) !== null ? toNumber(game?.hours_played)! * 60 : null) ??
    toNumber(candidate.playtimeForeverMin ?? null);
  if (playRaw !== null && playRaw > 0) {
    const hours = playRaw / 60;
    parts.push(hours >= 1 ? `${hours.toFixed(hours >= 10 ? 0 : 1)}h played` : `${Math.round(playRaw)}m played`);
  }
  const price = toNumber(game?.price ?? candidate.price ?? null);
  if (price !== null) {
    parts.push(`$${price.toFixed(2)}`);
  }
  const reason = parts.length ? parts.join(", ") : candidate.title ?? game?.name ?? candidate.id;
  return reason;
}

function coerceGameList(
  rawText: string,
  candidateById: Map<string, AICandidate>,
  candidateByApp: Map<number, AICandidate>,
): AIRankedResponse | null {
  const candidates = extractJsonCandidates(rawText);
  if (!candidates.length) {
    return null;
  }

  for (let i = candidates.length - 1; i >= 0; i -= 1) {
    const json = candidates[i];
    try {
      const parsed = JSON.parse(json);
      let games: any[] = Array.isArray((parsed as any)?.games)
        ? parsed.games
        : Array.isArray(parsed)
          ? parsed
          : Array.isArray(parsed?.results)
            ? parsed.results
            : [];
      // Accept a single-game object inside a fence
      if (!games.length && parsed && typeof parsed === "object") {
        const maybe = parsed as any;
        if (maybe && ("appid" in maybe || "name" in maybe || "title" in maybe)) {
          games = [maybe];
        }
      }
      if (!games.length) {
        continue;
      }
      const seen = new Set<string>();
      const results: AIRanked[] = [];
      for (const game of games) {
        if (!game) continue;
        const appidNumeric = toNumber(game.appid);
        const candidate =
          (typeof game.id === "string" && candidateById.get(game.id)) ||
          (appidNumeric !== null && candidateByApp.get(appidNumeric)) ||
          (typeof game.identityId === "string" && candidateById.get(game.identityId)) ||
          (typeof game.name === "string"
            ? Array.from(candidateById.values()).find(
                (entry) => entry.title?.toLowerCase() === game.name.toLowerCase(),
              )
            : typeof game.title === "string"
              ? Array.from(candidateById.values()).find(
                  (entry) => entry.title?.toLowerCase() === game.title.toLowerCase(),
                )
              : undefined);
        if (!candidate || seen.has(candidate.id)) {
          continue;
        }
        seen.add(candidate.id);
        results.push({
          id: candidate.id,
          rank: results.length + 1,
          reason: formatReason(candidate, game),
        });
        if (results.length >= FALLBACK_RESULTS) {
          break;
        }
      }
      if (results.length) {
        return {
          results,
          warning:
            "Parsed a library list from Ally; ranked the games using your library context. Sanity-check the picks before acting.",
          rawText: rawText,
          parsed: null,
        };
      }
    } catch {
      // ignore parse errors and continue with other candidates
    }
  }
  return null;
}

export async function rankWithAI(
  query: string,
  candidates: AICandidate[],
  opts: AISuggestOptions = {},
  sessionId?: string,
  lookupCandidates?: AICandidate[],
): Promise<AIRankedResponse> {
  const session = sessionId ?? getOrCreateSession();
  const mode = opts.mode ?? "coach";
  const candidateById = new Map<string, AICandidate>();
  const candidateByApp = new Map<number, AICandidate>();
  const lookup = lookupCandidates ?? candidates;
  for (const candidate of lookup) {
    candidateById.set(candidate.id, candidate);
    if (typeof candidate.appid === "number") {
      candidateByApp.set(candidate.appid, candidate);
    } else if (typeof candidate.appid === "string") {
      const numeric = toNumber(candidate.appid);
      if (numeric !== null) {
        candidateByApp.set(numeric, candidate);
      }
    }
  }
  const firstQuery =
    opts.strictJson
      ? `${query}\n\nReply ONLY with JSON in this exact schema: {"results":[{"id":"<identityId>","rank":1,"reason":"<short>"}]}. No prose. No markdown. No code fences.`
      : query;

  const payload = JSON.stringify({
    system: resolveSystem(mode),
    fewshot: FEWSHOT_RESULTS_ONLY.slice(0, 1),
    query: firstQuery,
    opts,
    candidates: candidates.slice(0, MAX_CANDIDATES),
  });
  const txt = await allyChat(session, payload, !!opts.allowWeb);

  let warning: string | null = null;
  let parsed: Reply | null = null;
  let repaired = false;

  const attemptParse = (input: string | null) => {
    if (!input) return null;
    try {
      const raw = JSON.parse(input);
      const result = ZReply.safeParse(raw);
      if (result.success) {
        return result.data;
      }
      warning =
        warning ??
        friendlyWarning(
          `AI reply failed schema validation (${result.error.issues[0]?.message ?? "unknown issue"}).`
        );
      return null;
    } catch {
      return null;
    }
  };

  parsed = attemptParse(txt);

  if (!parsed) {
    const reparsedResponse = coerceGameList(txt, candidateById, candidateByApp);
    if (reparsedResponse) {
      // If Ally provided only a few items (e.g., a single example), top up with
      // a small heuristic pass so users see a useful list.
      const selected = new Set(reparsedResponse.results.map((r) => r.id));

      const must = new Set((opts.mustTags ?? []).map((t) => t.toLowerCase()));
      const avoid = new Set((opts.avoidTags ?? []).map((t) => t.toLowerCase()));
      const timebox =
        typeof opts.timeboxMin === "number" && Number.isFinite(opts.timeboxMin)
          ? opts.timeboxMin
          : null;

      const tagHits = (tags: string[] | undefined, set: Set<string>) => {
        if (!tags || !set.size) return 0;
        let n = 0;
        for (const t of tags) if (set.has(t.toLowerCase())) n++;
        return n;
      };

      const scored = candidates
        .filter((c) => !selected.has(c.id))
        .map((c) => {
          let s = 0;
          const parts: string[] = [];
          if (c.installed) {
            s += 30;
            parts.push("Installed");
          }
          const crit = typeof c.criticScore === "number" && c.criticScore >= 0 && c.criticScore <= 100 ? c.criticScore : null;
          if (crit !== null) {
            s += crit * 0.2;
            parts.push(`Critic ${crit}`);
          }
          if (timebox !== null && typeof c.ttbMainH === "number") {
            const diffH = timebox / 60 - c.ttbMainH;
            s += Math.max(0, 20 - Math.abs(diffH * 10));
            if (c.ttbMainH <= timebox / 60)
              parts.push(`≈${c.ttbMainH.toFixed(c.ttbMainH >= 10 ? 0 : 1)}h fits timebox`);
          }
          if (opts.mode === "deals") {
            const d = (c as any).discountPercent as number | undefined;
            if (typeof d === "number") {
              s += Math.max(0, d) * 0.6;
              parts.push(`-${Math.round(d)}%`);
            }
            const v = (c as any).valuePerHour as number | undefined;
            if (typeof v === "number") {
              s += Math.max(0, Math.min(20, (5 - v) * 4));
              parts.push(`$${v.toFixed(2)}/h`);
            }
          }
          const mh = tagHits(c.tags, must), ah = tagHits(c.tags, avoid);
          if (must.size) s += mh * 6;
          if (avoid.size) s -= ah * 8;
          if (!parts.length) parts.push("Fallback pick");
          return { c, s, reason: parts.join(", ") };
        })
        .sort((a, b) => b.s - a.s)
        .slice(0, Math.max(0, FALLBACK_RESULTS - reparsedResponse.results.length))
        .map((row, i) => ({ id: row.c.id, rank: reparsedResponse.results.length + i + 1, reason: row.reason }));

      const combined = reparsedResponse.results.concat(scored);
      return {
        results: combined,
        charts: undefined,
        notes: undefined,
        warning:
          reparsedResponse.warning ??
          "Parsed a library list from Ally and topped up with similar picks; sanity‑check before acting.",
        rawText: reparsedResponse.rawText,
        parsed: null,
      };
    }

    const candidatesFromText = extractJsonCandidates(txt);
    for (const candidate of candidatesFromText) {
      const reparsed = attemptParse(candidate);
      if (reparsed) {
        parsed = reparsed;
        repaired = candidate.trim() !== txt.trim();
        if (repaired) {
          warning =
            warning ??
            "Ally replied in a verbose format. We repaired the JSON, but double-check the picks just in case.";
        }
        break;
      }
    }

    // Optional auto-retry with a strict JSON-only instruction
    if (!parsed && (opts.strictJson !== false)) {
      try {
        const strictQuery =
          `${query}\n\n` +
          'Reply ONLY with JSON in this exact schema: {"results":[{"id":"<identityId>","rank":1,"reason":"<short>"}]}.' +
          ' No prose. No markdown. No code fences.';
        const payload2 = JSON.stringify({
          system: resolveSystem(mode),
          fewshot: FEWSHOT_RESULTS_ONLY.slice(0, 1),
          query: strictQuery,
          opts,
          candidates: candidates.slice(0, MAX_CANDIDATES),
        });
        const txt2 = await allyChat(session, payload2, !!opts.allowWeb);
        const reparsed2 = attemptParse(txt2);
        if (reparsed2) {
          parsed = reparsed2;
          repaired = true;
          warning = warning ?? "Auto-retried with JSON-only instruction; results converted.";
        }
      } catch {
        // ignore retry errors and fall back
      }
    }
  }

  if (parsed) {
    if (repaired) {
      warning =
        warning ??
        "Ally's reply needed a quick repair. Results look fine, but peek at the transcript if something feels off.";
    }
    return {
      results: parsed.results.map((r: Reply["results"][number]) => ({ id: r.id, rank: r.rank, reason: r.reason })),
      charts: parsed.charts,
      notes: parsed.notes,
      warning,
      rawText: txt,
      parsed,
    };
  }

  // Heuristic fallback: rank visible candidates with simple signals
  const must = new Set((opts.mustTags ?? []).map((t) => t.toLowerCase()));
  const avoid = new Set((opts.avoidTags ?? []).map((t) => t.toLowerCase()));
  const timebox = typeof opts.timeboxMin === "number" && Number.isFinite(opts.timeboxMin) ? opts.timeboxMin : null;

  function tagHits(tags: string[] | undefined, set: Set<string>): number {
    if (!tags || !set.size) return 0;
    let n = 0;
    for (const t of tags) if (set.has(t.toLowerCase())) n++;
    return n;
  }

  const scored = candidates.map((c) => {
    let s = 0;
    const parts: string[] = [];
    if (c.installed) { s += 30; parts.push("Installed"); }
    const crit = typeof c.criticScore === "number" && c.criticScore >= 0 && c.criticScore <= 100 ? c.criticScore : null;
    if (crit !== null) { s += crit * 0.2; parts.push(`Critic ${crit}`); }
    if (timebox !== null && typeof c.ttbMainH === "number") {
      const diffH = timebox / 60 - c.ttbMainH;
      s += Math.max(0, 20 - Math.abs(diffH * 10));
      if (c.ttbMainH <= timebox / 60) parts.push(`≈${c.ttbMainH.toFixed(c.ttbMainH >= 10 ? 0 : 1)}h fits timebox`);
    }
    if (opts.mode === "deals") {
      const d = (c as any).discountPercent as number | undefined;
      if (typeof d === "number") { s += Math.max(0, d) * 0.6; parts.push(`-${Math.round(d)}%`); }
      const v = (c as any).valuePerHour as number | undefined;
      if (typeof v === "number") { s += Math.max(0, Math.min(20, (5 - v) * 4)); parts.push(`$${v.toFixed(2)}/h`); }
    }
    const mh = tagHits(c.tags, must), ah = tagHits(c.tags, avoid);
    if (must.size) s += mh * 6;
    if (avoid.size) s -= ah * 8;
    if (!parts.length) parts.push("Fallback pick");
    return { c, s, reason: parts.join(", ") };
  })
  .sort((a, b) => b.s - a.s)
  .slice(0, FALLBACK_RESULTS)
  .map((row, i) => ({ id: row.c.id, rank: i + 1, reason: row.reason }));

  return {
    results: scored,
    warning:
      warning ??
      "Ally sent back something we couldn't read, so this is a quick fallback list. Try again in a moment or open the transcript to share the raw reply.",
    rawText: txt,
    parsed: null,
  };
}


