// Skills: short recipes the model can load when a task matches. Each is a folder with a SKILL.md:
//   ---
//   name: fix-bug
//   description: one line saying when to use it
//   ---
//   the steps...
// Looked for in .eon/skills (this project), ~/.eon/skills (you) and skills/ inside Eon (built in), in that order.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const BUILT_IN = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'skills');

function parse(file, fallbackName, source) {
  const raw = fs.readFileSync(file, 'utf8');
  const fm = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(raw);
  const get = (k) => fm?.[1].match(new RegExp(`^${k}:\\s*(.+)$`, 'm'))?.[1].trim();
  const body = (fm ? raw.slice(fm[0].length) : raw).trim();
  const name = (get('name') ?? fallbackName).toLowerCase();
  if (!/^[\w-]+$/.test(name) || !body) return null;
  return { name, description: (get('description') ?? body.split('\n')[0]).slice(0, 120), body: body.slice(0, 6000), source };
}

/** name -> { name, description, body, source }. A project skill beats yours, which beats a built-in one. */
export function loadSkills(root, { home = os.homedir(), builtIn = BUILT_IN } = {}) {
  const skills = new Map();
  for (const [dir, source] of [[builtIn, 'built in'], [path.join(home, '.eon', 'skills'), 'yours'], [path.join(root, '.eon', 'skills'), 'this project']]) {
    let names = [];
    try { names = fs.readdirSync(dir); } catch { continue; }
    for (const n of names) {
      const file = path.join(dir, n, 'SKILL.md');
      try { if (fs.existsSync(file)) { const s = parse(file, n, source); if (s) skills.set(s.name, s); } } catch { /* a damaged skill is skipped */ }
    }
  }
  return skills;
}

/** Make a starter skill in this project. Returns the file. */
export function newSkill(root, name) {
  if (!/^[\w-]+$/.test(name)) throw new Error('A skill name uses letters, digits, - and _ only.');
  const file = path.join(root, '.eon', 'skills', name, 'SKILL.md');
  if (fs.existsSync(file)) throw new Error(`${name} already exists: ${path.relative(root, file)}`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `---\nname: ${name}\ndescription: one line saying when to use this skill\n---\n1. First step.\n2. Second step.\n3. How to check it worked.\n`);
  return file;
}
