// Work without git: before Eon changes a file for the first time, the original is copied to
// .eon/backups/<session>/. Each step gets its own copies, so /undo can take back one step
// and /discard can put every file back.
import fs from 'node:fs';
import path from 'node:path';

export class Backup {
  constructor(root, id) {
    this.root = root;
    this.dir = path.join(root, '.eon', 'backups', id);
    this.file = path.join(this.dir, 'manifest.json');
    this.steps = [];
    if (fs.existsSync(this.file)) this.steps = JSON.parse(fs.readFileSync(this.file, 'utf8')).steps ?? [];
    this.open = null;
  }

  #save() {
    fs.mkdirSync(this.dir, { recursive: true });
    fs.writeFileSync(this.file, JSON.stringify({ steps: this.steps }, null, 1));
  }

  /** Start collecting a step. Files saved from now on belong to it. */
  begin(label) {
    this.open = { n: this.steps.length + 1, label, files: [] };
    this.steps.push(this.open);
  }

  /** Copy a file before this step changes it (once per step). A file that does not exist yet is recorded as new. */
  save(rel) {
    if (!this.open) this.begin('edit');
    const file = path.normalize(rel);
    if (this.open.files.some((f) => f.path === file)) return;
    const abs = path.join(this.root, file);
    const entry = { path: file, existed: fs.existsSync(abs) };
    if (entry.existed) {
      const copy = path.join(this.dir, String(this.open.n), file);
      fs.mkdirSync(path.dirname(copy), { recursive: true });
      fs.copyFileSync(abs, copy);
    }
    this.open.files.push(entry);
    this.#save();
  }

  /** The step is finished; the next edit starts a new one. */
  end() { this.open = null; }

  #restore(step) {
    for (const f of step.files) {
      const abs = path.join(this.root, f.path);
      if (f.existed) {
        fs.mkdirSync(path.dirname(abs), { recursive: true });
        fs.copyFileSync(path.join(this.dir, String(step.n), f.path), abs);
      } else fs.rmSync(abs, { force: true });
    }
  }

  /** Put back what the newest step changed. Returns its label. */
  undo() {
    const step = this.steps.pop();
    if (!step) throw new Error('Nothing to undo: no file has been changed yet.');
    this.#restore(step);
    this.open = null;
    this.#save();
    return step.label;
  }

  /** Put every file back as it was before this session. */
  discard() {
    while (this.steps.length) this.#restore(this.steps.pop());
    this.open = null;
    this.#save();
  }

  /** Files this session changed, with the old and new text, for /diff. */
  changes() {
    const seen = new Map();
    for (const step of this.steps) for (const f of step.files) {
      if (!seen.has(f.path)) seen.set(f.path, f.existed ? fs.readFileSync(path.join(this.dir, String(step.n), f.path), 'utf8') : null);
    }
    return [...seen].map(([file, old]) => {
      const abs = path.join(this.root, file);
      return { file, old, now: fs.existsSync(abs) ? fs.readFileSync(abs, 'utf8') : null };
    });
  }

  get count() { return this.steps.reduce((n, s) => n + s.files.length, 0); }
}

/** A plain line diff for /diff when there is no git. Small and good enough to read. */
export function simpleDiff(old, now) {
  const a = old === null ? [] : old.split('\n'), b = now === null ? [] : now.split('\n');
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  let j = 0;
  while (j < a.length - i && j < b.length - i && a[a.length - 1 - j] === b[b.length - 1 - j]) j++;
  const out = [`@@ line ${i + 1} @@`];
  for (const l of a.slice(i, a.length - j)) out.push(`-${l}`);
  for (const l of b.slice(i, b.length - j)) out.push(`+${l}`);
  return out.join('\n');
}
