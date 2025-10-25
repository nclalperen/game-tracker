import unidecode from "unidecode";

const TRIM_TOKENS = [
  "goty",
  "game of the year",
  "definitive",
  "complete",
  "remastered",
  "hd",
  "ultimate",
  "deluxe",
  "director's cut",
  "directors cut",
  "enhanced",
  "collection",
  "bundle",
];

const EDITION_REGEX = new RegExp(`\\b(${TRIM_TOKENS.join("|")})\\b`, "g");
const STRIP_SYMBOLS = /[\u2122\u00ae\u00a9]/g;
const PUNCT_TO_SPACE = /[:;,.\u2014\u2013_/()|"'`]/g;
const MULTI_SPACE = /\s+/g;
const TRAILING_YEAR = /\b(19|20)\d{2}\b$/;

export function normalizeTitle(input: string | null | undefined): string {
  if (!input) return "";

  let working = unidecode(String(input)).toLowerCase();
  working = working.replace(STRIP_SYMBOLS, "");
  working = working.replace(PUNCT_TO_SPACE, " ");
  working = working.replace(EDITION_REGEX, " ");
  working = working.replace(TRAILING_YEAR, "").trim();
  working = working.replace(MULTI_SPACE, " ").trim();
  return working;
}

