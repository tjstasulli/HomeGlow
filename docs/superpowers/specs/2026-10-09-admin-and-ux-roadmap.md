# Admin & UX roadmap

A backlog of five requested changes, each scoped roughly enough to start a
proper brainstorm when it's picked up — not a design, and none of these are
approved for implementation yet. Real design decisions (visual direction,
exact data model changes, UI layout) are deliberately deferred to that point,
per the user's choice of a lightweight roadmap over five full specs today.

## 1. Admin panel visual rework

**What:** Restyle the admin panel shell (`AdminPanel.jsx`'s tab structure —
currently Dashboard / Look / Displays / Family / Security / System) to match
the sleek, Apple/Skylight-inspired look already built for the main dashboard
(seasonal themes, Inter typography, generous spacing, soft cards).

**What exists today:** A fairly dense, utilitarian MUI form-heavy panel —
`Switch`/`TextField`/`Grid` layouts with little visual hierarchy beyond
section borders. It does not currently read any theme tokens the way the
dashboard does; it's effectively unthemed.

**Rough scope:** Primarily visual/CSS — unlikely to need data model or API
changes. The open design questions worth brainstorming when this comes up:
does the admin panel adopt the *active* seasonal theme's colors, or get its
own single consistent "admin" look regardless of season; how much of the
existing dense information layout gets reorganized vs. just restyled in
place.

## 2. Per-plugin settings sections

**What:** Give each installed plugin its own dedicated, more verbose settings
area, instead of today's shared generic form.

**What exists today:** All plugins currently share one generic settings
block in `AdminPanel.jsx` (the `pSettings`/`setPluginSettings` pattern) —
enabled toggle, transparent toggle (becoming an opacity slider per the
widget-customization plan), and whatever a plugin's own manifest exposes
generically. There's no per-plugin custom settings UI today beyond that
shared shape.

**Rough scope:** This is the most architecturally open item here — it likely
needs each plugin's manifest to declare its *own* settings schema (fields,
types, labels) that the admin panel renders dynamically, rather than a fixed
generic form. Worth checking how the plugin manifest format
(`server/routes` / plugin SDK, `docs/guides/plugin-development.md`) already
handles — or doesn't handle — plugin-declared config, before assuming new
mechanism is needed from scratch.

## 3. Email-optional user creation

**What:** Let a household add a user without requiring an email address.

**What exists today:** Checked directly — this is a **client-side-only**
restriction. `AdminPanel.jsx`'s "Create user" button is
`disabled={!newUser.username || !newUser.email}`; the server's
`POST /api/users` has no server-side email requirement found. This is the
smallest item on this list by a wide margin — likely just dropping
`!newUser.email` from that disabled condition, possibly also relaxing the
field's `required`-style styling. Worth a quick check of whether anything
else (invites, notifications) assumes every user has an email before
treating this as fully done.

## 4. Removable Home tab

**What:** Let a household delete/hide the "Home" tab (tab number 1) from
settings.

**What exists today:** Checked directly — Home is **structurally**
protected, not just UI-locked. The server's tab-delete endpoint explicitly
refuses tab 1 (`if (parseInt(tabNumber) === 1) return reply.status(400)...`),
and more importantly, deleting *any other* tab merges that tab's orphaned
widget assignments into Home as a fallback destination
(`const homeTab = getTabByNumber(deviceName, 1); ...homeLayoutMap[widgetName] = ...`).
Home isn't just "the first tab" — it's the merge target the whole
delete-a-tab flow depends on.

**Rough scope:** This is the second-most architecturally open item here. A
real design needs to answer: if Home goes away, where do orphaned widgets
from a deleted tab go instead (a different designated fallback tab? refuse
to delete the *last remaining* tab, whichever it is, rather than hardcoding
tab 1 specifically)? This needs its own brainstorm, not a quick toggle.

## 5. Routines widget: clickable users, collapsible lists, side-by-side layout

**What:** For the Routines plugin's widget specifically: clicking a user
expands/collapses their list, and users lay out side-by-side rather than
stacked (unlike the chores widget, which stacks).

**What exists today:** Checked directly — **there is no "Routines" plugin or
widget anywhere in this repo.** It's a third-party plugin, installed from
the separate plugins marketplace (`jherforth/HomeGlowPlugins`, the same
install mechanism used for extra themes), not part of HomeGlow core at all.

**Rough scope:** Before any design work, this needs its own small discovery
step: confirm which plugin (by filename/repo) is actually providing the
"Routines" widget on this install, and whether changing its layout means
forking *that plugin's* repo the same way `tjstasulli/HomeGlow` forks core
HomeGlow — plugins are external code this app loads, not something editable
in this repository. This is the one item on the list that isn't even
scoped to the right codebase yet.

## Suggested order

1 and 3 are the cheapest (3 especially — likely a one-line fix). 4 and 2 each
need a real design decision before any code. 5 needs a discovery step in a
different repository before it can be scoped at all. No particular urgency
implied by this order — purely "cheapest/clearest first."
