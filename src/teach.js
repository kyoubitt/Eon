// Point-and-click setup for a chat site. Eon cannot know every site's page layout in advance,
// so you click the message box and then a reply in the browser window, and Eon works out
// the selectors from what you clicked.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const TEST_PROMPT = 'Reply with exactly one word: pong';

// Runs inside the chat page. Picks the clicked element's selector from attributes that tend to stay the same.
const PAGE_SCRIPT = `(() => {
  if (window.__eonStart) return;
  const unstable = (c) => !c || c.length > 40 || /\\d{3,}/.test(c) || /^(_|css-|jsx-|sc-|svelte-)/.test(c) || /^[a-z]{1,3}[-_][0-9a-f]{4,}$/i.test(c);
  const esc = (v) => String(v).replace(/(["\\\\])/g, '\\\\$1');
  const selector = (el, allowBare) => {
    const tag = el.tagName.toLowerCase();
    if (el.id && !/\\d{4,}/.test(el.id)) return '#' + CSS.escape(el.id);
    for (const a of ['data-testid', 'data-message-author-role', 'data-test-id', 'role', 'aria-label', 'contenteditable', 'placeholder']) {
      const v = el.getAttribute(a);
      if (v !== null && v.length < 60) return tag + '[' + a + '="' + esc(v) + '"]';
    }
    const cls = [...el.classList].filter((c) => !unstable(c)).slice(0, 2);
    if (cls.length) return tag + '.' + cls.map((c) => CSS.escape(c)).join('.');
    return allowBare ? tag : null;
  };
  const NORM = (t) => t.replace(/\\s+/g, ' ').trim();
  window.__eonStart = (mode) => {
    if (mode === 'send') {
      // Watch the user send the test message. Nothing is blocked: the click or Enter really sends it.
      const done = (v) => { document.removeEventListener('click', onClick, true); document.removeEventListener('keydown', onKey, true); window.__eonPicked(JSON.stringify(v)); };
      const onClick = (e) => { const b = e.target.closest('button, [role=button], [type=submit]'); if (b) done({ selector: selector(b, true) }); };
      const onKey = (e) => { if (e.key === 'Enter' && !e.shiftKey && e.target.matches('textarea, input, [contenteditable], [role=textbox]')) done({ enter: true }); };
      document.addEventListener('click', onClick, true);
      document.addEventListener('keydown', onKey, true);
      return;
    }
    const style = document.createElement('style');
    style.textContent = '.__eon-hover{outline:3px solid #e8590c !important;outline-offset:1px !important;cursor:crosshair !important}';
    document.documentElement.appendChild(style);
    let last = null;
    const over = (e) => { last?.classList.remove('__eon-hover'); last = e.target; last.classList.add('__eon-hover'); };
    const click = (e) => {
      e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
      document.removeEventListener('mouseover', over, true); document.removeEventListener('click', click, true);
      last?.classList.remove('__eon-hover'); style.remove();
      let found = null;
      if (mode === 'input') {
        let el = e.target;
        for (let i = 0; el && i < 6 && !found; i++, el = el.parentElement) {
          if (el.matches('textarea, input, [contenteditable], [role=textbox]')) found = el;
          else { const inner = el.querySelector('textarea, [contenteditable="true"], [role=textbox]'); if (inner) found = inner; }
        }
        found = found || e.target;
        window.__eonPicked(JSON.stringify({ selector: selector(found, true) }));
      } else {
        // The reply container: the largest ancestor that holds the reply but not the message we sent.
        let best = null, el = e.target;
        for (let i = 0; el && i < 9 && el !== document.body; i++, el = el.parentElement) {
          const text = NORM(el.innerText || '');
          if (/exactly one word/i.test(text)) break;
          const sel = selector(el, false);
          if (sel && /pong/i.test(text)) best = sel;
        }
        window.__eonPicked(JSON.stringify({ selector: best }));
      }
    };
    document.addEventListener('mouseover', over, true);
    document.addEventListener('click', click, true);
  };
})()`;

const selectorsFile = () => path.join(os.homedir(), '.eon', 'selectors.json');

/** Save the selectors for one site, keeping anything else already in the file. */
export function saveSelectors(site, selectors) {
  const file = selectorsFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const all = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
  all[site] = { ...(all[site] ?? {}), ...selectors };
  fs.writeFileSync(file, JSON.stringify(all, null, 2));
}

/** Walk the user through clicking the message box and a reply. Returns the saved selectors, or null. */
export async function teachSite(chat, site, ui) {
  await chat.start();
  const page = chat.page;
  await page.goto(chat.sel.url, { waitUntil: 'domcontentloaded' });
  let resolver;
  await page.exposeFunction('__eonPicked', (v) => resolver?.(JSON.parse(v)));
  const pick = (mode) => new Promise((resolve) => {
    resolver = resolve;
    page.evaluate(PAGE_SCRIPT).then(() => page.evaluate((m) => window.__eonStart(m), mode));
  });

  ui.print(`In the browser window, make sure you are logged in to ${chat.sel.label} and can see an empty chat.`);
  await ui.ask('Press Enter when ready. ');
  await page.bringToFront();
  ui.print('Now CLICK the box where you type your message.');
  const input = await pick('input');
  if (!input.selector) { ui.print('Eon could not tell which element that was. Try again.'); return null; }
  ui.print(`  message box: ${input.selector}`);

  await page.locator(input.selector).first().fill(TEST_PROMPT);
  ui.print('Eon typed a test message into the box. Now send it the way you normally would:');
  ui.print('  CLICK the Send button, or press Enter if the site has no button.');
  const send = await pick('send');
  ui.print(send.enter ? '  sends with: Enter' : `  Send button: ${send.selector}`);
  ui.print('Wait for the reply, then CLICK on the words of the reply.');
  const reply = await pick('reply');
  if (!reply.selector) {
    ui.print('Eon could not find a stable way to describe the reply. Click the reply text itself and try again, or set "message" by hand in ~/.eon/selectors.json.');
    saveSelectors(site, { input: input.selector, send: send.enter ? null : send.selector });
    return null;
  }
  ui.print(`  reply text: ${reply.selector}`);
  const learned = { input: input.selector, message: reply.selector, send: send.enter ? null : send.selector };
  saveSelectors(site, learned);
  return learned;
}

export { TEST_PROMPT };
