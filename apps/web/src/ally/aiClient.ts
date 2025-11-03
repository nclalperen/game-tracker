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
  extractJsonBlock,
} from "@tracker/core";

export type AISuggestOptions = {
  allowWeb?: boolean;
  mode?: CoachMode;
  timeboxMin?: number | null;
  mustTags?: string[];
  avoidTags?: string[];
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
  return message;
}

export async function rankWithAI(
  query: string,
  candidates: AICandidate[],
  opts: AISuggestOptions = {},
  sessionId?: string,
): Promise<AIRankedResponse> {
  const session = sessionId ?? getOrCreateSession();
  const mode = opts.mode ?? "coach";
  const payload = JSON.stringify({
    system: resolveSystem(mode),
    fewshot: FEWSHOT_RESULTS_ONLY.slice(0, 1),
    query,
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
    const repairedBlock = extractJsonBlock(txt);
    if (repairedBlock) {
      const reparsed = attemptParse(repairedBlock);
      if (reparsed) {
        parsed = reparsed;
        repaired = true;
      }
    }
  }

  if (parsed) {
    if (repaired) {
      warning = warning ?? "AI reply required JSON repair; results verified.";
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

  const fallback = candidates.slice(0, FALLBACK_RESULTS).map((c, i) => ({
    id: c.id,
    rank: i + 1,
    reason: "Heuristic fallback",
  }));

  return {
    results: fallback,
    warning:
      warning ??
      "AI reply could not be parsed; showing heuristic fallback.",
    rawText: txt,
    parsed: null,
  };
}
