// Turn a raw failure into a plain sentence and, where there is one, the command that fixes it.
export function explainError(e) {
  const m = String(e?.message ?? e);
  const rules = [
    [/Playwright is not installed/i, 'Eon needs Playwright to drive the browser.', 'npm install playwright'],
    [/Executable doesn't exist|browserType\.launch.*install|Looks like Playwright .* was just installed/i, "Playwright's browser is not downloaded yet.", 'npx playwright install chromium'],
    [/Target page, context or browser has been closed|Browser has been closed|Target closed/i, 'The browser window was closed. Eon opens it again with the next message.', null],
    [/ENOTFOUND|ECONNREFUSED|ERR_INTERNET_DISCONNECTED|ERR_NAME_NOT_RESOLVED|net::ERR_/i, 'Eon could not reach the site. Check your internet connection.', null],
    [/ERR_CONNECTION_RESET|ERR_TIMED_OUT|Timeout .* exceeded/i, 'The site took too long to answer.', null],
    [/needs a git repository/i, 'Eon needs a git repository with a commit so every change can be undone.', 'git init && git add -A && git commit -m "start"'],
  ];
  for (const [re, text, fix] of rules) if (re.test(m)) return { text, fix, raw: m };
  return { text: m.split('\n')[0], fix: null, raw: m };
}
