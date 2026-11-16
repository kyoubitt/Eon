# Changelog

Versions follow `package.json`. Each release is published automatically from `main`.

## 0.8.2
- Gentler on accounts: the browser flags that hid automation are gone; Eon stops at once on a suspension or ban notice and sends nothing more to that site; a human check that keeps returning is not retried; a count of today's messages with a question before a very busy day; growing waits after failures and a stop after three; `eon check`, `eon inspect` and `eon teach` rest 10 minutes between runs (`--again` overrides); a plain warning at `eon login`.
- Feature switches (`eon features`): `--rewrite`, sub-agents, MCP and the picture helper are off until you turn them on. `eon bisect` finds which switch upsets a site by elimination.
- The first message is worded like a person wrote it; the action format and rules are unchanged.
- Fixes found on a real Windows PC: tests no longer write into your real `~/.eon` (Windows reads `USERPROFILE`, not `HOME`); a reply selector that points at the whole page is never saved and one saved earlier is ignored; `doctor --fix` counts Eon's own downloaded browser; MCP commands with spaces in the path now start on Windows; first-run no longer claims you are logged in; `eon login` says the window can be closed and a still-open window gets a plain message; `eon --version`; `eon hepl` is caught as a typo.

## 0.8.1
- Typing `/` opens a scrolling menu of every command and skill, ranked as you type (`/sec` finds `security-review`, `/tokens` finds `/usage`); skills are labelled and picking one inserts it ready for your request.

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
