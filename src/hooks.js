// Hooks: shell commands you configure, run by Eon (never by the model) at fixed points.
//   before_edit  runs before a file is changed; a non-zero exit refuses the edit
//   after_edit   runs after a file is changed (a formatter, a linter); its output goes back to the model
//   before_run   runs before a command the model asked for; a non-zero exit refuses it
//   session_end  runs when the session is finished
// Where: "hooks" in ~/.eon/config.json (yours, always trusted) and in .eon/settings.json (the project's; you are
// asked once per session before they run, because a downloaded project could contain them).
// Each entry is a command string, or {"run":"prettier --write {file}","match":"*.js"}. {file} is the path, quoted.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runCommand } from './tools.js';

export const EVENTS = ['before_edit', 'after_edit', 'before_run', 'session_end'];

const read = (file) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')).hooks ?? {}; } catch { return {}; } };

export function loadHooks(root) {
  const mine = read(path.join(os.homedir(), '.eon', 'config.json'));
  const project = read(path.join(root, '.eon', 'settings.json'));
  const norm = (list) => [].concat(list ?? []).map((h) => (typeof h === 'string' ? { run: h } : h)).filter((h) => typeof h?.run === 'string');
  const out = {};
  for (const ev of EVENTS) out[ev] = [...norm(mine[ev]).map((h) => ({ ...h, from: 'yours' })), ...norm(project[ev]).map((h) => ({ ...h, from: 'project' }))];
  return out;
}

const globToRe = (g) => new RegExp(`^${g.split('*').map((x) => x.replace(/[.+^${}()|[\]\\?]/g, '\\$&')).join('.*')}$`);
const quote = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;

export class Hooks {
  constructor(root, { confirm = async () => false, auto = false } = {}) {
    Object.assign(this, { root, confirm, auto, hooks: loadHooks(root), trusted: false });
  }

  get any() { return Object.values(this.hooks).some((l) => l.length); }

  async #allowed(entries) {
    if (!entries.some((h) => h.from === 'project') || this.trusted) return entries;
    if (this.auto) return entries.filter((h) => h.from === 'yours'); // nobody to ask
    const list = entries.filter((h) => h.from === 'project').map((h) => h.run).join('; ');
    this.trusted = await this.confirm(`This project defines hooks that run commands: ${list}\nRun them this session? [y]es / [n]o: `);
    return this.trusted ? entries : entries.filter((h) => h.from === 'yours');
  }

  /** Run the hooks for an event. Returns { ok, output }: ok is false when a hook refused (non-zero exit). */
  async run(event, { file, cwd = this.root } = {}) {
    const entries = (this.hooks[event] ?? []).filter((h) => !h.match || (file && globToRe(h.match).test(path.basename(file)) || file && globToRe(h.match).test(file)));
    if (!entries.length) return { ok: true, output: '' };
    let output = '', ok = true;
    for (const h of await this.#allowed(entries)) {
      const cmd = h.run.replace(/\{file\}/g, file ? quote(file) : "''");
      const r = await runCommand(cwd, cmd, 60000);
      output += `$ ${cmd}\nexit ${r.exit}\n${r.output}\n`;
      if (r.exit !== 0) ok = false;
    }
    return { ok, output: output.trim() };
  }
}
