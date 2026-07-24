---
name: setup-stack
description: Defines the technology stack, testing strategy, and coding conventions for THIS project and writes them as a binding instruction the autonomous worker follows on every run — languages, frameworks, build/test/lint commands, test policy, conventions, and a glossary. Offers ready-made best-practice templates (A = JS/TS, B = Python + TS/JS) so the user can just say "Template A". Use this skill when the user wants to define, change, or document the tech stack, languages, frameworks, tooling, testing strategy, or coding conventions of this project (e.g. "set up the stack", "we use Next.js here", "Template B", "what's our test command", "how do we test here").
---

# Define the Project's Tech Stack

You help the user pin down what THIS project is built with, and you
write it as a binding instruction into `delivery/stack.md`. This file is
a contract, not a suggestion: the autonomous worker reads it on every
run and MUST obey it — which languages and frameworks to use, which
commands to run for build/test/lint, and how to write code
consistently.

This is the counterpart to capture-requirement and capture-bug: those
skills deliberately keep technology OUT of the requirements and route it
here. This skill is where the technology lives, so the requirements can
stay purely about business behavior.

You carry ready-made best-practice templates so the user does not have
to reinvent them: they can just say "Template A" and you adapt it to the
project. Two templates ship today; keep the structure ready for more.

Language: Conduct the dialogue AND write `delivery/stack.md` in the
language the user speaks to you in. Exception (machine contract, always
applies): section headings the worker relies on, command strings,
language/framework/package names, folder paths, and the file name
`delivery/stack.md` stay unchanged regardless of language.

## Flow

### 1. Pick a template

Ask which template the user wants. If they already named one
("Template A"), skip straight to step 2.

**Template A — JS/TS (Next.js fullstack):**
- Language: TypeScript on Node.
- Framework: Next.js (App Router) — fullstack, one deploy target,
  pairs with git auto-deploy (Vercel/Netlify) from setup-devops.
- Test: Vitest. Lint + Format: ESLint + Prettier. Types: `tsc --noEmit`.
- E2E (optional): Playwright.
- Database: `<TODO: choose per project>`.

**Template B — Python + TS/JS (FastAPI backend + TS frontend):**
- Backend: Python with FastAPI. Test: pytest. Lint + Format: ruff.
- Frontend: TypeScript with Vite (React). Test: Vitest.
  Lint + Format: ESLint + Prettier.
- E2E (optional): Playwright.
- Backend owns logic/data; frontend owns UI. Two parts, each testable
  on its own.
- Database: `<TODO: choose per project>`.

(More templates will be added here later. If the user wants a stack
neither template covers, capture their answers directly instead of a
preset — same fields: languages, frameworks, build/test/lint commands,
conventions.)

### 2. Adapt to the project

A template fixes the *shape*; these values are still project-specific.
Check the repo FIRST (package.json, pyproject.toml, existing config,
lockfiles) and derive what you can. Ask only for what you cannot derive,
in at most one round:
- **App / repo name** — usually derivable from the repo.
- **Exact commands** — read them from package.json scripts /
  pyproject.toml if present; otherwise use the template defaults and
  mark uncertain ones.
- **Database / key services** — ask if unknown.
- **Testing** — keep the template's test policy unless the user wants
  it changed; drop the E2E line if there are no user-facing flows yet.
- **Anything the template leaves as `<TODO>`**.

For anything genuinely unknown, write a clearly marked `<TODO: ...>`
placeholder rather than blocking or inventing — the user fills it in
later.

### 3. Write delivery/stack.md

Write the file in the template format below with the chosen template's
values filled in. If the file already exists, show the user what changes
before overwriting. Keep it tight — the worker needs facts and commands,
not prose.

### 4. Link it from CLAUDE.md

`delivery/stack.md` is NOT loaded automatically by the worker — it must
be referenced from CLAUDE.md, or it is ignored. Ensure the repo's
CLAUDE.md contains a `## Tech Stack` section with a pointer:

```markdown
## Tech Stack

Languages, frameworks, commands, conventions, and the glossary for this
project are defined in [delivery/stack.md](delivery/stack.md). Follow
them exactly.
```

If CLAUDE.md has no such section, add it. If it already points there,
leave it. If no CLAUDE.md exists, offer to create one with this section.

### 5. Confirm

Show the user the written `delivery/stack.md` in full and confirm the
CLAUDE.md pointer is in place. Do NOT commit or push unless the user
asks — this is a convention change they should review first.

## Template

```markdown
---
project: <repo-name>
template: A | B
---

# Tech Stack

This file is binding for the autonomous worker. Follow it exactly.

## Languages & Frameworks

- <language + framework per part, e.g. "Backend: Python / FastAPI">
- <...>
- Database: <db or TODO>

## Commands

The worker runs these; keep them copy-pasteable and current.

- Install: <cmd>
- Build:   <cmd>
- Test:    <cmd>
- Lint:    <cmd>
- Format:  <cmd>
- Types:   <cmd, if applicable>

## Testing

Binding test policy for the worker.

- Every requirement is delivered with automated tests covering its
  acceptance criteria. A change with no test for its behavior is not
  done.
- Every bug fix starts with a failing test that reproduces the bug,
  then the fix makes it pass (reproduce-first). No repro test → not
  fixed.
- Test levels: unit for logic; integration for anything crossing a
  boundary (DB, API, external service); E2E only for critical user
  flows, kept few and stable.
- The full test suite (see Commands) must pass before promotion to
  prod — this is the automated half of the quality gate; the user's
  manual acceptance on the dev URL is the other half.

## Conventions

- Formatting/linting is enforced by the tools above; run them before
  considering a change done.
- Folder structure: <where code lives per part — short>
- Naming: <any binding naming rules — short>
- <further binding rules; keep each to one line>

## Glossary

Domain terms used consistently across requirements, bugs, and code.
capture-requirement checks new terms against this list and adds them
here. Empty until the first term is defined.

| Term | Meaning |
|------|---------|
|      |         |
```

## What you NEVER do

- Invent commands or versions — read them from the repo, use template
  defaults, or write a visible `<TODO>`.
- Overwrite an existing delivery/stack.md without showing the diff.
- Leave delivery/stack.md unlinked from CLAUDE.md — unlinked, it is dead
  text the worker never reads.
- Commit or push the convention change without the user asking.
- Put business behavior or requirements here — this file is technology
  only; behavior belongs in requirements (capture-requirement).
