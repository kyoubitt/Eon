---
name: add-tests
description: Add tests for existing code in the project's own test style.
---
1. Find the test runner and one existing test file (detected commands list the runner). Copy its style, imports and naming.
2. Read the code under test. List its behaviours: normal use, edge cases, errors.
3. Plan: one step per test file. Validation is the test command.
4. Write tests that fail if the behaviour breaks (assert results, not that code ran). No mocks unless the project already uses them.
5. Run the tests. If one fails, decide whether the test or the code is wrong; say which, with evidence.
