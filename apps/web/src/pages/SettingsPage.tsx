import { useState, useEffect, useCallback, lazy, Suspense } from "react";
import {
  clearAllData,
  clearRawgCache,
  clearTranscripts,
  db,
  getSetting,
  replaceSteamRecentRows,
  setSetting,
  getAutomationSettings,
  saveAutomationSettings,
  getRecentAllyLogs,
  getRecentDigests,
  type AllyAutomationSettings,
  type AllyLogRow,
} from "@/db";
import { lookupLocalHLTB } from "@/data/localDatasets";
import { fetchSteamPrice, fetchOpenCriticScore, isTauri, packDiagnostics } from "@/desktop/bridge";
import {
  ensureSteamId,
  getSteamProfile,
  getOwnedGames,
} from "@/desktop/steamBridge";
import { useEnrichmentRunner } from "@/state/enrichmentRunner";
import { useVendorFlag, setVendorFlag, type VendorKey } from "@/state/vendorFlags";
import { resetMCIndexCache } from "@/data/metacriticIndex";
import { clearRawgApiCache } from "@/apis/rawg";
import { invoke } from "@tauri-apps/api/core";
import { check } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { getVersion } from "@tauri-apps/api/app";
import { getConsoleBufferSnapshot } from "@/utils/consoleBuffer";

const AllyDigestCard = lazy(() => import("@/components/AllyDigest"));
type LocalDetect = import("@/desktop/localLlmBridge").LocalDetect;

type UpdateState = {
  status: "idle" | "checking" | "available" | "installing" | "error" | "uptodate";
  lastChecked: string | null;
  version?: string | null;
  message?: string | null;
  automatic?: boolean;
};

type DiagnosticsState = {
  status: "idle" | "pending" | "ready" | "error";
  message?: string | null;
  path?: string | null;
};

type UpdaterStatusSetting = {
  checkedAt?: string | null;
  available?: boolean;
  version?: string | null;
  error?: string | null;
};

type UpdaterEventDetail = UpdaterStatusSetting & {
  automatic?: boolean;
  cached?: boolean;
};

const STEAM_REGION_OPTIONS = [
  { value: "us", label: "United States" },
  { value: "gb", label: "United Kingdom" },
  { value: "eu", label: "Eurozone" },
  { value: "de", label: "Germany" },
  { value: "fr", label: "France" },
  { value: "tr", label: "Turkey" },
  { value: "jp", label: "Japan" },
  { value: "au", label: "Australia" },
  { value: "br", label: "Brazil" },
];

const STEAM_LANGUAGE_OPTIONS = [
  { value: "en", label: "English" },
  { value: "de", label: "German" },
  { value: "fr", label: "French" },
  { value: "es", label: "Spanish" },
  { value: "pt", label: "Portuguese" },
  { value: "ru", label: "Russian" },
  { value: "tr", label: "Turkish" },
  { value: "ja", label: "Japanese" },
  { value: "zh-cn", label: "Chinese (Simplified)" },
];

const ALLY_LABEL = "my_library" as const;
const AI_SAVE_TRANSCRIPTS_KEY = "ally.saveTranscripts";
type AIProvider = "local" | "ally";

type StepState = {
  status: "idle" | "pending" | "success" | "error";
  message?: string;
  error?: string;
};

let allyBridgeModule: Promise<typeof import("@/desktop/allyBridge")> | null = null;
function loadAllyBridge() {
  if (!allyBridgeModule) {
    allyBridgeModule = import("@/desktop/allyBridge");
  }
  return allyBridgeModule;
}

let localBridgeModule: Promise<typeof import("@/desktop/localLlmBridge")> | null = null;
function loadLocalBridge() {
  if (!localBridgeModule) {
    localBridgeModule = import("@/desktop/localLlmBridge");
  }
  return localBridgeModule;
}

let allyExportModule: Promise<typeof import("@/ally/export")> | null = null;
function loadAllyExport() {
  if (!allyExportModule) {
    allyExportModule = import("@/ally/export");
  }
  return allyExportModule;
}

let allySessionModule: Promise<typeof import("@/ally/session")> | null = null;
function loadAllySession() {
  if (!allySessionModule) {
    allySessionModule = import("@/ally/session");
  }
  return allySessionModule;
}

let allyLogModule: Promise<typeof import("@/ally/log")> | null = null;
function loadAllyLog() {
  if (!allyLogModule) {
    allyLogModule = import("@/ally/log");
  }
  return allyLogModule;
}

let allyRunbookModule: Promise<typeof import("@/ally/runbook")> | null = null;
function loadAllyRunbook() {
  if (!allyRunbookModule) {
    allyRunbookModule = import("@/ally/runbook");
  }
  return allyRunbookModule;
}

/**
 * Settings page for Game Tracker.  This component allows users to toggle
 * integrations, adjust card layout, and choose the Steam region for price
 * fetching.  All preferences are persisted in localStorage and applied on
 * first mount.  Hooks are used exclusively inside the component body to
 * satisfy React's rules of hooks.
 */
export default function SettingsPage() {
  // Set the card width to a fixed 340px ("Large" size) on mount.  The user can no
  // longer choose between sizes.  We persist this for completeness, although
  // there is no UI to change it.
  useEffect(() => {
    document.documentElement.style.setProperty("--card-w", `340px`);
    localStorage.setItem("card_size", "large");
  }, []);

  /**
   * Steam region selection.  Determines which country code will be used when
   * fetching prices.  Defaults to "us".  Persist to localStorage on change.
   */
  const [steamSettingsLoaded, setSteamSettingsLoaded] = useState(false);
  const [steamInput, setSteamInput] = useState("");
  const [savedSteamId, setSavedSteamId] = useState<string | null>(null);
  const [steamRegion, setSteamRegion] = useState("us");
  const [steamLanguage, setSteamLanguage] = useState("en");
  const [steamResolveState, setSteamResolveState] = useState<StepState>(() => ({ status: "idle" }));
  const [steamTestState, setSteamTestState] = useState<StepState>(() => ({ status: "idle" }));
  const [allyState, setAllyState] = useState<StepState>(() => ({ status: "idle" }));
  const [allyDataDir, setAllyDataDir] = useState<string | null>(null);
  const [allyExportState, setAllyExportState] = useState<StepState>(() => ({ status: "idle" }));
  const [allyExportResults, setAllyExportResults] = useState<Array<{ file: string; bytes: number }>>([]);
  const [lastAllyExportISO, setLastAllyExportISO] = useState<string | null>(null);
  const [perfLoggingEnabled, setPerfLoggingEnabled] = useState(false);
  const [aiProvider, setAiProvider] = useState<AIProvider>("local");
  const [allyEmbedState, setAllyEmbedState] = useState<StepState>(() => ({ status: "idle" }));
  const [allyStartState, setAllyStartState] = useState<StepState>(() => ({ status: "idle" }));
  const [allyEmbedOutput, setAllyEmbedOutput] = useState<string | null>(null);
  const [allyStartOutput, setAllyStartOutput] = useState<string | null>(null);
  const [lastAllyEmbedISO, setLastAllyEmbedISO] = useState<string | null>(null);
  const [lastAllyStartISO, setLastAllyStartISO] = useState<string | null>(null);
  const [bootstrapRunning, setBootstrapRunning] = useState(false);
  const [chatSession, setChatSession] = useState<string | null>(null);
  const [chatInput, setChatInput] = useState("");
  const [chatState, setChatState] = useState<StepState>(() => ({ status: "idle" }));
  const [chatHistory, setChatHistory] = useState<Array<{ role: "user" | "ally"; content: string; isJson?: boolean }>>([]);
  const [chatResponse, setChatResponse] = useState<{ content: string; isJson: boolean } | null>(null);
  const [localInfo, setLocalInfo] = useState<LocalDetect | null>(null);
  const [localChatState, setLocalChatState] = useState<StepState>(() => ({ status: "idle" }));
  const [localChatOutput, setLocalChatOutput] = useState<string | null>(null);
  const [localEmbedState, setLocalEmbedState] = useState<StepState>(() => ({ status: "idle" }));
  const [localEmbedSummary, setLocalEmbedSummary] = useState<string | null>(null);
  const [saveTranscripts, setSaveTranscripts] = useState(true);
  const [clearingTranscripts, setClearingTranscripts] = useState(false);
  const [automationSettings, setAutomationSettings] = useState<AllyAutomationSettings | null>(null);
  const [automationLoaded, setAutomationLoaded] = useState(false);
  const [automationSaving, setAutomationSaving] = useState(false);
  const [automationRunState, setAutomationRunState] = useState<StepState>(() => ({ status: "idle" }));
  const [allyLogs, setAllyLogs] = useState<AllyLogRow[]>([]);
    const [logsLoaded, setLogsLoaded] = useState(false);
    const [logsError, setLogsError] = useState<string | null>(null);
    const [logsExpanded, setLogsExpanded] = useState(false);
    const [showAdvanced, setShowAdvanced] = useState(false);
    const [updateState, setUpdateState] = useState<UpdateState>({ status: "idle", lastChecked: null });
    const [diagnosticsState, setDiagnosticsState] = useState<DiagnosticsState>({ status: "idle" });

  const refreshAutomation = useCallback(async () => {
    if (!isTauri) {
      setAutomationSettings(null);
      setAutomationLoaded(true);
      return;
    }
    setAutomationLoaded(false);
    try {
      const settings = await getAutomationSettings();
      setAutomationSettings(settings);
    } catch (err) {
      setAutomationSettings(null);
      throw err;
    } finally {
      setAutomationLoaded(true);
    }
  }, []);

    const refreshLogs = useCallback(async () => {
      if (!isTauri) {
        setAllyLogs([]);
        setLogsLoaded(true);
        setLogsError(null);
      return;
    }
    setLogsLoaded(false);
    try {
      const { getLogs: getAllyLogs } = await loadAllyLog();
      const rows = await getAllyLogs(200);
      setAllyLogs(rows);
      setLogsError(null);
    } catch (err) {
      setLogsError(err instanceof Error ? err.message : String(err));
    } finally {
      setLogsLoaded(true);
      }
    }, [isTauri]);

    const handleCheckForUpdates = useCallback(async () => {
      if (!isTauri) {
        alert("Desktop build required to check for updates.");
        return;
      }
      setUpdateState((prev) => ({ ...prev, status: "checking" }));
      try {
        const update = await check();
        const detail: UpdaterStatusSetting = {
          checkedAt: new Date().toISOString(),
          available: Boolean(update),
          version: update?.version ?? null,
          error: null,
        };
        if (update) {
          await update.close().catch(() => {});
        }
        await setSetting("updater.lastStatus", detail);
        window.dispatchEvent(new CustomEvent("gt:updater-status", { detail }));
        if (detail.available) {
          setUpdateState({
            status: "available",
            lastChecked: detail.checkedAt ?? null,
            version: detail.version ?? null,
            automatic: false,
          });
        } else {
          setUpdateState({
            status: "uptodate",
            lastChecked: detail.checkedAt ?? null,
            message: "You are already on the latest version.",
          });
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const detail: UpdaterStatusSetting = {
          checkedAt: new Date().toISOString(),
          available: false,
          version: null,
          error: message,
        };
        await setSetting("updater.lastStatus", detail).catch(() => {});
        window.dispatchEvent(new CustomEvent("gt:updater-status", { detail }));
        setUpdateState({
          status: "error",
          lastChecked: detail.checkedAt ?? null,
          message,
        });
      }
    }, [isTauri]);

    const handleInstallUpdate = useCallback(async () => {
      if (!isTauri || updateState.status !== "available") {
        return;
      }
      setUpdateState((prev) => ({ ...prev, status: "installing" }));
      try {
        const update = await check();
        if (!update) {
          setUpdateState({
            status: "uptodate",
            lastChecked: new Date().toISOString(),
            message: "No update is currently available.",
          });
          return;
        }
        try {
          await update.downloadAndInstall();
        } finally {
          await update.close().catch(() => {});
        }
        await relaunch();
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        setUpdateState({
          status: "error",
          lastChecked: new Date().toISOString(),
          message,
        });
      }
    }, [isTauri, updateState.status]);

    const handleExportDiagnostics = useCallback(async () => {
      if (!isTauri) {
        alert("Diagnostics export requires the desktop app.");
        return;
      }
      setDiagnosticsState({ status: "pending" });
      try {
        const [logs, digests, settingsRows] = await Promise.all([
          getRecentAllyLogs(500),
          getRecentDigests(20),
          db.settings.toArray(),
        ]);
        const versions: Record<string, unknown> = {};
        try {
          versions.appVersion = await getVersion();
        } catch {
          // ignore
        }
        try {
          const { allyVersion } = await loadAllyBridge();
          versions.allyVersion = await allyVersion();
        } catch {
          // ignore
        }
        const consoleLines = getConsoleBufferSnapshot(50);
        const archivePath = await packDiagnostics({
          logs,
          digests,
          settings: settingsRows,
          versions,
          console: consoleLines,
        });
        setDiagnosticsState({ status: "ready", path: archivePath, message: null });
      } catch (error) {
        setDiagnosticsState({
          status: "error",
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }, [isTauri]);

    useEffect(() => {
      let cancelled = false;
      (async () => {
        try {
          const [storedId, storedRegion, storedLang, storedProvider, storedPerfLogging] = await Promise.all([
          getSetting<string>("steam.myId"),
          getSetting<string>("steam.region"),
          getSetting<string>("steam.lang"),
          getSetting<AIProvider>("ai.provider"),
          getSetting<boolean>("dev.logPerf"),
        ]);
        if (cancelled) return;
        if (storedId) {
          setSteamInput(storedId);
          setSavedSteamId(storedId);
        }
        const regionPref = (storedRegion || localStorage.getItem("steam_cc") || "us").toLowerCase();
        setSteamRegion(regionPref);
        localStorage.setItem("steam_cc", regionPref);
        const langPref = (storedLang || localStorage.getItem("steam_lang") || "en").toLowerCase();
        setSteamLanguage(langPref);
        localStorage.setItem("steam_lang", langPref);
        if (storedProvider === "local" || storedProvider === "ally") {
          setAiProvider(storedProvider);
        }
        setPerfLoggingEnabled(Boolean(storedPerfLogging));
      } finally {
        if (!cancelled) {
          setSteamSettingsLoaded(true);
        }
      }
      })();
      return () => {
        cancelled = true;
      };
    }, []);

    useEffect(() => {
      if (!isTauri) return;
      let cancelled = false;
      (async () => {
        try {
          const stored = await getSetting<UpdaterStatusSetting>("updater.lastStatus");
          if (cancelled || !stored) return;
          if (stored.error) {
            setUpdateState({
              status: "error",
              lastChecked: stored.checkedAt ?? null,
              message: stored.error ?? "Update check failed.",
            });
          } else if (stored.available) {
            setUpdateState({
              status: "available",
              lastChecked: stored.checkedAt ?? null,
              version: stored.version ?? null,
              automatic: true,
            });
          } else {
            setUpdateState({
              status: "uptodate",
              lastChecked: stored.checkedAt ?? null,
              message: "Last automatic check reported no updates.",
            });
          }
        } catch {
          // ignore stored read errors
        }
      })();
      return () => {
        cancelled = true;
      };
    }, []);

    useEffect(() => {
      if (!isTauri) return;
      const handler = (event: Event) => {
        const detail = (event as CustomEvent<UpdaterEventDetail>).detail;
        if (!detail) return;
        if (detail.error) {
          setUpdateState({
            status: "error",
            lastChecked: detail.checkedAt ?? null,
            message: detail.error ?? "Update check failed.",
          });
          return;
        }
        if (detail.available) {
          setUpdateState({
            status: "available",
            lastChecked: detail.checkedAt ?? null,
            version: detail.version ?? null,
            automatic: detail.automatic ?? false,
          });
        } else {
          const message = detail.cached
            ? "Skipped automatic update check (recently checked)."
            : "This device is on the latest available version.";
          setUpdateState({
            status: "uptodate",
            lastChecked: detail.checkedAt ?? null,
            message,
          });
        }
      };
      window.addEventListener("gt:updater-status", handler as EventListener);
      return () => {
        window.removeEventListener("gt:updater-status", handler as EventListener);
      };
    }, []);

  useEffect(() => {
    if (!showAdvanced) {
      setAllyDataDir(null);
      return;
    }
    if (!isTauri) {
      setAllyDataDir(null);
      setAutomationSettings(null);
      setAutomationLoaded(true);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const { allyGetDataDir } = await loadAllyBridge();
        const [dir, lastExport, lastEmbed, lastStart] = await Promise.all([
          allyGetDataDir(),
          getSetting<string>("ally.lastExportISO"),
          getSetting<string>("ally.lastEmbedISO"),
          getSetting<string>("ally.lastStartISO"),
        ]);
        if (!cancelled) {
          setAllyDataDir(dir);
          setLastAllyExportISO(lastExport ?? null);
          setLastAllyEmbedISO(lastEmbed ?? null);
          setLastAllyStartISO(lastStart ?? null);
        }
      } catch (_err) {
        if (!cancelled) {
          setAllyDataDir("Unavailable");
        }
      }
      if (cancelled) return;
      try {
        await refreshAutomation();
      } catch (err) {
        console.warn("Failed to load automation settings:", err);
        setAutomationLoaded(true);
      }
      try {
        const stored = await getSetting<boolean>(AI_SAVE_TRANSCRIPTS_KEY);
        if (!cancelled) {
          setSaveTranscripts(stored !== false);
        }
      } catch (err) {
        if (!cancelled) {
          setSaveTranscripts(true);
        }
        console.warn("Failed to load transcript preference:", err);
      }
      await refreshLogs();
    })();
    return () => {
      cancelled = true;
    };
  }, [isTauri, refreshAutomation, refreshLogs, showAdvanced]);

  useEffect(() => {
    if (!steamSettingsLoaded) return;
    const value = steamRegion.toLowerCase();
    void setSetting("steam.region", value);
    localStorage.setItem("steam_cc", value);
  }, [steamRegion, steamSettingsLoaded]);

  useEffect(() => {
    if (!steamSettingsLoaded) return;
    const value = steamLanguage.toLowerCase();
    void setSetting("steam.lang", value);
    localStorage.setItem("steam_lang", value);
  }, [steamLanguage, steamSettingsLoaded]);

  useEffect(() => {
    // persist provider choice
    void setSetting("ai.provider", aiProvider);
  }, [aiProvider]);

  useEffect(() => {
    if (!showAdvanced || !isTauri || aiProvider !== "local") {
      setLocalInfo(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const { localDetect } = await loadLocalBridge();
        const info = await localDetect();
        if (!cancelled) {
          setLocalInfo(info);
        }
      } catch (_err) {
        if (!cancelled) {
          setLocalInfo(null);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [aiProvider, isTauri, showAdvanced]);

  /** Feature flags: covers, IGDB, HLTB, OpenCritic.  Each flag lives in
   * localStorage as "0" or "1".  We provide simple toggles that update
   * localStorage when changed.
   */
  function useToggle(key: string, def = "0") {
    const [v, setV] = useState(() => localStorage.getItem(key) ?? def);
    useEffect(() => { localStorage.setItem(key, v); }, [key, v]);
    return [v === "1", (b: boolean) => setV(b ? "1" : "0")] as const;
  }
  const [coversOn, setCoversOn] = useToggle("covers_enabled", "1");
  const [igdbOn, setIgdbOn] = useToggle("igdb_enabled", "0");
  const [ocOn, setOcOn] = useToggle("oc_enabled", "0");
  const [changingVendor, setChangingVendor] = useState<VendorKey | null>(null);
  const hltbEnabled = useVendorFlag("hltb");
  const rawgEnabled = useVendorFlag("rawg");
  const metacriticEnabled = useVendorFlag("metacritic");

  const hltbPending = changingVendor === "hltb";
  const rawgPending = changingVendor === "rawg";
  const metacriticPending = changingVendor === "metacritic";

  const toggleVendor = async (key: VendorKey, value: boolean) => {
    setChangingVendor(key);
    try {
      await setVendorFlag(key, value);
    } finally {
      setChangingVendor((current) => (current === key ? null : current));
    }
  };

  const {
    snapshot: enrichmentSnapshot,
    resume: resumeEnrichment,
    halt: haltEnrichment,
  } = useEnrichmentRunner();
  const hasEnrichmentSession = Boolean(enrichmentSnapshot.sessionId);
  const enrichmentStatus = hasEnrichmentSession
    ? enrichmentSnapshot.halted
      ? "Halted"
      : enrichmentSnapshot.paused
      ? "Paused"
      : "Running"
    : "Idle";
  const enrichmentProgress =
    hasEnrichmentSession && enrichmentSnapshot.totalRows
      ? `${enrichmentSnapshot.completedCount} / ${enrichmentSnapshot.totalRows}`
      : hasEnrichmentSession
      ? `${enrichmentSnapshot.completedCount} items processed`
      : "";
  const canResumeEnrichment = hasEnrichmentSession && enrichmentSnapshot.paused;
  const canHaltEnrichment = hasEnrichmentSession && !enrichmentSnapshot.halted;
  const handleResumeEnrichment = () => {
    resumeEnrichment();
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("gt:show-enrichment"));
    }
  };
  const handleHaltEnrichment = () => {
    haltEnrichment();
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("gt:hide-enrichment"));
    }
  };

  const formatSteamError = (err: unknown, fallback: string) => {
    const raw =
      typeof err === "string" ? err : (err as { message?: string })?.message ?? fallback;
    if (typeof raw !== "string") return fallback;
    if (raw.toLowerCase().includes("player not found")) {
      return "Steam could not find that profile. Double-check the vanity URL or ensure your profile is public.";
    }
    if (raw.toLowerCase().includes("missing") && raw.toLowerCase().includes("api key")) {
      return "Steam API key is not configured. Add STEAM_WEB_API_KEY to your desktop environment.";
    }
    return raw;
  };

  const handleResolveSteam = async () => {
    try {
      setSteamResolveState({ status: "pending" });
      const { id, resolved } = await ensureSteamId(steamInput);
      setSteamInput(id);
      setSteamResolveState({
        status: "success",
        message: resolved ? `Resolved to ${id}` : "Looks like a SteamID64 already.",
      });
    } catch (err) {
      setSteamResolveState({
        status: "error",
        message: formatSteamError(err, "Failed to resolve vanity URL."),
      });
    }
  };

  const handleSaveSteamId = async () => {
    try {
      setSteamResolveState({ status: "pending" });
      const { id, resolved } = await ensureSteamId(steamInput);
      await setSetting("steam.myId", id);
      setSavedSteamId(id);
      setSteamInput(id);
      setSteamResolveState({
        status: "success",
        message: resolved ? `Resolved vanity and saved SteamID64 ${id}.` : "Steam ID saved.",
      });
      setSteamTestState({ status: "idle" });
    } catch (err) {
      setSteamResolveState({
        status: "error",
        message: formatSteamError(err, "Could not save Steam ID."),
      });
    }
  };

  const handleTestSteam = async () => {
    if (!isTauri) {
      setSteamTestState({ status: "error", message: "Testing requires the desktop app." });
      return;
    }
    const source = savedSteamId ?? steamInput;
    if (!source.trim()) {
      setSteamTestState({ status: "error", message: "Save your Steam ID before testing." });
      return;
    }
    try {
      setSteamTestState({ status: "pending" });
      const { id, resolved } = await ensureSteamId(source);
      if (resolved || (!savedSteamId && id !== source)) {
        await setSetting("steam.myId", id);
        setSavedSteamId(id);
        setSteamInput(id);
      }
      const profile = await getSteamProfile(id);
      const owned = await getOwnedGames(id, true);
      const total = owned.length;
      const note =
        total > 0 ? `Detected ${total} owned ${total === 1 ? "game" : "games"}.` : "No owned games detected.";
      setSteamTestState({
        status: "success",
        message: `Hello ${profile.personaName || id}. ${note}`,
      });
    } catch (err) {
      setSteamTestState({
        status: "error",
        message: formatSteamError(err, "Steam API test failed."),
      });
    }
  };

  const toError = (err: unknown): string => {
    if (err instanceof Error) return err.message;
    if (typeof err === "string") return err;
    try {
      return JSON.stringify(err);
    } catch {
      return String(err);
    }
  };

  const installingUpdate = updateState.status === "installing";
  const canInstallUpdate = updateState.status === "available" || installingUpdate;

  const formatIso = (iso: string | null | undefined) =>
    iso ? new Date(iso).toLocaleString() : "Never";

  const renderStatusPill = (state: StepState) => {
    const base = "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold";
    switch (state.status) {
      case "pending":
        return <span className={`${base} bg-amber-100 text-amber-700`}>Pending</span>;
      case "success":
        return <span className={`${base} bg-emerald-100 text-emerald-700`}>OK</span>;
      case "error":
        return <span className={`${base} bg-rose-100 text-rose-700`}>Error</span>;
      default:
        return <span className={`${base} bg-zinc-100 text-zinc-500`}>Idle</span>;
    }
  };

  const runExportStep = async (label: string = ALLY_LABEL) => {
    if (!isTauri) {
      setAllyExportState({ status: "error", message: "Desktop-only feature.", error: "Desktop-only feature." });
      return false;
    }
    try {
      setAllyExportState({ status: "pending" });
      const { exportAll } = await loadAllyExport();
      const results = await exportAll(label);
      setAllyExportResults(results);
      const iso = new Date().toISOString();
      await setSetting("ally.lastExportISO", iso);
      setLastAllyExportISO(iso);
      setAllyExportState({ status: "success", message: `Exported ${results.length} files.` });
      return true;
    } catch (err) {
      const message = toError(err);
      setAllyExportState({ status: "error", message: "Export failed.", error: message });
      return false;
    }
  };

  const runEmbedStep = async (label: string = ALLY_LABEL) => {
    if (!isTauri) {
      setAllyEmbedState({ status: "error", message: "Desktop-only feature.", error: "Desktop-only feature." });
      return false;
    }
    setAllyEmbedState({ status: "pending" });
    try {
      if (aiProvider === "local") {
        // Build simple corpus: identity titles
        const idents = await db.identities.toArray();
        const texts = idents.map((i) => i.title).filter(Boolean).slice(0, 500);
        const { localEmbed } = await loadLocalBridge();
        const vectors = await localEmbed(texts);
        // Persist to Ally data dir to keep locations consistent
        const payload = JSON.stringify({ label, count: texts.length, dim: vectors[0]?.length ?? 0, texts, vectors });
        const { allyWriteExport } = await loadAllyBridge();
        await allyWriteExport(label, "vectors.json", payload);
        setAllyEmbedOutput(`Embedded ${texts.length} items locally (dim=${vectors[0]?.length ?? 0}).`);
      } else {
        const { allyEmbed } = await loadAllyBridge();
        const output = (await allyEmbed(label)).trim();
        setAllyEmbedOutput(output || null);
      }
      const iso = new Date().toISOString();
      await setSetting("ally.lastEmbedISO", iso);
      setLastAllyEmbedISO(iso);
      setAllyEmbedState({ status: "success", message: "Embed complete." });
      return true;
    } catch (err) {
      const message = toError(err);
      setAllyEmbedState({ status: "error", message: "Embed failed.", error: message });
      return false;
    }
  };

  const runStartStep = async (label: string = ALLY_LABEL) => {
    if (!isTauri) {
      setAllyStartState({ status: "error", message: "Desktop-only feature.", error: "Desktop-only feature." });
      return false;
    }
    setAllyStartState({ status: "pending" });
    try {
      if (aiProvider === "local") {
        // For local, write a small KB marker file so UI can confirm state
        const marker = JSON.stringify({ label, startedAt: new Date().toISOString(), provider: "local" });
        const { allyWriteExport } = await loadAllyBridge();
        await allyWriteExport(label, "kb.json", marker);
        setAllyStartOutput("Local KB ready.");
      } else {
        const { allyStartRag } = await loadAllyBridge();
        const output = (await allyStartRag(label)).trim();
        setAllyStartOutput(output || null);
      }
      const iso = new Date().toISOString();
      await setSetting("ally.lastStartISO", iso);
      setLastAllyStartISO(iso);
      setAllyStartState({ status: "success", message: "Knowledge base started." });
      return true;
    } catch (err) {
      const message = toError(err);
      setAllyStartState({ status: "error", message: "Start failed.", error: message });
      return false;
    }
  };

  const handleAllyExportNow = async () => {
    await runExportStep();
  };

  const handleAllyEmbed = async () => {
    await runEmbedStep();
  };

  const handleAllyStart = async () => {
    await runStartStep();
  };

  const updateAutomation = useCallback(
    async (patch: Partial<AllyAutomationSettings>) => {
      try {
        setAutomationSaving(true);
        const updated = await saveAutomationSettings(patch);
        setAutomationSettings(updated);
      } catch (err) {
        console.warn("Failed to update automation settings:", err);
      } finally {
        setAutomationSaving(false);
      }
    },
    [],
  );

  const handleAutomationRun = useCallback(async () => {
    if (!isTauri) {
      setAutomationRunState({ status: "error", message: "Desktop-only feature.", error: "Desktop-only feature." });
      return;
    }
    try {
      setAutomationRunState({ status: "pending" });
      const { runExportEmbedStart } = await loadAllyRunbook();
      await runExportEmbedStart(ALLY_LABEL);
      const stamp = new Date().toISOString();
      await updateAutomation({
        lastExportISO: stamp,
        lastEmbedISO: stamp,
        lastStartISO: stamp,
      });
      setAutomationRunState({ status: "success", message: "Export->Embed->Start completed." });
      await refreshLogs();
    } catch (err) {
      setAutomationRunState({
        status: "error",
        message: "Automation run failed.",
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }, [isTauri, refreshLogs, updateAutomation]);

  const handleAutomationUpdated = useCallback(
    async (settings: AllyAutomationSettings) => {
      setAutomationSettings(settings);
      await refreshLogs();
    },
    [refreshLogs],
  );

  const handleClearLogs = useCallback(async () => {
    if (!isTauri) return;
    const { clearAllyLogs } = await loadAllyLog();
    await clearAllyLogs();
    setAllyLogs([]);
    setLogsLoaded(true);
    setLogsError(null);
  }, [isTauri]);

  const handleLocalChatTest = async () => {
    if (!isTauri || aiProvider !== "local") {
      setLocalChatState({ status: "error", message: "Switch provider to Local to run this test.", error: "Local provider inactive." });
      return;
    }
    try {
      setLocalChatState({ status: "pending" });
      const { localChat } = await loadLocalBridge();
      const reply = await localChat("Hello! Please confirm the local model is online.");
      setLocalChatOutput(reply);
      setLocalChatState({ status: "success", message: "Reply received." });
    } catch (err) {
      setLocalChatState({ status: "error", message: "Local chat failed.", error: toError(err) });
    }
  };

  const handleLocalEmbedTest = async () => {
    if (!isTauri || aiProvider !== "local") {
      setLocalEmbedState({ status: "error", message: "Switch provider to Local to run this test.", error: "Local provider inactive." });
      return;
    }
    try {
      setLocalEmbedState({ status: "pending" });
      const sample = await db.identities.orderBy("title").limit(3).toArray();
      const texts = sample.length ? sample.map((entry) => entry.title ?? "") : ["Sample text", "Another sample", "Final sample"];
      const { localEmbed } = await loadLocalBridge();
      const vectors = await localEmbed(texts);
      const dim = vectors[0]?.length ?? 0;
      setLocalEmbedSummary(`Generated ${vectors.length} vectors (dim ${dim}).`);
      setLocalEmbedState({ status: "success", message: "Embeddings generated." });
    } catch (err) {
      setLocalEmbedState({ status: "error", message: "Local embedding failed.", error: toError(err) });
    }
  };

  const handleRunAll = async () => {
    if (!isTauri) {
      setAllyExportState({ status: "error", message: "Desktop-only feature.", error: "Desktop-only feature." });
      return;
    }
    setBootstrapRunning(true);
    try {
      const exportOk = await runExportStep();
      if (!exportOk) return;
      const embedOk = await runEmbedStep();
      if (!embedOk) return;
      await runStartStep();
    } finally {
      setBootstrapRunning(false);
    }
  };

  const handleChatSend = async () => {
    const trimmed = chatInput.trim();
    if (!trimmed) return;
    if (!isTauri) {
      setChatState({ status: "error", message: "Desktop-only feature.", error: "Desktop-only feature." });
      return;
    }
    const { getOrCreateSession } = await loadAllySession();
    const session = getOrCreateSession();
    setChatSession(session);
    setChatState({ status: "pending" });
    setChatHistory((prev) => [...prev, { role: "user", content: trimmed }]);
    try {
      let raw: string;
      if (aiProvider === "local") {
        const { localChat } = await loadLocalBridge();
        raw = await localChat(trimmed);
      } else {
        const { allyChat } = await loadAllyBridge();
        raw = await allyChat(session, trimmed, false);
      }
      let content = raw.trim();
      let isJson = false;
      if (content) {
        try {
          const parsed = JSON.parse(content);
          content = JSON.stringify(parsed, null, 2);
          isJson = true;
        } catch {
          isJson = false;
        }
      }
      setChatState({ status: "success", message: `Reply received (${content.length} chars).` });
      setChatResponse({ content, isJson });
      setChatHistory((prev) => [...prev, { role: "ally", content, isJson }]);
      setChatInput("");
    } catch (err) {
      const message = toError(err);
      setChatState({ status: "error", message: "Chat failed.", error: message });
    }
  };

  const handleResetChatSession = async () => {
    const { resetSession } = await loadAllySession();
    resetSession();
    setChatSession(null);
    setChatHistory([]);
    setChatResponse(null);
    setChatState({ status: "idle" });
  };

  /**
   * Bulk fetch: iterate all library entries and update missing HLTB times using
   * the local dataset. Titles not present in the dataset are skipped.
   */
  async function fetchAllHLTB() {
    if (!hltbEnabled) {
      alert("Enable HowLongToBeat in Settings before running the bulk update.");
      return;
    }
    const libs = await db.library.toArray();
    let updated = 0;
    for (const row of libs) {
      try {
        const identity = await db.identities.get(row.identityId);
        if (!identity || !identity.title) continue;
        const hours = await lookupLocalHLTB(identity.title, identity.platform ?? undefined);
        if (hours == null) continue;
        await db.library.update(row.id, {
          ttbMedianMainH: hours,
        } as any);
        await db.identities.update(row.identityId, {
          ttbSource: "hltb-local",
          ttbMedianMainH: hours,
        } as any);
        updated++;
      } catch (e) {
        console.error("HLTB local fetch failed for", row?.identityId, e);
      }
    }
    alert(`HLTB local update complete (${updated} updated).`);
  }

  /**
   * Bulk fetch: iterate all library entries and update current Steam prices.
   * Uses the desktop bridge with the user's selected region and fallback
   * strategy.  Only runs under Tauri.  Stores both the price and currency
   * fields on each row.
   */
  async function fetchAllSteam() {
    if (!isTauri) {
      alert("Fetching Steam prices is only supported on the desktop build.");
      return;
    }
    const regionPref = steamRegion.toLowerCase();
    const fallback = ["us", "gb", "eu", "de", "fr", "tr", "jp", "au"];
    const libs = await db.library.toArray();
    for (const row of libs) {
      const identity = await db.identities.get(row.identityId);
      if (!identity?.appid) continue;
      const appid = identity.appid;
      let result: { price: number; currency: string } | null = null;
      const regions = [regionPref, ...fallback.filter((c) => c !== regionPref)];
      for (const cc of regions) {
        try {
          result = await fetchSteamPrice(appid, cc);
        } catch (_e) {
          result = null;
        }
        if (result) break;
      }
      if (result) {
        await db.library.update(row.id, {
          priceTRY: result.price,
          currencyCode: result.currency,
        } as any);
      }
    }
    alert("Steam price fetch complete.");
  }

  /**
   * Bulk fetch: iterate all entries and update OpenCritic scores.  Currently
   * disabled until a proper API is wired.  Shows an alert to the user.
   */
  async function fetchAllOpenCritic() {
    // Bulk fetch OpenCritic scores for all games.  Only runs on desktop
    // builds with the integration enabled.  Falls back to showing
    // informative messages when the feature is disabled or the app is
    // running in the browser.
    if (!isTauri) {
      alert("OpenCritic bulk fetch is only supported on the desktop build.");
      return;
    }
    if (!ocOn) {
      alert("Enable OpenCritic integration in settings to fetch scores.");
      return;
    }
    const libs = await db.library.toArray();
    for (const row of libs) {
      try {
        const identity = await db.identities.get(row.identityId);
        const title = identity?.title || "";
        if (!title) continue;
        const score = await fetchOpenCriticScore(title);
        if (score != null) {
          await db.library.update(row.id, { ocScore: score } as any);
        }
      } catch (e: any) {
        console.error("OpenCritic bulk fetch failed for", row.id, e);
      }
    }
    alert("OpenCritic fetch complete.");
  }

  /**
   * Clears the HLTB cache via Tauri.  Only available on desktop builds.
   */
  async function clearHLTBCache() {
    try {
      if (!(typeof window !== "undefined" && (window as any).__TAURI__)) {
        alert("HLTB cache clearing is desktop-only.");
        return;
      }
      await invoke("hltb_clear_cache");
      alert("HLTB cache cleared.");
    } catch (e: any) {
      alert(e?.message || String(e));
    }
  }

  async function clearRawgCaches() {
    try {
      const { games, explore, lists } = await clearRawgCache();
      clearRawgApiCache();
      alert(
        `RAWG cache cleared (${games} detail entr${games === 1 ? "y" : "ies"}, ${explore} explore entr${explore === 1 ? "y" : "ies"}, ${lists} list entr${lists === 1 ? "y" : "ies"}).`,
      );
    } catch (e: any) {
      alert(e?.message || "Failed to clear RAWG cache.");
    }
  }

  function clearMetacriticCache() {
    resetMCIndexCache();
    alert("Metacritic vendor cache cleared. The next lookup will reload the index.");
  }

  return (
    <div className="max-w-2xl space-y-6">
      <h1 className="text-2xl font-semibold">Settings</h1>

      <section className="space-y-3">
        <h2 className="text-lg font-medium">Integrations</h2>
        <div className="space-y-2 rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Display</h3>
          <label className="flex items-center gap-3">
            <input type="checkbox" checked={coversOn} onChange={(e) => setCoversOn(e.target.checked)} />
            <span>Covers (Steam / IGDB URLs)</span>
          </label>
          <label className="flex items-center gap-3">
            <input type="checkbox" checked={igdbOn} onChange={(e) => setIgdbOn(e.target.checked)} />
            <span>IGDB mock covers</span>
          </label>
        </div>
        <div className="space-y-2 rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Vendor data sources</h3>
          <label className="flex items-center gap-3">
            <input
              type="checkbox"
              checked={hltbEnabled}
              disabled={hltbPending}
              onChange={(event) => toggleVendor("hltb", event.target.checked)}
            />
            <span>HowLongToBeat (local dataset + desktop live)</span>
          </label>
          <p className="pl-7 text-xs text-zinc-500">
            Desktop live lookups still require the Tauri app; when disabled, enrichment skips all HLTB sources.
          </p>
          <label className="flex items-center gap-3">
            <input
              type="checkbox"
              checked={rawgEnabled}
              disabled={rawgPending}
              onChange={(event) => toggleVendor("rawg", event.target.checked)}
            />
            <span>RAWG metadata (covers, media, fallback scores)</span>
          </label>
          <label className="flex items-center gap-3">
            <input
              type="checkbox"
              checked={metacriticEnabled}
              disabled={metacriticPending}
              onChange={(event) => toggleVendor("metacritic", event.target.checked)}
            />
            <span>Metacritic vendor index</span>
          </label>
          <label className="flex items-center gap-3">
            <input type="checkbox" checked={ocOn} onChange={(e) => setOcOn(e.target.checked)} />
            <span>OpenCritic (desktop live, requires API key)</span>
          </label>
        </div>
        <p className="text-xs text-zinc-500">
          When all vendors are enabled the enrichment pipeline tries Steam -&gt; HLTB -&gt; RAWG for playtime and
          Metacritic -&gt; OpenCritic for critic scores.
        </p>
      </section>

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-medium">AI / Ally</h2>
          <button
            type="button"
            className="btn-ghost text-sm text-zinc-600"
            onClick={() => setShowAdvanced((prev) => !prev)}
          >
            {showAdvanced ? "Hide advanced" : "Show advanced"}
          </button>
        </div>
        {showAdvanced ? (
          <Suspense
            fallback={
              <div className="rounded-2xl border border-dashed border-zinc-200 bg-white p-4 text-sm text-zinc-500">
                Loading AI / Ally settings…
              </div>
            }
          >
            <div className="space-y-3 rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm">
              {isTauri ? (
            <>
              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  className="btn"
                  onClick={async () => {
                    try {
                      setAllyState({ status: "pending" });
                      const { allyVersion } = await loadAllyBridge();
                      const v = await allyVersion();
                      setAllyState({ status: "success", message: v || "ally" });
                    } catch (err) {
                      const message = toError(err);
                      setAllyState({ status: "error", message: "Test failed.", error: message });
                    }
                  }}
                  disabled={allyState.status === "pending"}
                >
                  {allyState.status === "pending" ? "Testing..." : "Test Ally"}
                </button>
                {renderStatusPill(allyState)}
                {allyState.message ? (
                  <span className="text-sm text-zinc-600">{allyState.message}</span>
                ) : null}
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <label className="text-sm text-zinc-700">Provider</label>
                <label className="inline-flex items-center gap-2 text-sm">
                  <input type="radio" name="ai_provider" checked={aiProvider === 'local'} onChange={() => setAiProvider('local')} />
                  <span>Local (llama.cpp)</span>
                </label>
                <label className="inline-flex items-center gap-2 text-sm">
                  <input type="radio" name="ai_provider" checked={aiProvider === 'ally'} onChange={() => setAiProvider('ally')} />
                  <span>Ally (Python)</span>
                </label>
              </div>
              {aiProvider === "local" ? (
                <div className="rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs text-zinc-600">
                  <p className="font-semibold text-zinc-700">Local models</p>
                  {localInfo ? (
                    <div className="mt-1 space-y-1">
                      <p>
                        Chat model: <span className="font-mono text-zinc-800">{localInfo.chat_path}</span>{" "}
                        {localInfo.chat_exists ? (
                          <span className="text-emerald-600">(found)</span>
                        ) : (
                          <span className="text-rose-600">(missing)</span>
                        )}
                      </p>
                      <p>
                        Embed model: <span className="font-mono text-zinc-800">{localInfo.embed_path}</span>{" "}
                        {localInfo.embed_exists ? (
                          <span className="text-emerald-600">(found)</span>
                        ) : (
                          <span className="text-rose-600">(missing)</span>
                        )}
                      </p>
                      {localInfo.found?.length ? (
                        <details className="text-[11px] text-zinc-500">
                          <summary className="cursor-pointer">All .gguf files</summary>
                          <ul className="mt-1 space-y-0.5">
                            {localInfo.found.map((entry) => (
                              <li key={entry} className="font-mono text-[11px] text-zinc-600">
                                {entry}
                              </li>
                            ))}
                          </ul>
                        </details>
                      ) : null}
                    </div>
                  ) : (
                    <p className="mt-1">Searching for models...</p>
                  )}
                </div>
              ) : null}
              {allyState.status === "error" && allyState.error ? (
                <details className="rounded-lg border border-rose-100 bg-rose-50 px-3 py-2 text-xs text-rose-700">
                  <summary className="cursor-pointer font-semibold">Error details</summary>
                  <pre className="mt-2 whitespace-pre-wrap text-rose-700">{allyState.error}</pre>
                </details>
              ) : null}

            <div className="text-xs text-zinc-500">
              <div>
                Data directory: {allyDataDir ? (
                  <span className="font-mono text-zinc-700">{allyDataDir}</span>
                ) : (
                  "Resolving..."
                )}
              </div>
              <div>Last export: {formatIso(lastAllyExportISO)}</div>
              <div>Last embed: {formatIso(lastAllyEmbedISO)}</div>
              <div>Last knowledge base start: {formatIso(lastAllyStartISO)}</div>
            </div>
            <div className="flex flex-wrap items-center gap-3 text-sm text-zinc-700">
              <label className="inline-flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={perfLoggingEnabled}
                  onChange={(event) => {
                    const value = event.target.checked;
                    setPerfLoggingEnabled(value);
                    void setSetting("dev.logPerf", value);
                  }}
                />
                <span>Log performance to console (&gt;= 20 ms)</span>
              </label>
            </div>
            <div className="flex flex-wrap items-center gap-3 text-sm text-zinc-700">
              <label className="inline-flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={saveTranscripts}
                  onChange={(event) => {
                    const value = event.target.checked;
                    setSaveTranscripts(value);
                    void setSetting(AI_SAVE_TRANSCRIPTS_KEY, value);
                    window.dispatchEvent(new CustomEvent("ally:transcripts-toggle", { detail: value }));
                  }}
                />
                <span>Save transcripts locally (Dexie only, never leaves this device).</span>
              </label>
              <button
                type="button"
                className="btn-ghost"
                onClick={async () => {
                  setClearingTranscripts(true);
                  try {
                    await clearTranscripts();
                  } catch (err) {
                    console.warn("Failed to clear transcripts:", err);
                  } finally {
                    setClearingTranscripts(false);
                  }
                }}
                disabled={clearingTranscripts}
              >
                {clearingTranscripts ? "Clearing..." : "Clear transcripts"}
              </button>
            </div>

            <div className="border-t border-zinc-200 pt-3">
              <AllyDigestCard onUpdate={handleAutomationUpdated} />
            </div>

            <div className="space-y-3 border-t border-zinc-200 pt-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Automations</h3>
                {automationSaving ? <span className="text-xs text-zinc-500">Saving...</span> : null}
              </div>
              {!automationLoaded ? (
                <p className="text-xs text-zinc-500">Loading automation settings...</p>
              ) : (
                <>
                  <label className="inline-flex items-center gap-2 text-sm text-zinc-700">
                    <input
                      type="checkbox"
                      checked={Boolean(automationSettings?.enabled)}
                      onChange={(event) => {
                        void updateAutomation({ enabled: event.target.checked });
                      }}
                      disabled={automationSaving}
                    />
                    <span>Enable nightly export/embed/start loop</span>
                  </label>
                  <div className="grid gap-3 md:grid-cols-2">
                    <label className="flex flex-col text-sm text-zinc-700">
                      <span className="font-medium">Export / Embed / Start time</span>
                      <input
                        type="time"
                        className="input mt-1"
                        value={automationSettings?.exportEmbedStartTime ?? "22:30"}
                        onChange={(event) => {
                          const value = event.target.value || "22:30";
                          void updateAutomation({ exportEmbedStartTime: value });
                        }}
                        disabled={!automationSettings?.enabled || automationSaving}
                      />
                    </label>
                    <label className="flex flex-col text-sm text-zinc-700">
                      <span className="font-medium">Digest time</span>
                      <input
                        type="time"
                        className="input mt-1"
                        value={automationSettings?.digestTime ?? "09:00"}
                        onChange={(event) => {
                          const value = event.target.value || "09:00";
                          void updateAutomation({ digestTime: value });
                        }}
                        disabled={!automationSettings?.enabled || automationSaving}
                      />
                    </label>
                  </div>
                  <div className="flex flex-wrap items-center gap-3 text-sm text-zinc-700">
                    <label className="inline-flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={Boolean(automationSettings?.digestEnabled)}
                        onChange={(event) => {
                          void updateAutomation({ digestEnabled: event.target.checked });
                        }}
                        disabled={!automationSettings?.enabled || automationSaving}
                      />
                      <span>Daily digest</span>
                    </label>
                    <label className="inline-flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={Boolean(automationSettings?.digestAllowWeb)}
                        onChange={(event) => {
                          void updateAutomation({ digestAllowWeb: event.target.checked });
                        }}
                        disabled={
                          !automationSettings?.enabled ||
                          !automationSettings?.digestEnabled ||
                          automationSaving
                        }
                      />
                      <span>Allow web fallback</span>
                    </label>
                    <label className="inline-flex items-center gap-2">
                      <span className="font-medium">Scope</span>
                      <select
                        className="input"
                        value={automationSettings?.digestScope ?? "coach"}
                        onChange={(event) => {
                          const scope = event.target.value as AllyAutomationSettings["digestScope"];
                          void updateAutomation({ digestScope: scope });
                        }}
                        disabled={
                          !automationSettings?.enabled ||
                          !automationSettings?.digestEnabled ||
                          automationSaving
                        }
                      >
                        <option value="coach">Coach (play next)</option>
                        <option value="deals">Deals</option>
                        <option value="both">Both</option>
                      </select>
                    </label>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      className="btn"
                      onClick={handleAutomationRun}
                      disabled={automationRunState.status === "pending"}
                    >
                      {automationRunState.status === "pending"
                        ? "Running..."
                        : "Run Export -> Embed -> Start now"}
                    </button>
                    {automationRunState.status === "success" && automationRunState.message ? (
                      <span className="text-xs text-emerald-600">{automationRunState.message}</span>
                    ) : null}
                    {automationRunState.status === "error" && automationRunState.error ? (
                      <span className="text-xs text-rose-600">
                        {automationRunState.message} {automationRunState.error}
                      </span>
                    ) : null}
                  </div>
                  <div className="grid gap-2 text-xs text-zinc-500 md:grid-cols-2">
                    <div>Last export: {formatIso(automationSettings?.lastExportISO)}</div>
                    <div>Last embed: {formatIso(automationSettings?.lastEmbedISO)}</div>
                    <div>Last start: {formatIso(automationSettings?.lastStartISO)}</div>
                    <div className="flex items-center gap-2">
                      <span>Last digest: {formatIso(automationSettings?.lastDigestISO)}</span>
                      {automationSettings?.lastDigestISO ? (
                        <span
                          className={
                            automationSettings?.lastDigestStatus === "error"
                              ? "rounded-full bg-rose-100 px-2 py-0.5 text-[10px] font-semibold text-rose-700"
                              : "rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold text-emerald-700"
                          }
                        >
                          {(automationSettings?.lastDigestStatus ?? "ok").toUpperCase()}
                        </span>
                      ) : null}
                    </div>
                  </div>
                </>
              )}
            </div>

            <div className="border-t border-zinc-200 pt-3">
              <details
                className="rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2"
                open={logsExpanded}
                onToggle={(event) => setLogsExpanded(event.currentTarget.open)}
              >
                <summary className="cursor-pointer text-xs font-semibold uppercase tracking-wide text-zinc-500">
                  Automation logs
                </summary>
                <div className="mt-2 space-y-2 text-xs text-zinc-600">
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      className="btn-ghost"
                      onClick={() => void refreshLogs()}
                      disabled={!logsLoaded}
                    >
                      Refresh
                    </button>
                    <button
                      type="button"
                      className="btn-ghost"
                      onClick={() => void handleClearLogs()}
                      disabled={!logsLoaded || allyLogs.length === 0}
                    >
                      Clear
                    </button>
                    {logsError ? <span className="text-rose-600">{logsError}</span> : null}
                  </div>
                  {!logsLoaded ? (
                    <p className="text-xs text-zinc-500">Loading logs...</p>
                  ) : allyLogs.length === 0 ? (
                    <p className="text-xs text-zinc-500">No log entries yet.</p>
                  ) : (
                    <ul className="max-h-48 space-y-1 overflow-auto rounded border border-zinc-200 bg-white p-2">
                      {allyLogs.map((entry) => (
                        <li
                          key={entry.id ?? entry.atISO}
                          className="space-y-1 border-b border-zinc-100 pb-1 last:border-0"
                        >
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <span className="font-medium text-zinc-700">
                              {new Date(entry.atISO).toLocaleString()}
                            </span>
                            <span
                              className={
                                entry.level === "error"
                                  ? "rounded-full bg-rose-100 px-2 py-0.5 text-[10px] font-semibold text-rose-700"
                                  : entry.level === "warn"
                                  ? "rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-700"
                                  : "rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold text-emerald-700"
                              }
                            >
                              {entry.level.toUpperCase()}
                            </span>
                          </div>
                          <div className="text-[11px] text-zinc-600">{entry.msg}</div>
                          {entry.ctx ? (
                            <details className="text-[10px] text-zinc-500">
                              <summary className="cursor-pointer">Context</summary>
                              <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap rounded bg-zinc-100 p-2 text-[10px] text-zinc-700">
                                {JSON.stringify(entry.ctx, null, 2)}
                              </pre>
                            </details>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </details>
            </div>

            {aiProvider === "local" ? (
              <div className="rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Local sanity checks</h3>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      className="btn-ghost"
                      onClick={handleLocalChatTest}
                      disabled={localChatState.status === "pending"}
                    >
                      {localChatState.status === "pending" ? "Testing chat..." : "Test local chat"}
                    </button>
                    {renderStatusPill(localChatState)}
                    {localChatState.message ? (
                      <span className="text-xs text-zinc-500">{localChatState.message}</span>
                    ) : null}
                  </div>
                  {localChatState.status === "error" && localChatState.error ? (
                    <details className="mt-1 text-xs text-rose-700">
                      <summary className="cursor-pointer font-semibold">Chat error</summary>
                      <pre className="mt-1 whitespace-pre-wrap">{localChatState.error}</pre>
                    </details>
                  ) : null}
                  {localChatOutput ? (
                    <pre className="mt-1 max-h-32 overflow-auto whitespace-pre-wrap rounded border border-zinc-200 bg-white px-2 py-1 text-xs text-zinc-700">
                      {localChatOutput}
                    </pre>
                  ) : null}

                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      className="btn-ghost"
                      onClick={handleLocalEmbedTest}
                      disabled={localEmbedState.status === "pending"}
                    >
                      {localEmbedState.status === "pending" ? "Computing embeddings..." : "Test local embedding"}
                    </button>
                    {renderStatusPill(localEmbedState)}
                    {localEmbedState.message ? (
                      <span className="text-xs text-zinc-500">{localEmbedState.message}</span>
                    ) : null}
                  </div>
                  {localEmbedState.status === "error" && localEmbedState.error ? (
                    <details className="mt-1 text-xs text-rose-700">
                      <summary className="cursor-pointer font-semibold">Embedding error</summary>
                      <pre className="mt-1 whitespace-pre-wrap">{localEmbedState.error}</pre>
                    </details>
                  ) : null}
                  {localEmbedSummary ? (
                    <p className="mt-1 text-xs text-emerald-600">{localEmbedSummary}</p>
                  ) : null}
                </div>
              ) : null}

              <div className="space-y-3 border-t border-zinc-200 pt-3">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Knowledge base bootstrap</h3>
                <div className="space-y-2">
                  <div className="rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <div className="text-sm font-semibold text-zinc-800">1. Export library JSON</div>
                        <div className="text-xs text-zinc-500">Last run {formatIso(lastAllyExportISO)}</div>
                        {allyExportState.status === "success" && allyExportState.message ? (
                          <p className="mt-1 text-xs text-emerald-600">{allyExportState.message}</p>
                        ) : null}
                      </div>
                      {renderStatusPill(allyExportState)}
                    </div>
                    {allyExportState.status === "error" && allyExportState.error ? (
                      <details className="mt-2 text-xs text-rose-700">
                        <summary className="cursor-pointer font-semibold">Error details</summary>
                        <pre className="mt-1 whitespace-pre-wrap">{allyExportState.error}</pre>
                      </details>
                    ) : null}
                  </div>

                  <div className="rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <div className="text-sm font-semibold text-zinc-800">2. Embed library into Ally</div>
                        <div className="text-xs text-zinc-500">Last run {formatIso(lastAllyEmbedISO)}</div>
                        {allyEmbedState.status === "success" && allyEmbedState.message ? (
                          <p className="mt-1 text-xs text-emerald-600">{allyEmbedState.message}</p>
                        ) : null}
                      </div>
                      {renderStatusPill(allyEmbedState)}
                    </div>
                    {allyEmbedState.status === "error" && allyEmbedState.error ? (
                      <details className="mt-2 text-xs text-rose-700">
                        <summary className="cursor-pointer font-semibold">Error details</summary>
                        <pre className="mt-1 whitespace-pre-wrap">{allyEmbedState.error}</pre>
                      </details>
                    ) : null}
                  </div>

                  <div className="rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <div className="text-sm font-semibold text-zinc-800">3. Start knowledge base session</div>
                        <div className="text-xs text-zinc-500">Last run {formatIso(lastAllyStartISO)}</div>
                        {allyStartState.status === "success" && allyStartState.message ? (
                          <p className="mt-1 text-xs text-emerald-600">{allyStartState.message}</p>
                        ) : null}
                      </div>
                      {renderStatusPill(allyStartState)}
                    </div>
                    {allyStartState.status === "error" && allyStartState.error ? (
                      <details className="mt-2 text-xs text-rose-700">
                        <summary className="cursor-pointer font-semibold">Error details</summary>
                        <pre className="mt-1 whitespace-pre-wrap">{allyStartState.error}</pre>
                      </details>
                    ) : null}
                  </div>
                </div>

                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    className="btn"
                    onClick={handleRunAll}
                    disabled={
                      bootstrapRunning ||
                      allyExportState.status === "pending" ||
                      allyEmbedState.status === "pending" ||
                      allyStartState.status === "pending"
                    }
                  >
                    {bootstrapRunning ? "Running..." : "Run all (Export -> Embed -> Start)"}
                  </button>
                  <button
                    type="button"
                    className="btn-ghost"
                    onClick={handleAllyExportNow}
                    disabled={allyExportState.status === "pending" || bootstrapRunning}
                  >
                    Export only
                  </button>
                  <button
                    type="button"
                    className="btn-ghost"
                    onClick={handleAllyEmbed}
                    disabled={allyEmbedState.status === "pending" || bootstrapRunning}
                  >
                    Embed only
                  </button>
                  <button
                    type="button"
                    className="btn-ghost"
                    onClick={handleAllyStart}
                    disabled={allyStartState.status === "pending" || bootstrapRunning}
                  >
                    Start KB only
                  </button>
                </div>

                {allyExportResults.length ? (
                  <div className="overflow-x-auto">
                    <table className="min-w-[16rem] text-left text-xs">
                      <thead>
                        <tr className="text-zinc-500">
                          <th className="px-2 py-1">File</th>
                          <th className="px-2 py-1 text-right">Bytes</th>
                        </tr>
                      </thead>
                      <tbody>
                        {allyExportResults.map((entry) => (
                          <tr key={entry.file} className="border-t border-zinc-200">
                            <td className="px-2 py-1 font-mono text-zinc-700">{entry.file}</td>
                            <td className="px-2 py-1 text-right text-zinc-600">{entry.bytes.toLocaleString()}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : null}

                {allyEmbedOutput ? (
                  <details className="rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs text-zinc-600">
                    <summary className="cursor-pointer font-semibold text-zinc-700">Embed output</summary>
                    <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap text-zinc-700">{allyEmbedOutput}</pre>
                  </details>
                ) : null}

                {allyStartOutput ? (
                  <details className="rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs text-zinc-600">
                    <summary className="cursor-pointer font-semibold text-zinc-700">Start output</summary>
                    <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap text-zinc-700">{allyStartOutput}</pre>
                  </details>
                ) : null}
              </div>

              <div className="space-y-3 border-t border-zinc-200 pt-3">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Chat smoke test</h3>
                {chatSession ? (
                  <p className="text-xs text-zinc-500">
                    Active session: <span className="font-mono text-zinc-700">{chatSession}</span>
                  </p>
                ) : (
                  <p className="text-xs text-zinc-500">Session starts when you send your first message.</p>
                )}
                <textarea
                  className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-700 shadow-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  rows={3}
                  placeholder="Ask Ally something about your library..."
                  value={chatInput}
                  onChange={(event) => setChatInput(event.target.value)}
                />
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    className="btn"
                    onClick={handleChatSend}
                    disabled={chatState.status === "pending" || !chatInput.trim()}
                  >
                    {chatState.status === "pending" ? "Sending..." : "Send"}
                  </button>
                  <button type="button" className="btn-ghost" onClick={handleResetChatSession}>
                    Reset session
                  </button>
                  {renderStatusPill(chatState)}
                </div>
                {chatState.message ? (
                  <p className="text-xs text-zinc-500">{chatState.message}</p>
                ) : null}
                {chatState.status === "error" && chatState.error ? (
                  <details className="rounded-lg border border-rose-100 bg-rose-50 px-3 py-2 text-xs text-rose-700">
                    <summary className="cursor-pointer font-semibold">Error details</summary>
                    <pre className="mt-2 whitespace-pre-wrap text-rose-700">{chatState.error}</pre>
                  </details>
                ) : null}
                {chatResponse ? (
                  <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-3">
                    <h4 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Latest reply</h4>
                    <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap text-sm text-zinc-800">
                      {chatResponse.content || "(empty)"}
                    </pre>
                  </div>
                ) : null}
                {chatHistory.length ? (
                  <div className="space-y-1 text-xs text-zinc-600">
                    <h4 className="font-semibold uppercase tracking-wide text-zinc-500">History</h4>
                    {chatHistory.map((entry, index) => (
                      <div key={index} className="rounded border border-zinc-200 bg-white px-2 py-1">
                        <span className="font-semibold text-zinc-700">{entry.role === "user" ? "You" : "Ally"}:</span>
                        <span className="ml-1 whitespace-pre-wrap font-mono text-zinc-700">
                          {entry.content || "(empty)"}
                        </span>
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            </>
          ) : (
            <p className="text-sm text-zinc-600">AI sidecar requires desktop build.</p>
          )}
        </div>
        </Suspense>
        ) : (
          <p className="text-sm text-zinc-600">
            Advanced AI and automation settings are hidden to improve load time. Select Show to configure Ally or local models.
          </p>
        )}
      </section>

      {/* Card layout fixed to "Large" size.  The card width is set globally to 340px via CSS. */}
      <section className="space-y-4">
        <h2 className="text-lg font-medium">Steam</h2>
        <p className="text-sm text-zinc-600">
          Connect your Steam account to import owned games, prices, news, and achievements.
        </p>
        <div className="space-y-3 rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm">
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-zinc-700">Vanity URL or SteamID64</span>
            <input
              type="text"
              value={steamInput}
              onChange={(event) => {
                setSteamInput(event.target.value);
                setSteamResolveState({ status: "idle" });
              }}
              placeholder="https://steamcommunity.com/id/yourname"
              className="input"
              autoComplete="off"
            />
          </label>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="btn"
              onClick={handleResolveSteam}
              disabled={!isTauri || steamResolveState.status === "pending"}
            >
              {steamResolveState.status === "pending" ? "Resolving..." : "Resolve vanity"}
            </button>
            <button
              type="button"
              className="btn-ghost"
              onClick={handleSaveSteamId}
              disabled={!steamInput.trim()}
            >
              Save as my Steam ID
            </button>
            <button
              type="button"
              className="btn-ghost"
              onClick={handleTestSteam}
              disabled={!isTauri || steamTestState.status === "pending"}
            >
              {steamTestState.status === "pending" ? "Testing..." : "Test connection"}
            </button>
          </div>
          {savedSteamId ? (
            <p className="text-xs text-zinc-500">
              Saved ID: <span className="font-mono text-zinc-700">{savedSteamId}</span>
            </p>
          ) : null}
          {steamResolveState.status !== "idle" && steamResolveState.message ? (
            <p
              className={`text-xs ${
                steamResolveState.status === "error" ? "text-rose-600" : "text-emerald-600"
              }`}
            >
              {steamResolveState.message}
            </p>
          ) : null}
          {steamTestState.status !== "idle" && steamTestState.message ? (
            <p
              className={`text-xs ${
                steamTestState.status === "error" ? "text-rose-600" : "text-emerald-600"
              }`}
            >
              {steamTestState.message}
            </p>
          ) : null}
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-zinc-700">Store region</span>
            <select
              className="select"
              value={steamRegion}
              onChange={(event) => setSteamRegion(event.target.value)}
            >
              {STEAM_REGION_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label} ({option.value.toUpperCase()})
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-zinc-700">Store language</span>
            <select
              className="select"
              value={steamLanguage}
              onChange={(event) => setSteamLanguage(event.target.value)}
            >
              {STEAM_LANGUAGE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-medium">Enrichment session</h2>
        {hasEnrichmentSession ? (
          <>
            <p className="text-sm text-zinc-600">
              Status: <span className="font-medium text-zinc-800">{enrichmentStatus}</span>
              {enrichmentProgress ? ` - ${enrichmentProgress}` : ""}
            </p>
            {enrichmentSnapshot.halted && (
              <p className="text-xs text-amber-600">
                Metadata from this run is flagged until the remaining rows finish. Resume when ready.
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className="btn"
                onClick={handleResumeEnrichment}
                disabled={!canResumeEnrichment}
                title={
                  canResumeEnrichment
                    ? "Resume enrichment"
                    : "Resume is available when the session is paused or halted"
                }
              >
                Resume enrichment
              </button>
              <button
                type="button"
                className="btn-ghost"
                onClick={handleHaltEnrichment}
                disabled={!canHaltEnrichment}
                title="Halt enrichment and continue later"
              >
                Halt
              </button>
              <button
                type="button"
                className="btn-ghost"
                onClick={() => {
                  if (typeof window !== "undefined") {
                    window.dispatchEvent(new CustomEvent("gt:show-enrichment"));
                  }
                }}
              >
                Show progress
              </button>
            </div>
          </>
        ) : (
          <p className="text-sm text-zinc-600">
            No background enrichment session is pending. Start an import to enrich metadata.
          </p>
        )}
      </section>

      {isTauri ? (
        <section className="space-y-3">
          <h2 className="text-lg font-medium">Updates</h2>
          <p className="text-sm text-zinc-600">
            Last checked:{" "}
            {updateState.lastChecked ? formatIso(updateState.lastChecked) : "No checks performed yet."}
          </p>
          {updateState.status === "available" ? (
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700">
              Update available{updateState.version ? ` (v${updateState.version})` : ""}. Install to restart the desktop
              app.
            </div>
          ) : null}
          {updateState.status === "error" && updateState.message ? (
            <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-600">
              {updateState.message}
            </div>
          ) : null}
          {updateState.status === "uptodate" && updateState.message ? (
            <p className="text-xs text-emerald-600">{updateState.message}</p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="btn"
              onClick={handleCheckForUpdates}
              disabled={updateState.status === "checking" || installingUpdate}
            >
              {updateState.status === "checking" ? "Checking..." : "Check for updates"}
            </button>
            {canInstallUpdate ? (
              <button
                type="button"
                className="btn"
                onClick={handleInstallUpdate}
                disabled={installingUpdate}
              >
                {installingUpdate ? "Installing..." : "Install and restart"}
              </button>
            ) : null}
          </div>
        </section>
      ) : null}

      {isTauri ? (
        <section className="space-y-3">
          <h2 className="text-lg font-medium">Diagnostics</h2>
          <p className="text-sm text-zinc-600">
            Collect logs, recent digests, and settings into a zip for troubleshooting.
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="btn"
              onClick={handleExportDiagnostics}
              disabled={diagnosticsState.status === "pending"}
            >
              {diagnosticsState.status === "pending" ? "Exporting..." : "Export diagnostics (zip)"}
            </button>
          </div>
          {diagnosticsState.status === "ready" && diagnosticsState.path ? (
            <p className="text-xs text-emerald-600">
              Saved to <span className="font-semibold">{diagnosticsState.path}</span>.
            </p>
          ) : null}
          {diagnosticsState.status === "error" && diagnosticsState.message ? (
            <p className="text-xs text-rose-600">Export failed: {diagnosticsState.message}</p>
          ) : null}
        </section>
      ) : null}

      <section className="space-y-3">
        <h2 className="text-lg font-medium">Data</h2>
        <div className="flex flex-wrap gap-2">
          <button
            className="btn"
            onClick={async () => {
              if (!confirm("Clear all local data (profiles, library, settings)?")) return;
              await clearAllData();
              alert("All data cleared.");
              location.reload();
            }}
          >
            Clear Profile (all local data)
          </button>
          <button
            className="btn-ghost"
            onClick={clearHLTBCache}
            disabled={!(typeof window !== "undefined" && (window as any).__TAURI__)}
          >
            Clear HLTB Cache (desktop)
          </button>
          <button
            className="btn-ghost"
            onClick={clearRawgCaches}
            title="Removes cached RAWG detail and explore entries."
          >
            Clear RAWG Cache
          </button>
          <button
            className="btn-ghost"
            onClick={clearMetacriticCache}
            title="Resets the in-memory Metacritic vendor index."
          >
            Reset Metacritic Cache
          </button>
        </div>
      </section>

      {/* Bulk fetch actions.  These buttons iterate through the entire
          library and update metadata in bulk.  They remain disabled when
          their respective integration is turned off or unavailable. */}
      <section className="space-y-3">
        <h2 className="text-lg font-medium">Bulk fetch</h2>
        <div className="flex flex-wrap gap-2">
          <button
            className="btn"
            onClick={fetchAllHLTB}
            disabled={!hltbEnabled || hltbPending}
            title={
              !hltbEnabled
                ? "Enable HowLongToBeat integration to use this"
                : hltbPending
                  ? "Updating HowLongToBeat preference..."
                  : "Fetch HLTB times for all games"
            }
          >
            Fetch all HLTB
          </button>
          <button
            className="btn"
            onClick={fetchAllSteam}
            disabled={!isTauri}
            title={isTauri ? "Fetch Steam prices for all games" : "Desktop-only"}
          >
            Fetch all Steam prices
          </button>
          <button
            className="btn"
            onClick={fetchAllOpenCritic}
            disabled={!ocOn}
            title={!ocOn ? "Enable OpenCritic integration to use this" : "Fetch OpenCritic scores for all games"}
          >
            Fetch all OpenCritic
          </button>
        </div>
      </section>
    </div>
  );
}
