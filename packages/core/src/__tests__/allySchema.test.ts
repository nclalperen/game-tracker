import { describe, expect, it } from "vitest";
import { extractJsonBlock } from "../ally/repair";
import { ZReply } from "../ally/schema";

describe("extractJsonBlock", () => {
  it("returns null for empty input", () => {
    expect(extractJsonBlock("")).toBeNull();
  });

  it("extracts first/last braces", () => {
    const payload = 'prefix { "foo": "bar" } suffix';
    expect(extractJsonBlock(payload)).toBe('{ "foo": "bar" }');
  });
});

describe("ZReply", () => {
  it("parses a valid reply payload", () => {
    const parsed = ZReply.parse({
      results: [{ id: "abc", rank: 1, reason: "Top pick" }],
      charts: [
        {
          id: "chart-1",
          title: "Hours saved",
          unit: "h",
          series: [{ name: "Main", points: [[0, 0], [1, 2]] }],
        },
      ],
      notes: "Try this next.",
    });
    expect(parsed.results[0].id).toBe("abc");
  });

  it("throws for malformed reply", () => {
    expect(() =>
      ZReply.parse({
        results: [{ id: "bad", rank: 1 }],
      }),
    ).toThrow();
  });
});
