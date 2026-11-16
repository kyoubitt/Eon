#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { Runtime, MODES, LEVELS, LIVE_MODES } from '../src/runtime.js';
import { TerminalUI, color } from '../src/ui.js';
import { CLI, isCommand } from '../src/cli.js';
import { ApiProvider } from '../src/providers/api.js';
import { MockProvider } from '../src/providers/mock.js';
import { WebChat, closeBrowser, sites, profileExists } from '../src/providers/web-chat.js';
import { ModelPool } from '../src/providers/limits.js';
import { killRunning, runCommand, redact } from '../src/tools.js';
import { readConfig, writeConfig, listAllow, addAllow, removeAllow } from '../src/settings.js';
import { todayCounts, budgetFor } from '../src/budget.js';
import { waitMinutes, markRun } from '../src/cooldown.js';
import { newBisect, trial, record, roundsLeft, loadBisect, saveBisect, clearBisect } from '../src/bisect.js';
import { FEATURES, SUSPECTS, resolveFeatures, setFeature, safeFeatures, applyFeatures } from '../src/features.js';
import { memoryFiles, loadMemory, appendMemory } from '../src/memory.js';
import { detectOllama, setupLocal } from '../src/local.js';
import { expandMentions } from '../src/mentions.js';
import { diffReviewPrompt, parseReview } from '../src/protocol.js';
import { readStores, teach, forget } from '../src/store.js';
import { checkImage } from '../src/vision.js';
import { McpHub, McpServer, PRESETS, addMcpServer, removeMcpServer } from '../src/mcp.js';
import { loadAgents } from '../src/agents.js';
import { loadSkills, newSkill } from '../src/skills.js';
import { runHarness, formatRow, summary, writeReport, standInReply } from '../src/harness.js';
import { runFix } from '../src/fix.js';
import { exportSession } from '../src/export.js';
import { checkForUpdate, runUpdate, currentVersion } from '../src/update.js';
import { firstRunChecks, formatChecks, firstRunDone, markFirstRun } from '../src/firstrun.js';
import { runInspect } from '../src/inspect.js';
import { showSplash } from '../src/splash.js';
import { simpleDiff } from '../src/backup.js';
import { ensureRepo, mergeBranch, discardBranch, listFiles } from '../src/git.js';
import { listSessions, findSession, loadSession, replay, interruptedSession, setSessionStatus } from '../src/sessions.js';
import { confidence } from '../src/ledger.js';
import { teachSite } from '../src/teach.js';
import { migrateHome } from '../src/migrate.js';
import { runChecks } from '../src/selftest.js';
import { doctorReport, lastErrorFile } from '../src/doctor.js';
import { explainError } from '../src/errors.js';
import { instructionsTemplate } from '../src/project.js';
import { buildPr } from '../src/pr.js';

migrateHome();
const EON_HOME = path.join(os.homedir(), '.eon');
const VERSION = (() => { try { return JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version; } catch { return ''; } })();
const readJson = (name, fallback) => { try { return JSON.parse(fs.readFileSync(path.join(EON_HOME, name), 'utf8')); } catch { return fallback; } };
const writeJson = (name, value) => { try { fs.mkdirSync(EON_HOME, { recursive: true }); fs.writeFileSync(path.join(EON_HOME, name), JSON.stringify(value, null, 2)); } catch { /* settings are a convenience */ } };

const SHORT_HELP = `eon: a coding agent that runs on free web chats. It plans before it edits.

Start
  eon                       open Eon in this folder
  eon "fix the login bug"   start with a task
  eon -r                    go back to a past session
  eon login                 log in to DeepSeek once (a browser window opens)
  eon check                 test that it works end to end

Handy
  eon --fast                small jobs with fewer round trips
  eon --model deepseek,qwen   fall back to the next model at a usage limit
  eon update                get the newest version
  eon doctor --fix          repair common problems
  eon doctor --report       a text file to paste when asking for help

Inside Eon type /help. Everything else: eon --help --all   or the guide: docs/guide.md`;

const HELP = `eon - a coding agent on free web chats (no API key), with an enforced plan gate

Usage
  eon                            start a session in this folder
  eon "<task>"                   start a session with a first task
  eon -r [number|id]             resume a past session (pick from a list, or name one)
  eon -c                         continue the most recent session
  eon -p "<task>"                one task, plain output, then exit (also: --plain)
  eon login [site]               log in to a chat site once, in the browser window that opens
  eon sites                      list the chat sites Eon knows
  eon check <site> [--no-edit]   test a site end to end: send, read the reply, and make a file edit
  eon teach <site>               click on a site's message box and reply to show Eon where they are
  eon setup-local                use a model on your own computer (Ollama) instead of a website
  eon inspect <site>             write ~/.eon/inspect-<site>.txt: the page's structure, no text, to paste for help
  eon mcp list|add|remove|test   connect MCP servers (tools the model can use after you allow them)
  eon harness [site]             test a chat site with five short scenarios; prints pass/fail and a report to paste
  eon export [number|id]         save a past session as a markdown report
  eon update                     update Eon to the latest version
  eon first-run [site]           check this computer: Node, git, browser, login, folder
  eon doctor --fix [--yes]       repair stale locks, damaged settings, a missing browser
  eon doctor [--report]          check this machine; --report writes a text file you can paste to ask for help

Models (all free web chats; no API key)
  --model <list>           the model for planning and building, e.g. --model deepseek
                           a comma list is a fallback chain: when one hits its usage limit the next takes over,
                           e.g. --model deepseek,qwen,chatgpt
  --plan-model <list>      a different model for investigating and planning
  --build-model <list>     a different model for carrying out an approved plan
  --reviewer <list>|none   who reviews plans (default at architect level: a site other than the planner)
  --research-model <list>  who answers documentation questions (default: the planner's site, in its own chat)
  Also: "api" for any OpenAI-compatible endpoint (set EON_API_MODEL, and EON_API_BASE, EON_API_KEY)

Options
  --mode guided|accept|research|autonomous   (or --permission-mode default|acceptEdits|plan)
        guided      plan, you approve, it edits on a git branch (default)
        accept      you approve the plan, then its edits go in without asking
        research    read-only, ends with a plan
        autonomous  works alone in a worktree; allowlisted commands only; stops after 3 replans
  --level focused|quick|architect
        focused     every edit needs an approved plan (default)
        quick       edits under 20 lines in one file skip the plan
        architect   bigger plans with an impact table, reviewed by a second model
  --allow "<cmd>"       a command that may run without asking, e.g. --allow "npm test" (repeatable)
  --allow-host <host>   a documentation site that may be fetched without asking (repeatable)
  --in-place            use a new branch in this checkout instead of a worktree
  --rewrite             the model restates each request as a precise task first (one extra message)
  --no-brief            do not expand short requests (skill, likely files, check command)
  --fast                quick level + accept mode: fewer round trips for small jobs
  --stdin               add text piped into eon to the task, e.g. git diff | eon -p "review this" --stdin
  --no-splash           skip the intro screen (or: /config splash off)
  --pace slow           add human-like pauses between steps (default: none; messages are pasted at once)
  --output-format json  with -p: print one JSON result (needs --mode autonomous or research)
  --script, --review-script, --research-script <file.json>   scripted replies for the "mock" model (demos)
`;

// [command, what it does]. A trailing space means the command takes an argument.
const COMMANDS = [
  ['/help', 'list the commands'], ['/new', 'fresh session: new chat, new branch'],
  ['/resume', 'go back to a past session'], ['/plan', 'show the current plan and its progress'],
  ['/diff', 'what this session changed on its branch'], ['/merge', 'keep this session\'s work: merge its branch'],
  ['/undo', 'take back the last committed step'], ['/discard', 'throw this session\'s work away'],
  ['/mode ', 'guided | accept | research | autonomous'], ['/level ', 'focused | quick | architect'],
  ['/models', 'who plans, builds, reviews; who is resting'], ['/model ', 'e.g. /model deepseek,qwen   or   /model build gemini'],
  ['/memory', 'memory files, lessons and mistakes (/memory edit)'], ['/compact', 'summarise the chat and start a fresh one'], ['/context', 'what is using up the chat'],
  ['/permissions', 'commands you always allow here'], ['/config', 'saved settings'], ['/review', 'a second model reviews this session\'s changes'], ['/learn ', 'teach a rule: /learn When X, check Y first.'], ['/forget ', 'delete a lesson or research entry by id'],
  ['/research', 'saved documentation digests'], ['/notes', 'project notes given to every task'],
  ['/allow ', 'allow a command without asking'], ['/allow-host ', 'allow a documentation site'],
  ['/project ', 'switch to another folder'], ['/status', 'mode, models, branch and plan state'],
  ['/output', 'show the full output of the last command'], ['/init', 'create EON.md with this project\'s commands and conventions'], ['/pr', 'a pull-request description for this session'],
  ['/usage', 'estimated tokens used, per model'], ['/raw', 'the last message Eon sent and the model\'s raw reply'],
  ['/skills', 'recipes the model can follow: /skills new <name>'], ['/export', 'save this session as a markdown report'], ['/check', 'check this computer and the chat site'], ['/image ', 'attach a picture to your next message'], ['/mcp', 'MCP servers you connected, and the tools you always allow'], ['/agents', 'sub-agents defined in .eon/agents'],
  ['/bell', 'toggle the sound when Eon needs you'], ['/quit', 'leave Eon'],
];
const ESSENTIAL = ['/plan', '/diff', '/undo', '/merge', '/discard', '/mode ', '/model ', '/resume', '/new', '/skills', '/help'];
// The slash menu lists the everyday commands first.
COMMANDS.sort((a, b) => (ESSENTIAL.includes(a[0]) ? ESSENTIAL.indexOf(a[0]) : 99) - (ESSENTIAL.includes(b[0]) ? ESSENTIAL.indexOf(b[0]) : 99));
const helpText = (all = false) => {
  const rows = all ? COMMANDS : COMMANDS.filter(([c]) => ESSENTIAL.includes(c));
  const more = all ? '' : `\n  ${color.dim('/help all'.padEnd(14))} ${color.dim('every command')}`;
  return `${color.bold(all ? 'All commands' : 'Commands')}\n${rows.map(([c, d]) => `  ${c.trim().padEnd(14)} ${d}`).join('\n')}${more}\n\n${color.dim('Type a task to start, or @file to attach a file, # to save a note, ! to run a command. Esc stops, Ctrl+C twice leaves.')}`;
};

function parse(argv) {
  const cfg = readConfig();
  const opts = { mode: cfg.mode ?? 'guided', level: cfg.level ?? 'focused', model: cfg.model ?? 'deepseek', planModel: cfg.planModel, buildModel: cfg.buildModel, visionModel: cfg.visionModel, reviewer: cfg.reviewer, inPlace: false, plain: false, resume: undefined, cont: false, allow: [], allowHost: [], words: [] };
  const valued = ['--mode', '--level', '--provider', '--model', '--plan-model', '--build-model', '--research-model', '--vision-model', '--script', '--reviewer', '--review-script', '--research-script', '--allow', '--allow-host', '--pace', '--output-format', '--permission-mode'];
  // eon mcp add files npx -y some-server: everything after "mcp" belongs to the server command.
  if (argv[0] === 'mcp') { opts.words = argv; return opts; }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--in-place') opts.inPlace = true;
    else if (a === '--no-edit') opts.noEdit = true;
    else if (a === '--no-splash') opts.noSplash = true;
    else if (a === '--stdin') opts.stdin = true;
    else if (a === '--report') opts.report = true;
    else if (a === '--fix') opts.fix = true;
    else if (a === '--stand-in') opts.standIn = true;
    else if (a === '--again') opts.again = true;
    else if (a === '--fast') opts.fast = true;
    else if (a === '--no-brief') opts.noBrief = true;
    else if (a === '--rewrite') opts.rewrite = true;
    else if (a === '--yes') opts.yes = true;
    else if (a === '--plain' || a === '-p') opts.plain = true;
    else if (a === '--continue' || a === '-c') opts.cont = true;
    else if (a === '--resume' || a === '-r') opts.resume = /^(\d{1,3}|\d{14}-\S*)$/.test(argv[i + 1] ?? '') ? argv[++i] : '';
    else if (a === '--help' || a === '-h') opts.help = true;
    else if (a === '--version' || a === '-v') opts.version = true;
    else if (a === '--all') opts.all = true;
    else if (valued.includes(a)) {
      if (argv[i + 1] === undefined) throw new Error(`${a} needs a value`);
      const key = a.slice(2).replace(/-(.)/g, (_, c) => c.toUpperCase());
      if (key === 'allow' || key === 'allowHost') opts[key].push(argv[++i].trim());
      else if (key === 'permissionMode') {
        const v = argv[++i];
        opts.mode = { default: 'guided', acceptEdits: 'accept', plan: 'research' }[v] ?? v;
      }
      else opts[key === 'provider' ? 'model' : key] = argv[++i];
    } else if (a.startsWith('-') && a.length > 1) throw new Error(`unknown option ${a}`);
    else opts.words.push(a);
  }
  // --fast: fewer round trips for small jobs (small edits skip the plan; you approve the plan once if one is made, edits go in).
  if (opts.fast) { opts.level = 'quick'; if (opts.mode === 'guided') opts.mode = 'accept'; }
  if (opts.pace) process.env.EON_PACE = opts.pace;
  if (!process.env.EON_PACE && !resolveFeatures().lean) process.env.EON_PACE = 'slow';
  if (!MODES.includes(opts.mode)) throw new Error(`unknown mode "${opts.mode}" (use ${MODES.join(', ')})`);
  if (!LEVELS.includes(opts.level)) throw new Error(`unknown level "${opts.level}" (use ${LEVELS.join(', ')})`);
  return opts;
}

function makeOne(raw, ui, script) {
  const name = raw.replace(/-web$/, '');
  if (name === 'mock') {
    if (!script) throw new Error('the mock model needs a script file (--script, --review-script or --research-script)');
    return new MockProvider(JSON.parse(fs.readFileSync(script, 'utf8')));
  }
  if (name === 'api') return new ApiProvider();
  if (sites()[name]) return new WebChat(name, { ui });
  throw new Error(`unknown model "${raw}". Choose from: ${Object.keys(sites()).join(', ')}, api`);
}

/** "deepseek,qwen" becomes a pool that falls back from the first to the second on a usage limit. */
function makePool(spec, ui, script, role) {
  const members = String(spec).split(',').map((x) => x.trim()).filter(Boolean).map((n) => makeOne(n, ui, script));
  if (role) for (const m of members) m.name = `${m.name} (${role})`;
  return new ModelPool(members);
}
const firstOf = (spec) => String(spec).split(',')[0].trim().replace(/-web$/, '');

/** Open the chat site in the browser and wait while the user logs in. */
async function loginSite(site, ui) {
  const chat = new WebChat(site, { ui });
  await chat.start();
  await chat.page.goto(chat.sel.url);
  ui.print?.(`A note before you log in: scripted use of a free chat can go against that site's terms, and a site may suspend an account it sees as automated. Use an account you can afford to lose, keep tests few, and stop at any check or warning.`);
  await ui.ask(`Log in to ${chat.sel.label} in the browser window. When you can see the chat, press Enter here. `);
  ui.print?.('Login saved. Your browser keeps it for next time. You can close the browser window now; Eon opens it again when needed.');
}

async function siteCommands(first, rest, opts) {
  const ui = new TerminalUI();
  if (first === 'sites') {
    for (const [name, x] of Object.entries(sites())) console.log(`${name.padEnd(10)} ${x.label.padEnd(10)} ${x.url}`);
    console.log('\nAdd your own in ~/.eon/sites.json. Test one with: eon check <site>');
    return;
  }
  if (first === 'setup-local') {
    try {
      const got = await setupLocal((q) => ui.ask(q), (t) => console.log(t));
      if (got) {
        console.log('\nChecking it. A local model can take a minute for each message.');
        const stages = await runChecks('api', ui, { WebChat, edit: true });
        stages.forEach((st, i) => console.log(`  ${st.ok ? color.green('✓') : color.red('✗')} ${i + 1}. ${st.text}`));
        console.log(stages.every((st) => st.ok) ? color.green('\nReady. Use it with: eon --model api') : color.yellow('\nNot ready yet; see above.'));
      }
    } finally { ui.close(); }
    return;
  }
  if (first === 'doctor' && opts.fix) {
    try { console.log((await runFix({ root: fs.realpathSync(process.cwd()), ask: (q) => ui.ask(q), yes: Boolean(opts.yes) })).join('\n')); } finally { ui.close(); }
    return;
  }
  if (first === 'doctor') {
    const report = doctorReport(fs.realpathSync(process.cwd()));
    if (opts.report) {
      const file = path.join(EON_HOME, 'doctor-report.txt');
      fs.mkdirSync(EON_HOME, { recursive: true });
      fs.writeFileSync(file, `${report}\n`);
      console.log(`${report}\n\nSaved to ${file.replace(os.homedir(), '~')}. It holds no code and no secrets; you can paste it into a message to ask for help.`);
    } else console.log(`${report}\n\nTo save this as a file you can share: eon doctor --report`);
    return;
  }
  if (first === 'harness') {
    const paint = { green: color.green, red: color.red, dim: color.dim };
    let failed = 0;
    if (opts.standIn) {
      // The built-in fake sites, one per supported chat: proves the driver and the scenarios without a login.
      process.env.EON_HEADLESS ??= '1';
      process.env.EON_BUDGET ??= '0';
      let fakes;
      try { fakes = await import('../support/fake-chat.js'); } catch { console.log('The stand-in sites are not part of this install (the support folder is missing).'); process.exitCode = 1; return; }
      const names = rest[0] ? [rest[0]] : Object.keys(fakes.PROFILES);
      for (const name of names) {
        const fake = await fakes.startFakeChat({ stream: true, ...fakes.PROFILES[name] }, (text) => standInReply(text));
        const quiet = { print() {}, ask: async (q) => (/skip/i.test(q) ? 's' : ''), close() {} };
        const chat = new WebChat(name, { ui: quiet, minGapMs: 0, jitterMs: 0, stableMs: 400, firstLookMs: 4000, selectors: { url: fake.url } });
        try {
          await chat.newChat();
          console.log(`${color.bold(`stand-in ${name}`)}`);
          const results = await runHarness({ chat, replyMs: 30000, onResult: (r) => console.log(formatRow(r, paint)) });
          failed += results.filter((r) => !r.ok && !r.skipped).length;
          console.log(`  ${summary(name, results)}\n`);
        } finally { await closeBrowser().catch(() => {}); await fake.close(); }
      }
    } else {
      const site = rest[0] ?? 'deepseek';
      const left = waitMinutes('harness', site);
      if (left && !opts.again) { console.log(`The harness already ran on ${site} a few minutes ago. It sends about 6 real messages, and repeating that is what upsets a site.\nWait about ${left} more minute${left === 1 ? '' : 's'}, or run it anyway with --again.`); return; }
      markRun('harness', site);
      console.log(`Testing ${site} with about 6 short messages (a minute or two). A browser window opens; log in if asked.\n`);
      const chat = new WebChat(site, { ui });
      try {
        await chat.newChat();
        const results = await runHarness({ chat, onResult: (r) => console.log(formatRow(r, paint)) });
        failed += results.filter((r) => !r.ok && !r.skipped).length;
        const file = writeReport(EON_HOME, site, results);
        console.log(`\n${summary(site, results)}\nReport (timings only, no page text): ${file.replace(os.homedir(), '~')}${failed ? '\nPaste it, with ~/.eon/inspect-' + site + '.txt from "eon inspect ' + site + '", to get it fixed.' : ''}`);
      } finally { await closeBrowser().catch(() => {}); ui.close(); }
    }
    process.exitCode = failed ? 1 : 0;
    return;
  }
  if (first === 'export') {
    const r = exportSession(fs.realpathSync(process.cwd()), rest[0] ?? '1');
    console.log(`Saved ${path.relative(process.cwd(), r.file)}`);
    return;
  }
  if (first === 'update') {
    const here = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
    try {
      const r = await runUpdate({ root: here, say: (t) => console.log(t) });
      console.log(r.from === r.to ? `Already up to date (${r.to}).` : `${color.green('✓')} Updated ${r.from} → ${r.to}. Start Eon again to use it.`);
    } catch (e) { console.log(`${color.red('✗')} ${e.message}\nYou can also download the latest zip from github.com/kyoubitt/eon and run install.bat (Windows) or sh install.sh.`); process.exitCode = 1; }
    return;
  }
  if (first === 'first-run') {
    const res = await firstRunChecks({ root: fs.realpathSync(process.cwd()), site: rest[0] ?? 'deepseek' });
    console.log(`${color.bold('Checking this computer')}\n${formatChecks(res, color)}`);
    markFirstRun(res);
    return;
  }
  const site = rest[0] ?? 'deepseek';
  if (['inspect', 'check', 'teach'].includes(first) && site !== 'api') {
    const left = waitMinutes(first, site);
    if (left && !opts.again) { console.log(`This test already ran on ${site} a few minutes ago. Each run sends real messages, and repeating them is what upsets a site.\nWait about ${left} more minute${left === 1 ? '' : 's'}, or run it anyway with --again.`); return; }
    markRun(first, site);
  }
  try {
    if (first === 'inspect') {
      console.log(`Inspecting ${site}. A browser window opens; log in if asked. This sends one short message and takes about a minute.`);
      const { file, found } = await runInspect(site, ui, { WebChat, dir: EON_HOME });
      console.log(`\nSaved ${file.replace(os.homedir(), '~')}. It holds page structure only (tag and class names), no text from the page.\nFound: message box ${found.input ? 'yes' : 'NO'}, send button ${found.send ? 'yes' : 'no'}, replies ${found.reply ? 'yes' : 'NO'}.\nPaste the file's contents into your message to get ${site} working properly.`);
      return;
    }
    if (first === 'login') await loginSite(site, ui);
    else {
      if (first === 'teach') {
        const chat = new WebChat(site, { ui });
        const got = await teachSite(chat, site, ui);
        if (!got) return;
        console.log('\nSaved. Testing it now...');
      }
      console.log(`Checking ${site}. This sends about 4 real messages and takes a minute or two.`);
      const stages = await runChecks(site, ui, { WebChat, edit: !opts.noEdit });
      stages.forEach((st, i) => console.log(`  ${st.ok ? color.green('✓') : color.red('✗')} ${i + 1}. ${st.text}${st.fix ? color.dim(`\n       to fix it: ${st.fix}`) : ''}`));
      const ok = stages.every((st) => st.ok);
      console.log(ok ? color.green(`\n${site} works with Eon.`) : color.yellow(`\nNot ready. If you want help, run: eon doctor --report`));
    }
  } finally {
    await closeBrowser().catch(() => {});
    ui.close();
  }
}

async function main() {
  const opts = parse(process.argv.slice(2));
  const [first, ...rest] = opts.words;
  if (opts.version) { console.log(currentVersion(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'))); return; }
  if (opts.help || first === 'help') { console.log(process.argv.includes('--all') ? HELP : SHORT_HELP); return; }
  if (first === 'mcp') {
    const [sub, name, ...cmd] = rest;
    const root = fs.realpathSync(process.cwd());
    const global = process.argv.includes('--global');
    const words = cmd.filter((w) => w !== '--global');
    if (sub === 'add' && name) {
      const entry = !words.length && PRESETS[name] ? PRESETS[name] : { command: words[0], args: words.slice(1) };
      const file = addMcpServer(root, { name, command: entry.command, args: entry.args, global });
      console.log(`Added "${name}" to ${file.replace(os.homedir(), '~')}. Check it with: eon mcp test ${name}`);
    } else if (sub === 'remove' && name) {
      const file = removeMcpServer(root, name);
      console.log(file ? `Removed "${name}" from ${file.replace(os.homedir(), '~')}.` : `No server named "${name}".`);
    } else if (sub === 'test' && name) {
      const hub = new McpHub(root);
      if (!hub.config[name]) { console.log(`No server named "${name}". Configured: ${hub.names.join(', ') || 'none'}`); return; }
      console.log(`Starting ${name}: ${hub.config[name].command} ${hub.config[name].args.join(' ')}`);
      try { const tools = await hub.server(name).listTools(); console.log(`${color.green('✓')} ${tools.length} tool(s): ${tools.map((t) => t.name).join(', ')}`); } catch (e) { console.log(`${color.red('✗')} ${e.message}`); } finally { hub.closeAll(); }
    } else if (sub === 'list' || !sub) {
      const hub = new McpHub(root);
      console.log(hub.names.length ? hub.names.map((n) => `${n.padEnd(14)} ${hub.config[n].command} ${hub.config[n].args.join(' ')}  (${hub.config[n].from})`).join('\n') : 'No MCP servers yet.');
      console.log(`\nReady-made:\n${Object.entries(PRESETS).map(([k, v]) => `  eon mcp add ${k.padEnd(20)} ${v.about}`).join('\n')}\nYour own: eon mcp add <name> <command> [args...]   (add --global for all projects)`);
    } else console.log('Usage: eon mcp list | add <name> [command args...] | remove <name> | test <name>');
    return;
  }
  if (first === 'features') {
    const [verb, name] = rest;
    try {
      if (verb === 'on' || verb === 'off') { setFeature(name, verb === 'on'); if (verb === 'on' && ['rewrite', 'agents', 'vision', 'mcp'].includes(name)) console.log('Note: this can send extra messages to your chat site.'); }
      else if (verb === 'safe') { applyFeatures(safeFeatures()); console.log('Cautious baseline: every optional behaviour is off and the slow pace is used.'); }
      else if (verb === 'reset') { const c = readConfig(); delete c.features; writeConfig({ features: undefined }); }
      else if (verb) { console.log('Usage: eon features | on <name> | off <name> | safe | reset'); return; }
    } catch (e) { console.log(e.message); process.exitCode = 1; return; }
    const on = resolveFeatures();
    console.log(`${color.bold('Switches')}\n${Object.entries(FEATURES).map(([k, v]) => `  ${on[k] ? color.green('on ') : color.dim('off')}  ${k.padEnd(9)} ${v.about}`).join('\n')}\n${color.dim('Change one: eon features on <name> | off <name> | safe | reset. To track down a problem: eon bisect')}`);
    return;
  }
  if (first === 'bisect') {
    const verb = rest[0];
    if (verb === 'reset') { clearBisect(); applyFeatures(Object.fromEntries(Object.entries(FEATURES).map(([k, v]) => [k, v.on]))); console.log('Search cleared and the switches are back to their defaults.'); return; }
    let state = loadBisect();
    if (!state || verb === 'start') { state = newBisect(); applyFeatures(safeFeatures()); saveBisect(state); }
    else if (verb === 'ok' || verb === 'flagged') { state = record(state, verb === 'flagged'); saveBisect(state); }
    if (state.result) {
      console.log(`${color.bold('Result')}\n  ${state.result.text}`);
      if (state.result.kind === 'culprit') applyFeatures({ ...Object.fromEntries(SUSPECTS.map((k) => [k, true])), [state.result.name]: false });
      return;
    }
    const on = trial(state);
    applyFeatures({ ...safeFeatures(), ...Object.fromEntries(on.map((k) => [k, true])) });
    console.log(`${color.bold('Finding what upsets the site')}  (at most ${roundsLeft(state)} trial${roundsLeft(state) === 1 ? '' : 's'} left)`);
    console.log(state.phase === 'baseline'
      ? '  Trial: the cautious baseline. Everything optional is off.'
      : `  Trial: switched on = ${on.join(', ') || 'nothing'}\n  Still under suspicion: ${state.candidates.join(', ')}`);
    console.log('  Use a throwaway account. Run: eon check <site> three times, at least 10 minutes apart, then work normally for a day.\n  Then tell me how the account did:  eon bisect ok   or   eon bisect flagged   (flagged = a check, warning or suspension)\n  Stop any time with: eon bisect reset');
    return;
  }
  if (first === 'gui' || first === 'web') { console.log('There is no gui any more; just run eon. It works inside the terminal.'); return; }
  if (['sites', 'login', 'check', 'teach', 'doctor', 'setup-local', 'inspect', 'first-run', 'update', 'export', 'harness'].includes(first)) return siteCommands(first, rest, opts);

  // One word that is almost a command ("eon udpate") is probably a typo, not a task.
  if (opts.words.length === 1 && /^[a-z-]{3,12}$/.test(first)) {
    const known = ['features', 'bisect', 'sites', 'login', 'check', 'teach', 'doctor', 'setup-local', 'inspect', 'first-run', 'update', 'export', 'mcp', 'help', 'run'];
    const dist = (a, b) => { const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]); for (let j = 1; j <= b.length; j++) d[0][j] = j; for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); return d[a.length][b.length]; };
    const near = known.find((k) => k !== first && dist(first, k) <= 2 && dist(first, k) <= first.length / 2);
    if (near && !known.includes(first)) { console.log(`Did you mean: eon ${near}\n(To use "${first}" as a task, put it in quotes with more words, for example: eon "${first} the readme".)`); return; }
  }
  let task = (first === 'run' ? rest : opts.words).join(' ').trim();
  // `git diff | eon -p "review this" --stdin`: what is piped in becomes part of the task.
  // Only when asked: a script that pipes answers (`yes y | eon ...`) must not be swallowed.
  if (opts.stdin && !process.stdin.isTTY && task) {
    const piped = await new Promise((resolve) => { let d = ''; process.stdin.setEncoding('utf8'); process.stdin.on('data', (c) => { if (d.length < 100000) d += c; }); process.stdin.on('end', () => resolve(d.trim())); process.stdin.on('error', () => resolve('')); });
    if (piped) task = `${task}\n\nINPUT PIPED IN BY THE USER:\n${piped}`;
  }
  const interactive = Boolean(process.stdin.isTTY && process.stdout.isTTY) && !opts.plain;
  const resuming = opts.resume !== undefined || opts.cont;
  if (!interactive && !task) { console.log(SHORT_HELP); return; }
  if (!interactive && resuming) throw new Error('Resuming needs an interactive terminal.');

  const config = { bell: true, ...readConfig() };
  const jsonOut = opts.outputFormat === 'json';
  if (jsonOut && !['autonomous', 'research'].includes(opts.mode)) throw new Error('--output-format json runs without asking, so it needs --mode autonomous or --mode research.');
  const ui = jsonOut ? { print() {}, ask: async () => 'n', update() {}, close() {} } : interactive ? new CLI({ historyFile: path.join(EON_HOME, 'history.json'), bell: config.bell !== false }) : new TerminalUI();
  let root = fs.realpathSync(process.cwd());
  const remember = (dir) => writeJson('projects.json', [dir, ...readJson('projects.json', []).filter((d) => d !== dir)].slice(0, 15));
  remember(root);

  // Pools are created when first needed. Planning and building share a pool when their lists are the same,
  // so there is no handover; the reviewer and the research chat always get their own browser tabs.
  const pools = new Map();
  const pool = (group, spec, script, role) => {
    const key = `${group}:${spec}`;
    if (!pools.has(key)) pools.set(key, makePool(spec, ui, script, role));
    return pools.get(key);
  };
  const planSpec = () => opts.planModel ?? opts.model;
  const buildSpec = () => opts.buildModel ?? opts.model;
  const models = () => ({ plan: pool('work', planSpec(), opts.script), build: pool('work', buildSpec(), opts.script) });
  // The reviewer should be a different model from the one that wrote the plan.
  const reviewSpec = (level) => opts.reviewer ?? (opts.reviewScript ? 'mock' : level === 'architect' ? (firstOf(planSpec()) === 'gemini' ? 'deepseek' : 'gemini') : 'none');
  const reviewerFor = (level) => (reviewSpec(level) === 'none' ? null : pool('review', reviewSpec(level), opts.reviewScript, 'reviewer'));
  // The research chat is a separate conversation, so documentation questions do not fill the task chat.
  const researchSpec = () => opts.researchModel ?? (opts.researchScript ? 'mock' : firstOf(planSpec()) === 'mock' ? 'none' : firstOf(planSpec()));
  const researcherFor = () => (researchSpec() === 'none' ? null : pool('research', researchSpec(), opts.researchScript, 'research chat'));
  // The helper that describes pictures for a model that cannot see: another site that can.
  const visionSpec = () => opts.visionModel ?? (firstOf(planSpec()) === 'gemini' ? 'chatgpt' : 'gemini');
  const modelLine = () => (planSpec() === buildSpec() ? planSpec() : `plan ${planSpec()} / build ${buildSpec()}`);
  const modelsInfo = () => { const m = models(); return { plan: m.plan.name, build: m.build.name, split: m.plan !== m.build }; };

  let runtime = null;
  let lastResult = null;
  const shellContext = [];
  const pendingPictures = [];
  const makeRuntime = (extra = {}) => { const feats = resolveFeatures(); return new Runtime({
    root, models: models(), ui, reviewer: reviewerFor(opts.level), researcher: researcherFor(),
    allow: opts.allow, allowHosts: opts.allowHost, mode: opts.mode, level: opts.level, inPlace: opts.inPlace, noGit: opts.noGit, features: feats, brief: !opts.noBrief && feats.brief, rewrite: Boolean(opts.rewrite || feats.rewrite),
    // A sub-agent gets its own browser tab, so the main chat is not disturbed.
    visionFactory: !feats.vision ? null : () => { try { return pool('vision', visionSpec(), opts.script, 'vision'); } catch { return null; } },
    agentFactory: !feats.agents ? null : (spec) => { try { return pool('agent', spec ?? firstOf(planSpec()), opts.script, 'sub-agent'); } catch { return null; } }, ...extra,
  }); };
  const idle = (extra = {}) => ui.update?.({ mode: opts.mode, level: opts.level, models: modelsInfo(), dir: path.basename(root), phase: 'idle', busy: false, session: false, ...extra });

  // The "/" menu lists the commands and then the skills (built in, yours and the project's).
  const refreshCommands = () => { ui.commands = [...COMMANDS, ...[...(runtime?.skills ?? loadSkills(root)).values()].filter((k) => !COMMANDS.some(([c]) => c.trim() === `/${k.name}`)).map((k) => [`/${k.name} `, `${k.description} (skill)`])]; };
  const shutdown = async (code) => {
    killRunning();
    runtime?.markInterrupted();
    runtime?.dispose();
    ui.close();
    await closeBrowser().catch(() => {});
    process.exit(code);
  };
  if (interactive) {
    refreshCommands();
    ui.cycle = LIVE_MODES;
    ui.files = listFiles(root);
    // Shift+Tab while Eon works changes the mode of the running session.
    ui.onCycle = () => {
      const now = runtime?.mode ?? opts.mode;
      if (!LIVE_MODES.includes(now)) return;
      const next = LIVE_MODES[(LIVE_MODES.indexOf(now) + 1) % LIVE_MODES.length];
      try { if (runtime) runtime.setMode(next); opts.mode = next; } catch (e) { ui.print(color.red(e.message)); }
    };
    ui.onQuit = () => shutdown(0);
    ui.onInterrupt = () => runtime?.interrupt();
    if (!opts.noSplash && config.splash !== false && !jsonOut) await showSplash({ model: firstOf(planSpec()) });
    ui.start();
  }
  process.on('SIGINT', () => shutdown(130));
  process.on('SIGTERM', () => shutdown(143));
  process.on('SIGHUP', () => shutdown(129));
  // Closing the window does not always send a signal (Windows), so the exit event and a closed stdin also mark the run as cut off.
  process.on('SIGBREAK', () => shutdown(131));
  process.on('exit', () => { try { runtime?.markInterrupted(); } catch { /* going down anyway */ } });
  process.stdin.on?.('close', () => { if (runtime?.busy) shutdown(129); });
  process.on('uncaughtException', (e) => {
    try { writeLast(e); runtime?.markInterrupted(); } catch { /* going down anyway */ }
    ui.close?.();
    console.error(`Eon crashed: ${e.message}\nYour work is saved; start Eon again and it will offer to carry on.\nDetails: ${lastErrorFile().replace(os.homedir(), '~')}   Help: eon doctor --report`);
    process.exit(1);
  });

  const git = (dir, args) => spawnSync('git', args, { cwd: dir, encoding: 'utf8' }).stdout ?? '';
  const say = (title, body) => ui.print(`${color.bold(title)}\n${body || color.dim('  (nothing yet)')}`);
  const sessionLabel = (s) => `${s.updated.slice(0, 16).replace('T', ' ')}  ${s.tasks[0].slice(0, 50)}${s.tasks.length > 1 ? ` (+${s.tasks.length - 1})` : ''}  [${s.mode}, ${s.status === 'working' || s.status === 'cut-off' ? 'cut off' : s.status}]`;

  /** The first-start check (also /check): what works on this computer, then an offer to test the chat site. */
  const firstRun = async (site, { offerTest = true } = {}) => {
    ui.print(color.bold('Checking this computer'));
    const res = await firstRunChecks({ root, site });
    const problems = res.filter((r) => !r.ok && !r.info);
    // All good: one line. Anything wrong: the full list with the fix for each.
    ui.print(problems.length || !offerTest ? formatChecks(res, color) : color.green(`  ✓ This computer is ready (${res.filter((r) => r.ok && !r.info).length} checks passed).`));
    markFirstRun(res);
    const loggedIn = res.find((r) => r.name === 'login')?.ok;
    if (offerTest && loggedIn && /^y/i.test(await ui.ask(`Test ${sites()[site].label} now (sends a few short messages, takes about a minute)? [y]es / later: `))) {
      const stages = await runChecks(site, ui, { WebChat, edit: true });
      ui.print(stages.map((st, i) => `  ${st.ok ? color.green('✓') : color.red('✗')} ${i + 1}. ${st.text}${st.fix ? color.dim(`\n       to fix it: ${st.fix}`) : ''}`).join('\n'));
      ui.print(stages.every((st) => st.ok) ? color.green(`  ${sites()[site].label} works with Eon.`) : color.yellow('  Not ready. If you want help, run: eon doctor --report'));
    }
  };

  /** Show a past session and set Eon up to carry on from where it stopped. */
  const resumeSession = (meta) => {
    const saved = loadSession(root, meta.id);
    ui.print(color.dim(`── resumed: ${meta.tasks[0].slice(0, 70)} ──`));
    const shown = saved.events.slice(-60);
    if (saved.events.length > shown.length) ui.print(color.dim(`  … ${saved.events.length - shown.length} earlier lines not shown`));
    replay(ui, shown);
    Object.assign(opts, { mode: meta.mode, level: meta.level });
    runtime = makeRuntime({ resume: meta.id });
    runtime.restore();
    const left = runtime.plan ? runtime.plan.steps.filter((s) => !runtime.doneSteps.has(s.n)).length : 0;
    ui.print(`\n${color.green('●')} Back in this session (${meta.mode} / ${meta.level}${meta.branch ? `, branch ${meta.branch}` : ''}). ${runtime.plan ? (runtime.approved ? `The approved plan has ${left} step${left === 1 ? '' : 's'} left.` : 'The plan is not approved.') : 'No plan yet.'}\n${color.dim('  The model starts a fresh chat and is told where things stand, so it may re-read some files. Type to continue.')}`);
  };
  const pickSession = async () => {
    const all = listSessions(root);
    if (!all.length) { ui.print('No saved sessions in this folder yet.'); return null; }
    const shown = all.slice(0, 30);
    const i = await ui.choose(`Resume which session?${all.length > 30 ? ` (newest 30 of ${all.length})` : ''}  ↑ ↓ to move, Enter to pick, Esc to cancel`, shown.map(sessionLabel));
    return i === null ? null : shown[i];
  };

  /** Handle a slash command typed between messages. */
  const command = async (line) => {
    const [cmd, ...args] = line.split(/\s+/);
    const arg = args.join(' ');
    const stores = () => readStores(root);
    const yes = async (q) => /^y/i.test(await ui.ask(q));
    switch (cmd) {
      case '/help': return ui.print(helpText(/^all$/i.test(arg)));
      case '/new': case '/clear': runtime = null; idle(); return ui.print('Started a fresh session. Your next message begins a new chat and a new branch.');
      case '/resume': case '/history': { const s = await pickSession(); if (s) resumeSession(s); return undefined; }
      case '/mode': case '/level': {
        const [list, key] = cmd === '/mode' ? [MODES, 'mode'] : [LEVELS, 'level'];
        if (!list.includes(arg)) return ui.print(color.yellow(`Choose one of: ${list.join(', ')}`));
        // Guided, accept and research can be switched while a session runs.
        if (key === 'mode' && runtime && LIVE_MODES.includes(opts.mode) && LIVE_MODES.includes(arg)) { runtime.setMode(arg); opts.mode = arg; idle({ ...ui.snap, mode: arg }); return undefined; }
        opts[key] = arg;
        runtime = null; // the rules of a session are fixed when it starts
        idle();
        return ui.print(`${key === 'mode' ? 'Mode' : 'Level'} is now ${arg}. Your next message starts a new session with it.`);
      }
      case '/models': {
        const m = models();
        return say('Models', `  plan      ${m.plan.status()}\n  build     ${m.build.status()}\n  review    ${reviewerFor(opts.level)?.status() ?? 'none'}\n  research  ${researcherFor()?.status() ?? 'none'}\n${color.dim(`  A comma list is a fallback chain. Known: ${Object.keys(sites()).join(', ')}, api`)}`);
      }
      case '/model': {
        const roles = { plan: 'planModel', build: 'buildModel', review: 'reviewer', research: 'researchModel', vision: 'visionModel' };
        const [role, spec] = roles[args[0]] ? [args[0], args.slice(1).join('')] : ['all', args.join('')];
        if (!spec) return ui.print(color.yellow('Say which model, for example: /model deepseek,qwen   or   /model build gemini'));
        if (spec !== 'none') makePool(spec, ui, opts.script); // fails here, with the list of names, if one is unknown
        if (role === 'all') Object.assign(opts, { model: spec, planModel: undefined, buildModel: undefined });
        else opts[roles[role]] = spec;
        runtime = null;
        idle();
        return ui.print(`Models: ${modelLine()}. Your next message starts a new session with them.`);
      }
      case '/learn': {
        if (arg.length < 15) return ui.print(color.yellow('State the rule as a sentence, for example: /learn When changing auth code, check AUTH_BASE_URL first.'));
        const l = teach(root, arg);
        return ui.print(`Saved as ${l.id}. It will be enforced on tasks that mention: ${l.applies_to.join(', ')}`);
      }
      case '/forget': {
        const hit = forget(root, arg.trim());
        return ui.print(hit ? `Deleted ${hit.id}: ${hit.rule ?? hit.topic}` : color.yellow('Give the id of a lesson or research entry, for example /forget L2 (see /memory and /research).'));
      }
      case '/allow-host': if (!arg) return ui.print(color.yellow('Give a host, for example /allow-host nextjs.org')); opts.allowHost.push(arg); runtime?.allowHosts.add(arg); return ui.print(`Documentation hosts allowed without asking: ${opts.allowHost.join(', ')}`);
      case '/allow': if (!arg) return ui.print(color.yellow('Give a command, for example /allow npm test')); opts.allow.push(arg); return ui.print(`Allowed without asking: ${opts.allow.join(' ; ')} (applies to new sessions)`);
      case '/status': return say('Status', `  mode ${opts.mode}, level ${opts.level}, models ${modelLine()}\n  folder: ${root}\n  session: ${runtime?.id ?? 'none'}\n  branch: ${runtime?.branch ?? 'none yet (created when edits begin)'}\n  plan: ${!runtime?.plan ? 'none' : runtime.approved ? 'approved' : 'not approved'}`);
      case '/plan':
        if (!runtime?.plan) return ui.print('There is no plan in this session yet.');
        return ui.event?.({ type: 'plan', plan: runtime.plan, confidence: confidence(runtime.plan), done: [...runtime.doneSteps], started: [...runtime.approvedSteps] });
      case '/diff': {
        if (runtime?.noGit) {
          const changes = runtime.backup?.changes() ?? [];
          if (!changes.length) return ui.print('This session has not changed anything yet.');
          const paint = (l) => (l.startsWith('+') ? color.green(l) : l.startsWith('-') ? color.red(l) : l.startsWith('@@') ? color.cyan(l) : l);
          return say('Changes (compared with the backups)', changes.map((c) => `${color.bold(c.file)}${c.old === null ? ' (new file)' : ''}\n${simpleDiff(c.old, c.now).split('\n').map(paint).join('\n')}`).join('\n\n'));
        }
        if (!runtime?.branch) return ui.print('This session has not changed anything yet.');
        const base = git(root, ['merge-base', 'HEAD', runtime.branch]).trim();
        const diff = git(runtime.cwd, ['diff', base]);
        const paint = (l) => (/^(\+\+\+|---|diff )/.test(l) ? color.bold(l) : l.startsWith('+') ? color.green(l) : l.startsWith('-') ? color.red(l) : l.startsWith('@@') ? color.cyan(l) : l);
        return say(`Changes on ${runtime.branch}`, `${git(runtime.cwd, ['diff', '--stat', base])}\n${(diff.length > 12000 ? `${diff.slice(0, 12000)}\n… cut` : diff).split('\n').map(paint).join('\n')}`);
      }
      case '/merge': {
        if (runtime?.noGit) return ui.print('Working without git: the changes are already in your files. /undo takes back the last step, /discard puts every file back.');
        if (!runtime?.branch) return ui.print('Nothing to merge: this session has not changed anything yet.');
        if (!(await yes(`Merge ${runtime.branch} into your current branch? [y]es / [n]o: `))) return undefined;
        const hash = mergeBranch(root, runtime.branch, runtime.cwd);
        runtime.closeSession('merged');
        runtime = null;
        idle();
        return ui.print(`${color.green('✓')} Merged (${hash}). This session is closed; your next message starts a new one.`);
      }
      case '/discard': {
        if (runtime?.noGit) {
          if (!runtime.backup?.count) return ui.print('Nothing to discard: this session has not changed anything yet.');
          if (!(await yes('Put every file this session changed back as it was? [y]es / [n]o: '))) return undefined;
          runtime.backup.discard();
          runtime.closeSession('discarded');
          runtime = null;
          idle();
          return ui.print('Every file is back as it was. This session is closed; your next message starts a new one.');
        }
        if (!runtime?.branch) return ui.print('Nothing to discard: this session has not changed anything yet.');
        if (!(await yes(`Throw away ALL of this session's changes (${runtime.branch})? This cannot be undone. [y]es / [n]o: `))) return undefined;
        discardBranch(root, runtime.branch, runtime.cwd);
        runtime.closeSession('discarded');
        runtime = null;
        idle();
        return ui.print('Discarded. This session is closed; your next message starts a new one.');
      }
      case '/undo': {
        if (!runtime?.branch && !runtime?.noGit) return ui.print('Nothing to undo: this session has not committed anything yet.');
        if (!(await yes('Take back the newest committed step? [y]es / [n]o: '))) return undefined;
        const subject = runtime.undoStep();
        return ui.print(`Took back: ${subject}. The model will be told on your next message.`);
      }
      case '/memory': {
        if (args[0] === 'edit') {
          const scope = args[1] ?? 'project';
          const target = memoryFiles(root).find((m) => m.scope === scope);
          if (!target) return ui.print(color.yellow('Choose one of: user, project, local'));
          if (!target.exists) appendMemory(root, scope, 'Write your notes here.');
          const editor = process.env.VISUAL || process.env.EDITOR || (process.platform === 'win32' ? 'notepad' : 'nano');
          ui.suspend?.();
          const r = spawnSync(`${editor} "${target.file}"`, { stdio: 'inherit', shell: true });
          ui.resume?.();
          return ui.print(r.status === 0 || r.status === null ? `Edited ${target.file.replace(os.homedir(), '~')}. It is read at the start of every session.` : color.yellow(`Could not open an editor. Edit this file yourself: ${target.file}`));
        }
        const files = memoryFiles(root).map((m) => `  ${m.scope.padEnd(8)} ${m.file.replace(os.homedir(), '~').padEnd(34)} ${m.exists ? `${m.size} bytes` : color.dim('not created yet')}`).join('\n');
        say('Memory files (read at the start of every session)', `${files}\n${color.dim('  Add a note: type # and the note. Edit a file: /memory edit user|project|local')}`);
        const { lessons, mistakes } = stores();
        say('Lessons learned', lessons.map((l) => `  ${l.id}  ${l.rule}\n      applies to: ${l.applies_to.join(', ')}; held ${l.confirmations} time(s)${l.promoted ? '; in project notes' : ''}`).join('\n'));
        return say('Mistakes', mistakes.map((m) => `  ${m.id}  ${m.claim}`).join('\n'));
      }
      case '/compact': {
        if (!runtime) return ui.print('There is no session to compact yet.');
        const r = await runtime.compact();
        return ui.print(`Compacted. The chat held ${Math.round(r.was / 1000)}k characters; your next message opens a fresh chat with a ${r.digest}-character summary.`);
      }
      case '/context': {
        const m = modelsInfo();
        const c = runtime?.contextInfo();
        const k = (n) => (n < 1000 ? `${n} B` : `${(n / 1000).toFixed(1)}k`);
        const mem = memoryFiles(root).map((f) => `${f.scope} ${f.exists ? k(f.size) : '–'}`).join(' · ');
        const lines = [`  model         ${c?.model ?? m.plan}`];
        if (c) {
          const pct = Math.min(100, Math.round((c.chatChars / c.chatBudget) * 100));
          lines.push(`  this chat     ${k(c.chatChars)} of ${k(c.chatBudget)} characters (${pct}%)  ${color.cyan('█'.repeat(Math.round(pct / 10)))}${color.dim('░'.repeat(10 - Math.round(pct / 10)))}`);
          if (Number.isFinite(c.messageLimit)) lines.push(`  message cap   ${k(c.messageLimit)} characters per message`);
          lines.push(`  this session  ${c.messages} messages sent, ${c.turns} turns, ${c.minutes} min`);
        } else lines.push('  this chat     no session yet');
        lines.push(`  memory files  ${mem}`, `  stored        ${stores().lessons.length} lessons, ${stores().research.length} research notes, ${listAllow(root).length} saved allow rules`);
        return say('Context', lines.join('\n'));
      }
      case '/mcp': {
        const hub = runtime?.mcp ?? new McpHub(root);
        if (!hub.names.length) return say('MCP servers', `  none. Add some in ${color.bold('.eon/mcp.json')}:\n  {"servers": {"name": {"command": "npx", "args": ["-y", "some-mcp-server"]}}}`);
        const rules = listAllow(root).filter((r) => r.startsWith('mcp:'));
        return say('MCP servers', `${hub.names.map((n) => `  ${n.padEnd(14)} ${hub.config[n].command} ${hub.config[n].args.join(' ')} ${color.dim(`(${hub.config[n].from} config)`)}`).join('\n')}\n${rules.length ? `\n  allowed: ${rules.join(', ')}` : ''}\n${color.dim('  The model asks for a server, then a tool; you approve each first use.')}`);
      }
      case '/agents': {
        const agents = runtime?.agents ?? loadAgents(root);
        if (!agents.size) return say('Sub-agents', `  none defined. Make ${color.bold('.eon/agents/<name>.md')}, for example:\n  ---\n  model: qwen\n  ---\n  You review code for security problems. Report file:line and why.\n  Then start a message with @<name> to hand a task to it.`);
        return say('Sub-agents', [...agents.values()].map((a) => `  @${a.name.padEnd(14)} ${a.model ? `[${a.model}] ` : ''}${a.line}`).join('\n'));
      }
      case '/image': {
        const file = path.resolve(root, arg.replace(/^["']|["']$/g, ''));
        if (!arg) return ui.print(color.yellow('Give a picture, for example: /image screenshot.png   (or write @screenshot.png in your message)'));
        try { checkImage(file); } catch (e) { return ui.print(color.red(e.message)); }
        pendingPictures.push(file);
        return ui.print(`Picture added: ${path.basename(file)}. It goes with your next message${firstOf(planSpec()) === 'deepseek' ? ` (DeepSeek cannot see pictures, so ${visionSpec()} will describe it)` : ''}.`);
      }
      case '/skills': {
        if (args[0] === 'new' && args[1]) { try { const f = newSkill(root, args[1]); refreshCommands(); return ui.print(`Made ${path.relative(root, f)}. Edit it, then use it with /${args[1]} <what to do>.`); } catch (e) { return ui.print(color.red(e.message)); } }
        const all = [...(runtime?.skills ?? loadSkills(root)).values()];
        return say('Skills', `${all.map((k) => `  /${k.name.padEnd(16)} ${k.description} ${color.dim(`(${k.source})`)}`).join('\n')}\n${color.dim('  Use one: /<name> <what to do>. Make your own: /skills new <name>')}`);
      }
      case '/export': {
        const id = runtime?.id ?? listSessions(root)[0]?.id;
        if (!id) return ui.print('No session to export yet.');
        try { const r = exportSession(root, id, { file: arg || null }); return ui.print(`Saved ${path.relative(root, r.file)}. Secrets are redacted; read it before you share it.`); } catch (e) { return ui.print(color.red(e.message)); }
      }
      case '/check': await firstRun(firstOf(planSpec())); return undefined;
      case '/usage': {
        if (!runtime) return ui.print('No session yet, so nothing has been counted.');
        const { rows, total } = runtime.usageInfo();
        if (!rows.length) return ui.print('Nothing has been sent yet.');
        const n = (v) => `≈${v >= 10000 ? `${Math.round(v / 1000)}k` : v}`;
        const head = `  ${'model'.padEnd(12)}${'messages'.padStart(9)}${'tokens in'.padStart(12)}${'tokens out'.padStart(12)}${'time'.padStart(8)}`;
        const row = (m, r) => `  ${m.padEnd(12)}${String(r.messages).padStart(9)}${n(r.tokensIn).padStart(12)}${n(r.tokensOut).padStart(12)}${`${Math.round(r.ms / 60000)} min`.padStart(8)}`;
        const peak = Math.max(1, ...rows.map((r) => r.tokensIn + r.tokensOut));
        const bar = (r) => { const n = Math.round(((r.tokensIn + r.tokensOut) / peak) * 24); return `${color.cyan('█'.repeat(n))}${color.dim('░'.repeat(24 - n))}`; };
        return say('Usage (estimate)', `${head}\n${rows.map((r) => `${row(r.model, r)}  ${bar(r)}`).join('\n')}${rows.length > 1 ? `\n${row('total', total)}` : ''}\n${(() => { const t = todayCounts(), b = budgetFor(); const e = Object.entries(t); return e.length ? color.dim(`  Sent today, all sessions (Eon's own count${b ? `, it asks before ${b}` : ''}): ${e.map(([k, v]) => `${k} ${v}`).join(', ')}`) : ''; })()}\n${color.dim('  Web chats do not report tokens or what is left of the free quota. This counts characters / 4, so it is a rough guide.')}`);
      }
      case '/raw': {
        const ex = runtime?.store?.lastExchange();
        if (!ex?.sent) return ui.print('Nothing has been sent yet.');
        const cut = (t) => (t.length > 6000 ? `${t.slice(0, 6000)}\n… ${t.length - 6000} more characters (the full text is in .eon/tasks/${runtime.id}/chat.jsonl)` : t);
        say('Last message Eon sent', color.dim(cut(ex.sent)));
        return say('Raw reply from the model', cut(ex.reply ?? '(no reply yet)'));
      }
      case '/permissions': {
        const [sub, ...rest2] = args;
        if (sub === 'add' && rest2.length) addAllow(root, rest2.join(' '));
        else if (sub === 'remove' && rest2.length) { const gone = removeAllow(root, rest2.join(' ')); if (!gone) return ui.print(color.yellow('No saved rule matches that. Use its number from /permissions.')); ui.print(`Removed: ${gone}`); }
        if (runtime) runtime.rules = new Set(listAllow(root));
        const rules = listAllow(root);
        return say('Commands always allowed in this project', `${rules.map((r, i) => `  ${i + 1}. ${r}`).join('\n') || color.dim('  (none)')}\n${color.dim('  A rule is an exact command, or ends in :* to allow anything after it (npm run:*).\n  Add: /permissions add <rule>   Remove: /permissions remove <number>')}${opts.allow.length ? `\n  Allowed for this run by --allow: ${opts.allow.join(' ; ')}` : ''}`);
      }
      case '/config': {
        const keys = { bell: 'bell', splash: 'splash', pace: 'pace', mode: 'mode', level: 'level', model: 'model', 'plan-model': 'planModel', 'build-model': 'buildModel', 'vision-model': 'visionModel', 'update-check': 'updateCheck', brief: 'brief', rewrite: 'rewrite', reviewer: 'reviewer' };
        const [key, ...val] = args;
        if (key && keys[key] && val.length) {
          const value = val.join('');
          if (key === 'rewrite') { writeConfig({ rewrite: /^(on|yes|true)$/i.test(value) }); return ui.print(`Rewrite requests with the model: ${/^(on|yes|true)$/i.test(value) ? 'on (one extra message per request)' : 'off'} (applies to new sessions).`); }
          if (key === 'brief') { writeConfig({ brief: /^(on|yes|true)$/i.test(value) }); return ui.print(`Task brief: ${/^(on|yes|true)$/i.test(value) ? 'on' : 'off'} (applies to new sessions).`); }
          if (key === 'update-check') { writeConfig({ updateCheck: /^(on|yes|true)$/i.test(value) }); return ui.print(`Update notice: ${/^(on|yes|true)$/i.test(value) ? 'on' : 'off'}.`); }
          if (key === 'splash') { writeConfig({ splash: /^(on|yes|true)$/i.test(value) }); return ui.print(`Intro screen: ${/^(on|yes|true)$/i.test(value) ? 'on' : 'off'}.`); }
          if (key === 'bell') { ui.bell = /^(on|yes|true)$/i.test(value); writeConfig({ bell: ui.bell }); }
          else if (key === 'pace') { if (!/^(slow|normal|fast)$/.test(value)) return ui.print(color.yellow('Choose slow, normal or fast.')); process.env.EON_PACE = value; writeConfig({ pace: value }); }
          else {
            if (key === 'mode' && !MODES.includes(value)) return ui.print(color.yellow(`Choose one of: ${MODES.join(', ')}`));
            if (key === 'level' && !LEVELS.includes(value)) return ui.print(color.yellow(`Choose one of: ${LEVELS.join(', ')}`));
            if (/model|reviewer/.test(key) && value !== 'none') makePool(value, ui, opts.script);
            opts[keys[key]] = value; writeConfig({ [keys[key]]: value });
          }
          return ui.print(`Saved: ${key} = ${value}. ${/^(mode|level|model|plan-model|build-model|reviewer)$/.test(key) ? 'It applies to new sessions.' : ''}`);
        }
        const c = readConfig();
        return say('Saved settings (~/.eon/config.json)', `${Object.keys(keys).map((k) => `  ${k.padEnd(12)} ${c[keys[k]] ?? color.dim('(default)')}`).join('\n')}\n${color.dim('  Change one: /config <name> <value>, for example /config pace slow')}`);
      }
      case '/review': {
        if (!runtime?.branch) return ui.print('Nothing to review: this session has not changed anything yet.');
        const base = git(root, ['merge-base', 'HEAD', runtime.branch]).trim();
        const diff = git(runtime.cwd, ['diff', base]);
        if (!diff.trim()) return ui.print('There are no committed changes to review yet.');
        const spec = opts.reviewer && opts.reviewer !== 'none' ? opts.reviewer : (opts.reviewScript ? 'mock' : firstOf(planSpec()) === 'gemini' ? 'deepseek' : 'gemini');
        const reviewer = pool('review', spec, opts.reviewScript, 'reviewer');
        ui.print(color.dim(`Asking ${reviewer.name} to review the changes...`));
        await reviewer.start?.();
        await reviewer.newChat();
        const prompt = redact(diffReviewPrompt({ task: runtime.tasks[0], plan: runtime.plan, diff: diff.slice(0, 16000) }));
        let reply = await reviewer.send(prompt);
        let review = parseReview(reply) ?? parseReview(reply = await reviewer.send('Reply again with exactly one JSON object in a ```json code block: {"action":"review","verdict":"approve" or "revise","issues":[{"severity":"high|medium|low","claim":"optional","text":"..."}]}'));
        if (!review) return ui.print(color.red('The reviewer did not reply in a form Eon could read.'));
        const paint = { high: color.red, medium: color.yellow, low: color.dim };
        ui.print(`${color.bold('Review')} by ${reviewer.name}: ${review.verdict === 'approve' ? color.green('approve') : color.yellow('revise')}, ${review.issues.length} issue${review.issues.length === 1 ? '' : 's'}`);
        for (const i of review.issues) ui.print(`  ${paint[i.severity](i.severity.toUpperCase().padEnd(6))} ${i.claim ? `${i.claim}  ` : ''}${i.text}`);
        return undefined;
      }
      case '/research': return say('Research', stores().research.map((r) => `  ${r.id}  ${r.topic}\n      ${r.kind === 'doc' ? 'fetched' : 'research chat'}: ${r.source} (${r.date})`).join('\n'));
      case '/notes': return say('Project notes', stores().notes);
      case '/output': return ui.showOutput?.();
      case '/init': {
        const file = path.join(root, 'EON.md');
        if (fs.existsSync(file)) return ui.print(color.yellow('EON.md already exists. Edit it directly; Eon reads it at the start of every session.'));
        fs.writeFileSync(file, instructionsTemplate(root));
        return ui.print('Created EON.md with the commands Eon found. Fill in the conventions; it is read at the start of every session.');
      }
      case '/pr': {
        if (!runtime?.plan && !runtime?.branch) return ui.print('There is nothing to describe yet: this session has no plan or changes.');
        const base = runtime.branch ? git(root, ['merge-base', 'HEAD', runtime.branch]).trim() : '';
        const commits = runtime.branch ? git(runtime.cwd, ['log', '--format=%s', `${base}..HEAD`]).split('\n').filter(Boolean).reverse() : [];
        const text = buildPr({ task: runtime.tasks[0], plan: runtime.plan, branch: runtime.branch, commits, review: runtime.review });
        const out = path.join(runtime.store.dir, 'PR.md');
        fs.writeFileSync(out, `${text}\n`);
        return ui.print(`${text}\n\n${color.dim(`Saved to ${path.relative(root, out)}`)}`);
      }
      case '/bell': ui.bell = !ui.bell; writeJson('config.json', { ...config, bell: ui.bell }); return ui.print(`Sound when Eon needs you: ${ui.bell ? 'on' : 'off'}.`);
      case '/project': {
        let dir = arg;
        if (!dir) {
          const recent = readJson('projects.json', []).filter((d) => d !== root && fs.existsSync(d));
          if (!recent.length) return ui.print('Give a folder, for example /project ~/code/app');
          const i = await ui.choose('Switch to which folder?', recent);
          if (i === null) return undefined;
          dir = recent[i];
        }
        dir = path.resolve(dir.replace(/^~(?=$|[\\/])/, os.homedir()));
        if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) return ui.print(color.red(`${dir} is not a folder.`));
        root = fs.realpathSync(dir);
        process.chdir(root);
        remember(root);
        runtime = null;
        refreshCommands();
        idle();
        return ui.print(`Now working in ${root}. Your next message starts a new session there.`);
      }
      default: return ui.print(color.yellow('Not a command I know. Type /help.'));
    }
  };

  try {
    if (interactive) {
      const m = modelsInfo();
      const past = listSessions(root).length;
      ui.banner({ cwd: root, models: m.split ? `plan ${m.plan} → build ${m.build}` : m.plan, mode: opts.mode, level: opts.level, note: past ? color.dim(`  ${past} past session${past === 1 ? '' : 's'} in this folder: eon -r to resume`) : '' });
      idle();
      const mainSite = firstOf(planSpec());
      // A once-a-day note when a newer version exists (a plain GET to GitHub; /config update-check off to stop it).
      checkForUpdate({ root: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..') }).then((u) => { if (u) ui.print(color.dim(`  Eon ${u.latest} is available (you have ${u.current}). Run: eon update`)); }).catch(() => {});
      if (!firstRunDone() && !opts.cont && opts.resume === undefined) { try { await firstRun(mainSite); } catch (e) { ui.print(color.dim(`  (the first-start check could not run: ${e.message})`)); } }
      if (sites()[mainSite] && !profileExists()) {
        const a = await ui.ask(`You have not logged in to ${sites()[mainSite].label} yet. Log in now? [y]es / [n]o, later: `);
        if (/^y/i.test(a)) { try { await loginSite(mainSite, ui); } catch (e) { ui.print(color.red(explainError(e).text)); } }
        else {
          const local = await detectOllama();
          if (local.up && local.models.length && /^y/i.test(await ui.ask(`Ollama is running on this computer with ${local.models[0]}. Use it for now instead? [y]es / [n]o: `))) {
            writeConfig({ api: { base: 'http://localhost:11434/v1', model: local.models[0] } });
            opts.model = 'api'; opts.planModel = undefined; opts.buildModel = undefined; idle();
          }
        }
      }
      // A run that was cut off (crash, closed window): offer to carry on from where it stopped.
      let cut = null;
      try { cut = !opts.cont && opts.resume === undefined && !task ? interruptedSession(root) : null; } catch { cut = null; }
      if (cut) {
        const done = cut.done?.length ?? 0;
        const where = cut.steps ? ` Step ${Math.min(done + 1, cut.steps)} of ${cut.steps} was in progress.` : '';
        const a = await ui.ask(`Last time Eon was cut off while working on: "${cut.tasks.at(-1).slice(0, 70)}".${where}\n[r]esume it / [s]tart fresh / [l]ater: `);
        if (/^r/i.test(a)) resumeSession(cut);
        else if (/^s/i.test(a)) { setSessionStatus(root, cut.id, 'abandoned'); ui.print(color.dim('  Left as it was; starting fresh.')); }
      }
      if (opts.cont) {
        const latest = listSessions(root)[0];
        if (latest) resumeSession(latest); else ui.print('No saved sessions in this folder yet.');
      } else if (opts.resume !== undefined) {
        const s = opts.resume ? findSession(root, opts.resume) : await pickSession();
        if (s) resumeSession(s); else if (opts.resume) ui.print(color.yellow(`No saved session matches "${opts.resume}".`));
      }
    }

    for (;;) {
      if (!task) {
        if (!runtime) idle();
        let line = await ui.ask('', { kind: 'task', placeholder: runtime ? 'Reply to continue this session · /new for a fresh one' : 'Try "fix the failing login test"' });
        if (!line) continue;
        if (line === '/quit' || line === '/exit') break;
        // "/fix-bug the login test fails" runs a skill: the model is told to load it first.
        const sk = /^\/([\w-]+)(?:\s+([\s\S]*))?$/.exec(line);
        if (sk && !COMMANDS.some(([c]) => c.trim() === `/${sk[1]}`) && (runtime?.skills ?? loadSkills(root)).has(sk[1].toLowerCase())) line = `Use the skill "${sk[1].toLowerCase()}" for this: ${sk[2]?.trim() || '(see the skill; ask me if something is unclear)'}`;
        // Only a known command is a command. "/src/app.js is broken" is a message, not a command.
        if (isCommand(line, COMMANDS)) {
          try { await command(line); } catch (e) { ui.print(color.red(e.message)); }
          continue;
        }
        // "# note" saves to memory instead of going to the model.
        if (/^#\s+\S/.test(line)) {
          const where = await ui.ask('Save this note where? [p]roject (shared, EON.md) / [l]ocal (only you, here) / [u]ser (every project): ');
          const scope = { p: 'project', l: 'local', u: 'user' }[where.trim()[0]?.toLowerCase()];
          if (!scope) { ui.print(color.dim('Not saved.')); continue; }
          const file = appendMemory(root, scope, line.replace(/^#\s+/, ''));
          ui.print(`Saved to ${file.replace(os.homedir(), '~')}. Eon reads it at the start of every session.`);
          continue;
        }
        // "!command" runs a shell command yourself; Eon is told about it with your next message.
        if (/^!\s*\S/.test(line)) {
          const cmd = line.replace(/^!\s*/, '');
          ui.print(`${color.bold('$')} ${cmd}`);
          const { exit, output } = await runCommand(runtime?.cwd ?? root, cmd, 120000);
          const rows = output.split('\n');
          ui.print(color.dim(`${rows.slice(0, 30).map((l) => `  ${l}`).join('\n')}${rows.length > 30 ? `\n  … +${rows.length - 30} lines` : ''}\n  exit ${exit}`));
          shellContext.push(`THE USER RAN THIS COMMAND THEMSELVES\n$ ${cmd}\nexit ${exit}\n${output.slice(0, 3000)}`);
          continue;
        }
        if (/^(eon\s+)?(gui|web)$/i.test(line)) { ui.print('There is no gui any more; just run eon. It works inside the terminal.'); continue; }
        task = line;
      }
      try {
        // A plain folder cannot be edited safely. Offer to make it a repository, when there is someone to ask.
        if (!runtime && opts.mode !== 'research' && (interactive || process.stdin.isTTY)) {
          let ready = false;
          try { ready = await ensureRepo(root, (q) => ui.ask(q)); } catch (e) { ui.print(color.red(e.message)); }
          if (!ready) {
            // Asked once. From here on this session only looks around, instead of asking on every message.
            opts.mode = 'research';
            idle();
            ui.print(color.dim('  Nothing was changed. Eon is in research mode (it reads and answers, it does not edit). Start Eon in a project folder to edit.'));
          } else opts.noGit = ready === 'nogit';
        }
        runtime ??= makeRuntime();
        // Files named with @ and commands run with ! go to the model with this request.
        // "@reviewer look at auth" hands the task to the sub-agent named reviewer.
        const agentMention = /^@([\w-]+)\s+([\s\S]+)$/.exec(task);
        if (agentMention && runtime.agents.has(agentMention[1])) {
          shellContext.push(`THE USER ASKS YOU TO HAND THIS TO THE SUB-AGENT "${agentMention[1]}": send a delegate action with "agent":"${agentMention[1]}" and the task below, then report its findings.`);
          task = agentMention[2];
        }
        const mentioned = expandMentions(task, runtime.cwd);
        const images = [...pendingPictures.splice(0), ...mentioned.images];
        if (images.length) ui.print(color.dim(`  pictures: ${images.map((f) => path.basename(f)).join(', ')}`));
        if (mentioned.files.length) ui.print(color.dim(`  attached: ${mentioned.files.join(', ')}`));
        const context = [...shellContext.splice(0), mentioned.context].filter(Boolean).join('\n\n');
        lastResult = await runtime.run(task, { context, images });
      } catch (e) {
        if (!interactive) throw e;
        if (!runtime?.store) runtime = null; // it never started
        const why = explainError(e);
        writeLast(e);
        ui.print(`${color.red(why.text)}${why.fix ? color.dim(`\n  to fix it: ${why.fix}`) : ''}`);
        if (why.fix && /^(npm|npx) /.test(why.fix) && /^y/i.test(await ui.ask(`Run "${why.fix}" now? [y]es / [n]o: `))) {
          spawnSync(why.fix, { stdio: 'inherit', shell: true });
          ui.print('Done. Send your message again.');
        }
      }
      task = '';
      if (!interactive) break;
    }
  } finally {
    runtime?.dispose();
    ui.close();
    await closeBrowser().catch(() => {});
  }
  if (jsonOut) console.log(JSON.stringify({ status: lastResult?.status ?? 'error', summary: lastResult?.summary ?? null, session_id: lastResult?.id ?? null, branch: lastResult?.branch ?? null, confidence: lastResult?.confidence ?? 0, plan: lastResult?.plan ? { goal: lastResult.plan.goal, steps: lastResult.plan.steps.map((x) => x.text) } : null, denied: lastResult?.denied ?? [] }));
  process.exit(0);
}

function writeLast(e) {
  try { fs.mkdirSync(EON_HOME, { recursive: true }); fs.writeFileSync(lastErrorFile(), `${new Date().toISOString()} ${String(e?.message ?? e).slice(0, 800)}`); } catch { /* best effort */ }
}

main().catch((e) => {
  const why = explainError(e);
  writeLast(e);
  console.error(color.red(`eon: ${why.text}`) + (why.fix ? `\n  to fix it: ${why.fix}` : ''));
  process.exit(1);
});
