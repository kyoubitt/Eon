// The first-start check: a short list of what works and what does not on this computer, each with a plain fix.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { findChrome, profileExists, sites } from './providers/web-chat.js';
import { detectOllama } from './local.js';
import { projectProblem } from './git.js';

const file = () => path.join(os.homedir(), '.eon', 'firstrun.json');

export const firstRunDone = () => fs.existsSync(file());

export function markFirstRun(results) {
  try {
    fs.mkdirSync(path.dirname(file()), { recursive: true });
    fs.writeFileSync(file(), JSON.stringify({ date: new Date().toISOString(), results: results.map((r) => ({ name: r.name, ok: r.ok })) }, null, 2));
  } catch { /* a convenience only */ }
}

/** Run the checklist. `site` is the main chat site. Never throws; every item is {name, ok, text, fix?, info?}. */
export async function firstRunChecks({ root, site = 'deepseek', node = process.versions.node, probe = {} } = {}) {
  const out = [];
  const add = (name, ok, text, fix, info = false) => out.push({ name, ok, text, ...(fix ? { fix } : {}), ...(info ? { info: true } : {}) });

  const major = Number(String(node).split('.')[0]);
  add('node', major >= 18, major >= 18 ? `Node ${node}` : `Node ${node} is too old`, major >= 18 ? '' : 'Install Node 18 or newer from nodejs.org, then run eon again.');

  const git = probe.git ?? (() => spawnSync('git', ['--version'], { encoding: 'utf8' }).status === 0)();
  add('git', git, git ? 'git is installed' : 'git is not installed (Eon still works, without branches)', git ? '' : 'Install git from git-scm.com for branches and /undo. Or work without git when Eon offers it.');

  const chrome = probe.chrome ?? findChrome();
  add('browser', Boolean(chrome), chrome ? 'Chrome or Edge found' : 'no Chrome or Edge found (Eon will use its own browser)', chrome ? '' : 'Install Chrome or Edge for the most natural browser, or run: npm run setup', true);

  const known = Boolean(sites()[site]);
  if (known) {
    const logged = probe.login ?? profileExists();
    add('login', Boolean(logged), logged ? `logged in to ${sites()[site].label}` : `not logged in to ${sites()[site].label} yet`, logged ? '' : `Run: eon login ${site}   (a browser window opens; log in once)`);
  }

  const local = probe.ollama ?? await detectOllama().catch(() => ({ up: false, models: [] }));
  add('local', Boolean(local.up), local.up ? `a local model is available (${local.models[0] ?? 'Ollama running'})` : 'no local model (optional: eon setup-local)', '', true);

  const problem = projectProblem(root);
  add('folder', !problem, problem ? `${problem.replace(/\.$/, '')}` : 'this folder looks like a project', problem ? 'Open a project folder first: cd <your project>, then run eon.' : '');

  let writable = true;
  try { fs.mkdirSync(path.join(os.homedir(), '.eon'), { recursive: true }); fs.accessSync(path.join(os.homedir(), '.eon'), fs.constants.W_OK); } catch { writable = false; }
  add('home', writable, writable ? '~/.eon is writable' : '~/.eon is not writable', writable ? '' : 'Eon keeps logins and settings in ~/.eon; make that folder writable.');
  return out;
}

/** The checklist as lines of text. `paint` adds colour. */
export function formatChecks(results, paint = { green: (s) => s, red: (s) => s, dim: (s) => s, yellow: (s) => s }) {
  const lines = results.map((r) => `  ${r.ok ? paint.green('✓') : r.info ? paint.yellow('•') : paint.red('✗')} ${r.text}${r.fix ? paint.dim(`\n      ${r.fix}`) : ''}`);
  const bad = results.filter((r) => !r.ok && !r.info);
  lines.push(bad.length ? paint.yellow(`\n  ${bad.length} thing${bad.length === 1 ? '' : 's'} to fix. If you get stuck: eon doctor --report`) : paint.green('\n  All good.'));
  return lines.join('\n');
}
