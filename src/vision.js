// Images. Models that can see get the picture itself. Text-only models (DeepSeek's chat) get a written
// description made by a helper model that can see, cached so the same picture is never uploaded twice.
// Also: screenshots and text outlines of a web page, taken with a browser.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';

const MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp' };
export const isImage = (p) => Boolean(MIME[path.extname(String(p)).toLowerCase()]);
export const mimeOf = (p) => MIME[path.extname(String(p)).toLowerCase()] ?? 'application/octet-stream';
export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

export function checkImage(file) {
  const st = fs.statSync(file);
  if (!st.isFile()) throw new Error(`${file} is not a file`);
  if (!isImage(file)) throw new Error(`${path.basename(file)} is not a picture Eon can send (png, jpg, gif, webp)`);
  if (st.size > MAX_IMAGE_BYTES) throw new Error(`${path.basename(file)} is ${(st.size / 1e6).toFixed(1)} MB; the limit is 8 MB`);
  return st.size;
}

export const dataUrl = (file) => `data:${mimeOf(file)};base64,${fs.readFileSync(file).toString('base64')}`;
const hash = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex').slice(0, 16);

export const DESCRIBE_PROMPT = `Describe this image so a developer who cannot see it could work from your description. Be exact and complete:
1. All text in it, word for word.
2. The layout: what is where (top, left, below), sizes relative to the picture, alignment, spacing.
3. Every element (buttons, inputs, icons, images, charts) with its colour, shape, state (disabled, selected) and label.
4. Anything that looks broken, cut off, overlapping or misaligned.
Do not guess what the code looks like. Do not add advice. Describe only what is visible.`;

/** Describe a picture with a helper model. Cached by the picture's content, and by the question when there is one. */
export async function describeImage(helper, file, { question = null, cacheDir = null } = {}) {
  checkImage(file);
  const key = `${hash(file)}${question ? `-${crypto.createHash('sha256').update(question).digest('hex').slice(0, 8)}` : ''}`;
  const cached = cacheDir && path.join(cacheDir, `${key}.md`);
  if (cached && fs.existsSync(cached)) return { text: fs.readFileSync(cached, 'utf8'), cached: true };
  await helper.newChat?.();
  const prompt = question ? `Look at this image and answer this one question precisely, from what is visible only.\nQUESTION: ${question}` : DESCRIBE_PROMPT;
  const text = String(await helper.send(prompt, { images: [file] })).trim();
  if (cached && text) { fs.mkdirSync(cacheDir, { recursive: true }); fs.writeFileSync(cached, text); }
  return { text, cached: false };
}

async function chromium() {
  try { return (await import('playwright')).chromium; } catch { /* fall through */ }
  try { return createRequire(import.meta.url)('playwright').chromium; } catch { throw new Error('Taking a picture of a page needs Playwright (npm run setup installs it).'); }
}

async function withPage(url, fn) {
  const browser = await (await chromium()).launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    await page.goto(url, { waitUntil: 'load', timeout: 30000 });
    await page.waitForTimeout(500);
    return await fn(page);
  } finally { await browser.close(); }
}

/** Save a screenshot of a page. */
export const takeShot = (url, file) => withPage(url, async (page) => { fs.mkdirSync(path.dirname(file), { recursive: true }); await page.screenshot({ path: file }); return file; });

/** A text outline of a page: what is on it, with the sizes and colours that matter. Text beats pixels for a text-only model. */
export const inspectUrl = (url) => withPage(url, (page) => page.evaluate(() => {
  const out = [`title: ${document.title}`, `viewport: ${innerWidth}x${innerHeight}`];
  const vis = (e) => { const r = e.getBoundingClientRect(), cs = getComputedStyle(e); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none'; };
  const sel = 'h1,h2,h3,h4,a,button,input,select,textarea,img,label,nav,main,header,footer,form,[role]';
  let n = 0;
  for (const e of document.querySelectorAll(sel)) {
    if (!vis(e) || n >= 120) continue;
    n++;
    const r = e.getBoundingClientRect(), cs = getComputedStyle(e);
    const text = (e.innerText || e.value || e.alt || e.placeholder || '').trim().replace(/\s+/g, ' ').slice(0, 60);
    const label = e.tagName.toLowerCase() + (e.id ? `#${e.id}` : '') + (typeof e.className === 'string' && e.className.trim() ? `.${e.className.trim().split(/\s+/).slice(0, 2).join('.')}` : '') + (e.getAttribute('role') ? `[role=${e.getAttribute('role')}]` : '');
    out.push(`${label} "${text}" at ${Math.round(r.x)},${Math.round(r.y)} size ${Math.round(r.width)}x${Math.round(r.height)} color ${cs.color} bg ${cs.backgroundColor} font ${cs.fontSize}${e.disabled ? ' DISABLED' : ''}`);
  }
  return out.join('\n');
}));
