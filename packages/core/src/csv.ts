export function toCSV<T extends Record<string, any>>(rows: T[]): string {
if (!rows.length) return "";
const headers = Object.keys(rows[0]);
const esc = (v: any) => {
const s = v == null ? "" : String(v);
return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
return [headers.join(','), ...rows.map(r => headers.map(h => esc(r[h])).join(','))].join('\n');
}


export function parseCSV(csv: string): Record<string, string>[] {
const lines = csv.split(/\r?\n/).filter(Boolean);
if (!lines.length) return [];
const headers = splitLine(lines[0]);
return lines.slice(1).map(line => {
const cells = splitLine(line);
const obj: Record<string, string> = {};
headers.forEach((h, i) => obj[h] = cells[i] ?? "");
return obj;
});
}


function splitLine(line: string) {
const cells: string[] = []; let cur = ''; let inQ = false;
for (let i = 0; i < line.length; i++) {
const ch = line[i];
if (inQ) {
if (ch === '"' && line[i+1] === '"') { cur += '"'; i++; }
else if (ch === '"') { inQ = false; }
else { cur += ch; }
} else {
if (ch === '"') inQ = true;
else if (ch === ',') { cells.push(cur); cur = ''; }
else { cur += ch; }
}
}
cells.push(cur);
return cells;
}