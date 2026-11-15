// Finding the parts of a chat page without being told where they are.
// The code in PAGE_API runs inside the chat page. It looks at what the page shows (a big box near the
// bottom, a button beside it, new text that appeared after sending) rather than at class names, because
// sites rename their classes and their markup changes often.

export const PAGE_API = String.raw`(() => {
  if (window.__eon) return;
  const unstable = (c) => !c || c.length > 40 || /\d{3,}/.test(c) || /^(_|css-|jsx-|sc-|svelte-)/.test(c) || /^[a-z]{1,3}[-_][0-9a-f]{4,}$/i.test(c);
  const esc = (v) => String(v).replace(/(["\\])/g, '\\$1');
  const visible = (el) => {
    if (!el || !el.getBoundingClientRect) return false;
    const r = el.getBoundingClientRect(), cs = getComputedStyle(el);
    return r.width > 8 && r.height > 8 && cs.visibility !== 'hidden' && cs.display !== 'none' && cs.opacity !== '0';
  };
  // A selector built from attributes and class names that tend to stay the same.
  const selectorFor = (el, allowBare) => {
    const tag = el.tagName.toLowerCase();
    if (el.id && !/\d{4,}/.test(el.id)) return '#' + CSS.escape(el.id);
    for (const a of ['data-testid', 'data-message-author-role', 'data-test-id', 'role', 'aria-label', 'contenteditable', 'placeholder']) {
      const v = el.getAttribute(a);
      if (v !== null && v.length < 60) return tag + '[' + a + '="' + esc(v) + '"]';
    }
    const cls = [...el.classList].filter((c) => !unstable(c)).slice(0, 2);
    if (cls.length) return tag + '.' + cls.map((c) => CSS.escape(c)).join('.');
    return allowBare ? tag : null;
  };
  const matchesOnly = (sel, el) => {
    try { const all = [...document.querySelectorAll(sel)]; return all.includes(el) && all.filter(visible).length === 1; } catch { return false; }
  };
  // A selector that finds this one element: its own, or a chain with its parents.
  const unique = (el, allowBare) => {
    const own = selectorFor(el, allowBare);
    if (own && matchesOnly(own, el)) return own;
    const parts = [];
    for (let cur = el, i = 0; cur && cur !== document.body && i < 5; cur = cur.parentElement, i++) {
      parts.unshift(selectorFor(cur, true));
      const path = parts.join(' > ');
      if (matchesOnly(path, el)) return path;
    }
    return null;
  };

  // The message box: a big editable area near the bottom that talks about messages, not search or login.
  const findInput = () => {
    const els = [...document.querySelectorAll('textarea, [contenteditable]:not([contenteditable="false"]), [role="textbox"], input[type="text"], input:not([type])')]
      .filter((el) => visible(el) && !el.disabled && !el.readOnly);
    const score = (el) => {
      const r = el.getBoundingClientRect();
      const label = [el.getAttribute('placeholder'), el.getAttribute('aria-label'), el.getAttribute('data-placeholder'), el.id, el.className].join(' ').toLowerCase();
      let s = Math.min(r.width, 900) / 300 + Math.min(r.height, 200) / 100;
      if (r.bottom > innerHeight * 0.5) s += 3;
      if (/message|ask|chat|prompt|type|send|talk/.test(label)) s += 3;
      if (/search|find|filter|email|password|username|title|name|code/.test(label)) s -= 6;
      if (el.tagName === 'TEXTAREA') s += 1;
      if (el.closest('[role=search], nav, header')) s -= 5;
      return s;
    };
    const ranked = els.map((el) => [score(el), el]).sort((a, b) => b[0] - a[0]);
    if (!ranked.length || ranked[0][0] < 2) return null;
    const sel = unique(ranked[0][1], true);
    return sel ? { selector: sel, score: ranked[0][0] } : null;
  };

  // Which buttons beside the box are disabled right now: the Send button is the one that wakes up when text arrives.
  const nearButtons = (input) => {
    const out = [];
    let cur = input.parentElement;
    for (let d = 0; cur && d < 7; d++, cur = cur.parentElement) {
      for (const el of cur.querySelectorAll('button, [role="button"], [type="submit"], input[type="submit"], a[role="button"]')) if (!out.includes(el)) out.push(el);
    }
    return out;
  };
  const isOff = (el) => el.disabled || el.getAttribute('aria-disabled') === 'true';
  const snapButtons = (inputSelector) => {
    const input = [...document.querySelectorAll(inputSelector)].find(visible);
    window.__eon.before = new Map();
    if (input) for (const el of nearButtons(input)) window.__eon.before.set(el, isOff(el));
  };
  const sendButton = (inputSelector) => {
    const input = [...document.querySelectorAll(inputSelector)].find(visible);
    if (!input) return null;
    const ir = input.getBoundingClientRect();
    let best = null;
    let depth = 0;
    for (let cur = input.parentElement; cur && depth < 7; cur = cur.parentElement, depth++) {
      for (const el of cur.querySelectorAll('button, [role="button"], [type="submit"], input[type="submit"], a[role="button"]')) {
        if (el === input || el.contains(input) || !visible(el) || isOff(el)) continue;
        const r = el.getBoundingClientRect();
        const label = [el.getAttribute('aria-label'), el.getAttribute('title'), el.getAttribute('data-testid'), el.id, typeof el.className === 'string' ? el.className : '', (el.textContent || '').trim().slice(0, 20)].join(' ').toLowerCase();
        let s = 0;
        if (/send|submit|composer-submit|arrow-up|paper-?plane/.test(label)) s += 10;
        if (el.querySelector('svg, img') && (el.textContent || '').trim().length < 3) s += 3;
        if (r.left >= ir.left + ir.width * 0.5) s += 2 + (r.left - ir.left) / ir.width;
        if (Math.abs(r.top + r.height / 2 - (ir.top + ir.height / 2)) < Math.max(80, ir.height)) s += 2;
        if (window.__eon.before && window.__eon.before.get(el) === true) s += 8; // it was off before the text arrived
        if (/attach|upload|plus|add|voice|mic|record|speech|search|think|reason|deep|web|share|copy|clear|new chat|stop|dictate|tools|model/.test(label)) s -= 10;
        s -= depth * 0.3;
        if (!best || s > best.s) best = { s, el };
      }
      if (best && best.s >= 12) break;
    }
    return best && best.s >= 3 ? best.el : null;
  };

  // Which elements changed after the message was sent: the reply is the longest new text that is not our own message.
  const watch = () => {
    window.__eon.rec = new Map();
    if (window.__eon.obs) return;
    window.__eon.obs = new MutationObserver((muts) => {
      for (const m of muts) {
        const t = m.target.nodeType === 1 ? m.target : m.target.parentElement;
        if (t) window.__eon.rec.set(t, Date.now());
        for (const a of m.addedNodes) { const e = a.nodeType === 1 ? a : a.parentElement; if (e) window.__eon.rec.set(e, Date.now()); }
      }
    });
    window.__eon.obs.observe(document.body, { childList: true, subtree: true, characterData: true });
  };
  const pickReply = (snippet) => {
    const ban = (snippet || '').toLowerCase();
    let best = null;
    for (const el of window.__eon.rec.keys()) {
      if (!el.isConnected || !visible(el) || el.closest('textarea, [contenteditable], form, nav, header, button')) continue;
      const text = (el.innerText || '').trim();
      if (text.length < 4 || (ban && text.toLowerCase().includes(ban))) continue;
      if (!best || text.length > best.len) best = { el, len: text.length };
    }
    if (!best) return null;
    let chosen = best.el, el = best.el;
    for (let i = 0; i < 6 && el.parentElement && el.parentElement !== document.body; i++) {
      const p = el.parentElement, t = (p.innerText || '').trim();
      if ((ban && t.toLowerCase().includes(ban)) || t.length > best.len * 1.5 + 40) break;
      el = p;
      if (selectorFor(p, false)) chosen = p;
    }
    const selector = selectorFor(chosen, false) || selectorFor(best.el, false);
    return selector ? { selector, text: (chosen.innerText || '').trim().slice(0, 200) } : null;
  };

  window.__eon = { findInput, snapButtons, sendButton, watch, pickReply, selectorFor };
})()`;

/** Put the page-side helpers into the current page (once per page load). */
export async function installPageApi(page) {
  await page.evaluate(PAGE_API);
}

/** Find the message box by looking at the page. Returns { selector } or null. */
export async function discoverInput(page) {
  await installPageApi(page);
  return page.evaluate(() => window.__eon.findInput());
}

/** Remember which buttons are off before text is typed, and start watching for the reply. */
export async function prepareSend(page, inputSelector) {
  await installPageApi(page);
  await page.evaluate((sel) => { window.__eon.snapButtons(sel); window.__eon.watch(); }, inputSelector);
}

/** The Send button as an element handle, or null. */
export async function discoverSendButton(page, inputSelector) {
  await installPageApi(page);
  const handle = await page.evaluateHandle((sel) => window.__eon.sendButton(sel), inputSelector);
  return handle.asElement();
}

/** The reply container, found from what changed on the page since prepareSend. Returns { selector } or null. */
export async function discoverReply(page, sentText) {
  await installPageApi(page);
  return page.evaluate((snippet) => window.__eon.pickReply(snippet), String(sentText).replace(/\s+/g, ' ').trim().slice(0, 40));
}
