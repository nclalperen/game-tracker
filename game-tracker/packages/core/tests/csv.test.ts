import { describe, it, expect } from "vitest";
import { parseCSV, toCSV } from "../src/csv";

describe("csv roundtrip", () => {
  it("parses and serializes simple CSV", () => {
    const csv = "Title,Platform,Status\nHades,PC,Backlog\n";
    const rows = parseCSV(csv);
    expect(rows).toEqual([{ Title: "Hades", Platform: "PC", Status: "Backlog" }]);

    const out = toCSV(rows);
    expect(out.trim()).toContain("Title,Platform,Status");
    expect(out.trim()).toContain("Hades,PC,Backlog");
  });
});
