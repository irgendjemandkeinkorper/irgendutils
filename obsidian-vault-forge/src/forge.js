// Build a write-plan for a vault from a normalized manifest. A plan is pure
// data — { vaultName, dirs, files:[{path, content, overwrite}] } — so it can be
// scanned for secrets and diffed before a single byte hits disk.
import { makeNote } from './frontmatter.js';
import { sanitizeTitle, todayISO } from './util.js';
import {
  indexNote,
  briefNote,
  scopeNote,
  stakeholderNote,
  siteInventoryNote,
  credentialsNote,
  tasksNote,
  seedTemplates,
} from './templates.js';

/** Folders that start empty but must exist so the structure is navigable. */
const EMPTY_DIRS = ['04-Decisions', '05-Meetings', '07-Assets & References'];

/** Assign each stakeholder a unique, link-safe note name so colliding names
 * never share (and silently overwrite) a note. */
function resolveStakeholderNames(stakeholders) {
  const seen = new Set();
  return stakeholders.map((person) => {
    const base = sanitizeTitle(person.name);
    let noteName = base;
    let n = 2;
    while (seen.has(noteName.toLowerCase())) noteName = `${base} (${n++})`;
    seen.add(noteName.toLowerCase());
    return { ...person, noteName };
  });
}

/** Shared render context derived from a manifest. */
export function contextFrom(manifest, { today = todayISO() } = {}) {
  return {
    project: manifest.name,
    slug: manifest.slug,
    client: manifest.client,
    status: manifest.status,
    tags: manifest.tags,
    siteUrls: manifest.siteUrls,
    links: manifest.links,
    stakeholders: resolveStakeholderNames(manifest.stakeholders),
    today,
  };
}

function file(path, note, overwrite = false) {
  return { path, content: makeNote(note.frontmatter, note.body), overwrite };
}

/** Build the full vault plan. `today` is injected for reproducible output. */
export function buildPlan(manifest, { today = todayISO() } = {}) {
  const ctx = contextFrom(manifest, { today });
  const files = [];

  // Machine metadata so add-meeting/add-decision can recover project context.
  // Dot-file → skipped by the vault walkers, and always safe to overwrite.
  files.push({
    path: '.vaultforge.json',
    content:
      JSON.stringify(
        { project: ctx.project, slug: ctx.slug, tags: ctx.tags, created: ctx.today },
        null,
        2
      ) + '\n',
    overwrite: true,
  });

  files.push(file('00-Index.md', indexNote(ctx)));
  files.push(file('01-Brief/Project Brief.md', briefNote(ctx)));
  files.push(file('01-Brief/Scope & Deliverables.md', scopeNote(ctx)));

  for (const person of ctx.stakeholders) {
    files.push(file(`02-Stakeholders/${person.noteName}.md`, stakeholderNote(person, ctx)));
  }

  files.push(file('03-Sites & Environments/Site Inventory.md', siteInventoryNote(ctx)));
  files.push(file('03-Sites & Environments/Access & Credentials.md', credentialsNote(ctx)));
  files.push(file('06-Tasks/Tasks.md', tasksNote(ctx)));

  for (const t of seedTemplates()) files.push({ ...t, overwrite: false });

  return { vaultName: ctx.slug, dirs: EMPTY_DIRS, files };
}
