import { canonicalPlatform, normalizeTitle } from "@tracker/core";

export function normalizeTitleKey(input: string): string {
  return normalizeTitle(input);
}

export { canonicalPlatform };
