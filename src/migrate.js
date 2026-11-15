// Eon was called Keel before. Move what the old version saved so nothing is lost:
// the home folder (browser login, selectors, history) and a project's saved sessions, memory and research.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

export function migrateHome(home = os.homedir()) {
  const oldDir = path.join(home, '.keel'), newDir = path.join(home, '.eon');
  if (!fs.existsSync(oldDir) || fs.existsSync(newDir)) return false;
  try { fs.renameSync(oldDir, newDir); return true; } catch { return false; } // a browser still holding the folder open: leave it
}

export function migrateProject(root) {
  const oldDir = path.join(root, '.keel'), newDir = path.join(root, '.eon');
  if (!fs.existsSync(oldDir) || fs.existsSync(newDir)) return false;
  try { fs.renameSync(oldDir, newDir); } catch { return false; }
  // A worktree remembers where it lives, and each session remembers its worktree: update both.
  const worktrees = path.join(newDir, 'worktrees');
  if (fs.existsSync(worktrees)) {
    const dirs = fs.readdirSync(worktrees).map((d) => path.join(worktrees, d));
    if (dirs.length) spawnSync('git', ['worktree', 'repair', ...dirs], { cwd: root });
  }
  const tasks = path.join(newDir, 'tasks');
  if (fs.existsSync(tasks)) {
    for (const id of fs.readdirSync(tasks)) {
      const file = path.join(tasks, id, 'session.json');
      try {
        const text = fs.readFileSync(file, 'utf8');
        const fixed = text.replace(/([\\/])\.keel([\\/])/g, '$1.eon$2');
        if (fixed !== text) fs.writeFileSync(file, fixed);
      } catch { /* a session without a record */ }
    }
  }
  return true;
}
