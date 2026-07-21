// Note builders. Each returns { frontmatter, body }; forge/add compose them
// into files with makeNote(). Front-matter always carries the five keys the
// house rules require (type, project, status, tags, created) so Dataview and
// search work, plus type-specific fields the index's Dataview queries read.
import { sanitizeTitle, stripUrlCredentials } from './util.js';

/** Base front-matter every note shares, in a stable key order. */
function base(type, ctx, extra = {}) {
  return {
    type,
    project: ctx.project,
    status: extra.status ?? ctx.status,
    tags: extra.tags ?? ctx.tags,
    created: ctx.today,
    ...omit(extra, ['status', 'tags']),
  };
}

function omit(obj, keys) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) if (!keys.includes(k)) out[k] = v;
  return out;
}

// ---------------------------------------------------------------------------
// Dashboard index. Lists exactly the notes the forge generates, so every
// wikilink resolves. Dataview blocks keep it live as notes are added; a plain
// wikilink list underneath is the fallback for vaults without Dataview.
export function indexNote(ctx) {
  const frontmatter = base('index', ctx);
  const people = ctx.stakeholders.length
    ? ctx.stakeholders.map((p) => `- [[${p.noteName || sanitizeTitle(p.name)}]]`).join('\n')
    : '- _none yet_';

  const body = `# ${ctx.project} — Project Hub

Dashboard for everything about **${ctx.project}**. Notes below stay in sync via
Dataview; the plain lists are the fallback when Dataview isn't installed.

## Start here
- [[Project Brief]]
- [[Scope & Deliverables]]
- [[Site Inventory]]
- [[Access & Credentials]]
- [[Tasks]]

## Stakeholders
\`\`\`dataview
table role, email from "02-Stakeholders" where type = "person" sort file.name asc
\`\`\`
${people}

## Decisions
\`\`\`dataview
table status, date from "04-Decisions" where type = "decision" sort date desc
\`\`\`
_New ADRs land in \`04-Decisions/\` (\`vault add-decision ${ctx.slug} "..."\`)._

## Meetings
\`\`\`dataview
table date from "05-Meetings" where type = "meeting" sort date desc
\`\`\`
_New notes land in \`05-Meetings/\` (\`vault add-meeting ${ctx.slug} "..."\`)._

## Open tasks
\`\`\`dataview
task from "06-Tasks" where !completed
\`\`\`
See [[Tasks]].`;

  return { frontmatter, body };
}

export function briefNote(ctx) {
  return {
    frontmatter: base('brief', ctx),
    body: `# Project Brief — ${ctx.project}

> One-paragraph statement of what this project is and why it exists.

- **Client:** ${ctx.client || '_tbd_'}
- **Status:** ${ctx.status}
- **Back to** [[00-Index]]

## Background
_Fill in._

## Goals
- _Goal 1_

## Success criteria
- _How we'll know it worked._`,
  };
}

export function scopeNote(ctx) {
  return {
    frontmatter: base('scope', ctx),
    body: `# Scope & Deliverables — ${ctx.project}

Back to [[00-Index]] · related: [[Project Brief]]

## In scope
- _..._

## Out of scope
- _..._

## Deliverables
- [ ] _Deliverable 1_`,
  };
}

export function stakeholderNote(person, ctx) {
  const frontmatter = base('person', ctx, {
    status: 'active',
    role: person.role || 'unknown',
    email: person.email || '',
  });
  return {
    frontmatter,
    body: `# ${sanitizeTitle(person.name)}

- **Role:** ${person.role || '_tbd_'}
- **Email:** ${person.email || '_tbd_'}
- **Project:** [[00-Index]]

## Notes
_..._`,
  };
}

export function siteInventoryNote(ctx) {
  const rows = ctx.siteUrls.length
    ? ctx.siteUrls.map((u) => `| ${stripUrlCredentials(u)} | _tbd_ | _tbd_ | _tbd_ |`).join('\n')
    : '| _none yet_ |  |  |  |';
  const links = Object.entries(ctx.links)
    .map(([k, v]) => `- **${k}:** ${stripUrlCredentials(String(v))}`)
    .join('\n');
  return {
    frontmatter: base('sites', ctx),
    body: `# Site Inventory — ${ctx.project}

Back to [[00-Index]] · credentials live in [[Access & Credentials]] (pointers only).

| URL | Host | DNS | WP mode |
|-----|------|-----|---------|
${rows}

## Links
${links || '- _none_'}`,
  };
}

export function credentialsNote(ctx) {
  // Deliberately holds POINTERS, never secret values. Phrasing avoids
  // \`password:\`/\`token:\` shapes so the secret scanner stays green.
  return {
    frontmatter: base('credentials', ctx),
    body: `# Access & Credentials — ${ctx.project}

Back to [[00-Index]]

> **Never** paste real secrets here. This note records **where** each credential
> lives — a secrets manager, a shared vault — not the value itself.

| System | Stored where | Who has access |
|--------|--------------|----------------|
| WordPress admin | 1Password (vault: ${ctx.client || ctx.project}) | _tbd_ |
| Hosting / SSH | 1Password | _tbd_ |
| DNS registrar | 1Password | _tbd_ |

If you find a real secret written above, move it into the secrets manager and
replace it with a pointer.`,
  };
}

export function tasksNote(ctx) {
  return {
    frontmatter: base('tasks', ctx),
    body: `# Tasks — ${ctx.project}

Back to [[00-Index]]. Checkbox tasks here are picked up by the index's Dataview
\`task\` query.

- [ ] Kick off project
- [ ] Confirm stakeholders and access
- [ ] Draft [[Scope & Deliverables]]`,
  };
}

// --- notes added after forge -------------------------------------------------

export function decisionNote({ title, date, status, ctx }) {
  const frontmatter = base('decision', ctx, {
    status: status || 'proposed',
    date,
    tags: [...ctx.tags, 'adr'],
  });
  return {
    frontmatter,
    body: `# ${sanitizeTitle(title)}

Back to [[00-Index]] · ${date}

## Status
${status || 'proposed'}

## Context
_What forces are at play?_

## Decision
_What did we decide?_

## Consequences
_What becomes easier or harder?_`,
  };
}

export function meetingNote({ topic, date, ctx }) {
  const frontmatter = base('meeting', ctx, { status: 'logged', date });
  return {
    frontmatter,
    body: `# ${date} — ${sanitizeTitle(topic)}

Back to [[00-Index]] · ${date}

## Attendees
- _..._

## Notes
- _..._

## Actions
- [ ] _..._`,
  };
}

// --- 99-Templates/ seeds (Obsidian core Templates plugin) --------------------
// Raw strings using {{title}}/{{date}} placeholders the plugin fills. No
// wikilinks except [[00-Index]] so the link check stays clean.
export function seedTemplates() {
  return [
    {
      path: '99-Templates/Meeting Note.md',
      content: `---
type: meeting
status: logged
tags: [meeting]
---

# {{date}} — {{title}}

Back to [[00-Index]]

## Attendees
-

## Notes
-

## Actions
- [ ]
`,
    },
    {
      path: '99-Templates/Decision (ADR).md',
      content: `---
type: decision
status: proposed
tags: [adr]
---

# {{title}}

Back to [[00-Index]] · {{date}}

## Status
proposed

## Context

## Decision

## Consequences
`,
    },
    {
      path: '99-Templates/Task.md',
      content: `---
type: tasks
tags: [task]
---

# {{title}}

Back to [[00-Index]]

- [ ] {{title}}
`,
    },
  ];
}
