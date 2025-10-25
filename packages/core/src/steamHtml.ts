export type SteamHtmlRow = { appid: number; name: string };


export function parseSteamAllGamesHTML(html: string): SteamHtmlRow[] {
try {
const doc = new DOMParser().parseFromString(html, 'text/html');
const rows: SteamHtmlRow[] = [];
const gameRows = Array.from(doc.querySelectorAll<HTMLElement>('.gameListRow, .gameListRowItem'));
for (const row of gameRows) {
const name = row.querySelector<HTMLElement>('.gameListRowItemName')?.textContent?.trim() ||
row.querySelector<HTMLAnchorElement>('a[href*="/app/"]')?.textContent?.trim() || '';
let appid: number | null = null;
const link = row.querySelector<HTMLAnchorElement>('a[href*="store.steampowered.com/app/"]')?.href || '';
const m = link.match(/\/app\/(\d+)/); if (m) appid = Number(m[1]);
const dsAppId = row.getAttribute('data-ds-appid') || row.getAttribute('data-appid');
if (!appid && dsAppId) appid = Number(dsAppId);
if (name && appid) rows.push({ appid, name });
}
if (rows.length === 0) {
const anchors = Array.from(doc.querySelectorAll<HTMLAnchorElement>('a[href*="store.steampowered.com/app/"]'));
for (const a of anchors) {
const m = a.href.match(/\/app\/(\d+)/); const appid = m ? Number(m[1]) : null;
const name = a.textContent?.trim() || '';
if (appid && name) rows.push({ appid, name });
}
}
return rows;
} catch { return []; }
}
