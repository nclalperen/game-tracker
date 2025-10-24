export type Platform = "PC" | "Xbox" | "PlayStation" | "Switch" | "Android";
export type Status = "Backlog" | "Playing" | "Beaten" | "Abandoned" | "Wishlist" | "Owned";
export type Service = "Game Pass" | "EA Play Pro";
export type Identity = {
  id: string;
  title: string;
  platform?: string;
  appid?: number;          // Steam app id
  igdbCoverId?: string;    // IGDB image id like "co123456"
  ttbSource?: "hltb" | "hltb-cache" | "html" | "igdb" | "manual";
  ttbMedianMainH?: number | null;
  ocScore?: number | null;
};

export type LibraryItem = {
  id: string;
  identityId: string;
  accountId?: string;
  memberId?: string;
  status: Status;
  priceTRY?: number;
  currencyCode?: string;
  acquiredAt?: string;
  services?: string[];
  ocScore?: number;
  ttbMedianMainH?: number;
};


export interface Member { id: string; name: string }
export interface Account { id: string; platform: Platform; label: string; identityId?: string }
export interface FeatureFlags {
openCriticEnabled: boolean;
igdbEnabled: boolean;
steamPriceFetchEnabled: boolean;
steamImportEnabled: boolean;
}
