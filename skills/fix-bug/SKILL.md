---
name: fix-bug
description: Find the cause of a bug before changing anything, then fix it with the smallest edit.
---
1. Reproduce: find or write the command that shows the failure (run it, read the exact error).
2. Locate: search for the function or message in the error; read only those files.
3. Explain the cause in one sentence and tag it: fact if you saw it in code or output, otherwise inference.
4. Plan one step per file; the validation is the command from step 1 passing.
5. Fix the cause, not the symptom. Do not reformat or rename unrelated code.
6. Run the validation, verify the claim with its run id, then finish with done.
