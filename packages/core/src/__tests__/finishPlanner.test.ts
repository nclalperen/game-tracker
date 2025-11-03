import { describe, expect, it } from "vitest";
import { modalSessionMinutes, planSessions } from "../finishPlanner";

describe("modalSessionMinutes", () => {
  it("returns 0 when no valid sessions", () => {
    expect(modalSessionMinutes([])).toBe(0);
    expect(modalSessionMinutes([{ durationMs: null }, {}])).toBe(0);
  });

  it("ignores non-finite durations", () => {
    expect(
      modalSessionMinutes([
        { durationMs: -10 },
        { durationMs: Number.NaN },
        { durationMs: 30 * 60 * 1000 },
      ]),
    ).toBe(30);
  });

  it("computes median for odd/even collections", () => {
    expect(
      modalSessionMinutes([
        { durationMs: 15 * 60 * 1000 },
        { durationMs: 45 * 60 * 1000 },
        { durationMs: 30 * 60 * 1000 },
      ]),
    ).toBe(30);

    expect(
      modalSessionMinutes([
        { durationMs: 15 * 60 * 1000 },
        { durationMs: 45 * 60 * 1000 },
        { durationMs: 30 * 60 * 1000 },
        { durationMs: 60 * 60 * 1000 },
      ]),
    ).toBe(38);
  });
});

describe("planSessions", () => {
  it("returns empty plan when no remaining hours", () => {
    expect(planSessions(0, 30)).toEqual({ steps: [], totalMinutes: 0 });
  });

  it("uses modal minutes to size sessions", () => {
    const plan = planSessions(6, 45);
    expect(plan.totalMinutes).toBe(360);
    expect(plan.steps.length).toBeGreaterThan(0);
    expect(plan.steps.reduce((sum, step) => sum + step.minutes, 0)).toBe(360);
  });

  it("caps sessions and distributes remainder", () => {
    const plan = planSessions(12, 30);
    expect(plan.steps.length).toBeLessThanOrEqual(5);
    expect(plan.steps[plan.steps.length - 1].minutes).toBeGreaterThanOrEqual(plan.steps[0].minutes);
  });
});

