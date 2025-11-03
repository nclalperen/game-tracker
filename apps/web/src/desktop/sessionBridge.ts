import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { normalizeTitle } from "@tracker/core";
import {
  addSessionEntry,
  updateSessionEntry,
  db,
  type SessionEntry,
  getSessionsExeMap,
  setSessionsExeMap,
  getSessionsEnabledSetting,
  setSessionsEnabledSetting,
} from "@/db";
import { isTauri } from "./bridge";

type SessionStartedPayload = {
  exe: string;
  title?: string | null;
  startedAtISO: string;
};

type SessionStoppedPayload = {
  exe: string;
  endedAtISO: string;
  durationMs: number;
};

type ExeCache = Record<string, string | null>;

const IGNORED_EXECUTABLES = new Set([
  "tracker-desktop.exe",
  "tracker-desktop",
  "steam.exe",
  "steam",
  "explorer.exe",
  "explorer",
  "vlc.exe",
  "discord.exe",
]);

const IDENTITY_INDEX = new Map<string, string>();
let identityIndexLoaded = false;
let exeCacheLoaded = false;
const EXE_CACHE = new Map<string, string | null>();
const EXE_CACHE_LIMIT = 200;

const ACTIVE_SESSIONS = new Map<string, { id: string; identityId: string | null }>();
let initialized = false;
let listeners: UnlistenFn[] = [];
let lastIdentityId: string | null = null;
const identityListeners: Array<(identityId: string | null) => void> = [];

function notifyIdentity(identityId: string | null) {
  for (const listener of identityListeners) {
    try {
      listener(identityId);
    } catch (error) {
      console.error("Session identity listener failed", error);
    }
  }
}

function updateLastIdentityFromActive() {
  const lastEntry = Array.from(ACTIVE_SESSIONS.values()).pop();
  lastIdentityId = lastEntry?.identityId ?? null;
  notifyIdentity(lastIdentityId);
}

function sanitizeCandidate(input: string | null | undefined): string {
  if (!input) return "";
  return input.replace(/\.exe$/i, "").trim();
}

async function ensureIdentityIndex() {
  if (identityIndexLoaded) return;
  const identities = await db.identities.toArray();
  IDENTITY_INDEX.clear();
  for (const identity of identities) {
    if (!identity?.id || !identity.title) continue;
    const normalized = normalizeTitle(identity.title);
    if (!normalized) continue;
    IDENTITY_INDEX.set(normalized, identity.id);
  }
  identityIndexLoaded = true;
}

async function ensureExeCacheLoaded() {
  if (exeCacheLoaded) return;
  try {
    const stored = await getSessionsExeMap();
    if (stored) {
      for (const [exe, identityId] of Object.entries(stored)) {
        EXE_CACHE.set(exe, identityId);
      }
    }
  } catch (error) {
    console.warn("Failed to load session exe cache", error);
  } finally {
    exeCacheLoaded = true;
  }
}

async function persistExeCache() {
  if (!exeCacheLoaded) return;
  const payload: ExeCache = {};
  for (const [key, value] of EXE_CACHE.entries()) {
    payload[key] = value ?? null;
  }
  try {
    await setSessionsExeMap(payload);
  } catch (error) {
    console.warn("Failed to persist session exe cache", error);
  }
}

function cacheExeMapping(exe: string, identityId: string | null) {
  if (!exe) return;
  const key = exe.toLowerCase();
  if (!EXE_CACHE.has(key) && EXE_CACHE.size >= EXE_CACHE_LIMIT) {
    const [firstKey] = EXE_CACHE.keys();
    if (firstKey) {
      EXE_CACHE.delete(firstKey);
    }
  }
  EXE_CACHE.set(key, identityId);
}

async function resolveExeToIdentity(exe: string, title?: string | null): Promise<string | null> {
  if (!exe) return null;
  await ensureExeCacheLoaded();
  const key = exe.toLowerCase();
  if (EXE_CACHE.has(key)) {
    return EXE_CACHE.get(key) ?? null;
  }

  await ensureIdentityIndex();
  const candidates = [sanitizeCandidate(title), sanitizeCandidate(exe)];

  for (const candidate of candidates) {
    const normalized = normalizeTitle(candidate);
    if (!normalized) continue;
    const match = IDENTITY_INDEX.get(normalized);
    if (match) {
      cacheExeMapping(key, match);
      await persistExeCache();
      return match;
    }
  }

  cacheExeMapping(key, null);
  await persistExeCache();
  return null;
}

function ensureId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `sess_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

async function handleSessionStarted(payload: SessionStartedPayload) {
  if (!payload.exe) return;
  if (IGNORED_EXECUTABLES.has(payload.exe.toLowerCase())) return;

  try {
    const identityId = await resolveExeToIdentity(payload.exe, payload.title);
    const entry: SessionEntry = {
      id: ensureId(),
      exe: payload.exe,
      identityId: identityId ?? null,
      startedAt: payload.startedAtISO,
      endedAt: null,
      durationMs: null,
    };
    await addSessionEntry(entry);
    const key = payload.exe.toLowerCase();
    ACTIVE_SESSIONS.set(key, { id: entry.id, identityId: entry.identityId });
    updateLastIdentityFromActive();
  } catch (error) {
    console.error("Failed to record session start", error);
  }
}

async function handleSessionStopped(payload: SessionStoppedPayload) {
  const key = payload.exe?.toLowerCase();
  if (!key) return;
  const active = ACTIVE_SESSIONS.get(key);
  if (!active) return;

  try {
    await updateSessionEntry(active.id, {
      endedAt: payload.endedAtISO,
      durationMs: payload.durationMs ?? null,
    });
  } catch (error) {
    console.error("Failed to finalize session", error);
  } finally {
    ACTIVE_SESSIONS.delete(key);
    updateLastIdentityFromActive();
  }
}

export async function initSessionBridge() {
  if (initialized || !isTauri) return;
  initialized = true;

  try {
    const [startListener, stopListener] = await Promise.all([
      listen<SessionStartedPayload>("session_started", async ({ payload }) => {
        await handleSessionStarted(payload);
      }),
      listen<SessionStoppedPayload>("session_stopped", async ({ payload }) => {
        await handleSessionStopped(payload);
      }),
    ]);
    listeners.push(startListener, stopListener);
  } catch (error) {
    console.error("Failed to initialize session bridge", error);
  }
}

export function disposeSessionBridge() {
  listeners.forEach((fn) => fn());
  listeners = [];
  ACTIVE_SESSIONS.clear();
  initialized = false;
}

export async function setSessionsEnabled(enable: boolean): Promise<void> {
  if (isTauri) {
    try {
      await invoke("sessions_enable_cmd", { enable });
    } catch (error) {
      console.error("Failed to toggle session tracking", error);
      return;
    }
  }
  await setSessionsEnabledSetting(enable);
  if (!enable) {
    ACTIVE_SESSIONS.clear();
  }
}

export async function fetchSessionsEnabled(): Promise<boolean> {
  const stored = await getSessionsEnabledSetting();
  if (typeof stored === "boolean") return stored;
  return true;
}

export async function fetchNowPlaying(): Promise<string | null> {
  if (!isTauri) return null;
  try {
    const result = await invoke<string | null>("sessions_now_playing_cmd");
    return result ?? null;
  } catch (error) {
    console.warn("Failed to fetch now playing info", error);
    return null;
  }
}

export function getLastActiveIdentity(): string | null {
  return lastIdentityId;
}

export function subscribeActiveIdentity(listener: (identityId: string | null) => void): () => void {
  identityListeners.push(listener);
  try {
    listener(lastIdentityId);
  } catch (error) {
    console.error("Session identity listener failed during subscribe", error);
  }
  return () => {
    const index = identityListeners.indexOf(listener);
    if (index >= 0) {
      identityListeners.splice(index, 1);
    }
  };
}


