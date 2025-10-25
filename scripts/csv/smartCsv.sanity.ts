import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseCsvStream, sniffCsv } from "../csv/smartCsv";

async function main() {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const fixturePath = path.resolve(__dirname, "../fixtures/csv/edgecases.csv");

  const sample = await fs.readFile(fixturePath, "utf8");
  console.log("sniff", sniffCsv(sample.slice(0, 1024)));

  const titles: string[] = [];
  for await (const row of parseCsvStream(fixturePath, { columnsCase: "lower" })) {
    titles.push(row.title ?? "");
  }

  console.log("parsed count", titles.length);
  if (titles.length === 0) {
    console.error("[smartCsv] sanity failed: no records parsed");
    process.exit(1);
  }

  const expected = [
    "The Elder Scrolls V: Skyrim",
    "NieR:Automata",
    "Assassin’s Creed IV: Black Flag",
    "Metal Gear Solid V: The Phantom Pain",
  ];

  const missing = expected.filter((title) => !titles.includes(title));
  if (missing.length > 0) {
    console.error("[smartCsv] sanity failed. Missing titles:", missing);
    process.exit(1);
  }

  console.log("[smartCsv] sanity passed.");
}

main().catch((err) => {
  console.error("[smartCsv] sanity failed:", err);
  process.exit(1);
});
