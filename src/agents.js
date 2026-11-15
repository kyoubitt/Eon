// Sub-agents: a role the model can hand a read-only investigation to. Defined in .eon/agents/<name>.md
//   ---
//   model: qwen          (optional: which model; default is the main one)
//   ---
//   You review code for security problems. Report file:line and why.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export function loadAgents(root) {
  const agents = new Map();
  for (const dir of [path.join(os.homedir(), '.eon', 'agents'), path.join(root, '.eon', 'agents')]) {
    let files = [];
    try { files = fs.readdirSync(dir).filter((f) => /^[\w-]+\.md$/.test(f)); } catch { continue; }
    for (const f of files) {
      const raw = fs.readFileSync(path.join(dir, f), 'utf8');
      const fm = /^---\n([\s\S]*?)\n---\n?/.exec(raw);
      const model = fm?.[1].match(/^model:\s*(\S+)/m)?.[1] ?? null;
      const prompt = (fm ? raw.slice(fm[0].length) : raw).trim();
      if (prompt) agents.set(f.replace(/\.md$/, ''), { name: f.replace(/\.md$/, ''), model, prompt: prompt.slice(0, 4000), line: prompt.split('\n')[0].slice(0, 100) });
    }
  }
  return agents;
}

/** The last words of a summary, cut to about this many words. */
export function limitWords(text, n = 300) {
  const w = String(text ?? '').trim().split(/\s+/);
  return w.length <= n ? w.join(' ') : `${w.slice(0, n).join(' ')} …(cut)`;
}
