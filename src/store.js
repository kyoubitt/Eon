// Local mirror. The web chat is only a transport; these files are the record.
import fs from 'node:fs';
import path from 'node:path';
import { migrateProject } from './migrate.js';

/** Replace a file in one step: write beside it, then rename over it. */
export function writeAtomic(file, text) {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, text);
  fs.renameSync(tmp, file);
}

export class Store {
  constructor(root, id) {
    migrateProject(root);
    this.base = path.join(root, '.eon');
    this.dir = path.join(this.base, 'tasks', id);
    fs.mkdirSync(this.dir, { recursive: true });
  }
  #append(file, obj) {
    fs.appendFileSync(file, `${JSON.stringify({ ts: new Date().toISOString(), ...obj })}\n`);
  }
  chat(role, text) { this.#append(path.join(this.dir, 'chat.jsonl'), { role, text }); }
  /** The last message Eon sent and the model's reply to it, for /raw. */
  lastExchange() {
    const rows = this.#lines(path.join(this.dir, 'chat.jsonl'));
    const reply = rows.map((r) => r.role).lastIndexOf('model');
    const sent = rows.slice(0, reply < 0 ? rows.length : reply).map((r) => r.role).lastIndexOf('eon');
    return { sent: sent < 0 ? null : rows[sent].text, reply: reply < 0 ? null : rows[reply].text };
  }
  audit(event) { this.#append(path.join(this.dir, 'audit.jsonl'), event); }
  /** The transcript as the user saw it, so a session can be shown again later. */
  event(e) { fs.appendFileSync(path.join(this.dir, 'events.jsonl'), `${JSON.stringify(e)}\n`); }
  // Written to a temporary file and renamed, so being killed mid-write cannot leave a half-written record.
  saveSession(meta) { writeAtomic(path.join(this.dir, 'session.json'), JSON.stringify(meta)); }
  savePlan(plan) { fs.writeFileSync(path.join(this.dir, 'plan.json'), JSON.stringify(plan, null, 2)); }
  #lines(file) {
    return fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
  }

  /** Mistakes: a plan claim that validation disproved. Returns the new record's id. */
  mistake(record) {
    const file = path.join(this.base, 'mistakes.jsonl');
    const id = nextId('M', this.#lines(file));
    this.#append(file, { id, ...record });
    return id;
  }

  /** Research: append-only digests, each with its source and date. */
  research() { return this.#lines(path.join(this.base, 'research.jsonl')); }
  addResearch(entry) {
    const file = path.join(this.base, 'research.jsonl');
    const full = { id: nextId('R', this.#lines(file)), date: new Date().toISOString().slice(0, 10), ...entry };
    fs.appendFileSync(file, `${JSON.stringify(full)}\n`);
    return full;
  }
  relevantResearch(text, limit = 4) {
    return this.research().map((e) => [score(text, `${e.topic} ${e.source}`), e]).filter(([n]) => n > 0)
      .sort((a, b) => b[0] - a[0]).slice(0, limit).map(([, e]) => e);
  }

  /** Memory: rules learned from mistakes. Rewritten in place because confirmations change. */
  lessons() {
    const f = path.join(this.base, 'memory.json');
    return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : [];
  }
  saveLessons(list) { fs.writeFileSync(path.join(this.base, 'memory.json'), JSON.stringify(list, null, 2)); }
  addLesson(entry) {
    const list = this.lessons();
    const full = { id: nextId('L', list), created: new Date().toISOString().slice(0, 10), confirmations: 0, promoted: false, ...entry };
    this.saveLessons([...list, full]);
    return full;
  }
  /** Lessons whose topic matches the task: these are re-surfaced as a checklist. */
  relevantLessons(text, limit = 5) {
    const lower = text.toLowerCase();
    return this.lessons().filter((l) => l.applies_to.some((k) => lower.includes(k.toLowerCase())) || score(text, l.rule) >= 2).slice(0, limit);
  }
  projectNotes() {
    const f = path.join(this.base, 'project.md');
    return fs.existsSync(f) ? fs.readFileSync(f, 'utf8').trim() : '';
  }
  remember(text) { fs.appendFileSync(path.join(this.base, 'project.md'), `- ${text.trim()}\n`); }
}

/** The project-wide stores, for showing to the user. */
export function readStores(root) {
  migrateProject(root);
  const base = path.join(root, '.eon');
  const lines = (f) => (fs.existsSync(path.join(base, f)) ? fs.readFileSync(path.join(base, f), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
  const text = (f) => (fs.existsSync(path.join(base, f)) ? fs.readFileSync(path.join(base, f), 'utf8') : '');
  return { notes: text('project.md').trim(), research: lines('research.jsonl'), mistakes: lines('mistakes.jsonl'), lessons: text('memory.json') ? JSON.parse(text('memory.json')) : [] };
}

/** Save a rule the user states outright. It is surfaced for tasks that share its keywords. */
export function teach(root, rule) {
  migrateProject(root);
  const file = path.join(root, '.eon', 'memory.json');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const list = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : [];
  const entry = {
    id: nextId('L', list), created: new Date().toISOString().slice(0, 10), confirmations: 0, promoted: false, status: 'confirmed',
    rule: rule.trim(), applies_to: [...words(rule)].slice(0, 8), mistake: null, wrong: '(taught by the user)', cause: '',
  };
  fs.writeFileSync(file, JSON.stringify([...list, entry], null, 2));
  return entry;
}

const STOP = new Set('this that with from have will when then what into your their there about which should would could after before does were been them they also only just make made need'.split(' '));
const words = (t) => new Set((String(t).toLowerCase().match(/[a-z0-9_]{4,}/g) ?? []).filter((w) => !STOP.has(w)));

/** How many distinct meaningful words two texts share. */
export function score(a, b) {
  const other = words(b);
  return [...words(a)].filter((w) => other.has(w)).length;
}

/** The next id for a list of entries such as L1, L2: one more than the highest, so deleting never repeats an id. */
function nextId(prefix, list) {
  return `${prefix}${Math.max(0, ...list.map((x) => Number(String(x.id).slice(1)) || 0)) + 1}`;
}

/** Delete a lesson (L3) or a research entry (R2) by id. Returns what was removed, or null. */
export function forget(root, id) {
  migrateProject(root);
  const base = path.join(root, '.eon');
  if (/^L\d+$/.test(id)) {
    const file = path.join(base, 'memory.json');
    const list = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : [];
    const hit = list.find((l) => l.id === id);
    if (hit) fs.writeFileSync(file, JSON.stringify(list.filter((l) => l.id !== id), null, 2));
    return hit ?? null;
  }
  if (/^R\d+$/.test(id)) {
    const file = path.join(base, 'research.jsonl');
    const list = fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
    const hit = list.find((r) => r.id === id);
    if (hit) fs.writeFileSync(file, list.filter((r) => r.id !== id).map((r) => `${JSON.stringify(r)}\n`).join(''));
    return hit ?? null;
  }
  return null;
}

export function taskId(task) {
  const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
  const slug = task.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30).replace(/-$/, '');
  return `${stamp}-${slug || 'task'}`;
}
