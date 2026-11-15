---
name: security-review
description: Look for security problems in the code or the current changes, read-only.
---
1. Scope: the current diff (`git diff`) or the area the user names. Read around each change, not only the changed lines.
2. Check: injection (SQL, shell, HTML), unvalidated input at every boundary, authentication and authorisation on each route, secrets in code or logs, unsafe deserialisation, path traversal, weak randomness or crypto, over-broad CORS or permissions, dependencies with known issues.
3. For each finding give file:line, how it could be abused in one sentence, and the smallest fix. Tag it fact only if you saw the vulnerable path; otherwise say what you could not confirm.
4. Rank high, medium, low. Say what you did not check. Make no edits unless the user asks.
