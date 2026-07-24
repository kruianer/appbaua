---
name: capture-bug
description: Captures bugs, malfunctions, and test feedback for the autonomous delivery pipeline — ceremony-free, from informal reports. ALWAYS use this skill when the user reports that something doesn't work, looks wrong, or deviates from what was expected — including casual phrasings ("doesn't work", "still shows the old name", "something's off here", "X is broken on staging") and one-liners. Do NOT use for new features or change requests to intended behavior (use the capture-requirement skill for those).
---

# Report a Bug

You take error reports from the user and turn them into bug files for
the autonomous worker. Top priority: SPEED AND ZERO BUREAUCRACY. The
user just got annoyed by something — the lower the barrier to reporting,
the better their feedback loop works. A one-liner is a full report.
Better a thin bug in the system than a fat annoyance stuck in their head.

You are the opposite of the capture-requirement skill: NO interview, NO
checklists, NO misinterpretation probe. You take what comes, fill in
yourself what the context implies, and ship it.

Language: Reply and write the bug file in the language the user reports
in — German report = German bug, English = English. Frontmatter keys
(id, app, req, priority, created), folder paths, and the ID format
bug-NNN always stay unchanged — the worker parses them.

## Flow

### 1. Sync repo (silently)

`git pull` on dev before anything else happens — needed for correct ID
assignment and the current requirement history. No comment about this to
the user unless the pull fails (then report it and resolve).

### 2. Process the report — as it comes

- Take the report verbatim as raw material. Derive yourself:
  - **Observed:** what happens according to the user
  - **Expected:** what should happen instead — derivable from the
    sentence ("still shows the old name" → expected: new name visible).
    Only if genuinely not derivable: leave empty, the worker
    reconstructs the intended behavior from requirement/spec.
  - **Steps:** only if the user named some or they are trivially
    derivable. NEVER ask "how exactly" they got there if it is obvious.
- **req reference:** Check whether the bug can be assigned to a
  requirement: the user names a req ID, or the report clearly concerns a
  function from a recently merged requirement (check
  delivery/requirements/in-progress/ and the most recent
  delivery/requirements/done/ entries). Clear → set req: <id> without
  asking. Unclear → omit the field (then the worker's standard bug flow
  runs: reproduction test first). When in doubt, omit rather than ask.
- **Screenshots:** If the user attached an image, save it as
  delivery/bugs/attachments/bug-NNN-<n>.png and reference it in the bug
  under "Attachments". Never request images — only use what comes.
- **Multiple problems in one report** ("three things: ..."): split
  automatically into SEPARATE bug files — the worker works per file,
  small bugs = fast fixes. Copy shared context into each file so each is
  understandable on its own.
- **Priority:** default normal. Only if the user expresses urgency
  ("blocks me", "urgent", "right now"): priority: high.

### 3. Follow-up rule (the only one)

Ask at most ONE follow-up question, and only if no fix would be possible
without the answer — e.g. when it is completely unclear which app or
which part of the app is meant. Everything else: make the best
assumption and write it into the file. The worker has the requirement,
spec, and code as context — it needs less than you'd think.

### 4. File and ship immediately

1. Next free ID: highest bug number across ALL subfolders of
   delivery/bugs/ plus 1, format bug-NNN.
2. Write the file(s) to delivery/bugs/ready/bug-NNN-<slug>.md (template
   below). NO draft intermediate step, NO confirmation question — bugs
   go straight on their way.
3. Commit ("bug-NNN: <short title>"), push.
4. One-sentence confirmation to the user: which ID(s) created, done.
   Example: "bug-017 is on its way (zone name outdated in overview)." On
   a split: name all IDs.

If the user wants to add something right afterward: edit the file in
delivery/bugs/ready/ and push again while it is still there. If it has
already moved to in-progress/: file the addition as a new bug referring
to the old ID.

## Template

```markdown
---
id: bug-NNN
app: <repo-name>
req: <req-ID, only if assignable>
priority: normal | high
created: <YYYY-MM-DD>
---

# Observed

<what happens — echoing the user's words>

# Expected

<what should happen instead — or empty if not derivable>

# Steps (optional)

1. <only if named or trivially derivable>

# Attachments (optional)

- delivery/bugs/attachments/bug-NNN-1.png
```

## What you NEVER do

- Conduct an interview or ask more than one follow-up question
- Wait for a release/confirmation before you push
- Reinterpret, judge, or downplay the user's report ("are you sure
  that's a bug?")
- Reject a one-liner as "too little information"
- Lecture the user on what a good bug report looks like
- Capture new features — if the user wants changed INTENDED behavior
  (not broken actual behavior), point them kindly to the
  capture-requirement skill
