# Changelog

Versions follow `package.json`. Each release is published automatically from `main`.

## 0.8.0
- No more theatre: messages are pasted at once with no mouse glide, random pauses or minimum gap between messages (`--pace slow` brings them back). About 1.2 s of Eon time per message instead of 1.5 s.
- Benchmarks and charts re-measured without the simulated reasoning delay.

## 0.7.1
- Documentation: new README, architecture and benchmarks pages, FAQ on account risk, issue template.

## 0.7.0
- `eon harness [site]`: five short scenarios with pass/fail and a report to paste; `--stand-in` for all 8 sites.
- Waits for the Send button to wake up instead of falling back to Enter.
- Docs: architecture, storage and fallback diagrams; benchmarks; contributing and security notes.

## 0.6.x
- Condensed session output (one line per tool, "blocked" instead of red errors, short model prose, compact done summary).
- Shorter `--help` and `/help`, typo suggestions, one-line first-run result.
- `--rewrite`: the model restates a request first and you approve it.

## 0.5.0
- Task brief: the matching skill, likely files and the check command are added to short requests, locally.

## 0.3.0 to 0.4.0
- Skills (17 built in), `/skills`, `--fast`.

## 0.2.0
- `eon update` and a once-a-day version note, `/export`, `eon doctor --fix`, demo recording, badges.

## 0.1.x
- First public version: plan gate, evidence tags, git branch or backup isolation, many chat sites, local models, memory, sub-agents, MCP client, hooks, pictures, crash recovery, one-click installers, GitHub releases and packages. Relicensed under AGPL-3.0-or-later in 0.1.2.
