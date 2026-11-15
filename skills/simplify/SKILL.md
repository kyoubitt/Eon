---
name: simplify
description: Clean up recently changed code: remove duplication and dead code without changing behaviour.
---
1. Find the recent changes (`git diff`, `git log -5 --stat`) and read the touched files.
2. Look for: repeated blocks, unused variables and imports, over-complicated conditions, helpers that already exist elsewhere (search before writing a new one), comments that restate the code.
3. Plan small steps, one kind of cleanup each. Validation is the project's tests and lint before and after.
4. Do not change behaviour, public names or formatting of untouched code. If a cleanup needs a behaviour change, stop and ask.
