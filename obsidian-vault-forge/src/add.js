// Add a single note (meeting or decision) to an existing vault, reusing the
// project context the forge recorded in .vaultforge.json.
import fs from 'node:fs';
import path from 'node:path';
import { makeNote } from './frontmatter.js';
import { decisionNote, meetingNote } from './templates.js';
import { sanitizeTitle, todayISO } from './util.js';

export class VaultError extends Error {}

/** Recover render context from a forged vault. */
export function readVaultContext(vaultRoot, { today = todayISO() } = {}) {
  const metaPath = path.join(vaultRoot, '.vaultforge.json');
  if (!fs.existsSync(metaPath)) {
    throw new VaultError(
      `not a forged vault (no .vaultforge.json): ${vaultRoot}\n` +
        'Run `vault forge <project.yml> -o <root>` first.'
    );
  }
  let meta;
  try {
    meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
  } catch (err) {
    throw new VaultError(`corrupt .vaultforge.json in ${vaultRoot}: ${err.message}`);
  }
  return {
    project: meta.project,
    slug: meta.slug,
    tags: Array.isArray(meta.tags) ? meta.tags : [],
    today,
    // fields the add-note builders don't use but base() tolerates:
    status: 'active',
    client: '',
    siteUrls: [],
    links: {},
    stakeholders: [],
  };
}

/** Plan for a new meeting note: 05-Meetings/<date> <topic>.md */
export function buildMeetingPlan(ctx, topic, { date = ctx.today } = {}) {
  const note = meetingNote({ topic, date, ctx });
  const name = sanitizeTitle(`${date} ${topic}`);
  return {
    dirs: [],
    files: [{ path: `05-Meetings/${name}.md`, content: makeNote(note.frontmatter, note.body) }],
  };
}

/** Plan for a new ADR: 04-Decisions/<date> <title>.md */
export function buildDecisionPlan(ctx, title, { date = ctx.today, status = 'proposed' } = {}) {
  const note = decisionNote({ title, date, status, ctx });
  const name = sanitizeTitle(`${date} ${title}`);
  return {
    dirs: [],
    files: [{ path: `04-Decisions/${name}.md`, content: makeNote(note.frontmatter, note.body) }],
  };
}
