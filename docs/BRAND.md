# DCMUN Conference OS: brand and design system

Authoritative reference for all UI. Tokens live in `app/globals.css` (`:root`); this document explains how to use
them. If the two disagree, fix one of them in the same change.

**Identity in one line: calm, official, uncluttered.** The Doha College MUN seal in UN blue, deep navy ink, warm
off-white paper, hairlines instead of boxes, and one obvious next action per view.

Principles adapted from the owner's DeutschLab design system (`DESIGN.md`): semantic colour roles that never swap,
rules over cards, a 4 px scale, measured contrast, no gradients or glow on functional surfaces, honest data only,
motion only when it explains something, and a short list of component patterns used everywhere. Not adopted:
dark theme, cinematic motion, editorial display type. Conference staff use this on borrowed phones in bright
rooms for hours; it has to be quiet.

## 1. Mark and wordmark

- The mark is `public/dcmun-logo.jpg`, the Doha College Model United Nations seal (UN blue on white). Use it as
  supplied: do not recolour, crop, add shadows or place it on a coloured fill. Minimum 28 px.
- The lockup is the mark plus **DCMUN** in Manrope 750 and **Conference OS** in DM Sans 500, ink-2, on one line.
  The product name is "Conference OS"; "DCMUN" is the conference.
- One logo placement per screen: the workspace header (or the page header on public pages). Never repeat it in
  panels.
- Attribution and legal text: the conference owner decides; keep it in the footer of Settings, not in work
  screens.

## 2. Colour: roles that never swap

| Role | Token | Hex | Used for | Never for |
| --- | --- | --- | --- | --- |
| Action | `--action` / `--action-hover` / `--action-soft` | `#2a5db0` / `#214c93` / `#eaf1fc` | Primary buttons, links, selected tab, focus of attention | Status, decoration |
| Brand | `--brand` | `#5890e0` | The seal, large fills, the active-tab bar | Text (3.2:1) |
| Ink | `--ink` `--ink-2` `--ink-3` | `#14233f` `#46546b` `#5d6a80` | Text: primary, secondary, metadata | Emphasis by colour |
| Paper | `--paper` `--surface` `--sunken` | `#f7f8fa` `#ffffff` `#eef1f6` | Page, working surfaces, wells and inputs | |
| Line | `--line` `--line-strong` | `#e3e8ef` `#8693a8` | Hairlines; control outlines (3:1) | |
| Attention | `--attention` `--attention-soft` | `#8a5300` `#fff3d9` | Needs a human: waiting, held, uncertain | Errors |
| Success | `--success` `--success-soft` | `#1f6b50` `#e7f5ee` | Done, approved, saved | Decoration |
| Danger | `--danger` `--danger-soft` | `#a8231b` `#fdecea` | Errors, destructive actions, rejected | Anything else |

Rules: one primary (filled action) button per view region. Red is only for errors and destructive actions.
Status is never colour alone: every status chip carries a word and the same shape. Chips are tinted, never solid
fills (solid fills read as alerts). At most ~5% of a screen is non-neutral.

Measured contrast (WCAG 2.x): ink 15.7 on surface; ink-2 7.7; ink-3 5.5 on surface, 4.8 on sunken; action 6.4
on surface and white on action 6.4; attention 5.8 on its tint; success 5.7; danger 6.3; the seal blue 3.2 (marks
only); control outlines `--line-strong` 3.1. Re-measure with any change.

## 3. Typography

| Family | Role | Use |
| --- | --- | --- |
| Manrope (`--font-manrope`) | Headings | Page and section titles, the wordmark, large numerals |
| DM Sans (`--font-dm`) | Interface | Everything else: navigation, forms, tables, buttons |

Scale (px / line-height): page title 28/1.2 (650), section 18/1.3 (700), item title 15/1.4 (650), body 14/1.55,
secondary 13/1.5, metadata and chip 12/1.4. Kicker: 11 px uppercase, tracking 0.08em, ink-3, used once per
section at most. Numbers in tables and counters use tabular figures. Reading measure 68 ch for comments and
descriptions. Minimum text size 12 px; tap targets 40 px (44 px on touch for primary actions).

## 4. Space, shape, layout

- 4 px scale: 4, 8, 12, 16, 24, 32, 48. Related items sit 8 apart, groups 24, sections 32.
- Radius 6 px for controls and chips, 10 px for containers. Full rounding only for dots and avatars.
- Rules over cards: group content under a hairline and a heading; use a bordered surface only for something
  you act on as a unit (a resolution, a form, a dialog). No cards inside cards. No shadows except popovers
  and dialogs.
- Page frame: a single column up to 960 px for work screens; tables and boards may use 1200 px. 16 px
  gutters on phones, 24 px above 720 px.
- Grid columns that hold truncating text use `minmax(0, 1fr)`.

## 5. Information hierarchy

Every screen answers, in order: **where am I and what is the state** (title and one status line), **what is the
next action** (one primary button), **what do I need to read to decide** (the facts, inline, not behind a
panel), **everything else** (secondary controls, in a menu or a collapsed "More"). Facts needed to decide a
task are never hidden behind a click; settings and history are.

- Navigation: a user with one workspace is taken straight into it; there is no workspace picker. Within a
  workspace use at most five tabs, named for the job (Roll call, Debate, Resolutions, Participation, Sessions)
  not the data model. The active tab has a 3 px `--brand` underline and `--ink` text.
- Frequently used actions are always visible. Rare actions (rename, rebind, export) live under one "More"
  menu per region.
- Empty states say what the screen is for and the single next step. Loading shows the final layout, greyed;
  never a spinner on its own for more than a second.
- Errors use plain language, say what happened to the user's data first ("Saved on this device, will send when
  online"), then what to do.

## 6. Component patterns

- **Button.** Primary: `--action` fill, white text. Secondary: `--surface`, `--line-strong` outline, ink text.
  Tertiary: text link. Danger: `--danger` outline; filled only in the confirm step. Disabled 42% opacity with
  a visible reason where it is not obvious. Min height 40 px.
- **Chip.** Tinted background, same-hue text, 12 px, 6 px radius, always a word: *Draft*, *Submitted*,
  *In review*, *Approved*, *Changes requested*, *Rejected*, *Saved on device*.
- **Row.** Title (15/650), one metadata line (13, ink-2), status chip right-aligned, primary action at the
  end of the row. A row never needs another click to show its main fact.
- **Callout.** For feedback that must not be missed (Approval Panel comments): left 3 px rule in the status
  colour, tint background, author and time on one line, full comment text beneath.
- **Dialog.** Title, content, one primary, one secondary. Destructive confirm names the object.
- **Toast and notices.** Short (≤ 12 words), appear above the content, persist until read when they report a
  failure. Never the only record: anything important also lives in an inbox.
- **Table.** Hairline rows, sticky header, tabular numerals, no zebra, ink-3 headers.
- **Focus.** 3 px `--focus` ring with 2 px offset on every interactive element, never removed.
- **Motion.** Colour and opacity transitions 120 ms; panels slide at most 8 px in 180 ms. Nothing animates
  while a delegate or chair is typing. `prefers-reduced-motion` removes all movement.

## 7. Workspaces

All four workspaces (Chair, Approval Panel, Printing, Executive) share the same shell: header with the lockup,
the workspace name and the committee or role on the left, sync status and the user menu on the right, tabs
below, content in the page frame. Colour does not distinguish workspaces; the name does. Work screens never use
the seal as a background.

## 8. Accessibility baseline

AA contrast; full keyboard operation; visible focus; status never by colour alone; labelled controls; live
regions for save and sync status; `lang="en"`; touch targets as above; works at 200% zoom and 320 px width.

## Chair interaction additions · 19 October 2026

- One persistent save/sync strip sits directly under sticky workspace navigation. Its reserved height is 52 px
  above 600 px and 64 px at or below 600 px. Status text may wrap within that slot; details open System health.
  The masthead no longer duplicates save state. The masthead/context can scroll away so the sticky navigation
  does not consume the whole phone viewport. Scroll padding protects focused content from the sticky stack.
- Country selectors occupy one ordinary control. Results overlay the page, open above when space below is
  limited, and scroll within a 240 px list (about five options). Written country names accompany flags.
  Counts explicitly mean delivered, non-voided speeches/POIs in the current session. Search relevance precedes
  Fewest/Most ordering. Ordering stays stable while open; visible counts can refresh. Enter selects, never adds.
- This first package introduces no motion library, template dependency or new animation. Restrained transitions,
  honest loading states and the supplied 48 px Felix remain subsequent work in the approved queue.

## Orbit seal loading screen · owner selected, 19 October 2026

Use `WorkspaceLoading` for initial access/data opening and workspace redirects. The unaltered seal remains
upright (112 px), with a 160 px white backing and a 176 px motion area. A fine `--brand` arc rotates once every
3.2 seconds at constant speed. The short-viewport variant uses an 80 px seal, 112 px backing and 128 px motion
area. Component sizing variables are scoped under `.workspace-loading`; existing palette/font tokens apply.

Show one polite loading message, with decorative artwork hidden from assistive technology. Reduced motion
removes the arc. Background tabs and an offscreen emblem pause rotation; listeners and the observer clean up
on unmount. No animation library, frame timer, fake progress, minimum splash duration or exit hold is added.
Ready/cached workspaces keep their content and use the sync strip for refreshes. Failed startup with no data
shows the existing access/recovery controls. Public delegate forms never mount this staff loading screen.

`docs/LOADING_MOTION_PROPOSAL.md` records the selected design, references and verification limits.

## Operational view follow-up (19 October 2026)

The Debate points list uses compact 8 px row padding and a 240 px bounded scroll region; every delegation
is present and keyboard scrolling is available. Executive resolution status uses the existing heading, chip,
source-link and history patterns: latest feedback is visible in full, older history is disclosed on demand.
Both use the existing palette and spacing tokens. Global control/spacing cleanup is assigned to Claude in
[CLAUDE_VISUAL_CLEANUP.md](CLAUDE_VISUAL_CLEANUP.md).

## Assembly home · 20 October 2026

The workspace chooser uses the same seal lockup and navy conference band as the Assembly identity. One
28 px heading precedes a two-column grid, becoming compact single-column rows at 600 px. Each role is one
whole-card link with a 40 px icon and aligned arrow: 24/16 px padding, 16/12 px gaps, 18/16 px titles. Hover
changes colour only; keyboard uses the standard 3 px focus ring. Colour transitions take 120 ms and are
disabled under reduced motion. No status counters or sync claims are decorative content.

See [HOME_SCREEN_PROPOSAL.md](HOME_SCREEN_PROPOSAL.md) for screenshots, access states and implementation.
