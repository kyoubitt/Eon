// Saved settings: your defaults (~/.eon/config.json) and a project's saved allow rules (.eon/settings.json).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const configFile = () => path.join(os.homedir(), '.eon', 'config.json');

export function readConfig() {
  try { return JSON.parse(fs.readFileSync(configFile(), 'utf8')); } catch { return {}; }
}

export function writeConfig(patch) {
  const next = { ...readConfig(), ...patch };
  fs.mkdirSync(path.dirname(configFile()), { recursive: true });
  fs.writeFileSync(configFile(), JSON.stringify(next, null, 2));
  return next;
}

const settingsFile = (root) => path.join(root, '.eon', 'settings.json');

function readProject(root) {
  try { return JSON.parse(fs.readFileSync(settingsFile(root), 'utf8')); } catch { return {}; }
}

/** Commands you chose to always allow in this project. */
export function listAllow(root) {
  const rules = readProject(root).allow;
  return Array.isArray(rules) ? rules.filter((r) => typeof r === 'string') : [];
}

export function addAllow(root, rule) {
  const rules = listAllow(root);
  if (!rules.includes(rule)) rules.push(rule);
  fs.mkdirSync(path.dirname(settingsFile(root)), { recursive: true });
  fs.writeFileSync(settingsFile(root), JSON.stringify({ ...readProject(root), allow: rules }, null, 2));
  return rules;
}

/** Remove by rule text or by its number in the list (starting at 1). Returns what was removed, or null. */
export function removeAllow(root, which) {
  const rules = listAllow(root);
  const i = /^\d+$/.test(String(which)) ? Number(which) - 1 : rules.indexOf(String(which));
  if (i < 0 || i >= rules.length) return null;
  const [gone] = rules.splice(i, 1);
  fs.writeFileSync(settingsFile(root), JSON.stringify({ ...readProject(root), allow: rules }, null, 2));
  return gone;
}

const SHELL_TRICKS = /[;&|><`$\n]/;

/**
 * Does a saved rule allow this command? A plain rule allows exactly that command, as typed when you chose
 * "always". A rule ending in ":*" allows that command followed by anything ("npm run:*"), but never when the
 * command chains another one with ; & | > < ` or $.
 */
export function matchRule(rule, cmd) {
  const c = String(cmd).trim();
  if (rule.endsWith(':*')) {
    const prefix = rule.slice(0, -2).trim();
    return !SHELL_TRICKS.test(c) && (c === prefix || c.startsWith(`${prefix} `));
  }
  return c === rule.trim();
}
