import { useEffect, useMemo, useState } from "react";
import type { Identity } from "@tracker/core";
import { ensureRawgDetail } from "@/data/rawgCache";

type Size = "xs" | "sm" | "md" | "lg";

/**
 * Compact portrait cover component.
 * - Prefers Steam "library_600x900.jpg" (2:3 portrait) for appid
 * - Falls back to Steam header.jpg, then IGDB cover
 * - Respects Settings > Covers toggle (covers_enabled)
 * - Size presets default to a compact width so cards stay tidy
 */
export default function GameCover({
  identity,
  className = "",
  alt = "",
  size = "sm", // default a bit smaller
}: {
  identity?: Identity;
  className?: string;
  alt?: string;
  size?: Size;
}) {
  const coversEnabled =
    typeof localStorage !== "undefined"
      ? localStorage.getItem("covers_enabled") === "1"
      : true;

  // keep widths modest; card text stays readable
  const width =
    {
      xs: "w-14",
      sm: "w-16",
      md: "w-20",
      lg: "w-24",
    }[size] || "w-16";

  const [rawgImage, setRawgImage] = useState<string | null>(null);
  const appid = (identity as any)?.appid as number | undefined;
  const igdbCoverId = (identity as any)?.igdbCoverId as string | undefined;

  useEffect(() => {
    let cancelled = false;

    async function hydrateRawgCover() {
      const title = identity?.title;
      const shouldPrefetch = !appid && !igdbCoverId;
      if (!title || !shouldPrefetch) return;
      try {
        const detail = await ensureRawgDetail(title);
        if (!cancelled && detail?.backgroundImage) {
          setRawgImage(detail.backgroundImage);
        }
      } catch (err) {
        if (!cancelled) {
          console.warn("RAWG cover lookup failed", err);
        }
      }
    }

    void hydrateRawgCover();

    return () => {
      cancelled = true;
    };
  }, [identity?.title, appid, igdbCoverId]);

  // Cover precedence: Steam capsule -> IGDB cover -> RAWG artwork fallback.
  const candidates = useMemo(() => {
    const urls: string[] = [];

    if (appid) {
      // Prefer Steam portrait library art (2:3),
      // then fallback to wide header as a backup
      urls.push(
        `https://cdn.akamai.steamstatic.com/steam/apps/${appid}/library_600x900.jpg`,
        `https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/${appid}/library_600x900.jpg`,
        `https://cdn.akamai.steamstatic.com/steam/apps/${appid}/header.jpg`,
        `https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/${appid}/header.jpg`
      );
    }
    if (igdbCoverId) {
      urls.push(
        `https://images.igdb.com/igdb/image/upload/t_cover_big/${igdbCoverId}.jpg`
      );
    }
    if (rawgImage) {
      urls.push(rawgImage);
    }
    return urls;
  }, [appid, igdbCoverId, rawgImage]);

  const [idx, setIdx] = useState(0);

  const placeholder = (
    <div
      className={`relative ${width} aspect-[2/3] rounded bg-zinc-100 ${className}`}
    />
  );

  if (!coversEnabled) return placeholder;
  if (candidates.length === 0) return placeholder;

  const src = candidates[Math.min(idx, candidates.length - 1)];
  return (
    <div
      className={`relative ${width} aspect-[2/3] rounded overflow-hidden ${className}`}
      title={identity?.title || ""}
    >
      <img
        src={src}
        alt={alt || identity?.title || "cover"}
        className="absolute inset-0 h-full w-full object-cover"
        loading="lazy"
        referrerPolicy="no-referrer"
        onError={() => setIdx((i) => i + 1)}
      />
    </div>
  );
}





