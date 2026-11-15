---
name: debug-ci
description: Work out why a CI run or build fails and fix it, reproducing locally first.
---
1. Ask for the failing log or find the CI config (.github/workflows, .gitlab-ci.yml) and the exact command that failed.
2. Reproduce that command locally with the same Node/Python/etc. version if you can. A failure you cannot reproduce is an inference, say so.
3. Read the first error, not the last; later errors are often caused by it. Search for the message in the code.
4. Typical causes to rule out: version mismatch, missing env var or secret, test order or timing, platform differences (paths, line endings), a lockfile out of date.
5. Fix the cause, run the same command, and state the evidence that it passes.
