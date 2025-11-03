import {
  db,
  clearEnrichSession,
  getEnrichSession,
  setEnrichSession,
  getSteamPriceRow,
  upsertSteamPriceRow,
  isSteamPriceStale,
  type EnrichSession,
  type EnrichRowSnapshot,
  type EnrichRowSummary,
  type EnrichStatus,
} from "@/db";
import { fetchHLTB, fetchOpenCriticScore, fetchSteamPrice, isTauri } from "@/desktop/bridge";
import { lookupLocalHLTB } from "@/data/localDatasets";
import { ensureRawgDetail } from "@/data/rawgCache";
import { getMCEntry, loadMCIndex, type MCEntry } from "@/data/metacriticIndex";
import { computeMcKeyAsync, normalizeTitleKeyAsync } from "@/workers/normalizeClient";
import { useSyncExternalStore } from "react";
import type { Identity } from "@tracker/core";

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
  halted: boolean;
};

type Listener = () => void;

type EnrichRowStage = "vendor" | "fallback";

type InternalRow = EnrichRowSnapshot & {
  attempts: {
    steam: number;
    hltb: number;
    oc: number;
  };
  stage: EnrichRowStage;
};

/** Higher values win; enforces Metacritic > OpenCritic > RAWG precedence. */
const enum CriticPriority {
  None = 0,
  Rawg = 1,
  OpenCritic = 2,
  Metacritic = 3,
}

/** Higher values win; vendor/curated TTB beats live scrape, which beats RAWG estimates. */
const enum TtbPriority {
  None = 0,
  Rawg = 1,
  HltbLive = 2,
  Vendor = 3,
  Manual = 4,
}

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
  private touchedIdentityIds = new Set<string>();
  private halted = false;
  // Simple client-side rate budgets and in-memory OC LRU
  private rateMs = { steam: 600, hltb: 900, oc: 900 } as const;
  private nextAllowedAt: Record<"steam" | "hltb" | "oc", number> = {
    steam: 0,
    hltb: 0,
    oc: 0,
  };
  private ocLRU = new Map<string, number>();
  private ocLRUMax = 200;
  private mcIndexPromise: Promise<Record<string, MCEntry>> | null = null;
  private maxConcurrentRows = 3;
  private activeRowIds = new Set<string>();
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

  private requestActiveTransition() {
    if (this.phase !== "init") {
      return;
    }
    const startedAt = this.initStartedAt ?? Date.now();
    this.initStartedAt = startedAt;
    const elapsed = Date.now() - startedAt;
    const remaining = Math.max(0, INIT_MIN_MS - elapsed);
    if (remaining <= 0) {
      this.phase = "active";
      this.initStartedAt = null;
      this.clearPendingActiveTimer();
      return;
    }
    if (this.pendingActiveTimer) {
      return;
    }
    this.pendingActiveTimer = setTimeout(() => {
      this.pendingActiveTimer = null;
      if (this.phase === "init") {
        this.phase = "active";
        this.initStartedAt = null;
        this.emit();
      }
    }, remaining);
  }

  private async ensureMCIndex() {
    if (!this.mcIndexPromise) {
      this.mcIndexPromise = loadMCIndex();
    }
    return this.mcIndexPromise;
  }

  private async applySteamPrice(row: InternalRow, price: number, currency: string) {
    const normalizedPrice = Number(price);
    if (!Number.isFinite(normalizedPrice)) return;
    const normalizedCurrency = (currency || "").toUpperCase();
    row.price = normalizedPrice;
    row.currencyCode = normalizedCurrency;
    try {
      await db.library.update(row.id, {
        priceTRY: normalizedPrice,
        currencyCode: normalizedCurrency,
      } as any);
    } catch (_err) {
      // Ignore Dexie write errors for price updates.
    }
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
    this.touchedIdentityIds.clear();
    this.halted = false;
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
        mcScore: null,
        message: "Desktop-only enrichment",
        attempts: { steam: 0, hltb: 0, oc: 0 },
        criticScoreSource: undefined,
        stage: "vendor",
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
      mcScore: null,
      message: null,
      attempts: { steam: 0, hltb: 0, oc: 0 },
      criticScoreSource: undefined,
      stage: "vendor",
    }));
    this.recent = [];
    this.emit();
    this.ensureProcessing();
  }

  pause() {
    if (!this.sessionId) return;
    this.halted = false;
    this.paused = true;
    this.message = "Enrichment paused.";
    this.phase = "paused";
    this.clearPendingActiveTimer();
    this.emit();
  }

  halt() {
    if (!this.sessionId) return;
    this.halted = true;
    this.paused = true;
    this.message = "Enrichment halted. Resume from Settings when you're ready.";
    this.phase = "paused";
    this.clearPendingActiveTimer();
    this.emit();
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("gt:hide-enrichment"));
    }
  }

  resume() {
    if (!this.sessionId) return;
    if (!isTauri) {
      this.message = "Desktop-only enrichment. Launch the desktop app to resume.";
      this.emit();
      return;
    }

    this.halted = false;
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
    this.halted = false;
    this.queue = [];
    this.recent = [];
    this.touchedIdentityIds.clear();
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
    const workers = new Set<Promise<void>>();

    while (this.sessionId) {
      if (this.paused) {
        await this.waitForResume();
        continue;
      }

      while (!this.paused && workers.size < this.maxConcurrentRows) {
        const next = this.takeNextRow();
        if (!next) break;

        this.currentRowId = next.id;
        this.activeRowIds.add(next.id);
        next.status = "fetching";
        next.updatedAt = Date.now();
        next.message = null;
        this.message = `Fetching ${next.title}`;
        this.requestActiveTransition();
        this.emit();

        const worker = this.runRow(next)
          .then(async (outcome) => {
            this.activeRowIds.delete(next.id);
            if (outcome === "paused") {
              return;
            }
            await this.finalizeIfDone();
          })
          .catch((err) => {
            this.activeRowIds.delete(next.id);
            console.error("runner worker failed", err);
          })
          .finally(() => {
            workers.delete(worker);
          });

        workers.add(worker);
      }

      if (this.paused) {
        await this.waitForResume();
        continue;
      }

      if (!this.sessionId) break;

      if (workers.size === 0) {
        await this.waitForResume();
        continue;
      }

      try {
        await Promise.race(workers);
      } catch {
        // errors handled per worker
      }
    }

    await Promise.allSettled(workers);
    await this.finalizeIfDone();
  }

  private async finalizeIfDone() {
    if (!this.sessionId) {
      return;
    }
    if (this.finished) {
      return;
    }

    const hasIncomplete = this.queue.some((row) => {
      return row.status !== "done";
    });
    if (hasIncomplete || this.activeRowIds.size > 0) {
      return;
    }

    this.finished = true;
    this.paused = true;
    this.halted = false;
    this.phase = "done";
    this.currentRowId = null;
    this.lastUpdated = Date.now();
    if (!this.message) {
      this.message = "Enrichment complete.";
    }
    this.clearPendingActiveTimer();
    this.resumeResolvers.forEach((resolve) => resolve());
    this.resumeResolvers = [];
    this.sessionId = null;
    this.queue = [];
    this.activeRowIds.clear();
    this.processing = null;
    this.initStartedAt = null;
    this.touchedIdentityIds.clear();
    void clearEnrichSession();
    this.emit();
  }

  private waitForResume() {
    if (!this.sessionId) return Promise.resolve();
    return new Promise<void>((resolve) => {
      this.resumeResolvers.push(resolve);
    });
  }

  private takeNextRow(): InternalRow | undefined {
    return this.queue.find(
      (row) =>
        !this.activeRowIds.has(row.id) &&
        (row.status === "pending" || row.status === "paused"),
    );
  }

  private async awaitBudget(service: "steam" | "hltb" | "oc") {
    const now = Date.now();
    const wait = Math.max(0, this.nextAllowedAt[service] - now);
    if (wait > 0) await sleep(wait);
    this.nextAllowedAt[service] = Date.now() + this.rateMs[service];
  }

  private async runRow(row: InternalRow): Promise<"done" | "paused"> {
    if (!this.sessionId) return "paused";
    if (this.paused) {
      row.status = "paused";
      row.updatedAt = Date.now();
      this.emit();
      return "paused";
    }

    let identityPlatform: string | undefined;
    let identityDoc: Identity | undefined;
    try {
      const identity = await db.identities.get(row.identityId);
      if (identity) {
        row.title = identity.title ?? row.title;
        row.appid = identity.appid ?? row.appid;
        identityPlatform = identity.platform ?? undefined;
        identityDoc = identity as Identity;
        if (identity.ttbMedianMainH != null && row.ttb == null) {
          row.ttb = identity.ttbMedianMainH;
          row.ttbSource = identity.ttbSource;
        }
        if (identity.mcScore != null && row.mcScore == null) {
          row.mcScore = identity.mcScore;
        }
        if (identity.ocScore != null && row.ocScore == null) {
          row.ocScore = identity.ocScore;
        }
        if (identity.criticScoreSource && !row.criticScoreSource) {
          row.criticScoreSource = identity.criticScoreSource;
        }
      }
    } catch (_err) {
      // Dexie lookup errors are ignored; we rely on best-effort data.
    }

    const stage: EnrichRowStage = row.stage ?? "vendor";
    row.stage = stage;

    if (stage === "vendor") {
      const outcome = await this.runVendorStage(row, identityDoc, identityPlatform);
      if (outcome === "fallback") {
        this.enqueueFallback(row);
        return "done";
      }
      if (outcome === "done") {
        this.finalizeRow(row);
      }
      return outcome;
    }

    if (this.hasPendingVendorRows()) {
      row.status = "pending";
      row.updatedAt = Date.now();
      this.deferFallbackRow(row);
      this.emit();
      return "done";
    }

    const outcome = await this.runFallbackStage(row, identityDoc);
    if (outcome === "done") {
      this.finalizeRow(row);
    }
    return outcome;
  }

  private async runVendorStage(
    row: InternalRow,
    identityDoc: Identity | undefined,
    identityPlatform: string | undefined,
  ): Promise<"done" | "paused" | "fallback"> {
    if (row.appid) {
      const cachedPrice = await getSteamPriceRow(row.appid);
      if (cachedPrice && !isSteamPriceStale(cachedPrice)) {
        await this.applySteamPrice(row, cachedPrice.final, cachedPrice.currency);
      } else {
        const steam = await this.tryWithRetries("steam", row, async () => {
          await this.awaitBudget("steam");
          return fetchSteamPrice(row.appid!, this.region);
        });
        if (steam.kind === "paused") {
          row.status = "paused";
          row.updatedAt = Date.now();
          this.emit();
          return "paused";
        }
        if (steam.kind === "ok") {
          if (steam.value) {
            const { price, currency } = steam.value;
            await this.applySteamPrice(row, price, currency);
            try {
              await upsertSteamPriceRow({
                appid: row.appid!,
                currency,
                initial: price,
                final: price,
                discountPercent: 0,
                lastFetchedISO: new Date().toISOString(),
              });
            } catch (_err) {
              // Ignore Dexie write failures.
            }
          } else {
            appendMessage(row, "Steam price: not found after retries.");
          }
        } else if (steam.kind === "error") {
          if (cachedPrice) {
            await this.applySteamPrice(row, cachedPrice.final, cachedPrice.currency);
            appendMessage(row, "Steam price: using cached value.");
          } else {
            appendMessage(row, steam.message);
          }
        }
        if (this.paused) {
          row.status = "paused";
          row.updatedAt = Date.now();
          this.emit();
          return "paused";
        }
      }
    }

    let ttbResolved = row.ttb != null && !Number.isNaN(row.ttb);
    if (!ttbResolved) {
      try {
        const hours = await lookupLocalHLTB(row.title, identityPlatform);
        if (hours != null && applyTtb(row, hours, "hltb-local")) {
          try {
            await db.library.update(row.id, { ttbMedianMainH: hours } as any);
            await db.identities.update(row.identityId, {
              ttbMedianMainH: hours,
              ttbSource: "hltb-local",
            } as any);
          } catch (_err) {
            // Ignore Dexie write errors.
          }
        }
      } catch (_err) {
        console.error("HowLongToBeat lookup failed", _err);
      }
    }
    ttbResolved = row.ttb != null && !Number.isNaN(row.ttb);
    if (!ttbResolved && this.paused) {
      row.status = "paused";
      row.updatedAt = Date.now();
      this.emit();
      return "paused";
    }

    let criticResolved = row.mcScore != null && !Number.isNaN(row.mcScore);
    if (criticResolved) {
      row.criticScoreSource = "metacritic";
      row.ocScore = null;
    }

    if (!criticResolved && row.title) {
      try {
        await this.ensureMCIndex();
        const key = await computeMcKeyAsync(row.title, identityPlatform, undefined);
        const mc = key ? await getMCEntry(key) : undefined;
        if (mc?.score != null && applyCriticScore(row, "metacritic", mc.score)) {
          criticResolved = row.mcScore != null && !Number.isNaN(row.mcScore);
          const updates: Partial<Identity> = {
            mcScore: row.mcScore ?? null,
            criticScoreSource: "metacritic",
            ocScore: null,
          };
          if ((!identityDoc?.platform || identityDoc.platform === "unknown") && mc.platform) {
            const mapped = canonicalToIdentityPlatform(mc.platform);
            if (mapped) {
              updates.platform = mapped as any;
              identityPlatform = mapped;
            }
          }
          if (
            (!identityDoc?.mcGenres || identityDoc.mcGenres.length === 0) &&
            Array.isArray(mc.genres) &&
            mc.genres.length
          ) {
            updates.mcGenres = mc.genres.slice(0, 3);
          }
          try {
            await db.identities.update(row.identityId, updates as any);
          } catch (_err) {
            // Non-fatal write failure.
          }
          appendMessage(row, "Metacritic (vendor) score cached.");
        }
      } catch (err) {
        console.warn("Metacritic vendor lookup failed", err);
      }
    }

    if (this.paused) {
      row.status = "paused";
      row.updatedAt = Date.now();
      this.emit();
      return "paused";
    }

    if (!ttbResolved || !criticResolved) {
      return "fallback";
    }

    return "done";
  }

  private async runFallbackStage(
    row: InternalRow,
    identityDoc: Identity | undefined,
  ): Promise<"done" | "paused"> {
    let ttbResolved = row.ttb != null && !Number.isNaN(row.ttb);

    if (!ttbResolved && isTauri) {
      const hltb = await this.tryWithRetries("hltb", row, async () => {
        await this.awaitBudget("hltb");
        return fetchHLTB(row.title);
      });
      if (hltb.kind === "paused") {
        row.status = "paused";
        row.updatedAt = Date.now();
        this.emit();
        return "paused";
      }
      if (hltb.kind === "ok") {
        const result = hltb.value;
        const hours = result?.mainMedianHours ?? null;
        const nextSource = (result?.source ?? "hltb") as Identity["ttbSource"];
        if (hours != null && applyTtb(row, hours, nextSource)) {
          try {
            await db.library.update(row.id, { ttbMedianMainH: hours } as any);
            await db.identities.update(row.identityId, {
              ttbMedianMainH: hours,
              ttbSource: nextSource,
            } as any);
          } catch (_err) {
            // Ignore Dexie write errors.
          }
        } else {
          appendMessage(row, "HowLongToBeat: not found after retries.");
        }
      } else if (hltb.kind === "error") {
        appendMessage(row, hltb.message);
      }
    }
    ttbResolved = row.ttb != null && !Number.isNaN(row.ttb);

    if (!ttbResolved) {
      try {
        const rawg = await ensureRawgDetail(row.title);
        if (rawg?.playtimeHours != null && rawg.playtimeHours > 0 && applyTtb(row, rawg.playtimeHours, "rawg")) {
          try {
            await db.library.update(row.id, { ttbMedianMainH: rawg.playtimeHours } as any);
            await db.identities.update(row.identityId, {
              ttbMedianMainH: rawg.playtimeHours,
              ttbSource: "rawg",
            } as any);
          } catch (_err) {
            // Ignore Dexie write errors.
          }
          appendMessage(row, "HowLongToBeat: estimated via RAWG playtime.");
        }
      } catch (err) {
        console.warn("RAWG playtime lookup failed", err);
      }
    }
    ttbResolved = row.ttb != null && !Number.isNaN(row.ttb);

    if (!ttbResolved && !isTauri) {
      appendMessage(row, "HowLongToBeat: not available (desktop-only).");
    }

    if (this.paused) {
      row.status = "paused";
      row.updatedAt = Date.now();
      this.emit();
      return "paused";
    }

    let criticResolved = row.mcScore != null && !Number.isNaN(row.mcScore);
    if (criticResolved) {
      row.criticScoreSource = "metacritic";
      row.ocScore = null;
    } else {
      if (row.ocScore == null && identityDoc?.ocScore != null) {
        row.ocScore = identityDoc.ocScore;
      }
      if (!row.criticScoreSource && identityDoc?.criticScoreSource) {
        row.criticScoreSource = identityDoc.criticScoreSource;
      }
      criticResolved = row.ocScore != null && !Number.isNaN(row.ocScore);
    }

    if (!criticResolved && row.title) {
      try {
        const rawg = await ensureRawgDetail(row.title);
        const rawgScore = rawg?.aggregatedScore ?? rawg?.metacriticScore ?? null;
        if (rawgScore != null && applyCriticScore(row, "rawg", rawgScore)) {
          try {
            await db.identities.update(row.identityId, {
              ocScore: row.ocScore ?? undefined,
              mcScore: row.mcScore ?? undefined,
              criticScoreSource: "rawg",
            } as any);
          } catch (_err) {
            // Cache write failure is non-fatal.
          }
          appendMessage(row, "Critic score from RAWG fallback.");
        }
      } catch (err) {
        console.warn("RAWG critic score lookup failed", err);
      }
    }
    criticResolved =
      (row.mcScore != null && !Number.isNaN(row.mcScore)) ||
      (row.ocScore != null && !Number.isNaN(row.ocScore));

    if (!criticResolved && isTauri) {
      let normalizedOcKey: string | null | undefined = undefined;
      const oc = await this.tryWithRetries("oc", row, async () => {
        if (normalizedOcKey === undefined) {
          const normalized = await normalizeTitleKeyAsync(row.title);
          normalizedOcKey = normalized ? normalized : null;
        }
        const norm = normalizedOcKey;
        try {
          const ident = await db.identities.get(row.identityId);
          if (ident?.ocScore != null && ident?.criticScoreSource === "opencritic") {
            return ident.ocScore as any;
          }
        } catch (_err) {
          // ignore
        }
        if (norm && this.ocLRU.has(norm)) return this.ocLRU.get(norm)! as any;
        await this.awaitBudget("oc");
        return fetchOpenCriticScore(row.title);
      });
      if (oc.kind === "paused") {
        row.status = "paused";
        row.updatedAt = Date.now();
        this.emit();
        return "paused";
      }
      if (oc.kind === "ok") {
        if (oc.value != null && applyCriticScore(row, "opencritic", oc.value)) {
          try {
            await db.identities.update(row.identityId, {
              ocScore: row.ocScore ?? undefined,
              mcScore: row.mcScore ?? undefined,
              criticScoreSource: "opencritic",
            } as any);
          } catch (_err) {
            // Ignore Dexie write errors.
          }
          if (normalizedOcKey === undefined) {
            const normalized = await normalizeTitleKeyAsync(row.title);
            normalizedOcKey = normalized ? normalized : null;
          }
          const norm = normalizedOcKey;
          if (row.ocScore != null && norm) {
            this.ocLRU.set(norm, row.ocScore);
            if (this.ocLRU.size > this.ocLRUMax) {
              const first = this.ocLRU.keys().next().value as string | undefined;
              if (first) this.ocLRU.delete(first);
            }
          }
        } else {
          appendMessage(row, "OpenCritic: not found.");
        }
      } else if (oc.kind === "error") {
        appendMessage(row, oc.message);
      }
    } else if (!criticResolved && !isTauri) {
      appendMessage(row, "Critic score fallback (OpenCritic) requires the desktop build.");
    }
    criticResolved =
      (row.mcScore != null && !Number.isNaN(row.mcScore)) ||
      (row.ocScore != null && !Number.isNaN(row.ocScore));

    if (!criticResolved) {
      appendMessage(row, "Critic score not resolved after fallbacks.");
    }

    return "done";
  }

  private finalizeRow(row: InternalRow) {
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
        ttbSource: row.ttbSource,
        ocScore: row.ocScore ?? undefined,
        mcScore: row.mcScore ?? undefined,
        criticScoreSource: row.criticScoreSource,
      },
      ...this.recent,
    ].slice(0, 10);

    void this.flagIdentityPartial(row);
    this.requestActiveTransition();
    this.emit();
  }

  private enqueueFallback(row: InternalRow) {
    row.stage = "fallback";
    row.status = "pending";
    row.updatedAt = Date.now();
    appendMessage(row, "Queued for fallback sources.");
    this.moveRowToEnd(row);
    this.requestActiveTransition();
    this.emit();
  }

  private deferFallbackRow(row: InternalRow) {
    row.stage = "fallback";
    row.status = "pending";
    row.updatedAt = Date.now();
    this.moveRowToEnd(row);
  }

  private moveRowToEnd(row: InternalRow) {
    const idx = this.queue.indexOf(row);
    if (idx >= 0) {
      this.queue.splice(idx, 1);
      this.queue.push(row);
    }
  }

  private hasPendingVendorRows(): boolean {
    return this.queue.some(
      (candidate) =>
        candidate.stage === "vendor" &&
        (candidate.status === "pending" || candidate.status === "paused") &&
        !this.activeRowIds.has(candidate.id),
    );
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
      stage: row.stage === "fallback" ? "fallback" : "vendor",
    }));
    this.touchedIdentityIds = new Set(
      stored.queue.filter((row) => row.status === "done").map((row) => row.identityId),
    );
    this.recent = stored.recent ?? [];
    this.halted = Boolean(stored.halted);
    this.message = this.halted
      ? "Enrichment halted. Resume from Settings when you're ready."
      : "Ready to resume enrichment.";
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
      halted: this.halted,
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
        halted: this.halted,
      };
      void setEnrichSession(payload);
    } else {
      void clearEnrichSession();
    }
  }

  private async flagIdentityPartial(row: InternalRow) {
    if (!this.sessionId) return;
    const identityId = row.identityId;
    if (!identityId) return;
    this.touchedIdentityIds.add(identityId);
    const sessionRef = this.sessionId;
    try {
      await db.identities.update(identityId, {
        enrichmentSessionId: sessionRef,
        enrichmentPartial: true,
      } as any);
    } catch (err) {
      console.warn("Failed to flag partially enriched identity", err);
    }
  }

  private async resolveTouchedFlags(sessionId: string) {
    if (!this.touchedIdentityIds.size) return;
    const ids = Array.from(this.touchedIdentityIds);
    try {
      await db.transaction("rw", db.identities, async () => {
        for (const id of ids) {
          const identity = await db.identities.get(id);
          if (identity?.enrichmentSessionId === sessionId) {
            await db.identities.update(id, {
              enrichmentSessionId: null,
              enrichmentPartial: false,
            } as any);
          }
        }
      });
    } catch (err) {
      console.warn("Failed to clear enrichment flags", err);
    }
    this.touchedIdentityIds.clear();
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

function criticPriorityOf(source?: Identity["criticScoreSource"]): CriticPriority {
  switch (source) {
    case "metacritic":
      return CriticPriority.Metacritic;
    case "opencritic":
      return CriticPriority.OpenCritic;
    case "rawg":
      return CriticPriority.Rawg;
    default:
      return CriticPriority.None;
  }
}

function ttbPriorityOf(source?: Identity["ttbSource"]): TtbPriority {
  switch (source) {
    case "manual":
      return TtbPriority.Manual;
    case "hltb":
      return TtbPriority.HltbLive;
    case "rawg":
      return TtbPriority.Rawg;
    case "hltb-cache":
    case "hltb-local":
    case "html":
    case "igdb":
      return TtbPriority.Vendor;
    default:
      return source ? TtbPriority.Vendor : TtbPriority.None;
  }
}

function applyCriticScore(
  row: InternalRow,
  source: Exclude<Identity["criticScoreSource"], undefined>,
  value: number,
): boolean {
  if (value == null || Number.isNaN(value)) return false;
  const nextPriority = criticPriorityOf(source);
  const currentPriority = criticPriorityOf(row.criticScoreSource);
  if (nextPriority < currentPriority) {
    return false;
  }
  const rounded = Math.round(value);
  if (source === "metacritic") {
    row.mcScore = rounded;
    row.ocScore = null;
  } else {
    row.ocScore = rounded;
    row.mcScore = null;
  }
  row.criticScoreSource = source;
  return true;
}

function applyTtb(
  row: InternalRow,
  hours: number,
  source: Identity["ttbSource"],
): boolean {
  if (hours == null || Number.isNaN(hours)) return false;
  const nextPriority = ttbPriorityOf(source);
  const currentPriority = ttbPriorityOf(row.ttbSource);
  if (nextPriority < currentPriority) {
    return false;
  }
  row.ttb = hours;
  row.ttbSource = source;
  return true;
}

function appendMessage(row: InternalRow, text: string) {
  if (!text) return;
  row.message = row.message ? `${row.message}; ${text}` : text;
}

function canonicalToIdentityPlatform(canonical: string): string | undefined {
  switch (canonical) {
    case "pc":
    case "mac":
    case "linux":
      return "PC";
    case "ps5":
    case "ps4":
      return "PlayStation";
    case "xsx":
    case "xboxone":
      return "Xbox";
    case "switch":
      return "Switch";
    default:
      return undefined;
  }
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
    halt: runner.halt.bind(runner),
    resume: runner.resume.bind(runner),
    cancel: runner.cancel.bind(runner),
  };
}

export function getEnrichmentRunner() {
  return runner;
}
