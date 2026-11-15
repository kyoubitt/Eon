---
name: performance
description: Find and fix a performance problem by measuring first.
---
1. Write down the symptom with a number (time, memory, requests) and the command that shows it. If you cannot measure it, say that first.
2. Profile or time the real path; do not guess. Look for the biggest cost, not the first suspicious line (repeated work in loops, N+1 queries, large allocations, blocking calls, missing caching or indexes).
3. Tag the cause as fact only with a measurement.
4. Fix the one biggest cost. Re-measure with the same command and report before and after.
5. Stop when the target is met. Do not rewrite code that is not on the hot path.
