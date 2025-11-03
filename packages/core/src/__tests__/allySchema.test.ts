import { describe, expect, it } from "vitest";
import { extractJsonBlock, extractJsonCandidates } from "../ally/repair";
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

  it("coerces partial replies", () => {
    const parsed = ZReply.parse({
      results: [{ id: "bad", rank: "2", reason: "" }],
    });
    expect(parsed.results[0].rank).toBe(2);
    expect(parsed.results[0].reason.length).toBeGreaterThan(0);
  });
});

describe("extractJsonCandidates", () => {
  it("returns fenced JSON blocks with newest last", () => {
    const raw = `Prior text
\`\`\`json
{ "foo": "bar" }
\`\`\`
More commentary
\`\`\`
{ "hello": "world" }
\`\`\`
Trailing text`;
    const candidates = extractJsonCandidates(raw);
    expect(candidates).toEqual(['{ "foo": "bar" }', '{ "hello": "world" }']);
  });

  it("falls back to simple brace slice when no fences", () => {
    const raw = "Noise { \"foo\": 1 } trailing";
    expect(extractJsonCandidates(raw)).toEqual(['{ "foo": 1 }']);
  });
});
