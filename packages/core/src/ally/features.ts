export type FeatureCandidate = {
  id: string;
  title: string;
  installed?: boolean;
  appid?: number;
  ttbMainH?: number | null;
  playtimeForeverMin?: number | null;
  criticScore?: number | null;
  price?: number | null;
  currencyCode?: string | null;
  tags?: string[];
  services?: string[];
  lastPlayedAtISO?: string | null;
  status?: string;
};

export function computeFeatures(c: FeatureCandidate) {
  const playedH = (c.playtimeForeverMin ?? 0) / 60;
  const mainH = c.ttbMainH ?? null;
  const remainingH = mainH != null ? Math.max(0, mainH - playedH) : null;
  const valuePerHour =
    c.price != null && mainH != null && c.price > 0 && mainH > 0
      ? Number((c.price / mainH).toFixed(2))
      : null;
  const recencyDays =
    c.lastPlayedAtISO != null
      ? Math.max(0, Math.floor((Date.now() - Date.parse(c.lastPlayedAtISO)) / 86_400_000))
      : null;
  return {
    remainingH,
    valuePerHour,
    recencyDays,
    installed: !!c.installed,
  };
}
