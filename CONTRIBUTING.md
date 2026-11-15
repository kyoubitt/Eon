# Contributing

Thanks for helping. Eon is small on purpose; fixes and tests are the most useful contributions.

```bash
git clone https://github.com/kyoubitt/eon && cd eon
npm install
npm test            # unit tests; browser tests need Playwright's Chromium (npx playwright install chromium)
```

- **A site stopped working?** Run `eon harness <site>` and `eon inspect <site>`, and attach both reports to an issue. They hold structure and timings only, no page text.
- **Adding a site:** add its selectors to `src/providers/web-chat.js`, a stand-in page style to `support/fake-chat.js` (`PROFILES`), and make `eon harness --stand-in` pass for it.
- **Adding a skill:** a folder in `skills/<name>/SKILL.md` with `name`, a one-line `description` and 4 to 7 numbered steps. The tests check the shape.
- **Pictures and charts** are generated: `python3 tools/diagram.py`, `python3 tools/diagrams.py`, `node tools/bench.mjs` + `python3 tools/charts.py`.
- Keep changes small, add a test with each fix, and describe what you could and could not test.

By contributing you agree your work is licensed under the AGPL-3.0-or-later like the rest.
