const PLATFORM_ALIASES: Array<[RegExp, string]> = [
  [/windows|pc|steam|epic|gog|itch|linux\/win/i, "pc"],
  [/\bmac(os)?\b|osx|macintosh/i, "mac"],
  [/playstation\s*5|\bps5\b/i, "ps5"],
  [/playstation\s*4|\bps4\b/i, "ps4"],
  [/xbox\s*series|xsx|xss/i, "xsx"],
  [/xbox\s*one/i, "xboxone"],
  [/switch|nintendo\s*switch/i, "switch"],
  [/linux|steam deck/i, "linux"],
];

const HOST_HINTS: Array<[RegExp, (year?: number | null) => string]> = [
  [/steampowered\.com|steamcommunity\.com|epicgames\.com|gog\.com|ubisoft\.com|humblebundle\.com/i, () => "pc"],
  [/store\.playstation\.com/i, (year) => {
    if (year == null) return "ps5";
    return year >= 2020 ? "ps5" : "ps4";
  }],
  [/xbox\.com|microsoft\.com/i, (year) => {
    if (year == null) return "xsx";
    return year >= 2020 ? "xsx" : "xboxone";
  }],
  [/nintendo\.(com|co\.)/i, () => "switch"],
];

export function canonicalPlatform(input?: string | null, urlHost?: string | null, releaseYear?: number | null): string {
  if (input) {
    for (const [pattern, value] of PLATFORM_ALIASES) {
      if (pattern.test(input)) {
        return value;
      }
    }
  }

  if (urlHost) {
    for (const [pattern, resolver] of HOST_HINTS) {
      if (pattern.test(urlHost)) {
        return resolver(releaseYear ?? undefined);
      }
    }
  }

  return "unknown";
}
