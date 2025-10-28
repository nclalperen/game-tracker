export type ExportHeader = {
  schemaVersion: 1;
  generatedAtISO: string;
};

export type ExportIdentity = {
  identityId: string;
  title: string;
  platform?: string;
  appid?: number;
  services?: string[];
  tags?: string[];
  releaseYear?: number;
  installed?: boolean;
  installDir?: string;
  sizeOnDiskMB?: number;
  price?: number | null;
  currencyCode?: string | null;
  ttbMainH?: number | null;
  ttbSource?: "hltb-vendor" | "hltb-live" | "rawg" | null;
  criticScore?: number | null;
  criticScoreSource?: "mc-vendor" | "oc" | "rawg-mc" | null;
  ocScoreRaw?: number | null;
  mcScoreRaw?: number | null;
  rawgId?: number | null;
  rawgSlug?: string | null;
};

export type ExportLibraryItem = {
  id: string;
  identityId: string;
  acquiredAtISO?: string | null;
  status?: "backlog" | "playing" | "finished" | "dropped" | "wishlist" | "owned";
  playtimeForeverMin?: number | null;
  playtime2WMin?: number | null;
  lastPlayedAtISO?: string | null;
  price?: number | null;
  currencyCode?: string | null;
};

export type ExportLibrary = ExportHeader & {
  identities: ExportIdentity[];
  libraryItems: ExportLibraryItem[];
};

export type ExportAchievements = ExportHeader & {
  byApp: Record<
    string,
    {
      unlocked: number;
      total: number;
      recent?: Array<{
        apiName: string;
        achieved: boolean;
        unlockTimeISO?: string;
      }>;
    }
  >;
};

export type ExportPrices = ExportHeader & {
  byApp: Record<
    string,
    {
      price?: number | null;
      currency?: string | null;
      discountPercent?: number | null;
      lastFetchedISO?: string | null;
    }
  >;
};

export type ExportProfile = ExportHeader & {
  regionCC?: string;
  language?: string;
  availableMinutes?: number;
  preferredGenres?: string[];
  sliders?: Record<string, number>;
};

