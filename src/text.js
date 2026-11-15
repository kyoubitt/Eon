// Text measuring and wrapping that understands colour codes, and a small markdown renderer.
import { color } from './ui.js';

const TOKEN = /\x1b\[[0-9;?]*[A-Za-z]|./gsu;
const RESET = '\x1b[0m';

export const visibleLength = (s) => [...String(s).replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '')].length;

/** Wrap text to a width, counting only visible characters and carrying colours across line breaks. */
export function wrapAnsi(text, width) {
  const out = [];
  for (const raw of String(text).replace(/\t/g, '  ').split('\n')) {
    let line = '', vis = 0, active = '', spaceAt = -1, spaceVis = 0, activeAtSpace = '';
    for (const [tok] of raw.matchAll(TOKEN)) {
      if (tok[0] === '\x1b' && tok.length > 1) {
        line += tok;
        active = tok === RESET ? '' : active + tok;
        continue;
      }
      if (vis === width) {
        if (tok === ' ') { out.push(line + (active ? RESET : '')); line = active; vis = 0; spaceAt = -1; continue; }
        if (spaceAt >= 0) {
          out.push(line.slice(0, spaceAt) + (activeAtSpace ? RESET : ''));
          line = activeAtSpace + line.slice(spaceAt + 1);
          vis -= spaceVis + 1;
        } else {
          out.push(line + (active ? RESET : ''));
          line = active;
          vis = 0;
        }
        spaceAt = -1;
      }
      if (tok === ' ') { spaceAt = line.length; spaceVis = vis; activeAtSpace = active; }
      line += tok;
      vis++;
    }
    out.push(active ? line + RESET : line);
  }
  return out;
}

/** Exactly `width` visible characters: cut if longer, pad with spaces if shorter. */
export function fit(text, width) {
  if (width <= 0) return '';
  let line = '', vis = 0, coloured = false;
  for (const [tok] of String(text).split('\n')[0].matchAll(TOKEN)) {
    if (tok[0] === '\x1b' && tok.length > 1) { line += tok; coloured = tok !== RESET; continue; }
    if (vis === width) break;
    line += tok;
    vis++;
  }
  return line + (coloured ? RESET : '') + ' '.repeat(width - vis);
}

/** At most `width` visible characters, with no padding. */
export const clip = (text, width) => fit(text, width).replace(/ +((?:\x1b\[0m)?)$/, '$1');

/** A prefix on the first line and the same width of spaces on the rest, so wrapped text lines up. */
export function hang(prefix, text, width) {
  const pad = ' '.repeat(visibleLength(prefix));
  return wrapAnsi(text, Math.max(10, width - visibleLength(prefix))).map((l, i) => (i ? pad : prefix) + l).join('\n');
}

/** **bold**, `code` and *italic* as terminal styles. */
export function inline(text) {
  return String(text)
    .replace(/`([^`\n]+)`/g, (_, x) => color.cyan(x))
    .replace(/\*\*([^*\n]+)\*\*/g, (_, x) => color.bold(x))
    .replace(/(?<![*\w])\*([^*\n]+)\*(?![*\w])/g, (_, x) => color.italic(x));
}

/** A model reply as terminal text: headings, lists, quotes, inline styles and fenced code. */
export function renderMarkdown(src, width) {
  const out = [];
  let fenced = false;
  for (const line of String(src).replace(/\r\n?/g, '\n').split('\n')) {
    const fence = /^\s*```(\w*)/.exec(line);
    if (fence) {
      fenced = !fenced;
      out.push(color.dim(fenced ? `  ┌ ${fence[1] || 'code'}` : '  └'));
      continue;
    }
    if (fenced) { out.push(`${color.dim('  │ ')}${clip(line, Math.max(10, width - 4))}`); continue; }
    const heading = /^#{1,6}\s+(.*)$/.exec(line);
    if (heading) { out.push(color.bold(inline(heading[1]))); continue; }
    const item = /^(\s*)([-*•]|\d+[.)])\s+(.*)$/.exec(line);
    if (item) { out.push(hang(`${item[1]}${/\d/.test(item[2]) ? item[2] : '•'} `, inline(item[3]), width)); continue; }
    if (/^\s*>/.test(line)) { out.push(color.dim(hang('▎ ', inline(line.replace(/^\s*>\s?/, '')), width))); continue; }
    if (/^\s*([-*_])\1{2,}\s*$/.test(line)) { out.push(color.dim('─'.repeat(Math.min(width, 40)))); continue; }
    out.push(...wrapAnsi(inline(line), width));
  }
  return out.join('\n');
}

/** Lay typed text out in rows of at most `room` characters; says where the cursor is. */
export function layoutInput(input, cur, room) {
  const rows = [], starts = [];
  let row = 0, col = 0, index = 0;
  for (const line of input.split('\n')) {
    const chunks = line.length ? line.match(new RegExp(`.{1,${room}}`, 'gs')) : [''];
    let used = 0;
    chunks.forEach((chunk, i) => {
      const start = index + used;
      if (cur >= start && (cur < start + chunk.length || (i === chunks.length - 1 && cur <= start + chunk.length))) { row = rows.length; col = cur - start; }
      rows.push(chunk); starts.push(start);
      used += chunk.length;
    });
    index += line.length + 1;
  }
  return { rows, starts, row, col };
}
