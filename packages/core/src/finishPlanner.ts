export type FinishPlanStep = {
  minutes: number;
  dateSuggestion?: string;
};

function clampSessions(count: number): number {
  if (count < 3) return 3;
  if (count > 5) return 5;
  return count;
}

export function buildFinishPlan(remainingHours: number | null | undefined, medianSessionMinutes: number | null | undefined): FinishPlanStep[] {
  if (!remainingHours || !Number.isFinite(remainingHours) || remainingHours <= 0) {
    return [];
  }
  const sessionMinutes = medianSessionMinutes && medianSessionMinutes > 0 ? medianSessionMinutes : 60;

  const totalMinutes = Math.max(Math.round(remainingHours * 60), 1);
  let sessions = Math.round(totalMinutes / sessionMinutes);
  sessions = clampSessions(sessions);

  const base = Math.floor(totalMinutes / sessions);
  let remainder = totalMinutes - base * sessions;

  const start = Date.now();
  const spacingMs = 2 * 24 * 60 * 60 * 1000; // every other day

  const plan: FinishPlanStep[] = [];
  for (let i = 0; i < sessions; i += 1) {
    let minutes = base;
    if (remainder > 0) {
      minutes += 1;
      remainder -= 1;
    }
    plan.push({
      minutes,
      dateSuggestion: new Date(start + i * spacingMs).toISOString(),
    });
  }

  const allocated = plan.reduce((sum, step) => sum + step.minutes, 0);
  if (allocated !== totalMinutes && plan.length > 0) {
    const diff = totalMinutes - allocated;
    plan[plan.length - 1].minutes += diff;
  }

  return plan;
}
