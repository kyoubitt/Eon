// Past sessions: listing them, loading one, and showing its transcript again.
import fs from 'node:fs';
import path from 'node:path';
import { migrateProject } from './migrate.js';
import { color, TAG } from './ui.js';
import { writeAtomic } from './store.js';

const lines = (file) => {
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).flatMap((l) => { try { return [JSON.parse(l)]; } catch { return []; } }); // a last line cut off by a crash is dropped
};
// A damaged or half-written file is skipped, never fatal: one bad session must not stop Eon from starting.
const json = (file) => { try { return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null; } catch { return null; } };

/** Every recorded session in this project, newest first. */
export function listSessions(root) {
  migrateProject(root);
  const dir = path.join(root, '.eon', 'tasks');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).map((id) => json(path.join(dir, id, 'session.json'))).filter(Boolean)
    .sort((a, b) => (a.updated < b.updated ? 1 : -1));
}

/** Find a session by its id, the start of its id, or its number in the list (1 is the newest). */
export function findSession(root, key) {
  const all = listSessions(root);
  if (/^\d{1,3}$/.test(key)) return all[Number(key) - 1] ?? null;
  return all.find((s) => s.id === key) ?? all.find((s) => s.id.startsWith(key)) ?? null;
}

export function loadSession(root, id) {
  const dir = path.join(root, '.eon', 'tasks', id);
  const meta = json(path.join(dir, 'session.json'));
  if (!meta) throw new Error(`there is no saved session "${id}"`);
  const plan = json(path.join(dir, 'plan.json'));
  if (plan) delete plan.review;
  // Tool results keep their ids, so pointers such as run:r4 in the saved plan still check out.
  const runs = new Map(lines(path.join(dir, 'audit.jsonl')).map((a) => [a.id, { action: a.action, text: a.result }]));
  return { meta, plan, runs, events: lines(path.join(dir, 'events.jsonl')) };
}

export function describe(s, i) {
  const when = s.updated.slice(0, 16).replace('T', ' ');
  const steps = s.steps ? `, steps ${s.done.length}/${s.steps}` : '';
  return `${String(i + 1).padStart(2)}. ${when}  ${s.tasks[0].slice(0, 60)}${s.tasks.length > 1 ? ` (+${s.tasks.length - 1} more)` : ''}\n      ${s.mode}/${s.level}, ${s.status}${steps}${s.branch ? `, branch ${s.branch}` : ''}`;
}

/** A transcript event as plain text, for interfaces that only print lines. */
export function eventToText(e) {
  switch (e.type) {
    case 'line': return e.text;
    case 'user': return color.bold(`> ${e.text}`);
    case 'answer': return color.cyan(`> ${e.text}`);
    case 'assistant': return color.dim(e.text);
    case 'question': return color.yellow(e.text);
    case 'tool': return color.cyan(`  ${e.name}(${e.arg})`);
    case 'tool-end': return (e.ok ? color.dim : color.red)(`    ${e.summary}`);
    case 'diff': return [color.bold(`  ${e.created ? 'create' : 'edit'} ${e.path}`),
      ...(e.removed ? e.removed.split('\n').map((l) => color.red(`    - ${l}`)) : []),
      ...(e.added ? e.added.split('\n').map((l) => color.green(`    + ${l}`)) : [])].join('\n');
    case 'plan': return [color.bold(`PLAN  ${e.plan.goal}`),
      ...e.plan.claims.map((c) => `  ${TAG[c.tag] ?? c.tag} ${c.id}  ${c.text}`),
      ...e.plan.steps.map((s) => `  ${s.n}. ${s.text}`)].join('\n');
    default: return null;
  }
}

/** Show a saved transcript again in whichever interface is open. */
export function replay(ui, events) {
  for (const e of events) {
    if (ui.event) ui.event(e);
    else { const text = eventToText(e); if (text !== null) ui.print(text); }
  }
}

// ---- sessions that were cut off (a crash, a closed window, a power cut) ----

const lockPath = (root, id) => path.join(root, '.eon', 'tasks', id, 'lock.json');
export const writeLock = (root, id) => writeAtomic(lockPath(root, id), JSON.stringify({ pid: process.pid, updated: Date.now() }));
export const removeLock = (root, id) => fs.rmSync(lockPath(root, id), { force: true });

const pidAlive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };

/** The newest session that was working when Eon stopped, or null. A live Eon in another window does not count. */
export function interruptedSession(root, { now = Date.now(), alive = pidAlive } = {}) {
  for (const s of listSessions(root)) {
    if (s.status !== 'working' && s.status !== 'cut-off') continue;
    if (now - Date.parse(s.updated) > 14 * 86400000) continue; // too old to be worth offering (still in /resume)
    const lock = json(lockPath(root, s.id));
    if (lock && lock.pid !== process.pid && alive(lock.pid) && now - lock.updated < 30000) continue; // someone is running it
    if (lock?.pid === process.pid) continue; // this very process
    return s;
  }
  return null;
}

/** Change a session's recorded status (for example to "abandoned" when you choose to start fresh). */
export function setSessionStatus(root, id, status) {
  const file = path.join(root, '.eon', 'tasks', id, 'session.json');
  const meta = json(file);
  if (meta) writeAtomic(file, JSON.stringify({ ...meta, status }));
}
