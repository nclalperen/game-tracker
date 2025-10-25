import { describe, it, expect } from "vitest";
import { dedupeIdentities } from "../src/dedupe";

describe("dedupeIdentities", () => {
  it("keeps first per (title,platform)", () => {
    const list = [
      { id: "a", title: "Hades", platform: "PC" },
      { id: "b", title: "Hades", platform: "pc" },
      { id: "c", title: "Hades II", platform: "PC" },
    ] as any;
    const out = dedupeIdentities(list);
    expect(out.map(x => x.id)).toEqual(["a", "c"]);
  });
});
