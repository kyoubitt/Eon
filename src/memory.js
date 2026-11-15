// Memory files: notes and instructions you write once and Eon reads at the start of every session.
// Three layers, later ones winning: yours for every project (~/.eon/EON.md), the project's (EON.md,
// shared with your team), and yours for this project only (EON.local.md). A line that is only
// "@path/to/file.md" is replaced by that file's content.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const PROJECT_FILES = ['EON.md', 'KEEL.md', 'AGENTS.md', 'CLAUDE.md'];
const LIMIT = 12000;

const userFile = () => path.join(os.homedir(), '.eon', 'EON.md');

/** The memory files that exist or would be created, per layer. */
export function memoryFiles(root) {
  const project = PROJECT_FILES.map((f) => path.join(root, f)).find((f) => fs.existsSync(f)) ?? path.join(root, 'EON.md');
  return [
    { scope: 'user', file: userFile() },
    { scope: 'project', file: project },
    { scope: 'local', file: path.join(root, 'EON.local.md') },
  ].map((m) => ({ ...m, exists: fs.existsSync(m.file), size: fs.existsSync(m.file) ? fs.statSync(m.file).size : 0 }));
}

function readWithImports(file, base, depth = 0, seen = new Set()) {
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch { return ''; }
  if (seen.has(file)) return '';
  seen.add(file);
  return text.split('\n').map((line) => {
    const m = /^\s*@(\S+)\s*$/.exec(line);
    if (!m || depth >= 3) return line;
    const target = path.resolve(path.dirname(file), m[1].replace(/^~(?=$|[\\/])/, os.homedir()));
    // Imports stay inside the project or your own Eon folder.
    const inside = [base, path.join(os.homedir(), '.eon')].some((dir) => target === dir || target.startsWith(dir + path.sep));
    if (!inside || !fs.existsSync(target)) return line;
    return `${readWithImports(target, base, depth + 1, seen).trim()}`;
  }).join('\n');
}

/** Everything the model should be told from memory files: { text, sources: [{ scope, file, chars }] }. */
export function loadMemory(root) {
  const parts = [], sources = [];
  for (const m of memoryFiles(root)) {
    if (!m.exists) continue;
    const text = readWithImports(m.file, root).trim();
    if (!text) continue;
    parts.push(`--- ${m.scope === 'user' ? 'your notes for every project' : m.scope === 'project' ? `the project's (${path.basename(m.file)})` : 'your notes for this project only'} ---\n${text}`);
    sources.push({ scope: m.scope, file: m.file, chars: text.length });
  }
  let text = parts.join('\n\n');
  if (text.length > LIMIT) text = `${text.slice(0, LIMIT)}\n... (cut)`;
  return { text, sources };
}

/** Add a note to a memory file, creating it if needed. Returns the file. */
export function appendMemory(root, scope, note) {
  const target = memoryFiles(root).find((m) => m.scope === scope);
  if (!target) throw new Error(`unknown memory scope "${scope}" (use user, project or local)`);
  fs.mkdirSync(path.dirname(target.file), { recursive: true });
  const existing = target.exists ? fs.readFileSync(target.file, 'utf8') : '';
  const header = target.exists ? '' : `# ${scope === 'user' ? 'Notes for every project' : path.basename(root)}\n\n`;
  fs.writeFileSync(target.file, `${existing}${existing && !existing.endsWith('\n') ? '\n' : ''}${header}- ${note.trim()}\n`);
  return target.file;
}
