// Any OpenAI-compatible chat API. Useful with a model running on your own
// machine (Ollama, LM Studio, llama.cpp), which is also free.
// Settings come from the environment so a key never lands in a file or a chat:
//   EON_API_MODEL  required, e.g. "qwen2.5-coder"
//   EON_API_BASE   default http://localhost:11434/v1 (Ollama)
//   EON_API_KEY    optional
import { LimitError } from './limits.js';
import { readConfig } from '../settings.js';
import { dataUrl, checkImage } from '../vision.js';

export class ApiProvider {
  constructor({ base = process.env.EON_API_BASE || readConfig().api?.base || 'http://localhost:11434/v1', key = process.env.EON_API_KEY, model = process.env.EON_API_MODEL || readConfig().api?.model } = {}) {
    if (!model) throw new Error('No local model is set up yet. Run: eon setup-local   (or set EON_API_MODEL, for example EON_API_MODEL=qwen2.5-coder)');
    Object.assign(this, { base: base.replace(/\/$/, ''), key, model, name: `${model} (API)`, messages: [], vision: /^(1|true|yes)$/i.test(process.env.EON_API_VISION ?? '') || Boolean(readConfig().api?.vision) });
  }
  async start() {}
  async newChat() { this.messages = []; }
  async send(text, { images = [] } = {}) {
    if (images.length) for (const f of images) checkImage(f);
    // The OpenAI message format for pictures: a list of text and image_url parts (Ollama vision models read this).
    this.messages.push({ role: 'user', content: images.length ? [{ type: 'text', text }, ...images.map((f) => ({ type: 'image_url', image_url: { url: dataUrl(f) } }))] : text });
    const r = await fetch(`${this.base}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(this.key ? { authorization: `Bearer ${this.key}` } : {}) },
      body: JSON.stringify({ model: this.model, messages: this.messages }),
      signal: AbortSignal.timeout(600000),
    });
    if (r.status === 429) throw new LimitError(this.name, 'the API answered 429');
    if (!r.ok) throw new Error(`The API at ${this.base} answered ${r.status}: ${(await r.text()).slice(0, 300)}`);
    const reply = (await r.json()).choices?.[0]?.message?.content;
    if (typeof reply !== 'string') throw new Error('The API reply had no message content.');
    this.messages.push({ role: 'assistant', content: reply });
    return reply;
  }
  async close() {}
}
