import { useCallback, useEffect, useMemo, useState } from "react";
import Modal from "./Modal";
import { db, type EnrichStatus } from "@/db";
import {
  useEnrichmentRunner,
  type EnrichRow,
  type RunnerSnapshot,
} from "@/state/enrichmentRunner";
import { isTauri } from "@/desktop/bridge";
import {
  readCSV,
  rowsToEntities,
  type FieldMap,
  type IncomingRow,
  type Identity,
  type LibraryItem,
} from "@tracker/core";

type Step = "source" | "map" | "review" | "enrich";

const STEPS: Step[] = ["source", "map", "review", "enrich"];
const STEP_LABELS: Record<Step, string> = {
  source: "Select source",
  map: "Map columns",
  review: "Review & import",
  enrich: "Enrich metadata",
};

type ImportWizardProps = {
  open: boolean;
  onClose: () => void;
  onImported?: () => Promise<void> | void;
};

type PreviewBundle = {
  identities: Identity[];
  library: LibraryItem[];
};

export default function ImportWizard({ open, onClose, onImported }: ImportWizardProps) {
  const [step, setStep] = useState<Step>("source");
  const [fileName, setFileName] = useState<string>("");
  const [rawRows, setRawRows] = useState<IncomingRow[]>([]);
  const [fieldMap, setFieldMap] = useState<FieldMap>({});
  const [preview, setPreview] = useState<PreviewBundle | null>(null);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingEnrichRows, setPendingEnrichRows] = useState<EnrichRow[]>([]);
  const [autoStartEnrich, setAutoStartEnrich] = useState(true);

  const { snapshot, start, pause, resume, cancel } = useEnrichmentRunner();

  const columns = useMemo(() => {
    const keys = new Set<string>();
    for (const row of rawRows) {
      Object.keys(row).forEach((key) => keys.add(key));
    }
    return Array.from(keys);
  }, [rawRows]);

  useEffect(() => {
    if (!open) {
      return;
    }
    setError(null);
    if (snapshot.sessionId) {
      setStep("enrich");
    } else if (!rawRows.length) {
      setStep("source");
    }
  }, [open, snapshot.sessionId, rawRows.length]);

  const resetWizard = () => {
    setFileName("");
    setRawRows([]);
    setFieldMap({});
    setPreview(null);
    setPendingEnrichRows([]);
    setAutoStartEnrich(true);
    setError(null);
    setStep("source");
  };

  const handleClose = () => {
    onClose();
  };

  const handleFile = async (file: File) => {
    try {
      const text = await file.text();
      let rows: IncomingRow[];
      if (file.name.endsWith(".json")) {
        const parsed = JSON.parse(text);
        if (!Array.isArray(parsed)) {
          throw new Error("JSON import expects an array of rows.");
        }
        rows = parsed as IncomingRow[];
      } else {
        rows = readCSV(text) as IncomingRow[];
      }
      if (!rows.length) {
        throw new Error("No rows detected in file.");
      }
      setFileName(file.name);
      setRawRows(rows);
      const guessed = guessFieldMap(rows);
      setFieldMap(guessed);
      setStep("map");
      setError(null);
    } catch (err: any) {
      setError(err?.message || "Failed to read file.");
    }
  };

  const buildPreview = () => {
    if (!rawRows.length) {
      setError("No rows loaded.");
      return;
    }
    if (!fieldMap.title) {
      setError("Map at least the Title column.");
      return;
    }
    try {
      const bundle = rowsToEntities(rawRows, fieldMap);
      if (!bundle.library.length) {
        setError("Import produced no library rows.");
        return;
      }
      setPreview(bundle);
      const identityById = new Map(bundle.identities.map((i) => [i.id, i] as const));
      const tasks: EnrichRow[] = bundle.library.map((item) => ({
        id: item.id,
        identityId: item.identityId,
        title: identityById.get(item.identityId)?.title ?? "Untitled",
        appid: identityById.get(item.identityId)?.appid,
      }));
      setPendingEnrichRows(tasks);
      setStep("review");
      setError(null);
    } catch (err: any) {
      setError(err?.message || "Failed to build preview.");
    }
  };

  const handleImport = async () => {
    if (!preview) return;
    setImporting(true);
    setError(null);
    try {
      await db.transaction("rw", db.identities, db.library, async () => {
        if (preview.identities.length) {
          await db.identities.bulkPut(preview.identities);
        }
        if (preview.library.length) {
          await db.library.bulkPut(preview.library);
        }
      });
      if (onImported) {
        await onImported();
      }
      setImporting(false);
      setStep("enrich");
    } catch (err: any) {
      setImporting(false);
      setError(err?.message || "Failed to persist imported data.");
    }
  };

  const handleStartEnrichment = useCallback(() => {
    if (!pendingEnrichRows.length) {
      setError("Nothing to enrich.");
      return;
    }
    if (snapshot.sessionId) {
      setError("Enrichment already running. Pause or cancel it first.");
      return;
    }
    const region = (localStorage.getItem("steam_cc") || "us").toLowerCase();
    start(pendingEnrichRows, { region });
    setPendingEnrichRows([]);
    setAutoStartEnrich(true);
  }, [pendingEnrichRows, snapshot.sessionId, start]);

  const stepIndex = STEPS.indexOf(step);

  return (
    <Modal open={open} onClose={handleClose} title="Import Library">
      <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-zinc-500">
        {STEPS.map((s, idx) => (
          <span
            key={s}
            className={idx === stepIndex ? "font-semibold text-zinc-900" : "opacity-70"}
          >
            {STEP_LABELS[s]}
            {idx < STEPS.length - 1 ? " ·" : ""}
          </span>
        ))}
      </div>

      {error && (
        <div className="mt-3 rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="mt-4">
        {step === "source" && (
          <SourceStep
            fileName={fileName}
            onReset={resetWizard}
            onFile={handleFile}
          />
        )}

        {step === "map" && (
          <MapStep
            columns={columns}
            fieldMap={fieldMap}
            onChange={setFieldMap}
            onBack={() => setStep("source")}
            onNext={buildPreview}
          />
        )}

        {step === "review" && preview && (
          <ReviewStep
            preview={preview}
            onBack={() => setStep("map")}
            onImport={handleImport}
            importing={importing}
            autoStart={autoStartEnrich}
            onAutoStartChange={setAutoStartEnrich}
          />
        )}

        {step === "enrich" && (
          <EnrichStep
            pendingRows={pendingEnrichRows}
            autoStart={autoStartEnrich}
            onStart={handleStartEnrichment}
            onClose={handleClose}
            onReset={resetWizard}
            snapshot={snapshot}
            pause={pause}
            resume={resume}
            cancel={cancel}
          />
        )}
      </div>
    </Modal>
  );
}

function SourceStep({
  fileName,
  onFile,
  onReset,
}: {
  fileName: string;
  onFile: (file: File) => void;
  onReset: () => void;
}) {
  return (
    <div className="space-y-4">
      <p className="text-sm text-zinc-600">
        Import a CSV or JSON export of your library. The wizard will help map fields,
        review rows, and optionally enrich metadata in the background.
      </p>

      <label className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-zinc-300 bg-zinc-50 px-6 py-8 text-center hover:border-zinc-400">
        <span className="text-sm font-medium text-zinc-700">
          {fileName ? "Replace file" : "Select a file"}
        </span>
        <span className="text-xs text-zinc-500">CSV (.csv) or JSON (.json)</span>
        <input
          type="file"
          accept=".csv,.json"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) onFile(file);
            event.target.value = "";
          }}
        />
      </label>

      {fileName && (
        <div className="flex items-center justify-between rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm">
          <span className="truncate">{fileName}</span>
          <button type="button" className="btn-ghost" onClick={onReset}>
            Reset
          </button>
        </div>
      )}
    </div>
  );
}

function MapStep({
  columns,
  fieldMap,
  onChange,
  onBack,
  onNext,
}: {
  columns: string[];
  fieldMap: FieldMap;
  onChange: (map: FieldMap) => void;
  onBack: () => void;
  onNext: () => void;
}) {
  const fields: Array<{ key: keyof FieldMap; label: string; required?: boolean }> = [
    { key: "title", label: "Title", required: true },
    { key: "platform", label: "Platform" },
    { key: "status", label: "Status" },
    { key: "memberId", label: "Member" },
    { key: "accountId", label: "Account / Store" },
    { key: "priceTRY", label: "Price" },
    { key: "acquiredAt", label: "Acquired at" },
    { key: "ocScore", label: "OpenCritic score" },
    { key: "ttbMedianMainH", label: "HowLongToBeat main (hrs)" },
    { key: "services", label: "Tags / Services" },
  ];

  const handleSelect = (key: keyof FieldMap, value: string) => {
    onChange({
      ...fieldMap,
      [key]: value || undefined,
    });
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-zinc-600">
        Match the columns from your file to Game Tracker fields. Required fields are marked.
      </p>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {fields.map((field) => (
          <label key={field.key} className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-zinc-700">
              {field.label}
              {field.required ? " *" : ""}
            </span>
            <select
              className="select"
              value={fieldMap[field.key] ?? ""}
              onChange={(event) => handleSelect(field.key, event.target.value)}
            >
              <option value="">-- Ignore --</option>
              {columns.map((col) => (
                <option key={col} value={col}>
                  {col}
                </option>
              ))}
            </select>
          </label>
        ))}
      </div>

      <div className="flex justify-between pt-2">
        <button type="button" className="btn-ghost" onClick={onBack}>
          Back
        </button>
        <button type="button" className="btn" onClick={onNext}>
          Continue
        </button>
      </div>
    </div>
  );
}

function ReviewStep({
  preview,
  onBack,
  onImport,
  importing,
  autoStart,
  onAutoStartChange,
}: {
  preview: PreviewBundle;
  onBack: () => void;
  onImport: () => void;
  importing: boolean;
  autoStart: boolean;
  onAutoStartChange: (value: boolean) => void;
}) {
  const topRows = preview.library.slice(0, 6);
  const identityById = new Map(preview.identities.map((i) => [i.id, i] as const));

  return (
    <div className="space-y-4">
      <p className="text-sm text-zinc-600">
        {preview.identities.length} identities and {preview.library.length} library rows detected.
      </p>

      <div className="max-h-64 overflow-auto rounded-md border border-zinc-200">
        <table className="table">
          <thead>
            <tr>
              <th>Title</th>
              <th>Platform</th>
              <th>Status</th>
              <th>Member</th>
            </tr>
          </thead>
          <tbody>
            {topRows.map((row) => {
              const identity = identityById.get(row.identityId);
              return (
                <tr key={row.id}>
                  <td>{identity?.title ?? "-"}</td>
                  <td>{identity?.platform ?? "-"}</td>
                  <td>{row.status}</td>
                  <td>{row.memberId ?? "everyone"}</td>
                </tr>
              );
            })}
            {preview.library.length > topRows.length && (
              <tr>
                <td colSpan={4} className="text-xs text-zinc-500">
                  Showing first {topRows.length} rows of {preview.library.length}.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <label className="flex items-center gap-2 text-sm text-zinc-600">
        <input
          type="checkbox"
          checked={autoStart}
          onChange={(event) => onAutoStartChange(event.target.checked)}
        />
        Start desktop enrichment after import
      </label>

      <div className="flex justify-between pt-2">
        <button type="button" className="btn-ghost" onClick={onBack} disabled={importing}>
          Back
        </button>
        <button type="button" className="btn" onClick={onImport} disabled={importing}>
          {importing ? "Importing…" : "Import rows"}
        </button>
      </div>
    </div>
  );
}

function EnrichStep({
  pendingRows,
  autoStart,
  onStart,
  onClose,
  onReset,
  snapshot,
  pause,
  resume,
  cancel,
}: {
  pendingRows: EnrichRow[];
  autoStart: boolean;
  onStart: () => void;
  onClose: () => void;
  onReset: () => void;
  snapshot: RunnerSnapshot;
  pause: () => void;
  resume: () => void;
  cancel: () => void;
}) {
  const hasSession = Boolean(snapshot.sessionId);
  const rowsQueued = snapshot.queue.length;
  const rowsRemaining = snapshot.queue.filter(
    (row) => row.status === "pending" || row.status === "paused" || row.status === "fetching",
  ).length;
  const readyToStart = pendingRows.length > 0 && !hasSession;
  const sessionActive = Boolean(snapshot.sessionId && !snapshot.finished);

  useEffect(() => {
    if (autoStart && pendingRows.length && !hasSession && isTauri) {
      onStart();
    }
  }, [autoStart, pendingRows.length, hasSession, onStart]);

  return (
    <div className="space-y-4">
      <section className="space-y-2">
        <header className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-zinc-800">Desktop enrichment</h3>
          {!isTauri && (
            <span className="rounded-full border border-amber-300 bg-amber-50 px-2 py-1 text-xs text-amber-700">
              Desktop-only
            </span>
          )}
        </header>
        {!hasSession && pendingRows.length > 0 && (
          <p className="text-sm text-zinc-600">
            {pendingRows.length} newly imported rows are ready for enrichment.
          </p>
        )}
        {hasSession && (
          <p className="text-sm text-zinc-600">
            {rowsRemaining} of {rowsQueued} rows remaining. Manage the background runner here or hide the wizard.
          </p>
        )}
        {!hasSession && !pendingRows.length && (
          <p className="text-sm text-zinc-600">
            No queued rows. You can close the wizard or start a new import.
          </p>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            className="btn"
            onClick={onStart}
            disabled={!readyToStart || !isTauri}
            title={isTauri ? "Start enrichment" : "Requires desktop build"}
          >
            Start enrichment
          </button>
          {hasSession && (
            <>
              <button
                type="button"
                className="btn-ghost"
                onClick={() => (snapshot.paused ? resume() : pause())}
                aria-pressed={snapshot.paused}
              >
                {snapshot.paused ? "Resume" : "Pause"}
              </button>
              <button type="button" className="btn-ghost" onClick={() => cancel()}>
                Cancel
              </button>
            </>
          )}
          <button type="button" className="btn-ghost" onClick={onClose}>
            Hide &amp; continue
          </button>
        </div>
      </section>

      <section className="space-y-2">
        <header className="flex items-center justify-between text-sm font-semibold text-zinc-800">
          <span>Progress</span>
          <span className="text-xs font-normal text-zinc-500">
            {snapshot.completedCount} / {snapshot.totalRows}
          </span>
        </header>
        {snapshot.queue.length === 0 ? (
          <div className="rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-600">
            No enrichment session active.
          </div>
        ) : (
          <div className="max-h-52 overflow-auto rounded-md border border-zinc-200">
            <table className="table">
              <thead>
                <tr>
                  <th>Title</th>
                  <th>Status</th>
                  <th>Notes</th>
                </tr>
              </thead>
              <tbody>
                {snapshot.queue.map((row) => (
                  <tr key={row.id}>
                    <td>{row.title}</td>
                    <td>
                      <StatusChip status={row.status} />
                    </td>
                    <td className="text-xs text-zinc-500">
                      {row.message ?? "\u2014"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="space-y-2">
        <header className="text-sm font-semibold text-zinc-800">Latest items</header>
        {snapshot.recent.length === 0 ? (
          <p className="text-sm text-zinc-600">No items enriched yet.</p>
        ) : (
          <ul className="space-y-1" aria-live="polite">
            {snapshot.recent.map((item) => (
              <li
                key={`${item.id}-${item.finishedAt}`}
                className="flex items-center justify-between rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm"
              >
                <span className="truncate">{item.title}</span>
                <span className="text-xs text-zinc-500">
                  {item.currencyCode && item.price != null
                    ? `${item.currencyCode} ${item.price}`
                    : ""}
                  {item.ttb != null ? ` · ${item.ttb}h` : ""}
                  {item.ocScore != null ? ` · OC ${item.ocScore}` : ""}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <div className="flex justify-between border-t border-zinc-200 pt-3">
        <button
          type="button"
          className="btn-ghost"
          onClick={onReset}
          disabled={sessionActive}
          title={
            sessionActive
              ? "Cancel or finish the running session before resetting."
              : "Reset the wizard to start a fresh import."
          }
        >
          Start over
        </button>
        <button
          type="button"
          className="btn"
          onClick={onClose}
          disabled={sessionActive}
          title={
            sessionActive
              ? "Runner active in background. Use Hide to continue browsing."
              : "Close wizard"
          }
        >
          Done
        </button>
      </div>
    </div>
  );
}

function StatusChip({ status }: { status: EnrichStatus }) {
  const label = statusLabel(status);
  return (
    <span
      className={`enrich-chip enrich-chip--${status}`}
      aria-label={label}
      role="status"
    >
      {label}
    </span>
  );
}

function statusLabel(status: EnrichStatus) {
  switch (status) {
    case "pending":
      return "Pending";
    case "fetching":
      return "Fetching";
    case "paused":
      return "Paused";
    case "done":
      return "Done";
    case "skipped":
      return "Skipped";
    case "error":
      return "Error";
    default:
      return status;
  }
}

function guessFieldMap(rows: IncomingRow[]): FieldMap {
  if (!rows.length) return {};
  const columns = Array.from(
    new Set(rows.flatMap((row) => Object.keys(row).map((key) => key.trim()))),
  );
  const find = (...patterns: RegExp[]) => {
    return (
      columns.find((col) => patterns.some((re) => re.test(col.toLowerCase()))) ?? undefined
    );
  };
  return {
    title: find(/title/, /name/, /game/),
    platform: find(/platform/, /system/),
    status: find(/status/, /state/),
    memberId: find(/member/, /player/, /profile/),
    accountId: find(/account/, /store/, /service/),
    priceTRY: find(/price/, /cost/),
    acquiredAt: find(/acquired/, /added/, /date/),
    ocScore: find(/opencritic/, /critic/, /score/),
    ttbMedianMainH: find(/ttb/, /howlong/, /main/),
    services: find(/service/, /subscription/, /tag/),
  };
}
