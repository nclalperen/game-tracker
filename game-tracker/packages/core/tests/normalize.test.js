import { describe, it, expect } from "vitest";
import { pricePerHour } from "../src/normalize";
describe("pricePerHour", () => {
    it("returns null without both inputs", () => {
        expect(pricePerHour(undefined, 10)).toBeNull();
        expect(pricePerHour(100, undefined)).toBeNull();
    });
    it("computes rounded price/hour", () => {
        expect(pricePerHour(200, 20)).toBe(10); // 200/20
        expect(pricePerHour(299, 20)).toBe(15); // ~14.95 -> 15 rounded
    });
});
