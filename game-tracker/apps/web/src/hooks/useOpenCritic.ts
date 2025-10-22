import { useState } from "react";
import { flags } from "@tracker/core";
import { isTauri, fetchOpenCriticScore } from "@/desktop/bridge";

type Result = { ocScore?: number | null };

export function useOpenCritic() {
  const [busy, setBusy] = useState(false);

  // Determine if OpenCritic is enabled.  Under Tauri the bridge is
  // available; users can also override via localStorage.  This flag
  // reflects the integration toggle in Settings and a local override.
  const enabled = flags.openCriticEnabled || localStorage.getItem("oc_enabled") === "1";

  // Example usage: const res = await fetchScore("Hades");
  async function fetchScore(_title: string): Promise<Result> {
    // If the feature flag is off, throw an error.  The UI will catch
    // and display this message.
    if (!enabled) {
      throw new Error(
        "OpenCritic integration is disabled (feature flag). Enable it in Settings to use."
      );
    }
    // Use the desktop bridge when running under Tauri.  This calls a
    // backend command which in turn talks to RapidAPI.  When running on
    // the web (without Tauri) we cannot make this call and therefore
    // throw an error so the UI can inform the user.
    if (!isTauri) {
      throw new Error(
        "OpenCritic fetching is desktop-only in this build. Use the Tauri app or implement a backend."
      );
    }
    try {
      setBusy(true);
      const title = _title.trim();
      if (!title) {
        throw new Error("Missing title");
      }
      const score = await fetchOpenCriticScore(title);
      return { ocScore: score ?? null };
    } finally {
      setBusy(false);
    }
  }

  return { busy, enabled, fetchScore };
}
