// Usage limits on free web chats, and what to do about them: a pool of models
// tried in order, where one that hits its limit rests while the next takes over.

export class LimitError extends Error {
  // kind "limit" is a real usage limit (waiting can help). "skipped" is a check, a login or an unsent message you
  // gave up on: waiting would not help, so Eon moves to another model or stops.
  constructor(who, detail, { reason = 'reached its usage limit', kind = 'limit' } = {}) {
    super(`${who} ${reason}${detail ? ` ("${detail}")` : ''}`);
    this.name = 'LimitError';
    this.who = who;
    this.kind = kind;
  }
}

/** Thrown inside a wait when you press Esc or Ctrl+C. */
export class Interrupted extends Error {
  constructor() { super('interrupted'); this.name = 'Interrupted'; }
}

const LIMIT = /rate.?limit|too many (requests|messages)|(reached|hit|exceeded) (your|the|a|our) .{0,40}limit|limit (has been |was )?reached|usage (cap|limit)|out of (free )?(messages|credits|queries)|quota|server is busy|try again (later|in \d|after|at)|come back (later|at|in)|high demand|capacity/i;

/** A short reply with no action in it that reads like a limit notice. Returns the notice, or null. */
export function looksLimited(text) {
  const t = String(text).trim();
  return t.length < 500 && !t.includes('"action"') && LIMIT.test(t) ? t.replace(/\s+/g, ' ').slice(0, 140) : null;
}

// A limit belongs to the account on a site, so every tab on that site shares it.
const resting = new Map();
const key = (m) => m.limitKey ?? m.name;
export function clearLimits() { resting.clear(); }

export class ModelPool {
  constructor(members, { cooldownMs = 30 * 60000 } = {}) {
    if (!members.length) throw new Error('a model list cannot be empty');
    Object.assign(this, { members, cooldownMs, i: 0, last: '' });
  }
  get current() { return this.members[this.i]; }
  get maxChars() { return this.current.maxChars; }
  get name() { return this.current.name; }
  set name(_) { /* the name always follows the current member */ }
  #available(m) { return (resting.get(key(m)) ?? 0) <= Date.now(); }

  chatLost() { return Boolean(this.current.chatLost?.()); }
  abort() { this.current.abort?.(); }
  set onProgress(fn) { for (const m of this.members) m.onProgress = fn; }
  get onProgress() { return this.current.onProgress; }

  async start() { await this.current.start?.(); }
  async newChat() { await this.current.start?.(); await this.current.newChat(); }
  get vision() { return Boolean(this.current.vision); }
  async send(text, opts) {
    if (!this.#available(this.current)) throw new LimitError(this.name, 'still resting after an earlier limit');
    this.last = await this.current.send(text, opts);
    return this.last;
  }
  async reread() { return this.current.reread ? this.current.reread() : this.last; }
  async close() { for (const m of this.members) await m.close?.(); }

  /** Rest the current model and move to the next one that is not resting. False when none is left. */
  fallback() {
    resting.set(key(this.current), Date.now() + this.cooldownMs);
    const next = this.members.findIndex((m) => this.#available(m));
    if (next < 0) return false;
    this.i = next;
    return true;
  }
  /** After waiting: clear the rests and start again from the first choice. */
  retry() {
    for (const m of this.members) resting.delete(key(m));
    this.i = 0;
  }
  status() {
    return this.members.map((m, i) => {
      const left = Math.ceil(((resting.get(key(m)) ?? 0) - Date.now()) / 60000);
      return `${m.name}${i === this.i ? ' (in use)' : ''}${left > 0 ? ` (resting ${left} min)` : ''}`;
    }).join(', ');
  }
}
