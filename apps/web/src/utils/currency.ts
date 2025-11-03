const SYMBOLS: Record<string, string> = {
  USD: "$",
  EUR: "€",
  GBP: "£",
  AUD: "A$",
  CAD: "C$",
  TRY: "TRY",
  JPY: "¥",
  BRL: "R$",
};

export function formatCurrencySymbol(code?: string | null): string | null {
  if (!code) return null;
  const upper = code.toUpperCase();
  return SYMBOLS[upper] ?? upper;
}

export function formatPriceFromMinor(currency: string | null, amountMinor: number | null): string | null {
  if (!currency || amountMinor == null) return null;
  const symbol = formatCurrencySymbol(currency) ?? currency.toUpperCase();
  const major = amountMinor / 100;
  const formatted = major.toLocaleString(undefined, {
    minimumFractionDigits: major % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  });
  return `${symbol} ${formatted}`;
}
