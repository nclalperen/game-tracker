import type { Identity } from "@tracker/core";

/**
 * Build a prioritized list of candidate image URLs for a game.
 * We try them in order; the component will fall back on error.
 */
export function getCoverCandidates(identity?: Identity): string[] {
  const out: string[] = [];
  if (!identity) return out;

  const title = identity.title.trim();
  const slugTitle = encodeURIComponent(title);
  const placeholder = `https://placehold.co/600x900?text=${slugTitle}`;

  // 1) Steam CDN (if we have appid)
  const appid = (identity as any).appid as number | undefined;
  if (appid) {
    // Common Steam sizes; not all exist for every app, so we try several.
    out.push(
      // Tall library cover (good for cards)
      `https://steamcdn-a.akamaihd.net/steam/apps/${appid}/library_600x900.jpg`,
      // Header/hero
      `https://steamcdn-a.akamaihd.net/steam/apps/${appid}/header.jpg`,
      // Wide capsules
      `https://steamcdn-a.akamaihd.net/steam/apps/${appid}/capsule_616x353.jpg`,
      `https://steamcdn-a.akamaihd.net/steam/apps/${appid}/capsule_231x87.jpg`
    );
  }

  // 2) IGDB CDN (if we have a cover image id like "abc123")
  // You can set identity.igdbCoverId after a metadata lookup (no key needed to serve)
  const igdbCoverId = (identity as any).igdbCoverId as string | undefined;
  if (igdbCoverId) {
    // t_cover_big is a good default; other sizes: t_thumb, t_cover_small, t_720p, ...
    out.push(`https://images.igdb.com/igdb/image/upload/t_cover_big/${igdbCoverId}.jpg`);
  }

  // 3) Last resort: title-based placeholder
  out.push(placeholder);

  return out;
}
