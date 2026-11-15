// Proof, on your own machine, that a chat site works with Eon end to end:
// the message is sent, the reply is read, and an edit the model asks for lands on disk.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { Runtime } from './runtime.js';
import { ApiProvider } from './providers/api.js';

/** Asks the model to create a file through the real runtime, and checks the file. */
export async function editSelfTest(provider, { maxTurns = 8 } = {}) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'eon-check-')));
  fs.writeFileSync(path.join(dir, 'README.md'), '# check\n');
  execSync('git init -q && git config core.autocrlf false && git config core.safecrlf false && git add -A && git -c user.name=eon -c user.email=eon@localhost commit -q -m start', { cwd: dir });
  let reprompts = 0, turns = 0, lastReply = '';
  const counted = new Proxy(provider, {
    get(target, prop) {
      if (prop === 'send') return async (text) => { turns++; if (String(text).startsWith('I found no valid action')) reprompts++; lastReply = await target.send(text); return lastReply; };
      const v = target[prop];
      return typeof v === 'function' ? v.bind(target) : v;
    },
    set(target, prop, value) { target[prop] = value; return true; },
  });
  const quiet = { print() {}, update() {}, ask: async () => 'y' };
  let result, error;
  try {
    result = await new Runtime({ root: dir, provider: counted, ui: quiet, mode: 'guided', level: 'quick', maxTurns }).run('Create a file named hello.txt whose entire content is the single line: hi from eon');
  } catch (e) { error = e; }
  const file = result?.dir ? path.join(result.dir, 'hello.txt') : null;
  const content = file && fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
  const ok = content !== null && /hi from eon/i.test(content);
  let reason = null;
  if (!ok) {
    if (error) reason = error.message;
    else if (result?.status === 'stalled') reason = 'the model did not reply with an action Eon could read, even after being told what was wrong';
    else if (content === null) reason = `the run ended (${result?.status ?? 'unknown'}) without creating hello.txt`;
    else reason = `hello.txt was created but its content was ${JSON.stringify(content.slice(0, 60))}`;
  }
  fs.rmSync(dir, { recursive: true, force: true });
  return { ok, reason, turns, reprompts, lastReply: lastReply.slice(0, 300) };
}

/** Run the stages for one site. Each result is { ok, text }. */
export async function runChecks(site, ui, { WebChat, edit = true }) {
  const stages = [];
  const isApi = site === 'api';
  const chat = isApi ? new ApiProvider() : new WebChat(site, { ui, minGapMs: 0, jitterMs: 0 });
  const label = isApi ? chat.name : chat.sel.label;
  let reply;
  try {
    await chat.newChat();
    reply = await chat.send('Reply with exactly one word: pong');
    stages.push({ ok: true, text: `${label}: message sent and confirmed` });
  } catch (e) {
    stages.push({ ok: false, text: `${label}: the message was not sent (${e.message.split('\n')[0]})`, fix: isApi ? 'eon setup-local' : `eon teach ${site}` });
    return stages;
  }
  stages.push(/pong/i.test(reply)
    ? { ok: true, text: 'reply read ("pong")' }
    : { ok: false, text: `a reply was read, but not the expected one: ${JSON.stringify(reply.slice(0, 80))}`, fix: isApi ? null : `eon teach ${site}` });
  if (!stages.at(-1).ok || !edit) return stages;
  try {
    await chat.newChat();
    const r = await editSelfTest(chat);
    stages.push(r.ok
      ? { ok: true, text: `file edit: the model asked, Eon wrote hello.txt (${r.turns} message${r.turns === 1 ? '' : 's'}, ${r.reprompts} re-prompt${r.reprompts === 1 ? '' : 's'})` }
      : { ok: false, text: `file edit: ${r.reason}${isApi ? '\n    this model is too weak for Eon\'s action format; try a larger one (eon setup-local)' : ''}${r.lastReply ? `\n    the model last said: ${JSON.stringify(r.lastReply)}` : ''}`, fix: null });
  } catch (e) {
    stages.push({ ok: false, text: `file edit: ${e.message.split('\n')[0]}` });
  }
  return stages;
}
