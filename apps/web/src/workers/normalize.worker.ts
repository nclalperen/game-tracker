/// <reference lib="webworker" />

import { canonicalPlatform, normalizeTitle } from "@tracker/core";

type CsvDelimiter = "," | ";";
type CsvQuote = '"' | "'";
type CsvRecordDelimiter = "\n" | "\r\n" | "auto";

type SniffResult = {
  delimiter: CsvDelimiter;
  hasBOM: boolean;
  quote: CsvQuote | "auto";
  recordDelimiter: CsvRecordDelimiter;
};

type SmartCsvParsePayload = {
  text: string;
  lowerCaseHeaders?: boolean;
  limit?: number;
  trim?: boolean;
};

type WorkerPayloadMap = {
  normalizeTitle: { input: string };
  mcKey: { title: string; platform?: string | null; url?: string | null };
  smartCsvParse: SmartCsvParsePayload;
  fuzzyScore: { source: string; target: string };
};

type WorkerResultMap = {
  normalizeTitle: string;
  mcKey: string;
  smartCsvParse: {
    headers: string[];
    rows: Record<string, string>[];
    sniff: SniffResult;
  };
  fuzzyScore: number;
};

type WorkerRequest = {
  id: number;
  type: keyof WorkerPayloadMap;
  payload: WorkerPayloadMap[keyof WorkerPayloadMap];
};

type WorkerResponse =
  | { id: number; ok: true; result: WorkerResultMap[keyof WorkerResultMap] }
  | { id: number; ok: false; error: string };

const ctx: DedicatedWorkerGlobalScope = self as DedicatedWorkerGlobalScope;

ctx.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const { id, type, payload } = event.data;
  Promise.resolve(handleRequest(type, payload as any))
    .then((result) => {
      ctx.postMessage({ id, ok: true, result } as WorkerResponse);
    })
    .catch((error: unknown) => {
      const message =
        error instanceof Error ? error.message : typeof error === "string" ? error : "Worker failure";
      ctx.postMessage({ id, ok: false, error: message } as WorkerResponse);
    });
};

async function handleRequest<T extends keyof WorkerPayloadMap>(
  type: T,
  payload: WorkerPayloadMap[T],
): Promise<WorkerResultMap[T]> {
  switch (type) {
    case "normalizeTitle":
      return normalizeTitle((payload as WorkerPayloadMap["normalizeTitle"]).input ?? "") as WorkerResultMap[T];
    case "mcKey":
      return computeMcKey(payload as WorkerPayloadMap["mcKey"]) as WorkerResultMap[T];
    case "smartCsvParse":
      return parseSmartCsv(payload as WorkerPayloadMap["smartCsvParse"]) as WorkerResultMap[T];
    case "fuzzyScore":
      return computeFuzzyScore(payload as WorkerPayloadMap["fuzzyScore"]) as WorkerResultMap[T];
    default:
      throw new Error(`Unsupported worker task: ${String(type)}`);
  }
}

function computeMcKey(payload: WorkerPayloadMap["mcKey"]): string {
  const { title, platform, url } = payload;
  const normalized = normalizeTitle(title ?? "");
  const host = tryParseHost(url);
  const canonical = canonicalPlatform(platform ?? undefined, host, undefined);
  return `${normalized}|${canonical}`;
}

function tryParseHost(url?: string | null): string | undefined {
  if (!url) return undefined;
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return undefined;
  }
}

function parseSmartCsv(payload: SmartCsvParsePayload): WorkerResultMap["smartCsvParse"] {
  let text = payload.text ?? "";
  if (!text) {
    return { headers: [], rows: [], sniff: sniffCsv("") };
  }

  if (text.charCodeAt(0) === 0xfeff) {
    text = text.slice(1);
  }

  const sniff = sniffCsv(text.slice(0, Math.min(text.length, 128 * 1024)));
  const delimiter = sniff.delimiter;
  const quote: CsvQuote = sniff.quote === "auto" ? '"' : sniff.quote;
  const limit = typeof payload.limit === "number" && payload.limit > 0 ? payload.limit : Infinity;
  const trim = payload.trim !== false; // default to trimming

  const rows = tokenizeCsv(text, delimiter, quote);
  if (!rows.length) {
    return { headers: [], rows: [], sniff };
  }

  const headerRow = rows.shift() ?? [];
  const headers = headerRow.map((col, index) => {
    const base = (trim ? col.trim() : col) || `column_${index + 1}`;
    return payload.lowerCaseHeaders ? base.toLowerCase() : base;
  });

  const records: Record<string, string>[] = [];

  for (const row of rows) {
    if (records.length >= limit) break;
    const record: Record<string, string> = {};
    let nonEmpty = false;
    for (let i = 0; i < headers.length; i += 1) {
      const value = row[i] ?? "";
      const normalizedValue = trim ? value.trim() : value;
      if (!nonEmpty && normalizedValue) nonEmpty = true;
      record[headers[i]] = normalizedValue;
    }
    // Preserve overflow columns by appending auto-generated keys
    if (row.length > headers.length) {
      for (let extraIndex = headers.length; extraIndex < row.length; extraIndex += 1) {
        const key = `column_${extraIndex + 1}`;
        const value = trim ? row[extraIndex].trim() : row[extraIndex];
        if (!nonEmpty && value) nonEmpty = true;
        record[key] = value;
      }
    }
    if (!nonEmpty) continue;
    records.push(record);
  }

  return { headers, rows: records, sniff };
}

function sniffCsv(sample: string): SniffResult {
  if (!sample) {
    return { delimiter: ",", hasBOM: false, quote: "auto", recordDelimiter: "auto" };
  }

  let working = sample;
  let hasBOM = false;
  if (working.charCodeAt(0) === 0xfeff) {
    hasBOM = true;
    working = working.slice(1);
  }

  let commaCount = 0;
  let semicolonCount = 0;
  let detectedQuote: CsvQuote | null = null;
  let inQuote = false;
  let activeQuote: CsvQuote | null = null;

  for (let i = 0; i < working.length; i += 1) {
    const ch = working[i];
    if (ch === '"' || ch === "'") {
      const quoteChar = ch as CsvQuote;
      if (!inQuote) {
        inQuote = true;
        activeQuote = quoteChar;
        if (!detectedQuote) detectedQuote = activeQuote;
        continue;
      }
      if (activeQuote === quoteChar) {
        const next = working[i + 1];
        if (next === quoteChar) {
          i += 1;
        } else {
          inQuote = false;
          activeQuote = null;
        }
        continue;
      }
    }

    if (inQuote) continue;

    if (ch === ",") {
      commaCount += 1;
      continue;
    }
    if (ch === ";") {
      semicolonCount += 1;
      continue;
    }
  }

  const recordDelimiter: CsvRecordDelimiter =
    working.includes("\r\n") ? "\r\n" : working.includes("\n") ? "\n" : "auto";
  const delimiter: CsvDelimiter = semicolonCount > commaCount ? ";" : ",";
  const quote: CsvQuote | "auto" = detectedQuote ?? "auto";

  return { delimiter, hasBOM, quote, recordDelimiter };
}

function tokenizeCsv(text: string, delimiter: CsvDelimiter, quote: CsvQuote): string[][] {
  const rows: string[][] = [];
  let currentRow: string[] = [];
  let currentValue = "";
  let inQuote = false;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];

    if (inQuote) {
      if (ch === quote) {
        const next = text[i + 1];
        if (next === quote) {
          currentValue += quote;
          i += 1;
        } else {
          inQuote = false;
        }
      } else {
        currentValue += ch;
      }
      continue;
    }

    if (ch === quote) {
      inQuote = true;
      continue;
    }

    if (ch === delimiter) {
      currentRow.push(currentValue);
      currentValue = "";
      continue;
    }

    if (ch === "\r" || ch === "\n") {
      currentRow.push(currentValue);
      currentValue = "";
      if (!(currentRow.length === 1 && currentRow[0] === "")) {
        rows.push(currentRow);
      }
      currentRow = [];
      if (ch === "\r" && text[i + 1] === "\n") {
        i += 1;
      }
      continue;
    }

    currentValue += ch;
  }

  if (inQuote) {
    // Unbalanced quote; treat remainder as part of field.
    currentRow.push(currentValue);
    rows.push(currentRow);
  } else if (currentValue.length > 0 || currentRow.length > 0) {
    currentRow.push(currentValue);
    rows.push(currentRow);
  }

  return rows;
}

function computeFuzzyScore(payload: WorkerPayloadMap["fuzzyScore"]): number {
    const source = normalizeTitle(payload.source ?? "");
    const target = normalizeTitle(payload.target ?? "");
    if (!source && !target) return 1;
    if (!source || !target) return 0;
    if (source === target) return 1;
    const distance = levenshtein(source, target);
    const maxLen = Math.max(source.length, target.length);
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
      curr[j] = Math.min(
        curr[j - 1] + 1,
        prev[j] + 1,
        prev[j - 1] + cost,
      );
    }
    for (let j = 0; j <= aLen; j += 1) {
      prev[j] = curr[j];
    }
  }

  return prev[aLen];
}

export {};
