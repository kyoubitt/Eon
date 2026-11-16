// Optional behaviours, each one a named switch. Anything that sends extra messages to a chat site or changes how
// the browser acts can be turned off, so a problem can be tracked down by elimination ("eon bisect").
import { readConfig, writeConfig } from './settings.js';

export const FEATURES = {
  brief: { on: true, about: 'Eon works out the likely files and the check command itself and puts them in the first message (no extra message)' },
  rewrite: { on: false, about: 'an extra message that rewrites your task into a sharper one before work starts' },
  agents: { on: false, about: 'sub-agents: read-only investigations in extra chats' },
  mcp: { on: false, about: 'MCP servers: programs you connect (they run on your computer, not on the chat site)' },
  hooks: { on: true, about: 'your own commands after edits, before commands and at the end of a session' },
  vision: { on: false, about: 'a second chat site that describes pictures for a text-only model' },
  learn: { on: true, about: 'Eon teaches itself where a site writes its replies when the built-in guess fails' },
  fallback: { on: true, about: 'move to the next model when one is at its limit' },
  lean: { on: true, about: 'no artificial pauses between messages (off = the slow pace, with short waits)' },
};

/** The switches that matter when hunting for what upsets a site. */
export const SUSPECTS = ['brief', 'rewrite', 'agents', 'mcp', 'hooks', 'vision', 'learn', 'lean'];

/** What is on: the defaults, then what the user saved. The older plain settings still count. */
export function resolveFeatures(config = readConfig()) {
  const out = Object.fromEntries(Object.entries(FEATURES).map(([k, v]) => [k, v.on]));
  if (config.rewrite === true) out.rewrite = true;
  if (config.brief === false) out.brief = false;
  for (const [k, v] of Object.entries(config.features ?? {})) if (k in FEATURES && typeof v === 'boolean') out[k] = v;
  return out;
}

export function setFeature(name, on) {
  if (!(name in FEATURES)) throw new Error(`unknown feature "${name}". Known: ${Object.keys(FEATURES).join(', ')}`);
  const config = readConfig();
  writeConfig({ features: { ...(config.features ?? {}), [name]: Boolean(on) } });
  return resolveFeatures();
}

/** The cautious baseline: every optional behaviour off, slow pace. */
export function safeFeatures() {
  return Object.fromEntries(Object.keys(FEATURES).map((k) => [k, k === 'fallback']));
}

export function applyFeatures(map) {
  const config = readConfig();
  writeConfig({ features: { ...(config.features ?? {}), ...map }, ...(map.rewrite === false ? { rewrite: false } : {}), ...(map.brief === true ? { brief: true } : {}) });
  return resolveFeatures();
}
