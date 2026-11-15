// "eon inspect <site>": write down the structure of a chat page, without any of its text, so a page that
// Eon cannot read can be understood from one pasted file. The outline covers the chat area only.

/** Runs inside the page. Returns outline lines. No text content is ever read. */
export const OUTLINE = String.raw`(marks) => {
  const vis = (e) => { const r = e.getBoundingClientRect(), cs = getComputedStyle(e); return r.width > 2 && r.height > 2 && cs.visibility !== 'hidden' && cs.display !== 'none'; };
  const mask = (v) => String(v).replace(/[0-9a-f]{8,}(-[0-9a-f]{4,})*/gi, '#').replace(/\d{3,}/g, '#');
  const cut = (v, n) => { const m = mask(v); return m.length > n ? m.slice(0, n) + '…' : m; };
  const first = (sels, all) => {
    const out = [];
    for (const s of sels || []) { try { for (const e of document.querySelectorAll(s)) if (all || vis(e)) out.push(e); } catch {} if (out.length && !all) break; }
    return out;
  };
  const input = first(marks.input)[0], stop = first(marks.stop)[0];
  let send = first(marks.send)[0], guessed = false;
  if (!send && input) {
    // Not known: the control nearest the box that looks like a button (it is often disabled while the box is empty).
    for (let up = input.parentElement, i = 0; up && i < 4 && !send; up = up.parentElement, i++) {
      const found = [...up.querySelectorAll('button, [role="button"]')].filter((b) => vis(b) && !b.contains(input));
      if (found.length) { send = found[found.length - 1]; guessed = true; }
    }
  }
  const replies = first(marks.message, true);
  const lastReply = replies[replies.length - 1];
  const tag = new Map();
  const mark = (e, label) => { if (e) tag.set(e, [...(tag.get(e) || []), label]); };
  mark(input, 'INPUT'); mark(send, guessed ? 'SEND (a guess: the last button next to the box)' : 'SEND'); mark(stop, 'STOP'); replies.slice(-3).forEach((e) => mark(e, 'REPLY'));
  const thinking = (e) => /think|reason/i.test(e.className && e.className.baseVal === undefined ? String(e.className) : '') || e.tagName === 'DETAILS';
  for (const r of replies.slice(-3)) for (const e of r.querySelectorAll('*')) if (thinking(e)) mark(e, 'THINKING');
  if (lastReply && thinking(lastReply)) mark(lastReply, 'THINKING');
  // The chat area: the smallest element holding the box and the reply (or the box alone).
  let root = input || lastReply || document.body;
  while (root.parentElement && lastReply && !root.contains(lastReply)) root = root.parentElement;
  if (!lastReply) for (let i = 0; i < 4 && root.parentElement && root.parentElement !== document.body; i++) root = root.parentElement;
  const keep = new Set();
  for (const e of tag.keys()) { for (let n = e; n && n !== root.parentElement; n = n.parentElement) keep.add(n); }
  const inside = (e) => { for (const t of tag.keys()) if (t.contains(e) && !(t === e)) return true; return false; };
  const describe = (e) => {
    let s = e.tagName.toLowerCase();
    if (e.id) s += '#' + cut(e.id, 30);
    const c = typeof e.className === 'string' ? e.className.trim().split(/\s+/).filter(Boolean).slice(0, 6).map((x) => cut(x, 30)).join('.') : '';
    if (c) s += '.' + c;
    const attrs = [];
    for (const a of ['role', 'type', 'contenteditable', 'aria-label', 'aria-disabled', 'placeholder', 'name', 'disabled']) {
      if (e.hasAttribute(a)) attrs.push(a + '="' + cut(e.getAttribute(a), 40) + '"');
    }
    for (const a of e.attributes) if (/^data-/.test(a.name)) attrs.push(a.name + (a.value ? '="' + cut(a.value, 20) + '"' : ''));
    return s + (attrs.length ? ' [' + attrs.join(' ') + ']' : '');
  };
  const lines = [];
  const walk = (e, depth, subtree) => {
    const labels = tag.get(e);
    lines.push('  '.repeat(depth) + describe(e) + (labels ? '   <== ' + [...new Set(labels)].join(', ') : '') + (vis(e) ? '' : '   (hidden)'));
    const kids = [...e.children];
    if (depth > 14) return;
    const deeper = subtree > 0 || tag.has(e);
    let shown = 0;
    for (const k of kids) {
      if (keep.has(k)) walk(k, depth + 1, deeper ? 3 : 0);
      else if (subtree > 0 && shown < 12) { shown++; walk(k, depth + 1, subtree - 1); }
      else if (!deeper || shown >= 12) { /* collapsed below */ }
    }
    const hiddenKids = kids.filter((k) => !keep.has(k)).length - shown;
    if (hiddenKids > 0 && !(subtree > 0 && shown >= kids.length)) {
      const names = [...new Set(kids.filter((k) => !keep.has(k)).map((k) => k.tagName.toLowerCase() + (typeof k.className === 'string' && k.className.trim() ? '.' + cut(k.className.trim().split(/\s+/)[0], 24) : '')))].slice(0, 6);
      lines.push('  '.repeat(depth + 1) + '… ' + hiddenKids + ' more (' + names.join(', ') + '), not opened');
    }
  };
  walk(root, 0, tag.has(root) ? 3 : 0);
  return { lines, found: { input: Boolean(input), send: Boolean(send) && !guessed, sendGuess: guessed, reply: replies.length, stop: Boolean(stop) } };
}`;

/** The outline of the chat area of a page, given the selectors Eon uses for it. */
export async function inspectPage(page, marks) {
  return page.evaluate(`(${OUTLINE})(${JSON.stringify(marks)})`);
}

export function inspectReport({ site, label, url, marks, outline, saved }) {
  const f = outline.found;
  const found = (ok) => (ok ? 'found' : 'NOT FOUND');
  const L = [
    `Eon inspect report for ${site} (${label})`,
    `page: ${url.replace(/[?#].*$/, '')}`,
    `time: ${new Date().toISOString()}`,
    'This holds page structure only: tag names, ids, classes and attribute names. No text from the page, no chat titles.',
    '',
    'WHAT EON USED',
    `  message box   ${found(f.input)}   ${marks.input.join(' | ')}`,
    `  send button   ${f.send ? 'found' : f.sendGuess ? 'not known (a guess is marked SEND below)' : 'NOT FOUND'}   ${marks.send.join(' | ') || '(none; Enter is used)'}`,
    `  replies       ${f.reply ? `${f.reply} found` : 'NOT FOUND'}   ${marks.message.join(' | ')}`,
    `  stop button   ${found(f.stop)}   ${marks.stop.join(' | ') || '(none)'}`,
    ...(Object.keys(saved ?? {}).length ? ['', 'SAVED SELECTORS (learned or taught)', ...Object.entries(saved).filter(([, v]) => v).map(([k, v]) => `  ${k}: ${[].concat(v).join(' | ')}`)] : []),
    '',
    'CHAT AREA OUTLINE   (<== marks what Eon took for each part)',
    ...outline.lines,
  ];
  return L.join('\n');
}

/** Open the site, send one test message, write the outline file. WebChat is passed in (as runChecks does). */
export async function runInspect(site, ui, { WebChat, dir, selectors }) {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const chat = new WebChat(site, { ui, selectors });
  try {
    await chat.newChat();
    await chat.send('Eon is checking this page. Reply with the single word: ready');
    const { marks, outline, url } = await chat.describe();
    const saved = (() => { try { return JSON.parse(fs.readFileSync(path.join(dir, 'selectors.json'), 'utf8'))[site] ?? {}; } catch { return {}; } })();
    const text = inspectReport({ site, label: chat.sel.label, url, marks, outline, saved });
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `inspect-${site}.txt`);
    fs.writeFileSync(file, `${text}\n`);
    return { file, text, found: outline.found };
  } finally { await chat.close?.().catch(() => {}); }
}
