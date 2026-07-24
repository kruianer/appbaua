---
name: setup-vision
description: Captures the overall vision of THIS project as a short compass the autonomous worker reads on every run — the problem, the audience, a few guiding principles that act as tie-breakers in gray areas, and explicit non-goals. Writes delivery/vision.md and links it from CLAUDE.md. Use this skill when the user wants to define, change, or document the project's vision, purpose, target audience, guiding principles, or what the project deliberately is NOT (e.g. "set up the vision", "what's this project about", "our guiding principles", "define non-goals").
---

# Define the Project's Vision

You help the user capture the vision of THIS project and write it as a
short compass into `delivery/vision.md`. This file is binding context:
the autonomous worker reads it on every run and uses it to decide gray
areas that a single requirement does not settle. Without a vision, an
autonomous AI picks arbitrarily when a requirement leaves room; with it,
it has a tie-breaker.

Keep it to roughly one screen. The vision is a compass, not an essay —
if it is too long, the worker skims past the part that matters. The
heart of the file is the guiding principles: concrete tie-breakers of
the form "in doubt, X over Y", not inspirational prose.

Language: Conduct the dialogue AND write `delivery/vision.md` in the
language the user speaks to you in. Exception (machine contract): section
headings, folder paths, and the file name `delivery/vision.md` stay
unchanged regardless of language.

## Flow

### 1. Intake

Let the user describe the project. Extract, asking at most 2-3 questions:
- **Problem (Why):** what problem does this project solve, for whom?
- **Audience:** who uses it? Be concrete (not "everyone").
- **Guiding principles:** the tie-breakers. Push for these — they are
  the whole point. Draw them out with concrete either/or questions:
  "When simplicity and feature-richness conflict, which wins?" "Privacy
  or convenience?" "Speed to ship or polish?" Aim for 3-5. Each is a
  one-line rule of the form "in doubt: X over Y", decidable by the
  worker without asking.
- **Non-goals:** what does this project deliberately NOT do? These
  prevent the worker from "helpfully" expanding scope across many
  requirements. Propose 2-3 plausible non-goals yourself and let the
  user confirm.

### 2. Sharpen the principles

A principle that cannot break a tie is useless. Check each one: could
the worker actually apply it to choose between two implementations? Turn
vague values into decidable rules:
- "user-friendly" → "in doubt: fewer steps over more options"
- "high quality" → "in doubt: ship less, but finished, over more, rough"
Vague, non-actionable principles get rewritten or dropped.

### 3. Write delivery/vision.md

Write the file in the template format below. Keep it tight. If the file
already exists, show the user what changes before overwriting.

### 4. Link it from CLAUDE.md

`delivery/vision.md` is NOT loaded automatically by the worker — it must
be referenced from CLAUDE.md, or it is ignored. Ensure the repo's
CLAUDE.md contains a `## Vision` section with a pointer:

```markdown
## Vision

The project's purpose and guiding principles are defined in
[delivery/vision.md](delivery/vision.md). When a requirement leaves a
gray area, decide it in line with those principles.
```

If CLAUDE.md has no such section, add it. If it already points there,
leave it. If no CLAUDE.md exists, offer to create one with this section.

### 5. Confirm

Show the user the written `delivery/vision.md` in full and confirm the
CLAUDE.md pointer is in place. Do NOT commit or push unless the user
asks — this is a foundational document they should review first.

## Template

```markdown
---
project: <repo-name>
---

# Vision

Binding compass for the autonomous worker. When a requirement leaves a
gray area, resolve it in line with the principles below.

## Problem (Why)

<1-3 sentences: the problem this project solves, and for whom>

## Audience

<who uses this — concrete>

## Guiding Principles (tie-breakers)

- In doubt: <X> over <Y>
- In doubt: <X> over <Y>
- <3-5 total, each a one-line decidable rule>

## Non-Goals

- <what this project deliberately does NOT do>
- <...>
```

## What you NEVER do

- Write inspirational prose that cannot break a tie — every principle
  must be applicable by the worker to choose between two options.
- Let the file grow past ~one screen — a vision the worker skims is
  useless.
- Leave delivery/vision.md unlinked from CLAUDE.md — unlinked, it is
  dead text the worker never reads.
- Commit or push without the user asking.
- Put concrete features or requirements here — this is direction, not
  scope; features belong in requirements (capture-requirement).
