import { exportAll } from "./export";
import { allyEmbed, allyStartRag, allyChat } from "../desktop/allyBridge";
import { getOrCreateSession } from "./session";
import { log } from "./log";

function friendlyAllyError(error: unknown): Error {
  const raw =
    error instanceof Error ? error.message : typeof error === "string" ? error : JSON.stringify(error);
  if (raw && raw.includes("ModuleNotFoundError: No module named 'rich'")) {
    return new Error(
      [
        "Ally sidecar is missing the Python dependency 'rich'.",
        "Install it inside the bundled Ally environment (e.g. run `python -m pip install rich` from apps/desktop/src-tauri/bin/ally) or reinstall the Ally sidecar.",
      ].join(" "),
    );
  }
  if (error instanceof Error) return error;
  return new Error(raw || "Ally command failed.");
}

type RunbookStep = { step: "export" | "embed" | "start"; out: unknown };

export async function runExportEmbedStart(label = "my_library"): Promise<RunbookStep[]> {
  const steps: RunbookStep[] = [];
  const startedAt = Date.now();

  try {
    await log("info", "runbook.export.start", { label });
    const exportResult = await exportAll(label);
    steps.push({ step: "export", out: exportResult });
    await log("info", "runbook.export.success", {
      label,
      files: exportResult.length,
      bytes: exportResult.reduce((sum, item) => sum + (item?.bytes ?? 0), 0),
    });
  } catch (error) {
    await log("error", "runbook.export.error", {
      label,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }

  try {
    await log("info", "runbook.embed.start", { label });
    const embedResult = await allyEmbed(label);
    steps.push({ step: "embed", out: embedResult });
    await log("info", "runbook.embed.success", { label, ms: Date.now() - startedAt });
  } catch (error) {
    const friendly = friendlyAllyError(error);
    await log("error", "runbook.embed.error", {
      label,
      error: error instanceof Error ? error.message : String(error),
    });
    throw friendly;
  }

  try {
    await log("info", "runbook.start.start", { label });
    const startResult = await allyStartRag(label);
    steps.push({ step: "start", out: startResult });
    await log("info", "runbook.start.success", { label, ms: Date.now() - startedAt });
  } catch (error) {
    const friendly = friendlyAllyError(error);
    await log("error", "runbook.start.error", {
      label,
      error: error instanceof Error ? error.message : String(error),
    });
    throw friendly;
  }

  return steps;
}

export async function runDigest(prompt: string, allowWeb = false, session?: string): Promise<string> {
  const sessionId = session ?? getOrCreateSession();
  const submittedAt = Date.now();
  await log("info", "runbook.digest.start", {
    allowWeb,
    promptLength: prompt.length,
  });
  try {
    const response = await allyChat(sessionId, prompt, allowWeb);
    await log("info", "runbook.digest.success", {
      allowWeb,
      ms: Date.now() - submittedAt,
      chars: response.length,
    });
    return response;
  } catch (error) {
    const friendly = friendlyAllyError(error);
    await log("error", "runbook.digest.error", {
      allowWeb,
      error: error instanceof Error ? error.message : String(error),
    });
    throw friendly;
  }
}
