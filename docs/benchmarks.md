# Numbers

These are measurements of **Eon itself**, not of any model. Chat sites and models are outside this repository, so their quality and speed are not measured here.

## What is measured, and how

`node tools/bench.mjs` (then `python3 tools/charts.py` for the pictures) runs on the built-in stand-in chat pages with no model behind them, so what is left is Eon's own work and polling.

| measure | result | how |
|---|---|---|
| start-up (`eon --help`) | **70 ms** median | 15 runs |
| driver time per message | **about 1.2 s** (1.0 to 1.2 s across the 8 stand-in sites) | median of 12 short messages per site |
| model messages for a one-line fix | **3** at focused level, **1** at quick level | a scripted model that answers in the fewest messages the rules allow |
| automated tests | **127** (unit, real terminal, real browser) | `npm test` |

![Time per message](img/bench-driver.png)

![Messages for a small fix](img/bench-messages.png)

Machine: Linux x64, 4 cores, Node 22. Re-run on yours; the figures move with the machine.

## What they mean in practice

- A task of *N* messages costs about *1.2 s × N* of Eon overhead plus the model's own time. Most of a real run is the model writing its reply, which Eon cannot speed up. What Eon can do is need fewer messages: skills and the task brief put the recipe in the first message, and `--fast` skips the plan for small edits.
- The 1.2 s is paste, send and a short quiet window (0.5 to 0.8 s) so a reply that is still being written is not cut off. Pauses meant to look human are off by default; `--pace slow` adds them back.

## What is not measured

- Anything on a real site (the live DeepSeek page is untested from where this was built). `eon harness deepseek` measures the same five scenarios on your machine and writes a report.
- Model quality: whether a model plans well or edits correctly. That depends on the model you choose.
- A comparison with other agents. Different models and tasks make such numbers misleading, so none are claimed.

## Two honest notes on changes

- Version 0.7.0 made Eon wait for a Send button to wake up instead of falling back to Enter. With very short pauses this removed an occasional 5 s stall on sites where Enter does not send; at the old pace the medians were the same before and after, so it was a safety net, not a speed-up.
- Version 0.8.0 removed the human-like pauses (mouse glide, short random waits, a minimum gap of 1.5 to 4 s between messages). The median per message went from about 1.5 s to about 1.2 s; the gap mattered more in real use, because a message sent soon after the previous one used to wait out the rest of it. The trade-off is that automation is slightly easier for a site to notice.
