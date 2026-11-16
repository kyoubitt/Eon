// "eon doctor --fix": find the usual leftovers and broken files and repair them, asking first.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { findChrome, playwrightBrowser } from './providers/web-chat.js';

const ageMs = (file, now) => { try { return now - fs.lstatSync(file).mtimeMs; } catch { return -1; } };
const pidAlive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };
const validJson = (file) => { try { JSON.parse(fs.readFileSync(file, 'utf8')); return true; } catch { return false; } };

/** Every problem Eon knows how to repair here: [{ id, text, fix() -> what was done }]. Nothing is changed by looking. */
export function findProblems({ root, home = os.homedir(), now = Date.now(), alive = pidAlive, chrome = findChrome, pwBrowser = playwrightBrowser, run = (cmd) => spawnSync(cmd, { stdio: 'inherit', shell: true, cwd: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..') }).status === 0 } = {}) {
  const out = [];
  const eonHome = path.join(home, '.eon');

  if (!fs.existsSync(eonHome)) out.push({ id: 'home', text: '~/.eon does not exist yet', fix: () => { fs.mkdirSync(eonHome, { recursive: true }); return 'created ~/.eon'; } });

  const lock = path.join(root, '.git', 'index.lock');
  if (ageMs(lock, now) > 5 * 60000) out.push({ id: 'index-lock', text: `a stale git lock is in the way (${path.relative(root, lock)}, left by a git program that was cut off)`, fix: () => { fs.rmSync(lock, { force: true }); return 'removed the git lock'; } });

  const tasks = path.join(root, '.eon', 'tasks');
  if (fs.existsSync(tasks)) {
    for (const id of fs.readdirSync(tasks)) {
      const f = path.join(tasks, id, 'lock.json');
      if (!fs.existsSync(f)) continue;
      let l = null;
      try { l = JSON.parse(fs.readFileSync(f, 'utf8')); } catch { /* unreadable counts as stale */ }
      const dead = !l || !alive(l.pid) || now - l.updated > 30000;
      if (dead) out.push({ id: `session-lock:${id}`, text: `session ${id.slice(0, 22)} has a lock from an Eon that is no longer running`, fix: () => { fs.rmSync(f, { force: true }); return 'removed the session lock (Eon will offer to resume that session)'; } });
    }
  }

  for (const name of ['config.json', 'selectors.json']) {
    const f = path.join(eonHome, name);
    if (fs.existsSync(f) && !validJson(f)) out.push({ id: `bad:${name}`, text: `~/.eon/${name} is damaged and cannot be read`, fix: () => { fs.renameSync(f, `${f}.bak`); fs.writeFileSync(f, '{}\n'); return `kept the damaged file as ${name}.bak and started a fresh one`; } });
  }

  const profile = path.join(eonHome, 'chrome');
  for (const name of ['SingletonLock', 'SingletonCookie', 'SingletonSocket']) {
    const f = path.join(profile, name);
    if (ageMs(f, now) > 10 * 60000) out.push({ id: `chrome:${name}`, text: `the Eon browser profile has a leftover ${name} (the browser was closed badly)`, fix: () => { fs.rmSync(f, { force: true }); return `removed ${name}`; } });
  }

  if (!chrome() && !pwBrowser()) out.push({ id: 'browser', text: 'no Chrome or Edge is installed, and Eon\'s own browser is not downloaded yet', fix: () => (run('npx playwright install chromium') ? 'downloaded the browser Eon uses' : 'the download failed; check your internet connection and run: npx playwright install chromium') });
  return out;
}

/** Look, then (with permission) repair. `ask` answers a yes/no question. Returns the lines to print. */
export async function runFix({ root, ask, yes = false, ...deps }) {
  const problems = findProblems({ root, ...deps });
  if (!problems.length) return ['Nothing to fix: no leftover locks, damaged settings or missing pieces found.'];
  const lines = [`Found ${problems.length} thing${problems.length === 1 ? '' : 's'} to repair.`];
  for (const p of problems) {
    const ok = yes || /^y/i.test(await ask(`${p.text}\n  Fix it? [y]es / [n]o: `));
    if (!ok) { lines.push(`  – left alone: ${p.text}`); continue; }
    try { lines.push(`  ✓ ${await p.fix()}`); } catch (e) { lines.push(`  ✗ ${p.id}: ${e.message}`); }
  }
  return lines;
}
