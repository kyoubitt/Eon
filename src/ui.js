import readline from 'node:readline/promises';

export const colorMode = { on: Boolean(process.stdout.isTTY && !process.env.NO_COLOR) };
const c = (n) => (s) => (colorMode.on ? `\x1b[${n}m${s}\x1b[0m` : String(s));

export const color = {
  dim: c(2), bold: c(1), red: c(31), green: c(32), yellow: c(33), blue: c(34), cyan: c(36), grey: c(90), inverse: c(7), magenta: c(35), italic: c(3), orange: c('38;5;208'),
};

export const TAG = {
  get fact() { return color.blue('FACT     '); },
  get inference() { return color.yellow('INFER    '); },
  get assumption() { return color.grey('ASSUME   '); },
  get verified() { return color.green('VERIFIED '); },
  get checked() { return color.green('CHECKED  '); },
  get disproved() { return color.red('DISPROVED'); },
};

export function bar(fraction, width = 20) {
  const filled = Math.round(fraction * width);
  return `[${'#'.repeat(filled)}${'.'.repeat(width - filled)}] ${Math.round(fraction * 100)}%`;
}

export class TerminalUI {
  print(s = '') { console.log(s); }
  async ask(question) {
    this.rl ??= readline.createInterface({ input: process.stdin, output: process.stdout });
    return (await this.rl.question(question)).trim();
  }
  /** Pick one of several labels by number. Returns its index, or null. */
  async choose(title, labels) {
    console.log(title);
    labels.forEach((l, i) => console.log(`  ${i + 1}. ${l}`));
    const n = Number(await this.ask('Number (or Enter to cancel): '));
    return n >= 1 && n <= labels.length ? n - 1 : null;
  }
  close() { this.rl?.close(); }
}

/** Used by tests: answers come from a function of the question text. */
export class ScriptedUI {
  constructor(answer = () => 'y') { this.answer = answer; this.lines = []; }
  print(s = '') { this.lines.push(String(s)); }
  async ask(question, meta) {
    this.lines.push(question);
    if (!meta?.until) return this.answer(question);
    // Like the real terminal: while the question is open, Eon checks whether it has been settled by itself.
    const watch = (async () => { for (let i = 0; i < 300; i++) { if (await meta.until()) { this.lines.push('(carried on by itself)'); return meta.autoAnswer ?? ''; } await new Promise((r) => setTimeout(r, 200)); } return meta.autoAnswer ?? ''; })();
    return Promise.race([watch, Promise.resolve(this.answer(question))]);
  }
  async choose(title, labels) { this.lines.push(title); return this.pick ? this.pick(labels) : 0; }
  close() {}
}
