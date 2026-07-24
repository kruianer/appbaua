---
name: setup-devops
description: Defines the DevOps convention for THIS project and writes it as a binding instruction the autonomous worker follows on every run — environments, branch-to-environment mapping, deploy triggers, and promotion rules. Offers ready-made best-practice setups so the user can just say "Setup 1". Use this skill when the user wants to define, change, or document how this project builds, deploys, and promotes code across environments (e.g. "set up devops", "how do we deploy here", "use Setup 1", "define our environments").
---

# Define the Project's DevOps Convention

You help the user pin down how THIS project ships code, and you write it
as a binding instruction into `delivery/devops.md`. This file is a
contract, not a suggestion: the autonomous worker reads it on every run
and MUST obey it — which branch it may commit to, what deploys when, and
that it may NEVER deploy to prod on its own.

The DevOps convention differs per project, which is why this is a local
skill. But you carry ready-made best-practice setups so the user does
not have to reinvent them: they can just say "Setup 1" and you fill in
only the project-specific placeholders. Currently one setup ships
(Setup 1, below); more will be added later, so keep the structure ready
for "Setup 2 / 3".

Language: Conduct the dialogue AND write `delivery/devops.md` in the
language the user speaks to you in. Exception (machine contract, always
applies): section headings the worker relies on, branch names, folder
paths, and the file name `delivery/devops.md` stay unchanged regardless
of language.

## Flow

### 1. Pick a setup

Ask which setup the user wants. If they already named one ("Setup 1"),
skip straight to step 2.

**Setup 1 — dev + prod (the default, two environments):**
- Two environments: `dev` (staging) and `prod`.
- Branch mapping: branch `dev` → dev environment; branch `main` → prod
  environment.
- Deploy trigger: automatic on push. Every push to `dev` deploys the dev
  environment; every merge to `main` deploys prod. (Requires a hosting
  platform with git auto-deploy, e.g. Vercel / Netlify / Railway.)
- Promotion dev → prod: via Pull Request that ONLY the user merges. The
  autonomous worker NEVER deploys to prod itself — human approval is the
  safety net against wrong deploys at night.
- Acceptance / quality gate: a stable dev/staging URL where the user
  tests manually before promoting. This is the "test on staging without
  tools" that capture-requirement and capture-bug assume.

This is consistent with the other skills: the worker commits
continuously to `dev`, and the user accepts on the dev/staging URL
before anything reaches prod.

(Setup 2 and Setup 3 will be added here later. Until then, if the user
asks for a different topology, capture their answers directly instead of
a preset — same four questions: branch→env mapping, promotion, deploy
trigger, acceptance URL.)

### 2. Fill in the project-specific placeholders

A setup fixes the *rules*; these values are still project-specific. Ask
only for what you cannot derive from the repo (check the repo first —
remote URL, existing CI config, package manifest):
- **App / repo name** — usually derivable from the repo.
- **dev/staging URL** — where the user accepts. Ask if unknown.
- **prod URL** — the live URL. Ask if unknown.
- **Hosting platform** — how deploys happen (Vercel / Netlify / Railway
  / other). Ask if not obvious from the repo.

Ask at most one round of questions. For anything genuinely unknown,
write a clearly marked `<TODO: ...>` placeholder into the file rather
than blocking — the user can fill it in later.

### 3. Write delivery/devops.md

Write the file in the template format below with the chosen setup's
rules and the filled-in values. If the file already exists, show the
user what changes before overwriting.

### 4. Link it from CLAUDE.md

`delivery/devops.md` is NOT loaded automatically by the worker — it must
be referenced from CLAUDE.md, or it is ignored. Ensure the repo's
CLAUDE.md contains a `## DevOps` section with a pointer:

```markdown
## DevOps

Deploy, environments, and promotion rules for this project are defined
in [delivery/devops.md](delivery/devops.md). Follow them exactly. In
particular: NEVER deploy to prod autonomously.
```

If CLAUDE.md has no such section, add it. If it already points there,
leave it. If no CLAUDE.md exists, offer to create one with this section.

### 5. Confirm

Show the user the written `delivery/devops.md` in full and confirm the
CLAUDE.md pointer is in place. Do NOT commit or push unless the user
asks — this is a convention change they should review first.

## Template

```markdown
---
project: <repo-name>
setup: 1
---

# DevOps Convention

This file is binding for the autonomous worker. Follow it exactly.

## Environments

| Environment | Branch | URL                    |
|-------------|--------|------------------------|
| dev         | dev    | <dev/staging URL>      |
| prod        | main   | <prod URL>             |

Hosting platform: <platform>

## Deploy Trigger

- Push to `dev`  → auto-deploy to the dev environment.
- Merge to `main` → auto-deploy to prod.

No manual deploy step; git push is the trigger.

## Promotion (dev → prod)

- Promotion happens ONLY via a Pull Request from `dev` to `main`.
- ONLY the user merges that PR. The worker opens it at most; it never
  merges to `main` and never deploys to prod itself.

## Acceptance / Quality Gate

- The user accepts changes on the dev/staging URL above before
  promotion.
- A change that is not manually verifiable on the dev URL is not ready.

## Hard Rules

- The worker commits only to `dev`.
- The worker NEVER deploys to prod, never merges to `main`, never pushes
  to `main` directly.
```

## What you NEVER do

- Write a setup that lets the worker deploy to prod or push/merge to
  `main` autonomously — human approval on prod is the whole point.
- Overwrite an existing delivery/devops.md without showing the diff.
- Leave delivery/devops.md unlinked from CLAUDE.md — unlinked, it is
  dead text the worker never reads.
- Commit or push the convention change without the user asking.
- Invent project values (URLs, platform) — ask, or write a visible
  `<TODO>` placeholder.
