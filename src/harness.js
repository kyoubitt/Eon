// "eon harness": five short scenarios through the real chat driver, so a site that Eon cannot read shows up as one
// pass/fail line with a plain fix, instead of as a mystery in the middle of a task. The messages are harmless test
// words and numbers. The report holds timings and counts only, never the page's text.
import fs from 'node:fs';
import path from 'node:path';
import { extractActions } from './protocol.js';

const ONE = 'harness-ok-7431', TWO = 'harness-two-5582';
const EDIT_FIND = '\tconst x = "a";', EDIT_REPLACE = '\tconst x = "b";';
const EDIT_BLOCK = `EDIT step=1 path=a.js\n<<<<<<< SEARCH\n${EDIT_FIND}\n=======\n${EDIT_REPLACE}\n>>>>>>> REPLACE`;
const N = 400;

export const SCENARIOS = [
  {
    name: 'send-read',
    prompt: `Reply with exactly this one word and nothing else: ${ONE}`,
    check: (r) => (r.includes(ONE) ? { ok: true, detail: 'a message went out and its reply was read' } : { ok: false, detail: `the reply did not contain the test word (${r.length} characters read)`, fix: 'Run: eon inspect <site> and paste ~/.eon/inspect-<site>.txt. Eon is probably reading the wrong part of the page.' }),
  },
  {
    name: 'long-reply',
    prompt: `Write the whole numbers from 1 to ${N}, one per line, and nothing else.`,
    check: (r) => {
      const nums = r.split('\n').map((l) => l.trim()).filter((l) => /^\d+$/.test(l)).map(Number);
      const last = nums.at(-1) ?? 0;
      return last >= N && nums.length >= N - 5
        ? { ok: true, detail: `${nums.length} lines read, up to ${last}` }
        : { ok: false, detail: `the reply was cut short: read ${nums.length} lines, last number ${last} of ${N}`, fix: 'Eon decided the reply was finished too early for this site. Paste the report and this will be tuned.' };
    },
  },
  {
    name: 'code-block',
    prompt: 'Reply with only a fenced json code block that contains exactly this and nothing else: {"action":"done","summary":"harness"}',
    check: (r) => {
      const a = extractActions(r).find((x) => x.action === 'done');
      return a?.summary === 'harness' ? { ok: true, detail: 'the code block was read as an action' } : { ok: false, detail: 'the code block was not read as an action', fix: 'The page probably adds labels or changes characters inside code blocks. Paste the report.' };
    },
  },
  {
    name: 'edit-block',
    prompt: `Reply with only this block, exactly as written, inside one code fence (keep the tab at the start of the two code lines):\n${EDIT_BLOCK}`,
    check: (r) => {
      const a = extractActions(r).find((x) => x.action === 'edit_file');
      if (!a) return { ok: false, detail: 'no edit was found in the reply', fix: 'The edit block did not survive the page. Paste the report.' };
      const same = String(a.find).replace(/\n$/, '') === EDIT_FIND && String(a.replace).replace(/\n$/, '') === EDIT_REPLACE;
      return same ? { ok: true, detail: 'tabs and quotes inside the edit arrived unchanged' } : { ok: false, detail: 'the edit was read, but tabs or quotes inside it were changed', fix: 'The page rewrites characters inside code. Paste the report.' };
    },
  },
  {
    name: 'follow-up',
    prompt: `Reply with exactly this one word and nothing else: ${TWO}`,
    check: (r) => (r.includes(TWO) && !r.includes(ONE) ? { ok: true, detail: 'the second message got its own reply' } : { ok: false, detail: r.includes(ONE) ? 'Eon read the first reply again instead of the new one' : 'the new reply was not found', fix: 'Eon cannot tell the new reply from the old ones on this site. Paste the report.' }),
  },
];

/** What a well-behaved chat answers to the five test messages (used by the stand-in sites). */
export function standInReply(text, broken = null) {
  if (text.includes(ONE)) return ONE;
  if (text.includes(TWO)) return broken === 'repeat' ? `${ONE}` : TWO;
  if (text.includes('whole numbers')) return Array.from({ length: broken === 'truncate' ? 250 : N }, (_, i) => i + 1).join('\n');
  if (text.includes('fenced json')) return '```json\n{"action":"done","summary":"harness"}\n```';
  if (text.includes('EDIT step=1')) return `\`\`\`\n${broken === 'mangle' ? EDIT_BLOCK.replace(/\t/g, '  ').replace(/"/g, "'") : EDIT_BLOCK}\n\`\`\``;
  return 'ok';
}

// The timer is always cleared: a leftover timer from an earlier scenario would otherwise abort a later one.
const timeout = (p, ms, onTimeout) => {
  let timer;
  const limit = new Promise((_, rej) => { timer = setTimeout(() => { onTimeout?.(); rej(new Error(`no reply within ${Math.round(ms / 1000)} seconds`)); }, ms); });
  return Promise.race([p, limit]).finally(() => clearTimeout(timer));
};

/** Run the scenarios in one chat. `chat` is a WebChat that has been started. Returns [{ name, ok, detail, fix, ms }]. */
export async function runHarness({ chat, replyMs = 90000, onResult = () => {} }) {
  const results = [];
  for (const s of SCENARIOS) {
    const t0 = Date.now();
    let r;
    try {
      const reply = String(await timeout(chat.send(s.prompt), replyMs, () => chat.abort?.()));
      r = s.check(reply);
    } catch (e) {
      r = { ok: false, threw: true, detail: e.message.split('\n')[0].slice(0, 160), fix: 'Check the browser window (a login, a check or a usage limit?), then run: eon doctor --report' };
    }
    const row = { name: s.name, ms: Date.now() - t0, ...r };
    results.push(row);
    onResult(row);
    // If the very first message cannot be sent or read, the rest cannot work either; do not make anyone wait for them.
    if (results.length === 1 && row.threw) {
      for (const rest of SCENARIOS.slice(1)) { const skipped = { name: rest.name, ms: 0, ok: false, skipped: true, detail: 'skipped: the first message did not work', fix: '' }; results.push(skipped); onResult(skipped); }
      break;
    }
  }
  return results;
}

export const formatRow = (r, paint = { green: (s) => s, red: (s) => s, dim: (s) => s }) =>
  `  ${r.ok ? paint.green('✓') : r.skipped ? paint.dim('–') : paint.red('✗')} ${r.name.padEnd(11)} ${paint.dim(`${(r.ms / 1000).toFixed(1)} s`.padStart(7))}  ${r.skipped ? paint.dim(r.detail) : r.detail}${r.ok || r.skipped ? '' : paint.dim(`\n      to fix it: ${r.fix}`)}`;

export function summary(site, results) {
  const failed = results.filter((r) => !r.ok && !r.skipped).length, skipped = results.filter((r) => r.skipped).length;
  return `${site}: ${results.filter((r) => r.ok).length} of ${results.length} scenarios passed${failed ? `, ${failed} failed` : ''}${skipped ? `, ${skipped} skipped` : ''}${failed || skipped ? '' : '. This site works with Eon.'}`;
}

/** A report you can paste: timings and counts, no text from the page. */
export function writeReport(dir, site, results) {
  const text = [`Eon harness report for ${site}`, `time: ${new Date().toISOString()}`, `node: ${process.versions.node}  platform: ${process.platform}`, '', ...results.map((r) => `${r.ok ? 'PASS' : r.skipped ? 'SKIP' : 'FAIL'}  ${r.name.padEnd(11)} ${(r.ms / 1000).toFixed(1)} s  ${r.detail}`), '', summary(site, results)].join('\n');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `harness-${site}.txt`);
  fs.writeFileSync(file, `${text}\n`);
  return file;
}
