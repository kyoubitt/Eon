// A session as one readable markdown report: what was asked, the plan and its evidence, what ran, what changed.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { loadSession, findSession } from './sessions.js';
import { confidence } from './ledger.js';
import { redact } from './tools.js';
import { Backup, simpleDiff } from './backup.js';

const git = (cwd, args) => spawnSync('git', args, { cwd, encoding: 'utf8' }).stdout ?? '';
const fence = (text, lang = '') => `\`\`\`${lang}\n${String(text).replace(/```/g, "'''")}\n\`\`\``;

function diffOf(root, meta) {
  try {
    if (meta.noGit) {
      const changes = new Backup(root, meta.id).changes();
      return changes.map((c) => `${c.file}${c.old === null ? ' (new file)' : ''}\n${simpleDiff(c.old, c.now)}`).join('\n\n');
    }
    if (meta.branch) {
      const base = git(root, ['merge-base', 'HEAD', meta.branch]).trim();
      if (base) return git(root, ['diff', base, meta.branch]);
    }
  } catch { /* a diff that cannot be made is left out */ }
  return '';
}

/** Build the report text for a saved session. */
export function buildExport(root, meta) {
  const s = loadSession(root, meta.id);
  const L = [`# Eon session: ${meta.tasks[0].slice(0, 80)}`, ''];
  L.push(`- **Session:** ${meta.id}`, `- **Mode / level:** ${meta.mode} / ${meta.level}`, `- **Models:** ${meta.models?.plan ?? '?'}${meta.models?.build && meta.models.build !== meta.models.plan ? ` → ${meta.models.build}` : ''}`, `- **Status:** ${meta.status}`, `- **Last updated:** ${meta.updated}`);
  if (meta.branch) L.push(`- **Branch:** ${meta.branch}`); else if (meta.noGit) L.push('- **Git:** not used (files were backed up before changes)');
  const u = Object.entries(meta.usage ?? {});
  if (u.length) L.push(`- **Estimated usage:** ${u.map(([m, x]) => `${m} ≈${Math.round(x.sent / 4)} tokens in, ≈${Math.round(x.received / 4)} out`).join('; ')} (characters ÷ 4)`);
  L.push('', '## Requests', ...meta.tasks.map((t, i) => `${i + 1}. ${t.split('\n')[0]}`));
  const plan = s.plan;
  if (plan) {
    L.push('', '## Plan', `**Goal:** ${plan.goal}`, `**Confidence:** ${Math.round(confidence(plan) * 100)}% (computed from the evidence, not claimed)`, '', '### Claims and their evidence', '| id | claim | tag | evidence |', '|---|---|---|---|');
    for (const c of plan.claims ?? []) L.push(`| ${c.id} | ${String(c.text).replace(/\|/g, '/')} | ${c.tag} | ${c.pointer ?? c.check ?? ''} |`);
    const done = new Set(meta.done ?? []);
    L.push('', '### Steps', ...(plan.steps ?? []).map((st) => `- [${done.has(st.n) ? 'x' : ' '}] ${st.n}. ${st.text}${st.files?.length ? ` (${st.files.join(', ')})` : ''}`));
    if (plan.validation?.length) L.push('', '### Validation', ...plan.validation.map((v) => `- \`${v}\``));
  } else L.push('', '## Plan', 'No plan was made (a quick edit, or a read-only session).');
  const commands = [...s.runs.values()].filter((r) => r.action?.action === 'run');
  if (commands.length) {
    L.push('', '## Commands that ran');
    for (const r of commands) L.push(`- \`${r.action.cmd}\` → ${String(r.text).split('\n').find((l) => /^exit /.test(l)) ?? ''}`);
  }
  const diff = diffOf(root, meta);
  if (diff.trim()) L.push('', '## Changes', fence(diff.length > 20000 ? `${diff.slice(0, 20000)}\n… cut` : diff, 'diff'));
  const last = [...s.events].reverse().find((e) => e.type === 'line' && /^[✓✗]/.test(e.text ?? ''));
  if (last) L.push('', '## Result', last.text.replace(/^[✓✗]\s*(Done|Stopped)\s+/, '$1: '));
  L.push('', '---', 'Made by `/export` in Eon. Secrets are redacted; check the text before sharing.');
  return redact(L.join('\n'));
}

/** Write the report to .eon/exports/<id>.md (or the file you name). Returns { file, text }. */
export function exportSession(root, key, { file = null } = {}) {
  const meta = typeof key === 'object' ? key : findSession(root, String(key));
  if (!meta) throw new Error(`There is no saved session "${key}".`);
  const text = buildExport(root, meta);
  const out = file ? path.resolve(root, file) : path.join(root, '.eon', 'exports', `${meta.id}.md`);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, `${text}\n`);
  return { file: out, text };
}
