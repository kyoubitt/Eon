// A stand-in chat website for tests. It can misbehave the way real ones do, so that
// Eon's driver is tested against a real browser without needing a login.
//
// opts (all optional): editable, hiddenFirst, enter ('send' | 'ignore'), limit, never, sendDelayMs, stream,
// stallAt, stallMs, challenge, thinking, thinkMs, controlled, and `dom`, which changes how the page is built:
//   inputTag, inputClass, inputAttrs, inputWrap [open, close], sendTag ('button' | 'div'), sendAttrs, sendHtml,
//   decoy (an always-enabled attach button beside Send), replyTag, replyClass, replyAttrs, stopClass, stopAttrs
import http from 'node:http';

const SVG = '<svg width="16" height="16" viewBox="0 0 16 16"><path d="M2 8h12M9 3l5 5-5 5"/></svg>';

const PAGE = (opts) => {
  const d = {
    inputTag: opts.editable ? 'div' : 'textarea', inputClass: 'composer', inputAttrs: opts.editable ? 'contenteditable="true" role="textbox" aria-label="Message"' : 'placeholder="Message"',
    inputWrap: ['', ''], sendTag: 'button', sendAttrs: 'id="send" aria-label="Send message"', sendHtml: 'Send', decoy: false,
    replyTag: 'div', replyClass: 'reply', replyAttrs: '', stopClass: 'generating', stopAttrs: '', ...opts.dom,
  };
  const inputHtml = `${d.inputWrap[0]}<${d.inputTag} class="${d.inputClass}" ${d.inputAttrs} data-fake-input>${d.inputTag === 'textarea' ? '</textarea>' : `</${d.inputTag}>`}${d.inputWrap[1]}`;
  return `<!doctype html><html><head><meta charset="utf-8"><title>${opts.challenge ? 'Just a moment...' : 'Fake Chat'}</title>
<style>body{font:14px sans-serif;margin:20px}.codebar{background:#ddd;padding:2px 6px;display:flex;justify-content:space-between}pre{background:#f4f4f4;margin:0;padding:6px}
.user{background:#eef;margin:6px 0;padding:6px}.msg{margin:6px 0;padding:6px;border-left:3px solid #8a8}.stopper{color:#a60}[data-fake-input]{width:70%;min-height:40px;border:1px solid #888;display:inline-block;vertical-align:middle}
[data-fake-send],.decoy{display:inline-block;vertical-align:middle;min-width:30px;min-height:30px;border:1px solid #666;margin-left:6px;cursor:pointer}</style></head><body>
<div id="gate" ${opts.challenge ? '' : 'hidden'}><h1>Just a moment...</h1><p>Verify you are human to continue.</p><button id="human">I am human</button></div>
<div id="loginwall" ${opts.login ? '' : 'hidden'}><h1>Log in</h1><input type="password" placeholder="Password"><p>Sign up · Forgot password</p></div>
<div id="app" ${opts.challenge || opts.login ? 'hidden' : ''}>
  ${opts.sidebar ? '<aside class="sidebar"><ul><li data-chat-id="9876543210" title="PRIVATE-CHAT-TITLE">PRIVATE-CHAT-TITLE My tax return</li><li>PRIVATE-CHAT-TWO</li></ul></aside>' : ''}
  ${opts.fileInput ? '<input type="file" id="fileinput" multiple style="display:none">' : ''}
  <div id="log"></div>
  ${opts.hiddenFirst ? '<textarea class="composer" style="display:none" placeholder="decoy"></textarea>' : ''}
  <div class="row">${d.decoy ? `<div class="decoy" role="button" aria-label="" ${''}>${SVG}</div>` : ''}${inputHtml}
  <${d.sendTag} ${d.sendTag === 'div' ? 'role="button" aria-disabled="true"' : 'disabled'} ${d.sendAttrs} data-fake-send>${d.sendHtml}</${d.sendTag}></div>
  <span class="stopper ${d.stopClass}" ${d.stopAttrs} hidden>generating…</span>
</div>
<script>
const O = ${JSON.stringify({ ...opts, dom: d })};
const D = O.dom;
const vis = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(e).display !== 'none'; };
const box = document.querySelector('[data-fake-input]');
const btn = document.querySelector('[data-fake-send]'), log = document.getElementById('log'), stopper = document.querySelector('.stopper');
const read = () => (box.value !== undefined ? box.value : box.innerText);
const write = (t) => { if (box.value !== undefined) box.value = t; else box.innerText = t; };
const setEnabled = (on) => { if (btn.tagName === 'BUTTON') btn.disabled = !on; else btn.setAttribute('aria-disabled', on ? 'false' : 'true'); };
const isOff = () => (btn.tagName === 'BUTTON' ? btn.disabled : btn.getAttribute('aria-disabled') === 'true');
let typedAt = 0, state = '';
const fi = document.getElementById('fileinput');
if (fi) fi.addEventListener('change', () => { for (const f of fi.files) fetch('/upload?name=' + encodeURIComponent(f.name), { method: 'POST', body: f }); });
if (O.login) setTimeout(() => { document.getElementById('loginwall').hidden = true; document.getElementById('app').hidden = false; }, O.login);
document.getElementById('human').onclick = () => { document.getElementById('gate').hidden = true; document.getElementById('app').hidden = false; document.title = 'Fake Chat'; };
box.addEventListener('input', () => {
  if (O.limit && read().length > O.limit) write(read().slice(0, O.limit));
  state = read();
  if (!typedAt) typedAt = Date.now();
});
// A controlled box (as in React): a value set without an input event is put back.
if (O.controlled) setInterval(() => { if (read() !== state) write(state); }, 100);
setInterval(() => setEnabled(!!read().trim() && Date.now() - typedAt >= (O.sendDelayMs || 0)), 80);
const html = (s) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
function render(text) {
  const parts = text.split('\`\`\`');
  return parts.map((p, i) => i % 2 ? '<div class="codebar"><span>' + html(p.split('\\n')[0]) + '</span><button>Copy</button></div><pre><code>' + html(p.split('\\n').slice(1).join('\\n')) + '</code></pre>' : '<p style="white-space:pre-wrap;margin:0">' + html(p) + '</p>').join('');
}
function node(extraClass) {
  const el = document.createElement(D.replyTag);
  if (D.replyClass) el.className = D.replyClass + (extraClass ? ' ' + extraClass : ''); else if (extraClass) el.className = extraClass;
  for (const m of (D.replyAttrs || '').matchAll(/([\\w-]+)="([^"]*)"/g)) el.setAttribute(m[1], m[2]);
  el.classList.add('msg');
  log.append(el);
  return el;
}
async function send() {
  const text = read().trim();
  if (!text || O.never) return;
  write(''); state = ''; typedAt = 0;
  const u = document.createElement('div'); u.className = 'user'; u.textContent = text; log.append(u);
  const r = await (await fetch('/next', { method: 'POST', body: text })).text();
  if (O.thinking) {
    const t = node('think'); t.textContent = 'Thinking about it. Draft: {"action":"run","cmd":"rm -rf /"}';
    stopper.hidden = false;
    await new Promise((x) => setTimeout(x, O.thinkMs || 1800));
    t.textContent += ' Done thinking.';
  }
  const el = node('');
  if (!O.stream) { await new Promise((x) => setTimeout(x, 150)); el.innerHTML = render(r); stopper.hidden = true; return; }
  stopper.hidden = false;
  for (let i = 0; i <= r.length; i += 12) {
    el.innerHTML = render(r.slice(0, i));
    await new Promise((x) => setTimeout(x, 40));
    if (O.stallAt && i >= O.stallAt && !O.stalled) { O.stalled = true; await new Promise((x) => setTimeout(x, O.stallMs || 2500)); }
  }
  el.innerHTML = render(r); stopper.hidden = true;
}
box.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); if (O.enter !== 'ignore') send(); } });
btn.addEventListener('click', () => { if (!isOff()) send(); });
</script></body></html>`;
};

/** reply: a function (text, n) => string, or an array of strings used in order. */
export async function startFakeChat(opts = {}, reply = () => 'ok') {
  const received = [], uploads = [];
  const server = http.createServer((req, res) => {
    if (req.method === 'POST' && req.url.startsWith('/upload')) {
      const chunks = [];
      req.on('data', (d) => chunks.push(d));
      req.on('end', () => { uploads.push({ name: new URL(req.url, 'http://x').searchParams.get('name'), bytes: Buffer.concat(chunks).length }); res.end('ok'); });
      return;
    }
    if (req.method === 'POST' && req.url === '/next') {
      let body = '';
      req.on('data', (d) => { body += d; });
      req.on('end', () => {
        received.push(body);
        const r = Array.isArray(reply) ? (reply.shift() ?? 'The script has ended.') : reply(body, received.length);
        res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
        res.end(r);
      });
      return;
    }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(PAGE(opts));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { url: `http://127.0.0.1:${server.address().port}/`, received, uploads, close: () => new Promise((r) => server.close(r)) };
}

/**
 * What each built-in site's page is probably made of, as stand-in pages. They are guesses from public
 * userscripts, so they test that Eon copes with each kind of page, not that the live site matches.
 */
export const PROFILES = {
  deepseek: { thinking: true, dom: { inputAttrs: 'id="chat-input" placeholder="Message DeepSeek"', sendTag: 'div', sendAttrs: 'class="ds-send"', sendHtml: SVG, decoy: true, replyClass: 'ds-markdown' } },
  gemini: { enter: 'ignore', dom: { inputTag: 'div', inputClass: 'ql-editor', inputAttrs: 'contenteditable="true" role="textbox" aria-label="Enter a prompt here"', inputWrap: ['<rich-textarea>', '</rich-textarea>'], sendAttrs: 'aria-label="Send message"', replyTag: 'message-content', replyClass: '' } },
  chatgpt: { stream: true, dom: { inputTag: 'div', inputClass: 'ProseMirror', inputAttrs: 'id="prompt-textarea" contenteditable="true"', sendAttrs: 'id="composer-submit-button" data-testid="send-button"', replyClass: '', replyAttrs: 'data-message-author-role="assistant"', stopClass: 'st', stopAttrs: 'data-testid="stop-button"' } },
  claude: { stream: true, dom: { inputTag: 'div', inputClass: 'ProseMirror', inputAttrs: 'contenteditable="true"', sendAttrs: 'aria-label="Send message"', replyClass: 'font-claude-response', stopClass: 'st', stopAttrs: 'data-is-streaming="true"' } },
  qwen: { dom: { inputAttrs: 'id="chat-input" placeholder="How can I help you today?"', sendAttrs: 'id="send-message-button"', replyClass: 'markdown-content-container' } },
  mistral: { enter: 'ignore', dom: { inputTag: 'div', inputClass: 'ProseMirror', inputAttrs: 'contenteditable="true"', sendAttrs: 'type="submit"', replyClass: '', replyAttrs: 'data-message-author-role="assistant"' } },
  grok: { dom: { inputAttrs: 'placeholder="Ask anything"', sendAttrs: 'type="submit" aria-label="Submit"', replyClass: 'response-content-markdown' } },
  kimi: { enter: 'ignore', dom: { inputTag: 'div', inputAttrs: 'contenteditable="true"', sendTag: 'div', sendAttrs: 'class="send-button"', sendHtml: SVG, replyClass: 'markdown-container' } },
};
