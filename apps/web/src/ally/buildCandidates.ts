import { computeFeatures } from "@tracker/core";
import type { CoachMode } from "@tracker/core";
import { type DealView } from "@/db";
import { listDealViews } from "@/deals/derive";
import type { AICandidate } from "./aiClient";

function mapLibraryRow(r: any): AICandidate {
  const base = {
    id: r.id ?? r.identityId,
    title: r.title,
    appid: r.appid,
    installed: !!r.installed,
    platform: r.platform,
    ttbMainH: r.ttb?.main ?? r.ttbMainH ?? null,
    criticScore: r.criticScore ?? null,
    price: r.price ?? null,
    currencyCode: r.currencyCode ?? null,
    tags: r.tags ?? r.genres ?? [],
    services: r.services ?? [],
    status: r.status,
    playtimeForeverMin: r.playtimeForeverMin ?? r.playtime ?? null,
    lastPlayedAtISO: r.lastPlayedAtISO ?? null,
  };
  return {
    ...base,
    features: computeFeatures(base),
  };
}

function mapDealView(view: DealView): AICandidate {
  const base = {
    id: `deal:${view.appid}`,
    title: view.title,
    appid: view.appid,
    installed: view.installed,
    platform: "PC",
    ttbMainH: view.ttbMainH ?? null,
    criticScore: view.criticScore ?? null,
    price: view.priceFinal ?? null,
    currencyCode: view.currency ?? null,
    tags: [],
    services: [],
    status: "wishlist",
    playtimeForeverMin: null,
    lastPlayedAtISO: null,
  };
  return {
    ...base,
    discountPercent: view.discountPercent ?? null,
    final: view.priceFinal ?? null,
    initial: view.priceInitial ?? null,
    saleEndISO: view.saleEndISO ?? null,
    valuePerHour: view.valuePerHour ?? null,
    wishlist: true,
    features: computeFeatures(base),
  };
}

export async function buildCandidates(mode: CoachMode, rows: any[]): Promise<AICandidate[]> {
  if (mode === "deals") {
    const views = await listDealViews();
    return views.map(mapDealView);
  }
  return rows.map(mapLibraryRow);
}
