import fs from "node:fs";
import path from "node:path";
import { parse } from "csv-parse/sync";

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
  let quoteChar: '"' | "'" | null = null;

  let inQuote = false;
  let activeQuote: '"' | "'" | null = null;
  const length = working.length;
  for (let i = 0; i < length; i += 1) {
    const ch = working[i];
    if (ch === '"' || ch === "'") {
      const prev = working[i - 1];
      const isBoundary = i === 0 || prev === "," || prev === ";" || prev === "\n" || prev === "\r";
      if (!inQuote && isBoundary && (quoteChar === null || quoteChar === ch)) {
        inQuote = true;
        activeQuote = ch as '"' | "'";
        if (!quoteChar) {
          quoteChar = activeQuote;
        }
        continue;
      }
      if (inQuote && activeQuote === ch) {
        const nextCh = working[i + 1];
        if (nextCh === ch) {
          i += 1;
        } else {
          inQuote = false;
          activeQuote = null;
        }
        continue;
      }
    }

    if (!inQuote) {
      if (ch === ",") commaCount += 1;
      if (ch === ";") semicolonCount += 1;
    }
  }

  const recordDelimiter: CsvRecordDelimiter = working.includes("\r\n") ? "\r\n" : working.includes("\n") ? "\n" : "auto";

  let delimiter: CsvDelimiter = ",";
  if (semicolonCount > commaCount) {
    delimiter = ";";
  }

  const quote: CsvQuote = quoteChar ?? "auto";

  return {
    delimiter,
    hasBOM,
    quote,
    recordDelimiter,
  };
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

export async function* parseCsvStream(
  filePath: string,
  opts: { columnsCase?: "asIs" | "lower"; tolerateUnbalancedQuotes?: boolean } = {},
): AsyncGenerator<Record<string, string>> {
  const resolved = path.resolve(filePath);
  const sample = await readSample(resolved, READ_SAMPLE_BYTES);
  const sniff = sniffCsv(sample);

  const content = await fs.promises.readFile(resolved, "utf8");

  const records = parse(content, {
    columns:
      opts.columnsCase === "lower"
        ? (columns: string[]) => columns.map((c) => c.toLowerCase())
        : true,
    bom: sniff.hasBOM,
    relax_quotes: true,
    relax_column_count: true,
    rtrim: true,
    skip_empty_lines: true,
    delimiter: sniff.delimiter,
    quote: sniff.quote === "auto" ? undefined : sniff.quote,
  }) as Record<string, string>[];

  for (const record of records) {
    yield record;
  }
}


