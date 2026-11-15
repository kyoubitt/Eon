#!/usr/bin/env node
// Try Eon without a browser or a login: a scripted "model" fixes a typo in a throwaway repository.
// Answer y to each question.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'eon-demo-'));
fs.writeFileSync(path.join(dir, 'greet.js'), 'const name = "wrold";\nconsole.log("hello " + name);\n');
const git = (...args) => spawnSync('git', args, { cwd: dir, stdio: 'ignore' });
git('init', '-q'); git('add', '-A'); git('-c', 'user.name=demo', '-c', 'user.email=demo@localhost', 'commit', '-q', '-m', 'start');
console.log(`Demo repository: ${dir}`);
const r = spawnSync(process.execPath, [path.join(here, 'bin', 'eon.js'), 'run', 'Fix the greeting', '--plain', '--model', 'mock', '--script', path.join(here, 'examples', 'demo-script.json')], { cwd: dir, stdio: 'inherit' });
process.exit(r.status ?? 1);
