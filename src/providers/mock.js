import { LimitError, Interrupted } from './limits.js';

// A scripted provider for tests and for trying Eon without a browser.
// Each reply is a string, or a function of the message the runtime sent.
export class MockProvider {
  constructor(replies, name = 'mock') { this.name = name; this.replies = [...replies]; this.sent = []; }
  async start() {}
  async newChat() {}
  vision = false;
  images = [];
  async send(text, { images = [] } = {}) {
    this.sent.push(text);
    this.images.push(images);
    this.aborted = false;
    // EON_MOCK_DELAY_MS slows replies down, to watch the spinner and try Esc in a demo.
    const end = Date.now() + Number(process.env.EON_MOCK_DELAY_MS || 0);
    while (Date.now() < end) { if (this.aborted) throw new Interrupted(); await new Promise((r) => setTimeout(r, 100)); }
    if (!this.replies.length) return 'The script has ended.\n```json\n{"action":"done","summary":"Script ended."}\n```';
    const next = this.replies.shift();
    if (next instanceof Error) throw next;
    if (next === '@limit') throw new LimitError(this.name, 'the server is busy');
    return typeof next === 'function' ? next(text) : next;
  }
  abort() { this.aborted = true; }
  async close() {}
}
