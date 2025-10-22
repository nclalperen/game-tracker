import type { Platform, Status } from "./types";


export function normalizeTitle(t: string) { return t.trim().toLowerCase().replace(/\s+/g, ' '); }
export function dedupe<T>(arr: T[], key: (x: T) => string) { const m = new Map<string, T>(); for (const it of arr) { const k = key(it); if (!m.has(k)) m.set(k, it); } return [...m.values()]; }

export function pricePerHour(priceTRY?: number, ttbMedianMainH?: number): number | null {
  if (priceTRY == null || ttbMedianMainH == null) return null;
  if (ttbMedianMainH <= 0) return null;
  return Math.round(priceTRY / ttbMedianMainH);
}

export function normalizePlatform(s?: string): Platform | undefined {
if (!s) return; const t = s.trim().toLowerCase();
if (/(pc|steam|epic|gog)/.test(t)) return 'PC';
if (/xbox/.test(t)) return 'Xbox';
if (/(ps|playstation)/.test(t)) return 'PlayStation';
if (/switch|nintendo/.test(t)) return 'Switch';
if (/android|mobile/.test(t)) return 'Android';
}

export function normalizeStatus(s?: string): Status | undefined {
if (!s) return; const t = s.trim().toLowerCase();
if (/backlog/.test(t)) return 'Backlog';
if (/play(ing)?/.test(t)) return 'Playing';
if (/beat|clear|finished/.test(t)) return 'Beaten';
if (/abandon|drop/.test(t)) return 'Abandoned';
if (/wish/.test(t)) return 'Wishlist';
if (/own|library|purchased/.test(t)) return 'Owned';
}

