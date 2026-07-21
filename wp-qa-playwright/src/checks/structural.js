// Structural diff: compare landmarks, h1–h3 outline and Gutenberg block types
// between a template structure and a target structure (from html.extractStructure).
// Reports missing/extra sections, never raw HTML diffs.

export function structuralDiff(template, target) {
  const findings = [];
  const push = (severity, message, details) =>
    findings.push({ check: 'structural', severity, message, ...(details ? { details } : {}) });

  for (const lm of template.landmarks) {
    if (!target.landmarks.includes(lm)) push('error', `Missing landmark <${lm}> (present in template)`);
  }
  for (const lm of target.landmarks) {
    if (!template.landmarks.includes(lm)) push('info', `Extra landmark <${lm}> (not in template)`);
  }

  const key = (h) => `h${h.level}:${h.text.toLowerCase()}`;
  const templateKeys = new Set(template.headings.map(key));
  const targetKeys = new Set(target.headings.map(key));
  for (const h of template.headings) {
    if (!targetKeys.has(key(h))) push('warn', `Missing heading <h${h.level}> "${h.text}" (present in template)`);
  }
  for (const h of target.headings) {
    if (!templateKeys.has(key(h))) push('info', `Extra heading <h${h.level}> "${h.text}" (not in template)`);
  }
  const h1Count = target.headings.filter((h) => h.level === 1).length;
  if (h1Count !== 1) push('warn', `Expected exactly one <h1>, found ${h1Count}`);

  for (const b of template.blocks) {
    if (!target.blocks.includes(b)) push('warn', `Missing Gutenberg block type "${b}" (present in template)`);
  }
  for (const b of target.blocks) {
    if (!template.blocks.includes(b)) push('info', `Extra Gutenberg block type "${b}" (not in template)`);
  }

  return findings;
}
