// The chat driver and the whole agent, run through a real browser against a stand-in chat site.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { startFakeChat } from '../support/fake-chat.js';

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'eon-web-home-'));
process.env.HOME = home;
process.env.USERPROFILE = home; // Windows reads this, not HOME
process.env.EON_PACE = 'fast';
process.env.EON_BUDGET = '0'; // the message count has its own tests
process.env.EON_HEADLESS = '1';
process.env.EON_BROWSER = 'playwright';

let chromium = null;
try { chromium = createRequire(import.meta.url)('playwright').chromium; } catch { /* the tests skip */ }
const { WebChat, closeBrowser } = await import('../src/providers/web-chat.js');
const { Runtime } = await import('../src/runtime.js');
const { ScriptedUI } = await import('../src/ui.js');
const { extractActions } = await import('../src/protocol.js');
const { LimitError } = await import('../src/providers/limits.js');

const block = (obj) => `\`\`\`json\n${JSON.stringify(obj)}\n\`\`\``;

/** Run one test with a fake site and a chat pointed at it. */
function site(name, opts, reply, body, { ask } = {}) {
  test(name, { timeout: 90000 }, async (t) => {
    if (!chromium) return t.skip('Playwright is not installed here');
    const fake = await startFakeChat(opts, reply);
    const ui = new ScriptedUI(ask ?? (() => 'y'));
    const chat = new WebChat('deepseek', { ui, minGapMs: 0, jitterMs: 0, stableMs: 400, selectors: { url: fake.url, input: '.composer', message: '.reply', stop: '.generating' } });
    try { await chat.newChat(); await body({ chat, fake, ui, t }); } finally { await closeBrowser(); await fake.close(); }
  });
}

const DONE = `Looking.\n${block({ action: 'done', summary: 'x' })}`;

site('sends a message and reads the reply, code-block labels and all', {}, [DONE], async ({ chat, fake }) => {
  const reply = await chat.send('hello there');
  assert.deepEqual(fake.received, ['hello there']);
  assert.match(reply, /json\s+Copy\s+\{"action":"done"/);
  assert.deepEqual(extractActions(reply).map((a) => a.action), ['done']);
  // Eon does not disguise itself: the browser is launched without any flag meant to hide automation.
  const src = fs.readFileSync(path.resolve(import.meta.dirname, '..', 'src', 'providers', 'web-chat.js'), 'utf8');
  assert.doesNotMatch(src, /AutomationControlled|enable-automation/);
});

site('works with a rich-text (contenteditable) box too', { editable: true }, [DONE], async ({ chat, fake }) => {
  await chat.send('line one\nline two');
  assert.equal(fake.received.length, 1);
  assert.match(fake.received[0], /line one\s+line two/);
});

site('Enter does nothing on this site: the Send button is used', { enter: 'ignore' }, [DONE], async ({ chat, fake }) => {
  assert.match(await chat.send('use the button'), /action/);
  assert.deepEqual(fake.received, ['use the button']);
});

site('the Send button is disabled for a moment, then works', { enter: 'ignore', sendDelayMs: 1500 }, [DONE], async ({ chat, fake }) => {
  await chat.send('wait for the button');
  assert.equal(fake.received.length, 1);
});

site('a hidden text box ahead of the real one is skipped', { hiddenFirst: true }, [DONE], async ({ chat, fake }) => {
  await chat.send('not the decoy');
  assert.deepEqual(fake.received, ['not the decoy']);
});

site('a box that cuts the message short is detected, and the limit is lowered', { limit: 120 }, [DONE], async ({ chat, fake }) => {
  await assert.rejects(chat.send('x'.repeat(400)), /only took 120 of 400 characters[\s\S]*lowered its message limit/);
  assert.ok(chat.maxChars < 30000);
  assert.equal(fake.received.length, 0, 'nothing half-sent');
});

site('a message that never sends: the user is asked, a screenshot is saved, and skipping moves on', { never: true }, [], async ({ chat, ui }) => {
  const err = await chat.send('this will not go').catch((e) => e);
  assert.ok(err instanceof LimitError, String(err));
  assert.match(err.message, /did not send a message and you skipped it/);
  assert.match(ui.lines.join('\n'), /typed your message but DeepSeek did not send it[\s\S]*screenshot:/);
  const shots = fs.readdirSync(path.join(home, '.eon', 'debug'));
  assert.ok(shots.some((f) => f.endsWith('.png')));
}, { ask: (q) => (/did not send/.test(q) ? 's' : '') });

site('a reply that pauses inside an edit block is not cut off', { stream: true, stallAt: 70, stallMs: 2500 },
  ['Working on it.\nEDIT step=1 path=a.js\n<<<<<<< SEARCH\nold line here\n=======\nnew line here\n>>>>>>> REPLACE'], async ({ chat }) => {
    const reply = await chat.send('go');
    assert.match(reply, />>>>>>> REPLACE/);
    assert.deepEqual(extractActions(reply).map((a) => `${a.action}:${a.replace}`), ['edit_file:new line here']);
  });

test('a human check is detected and handed to the user', { timeout: 90000 }, async (t) => {
  if (!chromium) return t.skip('Playwright is not installed here');
  const fake = await startFakeChat({ challenge: true }, [DONE]);
  let chat;
  const ui = new ScriptedUI(async (q) => { if (/verify you are human/.test(q)) { await chat.page.click('#human'); return 'd'; } return 'y'; });
  chat = new WebChat('deepseek', { ui, minGapMs: 0, jitterMs: 0, stableMs: 400, selectors: { url: fake.url, input: '.composer', message: '.reply' } });
  try {
    await chat.newChat();
    assert.match(ui.lines.join('\n'), /wants you to verify you are human/);
    assert.match(await chat.send('after the check'), /action/);
  } finally { await closeBrowser(); await fake.close(); }
});

test('a whole guided task through a real browser: read, plan, approve, edit, verify, done', { timeout: 120000 }, async (t) => {
  if (!chromium) return t.skip('Playwright is not installed here');
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'eon-e2e-')));
  fs.writeFileSync(path.join(root, 'greet.js'), 'const name = "wrold";\r\nconsole.log("hello " + name);\r\n');
  execSync('git init -q && git add -A && git -c user.name=t -c user.email=t@t commit -q -m start', { cwd: root });
  const plan = {
    action: 'plan', goal: 'Fix the misspelled name',
    claims: [{ id: 'c1', text: 'name is misspelled on line 1', tag: 'fact', pointer: 'greet.js:1' }, { id: 'c2', text: 'the script then prints hello world', tag: 'assumption', check: 'node greet.js' }],
    steps: [{ n: 1, text: 'Correct the spelling', files: ['greet.js'] }], validation: ['node greet.js'],
  };
  const replies = [
    `I'll look at the file first.\n${block({ action: 'read_file', path: 'greet.js' })}`,
    `Here is the plan.\n${block(plan)}`,
    'Applying step 1.\n```\nEDIT step=1 path=greet.js\n<<<<<<< SEARCH\nconst name = "wrold";\n=======\nconst name = "world";\n>>>>>>> REPLACE\n```\n' + block({ action: 'run', cmd: 'node greet.js' }),
    `${block({ action: 'verify', claim: 'c2', run: 'r3', result: 'confirmed' })}\n${block({ action: 'step_done', step: 1, summary: 'fixed the spelling' })}\n${block({ action: 'done', summary: 'The greeting is fixed.' })}`,
  ];
  const fake = await startFakeChat({ stream: true }, replies);
  const chat = new WebChat('deepseek', { ui: new ScriptedUI(), minGapMs: 0, jitterMs: 0, stableMs: 400, selectors: { url: fake.url, input: '.composer', message: '.reply', stop: '.generating' } });
  const ui = new ScriptedUI(() => 'y');
  try {
    const result = await new Runtime({ root, provider: chat, ui }).run('Fix the greeting');
    assert.equal(result.status, 'done');
    assert.equal(fake.received.length, 4, 'one message per model turn');
    const fixed = execSync(`git show ${result.branch}:greet.js`, { cwd: root }).toString();
    assert.equal(fixed, 'const name = "world";\r\nconsole.log("hello " + name);\r\n', 'edited on disk, line endings kept');
    assert.match(fake.received[0], /You are the reasoning engine/);
    assert.match(fake.received[3], /exit 0\nhello world/);
  } finally { await closeBrowser(); await fake.close(); }
});

test('attach mode: your own browser is started as a normal window and Eon connects to it', { timeout: 90000 }, async (t) => {
  if (!chromium) return t.skip('Playwright is not installed here');
  const saved = { ...process.env };
  Object.assign(process.env, { EON_BROWSER: '', EON_CHROME_PATH: chromium.executablePath(), EON_CHROME_ARGS: '--headless=new --no-sandbox', EON_CDP_PORT: '9451' });
  const fake = await startFakeChat({}, [DONE]);
  const chat = new WebChat('deepseek', { ui: new ScriptedUI(), minGapMs: 0, jitterMs: 0, stableMs: 400, selectors: { url: fake.url, input: '.composer', message: '.reply' } });
  try {
    await chat.newChat();
    assert.match(await chat.send('via attach'), /action/);
    assert.equal(await chat.page.evaluate(() => navigator.webdriver), false);
    const version = await (await fetch('http://127.0.0.1:9451/json/version')).json();
    assert.match(version.Browser, /Chrome|Chromium|Headless/i, 'a browser Eon did not launch through Playwright');
  } finally {
    await closeBrowser(); await fake.close();
    try { execSync('pkill -f "remote-debugging-port=9451"'); } catch { /* already gone */ }
    for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
    Object.assign(process.env, saved);
  }
});

test('eon check: the three stages run against a site, ending with a file the model asked for', { timeout: 120000 }, async (t) => {
  if (!chromium) return t.skip('Playwright is not installed here');
  const { runChecks } = await import('../src/selftest.js');
  const replies = ['pong', 'Creating it.\n```\nWRITE path=hello.txt\n<<<<<<< FILE\nhi from eon\n>>>>>>> END\n```', block({ action: 'done', summary: 'made hello.txt' })];
  const fake = await startFakeChat({}, replies);
  fs.mkdirSync(path.join(home, '.eon'), { recursive: true });
  fs.writeFileSync(path.join(home, '.eon', 'selectors.json'), JSON.stringify({ deepseek: { url: fake.url, input: '.composer', message: '.reply' } }));
  try {
    const stages = await runChecks('deepseek', new ScriptedUI(), { WebChat: class extends WebChat { constructor(site, o) { super(site, { ...o, stableMs: 400 }); } }, edit: true });
    assert.deepEqual(stages.map((s) => s.ok), [true, true, true], JSON.stringify(stages));
    assert.match(stages[2].text, /file edit: the model asked, Eon wrote hello\.txt \(2 messages, 0 re-prompts\)/);
    assert.equal(fake.received.length, 3);
  } finally { await closeBrowser(); await fake.close(); fs.rmSync(path.join(home, '.eon', 'selectors.json')); }
});

const { PROFILES } = await import('../support/fake-chat.js');
const learned = () => { try { return JSON.parse(fs.readFileSync(path.join(home, '.eon', 'selectors.json'), 'utf8')); } catch { return {}; } };

test('self-discovery: wrong selectors, no labels, a Send that is not a button, a decoy attach button', { timeout: 90000 }, async (t) => {
  if (!chromium) return t.skip('Playwright is not installed here');
  fs.rmSync(path.join(home, '.eon', 'selectors.json'), { force: true });
  const fake = await startFakeChat({ enter: 'ignore', dom: { inputClass: 'msg-7x', inputAttrs: 'placeholder="Ask anything"', sendTag: 'div', sendAttrs: 'class="go"', sendHtml: '<svg width="16" height="16"><path d="M2 8h12"/></svg>', decoy: true, replyClass: 'answer-body' } }, [DONE]);
  const ui = new ScriptedUI();
  const chat = new WebChat('deepseek', { ui, minGapMs: 0, jitterMs: 0, stableMs: 400, firstLookMs: 3000, selectors: { url: fake.url, input: ['textarea#nope'], message: ['.nope'], stop: ['.nope'] } });
  try {
    await chat.newChat();
    const reply = await chat.send('find everything yourself');
    assert.deepEqual(fake.received, ['find everything yourself'], 'the message went through the real Send control, not the attach decoy');
    assert.match(reply, /action/);
    const saved = learned().deepseek;
    assert.match(saved.input, /textarea\[placeholder="Ask anything"\]/);
    assert.match(saved.message, /^div\.answer-body/);
    assert.match(ui.lines.join('\n'), /found the DeepSeek message box[\s\S]*found where DeepSeek writes its replies/);
  } finally { await closeBrowser(); await fake.close(); }
});

site('a thinking block comes first: its text is not used and the answer is waited for', { thinking: true, thinkMs: 2500 }, [DONE], async ({ chat }) => {
  const reply = await chat.send('think first');
  assert.ok(!/Thinking about it|rm -rf/.test(reply), `the thinking text leaked into the reply: ${reply}`);
  assert.deepEqual(extractActions(reply).map((a) => a.action), ['done']);
});

site('a controlled (React-style) box keeps what was put in it', { controlled: true }, [DONE], async ({ chat, fake }) => {
  await chat.send('survives a controlled box');
  assert.deepEqual(fake.received, ['survives a controlled box']);
});

for (const [name, profile] of Object.entries(PROFILES)) {
  test(`built-in profile: ${name} works end to end on a page of its kind`, { timeout: 90000 }, async (t) => {
    if (!chromium) return t.skip('Playwright is not installed here');
    fs.rmSync(path.join(home, '.eon', 'selectors.json'), { force: true });
    const fake = await startFakeChat({ stream: true, ...profile }, [DONE]);
    const chat = new WebChat(name, { ui: new ScriptedUI(), minGapMs: 0, jitterMs: 0, stableMs: 400, firstLookMs: 4000, selectors: { url: fake.url } });
    try {
      await chat.newChat();
      const reply = await chat.send(`hello ${name}`);
      assert.deepEqual(fake.received, [`hello ${name}`]);
      assert.deepEqual(extractActions(reply).map((a) => a.action), ['done']);
    } finally { await closeBrowser(); await fake.close(); }
  });
}

// ---- round: real-use fixes ----

test('a logged-out page: Eon says so, and carries on by itself when you log in (no key press)', { timeout: 90000 }, async (t) => {
  if (!chromium) return t.skip('Playwright is not installed here');
  const fake = await startFakeChat({ login: 2500 }, [DONE]);
  const ui = new ScriptedUI(() => new Promise(() => {})); // the person never presses anything
  const chat = new WebChat('deepseek', { ui, minGapMs: 0, jitterMs: 0, stableMs: 400, selectors: { url: fake.url, input: '.composer', message: '.reply' } });
  try {
    await chat.newChat();
    const reply = await chat.send('hello after login');
    assert.match(ui.lines.join('\n'), /You are logged out of DeepSeek/);
    assert.match(ui.lines.join('\n'), /carried on by itself/);
    assert.match(reply, /action/);
    assert.deepEqual(fake.received, ['hello after login']);
  } finally { await closeBrowser(); await fake.close(); }
});

test('a human check that you solve in the browser: Eon notices and carries on by itself', { timeout: 90000 }, async (t) => {
  if (!chromium) return t.skip('Playwright is not installed here');
  const fake = await startFakeChat({ challenge: true }, [DONE]);
  const ui = new ScriptedUI(() => new Promise(() => {}));
  const chat = new WebChat('deepseek', { ui, minGapMs: 0, jitterMs: 0, stableMs: 400, selectors: { url: fake.url, input: '.composer', message: '.reply' } });
  try {
    setTimeout(() => chat.page.click('#human').catch(() => {}), 2500); // the person solves it; nobody presses a key in Eon
    await chat.newChat();
    assert.match(await chat.send('after the check'), /action/);
    assert.match(ui.lines.join('\n'), /Solve the check there; Eon carries on by itself/);
  } finally { await closeBrowser(); await fake.close(); }
});

test('skipping a check with only one model ends the run cleanly instead of waiting', { timeout: 90000 }, async (t) => {
  if (!chromium) return t.skip('Playwright is not installed here');
  const fake = await startFakeChat({ challenge: true }, [DONE]);
  const ui = new ScriptedUI((q) => (/verify you are human/.test(q) ? 's' : 'y'));
  const chat = new WebChat('deepseek', { ui, minGapMs: 0, jitterMs: 0, stableMs: 400, selectors: { url: fake.url, input: '.composer', message: '.reply' } });
  const { ModelPool } = await import('../src/providers/limits.js');
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'eon-skip-')));
  let slept = 0;
  try {
    const result = await new Runtime({ root, provider: new ModelPool([chat]), ui, mode: 'research', sleep: async () => { slept++; } }).run('look around');
    assert.equal(result.status, 'skipped');
    assert.equal(slept, 0);
    assert.doesNotMatch(ui.lines.join('\n'), /at its limit|wait 10 minutes/);
    assert.match(ui.lines.join('\n'), /you skipped it/);
  } finally { await closeBrowser(); await fake.close(); }
});

test('Esc while Eon waits for a slow reply stops it within a second or two', { timeout: 90000 }, async (t) => {
  if (!chromium) return t.skip('Playwright is not installed here');
  const fake = await startFakeChat({ never: true }, [DONE]); // a page that never sends
  const ui = new ScriptedUI((q) => (/did not send|keep waiting/i.test(q) ? 'k' : 'y'));
  const chat = new WebChat('deepseek', { ui, minGapMs: 0, jitterMs: 0, stableMs: 400, firstLookMs: 60000, selectors: { url: fake.url, input: '.composer', message: '.reply' } });
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'eon-esc-')));
  try {
    const rt = new Runtime({ root, provider: chat, ui, mode: 'research' });
    await chat.newChat();
    setTimeout(() => rt.interrupt(), 3000);
    const started = Date.now();
    const result = await rt.run('look around');
    assert.equal(result.status, 'interrupted');
    assert.ok(Date.now() - started < 15000, `took ${Date.now() - started} ms`);
  } finally { await closeBrowser(); await fake.close(); }
});

test('eon inspect writes the chat area structure with no page text and no sidebar contents', { timeout: 90000 }, async (t) => {
  if (!chromium) return t.skip('Playwright is not installed here');
  const { runInspect } = await import('../src/inspect.js');
  const fake = await startFakeChat({ sidebar: true, thinking: true, thinkMs: 300 }, ['The answer is 42, my secret reply text.']);
  const ui = new ScriptedUI(() => 'y');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'eon-inspect-'));
  try {
    const { file, text, found } = await runInspect('deepseek', ui, { WebChat, dir, selectors: { url: fake.url, input: '.composer', message: ['.reply', '.think'], stop: '.generating' } });
    assert.ok(fs.existsSync(file));
    assert.ok(found.input && found.reply >= 1);
    assert.match(text, /textarea\.composer.*<== INPUT/);
    assert.match(text, /<== REPLY/);
    assert.match(text, /<== .*THINKING/);
    assert.match(text, /aside\.sidebar/, 'the sidebar is named but not opened');
    assert.match(text, /not opened/);
    for (const secret of ['PRIVATE-CHAT', 'tax return', 'secret reply text', 'Eon is checking', '9876543210']) assert.doesNotMatch(text, new RegExp(secret), `leaked: ${secret}`);
  } finally { await closeBrowser(); await fake.close(); }
});

test('a picture is uploaded through the page\'s hidden file box, with the message; DeepSeek refuses it plainly', { timeout: 90000 }, async (t) => {
  if (!chromium) return t.skip('Playwright is not installed here');
  const png = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'eon-img-')), 'shot.png');
  fs.writeFileSync(png, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64'));
  let bareServer = null;
  const fake = await startFakeChat({ fileInput: true }, [DONE, DONE]);
  const sel = { url: fake.url, input: '.composer', message: '.reply', stop: '.generating' };
  try {
    // A site that can see pictures (the profile says so).
    const seer = new WebChat('deepseek', { ui: new ScriptedUI(), minGapMs: 0, jitterMs: 0, stableMs: 400, selectors: { ...sel, images: true } });
    await seer.newChat();
    assert.equal(seer.vision, true);
    await seer.send('what is in this?', { images: [png] });
    assert.deepEqual(fake.received, ['what is in this?']);
    assert.deepEqual(fake.uploads, [{ name: 'shot.png', bytes: 70 }]);
    // DeepSeek's own profile cannot see pictures.
    const blind = new WebChat('deepseek', { ui: new ScriptedUI(), minGapMs: 0, jitterMs: 0, stableMs: 400, selectors: sel });
    assert.equal(blind.vision, false);
    await assert.rejects(blind.send('x', { images: [png] }), /cannot see pictures[\s\S]*\/model vision/);
    assert.equal(fake.uploads.length, 1, 'nothing more was uploaded');
    // A page with no file box says so.
    const bare = await startFakeChat({}, [DONE]);
    const c2 = new WebChat('deepseek', { ui: new ScriptedUI(), minGapMs: 0, jitterMs: 0, stableMs: 400, selectors: { ...sel, url: bare.url, images: true } });
    await c2.newChat();
    await assert.rejects(c2.send('x', { images: [png] }), /no file upload box/);
    bareServer = bare;
  } finally { await closeBrowser(); await fake.close(); await bareServer?.close(); }
});

test('rewrite through a real browser: the restated task is sent first, shown, accepted, and the run finishes', { timeout: 120000 }, async (t) => {
  if (!chromium) return t.skip('Playwright is not installed here');
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'eon-rw-')));
  fs.writeFileSync(path.join(root, 'greet.js'), 'const name = "wrold";\nconsole.log("hello " + name);\n');
  execSync('git init -q && git add -A && git -c user.name=t -c user.email=t@t commit -q -m start', { cwd: root });
  const restated = 'GOAL: Correct the misspelled name in greet.js.\nSCOPE: greet.js only.\nDONE WHEN: node greet.js prints hello world.\nASK FIRST: nothing';
  const fake = await startFakeChat({ stream: true }, [restated, `Done.\n${block({ action: 'done', summary: 'looked' })}`]);
  const chat = new WebChat('deepseek', { ui: new ScriptedUI(), minGapMs: 0, jitterMs: 0, stableMs: 400, selectors: { url: fake.url, input: '.composer', message: '.reply', stop: '.generating' } });
  const ui = new ScriptedUI(() => '');
  try {
    const result = await new Runtime({ root, provider: chat, ui, mode: 'research', rewrite: true }).run('fix the wrold typo in greet.js');
    assert.equal(result.status, 'done');
    assert.equal(fake.received.length, 2, 'one rewrite message, then the seed');
    assert.match(fake.received[0], /^Before we start, restate this short request[\s\S]*REQUEST: fix the wrold typo/);
    assert.match(fake.received[1], /GOAL: Correct the misspelled name in greet\.js\.[\s\S]*The user's own words were/);
    assert.match(ui.lines.join('\n'), /Eon understood your request as:[\s\S]*GOAL: Correct the misspelled name/);
  } finally { await closeBrowser(); await fake.close(); }
});

// ---- harness ----

const { runHarness, standInReply, writeReport, formatRow, summary, SCENARIOS } = await import('../src/harness.js');

async function harnessOn(name, { broken = null, extra = {}, replyMs = 30000 } = {}) {
  const fake = await startFakeChat({ stream: true, ...PROFILES[name], ...extra }, (text) => standInReply(text, broken));
  const quiet = new ScriptedUI((q) => (/skip/i.test(q) ? 's' : ''));
  const chat = new WebChat(name, { ui: quiet, minGapMs: 0, jitterMs: 0, stableMs: 400, firstLookMs: 4000, selectors: { url: fake.url } });
  try { await chat.newChat(); return await runHarness({ chat, replyMs }); } finally { await closeBrowser(); await fake.close(); }
}

for (const name of Object.keys(PROFILES)) {
  test(`harness: all five scenarios pass on the ${name} stand-in`, { timeout: 150000 }, async (t) => {
    if (!chromium) return t.skip('Playwright is not installed here');
    fs.rmSync(path.join(home, '.eon', 'selectors.json'), { force: true });
    const results = await harnessOn(name);
    assert.deepEqual(results.map((r) => r.name), SCENARIOS.map((s) => s.name));
    assert.deepEqual(results.filter((r) => !r.ok).map((r) => `${r.name}: ${r.detail}`), []);
  });
}

test('harness: a site that cuts replies, rewrites code or repeats itself fails the right line with a plain fix', { timeout: 200000 }, async (t) => {
  if (!chromium) return t.skip('Playwright is not installed here');
  const by = (rs) => Object.fromEntries(rs.map((r) => [r.name, r]));
  let r = by(await harnessOn('deepseek', { broken: 'truncate' }));
  assert.equal(r['long-reply'].ok, false);
  assert.match(r['long-reply'].detail, /cut short: read 250 lines, last number 250 of 400/);
  assert.match(r['long-reply'].fix, /finished too early/);
  assert.equal(r['send-read'].ok, true, 'the other lines are not affected');
  r = by(await harnessOn('deepseek', { broken: 'mangle' }));
  assert.equal(r['edit-block'].ok, false);
  assert.match(r['edit-block'].detail, /tabs or quotes inside it were changed|no edit was found/);
  r = by(await harnessOn('deepseek', { broken: 'repeat' }));
  assert.equal(r['follow-up'].ok, false);
  assert.match(r['follow-up'].detail, /read the first reply again/);
  assert.match(formatRow(r['follow-up']), /✗ follow-up[\s\S]*to fix it: Eon cannot tell the new reply from the old ones/);
});

test('harness: a page that never takes the message fails clearly and quickly, and the report holds no page text', { timeout: 200000 }, async (t) => {
  if (!chromium) return t.skip('Playwright is not installed here');
  const results = await harnessOn('deepseek', { extra: { never: true }, replyMs: 60000 });
  assert.equal(results[0].ok, false);
  assert.match(results[0].detail, /skipped|did not send|no reply/i);
  assert.match(results[0].fix, /doctor --report/);
  assert.equal(results.length, 5);
  assert.ok(results.slice(1).every((r) => r.skipped && /first message did not work/.test(r.detail)), 'the rest are skipped, not waited for');
  assert.match(formatRow(results[1]), /– long-reply/);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'eon-harness-'));
  const file = writeReport(dir, 'deepseek', [{ name: 'send-read', ok: true, ms: 1234, detail: 'a message went out and its reply was read' }, { name: 'follow-up', ok: false, ms: 5000, detail: 'the new reply was not found', fix: 'x' }]);
  const text = fs.readFileSync(file, 'utf8');
  assert.match(text, /PASS {2}send-read {3}1\.2 s/);
  assert.match(text, /FAIL {2}follow-up/);
  assert.match(text, /deepseek: 1 of 2 scenarios passed, 1 failed/);
  assert.doesNotMatch(text, /harness-ok|"action"|<<<<<<</, 'no page text, only counts and timings');
  assert.match(summary('x', [{ ok: true }]), /This site works with Eon/);
});

test('a suspension notice stops Eon at once: nothing is sent, and the site is left alone for the rest of the run', { timeout: 90000 }, async (t) => {
  if (!chromium) return t.skip('Playwright is not installed here');
  const fake = await startFakeChat({ suspended: true }, [DONE]);
  const ui = new ScriptedUI(() => 'y');
  const chat = new WebChat('deepseek', { ui, minGapMs: 0, jitterMs: 0, stableMs: 400, selectors: { url: fake.url, input: '.composer', message: '.reply' } });
  const { LimitError } = await import('../src/providers/limits.js');
  try {
    await assert.rejects(async () => { await chat.newChat(); await chat.send('hello'); }, (e) => e instanceof LimitError && e.kind === 'blocked' && /suspended/i.test(e.message));
    await assert.rejects(() => chat.send('again'), (e) => e instanceof LimitError && e.kind === 'blocked' && /nothing more is sent/.test(e.message));
    assert.equal(fake.received.length, 0, 'not one message reached the site');
  } finally { await closeBrowser(); await fake.close(); }
});

test('a human check that keeps coming back is not retried forever', { timeout: 90000 }, async (t) => {
  if (!chromium) return t.skip('Playwright is not installed here');
  const fake = await startFakeChat({ challenge: true }, [DONE]);
  let asked = 0;
  const ui = new ScriptedUI(() => { asked++; return 'd'; }); // says done, but never solves it
  const chat = new WebChat('deepseek', { ui, minGapMs: 0, jitterMs: 0, stableMs: 400, selectors: { url: fake.url, input: '.composer', message: '.reply' } });
  const { LimitError } = await import('../src/providers/limits.js');
  try {
    await assert.rejects(async () => { await chat.newChat(); await chat.send('hi'); }, (e) => e instanceof LimitError && e.kind === 'skipped' && /keeps asking/.test(e.message));
    assert.ok(asked <= 2, `asked ${asked} times`);
  } finally { await closeBrowser(); await fake.close(); }
});
