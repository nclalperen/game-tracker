import { useSyncExternalStore } from "react";
import { getSetting, setSetting } from "@/db";

export type VendorKey = "rawg" | "hltb" | "metacritic";

type VendorState = Record<VendorKey, boolean>;

const VENDOR_KEYS: VendorKey[] = ["rawg", "hltb", "metacritic"];
const STORAGE_PREFIX = "vendor:";

function storageKey(key: VendorKey): string {
  return `${STORAGE_PREFIX}${key}:enabled`;
}

function legacyKey(key: VendorKey): string | null {
  if (key === "hltb") return "hltb_enabled";
  if (key === "metacritic") return "mc_vendor_enabled";
  if (key === "rawg") return "rawg_enabled";
  return null;
}

function defaultValue(key: VendorKey): boolean {
  if (key === "hltb") {
    try {
      return typeof window !== "undefined" && Boolean((window as any).__TAURI__);
    } catch {
      return false;
    }
  }
  return true;
}

function readLocalFlag(key: VendorKey): boolean | undefined {
  if (typeof localStorage === "undefined") {
    return undefined;
  }
  const raw = localStorage.getItem(storageKey(key));
  if (raw === "1") return true;
  if (raw === "0") return false;
  const legacy = legacyKey(key);
  if (legacy) {
    const legacyValue = localStorage.getItem(legacy);
    if (legacyValue === "1") return true;
    if (legacyValue === "0") return false;
  }
  return undefined;
}

function writeLocalFlag(key: VendorKey, value: boolean): void {
  if (typeof localStorage === "undefined") {
    return;
  }
  localStorage.setItem(storageKey(key), value ? "1" : "0");
  const legacy = legacyKey(key);
  if (legacy) {
    localStorage.setItem(legacy, value ? "1" : "0");
  }
}

let state: VendorState = {
  rawg: readLocalFlag("rawg") ?? defaultValue("rawg"),
  hltb: readLocalFlag("hltb") ?? defaultValue("hltb"),
  metacritic: readLocalFlag("metacritic") ?? defaultValue("metacritic"),
};

const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((listener) => {
    try {
      listener();
    } catch (err) {
      console.error("vendorFlags listener error", err);
    }
  });
}

export function subscribeVendorFlags(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useVendorFlag(key: VendorKey): boolean {
  return useSyncExternalStore(
    subscribeVendorFlags,
    () => isVendorEnabled(key),
    () => isVendorEnabled(key),
  );
}

export function isVendorEnabled(key: VendorKey): boolean {
  return state[key];
}

export function getVendorFlags(): VendorState {
  return { ...state };
}

export async function setVendorFlag(
  key: VendorKey,
  value: boolean,
  opts: { skipDexie?: boolean } = {},
): Promise<void> {
  if (state[key] === value) {
    if (!opts.skipDexie) {
      await setSetting(`vendor.${key}.enabled`, value);
    }
    return;
  }
  state = { ...state, [key]: value };
  writeLocalFlag(key, value);
  emit();
  if (!opts.skipDexie) {
    await setSetting(`vendor.${key}.enabled`, value);
  }
}

export async function hydrateVendorFlags(): Promise<void> {
  await Promise.all(
    VENDOR_KEYS.map(async (key) => {
      let stored: boolean | undefined;
      try {
        stored = await getSetting<boolean>(`vendor.${key}.enabled`);
      } catch {
        stored = undefined;
      }
      const fallback =
        stored ?? readLocalFlag(key) ?? defaultValue(key);
      await setVendorFlag(key, fallback, { skipDexie: true });
      if (stored === undefined) {
        void setSetting(`vendor.${key}.enabled`, fallback);
      }
    }),
  );
}
