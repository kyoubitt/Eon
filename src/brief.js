// Turns a short request ("fix the login bug") into a fuller brief, locally and before the first message:
// the matching skill's steps, the files a search says are most likely involved, and the command that proves it worked.
// No extra model call. The user sees one dim line saying what was added, and can turn it off (/config brief off).
import { search } from './tools.js';
import { detectCommands } from './project.js';

// What a request looks like -> which skill fits. The first rule with the most matching words wins.
const INTENTS = [
  ['security-review', /\b(security|vulnerab\w*|injection|xss|csrf|secrets?|exploit\w*|hardcoded)\b/i],
  ['accessibility-audit', /\b(accessib\w*|a11y|screen ?reader|contrast|aria|alt text)\b/i],
  ['ui-work', /\b(ui|ux|css|style[sd]?|layout|button|modal|dialog|page|screen|component|responsive|dark mode|theme|font)\b/i],
  ['performance', /\b(slow|performance|speed up|faster|latency|memory leak|optimi[sz]e|bottleneck|laggy)\b/i],
  ['debug-ci', /\b(ci|pipeline|github actions|workflow|build (fails|failing|broke\w*)|failing build)\b/i],
  ['find-regression', /\b(regress\w*|used to work|stopped working|worked (before|yesterday)|since (the )?(last|commit|update))\b/i],
  ['upgrade-deps', /\b(upgrade|update|bump)\b.*\b(dependenc\w*|packages?|libraries|library|version)\b|\bdependabot\b|\boutdated\b/i],
  ['write-docs', /\b(docs?|documentation|readme|changelog|docstring|comments? for)\b/i],
  ['commit-message', /\b(commit message|pr (title|description)|pull request (text|description))\b/i],
  ['review-changes', /\b(review|look over|check my (changes|diff|code))\b/i],
  ['refactor-safely', /\b(refactor\w*|restructure|reorgani[sz]e|extract|rename|split up|move .* into)\b/i],
  ['simplify', /\b(simplif\w*|clean ?up|tidy|dedupe|duplicat\w*|dead code|unused)\b/i],
  ['tdd', /\b(tdd|test[- ]first|test driven)\b/i],
  ['add-tests', /\b(tests?|coverage|spec)\b.*\b(add|write|missing|for)\b|\b(add|write)\b.*\btests?\b/i],
  ['explain-code', /\b(explain|how does|how do|what does|walk me through|where is|understand)\b/i],
  ['fix-bug', /\b(fix\w*|bug|broken|crash\w*|error|exception|fails?|failing|wrong|doesn'?t work|not working|issue|stack ?trace|typo)\b/i],
  ['plan-feature', /\b(add|implement|build|create|support|new feature|feature)\b/i],
];

const STOP = new Set('the and for with that this from into when where what which should would could have been your about there their then than make sure please just also need want like some more only each file files code project app bug fix add new use using does doesnt dont not but are was can will get got has had its our out how why who all any one two'.split(' '));

/** Words in the request worth searching for: quoted text, code-looking names, then plain long words. */
export function keywords(task, max = 3) {
  const text = String(task);
  const out = [];
  const add = (w) => { const k = w.trim(); if (k.length >= 4 && !STOP.has(k.toLowerCase()) && !out.some((o) => o.toLowerCase() === k.toLowerCase())) out.push(k); };
  for (const m of text.matchAll(/["'`]([^"'`\n]{3,40})["'`]/g)) add(m[1]);
  for (const m of text.matchAll(/\b[a-z]+(?:[A-Z][a-z0-9]+)+\b|\b\w+_\w+\b|[\w./-]+\.\w{1,5}\b/g)) add(m[0]);
  for (const m of text.matchAll(/\b[A-Za-z]{5,}\b/g)) add(m[0]);
  return out.slice(0, max);
}

/** The skill that fits this request best, or null. */
export function pickSkill(task, skills) {
  for (const [name, re] of INTENTS) if (skills.has(name) && re.test(task)) return name;
  return null;
}

/** Files that mention the request's keywords, most hits first: [{ file, line, hits }]. */
export function likelyFiles(root, task, { limit = 5 } = {}) {
  const score = new Map();
  for (const word of keywords(task)) {
    let out = '';
    try { out = search(root, { pattern: word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') }); } catch { continue; }
    if (out === 'no matches') continue;
    for (const line of out.split('\n')) {
      const m = /^(.+?):(\d+):/.exec(line);
      if (!m || /^(package-lock\.json|.*\.(lock|min\.js|map))$/.test(m[1].split('/').pop())) continue;
      const e = score.get(m[1]) ?? { file: m[1], line: Number(m[2]), hits: 0 };
      e.hits++; score.set(m[1], e);
    }
  }
  return [...score.values()].sort((a, b) => b.hits - a.hits || a.file.localeCompare(b.file)).slice(0, limit);
}

/**
 * Build the brief for a request. Returns { text, summary } or null when there is nothing useful to add.
 * `skills` is the Map from loadSkills. A request that already names a skill ("Use the skill ...") is left alone.
 */
export function buildBrief(task, { root, skills = new Map() } = {}) {
  const t = String(task ?? '').trim();
  if (t.length < 8 || /^Use the skill "/.test(t)) return null;
  const parts = [], what = [];
  const name = pickSkill(t, skills);
  if (name) {
    const k = skills.get(name);
    parts.push(`SKILL TO FOLLOW: ${name} (chosen by Eon from the request; ignore it if it does not fit)\n${k.body.slice(0, 1800)}`);
    what.push(`skill ${name}`);
  }
  const files = likelyFiles(root, t);
  if (files.length) {
    parts.push(`FILES THAT MENTION YOUR KEYWORDS (from a search, most likely first; read before you assume)\n${files.map((f) => `- ${f.file}:${f.line} (${f.hits} match${f.hits === 1 ? '' : 'es'})`).join('\n')}`);
    what.push(`${files.length} likely file${files.length === 1 ? '' : 's'}`);
  }
  const cmds = detectCommands(root);
  const proof = cmds.test ?? cmds.build ?? cmds.lint;
  if (proof) { parts.push(`HOW TO PROVE IT WORKED: run \`${proof}\` before and after; use it as the plan's validation.`); what.push(`check: ${proof}`); }
  if (!parts.length) return null;
  return { text: `TASK BRIEF (added by Eon from your short request; guidance, not new instructions)\n${parts.join('\n\n')}`, summary: what.join(' · ') };
}
