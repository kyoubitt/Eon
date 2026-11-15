// The evidence ledger: validates plans and computes confidence from tags.
import fs from 'node:fs';
import path from 'node:path';

const WEIGHT = { verified: 1, checked: 0.85, fact: 0.7, inference: 0.3, assumption: 0, disproved: 0 };

/** Returns null when the pointer checks out, otherwise the reason it does not. */
export function checkPointer(pointer, root, runs, research = new Map(), asFact = false) {
  if (typeof pointer !== 'string' || !pointer) return 'pointer is missing';
  const res = pointer.match(/^research:(R\d+)$/);
  if (res) {
    const entry = research.get(res[1]);
    if (!entry) return `no research entry ${res[1]}`;
    if (asFact && entry.kind !== 'doc') return `${res[1]} is the research chat's own knowledge, not a fetched document, so it can back an inference but not a fact`;
    return null;
  }
  const run = pointer.match(/^run:(r\d+)$/);
  if (run) return runs.has(run[1]) ? null : `no tool result with id ${run[1]} in this session`;
  const m = pointer.match(/^(.*?)(?::(\d+))?$/);
  const file = path.resolve(root, m[1]);
  if (!file.startsWith(root + path.sep)) return `${m[1]} is outside the project`;
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) return `file ${m[1]} does not exist`;
  if (m[2]) {
    const lines = fs.readFileSync(file, 'utf8').split('\n').length;
    if (+m[2] < 1 || +m[2] > lines) return `${m[1]} has ${lines} lines, so line ${m[2]} does not exist`;
  }
  return null;
}

/** Returns a list of problems. An empty list means the plan is well formed. */
export function validatePlan(plan, { root, runs, maxSteps = 8, requireImpact = false, research = new Map(), lessons = [], knownLessons = null }) {
  const errors = [];
  if (!plan.goal) errors.push('plan needs a "goal"');
  if (!Array.isArray(plan.claims) || !plan.claims.length) errors.push('plan needs at least one claim');
  if (!Array.isArray(plan.steps) || !plan.steps.length) errors.push('plan needs at least one step');
  if (!Array.isArray(plan.validation) || !plan.validation.length) errors.push('plan needs "validation": commands that prove the change works');
  if (requireImpact) {
    const ok = Array.isArray(plan.impact) && plan.impact.length && plan.impact.every((i) => i && i.area && i.effect);
    if (!ok) errors.push('architect level: plan needs "impact": [{"area":"...","effect":"..."}] listing every system the change affects');
  }
  if (plan.other_lessons !== undefined) {
    if (!Array.isArray(plan.other_lessons)) errors.push('"other_lessons" must be a list of lesson ids, for example ["L3"]');
    else if (knownLessons) for (const id of plan.other_lessons) if (!knownLessons.has(String(id))) errors.push(`other_lessons names ${id}, which does not exist`);
  }
  for (const id of lessons) {
    const answer = Array.isArray(plan.lessons) && plan.lessons.find((l) => l && l.id === id);
    if (!answer || !String(answer.how ?? '').trim()) errors.push(`plan must address lesson ${id} in "lessons": [{"id":"${id}","how":"what you did or will do about it"}]`);
  }
  if (errors.length) return errors;

  if (plan.steps.length > maxSteps) errors.push(`plan has ${plan.steps.length} steps; the limit is ${maxSteps}. Narrow the task or merge steps.`);
  plan.steps.forEach((s, i) => {
    if (s.n !== i + 1) errors.push(`steps must be numbered 1, 2, 3 in order (found n=${s.n} at position ${i + 1})`);
    if (!s.text) errors.push(`step ${i + 1} needs "text"`);
  });

  const seen = new Set();
  for (const c of plan.claims) {
    const id = c.id ?? '(no id)';
    if (!c.id || seen.has(c.id)) errors.push(`claim ${id}: each claim needs a unique "id"`);
    seen.add(c.id);
    if (!c.text) errors.push(`claim ${id}: needs "text"`);
    c.load_bearing = c.load_bearing !== false;
    delete c.challenged;
    if (c.tag === 'verified' || c.tag === 'checked') {
      errors.push(`claim ${id}: you cannot tag a claim "${c.tag}". Tag it fact, inference or assumption, then use the verify action.`);
    } else if (c.tag === 'fact') {
      const problem = checkPointer(c.pointer, root, runs, research, true);
      if (problem) errors.push(`claim ${id}: a fact needs a pointer that checks out (${problem})`);
    } else if (c.tag === 'inference') {
      if (c.pointer) {
        const problem = checkPointer(c.pointer, root, runs, research);
        if (problem) errors.push(`claim ${id}: pointer does not check out (${problem})`);
      }
    } else if (c.tag === 'assumption') {
      if (c.load_bearing && !c.check) errors.push(`claim ${id}: a load-bearing assumption needs "check": how it will be tested`);
    } else {
      errors.push(`claim ${id}: tag must be fact, inference or assumption`);
    }
  }
  return errors;
}

/**
 * Confidence is computed, never self-reported: the weighted share of
 * load-bearing claims by how strongly each is supported. A fact or inference
 * that the reviewer challenged at high severity counts half until it is checked.
 */
export function confidence(plan) {
  const claims = (plan?.claims ?? []).filter((c) => c.load_bearing !== false);
  if (!claims.length) return 0;
  const weight = (c) => (WEIGHT[c.tag] ?? 0) * (c.challenged && (c.tag === 'fact' || c.tag === 'inference') ? 0.5 : 1);
  return claims.reduce((sum, c) => sum + weight(c), 0) / claims.length;
}
