import { normalizeTitle, readCSV } from "@tracker/core";
import { mcKey } from "@/data/metacriticIndex";
import { isPerfLoggingEnabled } from "@/db";

type CsvDelimiter = "," | ";";
type CsvQuote = '"' | "'";
type CsvRecordDelimiter = "\n" | "\r\n" | "auto";

type SniffResult = {
  delimiter: CsvDelimiter;
  hasBOM: boolean;
  quote: CsvQuote | "auto";
  recordDelimiter: CsvRecordDelimiter;
};

type SmartCsvResult = {
  headers: string[];
  rows: Record<string, string>[];
  sniff: SniffResult;
};

type WorkerPayloadMap = {
  normalizeTitle: { input: string };
  mcKey: { title: string; platform?: string | null; url?: string | null };
  smartCsvParse: { text: string; lowerCaseHeaders?: boolean; limit?: number; trim?: boolean };
  fuzzyScore: { source: string; target: string };
};

type WorkerResultMap = {
  normalizeTitle: string;
  mcKey: string;
  smartCsvParse: SmartCsvResult;
  fuzzyScore: number;
};

type WorkerRequest<T extends keyof WorkerPayloadMap> = {
  id: number;
  type: T;
  payload: WorkerPayloadMap[T];
};

type WorkerResponse<T extends keyof WorkerResultMap> =
  | { id: number; ok: true; result: WorkerResultMap[T] }
  | { id: number; ok: false; error: string };

let worker: Worker | null = null;
let msgId = 0;
const pending = new Map<
  number,
  {
    resolve: (value: unknown) => void;
    reject: (error: unknown) => void;
  }
>();

const WORKER_LOG_THRESHOLD_MS = 20;
const workerNow = () =>
  typeof performance !== "undefined" && typeof performance.now === "function"
    ? performance.now()
    : Date.now();

function ensureWorker(): Worker {
  if (worker) return worker;
  worker = new Worker(new URL("./normalize.worker.ts", import.meta.url), { type: "module" });
  worker.addEventListener("message", (event: MessageEvent<WorkerResponse<keyof WorkerResultMap>>) => {
    const data = event.data;
    const entry = pending.get(data.id);
    if (!entry) return;
    pending.delete(data.id);
    if (data.ok) {
      entry.resolve(data.result);
    } else {
      entry.reject(new Error(data.error));
    }
  });
  worker.addEventListener("error", (error) => {
    for (const [, entry] of pending) {
      entry.reject(error);
    }
    pending.clear();
    worker?.terminate();
    worker = null;
  });
  return worker!;
}

async function runWorker<T extends keyof WorkerPayloadMap>(
  type: T,
  payload: WorkerPayloadMap[T],
): Promise<WorkerResultMap[T]> {
  const instance = ensureWorker();
  const id = ++msgId;
  const start = workerNow();
  const promise = new Promise<WorkerResultMap[T]>((resolve, reject) => {
    pending.set(id, { resolve: resolve as (value: unknown) => void, reject });
    const message: WorkerRequest<T> = { id, type, payload };
    instance.postMessage(message);
  });
  return promise.finally(() => {
    if (!isPerfLoggingEnabled()) return;
    const duration = workerNow() - start;
    if (duration >= WORKER_LOG_THRESHOLD_MS) {
      console.debug("[Worker][" + String(type) + "]", duration.toFixed(1) + "ms");
    }
  });
}

export async function normalizeTitleKeyAsync(input: string): Promise<string> {
  if (!input) return "";
  try {
    return await runWorker("normalizeTitle", { input });
  } catch (error) {
    console.warn("[worker] normalizeTitle failed, falling back to main thread", error);
    return normalizeTitle(input);
  }
}

export async function computeMcKeyAsync(
  title: string,
  platform?: string | null,
  url?: string | null,
): Promise<string> {
  if (!title) return "";
  try {
    return await runWorker("mcKey", { title, platform: platform ?? undefined, url: url ?? undefined });
  } catch (error) {
    console.warn("[worker] mcKey failed, falling back to main thread", error);
    return mcKey(title, platform, url);
  }
}

export async function parseCsvWithWorker(
  text: string,
  options: { lowerCaseHeaders?: boolean; limit?: number; trim?: boolean } = {},
): Promise<SmartCsvResult> {
  if (!text) {
    return { headers: [], rows: [], sniff: { delimiter: ",", hasBOM: false, quote: "auto", recordDelimiter: "auto" } };
  }
  try {
    return await runWorker("smartCsvParse", {
      text,
      lowerCaseHeaders: options.lowerCaseHeaders,
      limit: options.limit,
      trim: options.trim,
    });
  } catch (error) {
    console.warn("[worker] smartCsvParse failed, falling back to main thread parser", error);
    const rows = readCSV(text) as Record<string, string>[];
    const headers = rows.length ? Object.keys(rows[0]) : [];
    return {
      headers,
      rows,
      sniff: { delimiter: ",", hasBOM: false, quote: "auto", recordDelimiter: "auto" },
    };
  }
}

export async function fuzzyScoreAsync(source: string, target: string): Promise<number> {
  try {
    return await runWorker("fuzzyScore", { source, target });
  } catch (error) {
    console.warn("[worker] fuzzyScore failed, falling back to main thread", error);
    return fallbackFuzzyScore(source, target);
  }
}

function fallbackFuzzyScore(source: string, target: string): number {
  const normalizedSource = normalizeTitle(source ?? "");
  const normalizedTarget = normalizeTitle(target ?? "");
  if (!normalizedSource && !normalizedTarget) return 1;
  if (!normalizedSource || !normalizedTarget) return 0;
  if (normalizedSource === normalizedTarget) return 1;
  const distance = levenshtein(normalizedSource, normalizedTarget);
  const maxLen = Math.max(normalizedSource.length, normalizedTarget.length);
  if (maxLen === 0) return 1;
  const score = 1 - distance / maxLen;
  return score < 0 ? 0 : score;
}

function levenshtein(a: string, b: string): number {
  const aLen = a.length;
  const bLen = b.length;
  if (aLen === 0) return bLen;
  if (bLen === 0) return aLen;

  const prev = new Array<number>(aLen + 1);
  const curr = new Array<number>(aLen + 1);

  for (let i = 0; i <= aLen; i += 1) {
    prev[i] = i;
  }

  for (let i = 1; i <= bLen; i += 1) {
    curr[0] = i;
    const bChar = b.charCodeAt(i - 1);
    for (let j = 1; j <= aLen; j += 1) {
      const cost = a.charCodeAt(j - 1) === bChar ? 0 : 1;
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    for (let j = 0; j <= aLen; j += 1) {
      prev[j] = curr[j];
    }
  }

  return prev[aLen];
}

export function terminateNormalizeWorker() {
  if (worker) {
    worker.terminate();
    worker = null;
  }
  pending.clear();
}

export type { SmartCsvResult, SniffResult };
