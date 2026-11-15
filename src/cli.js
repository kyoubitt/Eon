// The interactive terminal app. It behaves like a chat in your normal terminal:
// output scrolls into your scrollback, and a small live area at the bottom holds
// the prompt, the choices of a question, or a status line while Eon is working.
// No dependencies: plain ANSI escape codes on a raw-mode terminal.
import fs from 'node:fs';
import path from 'node:path';
import { color, TAG } from './ui.js';
import { wrapAnsi, clip, hang, visibleLength, renderMarkdown, layoutInput } from './text.js';
import { matchFiles } from './mentions.js';

const SHORTCUTS = [
  color.bold('Shortcuts'),
  '  /            commands and skills   Shift+Tab   change the mode',
  '  Enter        send                  Ctrl+J      new line (or \\ then Enter)',
  '  Esc          interrupt or clear    ↑ ↓         earlier messages',
  '  Ctrl+O       show the last output  Ctrl+C ×2   leave',
  '  Ctrl+R       search messages       @file       attach a file',
  '  # note       save to memory        ! command   run a shell command',
].join('\n');

const SPIN = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

/** Break typed input into keys: text, arrows, enter, Esc, pastes. */
export function* keys(s) {
  let i = 0;
  while (i < s.length) {
    if (s.startsWith('\x1b[200~', i)) {
      const j = s.indexOf('\x1b[201~', i);
      yield { name: 'paste', text: s.slice(i + 6, j < 0 ? s.length : j) };
      i = j < 0 ? s.length : j + 6;
      continue;
    }
    const ch = s[i];
    if (ch === '\x1b') {
      if (i === s.length - 1) { yield { name: 'esc' }; i++; continue; }
      if (s[i + 1] === '\r' || s[i + 1] === '\n') { yield { name: 'newline' }; i += 2; continue; } // Alt+Enter
      const m = /^\x1b(?:\[([0-9;?]*)([A-Za-z~])|O([A-Za-z]))/.exec(s.slice(i));
      if (!m) { i += 2; continue; } // Alt+key: not used
      const final = m[2] ?? m[3], param = m[1] ?? '';
      const name = { A: 'up', B: 'down', C: 'right', D: 'left', H: 'home', F: 'end', Z: 'backtab' }[final]
        ?? (final === '~' ? { 1: 'home', 7: 'home', 3: 'delete', 4: 'end', 8: 'end', 5: 'pageup', 6: 'pagedown' }[param] : undefined);
      if (name) yield { name };
      i += m[0].length;
      continue;
    }
    i++;
    if (ch === '\r') { if (s[i] === '\n') i++; yield { name: 'enter' }; continue; }
    if (ch === '\n') { yield { name: 'newline' }; continue; } // Ctrl+J
    const named = { '\x03': 'ctrl-c', '\x04': 'ctrl-d', '\x7f': 'backspace', '\b': 'backspace', '\x15': 'ctrl-u', '\x01': 'home', '\x05': 'end', '\x17': 'ctrl-w', '\x0b': 'ctrl-k', '\x0f': 'ctrl-o', '\x12': 'ctrl-r', '\t': 'tab' }[ch];
    if (named) { yield { name: named }; continue; }
    if (ch >= ' ') {
      let text = ch;
      while (i < s.length && s[i] >= ' ' && s[i] !== '\x7f') text += s[i++];
      yield { name: 'text', text };
    }
  }
}

/** Only a known command is a command. "/src/app.js is broken" is a message that happens to start with a slash. */
/**
 * The entries a "/" menu shows for what has been typed so far, best match first: the name exactly, the name's start,
 * a word inside the name (/sec finds security-review), anywhere in the name, then the description. With only "/" typed
 * everything is listed in its own order.
 */
export function rankCommands(input, commands) {
  const q = String(input).replace(/^\//, '').toLowerCase();
  if (!q) return commands.filter(([c]) => c.trim() !== input);
  const scored = [];
  commands.forEach(([c, d], i) => {
    const name = c.trim().replace(/^\//, '').toLowerCase();
    let s = -1;
    if (name === q) s = 0;
    else if (name.startsWith(q)) s = 1;
    else if (name.split(/[-_ ]/).some((w) => w.startsWith(q))) s = 2;
    else if (name.includes(q)) s = 3;
    else if (String(d).toLowerCase().includes(q)) s = 4;
    if (s >= 0 && c.trim() !== input) scored.push([s, i, [c, d]]);
  });
  return scored.sort((a, b) => a[0] - b[0] || a[1] - b[1]).map((x) => x[2]);
}

export function isCommand(line, commands) {
  const word = String(line).trim().split(/\s+/)[0];
  return commands.some(([c]) => c.trim() === word) || ['/exit', '/clear', '/history'].includes(word) || /^\/[a-z-]+$/i.test(String(line).trim());
}

/** Find the choices in a question such as "Approve? [y]es / [n]o / or type what to change: ". */
export function parseChoices(question) {
  const lines = String(question).trimEnd().split('\n');
  const last = lines.pop() ?? '';
  let options = [...last.matchAll(/\[([a-z])\]([a-z]*)((?: [a-z0-9.-]+)*)/gi)].map((m) => ({ value: m[1].toLowerCase(), label: cap(m[1] + m[2] + m[3]) }));
  if (!options.length && /\[y\/n\]/i.test(last)) options = [{ value: 'y', label: 'Yes' }, { value: 'n', label: 'No' }];
  const head = options.length ? last.replace(/\s*(\[[a-z]\]|\[y\/n\])[\s\S]*$/i, '').trim() : last.trim();
  return {
    head: [...lines, head].map((l) => l.trimEnd()).filter((l) => l.trim() && l.trim() !== '>'),
    options,
    hint: /type what to change/i.test(last) ? 'or type what to change' : '',
  };
}

export class CLI {
  constructor({ stdin = process.stdin, stdout = process.stdout, historyFile = null, bell = true } = {}) {
    Object.assign(this, {
      stdin, stdout, bell, historyFile, input: '', cur: 0, pending: null, snap: {}, busy: false, busyAt: 0, tick: 0, running: false,
      drawn: { rows: 0, cursor: 0 }, menuSel: 0, histPos: -1, draft: '', lastInput: Date.now(), lastBell: 0, lastKind: '', tools: new Map(),
      echoed: null, quitArmed: 0, lastInterrupt: 0, lastOutput: null, files: [], search: null, live: [], commands: [], cycle: [], history: [],
    });
    try { if (historyFile && fs.existsSync(historyFile)) this.history = JSON.parse(fs.readFileSync(historyFile, 'utf8')).slice(-200); } catch { /* start without history */ }
    this.onQuit = () => {};
    this.onInterrupt = () => {};
    this.onCycle = () => {};
  }

  get width() { return Math.max(24, this.stdout.columns || 80); }
  get rows() { return Math.max(8, this.stdout.rows || 24); }

  start() {
    this.running = true;
    this.stdin.setRawMode?.(true);
    this.stdin.resume();
    this.stdin.on('data', (this.onData = (d) => this.feed(String(d))));
    this.stdout.on?.('resize', (this.onResize = () => this.#redraw()));
    this.stdout.write('\x1b[?2004h'); // bracketed paste
    this.timer = setInterval(() => { this.tick++; if (this.busy && !this.pending) this.#redraw(); this.#poll(); }, 100);
    this.timer.unref?.();
    this.#redraw();
  }

  close() {
    if (!this.running) return;
    this.running = false;
    clearInterval(this.timer);
    this.stdin.off?.('data', this.onData);
    this.stdout.off?.('resize', this.onResize);
    this.#write(`${this.#erase()}\x1b[?2004l\x1b[?25h`);
    this.stdin.setRawMode?.(false);
    this.stdin.pause();
    try {
      if (this.historyFile) { fs.mkdirSync(path.dirname(this.historyFile), { recursive: true }); fs.writeFileSync(this.historyFile, JSON.stringify(this.history.slice(-200))); }
    } catch { /* history is a convenience */ }
  }

  #write(s) { if (s) this.stdout.write(s); }

  /** Escape codes that remove the live area, leaving the cursor where it started. */
  #erase() {
    const { rows, cursor } = this.drawn;
    this.drawn = { rows: 0, cursor: 0 };
    return rows ? `${cursor ? `\x1b[${cursor}A` : ''}\r\x1b[J` : '';
  }

  #paint() {
    const { lines, row, col, showCursor } = this.#liveLines();
    this.live = lines;
    this.drawn = { rows: lines.length, cursor: row };
    if (!lines.length) return '\x1b[?25l';
    const up = lines.length - 1 - row;
    return `${lines.join('\n')}${up ? `\x1b[${up}A` : ''}\r${col ? `\x1b[${col}C` : ''}${showCursor ? '\x1b[?25h' : '\x1b[?25l'}`;
  }

  #redraw() { if (this.running) this.#write(this.#erase() + this.#paint()); }

  /** Everything that is not scrollback: prompt or choices, menu, spinner and status line. */
  #liveLines() {
    const w = this.width - 1, p = this.pending, lines = [];
    let row = 0, col = 0, showCursor = false;
    if (p && p.kind === 'task') {
      const room = w - 6;
      const lay = layoutInput(this.input, this.cur, room);
      const first = Math.max(0, Math.min(lay.row - 5, lay.rows.length - 6));
      const shown = this.input ? lay.rows.slice(first, first + 6) : [clip(p.placeholder ?? '', room)];
      lines.push(color.dim(`╭${'─'.repeat(w - 2)}╮`));
      shown.forEach((text, i) => {
        const body = this.input ? text : color.dim(text);
        const lead = i === 0 && first === 0 ? color.cyan('>') : ' ';
        lines.push(`${color.dim('│')} ${lead} ${body}${' '.repeat(Math.max(0, room - visibleLength(text)))} ${color.dim('│')}`);
      });
      lines.push(color.dim(`╰${'─'.repeat(w - 2)}╯`));
      row = 1 + (lay.row - first); col = 4 + lay.col; showCursor = true;
      const menu = this.#menu();
      if (menu.length) {
        // A window of 8 rows that follows the highlighted entry, so every entry can be reached with the arrow keys.
        const size = 8, start = Math.max(0, Math.min(this.menuSel - 4, menu.length - size));
        menu.slice(start, start + size).forEach(([c, d], k) => lines.push(clip(start + k === this.menuSel ? `  ${color.cyan('❯')} ${color.bold(c.trim().padEnd(20))} ${color.dim(d)}` : `    ${c.trim().padEnd(20)} ${color.dim(d)}`, w)));
        if (menu.length > size && !this.#mention()) lines.push(color.dim(`    ${start + 1}-${Math.min(menu.length, start + size)} of ${menu.length}  ·  ↑ ↓ to scroll, Tab or Enter to pick`));
      } else lines.push(clip(this.#statusLine(), w));
    } else if (p) {
      const n = p.options.length;
      const first = Math.max(0, Math.min(p.sel - 4, n - 9));
      p.options.slice(first, first + 9).forEach((o, i) => {
        const idx = first + i, on = idx === p.sel;
        lines.push(clip(`${on ? color.cyan('❯') : ' '} ${on ? color.bold(`${idx + 1}. ${o.label}`) : `${idx + 1}. ${o.label}`}`, w));
      });
      if (n > 9) lines.push(color.dim(`  (${n} choices; use ↑ ↓)`));
      const hintRow = color.dim(p.typed ? '  ↑ ↓ choose · Enter confirm · or type a reply' : '  ↑ ↓ move · Enter open · Esc cancel');
      if (p.typed) {
        const room = w - 4, start = Math.max(0, this.cur - room + 1);
        const text = this.input ? this.input.slice(start, start + room) : color.dim(p.hint || 'or type a reply');
        lines.push(`${color.cyan('›')} ${text}`);
        row = lines.length - 1; col = 2 + (this.cur - start); showCursor = true;
      } else row = lines.length - 1;
      lines.push(clip(hintRow, w));
    } else if (this.busy) {
      const sn = this.snap;
      if (sn.plan && sn.approved) {
        const steps = sn.plan.steps, at = Math.max(0, steps.findIndex((x) => !(sn.done ?? []).includes(x.n)));
        const from = Math.max(0, Math.min(at - 2, steps.length - 6));
        for (const x of steps.slice(from, from + 6)) {
          const mark = (sn.done ?? []).includes(x.n) ? color.green('[x]') : (sn.started ?? []).includes(x.n) ? color.cyan('[>]') : color.dim('[ ]');
          lines.push(clip(`  ${mark} ${x.n}. ${x.text}`, w));
        }
      }
      const secs = Math.floor((Date.now() - this.busyAt) / 1000);
      lines.push(clip(`${color.cyan(SPIN[this.tick % SPIN.length])} ${this.snap.phase || 'working'}… ${color.dim(`(${secs}s · esc to interrupt)`)}`, w));
      if (this.snap.preview?.tail) lines.push(clip(color.dim(`  “…${this.snap.preview.tail}”`), w));
      lines.push(clip(this.#statusLine(), w));
      row = lines.length - 1;
    } else if (this.snap.phase && this.running) {
      lines.push(clip(this.#statusLine(), w));
    }
    return { lines, row, col, showCursor };
  }

  #statusLine() {
    const s = this.snap, bits = [];
    if (this.search) return color.dim(`  search history: ${this.search.query || '…'}   ctrl+r older · enter use · esc cancel`);
    if (s.mode) bits.push(s.mode === 'accept' ? '⏵⏵ accept edits' : s.mode, s.level);
    const m = s.models;
    if (m) bits.push(m.split ? `${m.plan} → ${m.build}` : m.plan);
    else if (s.model) bits.push(s.model);
    if (s.branch) bits.push(`⎇ ${s.branch.replace(/^eon\/\d{10,}-?/, '') || s.branch}`);
    if (s.plan) bits.push(`plan ${(s.done ?? []).length}/${s.plan.steps.length} · ${Math.round((s.confidence ?? 0) * 100)}%`);
    if (s.usage?.messages) bits.push(`≈${s.usage.tokensIn + s.usage.tokensOut > 9999 ? `${Math.round((s.usage.tokensIn + s.usage.tokensOut) / 1000)}k` : s.usage.tokensIn + s.usage.tokensOut} tokens`);
    if (this.busy && s.preview?.chars) bits.push(`reply ${(s.preview.chars / 1000).toFixed(1)}k chars`);
    else if (this.busy && s.budget) bits.push(`chat ${Math.round((s.chars ?? 0) / 1000)}k`);
    const hint = this.pending?.kind === 'task' ? (this.input.includes('\n') ? 'enter send · ctrl+j new line' : '/ commands · ? shortcuts · shift+tab mode') : '';
    const left = `  ${bits.join(' · ')}`, full = `${left}   ${hint}`;
    return color.dim(hint && visibleLength(full) <= this.width - 1 ? full : left);
  }

  /** The "@name" being typed at the cursor, if any. */
  #mention() {
    const m = /(?:^|\s)@([\w./\\-]*)$/.exec(this.input.slice(0, this.cur));
    return m ? { query: m[1], start: this.cur - m[1].length - 1 } : null;
  }

  #menu() {
    if (this.pending?.kind !== 'task' || this.search) return [];
    const at = this.#mention();
    if (at && this.files.length) return matchFiles(at.query, this.files).map((f) => [f, '']);
    if (!this.input.startsWith('/') || this.input.includes(' ')) return [];
    return rankCommands(this.input, this.commands);
  }

  // ---- output ----------------------------------------------------------------------------

  print(text = '') {
    // Lines longer than the screen are wrapped here, keeping their indent, so they do not break the layout.
    const w = this.width - 1;
    const lines = String(text).split('\n').flatMap((l) => {
      if (visibleLength(l) <= w) return [l];
      const indent = /^( *)/.exec(l)[1];
      return hang(indent, l.slice(indent.length), w).split('\n');
    });
    this.lastKind = 'line';
    if (!this.running) { this.stdout.write(`${lines.join('\n')}\n`); return; }
    this.#write(`${this.#erase()}${lines.join('\n')}\n${this.#paint()}`);
  }

  /** Print the welcome box. */
  banner({ cwd, models, mode, level, note }) {
    const w = Math.min(this.width - 1, 64);
    const row = (t) => `${color.dim('│')} ${clip(t, w - 4)}${' '.repeat(Math.max(0, w - 4 - visibleLength(clip(t, w - 4))))} ${color.dim('│')}`;
    this.print([
      color.dim(`╭${'─'.repeat(w - 2)}╮`),
      row(`${color.orange('✻')} ${color.bold('Eon')}  ${color.dim('plans before it edits')}`),
      row(''),
      row(color.dim(`cwd     ${cwd}`)),
      row(color.dim(`models  ${models}`)),
      row(color.dim(`mode    ${mode} / ${level}`)),
      color.dim(`╰${'─'.repeat(w - 2)}╯`),
      color.dim('  / commands · ? shortcuts · shift+tab changes mode · esc interrupts · eon -r resumes'),
      ...(note ? [note] : []),
      '',
    ].join('\n'));
    this.lastKind = '';
  }

  /** A structured event from the agent: a message, a tool call, a diff, a plan. */
  event(e) {
    const text = this.#render(e);
    if (text === null) return;
    const gap = ['user', 'assistant', 'plan'].includes(e.type) && this.lastKind !== '';
    this.print(gap ? `\n${text}` : text);
    this.lastKind = e.type;
  }

  #render(e) {
    const w = this.width - 1;
    switch (e.type) {
      case 'user':
        if (this.echoed === e.text) { this.echoed = null; return null; }
        return hang(`${color.cyan('>')} `, e.text, w);
      case 'answer': return `  ${color.cyan('❯')} ${{ y: 'Yes', n: 'No' }[e.text] ?? e.text}`;
      case 'assistant': {
        // The model's own words, kept short: the first paragraph, at most about 240 characters.
        const para = String(e.text).trim().split(/\n\s*\n/)[0];
        const short = para.length > 240 ? `${para.slice(0, 237).replace(/\s+\S*$/, '')}…` : para;
        return renderMarkdown(short, w - 2).split('\n').map((l, i) => (i ? '  ' : `${color.dim('●')} `) + color.dim(l)).join('\n');
      }
      case 'line': return e.text;
      case 'question': return color.yellow(parseChoices(e.text).head.join('\n'));
      case 'tool': {
        this.tools.set(e.id, { name: e.name, arg: e.arg });
        // An edit shows its header now (the diff follows it). Everything else is one line, printed when it finishes.
        return ['Edit', 'Write'].includes(e.name) ? `${color.green('●')} ${color.bold(e.name)} ${color.dim(clip(e.arg, w - e.name.length - 4))}` : null;
      }
      case 'tool-end': {
        const tool = this.tools.get(e.id) ?? {}, name = tool.name;
        this.lastOutput = { ...tool, detail: e.detail };
        const blocked = /^(PLAN GATE|DENIED|NOT SAVED|NOT DONE)/.test(e.summary);
        if (['Edit', 'Write'].includes(name)) return e.ok ? null : color.dim(hang('  ⎿  ', blocked ? `blocked: ${e.summary.replace(/^(PLAN GATE|DENIED): ?/, '')}` : e.summary, w));
        // Verify and Step done already print their own green line; do not say it twice.
        if (['Verify', 'Step done'].includes(name) && e.ok && /verified|checked|committed|marked done|recorded/i.test(e.summary)) return null;
        const summary = blocked ? `blocked: ${e.summary.replace(/^(PLAN GATE|DENIED|NOT SAVED|NOT DONE): ?/, '')}` : e.summary;
        const room = Math.max(12, w - (name?.length ?? 4) - summary.length - 8);
        const head = `${(e.ok ? color.green : blocked ? color.yellow : color.red)('●')} ${color.bold(name ?? 'Tool')} ${color.dim(clip(tool.arg ?? '', room))}  ${(e.ok ? color.dim : blocked ? color.yellow : color.red)(clip(summary, Math.max(20, w - 8)))}`;
        const out = [head];
        if (name === 'Run') {
          const body = e.detail.split('\n').slice(2).filter((l) => l.trim());
          for (const l of body.slice(0, 4)) out.push(color.dim(`    ${clip(l, w - 5)}`));
          if (body.length > 4) out.push(color.dim(`    … +${body.length - 4} lines`));
        }
        return out.join('\n');
      }
      case 'diff': {
        const removed = e.removed ? e.removed.split('\n') : [], added = e.added ? e.added.split('\n') : [];
        const before = e.before ?? [], after = e.after ?? [], at = e.line ?? 1;
        const nw = String(at + Math.max(removed.length, added.length) + after.length).length;
        const row = (n, sign, text, paint) => paint(hang(`     ${String(n).padStart(nw)} ${sign} `, text, w));
        const body = [
          ...before.map((t, i) => row(at - before.length + i, ' ', t, color.dim)),
          ...removed.map((t, i) => row(at + i, '-', t, color.red)),
          ...added.map((t, i) => row(at + i, '+', t, color.green)),
          ...after.map((t, i) => row(at + added.length + i, ' ', t, color.dim)),
        ].flatMap((r) => r.split('\n'));
        const limit = e.created ? 12 : 30;
        const head = e.created ? `new file, ${added.length} line${added.length === 1 ? '' : 's'}` : `${e.changed} line${e.changed === 1 ? '' : 's'} changed`;
        return [color.dim(`  ⎿  ${head}`), ...body.slice(0, limit), ...(body.length > limit ? [color.dim(`     … +${body.length - limit} lines`)] : [])].join('\n');
      }
      case 'plan': return this.#renderPlan(e);
      default: return null;
    }
  }

  #renderPlan(e) {
    const p = e.plan, w = this.width - 3, bar = color.dim('│');
    const rows = [`${color.dim('╭')} ${color.bold('Plan')}  ${p.goal}`];
    const add = (text) => { for (const l of text.split('\n')) rows.push(`${bar} ${l}`); };
    const sub = (t) => add(color.dim(t));
    sub('evidence');
    for (const c of p.claims) add(hang(`  ${TAG[c.tag] ?? c.tag} `, `${c.text}${c.challenged ? color.red(' (challenged)') : ''} ${color.dim([c.id, c.pointer ?? (c.check ? `check: ${c.check}` : '')].filter(Boolean).join(' '))}`, w));
    sub('steps');
    for (const s of p.steps) {
      const mark = (e.done ?? []).includes(s.n) ? color.green('[x]') : (e.started ?? []).includes(s.n) ? color.cyan('[>]') : color.dim('[ ]');
      add(hang(`  ${mark} `, `${s.n}. ${s.text}${s.files?.length ? color.dim(`  ${s.files.join(', ')}`) : ''}`, w));
    }
    if (p.lessons?.length) { sub('lessons applied'); for (const l of p.lessons) add(hang('  ', `${l.id}: ${l.how}`, w)); }
    if (p.impact?.length) { sub('impact'); for (const i of p.impact) add(hang('  ', `${i.area}: ${i.effect}`, w)); }
    sub('validation');
    for (const v of p.validation) add(`  $ ${v}`);
    const n = Math.round((e.confidence ?? 0) * 16);
    add(`${color.dim('confidence')}  ${Math.round((e.confidence ?? 0) * 100)}% ${color.cyan('█'.repeat(n))}${color.dim('░'.repeat(16 - n))}`);
    rows.push(color.dim('╰'));
    return rows.join('\n');
  }

  /** The agent's state, shown in the status line. */
  update(snap) {
    const was = this.busy;
    this.snap = snap;
    this.busy = Boolean(snap.busy);
    if (this.busy && !was) this.busyAt = Date.now();
    if (!this.busy && was) this.#maybeBell();
    this.#redraw();
  }

  /** Ring the terminal bell when you have probably looked away. */
  #maybeBell() {
    const now = Date.now();
    if (this.bell && now - this.lastInput > 8000 && now - this.lastBell > 3000) { this.lastBell = now; this.#write('\x07'); }
  }

  /** A question that Eon can answer itself when the thing it is waiting for has happened (a check solved, a login done). */
  #poll() {
    const p = this.pending;
    if (!p?.until || p.polling || Date.now() - (p.lastPoll ?? 0) < 1000) return;
    p.polling = true;
    p.lastPoll = Date.now();
    Promise.resolve().then(() => p.until()).then((done) => {
      p.polling = false;
      if (done && this.pending === p) { this.print(color.dim('  Eon noticed it is done and is carrying on.')); this.#answer(p.autoAnswer ?? '', 'continuing'); }
    }).catch(() => { p.polling = false; });
  }

  // ---- questions -------------------------------------------------------------------------

  /** Ask for a line of text. Questions written like "[y]es / [n]o" get numbered choices as well. */
  ask(question, meta = {}) {
    return new Promise((resolve) => {
      this.input = ''; this.cur = 0; this.histPos = -1; this.menuSel = 0;
      if (meta.kind === 'task') {
        this.pending = { kind: 'task', resolve, placeholder: meta.placeholder ?? 'What should Eon do?' };
      } else {
        const { head, options, hint } = parseChoices(question);
        if (head.length) this.print(head.map((l) => color.bold(color.yellow(l))).join('\n'));
        this.pending = { kind: 'question', resolve, options, sel: 0, typed: true, hint, until: meta.until, autoAnswer: meta.autoAnswer };
      }
      this.#maybeBell();
      this.#redraw();
    });
  }

  /** Pick one item from a list. Resolves to its index, or null when cancelled with Esc. */
  choose(title, labels) {
    return new Promise((resolve) => {
      this.input = ''; this.cur = 0;
      this.print(color.bold(color.yellow(title)));
      this.pending = { kind: 'choose', resolve, options: labels.map((label, i) => ({ value: i, label })), sel: 0, typed: false, cancelable: true };
      this.#redraw();
    });
  }

  #answer(value, label) {
    const p = this.pending;
    this.pending = null;
    this.input = ''; this.cur = 0;
    if (p.kind === 'task') {
      this.echoed = value;
      this.print(hang(`${color.cyan('>')} `, value, this.width - 1));
    } else this.print(`  ${color.cyan('❯')} ${label ?? value}`);
    if (p.kind === 'task' && value && !value.startsWith('/')) this.history.push(value);
    this.#redraw();
    p.resolve(value);
  }

  // ---- input -----------------------------------------------------------------------------

  /** Handle typed input: a key, or a pasted run of characters. */
  feed(data) {
    this.lastInput = Date.now();
    // Some terminals send a pasted block without marking it, so its line breaks look like Enter presses.
    // Text with more text after a line break is a paste: put it in the box and let the user press Enter.
    if (this.pending && !data.includes('\x1b') && /[\r\n][^\r\n]/.test(data) && (this.pending.kind === 'task' || this.pending.typed)) {
      this.#insert(data.replace(/\r\n?/g, '\n').replace(/\n+$/, ''));
      this.#redraw();
      return;
    }
    for (const k of keys(data)) this.#key(k);
    this.#redraw();
  }

  /** Print the full output of the last tool call (the screen shows only the first lines). */
  showOutput() {
    const o = this.lastOutput;
    if (!o?.detail) return this.print(color.dim('  No tool output to show yet.'));
    return this.print(`${color.dim(`── output of ${o.name}(${o.arg}) ──`)}\n${o.detail.split('\n').map((l) => color.dim(`  ${l}`)).join('\n')}`);
  }

  #insert(text) {
    const flat = this.pending?.kind !== 'task';
    const clean = text.replace(/\r\n?/g, flat ? ' ' : '\n').replace(/\n/g, flat ? ' ' : '\n').replace(/\t/g, '  ').replace(/[\x00-\x09\x0b-\x1f\x7f]/g, '');
    this.input = this.input.slice(0, this.cur) + clean + this.input.slice(this.cur);
    this.cur += clean.length;
    this.menuSel = 0;
  }

  #key(k) {
    const p = this.pending;
    if (this.search) return this.#searchKey(k);
    if (k.name === 'backtab' && !p && this.busy) return this.onCycle();
    if (k.name === 'ctrl-c') {
      if (this.busy && !p) {
        // Ctrl+C stops the work; a second one within two seconds leaves Eon, even if it is stuck.
        const t = Date.now();
        if (t - this.lastInterrupt < 2000) return this.onQuit();
        this.lastInterrupt = t;
        return this.onInterrupt();
      }
      if (Date.now() - this.lastInterrupt < 2000) return this.onQuit(); // Ctrl+C, Ctrl+C: leave, even right after stopping a run
      if (this.input) { this.input = ''; this.cur = 0; return undefined; }
      const now = Date.now();
      if (now - this.quitArmed < 2000) return this.onQuit();
      this.quitArmed = now;
      return this.print(color.dim('  Press Ctrl+C again to exit.'));
    }
    if (k.name === 'esc') {
      if (this.busy && !p) return this.onInterrupt();
      if (this.input) { this.input = ''; this.cur = 0; return undefined; }
      if (p?.cancelable) return this.#answer(null, 'cancelled');
      return undefined;
    }
    if (k.name === 'ctrl-o') return this.showOutput();
    if (!p) return undefined; // typing while Eon works is ignored, so a stray key cannot answer a later question

    if (k.name === 'ctrl-d' && p.kind === 'task' && !this.input) return this.onQuit();
    if (k.name === 'ctrl-r' && p.kind === 'task' && this.history.length) { this.search = { query: '', skip: 0, draft: this.input }; this.#searchUpdate(); return undefined; }
    if (k.name === 'backtab' && p.kind === 'task' && this.cycle.length) {
      const next = this.cycle[(this.cycle.indexOf(this.snap.mode) + 1) % this.cycle.length];
      return this.#answer(`/mode ${next}`);
    }

    const menu = this.#menu();
    const choice = p.kind !== 'task';
    switch (k.name) {
      case 'up':
        if (choice) p.sel = (p.sel + p.options.length - 1) % p.options.length;
        else if (menu.length) this.menuSel = (this.menuSel + menu.length - 1) % menu.length;
        else if (!this.#moveRow(-1)) this.#history(-1);
        break;
      case 'down':
        if (choice) p.sel = (p.sel + 1) % p.options.length;
        else if (menu.length) this.menuSel = (this.menuSel + 1) % menu.length;
        else if (!this.#moveRow(1)) this.#history(1);
        break;
      case 'newline': if (p.kind === 'task') this.#insert('\n'); break;
      case 'left': this.cur = Math.max(0, this.cur - 1); break;
      case 'right': this.cur = Math.min(this.input.length, this.cur + 1); break;
      case 'home': this.cur = this.input.lastIndexOf('\n', this.cur - 1) + 1; break;
      case 'end': { const n = this.input.indexOf('\n', this.cur); this.cur = n < 0 ? this.input.length : n; break; }
      case 'backspace': if (this.cur) { this.input = this.input.slice(0, this.cur - 1) + this.input.slice(this.cur); this.cur--; this.menuSel = 0; } break;
      case 'delete': this.input = this.input.slice(0, this.cur) + this.input.slice(this.cur + 1); break;
      case 'ctrl-u': this.input = this.input.slice(this.cur); this.cur = 0; break;
      case 'ctrl-k': this.input = this.input.slice(0, this.cur); break;
      case 'ctrl-w': { const left = this.input.slice(0, this.cur).replace(/\S+\s*$/, ''); this.input = left + this.input.slice(this.cur); this.cur = left.length; break; }
      case 'tab': if (menu.length) this.#applyMenu(menu[this.menuSel][0]); break;
      case 'paste': this.#insert(k.text); break;
      case 'text':
        // A digit picks a numbered choice straight away, as long as nothing has been typed.
        if (p.kind === 'task' && !this.input && k.text === '?') { this.print(SHORTCUTS); break; }
        if (choice && !this.input && /^[1-9]$/.test(k.text) && p.options[Number(k.text) - 1]) {
          const o = p.options[Number(k.text) - 1];
          return this.#answer(p.kind === 'choose' ? o.value : o.value, o.label);
        }
        if (p.typed || p.kind === 'task') this.#insert(k.text);
        break;
      case 'enter': return this.#enter(p, menu);
      default: break;
    }
    return undefined;
  }

  #enter(p, menu) {
    if (p.kind === 'task') {
      if (menu.length) {
        const [cmd] = menu[this.menuSel];
        if (this.#mention()) { this.#applyMenu(cmd); return undefined; } // a file name: put it in, do not send
        if (cmd.endsWith(' ')) { this.input = cmd; this.cur = cmd.length; this.menuSel = 0; return undefined; }
        this.input = cmd;
      }
      // A backslash before Enter means "new line", as in a shell.
      if (this.input[this.cur - 1] === '\\') { this.input = `${this.input.slice(0, this.cur - 1)}\n${this.input.slice(this.cur)}`; return undefined; }
      const text = this.input.trim();
      return text ? this.#answer(text) : undefined;
    }
    const text = this.input.trim();
    if (text) return this.#answer(text);
    const o = p.options[p.sel];
    return o ? this.#answer(o.value, o.label) : this.#answer('');
  }

  /** Put a chosen menu entry in the box: a command, or a file name in place of the "@" being typed. */
  #applyMenu(entry) {
    const at = this.#mention();
    if (at) {
      const added = `@${entry} `;
      this.input = this.input.slice(0, at.start) + added + this.input.slice(this.cur);
      this.cur = at.start + added.length;
    } else { this.input = entry; this.cur = entry.length; }
    this.menuSel = 0;
  }

  // ---- searching earlier messages (Ctrl+R) ----

  #searchUpdate() {
    const q = this.search.query.toLowerCase();
    const hits = [...this.history].reverse().filter((h) => h.toLowerCase().includes(q));
    this.search.hit = hits.length ? hits[this.search.skip % hits.length] : null;
    this.input = this.search.hit ?? '';
    this.cur = this.input.length;
  }

  #searchKey(k) {
    const sr = this.search;
    if (k.name === 'enter') { this.search = null; return undefined; } // keep the match in the box
    if (k.name === 'esc' || k.name === 'ctrl-c') { this.input = sr.draft; this.cur = this.input.length; this.search = null; return undefined; }
    if (k.name === 'ctrl-r') sr.skip++;
    else if (k.name === 'backspace') { sr.query = sr.query.slice(0, -1); sr.skip = 0; }
    else if (k.name === 'text' || k.name === 'paste') { sr.query += (k.text ?? '').replace(/[\r\n]/g, ' '); sr.skip = 0; }
    else return undefined;
    this.#searchUpdate();
    return undefined;
  }

  /** Give the terminal back, for an editor or another program that needs it. Call resume() afterwards. */
  suspend() {
    if (!this.running) return;
    this.#write(`${this.#erase()}\x1b[?2004l\x1b[?25h`);
    this.stdin.setRawMode?.(false);
    this.stdin.off?.('data', this.onData);
    this.running = false;
  }

  resume() {
    if (this.running) return;
    this.running = true;
    this.stdin.setRawMode?.(true);
    this.stdin.resume();
    this.stdin.on('data', this.onData);
    this.#write('\x1b[?2004h');
    this.#redraw();
  }

  /** Move the cursor one row up or down inside a multi-row message. False when there is no row to move to. */
  #moveRow(dir) {
    const lay = layoutInput(this.input, this.cur, this.width - 7);
    const target = lay.row + dir;
    if (target < 0 || target >= lay.rows.length) return false;
    this.cur = lay.starts[target] + Math.min(lay.col, lay.rows[target].length);
    return true;
  }

  #history(dir) {
    if (!this.history.length) return;
    if (this.histPos === -1) { if (dir > 0) return; this.draft = this.input; this.histPos = this.history.length; }
    this.histPos = Math.max(0, Math.min(this.history.length, this.histPos + dir));
    this.input = this.histPos === this.history.length ? this.draft : this.history[this.histPos];
    if (this.histPos === this.history.length) this.histPos = -1;
    this.cur = this.input.length;
  }
}
