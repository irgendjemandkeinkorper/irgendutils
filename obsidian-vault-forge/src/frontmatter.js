// YAML front-matter helpers built on the small YAML parser.
import { parseYAML, toYAML } from './yaml.js';

/**
 * Parse a Markdown document into { data, body }.
 * Returns data: null when the document has no front-matter block.
 */
export function parseFrontMatter(markdown) {
  const text = String(markdown);
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---(\r?\n|$)/);
  if (!m) return { data: null, body: text };
  return { data: parseYAML(m[1]), body: text.slice(m[0].length) };
}

/** Build a full note: front-matter block + body. Always ends with newline. */
export function makeNote(frontmatter, body) {
  return `---\n${toYAML(frontmatter)}---\n\n${String(body).replace(/\s+$/, '')}\n`;
}
