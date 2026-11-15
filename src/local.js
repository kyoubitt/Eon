// A model running on your own computer (Ollama): free, offline, and independent of any website.
import os from 'node:os';
import { spawnSync, spawn } from 'node:child_process';
import { readConfig, writeConfig } from './settings.js';

export const OLLAMA = 'http://localhost:11434';

/** Is Ollama running, and which models does it have? */
export async function detectOllama(base = OLLAMA) {
  try {
    const r = await fetch(`${base}/api/tags`, { signal: AbortSignal.timeout(1500) });
    if (!r.ok) return { up: false, models: [] };
    return { up: true, models: ((await r.json()).models ?? []).map((m) => m.name) };
  } catch { return { up: false, models: [] }; }
}

export const ollamaInstalled = () => spawnSync('ollama', ['--version'], { stdio: 'ignore' }).status === 0;

/** A coding model that fits this much memory. */
export function suggestModel(memoryGb = Math.round(os.totalmem() / 2 ** 30)) {
  if (memoryGb >= 32) return 'qwen2.5-coder:32b';
  if (memoryGb >= 16) return 'qwen2.5-coder:14b';
  if (memoryGb >= 8) return 'qwen2.5-coder:7b';
  return 'qwen2.5-coder:3b';
}

/** The model Eon uses for "--model api": your saved choice. */
export function savedLocalModel() { return readConfig().api ?? null; }

/**
 * Walk through using a local model: find Ollama, pick or download a model, save the choice.
 * `ask` is a function (question) => answer. Returns { base, model } or null.
 */
export async function setupLocal(ask, print) {
  if (!ollamaInstalled() && !(await detectOllama()).up) {
    print('Ollama is not installed. It runs models on your own computer.\n  Windows: winget install Ollama.Ollama\n  macOS:   brew install ollama\n  Linux:   https://ollama.com/download\nInstall it, then run: eon setup-local');
    return null;
  }
  let state = await detectOllama();
  if (!state.up) {
    print('Starting Ollama...');
    spawn('ollama', ['serve'], { detached: true, stdio: 'ignore' }).unref();
    for (let i = 0; i < 20 && !state.up; i++) { await new Promise((r) => setTimeout(r, 500)); state = await detectOllama(); }
    if (!state.up) { print('Ollama did not start. Open the Ollama app, then run: eon setup-local'); return null; }
  }
  let model = state.models.find((m) => /coder/i.test(m)) ?? state.models[0];
  if (!model) {
    const want = suggestModel();
    const a = await ask(`No models are installed. Download ${want}? It is large and takes a while. [y]es / [n]o: `);
    if (!/^y/i.test(a)) return null;
    const r = spawnSync('ollama', ['pull', want], { stdio: 'inherit' });
    if (r.status !== 0) { print(`The download failed. Try: ollama pull ${want}`); return null; }
    model = want;
  }
  writeConfig({ api: { base: `${OLLAMA}/v1`, model } });
  print(`Using ${model} from your computer. Test it with: eon check api`);
  return { base: `${OLLAMA}/v1`, model };
}
