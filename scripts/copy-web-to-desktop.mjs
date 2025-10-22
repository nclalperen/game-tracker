import { cp } from 'node:fs/promises';
import { rmSync } from 'node:fs';
import { resolve } from 'node:path';


const webDist = resolve('apps/web/dist');
const desktopDist = resolve('apps/desktop/dist');
try { rmSync(desktopDist, { recursive: true, force: true }); } catch {}
await cp(webDist, desktopDist, { recursive: true });
console.log('[copy] web → desktop/dist complete');