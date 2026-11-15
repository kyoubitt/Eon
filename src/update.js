// Updating Eon, and a once-a-day note when a newer version exists. Nothing is sent except a plain GET to GitHub.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { readConfig } from './settings.js';

export const REPO = 'kyoubitt/eon';
const RAW = `https://raw.githubusercontent.com/${REPO}/main/package.json`;
const TARBALL = `https://codeload.github.com/${REPO}/tar.gz/refs/heads/main`;
const DAY = 24 * 3600 * 1000;

/** 1 when a is newer than b, -1 when older, 0 when equal or not a version. */
export function compareVersions(a, b) {
  const parse = (v) => String(v).trim().replace(/^v/, '').match(/^(\d+)\.(\d+)\.(\d+)/)?.slice(1).map(Number);
  const x = parse(a), y = parse(b);
  if (!x || !y) return 0;
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i] ? 1 : -1;
  return 0;
}

export const currentVersion = (root) => { try { return JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version; } catch { return '0.0.0'; } };

const cacheFile = () => path.join(os.homedir(), '.eon', 'update-check.json');

async function getText(url, ms = 2000) {
  const r = await fetch(url, { signal: AbortSignal.timeout(ms) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.text();
}

/**
 * At most once a day, ask GitHub which version is newest. Returns { latest, current } when a newer one exists,
 * otherwise null. Never throws, never blocks long; a private or unreachable repo just returns null.
 */
export async function checkForUpdate({ root, now = Date.now(), fetcher = getText, env = process.env, config = readConfig() } = {}) {
  try {
    if (env.EON_NO_UPDATE_CHECK || config.updateCheck === false) return null;
    let cache = {};
    try { cache = JSON.parse(fs.readFileSync(cacheFile(), 'utf8')); } catch { /* first time */ }
    const current = currentVersion(root);
    if (cache.checked && now - cache.checked < DAY) return compareVersions(cache.latest ?? '0.0.0', current) > 0 ? { latest: cache.latest, current } : null;
    let latest = null;
    try { latest = JSON.parse(await fetcher(RAW)).version; } catch { /* offline, private or renamed */ }
    fs.mkdirSync(path.dirname(cacheFile()), { recursive: true });
    fs.writeFileSync(cacheFile(), JSON.stringify({ checked: now, latest: latest ?? cache.latest ?? null }));
    return latest && compareVersions(latest, current) > 0 ? { latest, current } : null;
  } catch { return null; }
}

const download = async (url) => {
  const r = await fetch(url, { signal: AbortSignal.timeout(120000) });
  if (!r.ok) throw new Error(`the download answered HTTP ${r.status} (a private repository cannot be downloaded without signing in)`);
  return Buffer.from(await r.arrayBuffer());
};
const untar = (file, dir) => { const r = spawnSync('tar', ['-xzf', file, '-C', dir], { encoding: 'utf8' }); if (r.status !== 0) throw new Error(`could not unpack the update (${(r.stderr || r.error?.message || 'tar failed').trim()})`); };
const deps = (root) => { try { return JSON.stringify(JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).dependencies ?? {}); } catch { return ''; } };

/**
 * Update the Eon in `root`. A git clone is pulled; anything else is replaced from GitHub's tarball.
 * node_modules, .eon and .git are never touched. Returns { from, to, how }.
 */
export async function runUpdate({ root, say = () => {}, downloader = download, unpack = untar, npmInstall = true } = {}) {
  const from = currentVersion(root);
  if (fs.existsSync(path.join(root, '.git'))) {
    say('This is a git copy; pulling the latest.');
    const r = spawnSync('git', ['pull', '--ff-only'], { cwd: root, encoding: 'utf8' });
    if (r.status !== 0) throw new Error(`git pull did not work: ${(r.stderr || r.stdout).trim().slice(0, 300)}`);
    if (npmInstall) spawnSync('npm', ['install'], { cwd: root, stdio: 'inherit', shell: true });
    return { from, to: currentVersion(root), how: 'git' };
  }
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'eon-update-'));
  try {
    say(`Downloading the latest from github.com/${REPO} ...`);
    const file = path.join(tmp, 'eon.tar.gz');
    fs.writeFileSync(file, await downloader(TARBALL));
    const out = path.join(tmp, 'x');
    fs.mkdirSync(out);
    unpack(file, out);
    const top = fs.readdirSync(out).find((n) => fs.statSync(path.join(out, n)).isDirectory());
    if (!top || !fs.existsSync(path.join(out, top, 'bin', 'eon.js'))) throw new Error('the download does not look like Eon, so nothing was changed');
    const src = path.join(out, top);
    const before = deps(root);
    fs.cpSync(src, root, { recursive: true, force: true, filter: (p) => !/(^|[\\/])(node_modules|\.eon|\.git)([\\/]|$)/.test(path.relative(src, p)) });
    const to = currentVersion(root);
    if (npmInstall && deps(root) !== before) { say('Dependencies changed; running npm install.'); spawnSync('npm', ['install'], { cwd: root, stdio: 'inherit', shell: true }); }
    return { from, to, how: 'download' };
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
}
