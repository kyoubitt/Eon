// Drives a free web chat (DeepSeek, Gemini and others) in a real browser window that you log in to.
//
// It behaves like a person using their own account: the browser is your own Chrome with a normal
// profile when it can be, messages are pasted rather than typed key by key, there are short random
// pauses, and when a site asks for a human check or does not send a message, Eon stops and asks you.
// It does not solve checks, spoof a browser fingerprint or hide that it is automated beyond what a
// normal browser does. Automating these chats may be against a site's terms.
//
// These sites can change their pages at any time. If Eon stops finding the input box or the replies,
// run "eon teach <site>", or override the selectors in ~/.eon/selectors.json.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { LimitError, Interrupted, looksLimited } from './limits.js';
import { migrateHome } from '../migrate.js';
import { looksComplete } from '../protocol.js';
import { saveSelectors } from '../teach.js';
import { inspectPage } from '../inspect.js';
import { discoverInput, discoverSendButton, discoverReply, prepareSend } from '../discover.js';

const home = () => { migrateHome(); return path.join(os.homedir(), '.eon'); };

// Each part of a page has several candidate selectors, tried in order, because these sites change their
// markup. The first four lists come from what public userscripts use; none has been checked on the live sites.
// When none match, Eon looks at the page and finds the part itself (src/discover.js).
const BUILT_IN = {
  deepseek: {
    label: 'DeepSeek', url: 'https://chat.deepseek.com/', images: false, // reads the text in a picture but cannot see it
    input: ['textarea[placeholder*="Message" i]', 'textarea#chat-input', 'textarea'],
    message: ['.ds-markdown'],
  },
  gemini: {
    label: 'Gemini', url: 'https://gemini.google.com/app',
    input: ['rich-textarea .ql-editor', 'div[contenteditable="true"][role="textbox"]', '[contenteditable="true"]'],
    message: ['message-content', '.model-response-text', '.response-content'],
    send: ['button[aria-label*="Send" i]', 'button.send-button'],
  },
  chatgpt: {
    label: 'ChatGPT', url: 'https://chatgpt.com/',
    input: ['#prompt-textarea', 'div.ProseMirror[contenteditable="true"]', 'textarea'],
    message: ['[data-message-author-role="assistant"]'],
    stop: ['[data-testid="stop-button"]', 'button[aria-label*="Stop" i]'],
    send: ['[data-testid="send-button"]', 'button#composer-submit-button'],
  },
  claude: {
    label: 'Claude', url: 'https://claude.ai/new',
    input: ['div.ProseMirror[contenteditable="true"]', '[contenteditable="true"]'],
    message: ['.font-claude-response', '.font-claude-message', '[data-testid="assistant-message"]'],
    stop: ['[data-is-streaming="true"]', 'button[aria-label*="Stop" i]'],
    send: ['button[aria-label*="Send" i]'],
  },
  qwen: {
    label: 'Qwen', url: 'https://chat.qwen.ai/',
    input: ['textarea#chat-input', 'textarea'],
    message: ['.markdown-content-container', '.markdown-prose', '.response-message-content'],
    send: ['button#send-message-button', 'button[type="submit"]'],
  },
  mistral: {
    label: 'Mistral', url: 'https://chat.mistral.ai/chat',
    input: ['div.ProseMirror[contenteditable="true"]', 'textarea'],
    message: ['[data-message-author-role="assistant"]', '.prose'],
    send: ['button[type="submit"]', 'button[aria-label*="Send" i]'],
  },
  grok: {
    label: 'Grok', url: 'https://grok.com/',
    input: ['textarea', 'div[contenteditable="true"]'],
    message: ['.response-content-markdown', '.message-bubble'],
    send: ['button[type="submit"]', 'button[aria-label*="Submit" i]'],
  },
  kimi: {
    label: 'Kimi', url: 'https://www.kimi.com/',
    input: ['div[contenteditable="true"]', 'textarea'],
    message: ['.markdown-container', '.segment-assistant .markdown'],
    send: ['.send-button', 'div[class*="send" i]'],
  },
};

/** Built-in sites plus any you add in ~/.eon/sites.json: { "name": { "label", "url", "input", "message", "stop", "send" } } */
export function sites() {
  const file = path.join(home(), 'sites.json');
  const extra = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
  return { ...BUILT_IN, ...extra };
}

const SEND_GUESSES = [
  'button[type="submit"]', 'button[aria-label*="send" i]', '[role="button"][aria-label*="send" i]',
  '[data-testid*="send" i]', 'button[title*="send" i]', 'button:has(svg[aria-label*="send" i])',
];

// "normal" pace is for a person; "slow" is gentler still; "fast" is for tests.
const pace = () => ({ slow: 2, normal: 1, fast: 0.02 }[process.env.EON_PACE] ?? 1);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pause = (min, max) => sleep((min + Math.random() * (max - min)) * pace());

// ---- the browser -----------------------------------------------------------------------------

let context = null;
let browser = null;
let attached = false;
let firstPageTaken = false;

function loadPlaywright() {
  return import('playwright').then((m) => m.chromium, () => {
    try { return createRequire(import.meta.url)('playwright').chromium; } catch {
      throw new Error('Playwright is not installed. Run: npm install playwright && npx playwright install chromium');
    }
  });
}

/** Your own Chrome or Edge, if there is one. */
export function findChrome() {
  if (process.env.EON_CHROME_PATH) return process.env.EON_CHROME_PATH;
  const candidates = [];
  if (process.platform === 'win32') {
    for (const base of [process.env.PROGRAMFILES, process.env['PROGRAMFILES(X86)'], process.env.LOCALAPPDATA].filter(Boolean)) {
      candidates.push(path.join(base, 'Google', 'Chrome', 'Application', 'chrome.exe'), path.join(base, 'Microsoft', 'Edge', 'Application', 'msedge.exe'));
    }
  } else if (process.platform === 'darwin') {
    candidates.push('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge');
  } else {
    for (const name of ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser', 'microsoft-edge']) {
      const r = spawnSync('which', [name], { encoding: 'utf8' });
      if (r.status === 0 && r.stdout.trim()) candidates.push(r.stdout.trim());
    }
  }
  return candidates.find((c) => fs.existsSync(c)) ?? null;
}

const cdpPort = () => Number(process.env.EON_CDP_PORT) || 9333;
async function cdpUp(port) {
  try { return (await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(800) })).ok; } catch { return false; }
}

/**
 * Start your own browser as a normal window with its own profile and a local debugging port, and
 * connect to it. It is not started by an automation library, so it looks like an ordinary browser.
 */
async function attachBrowser(chromium) {
  const port = cdpPort();
  if (!(await cdpUp(port))) {
    const exe = findChrome();
    if (!exe) return null;
    const extra = (process.env.EON_CHROME_ARGS ?? '').split(' ').filter(Boolean);
    const child = spawn(exe, [`--remote-debugging-port=${port}`, `--user-data-dir=${path.join(home(), 'chrome')}`, '--no-first-run', '--no-default-browser-check', ...extra, 'about:blank'], { detached: true, stdio: 'ignore' });
    child.on('error', () => {});
    child.unref();
    for (let i = 0; i < 60 && !(await cdpUp(port)); i++) await sleep(250);
    if (!(await cdpUp(port))) return null;
  }
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  return browser.contexts()[0] ?? browser.newContext();
}

/** Playwright's own launch, as a fallback: your installed Chrome if it can be found, else Chromium. */
async function launchPlaywright(chromium) {
  const channels = process.env.EON_BROWSER_CHANNEL ? [process.env.EON_BROWSER_CHANNEL] : ['chrome', 'msedge', undefined];
  let last;
  for (const channel of channels) {
    try {
      return await chromium.launchPersistentContext(path.join(home(), 'browser'), {
        headless: process.env.EON_HEADLESS === '1', viewport: null, channel,
        ignoreDefaultArgs: ['--enable-automation'],
        args: ['--disable-blink-features=AutomationControlled', '--no-first-run'],
      });
    } catch (e) { last = e; }
  }
  throw last;
}

async function openPage() {
  if (context) { try { context.pages(); } catch { context = null; } }
  if (!context) {
    const chromium = await loadPlaywright();
    attached = false;
    if (process.env.EON_BROWSER !== 'playwright') {
      try { context = await attachBrowser(chromium); attached = Boolean(context); } catch { context = null; }
    }
    context ??= await launchPlaywright(chromium);
    context.on?.('close', () => { context = null; });
    firstPageTaken = false;
  }
  if (!firstPageTaken && context.pages()[0]) { firstPageTaken = true; return context.pages()[0]; }
  firstPageTaken = true;
  return context.newPage();
}

/** Whether a browser profile exists, meaning you have opened a chat site with Eon before. */
export function profileExists() {
  return fs.existsSync(path.join(home(), 'chrome')) || fs.existsSync(path.join(home(), 'browser'));
}

export async function closeBrowser() {
  const [ctx, b, wasAttached] = [context, browser, attached];
  context = null; browser = null; attached = false; firstPageTaken = false;
  // Your own browser is left running; only the connection to it is closed.
  if (wasAttached) await b?.close().catch(() => {}); else await ctx?.close().catch(() => {});
}

// ---- one chat --------------------------------------------------------------------------------

const list = (x) => (x == null || x === false ? [] : Array.isArray(x) ? x : [x]);
const normalize = (t) => String(t).replace(/\s+/g, ' ').trim();
const tailOf = (t) => { const l = String(t).split('\n').map((x) => x.trim()).filter(Boolean); return (l[l.length - 1] ?? '').slice(-90); };

export class WebChat {
  constructor(site, { ui, minGapMs, jitterMs, stableMs = 3500, firstLookMs = 25000, selectors = {} } = {}) {
    const SITES = sites();
    if (!SITES[site]) throw new Error(`unknown chat site "${site}". Known: ${Object.keys(SITES).join(', ')}`);
    const file = path.join(home(), 'selectors.json');
    const saved = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8'))[site] ?? {} : {};
    this.sel = { stop: null, ...SITES[site], ...saved, ...selectors };
    this.name = `${this.sel.label} web`;
    this.limitKey = site;
    this.maxChars = Number(this.sel.maxChars ?? process.env.EON_MAX_PROMPT) || 30000;
    Object.assign(this, {
      ui, stableMs, firstLookMs, lastSend: 0, aborted: false, page: null, onProgress: null, lastBefore: [],
      minGapMs: minGapMs ?? 1500 * pace(), jitterMs: jitterMs ?? 2500 * pace(),
    });
  }

  #progress(info) { this.onProgress?.({ who: this.name, ...info }); }

  /** Stop whatever this driver is waiting for (Esc or Ctrl+C was pressed). */
  abort() { this.aborted = true; }

  /** A wait in short slices, so abort() ends it within a fraction of a second. */
  async #nap(ms) {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      if (this.aborted) throw new Interrupted();
      await sleep(Math.min(200, Math.max(0, end - Date.now())));
    }
    if (this.aborted) throw new Interrupted();
  }

  #pause(min, max) { return this.#nap((min + Math.random() * (max - min)) * pace()); }

  async start() {
    if (!this.page || this.page.isClosed()) this.page = await openPage();
  }

  /** True when the window was closed behind our back, so the conversation is gone. */
  chatLost() { return Boolean(this.page?.isClosed()); }

  /** The first visible element matching any of these selectors, with the selector that matched. */
  async #visibleMatch(selectors) {
    for (const selector of selectors) {
      const all = this.page.locator(selector);
      const n = Math.min(await all.count().catch(() => 0), 8);
      for (let i = 0; i < n; i++) if (await all.nth(i).isVisible().catch(() => false)) return { loc: all.nth(i), selector };
    }
    return null;
  }

  /** Wait for any visible match. (waitForSelector only watches the first match, which may be a hidden one.) */
  async #inputVisible(ms) {
    const end = Date.now() + ms;
    do {
      if (await this.#visibleMatch(list(this.sel.input))) return true;
      await this.#nap(200);
    } while (Date.now() < end);
    return false;
  }

  async #debug(tag) {
    try {
      const dir = path.join(home(), 'debug');
      fs.mkdirSync(dir, { recursive: true });
      const file = path.join(dir, `${this.limitKey}-${tag}-${Date.now()}.png`);
      await this.page.screenshot({ path: file });
      return file;
    } catch { return null; }
  }

  /** A page that asks you to prove you are human. Returns what it is, or null. */
  async #challenge(inputVisible) {
    const info = await this.page.evaluate(() => ({
      title: document.title,
      text: (document.body?.innerText ?? '').slice(0, 1500),
      frames: [...document.querySelectorAll('iframe')].filter((f) => f.offsetWidth > 100 && f.offsetHeight > 60).map((f) => f.src).join(' '),
    })).catch(() => null);
    if (!info) return null;
    const words = /just a moment|verify(ing)? (that )?you are (a )?human|are you (a )?(robot|human)|checking if the site connection is secure|unusual traffic|press (and|&) hold/i;
    // The text of a normal chat page may mention these words, so the page text only counts when there is no chat box.
    if (words.test(info.title) || (!inputVisible && words.test(info.text)) || /challenges\.cloudflare\.com|captcha/i.test(info.frames)) return 'a check that you are human';
    return null;
  }

  /** A login page: a password box, or a log in / sign up page with no chat on it. */
  async #loginWall() {
    return this.page.evaluate(() => {
      const vis = (e) => { const r = e.getBoundingClientRect(), cs = getComputedStyle(e); return r.width > 8 && r.height > 8 && cs.visibility !== 'hidden' && cs.display !== 'none'; };
      if ([...document.querySelectorAll('input[type="password"]')].some(vis)) return true;
      const t = (document.body?.innerText || '').slice(0, 2000);
      return /(^|\n)\s*(log in|sign in|login)\s*(\n|$)/i.test(t) && /(sign up|register|create account|continue with google|forgot password)/i.test(t);
    }).catch(() => false);
  }

  /** The chat is usable: a box to type in, no check, no login. */
  async #clear() {
    const visible = await this.#inputVisible(300);
    return visible && !(await this.#challenge(visible)) && !(await this.#loginWall());
  }

  async #handoffChallenge() {
    await this.page.bringToFront().catch(() => {});
    const shot = await this.#debug('check');
    const answer = await this.ui.ask(`⚠ ${this.sel.label} wants you to verify you are human. The browser window is in front.${shot ? `\n  (screenshot: ${shot})` : ''}\n  Solve the check there; Eon carries on by itself when it is done.\n[d]one continue / [s]kip this model: `, { until: () => this.#clear(), autoAnswer: 'd' });
    if (/^s/i.test(answer)) throw new LimitError(this.name, '', { reason: 'asked for a human check and you skipped it', kind: 'skipped' });
  }

  async #handoffLogin() {
    await this.page.bringToFront().catch(() => {});
    const answer = await this.ui.ask(`⚠ You are logged out of ${this.sel.label}. Log in in the browser window; Eon carries on by itself when you are in.\n[d]one continue / [s]kip this model: `, { until: () => this.#clear(), autoAnswer: 'd' });
    if (/^s/i.test(answer)) throw new LimitError(this.name, '', { reason: 'is logged out and you skipped it', kind: 'skipped' });
  }

  /** Wait for the chat box. If it is not there, find it by looking at the page; if that fails, a person has to help. */
  async #ready() {
    for (;;) {
      let visible = await this.#inputVisible(1500);
      if (await this.#challenge(visible)) { await this.#handoffChallenge(); continue; }
      if (await this.#loginWall()) { await this.#handoffLogin(); continue; }
      visible ||= await this.#inputVisible(6000);
      if (!visible) {
        const found = await discoverInput(this.page).catch(() => null);
        if (found?.selector) {
          this.sel.input = [found.selector, ...list(this.sel.input)];
          saveSelectors(this.limitKey, { input: found.selector });
          this.ui.print?.(`Eon found the ${this.sel.label} message box by looking at the page.`);
          visible = true;
        }
      }
      visible ||= await this.#inputVisible(8000);
      if (visible) return;
      await this.page.bringToFront().catch(() => {});
      const answer = await this.ui.ask(`Eon cannot see the ${this.sel.label} message box. Log in or complete any check in the browser window, then press Enter here.\nIf you are logged in and the box is there, type "teach" so you can click it and show Eon where it is: `);
      if (/^teach$/i.test(answer)) {
        const { teachSite } = await import('../teach.js');
        const got = await teachSite(this, this.limitKey, this.ui);
        if (got) Object.assign(this.sel, got);
      }
    }
  }

  async newChat() {
    await this.start();
    this.lastBefore = [];
    await this.page.goto(this.sel.url, { waitUntil: 'domcontentloaded' });
    await this.#ready();
  }

  // ---- reading replies ----

  /** How many reply nodes each candidate selector matches right now. */
  async #counts() {
    return Promise.all(list(this.sel.message).map((s) => this.page.locator(s).count().catch(() => 0)));
  }

  /**
   * The reply text since the message was sent: every new reply node, joined. Thinking blocks are left out
   * (their text is the model talking to itself) but they tell us the answer has not arrived yet.
   */
  async #fresh(before) {
    const sels = list(this.sel.message);
    for (let i = 0; i < sels.length; i++) {
      const all = this.page.locator(sels[i]);
      const n = await all.count().catch(() => 0);
      const from = before[i] ?? 0;
      if (n <= from) continue;
      const texts = [];
      let lastThinking = false;
      for (let k = from; k < n; k++) {
        const node = all.nth(k);
        lastThinking = await node.evaluate((el) => Boolean(el.closest('[class*="think" i], [class*="reason" i], details'))).catch(() => false);
        if (!lastThinking) texts.push(await node.innerText().catch(() => ''));
      }
      return { text: texts.join('\n\n').trim(), nodes: n - from, thinking: lastThinking };
    }
    return { text: '', nodes: 0, thinking: false };
  }

  async #generating() {
    const m = await this.#visibleMatch(list(this.sel.stop));
    return Boolean(m);
  }

  /** The known selectors found no reply: look at what changed on the page since the message was sent. */
  async #learnReply(sent, before) {
    const found = await discoverReply(this.page, sent).catch(() => null);
    if (!found?.selector || list(this.sel.message).includes(found.selector)) return false;
    const count = await this.page.locator(found.selector).count().catch(() => 0);
    if (!count) return false;
    this.sel.message = [found.selector, ...list(this.sel.message)];
    saveSelectors(this.limitKey, { message: found.selector });
    before.unshift(Math.max(0, count - 1));
    this.ui.print?.(`Eon found where ${this.sel.label} writes its replies by looking at the page.`);
    return true;
  }

  /** Read the reply once its text has stopped changing, is not cut off mid-block and is not still "thinking". */
  async #waitStable(before, maxMs = 600000) {
    const deadline = Date.now() + maxMs;
    let previous = null, since = Date.now();
    while (Date.now() < deadline) {
      await this.#nap(250);
      const { text, thinking } = await this.#fresh(before);
      if (text !== previous) {
        previous = text; since = Date.now();
        this.#progress(text ? { stage: 'replying', chars: text.length, tail: tailOf(text) } : { stage: 'thinking' });
        continue;
      }
      const quiet = Date.now() - since;
      // A reply that ends on a closed action block is almost certainly finished, so it needs less quiet.
      const closed = /\{\s*"action"|^[ \t]*(EDIT|WRITE)\b/m.test(text) && /(\}|```|>>>>>>>[ \t]*(REPLACE|END))\s*$/.test(text.trim());
      if (!text || quiet < (closed && !thinking ? Math.min(this.stableMs, 800) : this.stableMs) || (await this.#generating())) continue;
      if (thinking && quiet < 90000) continue; // the last block is a thinking block: the answer is still to come
      if (!looksComplete(text) && quiet < 20000) continue; // a pause in the middle of a code block is not the end
      return text;
    }
    throw new Error(`The ${this.sel.label} reply did not finish in time.`);
  }

  // ---- sending ----

  async #readInput(loc) {
    return loc.evaluate((el) => (el.value !== undefined ? el.value : el.innerText ?? el.textContent ?? '')).catch(() => '');
  }

  /** Click the box like a person, put the message in as one paste, and check it all arrived. */
  async #type(loc, text) {
    const box = await loc.boundingBox().catch(() => null);
    if (box) await this.page.mouse.move(box.x + box.width * (0.3 + Math.random() * 0.4), box.y + box.height / 2, { steps: 3 + Math.floor(Math.random() * 4) });
    await this.#pause(80, 250);
    await loc.click({ delay: 20 + Math.random() * 60 });
    const clear = async () => { await this.page.keyboard.press('Control+A'); await this.page.keyboard.press('Delete'); };
    await clear();
    await loc.fill(text).catch(() => {});
    let got = await this.#readInput(loc);
    if (normalize(got).length < normalize(text).length * 0.99) {
      // Editors that ignore fill() take a paste-style insert instead.
      await loc.click(); await clear();
      await this.page.keyboard.insertText(text);
      got = await this.#readInput(loc);
    }
    const have = normalize(got).length, want = normalize(text).length;
    if (have < want * 0.98) {
      const lowered = Math.max(2000, Math.floor(have * 0.9));
      this.maxChars = Math.min(this.maxChars, lowered);
      throw new Error(`The ${this.sel.label} message box only took ${have} of ${want} characters. Eon lowered its message limit for this site to ${this.maxChars}; send your message again.`);
    }
  }

  /** Whether the site took the message: the box emptied, a reply appeared, or it started generating. */
  async #sent(loc, before, text, ms) {
    const end = Date.now() + ms;
    do {
      if ((await this.#fresh(before)).nodes > 0) return true;
      if (await this.#generating()) return true;
      if (normalize(await this.#readInput(loc)).length < Math.min(10, text.length * 0.1)) return true;
      await this.#nap(120);
    } while (Date.now() < end);
    return false;
  }

  /** The Send button: a configured or common selector first, then the control that woke up beside the box. */
  async #sendButton(inputSelector) {
    const known = this.sel.send === undefined ? SEND_GUESSES : list(this.sel.send);
    for (const g of known) {
      const all = this.page.locator(g);
      const n = Math.min(await all.count().catch(() => 0), 4);
      for (let i = 0; i < n; i++) {
        const b = all.nth(i);
        if (await b.isVisible().catch(() => false) && await b.isEnabled().catch(() => false)) return b;
      }
    }
    return discoverSendButton(this.page, inputSelector).catch(() => null);
  }

  /** Press Enter, and if that does not send, the Send button, then Ctrl+Enter. Returns how it was sent, or null. */
  async #submit(found, before, text) {
    const click = async (b) => { await b.click({ delay: 30 + Math.random() * 80 }).catch(() => {}); };
    await this.#pause(100, 350);
    if (this.sel.send != null && this.sel.send !== undefined && list(this.sel.send).length) {
      const b = await this.#sendButton(found.selector);
      if (b) { await click(b); if (await this.#sent(found.loc, before, text, 5000)) return 'button'; }
    }
    await found.loc.press('Enter').catch(() => {});
    if (await this.#sent(found.loc, before, text, 5000)) return 'enter';
    const b = await this.#sendButton(found.selector);
    if (b) { await click(b); if (await this.#sent(found.loc, before, text, 5000)) return 'button'; }
    await found.loc.press('Control+Enter').catch(() => {});
    if (await this.#sent(found.loc, before, text, 4000)) return 'ctrl-enter';
    return null;
  }

  async #unsent() {
    if (await this.#loginWall()) { await this.#handoffLogin(); return 'retry'; }
    if (await this.#challenge(await this.#inputVisible(300))) { await this.#handoffChallenge(); return 'retry'; }
    const shot = await this.#debug('unsent');
    const answer = await this.ui.ask(`⚠ Eon typed your message but ${this.sel.label} did not send it.${shot ? `\n  (screenshot: ${shot})` : ''}\n  If the Send button is there, press it in the browser now.\n[k]eep waiting / [t]ry again / [s]kip this model: `);
    if (/^s/i.test(answer)) throw new LimitError(this.name, '', { reason: 'did not send a message and you skipped it', kind: 'skipped' });
    return /^t/i.test(answer) ? 'retry' : 'wait';
  }

  /** Whether this site's model can see pictures. Most can; DeepSeek's chat cannot. */
  get vision() { return this.sel.images !== false; }

  /** Put pictures in the page's file box (often hidden) and wait for the upload to settle. */
  async #attach(images) {
    const { checkImage } = await import('../vision.js');
    for (const f of images) checkImage(f);
    const input = this.page.locator('input[type="file"]');
    if (!(await input.count().catch(() => 0))) throw new Error(`${this.sel.label}'s page has no file upload box Eon can find, so it cannot take pictures here.`);
    await input.last().setInputFiles(images);
    this.#progress({ stage: 'uploading' });
    await this.#nap(1200 + 600 * images.length); // the page shows a thumbnail when it has the file
  }

  async send(text, { images = [] } = {}) {
    if (images.length && !this.vision) throw new Error(`${this.sel.label} cannot see pictures (it only reads the text in them). Use a helper model that can: /model vision gemini`);
    this.aborted = false;
    await this.start();
    const wait = this.lastSend + this.minGapMs + Math.random() * this.jitterMs - Date.now();
    if (wait > 0) await this.#nap(wait);
    await this.page.bringToFront().catch(() => {});
    await this.#ready();
    const before = await this.#counts();
    this.lastBefore = before;

    let how = null;
    for (let attempt = 0; attempt < 3 && !how; attempt++) {
      this.#progress({ stage: 'typing' });
      const found = await this.#visibleMatch(list(this.sel.input));
      if (!found) throw new Error(`${this.sel.label}'s message box disappeared.`);
      await prepareSend(this.page, found.selector).catch(() => {});
      if (images.length && attempt === 0) await this.#attach(images);
      await this.#type(found.loc, text);
      this.#progress({ stage: 'sending' });
      how = await this.#submit(found, before, text);
      if (!how && (await this.#unsent()) === 'wait') how = 'manual';
    }
    if (!how) throw new Error(`${this.sel.label} did not take the message after three tries.`);
    this.lastSend = Date.now();
    this.#progress({ stage: 'sent' });

    for (let attempt = 0; ; attempt++) {
      // A quick first look: if the known selectors are wrong, there is no point waiting a minute and a half.
      const deadline = Date.now() + (attempt === 0 ? this.firstLookMs : 90000);
      let fresh = { nodes: 0 };
      while (Date.now() < deadline && !(fresh = await this.#fresh(before)).nodes) await this.#nap(700);
      if (fresh.nodes) break;
      if (await this.#challenge(await this.#inputVisible(500))) { await this.#handoffChallenge(); continue; }
      const notice = looksLimited((await this.page.locator('body').innerText().catch(() => '')).slice(-600));
      if (notice) throw new LimitError(this.name, notice);
      if (await this.#learnReply(text, before)) continue;
      if (attempt >= 2) throw new Error(`No ${this.sel.label} reply appeared. The site may have changed; run "eon teach ${this.limitKey}" or see the selectors note in the README.`);
      if (attempt === 1) await this.ui.ask(`No ${this.sel.label} reply has appeared. Check the browser window (rate limit, a check, or the message was not sent), then press Enter here. `);
    }
    const reply = await this.#waitStable(before);
    const notice = looksLimited(reply);
    if (notice) throw new LimitError(this.name, notice);
    return reply;
  }

  /** Outline of the chat area of the page (no text), for "eon inspect". */
  async describe() {
    const input = await this.#visibleMatch(list(this.sel.input));
    const button = await this.#sendButton(input?.selector ?? '').catch(() => null);
    const sendSel = button ? await button.evaluate((el) => {
      const c = typeof el.className === 'string' ? el.className.trim().split(/\s+/).filter(Boolean).slice(0, 2).join('.') : '';
      return el.tagName.toLowerCase() + (el.id ? `#${el.id}` : c ? `.${c}` : '');
    }).catch(() => null) : null;
    const marks = { input: input ? [input.selector] : list(this.sel.input), send: sendSel ? [sendSel] : list(this.sel.send), message: list(this.sel.message), stop: list(this.sel.stop) };
    return { marks, outline: await inspectPage(this.page, marks), url: this.page.url() };
  }

  /** Read the last reply again, for when the first read caught it mid-stream. */
  async reread() { return this.#waitStable(this.lastBefore, 120000); }

  async close() { await closeBrowser(); }
}

/** Send a test message and see whether the reply can be read. Returns { ok, reply?, error?, label }. */
export async function checkSite(site, ui) {
  const chat = new WebChat(site, { ui, minGapMs: 0, jitterMs: 0 });
  try {
    await chat.newChat();
    const reply = await chat.send('Reply with exactly one word: pong');
    return { ok: /pong/i.test(reply), reply: reply.slice(0, 200), label: chat.sel.label };
  } catch (e) {
    return { ok: false, error: e.message, label: chat.sel.label };
  }
}
