# Free × Pro

Where each piece of Ilse lives, so nobody (human or agent) has to argue it again.

**The rule:** what works without Pro installed lives here, in the public repo. What runs the test mode — or anything that sells — lives in Ilse Pro (private repo, shipped as a signed `.tgz` outside npm). What's free never becomes paid.

| Free — this repo (`ilse-design` on npm) | Pro — private repo, `~/.ilse/pro/` |
|---|---|
| Toolbar, panel, live layout, token swap, quick path, agent, undo | Test mode runner: browser, checks, journeys (`src/test/`) |
| MCP, proxy / same port, Vite plugin, extension, bookmarklet | `ilse test` and Pro's other commands |
| The mascot, the Design / Test switch, test mode asleep without Pro | Project memory (approved / discarded, new / returned) |
| Rendering findings in the toolbar (it shows what Pro sends) | Design system connected to code tokens and Figma |
| The memory screen and its design history (the ledger); its test part shows what Pro sends | License check, activation, updates of Pro |
| The plugin seam: `src/pro/types.ts`, `src/pro/load.ts` | |

## How Pro plugs in

- `loadPro()` imports `~/.ilse/pro/current/index.js` (or `ILSE_PRO=<path>` in development). Missing, broken or another `pluginApi` → Ilse runs free, quietly.
- Pro's default export is a `ProPlugin` (`src/pro/types.ts`): `registerCli(program, core)` adds commands — `core` lends the core's strings (`t`) and how it finds the running app (`appUrl`), so Pro doesn't copy them — `server(ctx)` returns the hooks the bridge calls (`getFindings`, `decideFinding`, `testControl`, `retest`).
- The bridge tells the toolbar `pro: { test: true }` on connect only when Pro can run the test. Otherwise the switch shows test mode asleep and a tap explains where to get it.
- Forcing the switch on in the browser does nothing: there's no runner in this package.
- Change a shape in `types.ts` in a way an older Pro can't handle → bump `PLUGIN_API`.
