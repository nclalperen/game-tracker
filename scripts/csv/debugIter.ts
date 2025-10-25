import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "csv-parse";

async function main() {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const filePath = path.resolve(__dirname, "../fixtures/csv/edgecases.csv");

  const parser = parse({ columns: true, bom: true, relax_quotes: true, relax_column_count: true, skip_empty_lines: true });
  const stream = fs.createReadStream(filePath);
  stream.pipe(parser);

  for await (const record of parser) {
    console.log("iter", record);
  }
}

main();
