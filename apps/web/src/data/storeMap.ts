import type { ReactNode } from "react";

type StoreInfo = {
  name: string;
  icon?: ReactNode;
  isPc?: boolean;
};

export const RAWG_STORE_MAP: Record<number, StoreInfo> = {
  1: { name: "Steam", isPc: true },
  2: { name: "Xbox", isPc: false },
  3: { name: "PlayStation", isPc: false },
  4: { name: "Apple App Store", isPc: false },
  5: { name: "GOG.com", isPc: true },
  6: { name: "Nintendo", isPc: false },
  7: { name: "Xbox 360", isPc: false },
  8: { name: "Google Play", isPc: false },
  9: { name: "itch.io", isPc: true },
  11: { name: "Epic Games Store", isPc: true },
  25: { name: "Humble Store", isPc: true },
  27: { name: "PlayStation Store", isPc: false },
};

export function getStoreInfo(id: number): StoreInfo | undefined {
  return RAWG_STORE_MAP[id];
}

