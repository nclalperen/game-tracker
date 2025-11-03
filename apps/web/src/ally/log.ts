import { appendAllyLog, getRecentAllyLogs, clearAllyLogs, type AllyLogRow } from "@/db";

export type AllyLog = {
  atISO: string;
  level: "info" | "warn" | "error";
  msg: string;
  ctx?: unknown;
};

export async function log(level: AllyLog["level"], msg: string, ctx?: unknown): Promise<void> {
  if (typeof console !== "undefined") {
    const prefix = `[ally:${level}]`;
    if (level === "error") {
      console.error(prefix, msg, ctx);
    } else if (level === "warn") {
      console.warn(prefix, msg, ctx);
    } else {
      console.info(prefix, msg, ctx);
    }
  }
  await appendAllyLog({ level, msg, ctx });
}

export async function getLogs(limit = 200): Promise<AllyLogRow[]> {
  return getRecentAllyLogs(limit);
}

export { clearAllyLogs };
