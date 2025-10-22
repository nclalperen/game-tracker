import { invoke } from "@tauri-apps/api/core";

export async function fetchHLTBMetaNative(title: string) {
  // Tauri command returns { main_median_hours: number|null, source: string }
  const res = await invoke<{ main_median_hours: number | null; source: string }>(
    "hltb_search",
    { title }
  );

  // Normalize to camelCase for React code:
  return {
    mainMedianHours: res.main_median_hours ?? null,
    source: res.source ?? "hltb",
  };
}
