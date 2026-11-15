---
name: upgrade-deps
description: Upgrade dependencies safely, one at a time, with tests between each.
---
1. List outdated packages with the project's tool (npm outdated, pip list --outdated, cargo outdated). Run the tests first to get a baseline.
2. Group: patch and minor upgrades together, each major upgrade alone. Read the changelog or release notes for every major one (fetch_doc).
3. One step per group. After each: install, run tests and build, search the code for APIs the changelog says changed.
4. If something breaks, revert that step and report what changed upstream instead of patching around it.
5. Never edit lockfiles by hand.
