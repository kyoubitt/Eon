---
name: tdd
description: Build a feature test-first: failing test, smallest code to pass, then tidy.
---
1. Find the test runner and an existing test to copy the style from.
2. Write one failing test for the next small behaviour. Run it and show that it fails for the right reason.
3. Write the least code that makes it pass. Run the tests.
4. Repeat for the next behaviour. After each pass, tidy only if the tests stay green.
5. Plan one step per behaviour, with the test command as validation. Never skip the failing run.
