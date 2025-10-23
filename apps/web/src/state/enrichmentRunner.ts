import { useSyncExternalStore } from "react";
import {
  db,
  clearEnrichSession,
  getEnrichSession,
  setEnrichSession,
  type EnrichSession,
  type EnrichRowSnapshot,
  type EnrichRowSummary,
  type EnrichStatus,
} from "@/db";
import {
  fetchHLTB,
  fetchOpenCriticScore,
  fetchSteamPrice,
  isTauri,
} from "@/desktop/bridge";

const INIT_MIN_MS = 600;

export type EnrichRow = {
  id: string;
  identityId: string;
  title: string;
  appid?: number | null;
};

export type RunnerPhase = "idle" | "init" | "active" | "paused" | "done";

export type RunnerSnapshot = {
  sessionId: string | null;
  totalRows: number;
  completedCount: number;
  paused: boolean;
  startedAt: number | null;
  lastUpdated: number | null;
  currentRowId: string | null;
  queue: EnrichRowSnapshot[];
  recent: EnrichRowSummary[];
  region?: string;
  finished: boolean;
  message?: string | null;
  isDesktop: boolean;
  phase: RunnerPhase;
};

type Listener = () => void;

type InternalRow = EnrichRowSnapshot & {
  attempts: {
    steam: number;
    hltb: number;
    oc: number;
  };
};

class EnrichmentRunner {
  private listeners = new Set<Listener>();
  private queue: InternalRow[] = [];
  private sessionId: string | null = null;
  private startedAt: number | null = null;
  private lastUpdated: number | null = null;
  private paused = true;
  private currentRowId: string | null = null;
  private processing: Promise<void> | null = null;
  private resumeResolvers: Array<() => void> = [];
  private recent: EnrichRowSummary[] = [];
  private message: string | null = null;
  private finished = false;
  private region?: string;
  private phase: RunnerPhase = "idle";
  private initStartedAt: number | null = null;
  private pendingActiveTimer: ReturnType<typeof setTimeout> | null = null;
  private snapshot: RunnerSnapshot = this.buildSnapshot();

  constructor() {
    void this.hydrate();
  }

  private clearPendingActiveTimer() {
    if (this.pendingActiveTimer) {
      clearTimeout(this.pendingActiveTimer);
      this.pendingActiveTimer = null;
    }
  }

  private requestActiveTransition(): boolean {
    if (this.phase !== "init") return false;
    const now = Date.now();
    if (this.initStartedAt == null) {
      this.initStartedAt = now;
    }
    const elapsed = now - this.initStartedAt;
    if (elapsed >= INIT_MIN_MS) {
      this.phase = "active";
      this.clearPendingActiveTimer();
      return true;
    }
    if (!this.pendingActiveTimer) {
      const remaining = INIT_MIN_MS - elapsed;
      this.pendingActiveTimer = setTimeout(() => {
        this.pendingActiveTimer = null;
        if (this.phase === "init") {
          this.phase = "active";
          this.emit();
        }
      }, remaining);
    }
    return false;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  getSnapshot(): RunnerSnapshot {
    return this.snapshot;
  }

  async start(rows: EnrichRow[], opts?: { region?: string }) {
    if (!rows.length) return;
    this.cancel();
    if (!isTauri) {
      const now = Date.now();
      this.sessionId = null;
      this.startedAt = now;
      this.lastUpdated = now;
      this.paused = true;
      this.finished = true;
      this.message = "Desktop-only enrichment. Launch the desktop app to fetch metadata.";
      this.phase = "done";
      this.initStartedAt = null;
      this.clearPendingActiveTimer();
      this.queue = rows.map<InternalRow>((row) => ({
        id: row.id,
        identityId: row.identityId,
        title: row.title,
        appid: row.appid,
        status: "error",
        updatedAt: now,
        price: null,
        currencyCode: null,
        ttb: null,
        ttbSource: undefined,
        ocScore: null,
        message: "Desktop-only enrichment",
        attempts: { steam: 0, hltb: 0, oc: 0 },
      }));
      this.recent = [];
      this.emit();
      return;
    }

    const now = Date.now();
    this.sessionId = makeSessionId();
    this.startedAt = now;
    this.lastUpdated = now;
    this.paused = false;
    this.currentRowId = null;
    this.finished = false;
    this.message = null;
    this.region = opts?.region;
    this.phase = "init";
    this.initStartedAt = now;
    this.clearPendingActiveTimer();
    this.queue = rows.map<InternalRow>((row) => ({
      id: row.id,
      identityId: row.identityId,
      title: row.title,
      appid: row.appid,
      status: "pending",
      updatedAt: now,
      price: null,
      currencyCode: null,
      ttb: null,
      ttbSource: undefined,
      ocScore: null,
      message: null,
      attempts: { steam: 0, hltb: 0, oc: 0 },
    }));
    this.recent = [];
    this.emit();
    this.ensureProcessing();
  }

  pause() {
    if (!this.sessionId) return;
    this.paused = true;
    this.message = "Pausing...";
    this.phase = "paused";
    this.clearPendingActiveTimer();
    this.emit();
  }

  resume() {
    if (!this.sessionId) return;
    if (!isTauri) {
      this.message = "Desktop-only enrichment. Launch the desktop app to resume.";
      this.emit();
      return;
    }

    this.paused = false;
    this.message = null;
    const hasProgress = this.queue.some(
      (row) => row.status === "fetching" || row.status === "done",
    );
    if (hasProgress) {
      this.phase = "active";
      this.clearPendingActiveTimer();
    } else {
      this.phase = "init";
      if (this.initStartedAt == null) {
        this.initStartedAt = Date.now();
      }
    }
    const listeners = [...this.resumeResolvers];
    this.resumeResolvers = [];
    listeners.forEach((resolve) => resolve());
    this.emit();
    this.ensureProcessing();
  }

  cancel(clearPersist = true) {
    if (!this.sessionId && !this.queue.length) return;
    this.sessionId = null;
    this.startedAt = null;
    this.lastUpdated = null;
    this.paused = true;
    this.currentRowId = null;
    this.message = null;
    this.finished = false;
    this.queue = [];
    this.recent = [];
    const listeners = [...this.resumeResolvers];
    this.resumeResolvers = [];
    listeners.forEach((resolve) => resolve());
    this.phase = "idle";
    this.initStartedAt = null;
    this.clearPendingActiveTimer();
    if (clearPersist) {
      void clearEnrichSession();
    }
    this.emit();
  }

  private ensureProcessing() {
    if (this.processing || !this.sessionId || this.paused) return;
    this.processing = this.processLoop().finally(() => {
      this.processing = null;
    });
  }

  private async processLoop() {
    while (this.sessionId) {
      if (this.paused) {
        await this.waitForResume();
        continue;
      }

      const next =
        this.queue.find((row) => row.id === this.currentRowId && row.status === "fetching") ??
        this.queue.find((row) => row.status === "pending" || row.status === "paused");

      if (!next) break;

      this.currentRowId = next.id;
      next.status = "fetching";
      next.updatedAt = Date.now();
      next.message = null;
      this.message = `Fetching ${next.title}`;
      this.requestActiveTransition();
      this.emit();

      const outcome = await this.runRow(next);
      if (outcome === "paused") {
        continue;
      }
    }

    if (
      this.sessionId &&
      !this.queue.some((row) => row.status === "pending" || row.status === "fetching" || row.status === "paused")
    ) {
      this.finished = true;
      this.message = "Enrichment finished.";
      this.lastUpdated = Date.now();
      this.phase = "done";
      this.initStartedAt = null;
      this.clearPendingActiveTimer();
      this.emit();
      this.sessionId = null;
      await clearEnrichSession();
      this.emit();
    }
  }

  private waitForResume() {
    if (!this.sessionId) return Promise.resolve();
    return new Promise<void>((resolve) => {
      this.resumeResolvers.push(resolve);
    });
  }

  private async runRow(row: InternalRow): Promise<"done" | "paused"> {
    if (!this.sessionId) return "paused";
    if (this.paused) {
      row.status = "paused";
      row.updatedAt = Date.now();
      this.emit();
      return "paused";
    }

    try {
      const identity = await db.identities.get(row.identityId);
      if (identity) {
        row.title = identity.title ?? row.title;
        row.appid = identity.appid ?? row.appid;
      }
    } catch (_err) {
      // Dexie lookup errors are ignored; we rely on best-effort data.
    }

    // Steam price
    if (row.appid) {
      const steam = await this.tryWithRetries("steam", row, () =>
        fetchSteamPrice(row.appid!, this.region),
      );
      if (steam.kind === "paused") {
        row.status = "paused";
        row.updatedAt = Date.now();
        this.emit();
        return "paused";
      }
      if (steam.kind === "ok") {
        if (steam.value) {
          const { price, currency } = steam.value;
          row.price = price;
          row.currencyCode = currency;
          try {
            await db.library.update(row.id, {
              priceTRY: price,
              currencyCode: currency,
            } as any);
          } catch (_err) {
            // Swallow Dexie write failures; progress UI will still advance.
          }
        } else {
          appendMessage(row, "Steam price: not found after retries.");
        }
      } else if (steam.kind === "error") {
        appendMessage(row, steam.message);
      }
      if (this.paused) {
        row.status = "paused";
        row.updatedAt = Date.now();
        this.emit();
        return "paused";
      }
    }

    // HowLongToBeat
    const hltb = await this.tryWithRetries("hltb", row, () => fetchHLTB(row.title));
    if (hltb.kind === "paused") {
      row.status = "paused";
      row.updatedAt = Date.now();
      this.emit();
      return "paused";
    }
    if (hltb.kind === "ok") {
      const meta = hltb.value;
      if (meta.mainMedianHours != null) {
        row.ttb = meta.mainMedianHours;
        row.ttbSource = meta.source;
        try {
          await db.library.update(row.id, { ttbMedianMainH: row.ttb } as any);
          await db.identities.update(row.identityId, {
            ttbMedianMainH: row.ttb,
            ttbSource: row.ttbSource,
          } as any);
        } catch (_err) {
          // Ignore Dexie write errors.
        }
      } else {
        appendMessage(row, "HowLongToBeat: not found.");
      }
    } else if (hltb.kind === "error") {
      appendMessage(row, hltb.message);
    }
    if (this.paused) {
      row.status = "paused";
      row.updatedAt = Date.now();
      this.emit();
      return "paused";
    }

    // OpenCritic
    const oc = await this.tryWithRetries("oc", row, () => fetchOpenCriticScore(row.title));
    if (oc.kind === "paused") {
      row.status = "paused";
      row.updatedAt = Date.now();
      this.emit();
      return "paused";
    }
    if (oc.kind === "ok") {
      if (oc.value != null) {
        row.ocScore = Math.round(oc.value);
        try {
          await db.library.update(row.id, { ocScore: row.ocScore } as any);
        } catch (_err) {
          // Ignore Dexie write errors.
        }
      } else {
        appendMessage(row, "OpenCritic: not found.");
      }
    } else if (oc.kind === "error") {
      appendMessage(row, oc.message);
    }

    row.status = "done";
    row.updatedAt = Date.now();
    this.lastUpdated = row.updatedAt;

    this.recent = [
      {
        id: row.id,
        title: row.title,
        finishedAt: row.updatedAt,
        price: row.price ?? undefined,
        currencyCode: row.currencyCode ?? undefined,
        ttb: row.ttb ?? undefined,
        ocScore: row.ocScore ?? undefined,
      },
      ...this.recent,
    ].slice(0, 10);

    this.requestActiveTransition();
    this.emit();
    return "done";
  }

  private async hydrate() {
    const stored = await getEnrichSession();
    if (!stored) {
      this.emit();
      return;
    }
    this.sessionId = stored.sessionId;
    this.startedAt = stored.startedAt;
    this.lastUpdated = stored.lastUpdated;
    this.paused = true;
    this.currentRowId = null;
    this.finished = false;
    this.region = stored.region;
    this.queue = stored.queue.map<InternalRow>((row) => ({
      ...row,
      status: row.status === "fetching" ? "paused" : row.status,
      attempts: { steam: 0, hltb: 0, oc: 0 },
    }));
    this.recent = stored.recent ?? [];
    this.message = "Ready to resume enrichment.";
    this.phase = stored.phase ?? (this.queue.length ? "paused" : "done");
    this.initStartedAt = null;
    this.clearPendingActiveTimer();
    this.emit();
  }

  private buildSnapshot(): RunnerSnapshot {
    const completed = this.queue.filter((row) => row.status === "done").length;
    return {
      sessionId: this.sessionId,
      totalRows: this.queue.length,
      completedCount: completed,
      paused: this.paused,
      startedAt: this.startedAt,
      lastUpdated: this.lastUpdated,
      currentRowId: this.currentRowId,
      queue: this.queue.map((row) => ({ ...row })),
      recent: [...this.recent],
      region: this.region,
      finished: this.finished,
      message: this.message,
      isDesktop: isTauri,
      phase: this.phase,
    };
  }

  private emit() {
    this.snapshot = this.buildSnapshot();
    this.listeners.forEach((listener) => listener());
    if (this.sessionId) {
      const payload: EnrichSession = {
        sessionId: this.sessionId,
        startedAt: this.startedAt ?? Date.now(),
        lastUpdated: this.lastUpdated ?? Date.now(),
        paused: this.paused,
      totalRows: this.queue.length,
      completedCount: this.queue.filter((row) => row.status === "done").length,
      region: this.region,
      queue: this.queue.map((row) => ({ ...row })),
      recent: [...this.recent],
      phase: this.phase,
    };
      void setEnrichSession(payload);
    } else {
      void clearEnrichSession();
    }
  }

  private async tryWithRetries<T>(
    stage: "steam" | "hltb" | "oc",
    row: InternalRow,
    task: () => Promise<T>,
  ): Promise<
    | { kind: "ok"; value: T }
    | { kind: "error"; message: string }
    | { kind: "paused" }
  > {
    const attempts = row.attempts;
    const label =
      stage === "steam"
        ? "Steam price"
        : stage === "hltb"
        ? "HowLongToBeat"
        : "OpenCritic";
    let lastError: unknown = null;

    for (let attempt = 0; attempt < 3; attempt++) {
      if (this.paused || !this.sessionId) {
        return { kind: "paused" };
      }
      attempts[stage]++;
      try {
        const value = await task();
        return { kind: "ok", value };
      } catch (err: any) {
        lastError = err;
        if (this.paused || !this.sessionId) {
          return { kind: "paused" };
        }
        if (attempt < 2) {
          const delay = 700 + Math.floor(Math.random() * 300);
          if (this.paused) {
            return { kind: "paused" };
          }
          await sleep(delay);
          if (this.paused || !this.sessionId) {
            return { kind: "paused" };
          }
        }
      }
    }

    const message =
      typeof (lastError as any)?.message === "string"
        ? `${label}: ${(lastError as any).message}`
        : `${label}: not found after retries.`;
    return { kind: "error", message };
  }
}

function appendMessage(row: InternalRow, text: string) {
  if (!text) return;
  row.message = row.message ? `${row.message}; ${text}` : text;
}

function makeSessionId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `sess-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}

const runner = new EnrichmentRunner();

export function useEnrichmentRunner() {
  const snapshot = useSyncExternalStore(
    (listener) => runner.subscribe(listener),
    () => runner.getSnapshot(),
    () => runner.getSnapshot(),
  );

  return {
    snapshot,
    start: runner.start.bind(runner),
    pause: runner.pause.bind(runner),
    resume: runner.resume.bind(runner),
    cancel: runner.cancel.bind(runner),
  };
}

export function getEnrichmentRunner() {
  return runner;
}
