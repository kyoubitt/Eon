// A pull-request description built from a session's plan and evidence.
export function buildPr({ task, plan, branch, commits = [], review = null }) {
  const lines = [`# ${plan?.goal || task}`, ''];
  lines.push('## What changed', ...(commits.length ? commits.map((c) => `- ${c}`) : plan?.steps.map((s) => `- ${s.text}`) ?? ['- (see the diff)']), '');
  if (plan) {
    lines.push('## Why this is right (evidence)');
    for (const c of plan.claims) lines.push(`- **${c.tag}**: ${c.text}${c.pointer ? ` (\`${c.pointer}\`)` : c.check ? ` (check: ${c.check})` : ''}`);
    lines.push('');
    lines.push('## How to check', ...plan.validation.map((v) => `- \`${v}\``), '');
    const open = plan.claims.filter((c) => c.load_bearing !== false && c.tag === 'assumption');
    if (open.length) lines.push('## Not yet checked', ...open.map((c) => `- ${c.text}`), '');
  }
  if (review?.issues?.length) lines.push(`## Review by ${review.by}`, ...review.issues.map((i) => `- ${i.severity}: ${i.text}`), '');
  lines.push(`_Task: ${task}${branch ? ` · branch \`${branch}\`` : ''}_`);
  return lines.join('\n');
}
