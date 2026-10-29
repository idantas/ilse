# Free × Pro

Where each piece of Ilse lives, so nobody (human or agent) has to argue it again.

**The rule:** what works without Pro installed lives here, in the public repo. What runs the test mode — or anything that sells — lives in Ilse Pro (private repo, shipped as a signed `.tgz` outside npm). What's free never becomes paid.

| Free — this repo (`ilse-design` on npm) | Pro — private repo, `~/.ilse/pro/` |
|---|---|
| Toolbar, panel, live layout, token swap, quick path, agent, undo; the panel's Component section and prop swap (props and variants of the selected component, read from the code and the library's types). **The Library** (the catalog): the list, search, *On this page* and a click that shows where a component is on the page — Free sees and adjusts what's already on the page. **Duplicate** any element (a copy on screen + a note: a list row → a new data item, else a copy of the JSX) | Test mode runner: browser, checks, journeys (`src/test/`) |
| MCP, proxy / same port, Vite plugin, extension, bookmarklet. **Screens** (phone / tablet / desktop / free size, rulers, the same toolbar on each) | `ilse test` and Pro's other commands |
| The mascot, the Design / Test switch, test mode asleep without Pro | Project memory (approved / discarded, new / returned) |
| | The Library's hands: copies of components (thumbnails, `src/catalog/`), "+ → Component…", dragging onto the page and the no-AI insert (also Duplicate of a component with its props and variant), **Edit organization** (`.ilse/catalog.md`). Pro puts new components on the page |
| Rendering findings in the toolbar (it shows what Pro sends) | Taking the DS to other tools: Create DS also writes `tokens.json` (W3C — Figma, Tokens Studio, Style Dictionary) and `registry.json` (shadcn, installable elsewhere) (`ProPlugin.dsFormats`); the AI pass — when to use each component, by the user's agent (`ProPlugin.dsNotes`) —, keeping it up to date (the Library says what changed; Update), drift checks (test mode's Consistency), the fresh-agent test (`ProPlugin.dsCheck`), docs page |
| **Create DS** (`ilse ds`, or the Library's *Create design system*; then *Export*): the project's components and tokens written to `.ilse/ds/DESIGN.md` from the code, no AI — the user reads their DS, any agent builds with it. Free = read and use your DS; Pro = take it to other tools and keep it alive | |
| The memory screen and its design history (the ledger); its test part shows what Pro sends | License check, activation, updates of Pro |
| The plugin seam: `src/pro/types.ts`, `src/pro/load.ts` | |

## How Pro plugs in

- `loadPro()` imports `~/.ilse/pro/current/index.js` (or `ILSE_PRO=<path>` in development). Missing, broken or another `pluginApi` → Ilse runs free, quietly.
- Pro's default export is a `ProPlugin` (`src/pro/types.ts`): `registerCli(program, core)` adds commands — `core` lends the core's strings (`t`), how it finds the running app (`appUrl`) one question to the user's agent (`askAgent`, no tools — journeys pick each step and suggestions with it) and the code's consistency analysis (`consistency`, from `src/design-context/consistency.ts`), so Pro doesn't copy them — `server(ctx)` gets the same `askAgent` and `consistency`, plus the user's `locale`, and returns the hooks the bridge calls (`getFindings`, `decideFinding`, `testControl` — with the groups and screens picked before the run — `retest`, `journeys`).
- The bridge tells the toolbar `pro: { test: true, journeys: true }` on connect only when Pro can run them; the Journeys button (test mode) shows only with `journeys`. Otherwise the switch shows test mode asleep and a tap explains where to get it.
- Forcing the switch on in the browser does nothing: there's no runner in this package.
- Change a shape in `types.ts` in a way an older Pro can't handle → bump `PLUGIN_API`.
