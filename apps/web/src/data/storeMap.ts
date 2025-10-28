type StoreInfo = {
  name: string;
  icon?: string;
  isPc?: boolean;
};

export const RAWG_STORE_MAP: Record<number, StoreInfo> = {
  1: { name: "Steam", icon: "S", isPc: true },
  2: { name: "Xbox", icon: "X", isPc: false },
  3: { name: "PlayStation", icon: "PS", isPc: false },
  4: { name: "Apple App Store", icon: "AP", isPc: false },
  5: { name: "GOG.com", icon: "G", isPc: true },
  6: { name: "Nintendo", icon: "N", isPc: false },
  7: { name: "Xbox 360", icon: "360", isPc: false },
  8: { name: "Google Play", icon: "GP", isPc: false },
  9: { name: "itch.io", icon: "I", isPc: true },
  11: { name: "Epic Games Store", icon: "E", isPc: true },
  25: { name: "Humble Store", icon: "H", isPc: true },
  27: { name: "PlayStation Store", icon: "PS", isPc: false },
};

export function getStoreInfo(id: number): StoreInfo | undefined {
  return RAWG_STORE_MAP[id];
}
