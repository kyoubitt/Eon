// Git isolation: every task gets its own branch, by default in its own worktree.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

function git(cwd, args) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' });
  return { ok: r.status === 0, status: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}`.trim() };
}

export function isRepo(root) {
  return git(root, ['rev-parse', '--is-inside-work-tree']).out === 'true';
}

export function hasCommits(root) { return git(root, ['rev-parse', '--verify', 'HEAD']).ok; }

export function isDirty(root) { return git(root, ['status', '--porcelain']).out !== ''; }

/** Keep Eon's own folder out of the user's commits without touching .gitignore. */
export function excludeEonDir(root) {
  const common = git(root, ['rev-parse', '--git-common-dir']).out;
  const file = path.resolve(root, common, 'info', 'exclude');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const current = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  for (const dir of ['.eon/', '.keel/']) if (!current.split('\n').includes(dir)) fs.appendFileSync(file, `${current.endsWith('\n') || !current ? '' : '\n'}${dir}\n`);
}

/** Returns the directory the task will work in. */
export function startTaskBranch(root, id, { inPlace = false } = {}) {
  const branch = `eon/${id}`;
  if (inPlace) {
    const r = git(root, ['switch', '-c', branch]);
    if (!r.ok) throw new Error(`could not create branch ${branch}: ${r.out}`);
    return { dir: root, branch };
  }
  const dir = path.join(root, '.eon', 'worktrees', id);
  const r = git(root, ['worktree', 'add', '-b', branch, dir, 'HEAD']);
  if (!r.ok) throw new Error(`could not create worktree: ${r.out}`);
  return { dir, branch };
}

/** Commit everything in the task directory. Returns the short hash, or null if nothing changed. */
export function commitAll(dir, subject, body) {
  git(dir, ['add', '-A']);
  if (git(dir, ['diff', '--cached', '--quiet']).status === 0) return null;
  const identity = git(dir, ['config', 'user.email']).out ? [] : ['-c', 'user.name=Eon', '-c', 'user.email=eon@localhost'];
  const r = git(dir, [...identity, 'commit', '-q', '-m', subject, '-m', body]);
  if (!r.ok) throw new Error(`commit failed: ${r.out}`);
  return git(dir, ['rev-parse', '--short', 'HEAD']).out;
}

export function listFiles(root) {
  return isRepo(root)
    ? git(root, ['ls-files']).out.split('\n').filter(Boolean)
    : fs.readdirSync(root).filter((n) => n !== '.eon');
}

export function fileTree(root, limit = 200) {
  const files = listFiles(root);
  return files.slice(0, limit).join('\n') + (files.length > limit ? `\n... ${files.length - limit} more files` : '');
}

/** Mark where the repository stood before an unattended run, so it is easy to return to. */
export function tagCheckpoint(root, id) {
  const tag = `eon-checkpoint/${id}`;
  const r = git(root, ['tag', tag, 'HEAD']);
  if (!r.ok) throw new Error(`could not create checkpoint tag: ${r.out}`);
  return tag;
}

/**
 * Guided and autonomous work needs a repository with a commit. If the folder is not one,
 * ask before creating it. Returns true when the folder is ready.
 */
export function projectProblem(root) {
  const real = (p) => { try { return fs.realpathSync(p); } catch { return path.resolve(p); } };
  const here = real(root), home = real(os.homedir());
  const norm = (p) => p.replace(/[\\/]+$/, '').toLowerCase();
  if (norm(here) === norm(home)) return 'This is your home folder, not a project.';
  if (path.parse(here).root === here) return 'This is a drive root, not a project.';
  const personal = ['Desktop', 'Documents', 'Downloads', 'Pictures', 'Music', 'Videos', 'OneDrive', 'AppData'].map((n) => norm(path.join(home, n)));
  if (personal.includes(norm(here))) return 'This is one of your personal folders, not a project.';
  if (/^(c:[\\/](windows|program files( \(x86\))?|programdata)|\/(usr|etc|bin|sbin|var|opt|proc|sys|lib))$/i.test(norm(here))) return 'This is a system folder, not a project.';
  return null;
}

/** Roughly how many files a folder holds (stops counting at the limit). */
export function countFiles(root, limit = 2000) {
  let n = 0;
  const skip = new Set(['node_modules', '.git', '.eon']);
  const walk = (dir) => {
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (n > limit) return;
      if (e.isDirectory()) { if (!skip.has(e.name)) walk(path.join(dir, e.name)); } else n++;
    }
  };
  walk(root);
  return n;
}

/**
 * Editing is safest with git, but it is not required. Returns 'repo' (ready), 'nogit' (edit in place with
 * backups) or false (look around only).
 */
export async function ensureRepo(root, ask) {
  if (isRepo(root) && hasCommits(root)) return 'repo';
  const problem = projectProblem(root);
  const big = !problem && countFiles(root) > 2000;
  const why = problem ?? (big ? 'This folder holds more than 2,000 files, which is too many to commit as a first step.' : null);
  if (problem) {
    await ask(`${problem}\nEon will not edit files or set up git here. Open a project folder first: cd <your project>, then run eon.\nFor now it can look around without editing (research mode). Press Enter to continue: `);
    return false;
  }
  if (big) {
    const answer = await ask(`${why}\nEon will not set up git here.\n[w]ork here without git (backups, /undo works) / [r]esearch only: `);
    return /^w/i.test(answer) ? 'nogit' : false;
  }
  const answer = await ask('This folder is not a git repository with a commit yet. Git makes every change easy to undo.\n[g] make it a git repository here (Eon never uses GitHub or pushes anything) / [w]ork without git (Eon keeps backups of changed files) / [r]esearch only: ');
  if (/^w/i.test(answer)) return 'nogit';
  if (!/^(g|y)/i.test(answer)) return false;
  if (!isRepo(root)) {
    const r = git(root, ['init', '-q']);
    if (!r.ok) return lockFailure(r.out);
  }
  excludeEonDir(root);
  // Without a .gitignore, keep the usual heavy and secret files out of this first commit.
  if (!fs.existsSync(path.join(root, '.gitignore'))) {
    const common = git(root, ['rev-parse', '--git-common-dir']).out;
    fs.appendFileSync(path.resolve(root, common, 'info', 'exclude'), 'node_modules/\n.env\n.env.*\n');
  }
  const identity = git(root, ['config', 'user.email']).out ? [] : ['-c', 'user.name=Eon', '-c', 'user.email=eon@localhost'];
  const add = git(root, ['add', '-A']);
  const r = add.ok ? git(root, [...identity, 'commit', '-q', '--allow-empty', '-m', 'start']) : add;
  if (!r.ok) return lockFailure(r.out);
  return 'repo';
}

function lockFailure(out) {
  const lock = out.match(/Unable to create '([^']+\.lock)'/)?.[1];
  throw new Error(lock
    ? `Git could not start: ${lock} already exists. Another git program, or an earlier run that was cut off, left it behind. Close other git programs and delete that file, or type /mode research to look around without editing. (Eon will not ask again until you restart it.)`
    : `Git could not start: ${out.slice(0, 300)}. Type /mode research to look around without editing.`);
}

/** Bring a finished session's branch into the checkout. Undone automatically if it conflicts. */
export function mergeBranch(root, branch, dir) {
  if (git(root, ['status', '--porcelain', '--untracked-files=no']).out) throw new Error('Your checkout has uncommitted changes. Commit or stash them, then merge again.');
  const identity = git(root, ['config', 'user.email']).out ? [] : ['-c', 'user.name=Eon', '-c', 'user.email=eon@localhost'];
  const r = git(root, [...identity, 'merge', '--no-ff', '-m', `Merge ${branch}`, branch]);
  if (!r.ok) {
    git(root, ['merge', '--abort']);
    throw new Error(`The merge had conflicts, so it was undone and nothing changed. To resolve them yourself: git merge ${branch}\n${r.out.slice(0, 400)}`);
  }
  if (dir && dir !== root && fs.existsSync(dir)) git(root, ['worktree', 'remove', '--force', dir]);
  return git(root, ['rev-parse', '--short', 'HEAD']).out;
}

/** Throw a session's work away: its worktree and its branch. */
export function discardBranch(root, branch, dir) {
  if (!dir || dir === root) throw new Error(`This session works directly in your checkout (--in-place), so Eon will not delete it for you. To discard it: git switch - && git branch -D ${branch}`);
  if (fs.existsSync(dir)) git(root, ['worktree', 'remove', '--force', dir]);
  git(root, ['worktree', 'prune']);
  const r = git(root, ['branch', '-D', branch]);
  if (!r.ok) throw new Error(`could not delete ${branch}: ${r.out}`);
}

/** Remove the newest commit on the session branch, but only if Eon made it. Returns its subject line. */
export function undoLastCommit(dir) {
  const subject = git(dir, ['log', '-1', '--format=%s']).out;
  if (!/^(eon|keel):/.test(subject)) throw new Error('The newest commit on this branch is not one of Eon\'s, so there is nothing to undo.');
  const r = git(dir, ['reset', '--hard', 'HEAD~1']);
  if (!r.ok) throw new Error(`undo failed: ${r.out}`);
  return subject;
}
