import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { normalizeTitle } from "@tracker/core";
import {
  addSessionEntry,
  updateSessionEntry,
  db,
  type SessionEntry,
} from "@/db";
import { isTauri } from "./bridge";

type SessionStartedPayload = {
  exe: string;
  title?: string | null;
  started_at: number;
};

type SessionStoppedPayload = {
  exe: string;
  ended_at: number;
  duration_ms: number;
};

const IDENTITY_INDEX = new Map<string, string>();
const EXE_CACHE = new Map<string, string | null>();
let identityIndexLoaded = false;
let initialized = false;
let unlistenFns: UnlistenFn[] = [];

const IGNORED_EXECUTABLES = new Set([
  "tracker-desktop.exe",
  "tracker-desktop",
  "steam.exe",
  "steam",
  "explorer.exe",
  "explorer",
]);

const activeSessions = new Map<string, { id: string }>();

async function ensureIdentityIndex() {
  if (identityIndexLoaded) return;
  const identities = await db.identities.toArray();
  IDENTITY_INDEX.clear();
  for (const identity of identities) {
    if (!identity.title) continue;
    const normalized = normalizeTitle(identity.title);
    if (!normalized) continue;
    IDENTITY_INDEX.set(normalized, identity.id);
  }
  identityIndexLoaded = true;
}

function sanitizeCandidate(input: string | null | undefined): string {
  if (!input) return "";
  return input.replace(/\.exe$/i, "");
}

async function resolveIdentityId(exe: string, title?: string | null): Promise<string | null> {
  if (exe) {
    const cached = EXE_CACHE.get(exe);
    if (cached !== undefined) {
      return cached;
    }
  }

  await ensureIdentityIndex();

  const candidates = [sanitizeCandidate(title ?? null), sanitizeCandidate(exe)];
  for (const candidate of candidates) {
    const normalized = normalizeTitle(candidate);
    if (!normalized) continue;
    const match = IDENTITY_INDEX.get(normalized);
    if (match) {
      EXE_CACHE.set(exe, match);
      return match;
    }
  }

  EXE_CACHE.set(exe, null);
  return null;
}

function makeSessionId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `sess_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

async function handleSessionStarted(payload: SessionStartedPayload) {
  if (!payload.exe || IGNORED_EXECUTABLES.has(payload.exe.toLowerCase())) {
    return;
  }

  const startedAtIso = new Date(payload.started_at).toISOString();
  const sessionId = makeSessionId();
  const identityId = await resolveIdentityId(payload.exe, payload.title);

  const entry: SessionEntry = {
    id: sessionId,
    exe: payload.exe,
    identityId: identityId ?? null,
    startedAt: startedAtIso,
    endedAt: null,
    durationMs: null,
  };

  try {
    await addSessionEntry(entry);
    activeSessions.set(payload.exe, { id: sessionId });
  } catch (err) {
    console.error("Failed to record session start", err);
  }
}

async function handleSessionStopped(payload: SessionStoppedPayload) {
  const active = activeSessions.get(payload.exe);
  if (!active) {
    return;
  }

  const updates: Partial<SessionEntry> = {
    endedAt: new Date(payload.ended_at).toISOString(),
    durationMs: payload.duration_ms,
  };

  try {
    await updateSessionEntry(active.id, updates);
  } catch (err) {
    console.error("Failed to finalize session", err);
  } finally {
    activeSessions.delete(payload.exe);
  }
}

export async function initSessionBridge() {
  if (initialized || !isTauri) return;
  initialized = true;

  try {
    const unlistenStart = await listen<SessionStartedPayload>("session_started", async (event) => {
      await handleSessionStarted(event.payload);
    });
    const unlistenStop = await listen<SessionStoppedPayload>("session_stopped", async (event) => {
      await handleSessionStopped(event.payload);
    });
    unlistenFns.push(unlistenStart, unlistenStop);
  } catch (err) {
    console.error("Failed to initialize session bridge", err);
  }
}

export function disposeSessionBridge() {
  unlistenFns.forEach((fn) => fn());
  unlistenFns = [];
  activeSessions.clear();
  initialized = false;
}
