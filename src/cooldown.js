// Live site tests (check, harness, inspect) send real messages. Running them again and again is the quickest way
// to upset a site, so each one rests for a while before it can run again.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const file = () => path.join(os.homedir(), '.eon', 'cooldown.json');
const read = () => { try { return JSON.parse(fs.readFileSync(file(), 'utf8')); } catch { return {}; } };

/** Minutes still to wait before this kind of test may run on this site again (0 = go ahead). */
export function waitMinutes(kind, site, { minutes = 10, now = Date.now() } = {}) {
  const last = read()[`${kind}:${site}`];
  if (!last) return 0;
  return Math.max(0, Math.ceil((last + minutes * 60000 - now) / 60000));
}

export function markRun(kind, site, now = Date.now()) {
  const all = read();
  all[`${kind}:${site}`] = now;
  fs.mkdirSync(path.dirname(file()), { recursive: true });
  fs.writeFileSync(file(), JSON.stringify(all));
}
