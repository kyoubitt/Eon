// A running count of the messages Eon sent to each chat site today. Sites do not publish their limits, so the
// number is an estimate that only Eon's own sending feeds; the point is to notice a very busy day before the site does.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const DEFAULT_BUDGET = 100;
const file = () => path.join(os.homedir(), '.eon', 'messages.json');
const today = (now = new Date()) => now.toISOString().slice(0, 10);

function read() {
  try { const d = JSON.parse(fs.readFileSync(file(), 'utf8')); return d.date === today() ? d : { date: today(), counts: {} }; } catch { return { date: today(), counts: {} }; }
}

export const sentToday = (site) => read().counts[site] ?? 0;

export function countMessage(site) {
  const d = read();
  d.counts[site] = (d.counts[site] ?? 0) + 1;
  try { fs.mkdirSync(path.dirname(file()), { recursive: true }); fs.writeFileSync(file(), JSON.stringify(d)); } catch { /* counting is best effort */ }
  return d.counts[site];
}

/** The daily budget for a site: EON_BUDGET (0 turns it off), else the default. */
export function budgetFor(env = process.env) {
  const v = env.EON_BUDGET;
  return v === undefined || v === '' ? DEFAULT_BUDGET : Math.max(0, Number(v) || 0);
}

/** How long to wait before trying again after n failures in a row: 5 s, 10 s, 20 s ... at most a minute. */
export const backoffMs = (failures) => (failures <= 0 ? 0 : Math.min(60000, 5000 * 2 ** (failures - 1)));

export const todayCounts = () => read().counts;
