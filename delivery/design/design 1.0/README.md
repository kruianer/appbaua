# Handoff: Repo-Verwaltung (Mobile) — appbaua

## Overview
A mobile-first screen (smartphone, portrait) for the **appbaua** product — a web app that controls an autonomous coding worker. The **Repo-Verwaltung** ("repo management") module shows a **sortable, priority-ordered list of code repositories** the worker processes top-to-bottom (position 1 = highest priority). Users can reorder by drag, toggle each repo active/inactive, remove repos, and add new ones. A worker-status card shows what the worker is currently doing (task type + reference + title). A bottom tab bar hosts the app's modules.

The chosen visual direction is **Nocturne** — a quiet, compact **dark** interface (see Design Tokens). Light mode is derived from the same tonal ramps and available via a header toggle.

## About the Design Files
The files in this bundle are **design references created in HTML** (a streaming "Design Component" prototype), showing intended look and behavior — **not production code to copy directly**. The task is to **recreate these designs in the target codebase's existing environment** (React, Vue, SwiftUI, native, etc.) using its established components, patterns and libraries. If no environment exists yet, pick the most appropriate framework for the project and implement there.

Notably: the prototype uses a custom `<x-ic>` web component for icons and a JSX iPhone bezel purely for presentation — in a real app, use your codebase's icon library and render inside a real device/viewport. Do not ship the `.dc.html` runtime.

## Fidelity
**High-fidelity (hifi).** Final colors, typography, spacing, radii, and interactions are specified below and should be recreated faithfully using the codebase's existing libraries. The one exception is the phone bezel (iOS frame), which is presentation-only scaffolding.

## Screens / Views
Single screen with a persistent app bar + bottom tab bar. The content area swaps by active tab. Only the **Repos** tab is fully designed; the other three tabs are intentional "Bald verfügbar" (coming soon) placeholders that establish the navigation.

### App bar (persistent, top)
- **Layout:** horizontal flex, space-between, padding `2px 16px 6px`. Sits below the status bar (top padding of the app root is `54px` to clear the status bar / notch).
- **Left — brand lockup:** flex row, gap `10px`.
  - Logo tile: `36×36`, radius `11px`, background `linear-gradient(140deg, var(--color-accent-400) #b5abfc, var(--color-accent-700) #5d5294)`, shadow `0 4px 14px rgba(accent 45%)` + `inset 0 1px 0 rgba(#fff 30%)`. Glyph: a terminal-prompt mark (`>_`) in white, ~20px.
  - Wordmark (stacked, line-height 1.02): **appbaua** (700, 18px, letter-spacing −0.03em) over tagline **CODING-WORKER** (9px, uppercase, letter-spacing .16em, muted `text @46%`).
- **Right — actions:** flex row, gap `var(--space-2)` (5.6px).
  - Theme toggle: icon button, `.btn.btn-icon.btn-secondary` (36×36, 1px divider border). Shows **moon** in dark mode, **sun** in light mode. Toggles the whole screen light/dark.
  - Add button: icon button, `.btn.btn-icon.btn-primary` (Nocturne primary = **accent outline**, not filled), **plus** glyph. **Only rendered on the Repos tab** (it means "Repo hinzufügen"). Hidden on other tabs.

### Module title (persistent, below app bar)
- Padding `6px 20px 10px`. Kicker **MODUL** (10px, uppercase, letter-spacing .14em, color `--color-accent-300` #d2cefd) over an `<h2>` module title (28px, letter-spacing −0.02em). The title reflects the active tab: `Repo-Verwaltung` / `Aktivität` / `Verlauf` / `Einstellungen`.
- On the Repos tab only, a subtitle line follows: "Der Worker arbeitet die Liste von oben nach unten ab." (13px, muted `text @55%`).

### Repos tab — Worker status card
- `.card.elev-md`, margin `0 20px 12px`, gap `var(--space-2)`, background `linear-gradient(180deg, color-mix(accent 12%, surface), var(--color-surface))`.
- **Header row:** kicker **WORKER** (10px uppercase, `--color-accent-300`) + a status pill on the right: 1px accent border, radius 999px, text `--color-accent-300`, 11px; contains a live dot (7px, `--color-accent`, `wpulse` animation) + label ("aktiv" when a repo is active, else "Leerlauf").
- **Task row** (when a repo is active): flex, nowrap, gap 7px.
  - Task-type chip: inline-flex, 1px accent border, radius 999px, padding `2px 8px`, 11px/600, color `--color-accent-300`; icon (13px) + label. Types: **Bug** (icon `bug`), **Requirement** (icon `doc`), **Code-Review** (icon `review`).
  - Reference span: 12px muted (`text @60%`), single-line ellipsis: `{ref} · {repoName}` e.g. `#412 · appbaua`, `PR #88 · webhook-relay`.
  - Task title below: 15px, line-height 1.3, e.g. "Login-Redirect schlägt bei SSO fehl".
  - Idle state (no active repo): single line "im Leerlauf — keine aktiven Repos" (15px, muted).
- **Progress bar:** 4px track, radius 999px, background `color-mix(text 12%)`; inner segment 40% width, `--color-accent`, `wprog` indeterminate slide animation (only when active).
- **Stats row:** 12px muted; three items with bold values in `--color-text`: `{n} aktiv · {n} inaktiv · {n} gesamt`.

### Repos tab — List
- Section label **PRIORITÄT · 1 = HÖCHSTE** (10px uppercase, muted `text @45%`).
- Scroll container: `flex:1; overflow-y:auto; padding:0 20px 14px`. Rows are a flex column, gap `var(--space-2)`.
- **Repo row** (`[data-repo-row]`): flex, align center, gap `var(--space-3)` (8.4px), padding `var(--space-3)`, background `--color-surface`, radius `--radius-md` (8px), shadow `--shadow-sm` (normal) / `--shadow-lg` (while dragging). Left→right:
  1. **Drag handle** — 30×46 grid-centered, `cursor:grab`, `touch-action:none`, muted color (`text @42%`), `grip` icon (22px, 6 dots). This is the ONLY drag affordance.
  2. **Priority badge** — 26×26 circle. Position #1: background `--color-accent`, text `--color-bg` (high-priority highlight). Others: background `color-mix(text 10%)`, text `--color-text`. Shows the 1-based position.
  3. **Name + URL** (min-width:0, flex:1, both single-line ellipsis): display name bold 16px; git URL 12px muted (`text @52%`).
  4. **Active toggle** — custom switch, 46×28, radius 999px, padding 3px. On: background `--color-accent`, knob right. Off: background `color-mix(text 22%)`, knob left. Knob 22×22 circle, `--color-bg`, subtle shadow. `role="switch"`, `aria-checked`.
  5. **Remove button** — `.btn.btn-icon.btn-ghost`, `trash` icon (18px). Opens the confirm dialog.
- **Inactive repo:** the whole row is `opacity: 0.5`, toggle off, but **stays in its position** (inactive does not re-sort).
- **Dragging repo:** `transform: scale(1.02)`, `box-shadow: var(--shadow-lg)`, raised `z-index`, transitions on box-shadow (.15s) and transform (.12s).

### Repos tab — Empty state (when list is empty)
- Centered column, gap `var(--space-3)`, padding `var(--space-8) var(--space-4)`.
- Circular badge 64×64, 1px accent border, `folder` icon (28px, `--color-accent-300`).
- `<h4>` "Noch keine Repos" + paragraph (14px muted) "Füge dein erstes hinzu — der Worker legt damit los."
- Primary button `.btn.btn-primary` (accent outline) with `plus` icon: **"Repo hinzufügen"**.

### Other tabs — placeholder
- Centered column: 66×66 circular accent-outlined badge with the tab's icon (30px), `<h3>` tab title, and a 14px muted paragraph (max-width 240px) describing what the module will do, ending "Bald verfügbar."

### Bottom tab bar (persistent)
- `flex:none`, flex row, `justify-content: space-around`, padding `10px 8px 30px` (bottom padding clears the home indicator), background `--color-bg`.
- Top hairline: a 1px line that fades to transparent 48px from each end — `linear-gradient(to right, transparent, var(--color-divider) 48px, var(--color-divider) calc(100% − 48px), transparent)` (a Nocturne signature).
- Four tabs, each a column (icon 23px + 10px label, gap 4px): **Repos** (`gitbranch`), **Aktivität** (`activity`), **Verlauf** (`clock`), **Einstellungen** (`settings`). Active tab: color `--color-accent`. Inactive: `color-mix(text 48%)`.

### Add sheet (modal, bottom sheet)
- Backdrop: absolute inset 0, `background: color-mix(#000 55%)`, click closes.
- Sheet: full width, background `--color-surface`, top radius `--radius-lg` (14px), padding `var(--space-4) var(--space-4) 34px`, `--shadow-lg`, flex column gap `var(--space-3)`.
- Header: `<h4>` "Repo hinzufügen" + ghost icon close button (`x`).
- Field 1: label **Git-URL \*** (required), `.input`, placeholder `github.com/kruianer/mein-repo`.
- Field 2: label **Anzeigename (optional)**, `.input`, placeholder `mein-repo`.
- Error banner (conditional): flex row, 1px accent border, `background: color-mix(accent 14%)`, radius `--radius-md`, 13px/600, `--color-accent-300`; `warning` icon + message.
- Submit: `.btn.btn-primary.btn-block` with `plus` icon: **"Hinzufügen"**.

### Remove confirm dialog (modal, centered)
- Backdrop: absolute inset 0, `color-mix(#000 55%)`, centered.
- Dialog: max-width 320px, background `--color-surface`, radius `--radius-lg`, padding `var(--space-4)`, `--shadow-lg`, flex column gap `var(--space-3)`.
- `<h4>` "Repo entfernen?" + paragraph "Repo **{name}** wirklich entfernen? Das lässt sich nicht rückgängig machen."
- Actions right-aligned: `.btn.btn-secondary` **Abbrechen** + `.btn.btn-primary` (accent outline) with `trash` icon **Entfernen**.

## Interactions & Behavior
- **Reorder (drag & drop):** pointer-based (works for touch + mouse), initiated only from the drag handle (`touch-action:none` there; `preventDefault` on move to block scroll). During a drag, compute the target index by comparing pointer Y against each row's vertical midpoint and splice the dragged item into place live. Persist the new order. Position badges renumber immediately (1..n). Priority = array order.
- **Toggle active/inactive:** flips the repo's `active` flag in place; row dims to opacity .5 but keeps its position; worker card + counts update.
- **Add repo:** opens sheet. Validation on submit:
  - Empty URL → error "Git-URL ist erforderlich."
  - URL not matching a repo host/path (regex `^(https?://)?(www\.)?(github|gitlab|bitbucket)\.[a-z.]+/[^/]+/[^/]+`) → error "Repo nicht erreichbar oder kein Zugriff." (In production, replace this with a real reachability/permission check against the backend.)
  - Valid → strip protocol + trailing slashes; display name = provided name or last URL path segment; append to the end of the list (lowest priority), active by default; close sheet and reset fields.
- **Remove:** trash opens confirm dialog; **Entfernen** deletes the repo; **Abbrechen** closes with no change.
- **Theme toggle:** switches the screen between dark (native) and a light variant derived from the neutral ramp; also flips the device status-bar color in the prototype.
- **Tabs:** switch the content area; the module title and the visibility of the "+" action follow the active tab.
- **Animations:** worker live dot `wpulse` (1.6s ease-in-out, opacity+scale); progress `wprog` (1.8s ease-in-out, translateX slide); row drag transitions as above.
- **No horizontal scroll** anywhere; large touch targets (handles/toggles/buttons ≥ ~36–46px).

## State Management
- `mode`: `'dark' | 'light'` (default `'dark'`).
- `tab`: `'repos' | 'aktiv' | 'verlauf' | 'settings'` (default `'repos'`).
- `repos`: ordered array of `{ id, name, url, active }` — order IS the priority.
- `dragId`: id of the repo being dragged (or null).
- `sheetOpen`: boolean (add sheet).
- `confirmId`: id pending removal (or null) — drives the confirm dialog.
- `gitUrl`, `dispName`, `error`: add-form fields + validation message.
- Derived: active repo (first `active` in order) → drives worker card + current task; counts (active/inactive/total); current task via a `repoId → {type, ref, title}` map (in production, fetch this from the worker/backend).

## Design Tokens (Nocturne)
Source of truth: `styles.css` (bundled). Key values:
- **Fonts:** heading & body both **Inter** (`--font-heading` weight 500, `--font-body`). Base 15px / line-height 1.55.
- **Base colors (dark):** bg `#161826`, surface `#232532`, text `#e9e9ed`, accent `#9184d9` (single accent — mono scheme), divider `rgba(#e9e9ed, 16%)`.
- **Accent ramp:** 100 `#f5f4ff` · 200 `#e7e5fe` · 300 `#d2cefd` · 400 `#b5abfc` · 500 `#968ae0` · 600 `#796cbf` · 700 `#5d5294` · 800 `#423a6a` · 900 `#2b2741`. On dark: use 700–900 for tinted fills/borders, 500 base, 100–300 for text on tints. For accent text on the dark ground use `--color-accent-300` (accent itself is chrome-only, ~3:1).
- **Neutral ramp:** 100 `#f3f5fe` … 500 `#9397ab` … 800 `#3f424d` · 900 `#292b31` (used to derive light mode: bg `neutral-100`, surface `neutral-200`, text `neutral-900`).
- **Spacing (density 0.7×):** `--space-1` 2.8 · `-2` 5.6 · `-3` 8.4 · `-4` 11.2 · `-6` 16.8 · `-8` 22.4 (px).
- **Radius:** sm 4 · md 8 · lg 14 (px).
- **Elevation:** sm `0 0 0 1px #3f424d` · md `0 0 0 1px #595d6c, 0 6px 18px rgba(0,0,0,.55)` · lg `0 0 0 1px #9397ab, 0 16px 40px rgba(0,0,0,.65)` — on dark, elevation is edge + ambient darkness, not stacked shadows.
- **Rules:** freestanding rules fade to transparent 48px from each end (see tab-bar hairline).
- **Buttons:** primary = accent **outline** (transparent bg, 1px accent border, accent text); secondary = 1px divider border; ghost = accent text, subtle hover tint. Focus: `outline: 2px solid var(--color-accent); outline-offset: 2px`.
- **Icons:** design system specifies **Phosphor**; the prototype substitutes an equivalent local line-icon set for offline use (see Assets). Use Phosphor (or your codebase's set) in production.

## Assets
- **Icons:** custom local set in `icons.js` (a `<x-ic name size sw>` web component rendering inline SVG in shadow DOM). Names used: `grip, trash, plus, x, sun, moon, folder, warning, gitbranch, activity, clock, settings, search, chevron, bug, doc, review, brand, signal, wifi, battery`. `brand` is the `>_` terminal-prompt logo glyph. Replace with Phosphor equivalents (or your icon system) in production; the SVG paths are available in `icons.js` if you want to match the exact shapes.
- **Logo:** no external asset — the mark is the `brand` glyph on a gradient tile (spec above). No raster logo file exists; recreate from the spec or commission a final mark.
- **iOS frame (`ios-frame.jsx`):** presentation-only device bezel/status bar. Not part of the app — ignore in implementation.
- **Fonts:** Inter via Google Fonts (`@import` in `styles.css`); self-host in production.

## Files
- `RepoNocturne.dc.html` — the primary, fully interactive Nocturne prototype (the design to implement). Template markup + logic class are both inside this file.
- `styles.css` — Nocturne design-system tokens + component classes (`.btn`, `.card`, `.input`, `.tag`, `.table`, `.dialog`, etc.). The token reference.
- `nocturne-readme.md` — the design system's own guidance (direction, color, type, do/don't).
- `icons.js` — the local icon web component + SVG path data.
- `ios-frame.jsx` — presentation-only device frame (not for production).
- `ScreenNocturne.dc.html` (optional reference) — the earlier plain (non-framed) Nocturne version without the app bar / worker-task / tab bar, kept only for history.
