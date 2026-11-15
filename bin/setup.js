#!/usr/bin/env node
// One-command install: npm run setup
// Checks what Eon needs, installs it, and makes the "eon" command available.
// Pass --no-browser to skip downloading Chromium (if you will set EON_BROWSER_CHANNEL=chrome).
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { bashPath } from '../src/tools.js';

const here = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fail = (message) => { console.error(`\nSetup stopped: ${message}`); process.exit(1); };
const has = (cmd) => spawnSync(cmd, ['--version'], { stdio: 'ignore', shell: true }).status === 0;
const run = (title, cmd) => {
  console.log(`\n== ${title}\n   ${cmd}`);
  // npm and npx are .cmd files on Windows, so they have to go through a shell.
  if (spawnSync(cmd, { cwd: here, stdio: 'inherit', shell: true }).status !== 0) fail(`"${cmd}" did not finish. Fix the error above and run "npm run setup" again.`);
};

if (Number(process.versions.node.split('.')[0]) < 18) fail(`Eon needs Node.js 18 or newer; this is ${process.versions.node}. Install the current LTS from nodejs.org.`);
if (!has('git')) fail('Git is not installed. Install it from git-scm.com (on Windows: winget install Git.Git), reopen the terminal, and run "npm run setup" again.');
try { bashPath(); } catch (e) { fail(e.message); }

run('Installing Eon\'s one dependency (Playwright)', 'npm install');
if (process.argv.includes('--no-browser')) console.log('\n== Skipping the Chromium download (--no-browser)');
else run('Downloading the Chromium browser Eon drives', 'npx playwright install chromium');
// npm link needs a global folder you may not own (common on Linux and Mac). If it fails, a small launcher is written instead.
console.log('\n== Making the "eon" command available everywhere\n   npm link');
if (spawnSync('npm link', { cwd: here, stdio: 'inherit', shell: true }).status !== 0) {
  const win = process.platform === 'win32';
  const dir = path.join(os.homedir(), win ? '.eon/bin' : '.local/bin');
  fs.mkdirSync(dir, { recursive: true });
  const target = path.join(here, 'bin', 'eon.js');
  const file = path.join(dir, win ? 'eon.cmd' : 'eon');
  fs.writeFileSync(file, win ? `@echo off\r\nnode "${target}" %*\r\n` : `#!/bin/sh\nexec node "${target}" "$@"\n`, { mode: 0o755 });
  console.log(`   npm link was not allowed, so a launcher was written: ${file}\n   Add this folder to your PATH if "eon" is not found: ${dir}`);
}

console.log(`
Eon is installed. Next:

  eon login          log in to DeepSeek once, in the window that opens
  eon check deepseek confirm Eon can talk to the site
  eon                run this inside the project you want to work on
`);
