# Eon

A coding agent for your terminal that runs on **free web chats** (DeepSeek, Gemini, ChatGPT, Claude, Qwen, Mistral, Grok, Kimi, or any site you add). No API key. The model does the thinking; a local program does the acting and enforces the rules. **Eon plans before it edits.**

![How one request flows](examples/architecture.png)

## Install

**Windows:** download the repo as a zip, unzip it, and double-click **`install.bat`**.

**Mac / Linux:**

```bash
curl -fsSL https://raw.githubusercontent.com/kyoubitt/eon/main/install.sh | sh
```

Both install Node.js and Git if missing, set Eon up, and add the `eon` command. By hand: Node 18+, Git, then `npm run setup`.

## Use

```bash
eon login      # once: log in to DeepSeek in the window that opens
eon check      # confirm it works end to end
cd my-project
eon            # start
```

Type a task. Eon reads your code, shows a plan with the evidence behind each claim, and edits only after you approve. Every change lands on its own git branch (or is backed up if there is no git), so `/undo` and `/discard` always work.

## What it does

- **Plan gate.** No edit without an approved plan. Claims are tagged fact, inference or assumption, and confidence is computed, not claimed.
- **Many models, one chain.** `--model deepseek,gemini,qwen` falls back when one hits its limit. Local models work too (`eon setup-local`).
- **Modes.** `guided` (approve each step), `accept` (approve the plan only), `research` (read-only), `autonomous` (works alone in a worktree).
- **Sub-agents, MCP servers, hooks.** Read-only helpers in their own chat tab, any MCP tool server (`eon mcp add`), and your own commands around edits.
- **Pictures.** `@screenshot.png`; models that cannot see get a description from one that can.
- **Memory and lessons.** `EON.md` and memory files, plus rules it learns from its own mistakes.
- **Safe by default.** Refuses your home folder, asks before commands, redacts secrets, never logs in to GitHub and never pushes.
- **Never stuck.** Esc and Ctrl+C always work; human checks and logouts are noticed and continued; crashed sessions offer to resume.

Useful commands: `/plan` `/diff` `/undo` `/usage` `/raw` `/model` `/compact` `/resume` `/check` `/help`.

## Honest notes

- It drives real chat pages in a browser, so it can break when a site changes. `eon teach <site>`, `eon inspect <site>` and `eon doctor --report` help fix that.
- Free chats throttle heavy use, and automating them may be against a site's terms.
- Tested against stand-in pages and scripted models on Linux. A real DeepSeek run on Windows passed its end-to-end check; the other sites are untested live.
- Token counts are estimates (characters ÷ 4).

## More

Full guide: [docs/guide.md](docs/guide.md) (every command, mode, setting and limit).

```bash
npm test      # unit tests; browser tests run when Playwright is installed
```

MIT license.
