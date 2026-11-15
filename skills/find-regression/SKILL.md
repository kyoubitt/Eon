---
name: find-regression
description: Find which change broke something, by narrowing down the history.
---
1. Get a command that shows the failure and note whether it passes on an older commit (git log, then check out or use a worktree; never touch the user's working files).
2. Bisect by hand or with `git bisect run <command>` on a throwaway worktree. Read the commit that flips the result.
3. Explain why that change causes the failure, with file:line. Tag it fact only after the revert test passes.
4. Propose the smallest fix on the current code; do not simply revert unless the user asks.
