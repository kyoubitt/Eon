---
name: review-changes
description: Review the current uncommitted changes for bugs and risks, read-only.
---
1. Run `git status` and `git diff` (read-only). Read each changed file around the edit, not just the diff lines.
2. Check: wrong conditions, missing error handling, changed behaviour for callers (search for usages), secrets, leftover debug code, missing tests.
3. Report findings by severity (high, medium, low) as file:line, what is wrong, how to fix. Say what you did not check.
4. Make no edits. Finish with done and the list.
