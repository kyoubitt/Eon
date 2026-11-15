---
name: refactor-safely
description: Restructure code without changing behaviour, checked by tests before and after.
---
1. Run the tests first and note the result. If there are none for this code, add tests that pin the current behaviour first (one step).
2. Plan small steps, each leaving the tests green. One kind of change per step (rename, move, extract).
3. Use search to find every usage before renaming or moving anything.
4. After each step run the tests. If they fail, undo that step and try a smaller one.
5. Do not mix refactoring with behaviour changes.
