export function extractJsonBlock(txt: string): string | null {
  if (!txt) return null;
  const start = txt.indexOf("{");
  const end = txt.lastIndexOf("}");
  if (start >= 0 && end > start) {
    return txt.slice(start, end + 1);
  }
  return null;
}
