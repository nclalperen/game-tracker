import type { LibraryItem } from './types';
export interface Suggestion { id: string; kind: 'PlayNext' | 'BuyClaim'; reason: string[]; item: LibraryItem; score: number }
export interface Weights { backlogBoost: number; valueWeight: number; scoreWeight: number; durationWeight: number }


export function computeSuggestions(items: LibraryItem[], weights: Weights): Suggestion[] {
const out: Suggestion[] = [];
for (const it of items) {
const why: string[] = []; let s = 0;
if (it.status === 'Backlog') { s += weights.backlogBoost; why.push('Backlog'); }
if (it.ocScore != null) { s += weights.scoreWeight * (it.ocScore / 100); why.push(`Score ${it.ocScore}`); }
const pph = it.priceTRY && it.ttbMedianMainH ? it.priceTRY/it.ttbMedianMainH : undefined;
if (pph != null) { s += weights.valueWeight * (1/(1+pph)); why.push(`â‚º/h ~ ${pph.toFixed(2)}`); }
const kind = it.status === 'Wishlist' || (it.services && it.services.length) ? 'BuyClaim' : 'PlayNext';
out.push({ id: it.id, kind, reason: why, item: it, score: Number(s.toFixed(3)) });
}
return out.sort((a,b) => b.score - a.score);
}
