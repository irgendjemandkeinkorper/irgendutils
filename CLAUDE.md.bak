# irgendutils — working guide

Monorepo of 13 small, single-purpose utilities for a WordPress + knowledge-management
workflow (see `README.md` for the full list). Each app is self-contained in its own
folder with its own `CLAUDE.md` spec.

## Token-cost discipline (read this first)

This repo has many independent apps, which makes it tempting to fan out a swarm of
agents. **Don't.** Parallel subagents each carry their own copy of context and re-read
their own files — cost is *multiplicative*, not shared. A 13-agent fan-out can burn an
entire session budget in minutes. The rules below keep cost proportional to the work.

### 1. Prefer sequential over parallel agents
- Default to working **one app at a time** in the main conversation.
- Only spawn a subagent when the task is genuinely independent AND read-heavy enough
  that isolating it saves the main context more than the agent's own overhead costs.
- Never fan out more than **2–3 agents at once** here. If you're tempted to launch one
  per app, batch them across turns instead.

### 2. Delegate by model tier
- **Haiku 4.5** — mechanical work: linting, formatting, renames, boilerplate, applying
  a known pattern across files, writing fixtures.
- **Sonnet 5** — normal implementation: building out an app's features from its spec.
- **Opus 4.8** — reserve for architecture, cross-app design, and hard debugging only.
- When delegating to a subagent, pass an explicit `model` override matched to the task.

### 3. Scope tool output — the silent token drain
- Read specific line ranges, not whole files, once you know where you're going.
- Use Grep/Glob to locate; don't dump directories with `find` or `ls -R`.
- Never pipe raw build/test/install logs into context. Run them, capture pass/fail and
  the relevant error lines only.
- Summarize long command output to what's actionable.

### 4. Checkpoint often
- Commit each app (or each meaningful unit) as soon as it's working. Untracked work is
  unprotected and forces re-derivation if context resets.
- Small, frequent commits let context compact without losing progress.

### 5. Watch the budget
- Check `/context` before large operations. Compact deliberately rather than letting it
  auto-summarize mid-task.

## Repo conventions (from README)
- **REST API + Application Passwords** is the default path for every app; WP-CLI over
  SSH is an optional optimization. Detect SSH at startup; degrade gracefully when absent.
- **Idempotent, reversible, dry-run by default.** `--apply` to mutate; teardown for
  every create.
- **Secrets from env, never committed.** `.env.example` in every app.
- **Verify, don't assume.** Each app ships a verification step and pass/fail fixtures;
  "it ran" ≠ "it worked."

## Working on an app
Read that app's own `CLAUDE.md` first — it's the authoritative spec. Match the existing
stack choice (WP-native first; Node only where a JS-only tool wins).
