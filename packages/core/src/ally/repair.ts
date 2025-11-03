export function extractJsonBlock(txt: string): string | null {
  if (!txt) return null;
  const start = txt.indexOf("{");
  const end = txt.lastIndexOf("}");
  if (start >= 0 && end > start) {
    return txt.slice(start, end + 1);
  }
  return null;
}

export function extractJsonCandidates(txt: string): string[] {
  if (!txt) return [];
  const candidates: string[] = [];
  const fenceRegex = /```(?:json)?\s*([\s\S]*?)```/gi;
  let match: RegExpExecArray | null;
  while ((match = fenceRegex.exec(txt)) !== null) {
    const body = match[1]?.trim();
    if (!body) continue;
    const trimmed = body.trim();
    if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
      candidates.push(trimmed);
    }
  }
  const simple = extractJsonBlock(txt);
  if (simple && !candidates.includes(simple)) {
    try {
      JSON.parse(simple);
      candidates.push(simple);
    } catch {
      if (candidates.length === 0) {
        candidates.push(simple);
      }
    }
  }
  return candidates;
}
