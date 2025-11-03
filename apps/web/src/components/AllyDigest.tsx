import { useCallback, useEffect, useMemo, useState } from "react";
import {
  addDigest,
  getRecentDigests,
  getAutomationSettings,
  saveAutomationSettings,
  type AllyAutomationSettings,
  type AllyDigest,
} from "@/db";
import { runDigest } from "@/ally/runbook";
import { buildDigestPrompt } from "@/ally/automation";
import { isTauri } from "@/desktop/bridge";
import { log } from "@/ally/log";

type AllyDigestCardProps = {
  onUpdate?: (settings: AllyAutomationSettings) => void;
};

type DigestState = {
  automation: AllyAutomationSettings | null;
  items: AllyDigest[];
  loaded: boolean;
  running: boolean;
  error: string | null;
};

const INITIAL_STATE: DigestState = {
  automation: null,
  items: [],
  loaded: false,
  running: false,
  error: null,
};

function statusPillClass(status: AllyDigest["status"]) {
  return status === "ok"
    ? "inline-flex items-center rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-700"
    : "inline-flex items-center rounded-full bg-rose-100 px-2 py-0.5 text-xs font-semibold text-rose-700";
}

export default function AllyDigestCard({ onUpdate }: AllyDigestCardProps) {
  const desktop = isTauri;
  const [state, setState] = useState<DigestState>(INITIAL_STATE);
  const [expandedId, setExpandedId] = useState<number | null>(null);

  const load = useCallback(async () => {
    if (!desktop) return;
    setState((prev) => ({ ...prev, loaded: false }));
    try {
      const [automation, items] = await Promise.all([getAutomationSettings(), getRecentDigests()]);
      setState((prev) => ({
        ...prev,
        automation,
        items,
        loaded: true,
        error: null,
      }));
    } catch (error) {
      setState((prev) => ({
        ...prev,
        loaded: true,
        error: error instanceof Error ? error.message : String(error),
      }));
    }
  }, [desktop]);

  useEffect(() => {
    if (!desktop) return;
    void load();
  }, [desktop, load]);

  const latestRun = useMemo(() => {
    const digest = state.items[0];
    if (!digest) return null;
    const date = new Date(digest.createdAtISO);
    if (Number.isNaN(date.getTime())) return null;
    return { status: digest.status, label: date.toLocaleString() };
  }, [state.items]);

  const disabled = !desktop || !state.automation || state.running;

  const handleRunNow = useCallback(async () => {
    if (!desktop) return;
    const automation = state.automation ?? (await getAutomationSettings());
    setState((prev) => ({ ...prev, running: true, error: null }));
    const prompt = buildDigestPrompt(automation.digestScope);
    let digestId: number | null = null;
    try {
      const response = await runDigest(prompt, automation.digestAllowWeb);
      const entry = await addDigest(response, "ok");
      digestId = entry.id ?? null;
      const updated = await saveAutomationSettings({
        lastDigestISO: new Date().toISOString(),
        lastDigestStatus: "ok",
      });
      setState((prev) => ({
        ...prev,
        automation: updated,
      }));
      if (onUpdate) {
        onUpdate(updated);
      }
      await log("info", "digest.manual.success", {
        scope: automation.digestScope,
        allowWeb: automation.digestAllowWeb,
      });
      await load();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setState((prev) => ({ ...prev, error: message }));
      const entry = await addDigest(message, "error");
      digestId = entry.id ?? null;
      const updated = await saveAutomationSettings({
        lastDigestISO: new Date().toISOString(),
        lastDigestStatus: "error",
      });
      setState((prev) => ({
        ...prev,
        automation: updated,
      }));
      if (onUpdate) {
        onUpdate(updated);
      }
      await log("error", "digest.manual.error", {
        scope: automation.digestScope,
        allowWeb: automation.digestAllowWeb,
        error: message,
      });
      await load();
    } finally {
      setState((prev) => ({ ...prev, running: false }));
      if (digestId != null) {
        setExpandedId(digestId);
      }
    }
  }, [desktop, load, state.automation]);

  if (!desktop) return null;

  return (
    <section className="space-y-3 rounded-lg border border-zinc-200 bg-zinc-50 p-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-zinc-800">AI Digest</h2>
          <p className="text-xs text-zinc-500">
            Summaries generated from Ally exports. Latest run{" "}
            {latestRun ? (
              <>
                <span className={statusPillClass(latestRun.status)}>{latestRun.status.toUpperCase()}</span>{" "}
                <span className="font-medium text-zinc-700">{latestRun.label}</span>
              </>
            ) : (
              "not available"
            )}
            .
          </p>
        </div>
        <button
          type="button"
          className="btn"
          onClick={handleRunNow}
          disabled={disabled}
        >
          {state.running ? "Running..." : "Run digest now"}
        </button>
      </div>

      {state.error ? (
        <div className="rounded border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
          <div className="font-semibold">Digest failed.</div>
          <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap text-xs">{state.error}</pre>
        </div>
      ) : null}

      {!state.loaded ? (
        <div className="text-sm text-zinc-500">Loading recent digests...</div>
      ) : state.items.length === 0 ? (
        <div className="text-sm text-zinc-500">No digests recorded yet.</div>
      ) : (
        <ul className="space-y-2">
          {state.items.map((digest) => {
            const date = new Date(digest.createdAtISO);
            const label = Number.isNaN(date.getTime()) ? digest.createdAtISO : date.toLocaleString();
            const isOpen = expandedId === digest.id;
            return (
              <li key={digest.id ?? label} className="rounded-lg border border-zinc-200 bg-white p-3 shadow-sm">
                <button
                  type="button"
                  className="flex w-full items-center justify-between gap-2 text-left"
                  onClick={() => setExpandedId(isOpen ? null : digest.id ?? null)}
                >
                  <span className="text-sm font-medium text-zinc-800">{label}</span>
                  <span className={statusPillClass(digest.status)}>{digest.status.toUpperCase()}</span>
                </button>
                {isOpen ? (
                  <pre className="mt-3 max-h-64 overflow-auto whitespace-pre-wrap rounded border border-zinc-100 bg-zinc-50 p-3 text-sm text-zinc-700">
                    {digest.content}
                  </pre>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
