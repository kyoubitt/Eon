// Finding what upsets a site by elimination. Start from a cautious baseline, switch on half of the suspects, use Eon
// for a while, and say whether the account stayed fine. Each answer halves the list. State is saved between runs.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SUSPECTS } from './features.js';

const file = () => path.join(os.homedir(), '.eon', 'bisect.json');

export function newBisect(suspects = SUSPECTS) {
  return { suspects: [...suspects], known: [], candidates: [...suspects], phase: 'baseline', history: [], result: null };
}

const half = (list) => list.slice(0, Math.ceil(list.length / 2));

/** What should be switched on for the next trial (everything else off). */
export function trial(state) {
  if (state.result) return [];
  if (state.phase === 'baseline') return [];
  return [...state.known, ...half(state.candidates)];
}

/** Record how the trial went. flagged = the site suspended, blocked or warned the account. */
export function record(state, flagged) {
  if (state.result) return state;
  const s = { ...state, history: [...state.history, { on: trial(state), flagged: Boolean(flagged) }] };
  if (s.phase === 'baseline') {
    if (flagged) return { ...s, result: { kind: 'baseline', text: 'Even the cautious baseline was flagged. No single switch is to blame: the volume or timing of use is the problem. Send fewer messages and rest the account.' } };
    return { ...s, phase: 'search' };
  }
  const h = half(s.candidates);
  if (s.candidates.length === 1) {
    return flagged
      ? { ...s, result: { kind: 'culprit', name: s.candidates[0], text: `${s.candidates[0]} is the one. Leave it off.` } }
      : { ...s, known: [...s.known, ...s.candidates], candidates: [], result: { kind: 'none', text: 'Everything tested fine. The earlier trouble did not come from a switch; it is more likely volume or timing.' } };
  }
  if (flagged && h.length === 1) return { ...s, candidates: h, result: { kind: 'culprit', name: h[0], text: `${h[0]} is the one. Leave it off.` } };
  return flagged
    ? { ...s, candidates: h }
    : { ...s, known: [...s.known, ...h], candidates: s.candidates.filter((c) => !h.includes(c)) };
}

/** How many trials are still needed at most. */
export function roundsLeft(state) {
  if (state.result) return 0;
  const n = state.candidates.length;
  return (state.phase === 'baseline' ? 1 : 0) + Math.ceil(Math.log2(Math.max(n, 1))) + 1;
}

export function loadBisect() {
  try { return JSON.parse(fs.readFileSync(file(), 'utf8')); } catch { return null; }
}
export function saveBisect(state) {
  fs.mkdirSync(path.dirname(file()), { recursive: true });
  fs.writeFileSync(file(), JSON.stringify(state, null, 2));
}
export function clearBisect() { fs.rmSync(file(), { force: true }); }
