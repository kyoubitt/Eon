// File and command tools, with the permission checks that guard them.
import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';

const SECRET_FILE = /(^|\/)(\.env(\..*)?|.*\.pem|.*\.key|id_(rsa|ed25519|ecdsa)[^/]*|\.npmrc|\.netrc|credentials(\.json)?|secrets?\.[a-z]+)$/i;
const PROTECTED_DIR = /(^|\/)(\.git|\.eon)(\/|$)/;

const SECRET_VALUE = [
  /\b(sk|pk|ghp|gho|ghs|xox[abp])[-_][A-Za-z0-9_-]{16,}\b/g,
  /((?:api[_-]?key|secret|token|password|passwd)["']?\s*[:=]\s*["']?)[^\s"',]{6,}/gi,
];

/** Strip values that look like secrets before anything is sent to the chat. */
export function redact(text) {
  return text
    .replace(SECRET_VALUE[0], '[REDACTED]')
    .replace(SECRET_VALUE[1], '$1[REDACTED]');
}

/** Resolve a model-supplied path and refuse anything outside the root. */
/**
 * Models write paths in many styles. Accept backslashes, "./", and a leading "/" that means
 * the project root, as well as absolute paths that really are inside the project.
 */
export function cleanPath(root, p) {
  let q = String(p).trim().replace(/^["'`]|["'`]$/g, '').replace(/\\/g, '/');
  if (q.startsWith('/') && !q.startsWith(root.split(path.sep).join('/')) && !/^\/(home|Users|tmp|var|mnt)\//.test(q)) q = q.replace(/^\/+/, '');
  return q;
}

export function safePath(root, p, { write = false } = {}) {
  if (typeof p !== 'string' || !p) throw new Error('path is missing');
  p = cleanPath(root, p);
  const abs = path.resolve(root, p);
  if (abs !== root && !abs.startsWith(root + path.sep)) throw new Error(`${p} is outside the project`);
  const rel = path.relative(root, abs).split(path.sep).join('/');
  if (SECRET_FILE.test(rel)) throw new Error(`${p} looks like a secrets file and is blocked`);
  if (write && PROTECTED_DIR.test(rel)) throw new Error(`${p} is in a protected directory`);
  // A symlink inside the project must not lead outside it.
  let probe = abs;
  while (!fs.existsSync(probe)) probe = path.dirname(probe);
  const real = fs.realpathSync(probe);
  const realRoot = fs.realpathSync(root);
  if (real !== realRoot && !real.startsWith(realRoot + path.sep)) throw new Error(`${p} resolves outside the project through a symlink`);
  return abs;
}

export function readFile(root, { path: p, start = 1, end }) {
  const abs = safePath(root, p);
  const lines = fs.readFileSync(abs, 'utf8').replace(/^\uFEFF/, '').split(/\r?\n/);
  const from = Math.max(1, start | 0);
  const to = Math.min(lines.length, end ? end | 0 : from + 399, from + 399);
  const body = lines.slice(from - 1, to).map((l, i) => `${String(from + i).padStart(5)}| ${l}`).join('\n');
  return `${p} lines ${from}-${to} of ${lines.length}\n${body}`;
}

/** Several files in one action, because every message to a web chat costs seconds. */
export function readFiles(root, { paths }) {
  if (!Array.isArray(paths) || !paths.length) throw new Error('read_files needs "paths": a list of files');
  const parts = paths.slice(0, 6).map((p) => {
    try { return readFile(root, { path: p, start: 1, end: 150 }); } catch (e) { return `${p}: ERROR: ${e.message}`; }
  });
  if (paths.length > 6) parts.push('Only the first 6 files were read.');
  return parts.join('\n\n');
}

const SOURCE = /\.(m?[jt]sx?|py|go|rs|java|rb|php|cs|c|cc|cpp|h|hpp|kt|swift)$/;
const DECLARES = /^(export\s+(default\s+)?)?(async\s+)?(function\*?|class|interface|type|enum)\s+\w+|^export\s+(const|let)\s+\w+|^\s*(async\s+)?def\s+\w+|^\s*class\s+\w+|^func\s|^(pub(\([a-z]+\))?\s+)?(async\s+)?(fn|struct|enum|trait|impl)\s/;

/** Where things are declared, with line numbers, so the model can go straight to the right place. */
export function repoMap(root, files, budget = 4000) {
  let out = '';
  for (const rel of files.filter((f) => SOURCE.test(f) && !SECRET_FILE.test(f)).slice(0, 60)) {
    let text;
    try {
      const abs = path.join(root, rel);
      if (fs.statSync(abs).size > 200_000) continue;
      text = fs.readFileSync(abs, 'utf8');
    } catch { continue; }
    const found = [];
    text.split('\n').forEach((line, i) => { if (DECLARES.test(line)) found.push(`  ${i + 1} ${line.trim().replace(/\s*[{:]\s*$/, '').slice(0, 90)}`); });
    if (!found.length) continue;
    const block = `${rel}\n${found.slice(0, 25).join('\n')}\n`;
    if (out.length + block.length > budget) { out += '... more files not shown\n'; break; }
    out += block;
  }
  return out.trimEnd();
}

export function listDir(root, { path: p = '.' }) {
  const abs = safePath(root, p);
  return fs.readdirSync(abs, { withFileTypes: true })
    .filter((e) => e.name !== '.git' && e.name !== '.eon')
    .map((e) => (e.isDirectory() ? `${e.name}/` : e.name))
    .sort().join('\n') || '(empty)';
}

/** Search file contents with a regular expression. Written in JavaScript so it needs no grep. */
export function search(root, { pattern, path: p = '.' }) {
  if (typeof pattern !== 'string' || !pattern) throw new Error('pattern is missing');
  let re;
  try { re = new RegExp(pattern); } catch (e) { throw new Error(`pattern is not a valid regular expression: ${e.message}`); }
  const hits = [];
  let total = 0;
  const walk = (abs) => {
    const st = fs.lstatSync(abs);
    if (st.isSymbolicLink()) return; // never follow a link out of the project
    const rel = path.relative(root, abs).split(path.sep).join('/');
    if (st.isDirectory()) {
      if (/(^|\/)(\.git|\.eon|node_modules)$/.test(rel)) return;
      for (const name of fs.readdirSync(abs).sort()) walk(path.join(abs, name));
      return;
    }
    if (!st.isFile() || st.size > 1_000_000 || SECRET_FILE.test(rel)) return;
    const buf = fs.readFileSync(abs);
    if (buf.subarray(0, 8000).includes(0)) return; // binary
    buf.toString('utf8').split(/\r?\n/).forEach((line, i) => {
      if (!re.test(line)) return;
      if (++total <= 80) hits.push(`${rel}:${i + 1}:${line.slice(0, 300)}`);
    });
  };
  walk(safePath(root, p));
  if (!total) return 'no matches';
  return hits.join('\n') + (total > 80 ? `\n... ${total - 80} more matches` : '');
}

const HARD_DENY = /\bsudo\b|\bgit\s+push\b|\brm\s+-[a-z]*r[a-z]*f?\s+(\/|~)(\s|$)|\bmkfs\b|\bdd\s+if=|\bshutdown\b|\breboot\b|:\(\)\s*\{/;
const SHELL_META = /[;&|><`$\n]/;
const READ_ONLY = /^(ls|cat|head|tail|wc|pwd|tree|file|stat|du|grep|rg|find|git\s+(status|log|diff|show|branch|ls-files|blame|rev-parse))(\s|$)/;
const NETWORK = /\b(curl|wget|ssh|scp|npm\s+(i|install|ci|publish)|pnpm\s+(i|install|add)|yarn\s+(install|add)|pip3?\s+install|git\s+(fetch|pull|clone))\b/;

/** 'deny' never runs, 'auto' runs without asking, 'ask' needs the user's approval. */
export function classifyCommand(cmd) {
  if (typeof cmd !== 'string' || !cmd.trim()) return { tier: 'deny', why: 'empty command' };
  if (HARD_DENY.test(cmd)) return { tier: 'deny', why: 'this command is never allowed' };
  if (cmd.split(/\s+/).some((w) => SECRET_FILE.test(w))) return { tier: 'deny', why: 'it touches a secrets file' };
  const readOnly = READ_ONLY.test(cmd.trim()) && !SHELL_META.test(cmd) && !/\s-(delete|exec|execdir|ok)\b/.test(cmd);
  if (readOnly) return { tier: 'auto' };
  return { tier: 'ask', network: NETWORK.test(cmd) };
}

/** True when the user pre-approved this command: an exact match or an allowed prefix, with no shell tricks. */
export function onAllowlist(cmd, allow) {
  const c = cmd.trim();
  return !SHELL_META.test(c) && allow.some((a) => c === a || c.startsWith(`${a} `));
}

let bash;
/**
 * The shell that runs commands. On Windows, plain "bash" is usually the WSL launcher,
 * which sees a different file system, so use the bash that ships with Git for Windows.
 */
export function bashPath() {
  if (bash) return bash;
  if (process.platform !== 'win32') return (bash = 'bash');
  const git = (spawnSync('where', ['git'], { encoding: 'utf8' }).stdout ?? '').split(/\r?\n/)[0].trim();
  const candidates = [git && path.join(path.dirname(git), '..', 'bin', 'bash.exe'), 'C:\\Program Files\\Git\\bin\\bash.exe'].filter(Boolean);
  bash = candidates.find((c) => fs.existsSync(c));
  if (!bash) throw new Error('Eon runs commands with the bash that comes with Git for Windows, and could not find it. Install Git from git-scm.com, then start Eon again.');
  return bash;
}

let current = null;
/** Kill the command that is running now, if any (used when the user quits). */
export function killRunning() { current?.kill('SIGKILL'); }

export function runCommand(cwd, cmd, timeoutMs = 120000) {
  return new Promise((resolve) => {
    const child = spawn(bashPath(), ['-c', cmd], { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    current = child;
    let out = '', timedOut = false;
    const take = (d) => { if (out.length < 1 << 22) out += d; };
    child.stdout.on('data', take);
    child.stderr.on('data', take);
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, timeoutMs);
    const finish = (exit, extra = '') => {
      clearTimeout(timer);
      if (current === child) current = null;
      out = `${out}${extra}`.trim();
      if (timedOut) out += `\n(timed out after ${timeoutMs / 1000}s)`;
      if (out.length > 6000) out = `${out.slice(0, 2000)}\n... ${out.length - 6000} characters cut ...\n${out.slice(-4000)}`;
      resolve({ exit, output: out || '(no output)' });
    };
    child.on('error', (e) => finish(-1, e.message));
    child.on('close', (code) => finish(code ?? -1));
  });
}

const PRIVATE_HOST = /^(localhost$|.*\.local$|.*\.internal$|127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|0\.|\[)/i;

/** Validate a documentation URL and return its host. Only public https pages may be fetched. */
export function docHost(url) {
  let u;
  try { u = new URL(url); } catch { throw new Error('that is not a valid URL'); }
  if (u.protocol !== 'https:') throw new Error('only https URLs can be fetched');
  if (PRIVATE_HOST.test(u.hostname)) throw new Error('local and private addresses cannot be fetched');
  return u.hostname;
}

export function htmlToText(html) {
  return html
    .replace(/<(script|style|noscript|svg|nav|footer|header)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<\/(p|div|li|h[1-6]|tr|pre|section|article)>|<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&amp;/g, '&')
    .replace(/[ \t]+/g, ' ').replace(/ ?\n ?/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

export async function fetchDoc(url) {
  const r = await fetch(url, { signal: AbortSignal.timeout(20000), headers: { 'user-agent': 'eon-agent', accept: 'text/html,text/plain,text/markdown,*/*' } });
  docHost(r.url); // a redirect must not lead somewhere private
  if (!r.ok) throw new Error(`the server answered ${r.status}`);
  const type = r.headers.get('content-type') ?? '';
  if (!/text|json|xml/.test(type)) throw new Error(`that URL is not a text page (${type || 'unknown type'})`);
  const raw = (await r.text()).slice(0, 2_000_000);
  return /html/.test(type) ? htmlToText(raw) : raw.trim();
}

// ---- applying edits ------------------------------------------------------------------------

const toLf = (t) => String(t).replace(/\r\n?/g, '\n');

/** Put a file's own line endings and byte-order mark back on text that was edited as plain LF. */
export function likeFile(original, text) {
  const eol = original.includes('\r\n') ? '\r\n' : '\n';
  return (original.startsWith('﻿') ? '﻿' : '') + (eol === '\n' ? text : text.replace(/\n/g, eol));
}

const lineAt = (text, index) => text.slice(0, index).split('\n').length;

function closestLine(lines, wanted) {
  const w = wanted.trim();
  if (!w) return null;
  let best = null;
  lines.forEach((l, i) => {
    const t = l.trim();
    if (!t) return;
    const common = [...new Set(w.split(/\W+/).filter((x) => x.length > 2))].filter((x) => t.includes(x)).length;
    if (common && (!best || common > best.score)) best = { score: common, n: i + 1, text: t.slice(0, 90) };
  });
  return best;
}

/**
 * Replace one piece of text with another. Line endings do not matter, and trailing spaces on a
 * line are forgiven. Throws a message that tells the model what to do when it cannot be done.
 */
export function applyEdit(current, find, replace, file = 'the file') {
  if (typeof find !== 'string' || !find.trim() || typeof replace !== 'string') throw new Error('An edit needs the text to find (SEARCH) and the text to put there (REPLACE).');
  const text = toLf(current).replace(/^﻿/, '');
  let want = toLf(find).replace(/^\n+|\n+$/g, '');
  const replacement = toLf(replace).replace(/^\n+(?=.)|\n+$/g, '');
  const places = (needle) => { const out = []; for (let i = text.indexOf(needle); i >= 0 && needle; i = text.indexOf(needle, i + 1)) out.push(i); return out; };
  let at = places(want);
  if (at.length === 0) {
    // Forgive trailing spaces and tabs on each line.
    const lines = text.split('\n'), wantLines = want.split('\n').map((l) => l.replace(/[ \t]+$/, ''));
    const hits = [];
    for (let i = 0; i + wantLines.length <= lines.length; i++) if (wantLines.every((w, k) => lines[i + k].replace(/[ \t]+$/, '') === w)) hits.push(i);
    if (hits.length === 1) {
      const start = lines.slice(0, hits[0]).reduce((n, l) => n + l.length + 1, 0);
      want = lines.slice(hits[0], hits[0] + wantLines.length).join('\n');
      at = [start];
    } else if (hits.length > 1) at = hits.map((h) => lines.slice(0, h).reduce((n, l) => n + l.length + 1, 0));
  }
  if (at.length === 0) {
    const near = closestLine(text.split('\n'), want.split('\n').find((l) => l.trim()) ?? '');
    throw new Error(`The SEARCH text was not found in ${file}. It must match the file exactly.${near ? ` The closest line is ${near.n}: ${JSON.stringify(near.text)}.` : ''} Read the file again and copy the lines exactly.`);
  }
  if (at.length > 1) throw new Error(`The SEARCH text matches ${at.length} places in ${file} (lines ${at.slice(0, 6).map((i) => lineAt(text, i)).join(', ')}). Include more surrounding lines so it matches only one.`);
  const start = at[0];
  const next = text.slice(0, start) + replacement + text.slice(start + want.length);
  return { next: likeFile(current, next), line: lineAt(text, start), removed: want, added: replacement, newText: next };
}

/** Shrink a message to fit a chat's size limit by cutting each tool result, never the instructions. */
export function fitResults(results, limit) {
  const total = results.reduce((n, r) => n + r.length, 0);
  if (total <= limit) return results;
  const each = Math.max(400, Math.floor(limit / Math.max(1, results.length)) - 40);
  return results.map((r) => (r.length > each ? `${r.slice(0, Math.floor(each * 0.6))}\n... ${r.length - each} characters cut to fit the chat's message limit ...\n${r.slice(-Math.floor(each * 0.4))}` : r));
}
