export type PlannerSession = { durationMs?: number | null };

export type PlannerStep = {
  minutes: number;
  dateSuggestion?: string;
};

export type PlannerResult = {
  steps: PlannerStep[];
  totalMinutes: number;
};

const DEFAULT_SESSION_MINUTES = 60;
const MIN_STEPS = 3;
const MAX_STEPS = 5;
const MINUTES_PER_HOUR = 60;
const DATE_SPACING_MS = 2 * 24 * 60 * 60 * 1000;

export function modalSessionMinutes(sessions: PlannerSession[]): number {
  if (!Array.isArray(sessions) || sessions.length === 0) {
    return 0;
  }

  const durations = sessions
    .map((session) => session?.durationMs ?? null)
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value) && value > 0)
    .map((value) => {
      const minutes = Math.round(value / 60000);
      return Math.max(1, minutes);
    });

  if (!durations.length) {
    return 0;
  }

  durations.sort((a, b) => a - b);
  const mid = Math.floor(durations.length / 2);

  if (durations.length % 2 !== 0) {
    return durations[mid];
  }

  return Math.round((durations[mid - 1] + durations[mid]) / 2);
}

function clampSessionCount(totalMinutes: number, modalMinutes: number): number {
  if (totalMinutes <= 0) {
    return 0;
  }

  const baseline = modalMinutes > 0 ? modalMinutes : DEFAULT_SESSION_MINUTES;
  let count = Math.round(totalMinutes / baseline);

  if (count < 1) count = 1;
  if (count < MIN_STEPS && totalMinutes >= baseline) count = MIN_STEPS;
  if (count > MAX_STEPS) count = MAX_STEPS;

  return count;
}

export function planSessions(remainingHours: number, modalMinutes: number): PlannerResult {
  if (!Number.isFinite(remainingHours) || remainingHours <= 0) {
    return { steps: [], totalMinutes: 0 };
  }

  const totalMinutes = Math.max(Math.round(remainingHours * MINUTES_PER_HOUR), 1);
  const count = clampSessionCount(totalMinutes, modalMinutes);

  if (count === 0) {
    return { steps: [], totalMinutes };
  }

  const base = Math.floor(totalMinutes / count);
  let remainder = totalMinutes - base * count;
  const start = Date.now();

  const steps: PlannerStep[] = [];
  for (let index = 0; index < count; index += 1) {
    let minutes = base;
    if (remainder > 0) {
      minutes += 1;
      remainder -= 1;
    }
    steps.push({
      minutes,
      dateSuggestion: new Date(start + index * DATE_SPACING_MS).toISOString(),
    });
  }

  const totalAllocated = steps.reduce((sum, step) => sum + step.minutes, 0);
  if (totalAllocated !== totalMinutes && steps.length > 0) {
    const diff = totalMinutes - totalAllocated;
    steps[steps.length - 1].minutes += diff;
  }

  return { steps, totalMinutes };
}
