import fs from "node:fs";
import path from "node:path";
import { parse } from "csv-parse";

export type CsvDelimiter = "," | ";";
export type CsvQuote = '"' | "'" | "auto";
export type CsvRecordDelimiter = "\n" | "\r\n" | "auto";

export type SniffResult = {
  delimiter: CsvDelimiter;
  hasBOM: boolean;
  quote: CsvQuote;
  recordDelimiter: CsvRecordDelimiter;
};

const READ_SAMPLE_BYTES = 128 * 1024;

const QUOTE_CANDIDATES: Array<'"' | "'"> = ['"', "'"];

export function sniffCsv(sample: string): SniffResult {
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
  let detectedQuote: '"' | "'" | null = null;
  let inQuote = false;
  let activeQuote: '"' | "'" | null = null;

  for (let i = 0; i < working.length; i += 1) {
    const ch = working[i];

    if (QUOTE_CANDIDATES.includes(ch as '"' | "'")) {
      if (!inQuote) {
        inQuote = true;
        activeQuote = ch as '"' | "'";
        if (!detectedQuote) detectedQuote = activeQuote;
        continue;
      }

      if (activeQuote === ch) {
        const next = working[i + 1];
        if (next === ch) {
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

  const recordDelimiter: CsvRecordDelimiter = working.includes("\r\n") ? "\r\n" : working.includes("\n") ? "\n" : "auto";
  const delimiter: CsvDelimiter = semicolonCount > commaCount ? ";" : ",";
  const quote: CsvQuote = detectedQuote ?? "auto";

  return { delimiter, hasBOM, quote, recordDelimiter };
}

async function readSample(filePath: string, bytes: number): Promise<string> {
  const fd = await fs.promises.open(filePath, "r");
  try {
    const buffer = Buffer.alloc(bytes);
    const { bytesRead } = await fd.read(buffer, 0, bytes, 0);
    return buffer.slice(0, bytesRead).toString("utf8");
  } finally {
    await fd.close();
  }
}

export const HEADER_ALIASES: Record<string, string[]> = {
  title: ["title", "name"],
  platform: ["platform", "platform_name", "system"],
  score: ["metascore", "score", "metacritic"],
  url: ["url", "link"],
  year: ["year", "release_year", "released", "date"],
  tags: ["tags", "genres"],
};

export function alias(row: Record<string, string>, key: keyof typeof HEADER_ALIASES): string | undefined {
  const variants = HEADER_ALIASES[key];
  for (const candidate of variants) {
    const value = row[candidate];
    if (value != null && value !== "") {
      return String(value).trim();
    }
  }
  return undefined;
}

export async function* parseCsvStream(
  filePath: string,
  opts: { columnsCase?: "asIs" | "lower"; tolerateUnbalancedQuotes?: boolean } = {},
): AsyncGenerator<Record<string, string>> {
  const resolved = path.resolve(filePath);
  const sample = await readSample(resolved, READ_SAMPLE_BYTES);
  const sniff = sniffCsv(sample);

  const stream = fs.createReadStream(resolved, { encoding: "utf8" });
  const parser = parse<Record<string, string>>({
    columns:
      opts.columnsCase === "lower"
        ? (columns: string[]) => columns.map((col) => col.toLowerCase())
        : true,
    bom: true,
    relax_quotes: opts.tolerateUnbalancedQuotes ?? true,
    relax_column_count: true,
    skip_empty_lines: true,
    trim: true,
    delimiter: sniff.delimiter,
    record_delimiter: sniff.recordDelimiter === "auto" ? undefined : sniff.recordDelimiter,
    quote: sniff.quote === "auto" ? undefined : sniff.quote,
  });

  stream.on("error", (err) => parser.destroy(err as Error));
  parser.on("error", (err) => stream.destroy(err as Error));

  const iterable = stream.pipe(parser) as AsyncIterable<Record<string, string>>;
  for await (const record of iterable) {
    yield record;
  }
}


