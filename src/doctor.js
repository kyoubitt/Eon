// A plain report of what Eon can see on this machine, safe to paste into a message:
// no file contents, no secrets, no home folder path.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { findChrome, sites } from './providers/web-chat.js';
import { isRepo, hasCommits, listFiles } from './git.js';
import { listSessions } from './sessions.js';
import { projectInstructions, detectCommands } from './project.js';

const SETTINGS = ['EON_PACE', 'EON_BROWSER', 'EON_CDP_PORT', 'EON_MAX_PROMPT', 'EON_BROWSER_CHANNEL'];

export function lastErrorFile() { return path.join(os.homedir(), '.eon', 'last-error.txt'); }

export function doctorReport(root, { now = new Date() } = {}) {
  const home = os.homedir();
  const mask = (t) => String(t).split(home).join('~');
  const eonHome = path.join(home, '.eon');
  const tool = (cmd, args) => { const r = spawnSync(cmd, args, { encoding: 'utf8' }); return r.status === 0 ? r.stdout.trim().split('\n')[0] : 'not found'; };
  let playwright = 'not installed';
  try { playwright = `installed ${createRequire(import.meta.url)('playwright/package.json').version}`; } catch { /* stays "not installed" */ }
  const chrome = findChrome();
  const exists = (p) => (fs.existsSync(p) ? 'yes' : 'no');
  const L = [`Eon doctor report, ${now.toISOString()}`, ''];
  L.push('SYSTEM', `  node ${process.version}, ${process.platform} ${process.arch}`, `  git: ${tool('git', ['--version'])}`, `  playwright: ${playwright}`,
    `  browser: ${chrome ? `${mask(chrome)} (attach mode)` : "not found, will use Playwright's Chromium"}`,
    `  saved logins: attach profile ${exists(path.join(eonHome, 'chrome'))}, playwright profile ${exists(path.join(eonHome, 'browser'))}`);
  const set = SETTINGS.filter((k) => process.env[k]).map((k) => `${k}=${process.env[k]}`);
  L.push(`  settings: ${set.join(', ') || '(defaults)'}`, `  api model configured: ${process.env.EON_API_MODEL ? 'yes' : 'no'}, api key set: ${process.env.EON_API_KEY ? 'yes' : 'no'}`, '');
  const saved = (() => { try { return JSON.parse(fs.readFileSync(path.join(eonHome, 'selectors.json'), 'utf8')); } catch { return {}; } })();
  L.push('SITES');
  for (const [name, s] of Object.entries(sites())) {
    const own = saved[name] ?? {};
    const mine = Object.keys(own).join(', ');
    L.push(`  ${name.padEnd(9)} ${mine ? `your selectors: ${mine}` : 'built-in selectors (untested on the live site)'}`);
    // The values are page structure (class names), not secrets. They show what the live page really uses.
    for (const [k, v] of Object.entries(own).filter(([, x]) => x)) L.push(`      ${k}: ${[].concat(v).join(' | ').slice(0, 300)}`);
  }
  L.push('', 'PROJECT');
  try {
    const repo = isRepo(root);
    L.push(`  folder: ${mask(root)}`, `  git repository: ${repo ? 'yes' : 'no'}, has a commit: ${repo && hasCommits(root) ? 'yes' : 'no'}, files: ${repo ? listFiles(root).length : 'n/a'}`,
      `  instructions file: ${projectInstructions(root)?.file ?? 'none'}`, `  detected commands: ${Object.keys(detectCommands(root)).join(', ') || 'none'}`, `  saved sessions: ${listSessions(root).length}`);
  } catch (e) { L.push(`  could not read the project: ${e.message}`); }
  const debug = path.join(eonHome, 'debug');
  L.push('', 'RECENT TROUBLE');
  L.push(`  last error: ${fs.existsSync(lastErrorFile()) ? mask(fs.readFileSync(lastErrorFile(), 'utf8')).slice(0, 600).replace(/\n/g, ' ') : 'none'}`);
  L.push(`  screenshots saved: ${fs.existsSync(debug) ? fs.readdirSync(debug).slice(-5).join(', ') || 'none' : 'none'}`);
  return L.join('\n');
}
