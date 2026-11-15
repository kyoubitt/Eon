// "@file" mentions in a message: the file's lines are attached so the model need not ask for them.
import fs from 'node:fs';
import path from 'node:path';
import { readFile } from './tools.js';
import { isImage } from './vision.js';

const TOKEN = /(^|\s)@([\w./\\-]+)/g;

/** Replace @path mentions with the path, and add the files' lines to the end. */
export function expandMentions(text, root, { lines = 200 } = {}) {
  const attached = [], images = [];
  const body = String(text).replace(TOKEN, (whole, lead, p) => {
    if (isImage(p) && fs.existsSync(path.resolve(root, p))) { images.push(path.resolve(root, p)); return `${lead}${p}`; }
    try {
      const file = readFile(root, { path: p, start: 1, end: lines });
      if (!attached.some((a) => a.path === p)) attached.push({ path: p, text: file });
      return `${lead}${p}`;
    } catch { return whole; } // not a file: leave it alone
  });
  const context = attached.length ? `FILES THE USER MENTIONED (attached for you)\n${attached.map((a) => a.text).join('\n\n')}` : '';
  return {
    context,
    text: attached.length ? `${body}\n\nFILES THE USER MENTIONED (attached for you)\n${attached.map((a) => a.text).join('\n\n')}` : body,
    files: attached.map((a) => a.path),
    images,
  };
}

/** Files whose path matches what has been typed after "@", best matches first. */
export function matchFiles(prefix, files, limit = 6) {
  const q = prefix.toLowerCase();
  const score = (f) => {
    const l = f.toLowerCase(), base = l.split('/').pop();
    if (l.startsWith(q)) return 0;
    if (base.startsWith(q)) return 1;
    if (base.includes(q)) return 2;
    return l.includes(q) ? 3 : -1;
  };
  return files.map((f) => [score(f), f]).filter(([s]) => s >= 0).sort((a, b) => a[0] - b[0] || a[1].length - b[1].length).slice(0, limit).map(([, f]) => f);
}

export const isFile = (root, p) => { try { return fs.statSync(`${root}/${p}`).isFile(); } catch { return false; } };
