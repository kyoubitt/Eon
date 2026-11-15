---
name: commit-message
description: Write a clear commit message (and PR text) for the current changes.
---
1. Read `git status` and `git diff` (read-only). Group the changes by purpose; if there are unrelated purposes, suggest splitting them.
2. Subject: 50 characters or fewer, imperative ("Fix login redirect"), no full stop. Body: what changed and why, wrapped at about 72 columns; mention anything risky or follow-up.
3. Do not mention tools or who wrote it. Do not invent changes that are not in the diff.
4. Give the message as text; run git commit only if the user asks.
