# How Ilse works

**English** · [Português](how-it-works.pt-BR.md) · [← README](../README.md)

![How Ilse works: setup once, then every tweak goes from pointing in the browser to the cheapest step that can apply it — class swap, quick model or full agent — and back to the page, with undo and a commit ledger](../.github/assets/ilse-architecture.svg)

<sub>Diagram source: `scripts/architecture-svg.py` (`python3 scripts/architecture-svg.py en` / `pt`).</sub>

1. Your dev server runs as usual. Ilse finds it and serves the same app at `localhost:4700`, with the toolbar injected. Hot reload keeps working; your project needs no import. With the [Vite plugin](reference.md#on-your-apps-own-port-vite-plugin), the dev server loads the toolbar itself; with the [bookmarklet or Chrome extension](reference.md#any-local-page-bookmarklet-or-chrome-extension), the browser does. Either way there is no proxy.
2. You point at something and send. Ilse resolves it to the exact place in your code and builds a short, precise request.
3. The cheapest step that can apply it does: Ilse itself, a fast model, or your full agent.
4. The file changes, the page updates, and the change is recorded so it can be undone and explained at commit time.

## Why the agent gets it right

Before your agent is called, Ilse does the searching for it:

- **Exact source location.** The clicked element is resolved to `file:line`, and the agent gets that code with the request. Two independent signals have to agree: the code itself (classes, text, attributes, parsed from the AST) and React's own dev stack (which component rendered it, in which file, used where). No bundler plugin.
- **Only the slice it needs.** The agent is told which lines to read, not the whole file — a 900-line component is ~10k tokens, re-sent on every turn.
- **Component card.** For a reused component: where it is defined, whether it takes a `className`, and where it is used.
- **Ilse's own history.** The last changes Ilse made to the same file ride along ("decided by the designer, keep them"), so a new fix doesn't undo an earlier one.
- **Your design tokens.** Read on startup from `tailwind.config`, Tailwind v4 `@theme`, CSS variables, W3C `tokens.json` or a `DESIGN.md` (also `.ilse/ds/DESIGN.md`, the one Create DS writes; Google's open format: its front-matter tokens join the panel, and the agent is pointed at the file for the rules), so the agent uses your token rather than a hardcoded value. Gradient tokens (`--brand-gradient: linear-gradient(…)`) show up under Fill, in their own Gradients section.
- **Only what matters.** Styles are filtered by intent: "wrong color" sends only color information.
- **Your references.** Pasted screenshots go along; dropped SVGs are copied into the project as assets.

## The cheapest step that works

1. **Class swap — no AI.** A panel edit that maps cleanly to a Tailwind class (gap 12px → 16px, weight 500 → 600, a color from your tokens), or retyped text written as plain text in the JSX, is changed by Ilse itself. Instant, no tokens. The same goes for a component's prop picked in the panel's **Component** section (`variant="outlined"` → `"contained"`, any library, MUI included) and for a component dragged from the **Library** (Pro) when every prop has a value.
2. **Quick — one call, fast model.** A note about one element that is really a class change ("a bit more space", "stronger title") goes to your agent's fast model with only that element's code and no tools. It answers "remove these classes, add those" and Ilse applies it. Much cheaper than the agent, and a few seconds. Notes that plainly need more ("remove", "swap the icon", "a carousel") skip straight to the agent.
3. **Agent.** Anything bigger — new UI, structure, several files — runs your agent on a model sized to the task. If a cheap run changes no file, it is retried once a tier up.

**Models.** Two tiers per agent, `fast` and `strong`; open-ended work keeps the agent's own default. Claude ships with `haiku` / `sonnet`. Set your own in `.ilserc.json`:

```json
{ "models": { "fast": "haiku", "strong": "sonnet" } }
{ "models": { "codex": { "fast": "…", "strong": "…" } } }
```

`ILSE_MODEL=<model>` forces one model for everything.

**This one or all of them.** When the element belongs to a component repeated on the page, the card asks: *only this one* (an override where it is used) or *all of them* (the component's definition). With *all*, the preview already shows the change on every instance.

## The Library

The catalog and the design system in one tab. **Free** sees and adjusts what's already on the page: the list, search, where a component is on the page, the Component section, and the design system written as `DESIGN.md`. **Ilse Pro** puts new components on the page (copies, drag, insert) and takes the DS to other tools (`tokens.json`, `registry.json`).

Every component the product already has, read from the code (no AI): the project's own (exported and used, or in a kit folder like `components/ui` or `packages/`) and the library components the code imports — not the whole library.

- **Find:** the panel's **Library** tab (or the toolbar's library button with nothing selected). A click on a component outlines where it is on this page (or says it isn't here); click an instance to open its Component section. Search by name or by what it is for ("button", "modal", "botão"). With no search, **by type**: *Base* — libraries, the kit (`components/ui`, shared folders) and patterns used across features — grouped by what it's for (actions, inputs, overlays, data display, charts…), then *Product*, grouped by feature (the folder under `components/`, or the route group in `app/`). Read from names and from what each component renders, no AI; what fits nowhere goes to *Other*. **By folder** shows the code's own layout. **Edit organization…** (Pro, in ⋯ next to the search) creates `.ilse/catalog.md` in the project with your areas listed: rename them (`- keys: Keys` → `- keys: API keys`), move a component (`- OwnerBillingField: Product, Billing`) or hide one (under *Hidden*). It's plain Markdown, versioned with the project, and read every time the catalog opens. A design system the project already has comes first in Base: a story's `title` in Storybook (`Forms/Input` → group *Forms*), the kit folder in shadcn's `components.json`, or a dependency that calls itself a design system — those components are Base, keep its groups, and say *From the design system* on hover. `.ilse/catalog.md` still wins over all of it. Components on this page carry an *on page* label. Hovering shows its props and the names of its variants. Above the list: **All**, **On this page** (a flat A→Z list) or **Base**. Groups start closed; the ones you open stay open next time, per project.
- **Copies:** the previews are copies of the component as it appeared on a page — its HTML with the styles inline, kept by Pro in `~/.ilse/catalog/`, never in your project. They're taken as you use the app, not only when the catalog opens: a dialog you open, the next screen — one per look (variant), and a dialog is copied as its panel, not the dimmed layer behind it. A component not seen yet says which screen uses it, so you can open it.
- **Component section:** select a component on the page and Properties opens with it: where it comes from and its props, with only the values the code already uses or its type allows (a library's own `.d.ts` too: MUI's `variant` lists text, outlined, contained). A prop left unset shows its default when the code says it (`false (default)`, cva's `defaultVariants`, a library's `@default`); picking it removes the prop. Changing one is written into the JSX without AI when Ilse finds exactly that usage (Next 16 with Turbopack too, through the chunk's source map); otherwise your agent gets the change written out. In the panel's text field, Enter confirms and Shift+Enter adds a line break.
- **Use this one (Pro):** in the card, **+ → Component…** points your agent at the component to use (import, how the code writes it, "don't create another").
- **Drag onto the page (Pro):** drag a component from the library — it moves like an element already on the page: the copy goes in for real, the items around make room, the destination is outlined, and the grid, guides and distances show. The copy stays on the page as a draft, with the card on it — change its props in the panel, then confirm. Drafts survive a reload until the change is applied. Next to something inside one of your reused components (a label inside a card used in several places), it goes next to that card where the page uses it, never into the card's definition; inside a section written once, it lands right where you dropped it. Deleting or clearing its note takes the draft off the page: only a note that exists, or a change that was applied, keeps it.
- **Until the page catches up:** what you previewed — a style, a copy, a hidden element — stays on screen after the change is applied, until the page re-renders with the real thing. If it doesn't on its own, Ilse asks the framework to re-render (Next's App Router: no reload, state kept). It asks you to reload only when the change has no preview on screen and the page still didn't update.
- **Create DS:** at the top of the Library, while the project has no `.ilse/ds` yet: what was found and **Create design system** (or `ilse ds`). Once it exists the top shows **Export**, which writes again. It writes what the project already has to `.ilse/ds/DESIGN.md`, from the code and without AI: its tokens, its components with props, values, defaults and an example, and rules for agents. With Pro, your agent first writes **when to use** each component (one sentence, and when not to) — asked only for components that are new or changed since the last time, kept in `.ilse/ds/state.json`; it goes into `DESIGN.md` and into each registry item's description. Pro also writes `tokens.json` (W3C design tokens, for Figma via Tokens Studio or Style Dictionary) and `registry.json` (shadcn's registry format, installable: each component with its npm packages, the project components it imports as `@your-project/item`, a theme item with the tokens, and its contract under `meta.ilse`). Point your `AGENTS.md` at `.ilse/ds/DESIGN.md` and any agent — with or without Ilse running — builds with your components instead of inventing new ones. Nothing is written until you ask. What was written opens on screen: a window with one tab per file, each saying who reads it and how to use it — `DESIGN.md` drawn as a design system (colors, spacing, radius, components and their variants) with **Add to AGENTS.md** (one short block pointing any agent at the DS — written only on that click; or copy the line), the JSON files as written, copy and download. Without Pro the JSON tabs show a blurred sample. Click the DS's path at the top of the Library to open it again. With Pro the DS stays alive: when the code moves on (a component added, removed or with new props or values; a token changed), the Library says what changed since the DS was written, and **Update** writes it again — never on its own. Pro also tests the DS with a **fresh agent**: your agent proposes 3 real tasks for the product, an agent that knows only `DESIGN.md` does them, and Ilse checks the code without AI (components not in the DS, prop values it doesn't have, colors and sizes by hand). What it got wrong becomes suggested rules; **Add to the DS** puts one in `DESIGN.md`'s rules for agents (kept in `state.json` across rewrites). Ilse itself reads `.ilse/ds/DESIGN.md` like a project's own `DESIGN.md` (the project's own wins).
- **Duplicate** (free): select anything and **Duplicate** (next to Remove, at the bottom of the panel) puts a copy on screen right after it, as a draft, and tells your agent what it means in the code: a list's row becomes a new item in the data it renders (never a copy of the template, and data from the backend isn't invented), anything else a copy of its JSX in the same place. With Pro, a component's copy keeps its props, its variant can be changed before confirming, and when every prop has a value it is written without AI.

## Screens

**Screens** (the devices button in the toolbar) opens the page you're on at a phone, tablet or desktop width — iPhone 15 (390), iPad Mini (768), Desktop (1280) — one at a time, over the page. It's the same address in an iframe, so the login and cookies still hold and media queries answer to the screen's real width. Nothing changes in your project and the address doesn't change.

- **The same toolbar:** while Screens is open, the toolbar drives the Ilse inside the screen — select, edit in the panel, draw, Run, undo. The panel opens outside the screen, so it never covers a 390px layout. An adjustment goes to the code and hot reload updates the screen.
- **Size:** the devices sit side by side at the top; the phone turns to landscape. Drag the screen's right or bottom edge (or its corner) for any size in between — *Free*.
- **Rulers** on the top and left, in the screen's own pixels; the selected element shows on them in orange.
- **Select / navigate:** the toolbar's select button switches between picking elements and using the app (links, menus). Selection comes back on after a change is applied.
- **An app that refuses iframes** (`X-Frame-Options`, `frame-ancestors`): through Ilse's address (same port or `--separate`) those headers are dropped only for the screen's load. Otherwise Screens says so.

## Keeping your project safe

- **The agent runs isolated.** No personal `CLAUDE.md` or memory — only the project's own instructions. No shell: it reads and edits files, nothing else.
- **The change has to land on this page.** Every request carries the page it was made on. After the run, Ilse compares the components the agent edited with the ones rendered on the page; if none of them is there, the toolbar says which file changed and where it is used, with **Redo on this page**, **Undo** and **Keep** — instead of a plain "done".
- **The page must not break.** After a change, the toolbar listens for errors the page logs (React's duplicate keys, an uncaught exception) that weren't there before it. If one appears, it shows it with **Ask for a fix** (the error goes to your agent), **Undo** and **Ignore**.
- **The code is checked after the agent.** Since the agent can't build your project, Ilse parses every file it changed. If one no longer parses, the agent gets one turn to fix exactly that error; if it is still broken, the whole batch is undone and the card shows where.
- **Previews never touch React's DOM structure.** Drags and panel edits are shown with styles and stand-ins; cancelling a note puts the page back.

## Passing CI

A design change can break what CI runs: a prop used but never declared, a test that pins the old look, a "show only 10 rows" that changed the limit the backend relies on. So after every change — agent, quick step or class swap — Ilse runs the project's own checks before calling it done:

1. **Typecheck.** `tsc --noEmit`, incremental (its cache lives in `.git/ilse/`). Only errors in the files the change touched, or in files that import them, count.
2. **The tests that cover the change.** `vitest related` or `jest --findRelatedTests` on the changed files — seconds, not the whole suite.
3. **Only what passed before.** Whatever fails is run again on the project as it was before the change — a copy outside your project (`git archive` of HEAD, your uncommitted work on top, the change's files put back, `node_modules` linked). A failure that was already there — another agent's work on the same branch, a test already red — is never blamed on the change.
4. **The agent fixes it.** What the change broke goes back to the agent, with the designer's request it must keep. Its rules: a test that pins how something looks (text, class, colour, markup) and failed because the look changed on purpose is updated to the new look; a test of behaviour (paging, limits, permissions, requests, state) stays, and the code is fixed so the behaviour holds and the look still changes; a type error is fixed in the code.
5. **Checked again.** Up to two repair turns. A fix that deletes, skips or loosens a test doesn't count: Ilse compares the tests and assertions before and after.
6. **Still red?** The change stays and the toolbar says what still fails, with **Undo** and **Keep anyway**. The terminal lists each failure.

Before any of that, the agent is told the tests that cover the file it's about to change, so a look change usually updates its test in the same pass. It is also told to change only the presentation — shared constants, limits, data and logic stay — and to use the project's tokens.

With MCP, your agent drives its own turns: when it resolves the last annotation of a batch, `ilse_resolve` answers with what broke, and the agent fixes it and resolves again.

Paths the project changes another way (a vendored copy patched by a script, generated code) can be marked in `.ilserc.json` → `protected`: the agent is told not to edit them, and an edit there counts as a failure to fix. Settings: [Reference → Project checks](reference.md#project-checks).

## Undo

⌘Z works at two levels:

- **While you adjust** (the card is open): ⌘Z steps back through that draft — a panel value, a drag, a resize — on screen only. It never reaches into files you already applied.
- **After it's applied:** ⌘Z (or **Undo** in the toolbar) restores the files of the latest change, newest first; ⇧⌘Z puts it back. No need to ask the AI to revert.
- **After a restart:** the undo history is kept per project in Ilse's own folder (`~/.ilse/projects/…/undo.json`, never in your project), so quitting `ilse` doesn't cost you it. `ILSE_UNDO_SAVE=0` keeps it in memory only.

The shortcut doesn't take over while you type. Files you edited again afterwards are left alone, and the annotation goes back to pending so you can adjust and resend it.

## When your agent hits its usage limit

Ilse runs on your agent's account and shares its limits. For Claude, claude.ai, the Desktop app and Claude Code all count toward the same limit on the **same account**. If the Desktop app keeps working while Ilse is limited, they are on different accounts — see [Which Claude account](reference.md#which-claude-account-ilse-uses).

When the limit hits:

- **You see why:** the agent's own message ("You've hit your session limit · resets 7:30pm") and the account.
- **Nothing piles up failing:** Ilse stops calling the agent until the reset.
- **Annotations wait and resume on their own** shortly after the reset. (The queue lives in the running `ilse`; restart it before the reset and they go back to pending.)
- **Panel edits keep working** — class swaps don't use the agent.

To keep going before the reset: switch account (`--account`) or use the clipboard mode.

## Test mode in the toolbar

With Ilse Pro, the Design / Test switch turns the toolbar into the tester. **Run test** (the glasses, test mode's main button, where design mode has ⚡) first asks what to test: journeys, accessibility, technical errors, layout and consistency, each a toggle, and on which screens (desktop, tablet, phone). The screens start from the app itself (breakpoints in the code mean phones too); when the code doesn't say, Ilse asks once whether the app needs to work on phones. The last choice is remembered. Then an agent walks the app in a separate browser while the glasses blink. What it finds on the page you're on lands as blue markers on the elements, each with its note already written. Click a marker to change the note, then **Skip** (back on the next test), **Ignore always** (Ilse stops warning about it) or **Fix** (to your agent now; Ilse tests that page again after the fix). Findings with nothing to point at, like a console error, are in the report but get no marker. Nothing is queued on its own: a finding goes to the agent only when you fix it. The eye hides the markers. Design notes and test markers stay apart: each mode shows and runs its own.

**The report** (the list button) opens on the side when a test ends, compact — groups closed, one click opens one; ⤢ expands it to the middle of the page. It shows a number per group (journeys done, errors, improvements, repeated code) and what changed since the last test, then each group's findings. Errors are what breaks something; the rest are improvements. Click an item and, while you browse, it goes to the item's page, scrolls to the element and outlines it — every copy, for repeated code — and shows the detail, the files and lines, and the journeys that go through it. Per item, the same three as on its marker: **Skip**, **Ignore always** (undone in Project memory) or **Fix**. At the bottom, compact or expanded: **Run again** and **Fix all**; **Ignore all** is in the ⋯ menu, with a confirmation. A group you turned off keeps its findings from the test before, marked as such.

**Consistency** reads the code, no AI: the same element written by hand in several places (2 is a minor finding, 3 or more a bigger one), components of one folder that drifted apart (radius, padding, background), and values scattered too wide (radius, shadows, hand-picked colors). A component kit — a monorepo's `packages/` or the app's `components/ui` — counts as what already exists: "5 places rebuild a button by hand; the project already has Button". With a design system written (Create DS), its components count too, and its tokens become the rule: "#ff6c03 written by hand in 10 places; the design system has the token brand", with each place.

**Journeys** (the route button): describe something a person does in your app — "create a key and copy the token" — and Ilse walks it in a separate browser, starting on the page you're on. Your agent picks each step from what a screen reader would see; Ilse clicks and types, shows each step as it goes, and keeps the steps that worked. From then on the journey replays with no AI, in seconds. If the screen changed, the agent finds the way again from the step that broke; if it can't, the journey is stuck and says where and why. It also runs on a phone-sized screen, and keeps the phone's own way when it differs. Before a click that can't be taken back (delete, cancel, pay, log out) and that you didn't ask for, Ilse stops and asks. `ilse journeys` does the same from the terminal, and `ilse test` replays the recorded ones at the end. Recording needs Claude Code; replaying doesn't. With no journeys yet, **Suggest journeys from the code** has your agent read the app's pages and propose 3 to 5; tick the ones you want and **Record N** records them one after another (the rest come back when it's done). A journey lives on your machine; the folder icon saves it to the project (`.ilse/journeys.md`, readable steps) so the team replays it too, and the panel says when your copy found a new way the project's file doesn't have yet.

**A journey's report.** Opening the route button with journeys offers to run the last one again or start a new one. When a run ends, **View report** opens the report on its **Journeys** tab (a click on a journey in the panel, or on its line in the test report, does the same): every journey with its last result and its last 5 runs as dots, so you see when it started to break. Open one and you get its steps: ✓ with how long each took, ✗ on the one that broke with why and a screenshot of the page at that moment, the rest in grey — desktop and phone side by side when it ran on both. From there: **Run again**, **Copy log** (plain text for any agent), **Download** (one HTML page with the steps and the screenshot) and, when it got stuck, **Fix** (a note on the page where it stopped, sent to your agent). Runs and screenshots stay on your machine.

## Project memory

Settings → **Project memory** shows everything Ilse remembers of this project — nothing is kept out of sight:

- **Design changes** (free): the changes Ilse made here and kept, newest first, with your note, the files and which ones aren't committed yet. When the agent works on one of those files, it gets the latest changes made there and why.
- **Test mode** (Ilse Pro): how many tests ran, findings still there, fixed, and back after a fix (a click opens the page), what you asked to ignore — with **Warn me again** to take it back — and where the checks are right or noise, from your calls. **Forget test mode's memory** erases it after a confirmation (same as `ilse memory --forget`). Without Pro, the section says what it would hold.

## Commits know what Ilse changed

Ilse's edits land through another process, so the session that later commits didn't make them. Ilse keeps a ledger in `.git/ilse/changes.jsonl` (per clone, never committed): for every batch, the designer's note, panel edits and files.

- `ilse changes` prints what Ilse changed that isn't committed yet, ready for the commit message (also the `ilse_changes` MCP tool).
- On the first run in a git repo, Ilse asks to add a short note to your `AGENTS.md` / `CLAUDE.md` telling your agent to include those changes.
