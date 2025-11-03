export type DealInput = {
  discountPercent?: number | null;
  priceFinal?: number | null;
  valuePerHour?: number | null;
  criticScore?: number | null;
  installed?: boolean;
  inLibrary?: boolean;
  wishlist?: boolean;
  saleEndsInDays?: number | null;
};

export function computeDealScore(d: DealInput): number {
  const weights = {
    discount: 0.45,
    valuePerHour: 0.2,
    critic: 0.15,
    wishlist: 0.1,
    installed: 0.05,
    urgency: 0.05,
  };

  const discount = Math.max(0, Math.min(1, (d.discountPercent ?? 0) / 100));
  const valuePerHour =
    d.valuePerHour && d.valuePerHour > 0
      ? Math.min(1, 1 / Math.max(1, d.valuePerHour / 3))
      : 0;
  const critic = Math.max(0, Math.min(1, (d.criticScore ?? 0) / 100));
  const wishlist = d.wishlist ? 1 : 0;
  const installed = d.installed ? 1 : 0;
  const urgency = d.saleEndsInDays != null ? Math.max(0, Math.min(1, (7 - d.saleEndsInDays) / 7)) : 0;

  const score =
    weights.discount * discount +
    weights.valuePerHour * valuePerHour +
    weights.critic * critic +
    weights.wishlist * wishlist +
    weights.installed * installed +
    weights.urgency * urgency;

  return Number(score.toFixed(3));
}
