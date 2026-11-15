// What Eon can learn about a project without asking a model: its instructions file and its commands.
import fs from 'node:fs';
import path from 'node:path';

const INSTRUCTION_FILES = ['EON.md', 'KEEL.md', 'AGENTS.md', 'CLAUDE.md'];

/** The project's own instructions for Eon, from the first of these files that exists. */
export function projectInstructions(root) {
  for (const file of INSTRUCTION_FILES) {
    try {
      const text = fs.readFileSync(path.join(root, file), 'utf8').trim();
      if (text) return { file, text: text.length > 6000 ? `${text.slice(0, 6000)}\n... (cut)` : text };
    } catch { /* try the next one */ }
  }
  return null;
}

/** Build, test, lint and run commands found in the usual places. */
export function detectCommands(root) {
  const found = {};
  const has = (f) => fs.existsSync(path.join(root, f));
  const read = (f) => { try { return fs.readFileSync(path.join(root, f), 'utf8'); } catch { return ''; } };
  if (has('package.json')) {
    let scripts = {};
    try { scripts = JSON.parse(read('package.json')).scripts ?? {}; } catch { /* unreadable package.json */ }
    const run = has('pnpm-lock.yaml') ? 'pnpm run' : has('yarn.lock') ? 'yarn' : 'npm run';
    for (const name of ['test', 'build', 'lint', 'typecheck', 'dev', 'start']) {
      if (scripts[name]) found[name === 'dev' || name === 'start' ? 'run' : name] ??= name === 'test' && run === 'npm run' ? 'npm test' : `${run} ${name}`;
    }
  }
  if (has('pyproject.toml') || has('pytest.ini') || has('setup.cfg') || has('requirements.txt')) found.test ??= 'pytest';
  if (has('go.mod')) { found.test ??= 'go test ./...'; found.build ??= 'go build ./...'; }
  if (has('Cargo.toml')) { found.test ??= 'cargo test'; found.build ??= 'cargo build'; }
  if (has('Makefile')) {
    const targets = new Set([...read('Makefile').matchAll(/^([a-z][\w-]*):/gm)].map((m) => m[1]));
    for (const t of ['test', 'build', 'lint']) if (targets.has(t)) found[t] ??= `make ${t}`;
  }
  return found;
}

export const describeCommands = (found) => Object.entries(found).map(([k, v]) => `${k}: ${v}`).join('\n');

/** A starting EON.md, filled in with what was detected. */
export function instructionsTemplate(root) {
  const found = detectCommands(root);
  return `# ${path.basename(root)}

Instructions for Eon. Eon reads this file at the start of every session.

## Commands
${Object.keys(found).length ? Object.entries(found).map(([k, v]) => `- ${k}: \`${v}\``).join('\n') : '- (none detected; add the commands to build, test and run this project)'}

## Conventions
- (how code here is written: style, naming, where things go)

## Careful with
- (files or areas that should not be changed without asking)
`;
}
