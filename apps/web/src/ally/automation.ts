import { runExportEmbedStart, runDigest } from "./runbook";
import {
  getAutomationSettings,
  saveAutomationSettings,
  addDigest,
  type AllyAutomationSettings,
} from "@/db";
import { isTauri } from "@/desktop/bridge";
import { log } from "./log";

const MINUTE = 60_000;
const LIBRARY_LABEL = "my_library" as const;

function toTodayTime(hhmm: string): number {
  const [h, m] = hhmm.split(":").map((value) => Number.parseInt(value, 10));
  const date = new Date();
  if (Number.isFinite(h) && Number.isFinite(m)) {
    date.setHours(h, m, 0, 0);
  }
  return date.getTime();
}

function isSameLocalDay(iso?: string | null, reference = new Date()): boolean {
  if (!iso) return false;
  const value = new Date(iso);
  if (Number.isNaN(value.getTime())) return false;
  return value.toDateString() === reference.toDateString();
}

async function persistDigest(content: string, status: "ok" | "error") {
  await addDigest(content, status);
  await log(status === "ok" ? "info" : "warn", "automation.digest.persisted", {
    status,
    chars: content.length,
  });
}

function buildDigestPrompt(scope: AllyAutomationSettings["digestScope"]): string {
  const coachLines = [
    "Generate a compact backlog coaching note (max 10 lines):",
    "- 3 games I own to finish soon (short remaining time, installed preferred)",
    "- 1 plan for tonight (timebox 30-60 min)",
    "- 1 re-onboarding tip if I have not played a chosen game lately.",
    "Return Markdown.",
  ];
  const dealsLines = [
    "Generate a compact deals digest (max 10 lines) from my exported prices.json or wishlist:",
    "- Top 3 discounts greater than 40% with final price and end date if known",
    "- 1 remark on value per hour if applicable",
    "Return Markdown.",
  ];
  const coach = coachLines.join("\n");
  const deals = dealsLines.join("\n");
  switch (scope) {
    case "both":
      return `${coach}

${deals}`;
    case "deals":
      return deals;
    case "coach":
    default:
      return coach;
  }
}


let disposerRef: (() => void) | null = null;

export function startAllyAutomationLoop(): () => void {
  if (!isTauri) {
    return () => {};
  }
  if (disposerRef) {
    return disposerRef;
  }

  let timer: number | null = null;
  let disposed = false;
  let ticking = false;

  const schedule = (delay = MINUTE) => {
    if (disposed) return;
    if (timer != null) {
      window.clearTimeout(timer);
    }
    timer = window.setTimeout(() => {
      void tick();
    }, delay);
  };

  const tick = async () => {
    if (disposed || ticking) {
      schedule();
      return;
    }
    ticking = true;
    try {
      const settings = await getAutomationSettings();
      if (!settings.enabled) {
        return;
      }
      const now = new Date();
      const nowMs = now.getTime();

      if (!isSameLocalDay(settings.lastExportISO, now)) {
        const exportTarget = toTodayTime(settings.exportEmbedStartTime);
        if (nowMs >= exportTarget) {
          try {
            await log("info", "automation.exportEmbedStart.begin", {
              label: LIBRARY_LABEL,
              scheduledFor: settings.exportEmbedStartTime,
            });
            await runExportEmbedStart(LIBRARY_LABEL);
            const stamp = new Date().toISOString();
            await saveAutomationSettings({
              lastExportISO: stamp,
              lastEmbedISO: stamp,
              lastStartISO: stamp,
            });
            await log("info", "automation.exportEmbedStart.success", {
              label: LIBRARY_LABEL,
              ms: Date.now() - nowMs,
            });
          } catch (error) {
            await log("error", "automation.exportEmbedStart.error", {
              label: LIBRARY_LABEL,
              error: error instanceof Error ? error.message : String(error),
            });
          }
        }
      }

      if (settings.digestEnabled && !isSameLocalDay(settings.lastDigestISO, now)) {
        const digestTarget = toTodayTime(settings.digestTime);
        if (nowMs >= digestTarget) {
          const prompt = buildDigestPrompt(settings.digestScope);
          try {
            await log("info", "automation.digest.begin", {
              allowWeb: settings.digestAllowWeb,
              scope: settings.digestScope,
            });
            const response = await runDigest(prompt, settings.digestAllowWeb);
            await persistDigest(response, "ok");
            await saveAutomationSettings({
              lastDigestISO: new Date().toISOString(),
              lastDigestStatus: "ok",
            });
            await log("info", "automation.digest.success", {
              scope: settings.digestScope,
              ms: Date.now() - nowMs,
            });
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            await persistDigest(message, "error");
            await saveAutomationSettings({
              lastDigestISO: new Date().toISOString(),
              lastDigestStatus: "error",
            });
            await log("error", "automation.digest.error", {
              scope: settings.digestScope,
              allowWeb: settings.digestAllowWeb,
              error: message,
            });
          }
        }
      }
    } finally {
      ticking = false;
      schedule();
    }
  };

  void tick();

  disposerRef = () => {
    if (disposed) return;
    disposed = true;
    if (timer != null) {
      window.clearTimeout(timer);
    }
    disposerRef = null;
  };

  return disposerRef;
}

export { buildDigestPrompt };
