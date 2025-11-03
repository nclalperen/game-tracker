import { describe, expect, it } from "vitest";
import { computeDealScore } from "../deals/score";

describe("computeDealScore", () => {
  it("returns 0 for empty input", () => {
    expect(computeDealScore({})).toBe(0);
  });

  it("rewards deeper discounts and urgency", () => {
    const baseline = computeDealScore({ discountPercent: 10, saleEndsInDays: 14 });
    const discounted = computeDealScore({ discountPercent: 50, saleEndsInDays: 2 });
    expect(discounted).toBeGreaterThan(baseline);
  });

  it("accounts for wishlist/install status", () => {
    const wishlistOnly = computeDealScore({ wishlist: true });
    const installed = computeDealScore({ wishlist: true, installed: true });
    expect(installed).toBeGreaterThan(wishlistOnly);
  });

  it("includes critic and value per hour signals", () => {
    const criticHeavy = computeDealScore({ criticScore: 90, valuePerHour: 3 });
    const criticLight = computeDealScore({ criticScore: 50, valuePerHour: 10 });
    expect(criticHeavy).toBeGreaterThan(criticLight);
  });
});

