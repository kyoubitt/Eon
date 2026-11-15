#!/usr/bin/env node
// Measures Eon's own overhead (not any model's speed): start-up time, the chat driver's time per message on the
// built-in fake pages, and the number of model messages a small fix needs at each level.
//   node tools/bench.mjs [path-to-another-eon-checkout]      writes docs/bench-data.json
// The fake pages answer instantly, so the numbers are the driver's waiting and polling, not a site's speed.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync, execSync } from 'node:child_process';
import { pathToFileURL, fileURLToPath } from 'node:url';

const here = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const root = path.resolve(process.argv[2] ?? here);
const label = process.argv[3] ?? 'current';
process.env.HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'eon-bench-'));
Object.assign(process.env, { EON_HEADLESS: '1', EON_BROWSER: 'playwright', EON_NO_UPDATE_CHECK: '1' });
const imp = (f) => import(pathToFileURL(path.join(root, f)).href);
const median = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];

// 1. start-up: `eon --help`, 15 runs
const starts = [];
for (let i = 0; i < (process.env.BENCH_QUICK ? 0 : 15); i++) { const t = process.hrtime.bigint(); spawnSync(process.execPath, [path.join(root, 'bin', 'eon.js'), '--help'], { stdio: 'ignore' }); starts.push(Number(process.hrtime.bigint() - t) / 1e6); }

// 2. the driver on the fake pages: per message, each site, 3 rounds of the five harness scenarios
const { startFakeChat, PROFILES } = await imp('support/fake-chat.js');
const { WebChat, closeBrowser } = await imp('src/providers/web-chat.js');
const { runHarness, standInReply } = await imp('src/harness.js');
const perSite = {};
for (const name of (process.env.BENCH_SITES ? process.env.BENCH_SITES.split(',') : Object.keys(PROFILES))) {
  const secs = [];
  for (let round = 0; round < Number(process.env.BENCH_ROUNDS ?? 3); round++) {
    const fake = await startFakeChat({ stream: true, ...PROFILES[name] }, (t) => standInReply(t));
    const ui = { print() {}, ask: async (q) => (/skip/i.test(q) ? 's' : ''), close() {} };
    const chat = new WebChat(name, { ui, minGapMs: 0, jitterMs: 0, stableMs: 400, firstLookMs: 4000, selectors: { url: fake.url } });
    try {
      await chat.newChat();
      const res = await runHarness({ chat, replyMs: 40000 });
      // the three short-message scenarios (send-read, code-block, follow-up) are the fair per-message figure
      for (const r of res) if (['send-read', 'code-block', 'edit-block', 'follow-up'].includes(r.name) && r.ok) secs.push(r.ms / 1000);
    } finally { await closeBrowser().catch(() => {}); await fake.close(); }
  }
  perSite[name] = { median: +median(secs).toFixed(2), worst: +Math.max(...secs).toFixed(2), n: secs.length };
  console.error(label, name, perSite[name]);
}

// 3. messages a small fix needs, per level (scripted model: the fewest messages the rules allow)
const { Runtime } = await imp('src/runtime.js');
const { MockProvider } = await imp('src/providers/mock.js');
const { ScriptedUI } = await imp('src/ui.js');
const block = (o) => `\`\`\`json\n${JSON.stringify(o)}\n\`\`\``;
const mkRepo = () => { const d = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'eon-bench-repo-'))); fs.writeFileSync(path.join(d, 'greet.js'), 'const name = "wrold";\nconsole.log("hello " + name);\n'); execSync('git init -q && git add -A && git -c user.name=b -c user.email=b@b commit -q -m start', { cwd: d }); return d; };
const plan = { action: 'plan', goal: 'Fix the name', claims: [{ id: 'c1', text: 'name is misspelled', tag: 'fact', pointer: 'greet.js:1' }], steps: [{ n: 1, text: 'Correct the spelling', files: ['greet.js'] }], validation: ['node greet.js'] };
const edit = (step) => ({ action: 'edit_file', ...(step ? { step } : {}), path: 'greet.js', find: '"wrold"', replace: '"world"' });
const count = async (level, mode, replies) => {
  const provider = new MockProvider(replies);
  const rt = new Runtime({ root: mkRepo(), provider, ui: new ScriptedUI(() => 'y'), mode, level, brief: false });
  const r = await rt.run('fix the typo in greet.js');
  return { level: `${level}${mode === 'accept' ? ' + accept' : ''}`, messages: provider.sent.length, status: r.status };
};
const messages = process.env.BENCH_QUICK ? [] : [
  await count('focused', 'guided', [block({ action: 'read_file', path: 'greet.js' }), block(plan), `${block(edit(1))}\n${block({ action: 'step_done', step: 1, summary: 'x' })}\n${block({ action: 'done', summary: 'fixed' })}`]),
  await count('quick', 'guided', [`${block(edit())}\n${block({ action: 'done', summary: 'fixed' })}`]),
  await count('quick', 'accept', [`${block(edit())}\n${block({ action: 'done', summary: 'fixed' })}`]),
];

fs.mkdirSync(path.join(here, 'docs'), { recursive: true });
const out = { label, node: process.versions.node, platform: `${process.platform} ${os.arch()}`, cpus: os.cpus().length, startupMs: starts.length ? { median: Math.round(median(starts)), best: Math.round(Math.min(...starts)) } : null, perSite, messages };
const file = path.join(here, 'docs', label === 'current' ? 'bench-data.json' : `bench-${label}.json`);
fs.writeFileSync(file, `${JSON.stringify(out, null, 2)}\n`);
console.error('wrote', file);
process.exit(0);
