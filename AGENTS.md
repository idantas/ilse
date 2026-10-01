# AGENTS.md

You are working on **Ilse**: a visual feedback tool for code agents. A designer points at the running app in the browser — click, select text, draw an area, drag, resize, edit in a property panel — and Ilse turns that into a precise change request that the user's own agent applies to the code, or applies it itself when no AI is needed.

This file is the source of truth for working in this repo. Humans read it too. The flow, end to end: [`.github/assets/ilse-architecture.svg`](.github/assets/ilse-architecture.svg).

## Commands

```bash
npm install
npm run build            # tsc + toolbar bundle (esbuild) → dist/
npm test                 # vitest
npx tsc --noEmit -p .    # typecheck only
npm run build:toolbar    # toolbar bundle only (the proxy re-reads it on every request)
```

Run it on a real React app: start that app's dev server, then from the app's folder run `node <path-to-this-repo>/dist/cli/index.js`. Add `ILSE_DEBUG=1` to see prompts, models and costs.

## Rules — never break these

1. **The AI is always the user's.** Ilse runs the agent CLI the user already has (Claude Code, Codex, Cursor CLI, Gemini CLI) or lets it pull work over MCP. Never add API keys, accounts, servers or billing of Ilse's own.
2. **Nothing leaves the machine.** Proxy, WebSocket and MCP bind to loopback. The journal stores timings and counts — never note text, prompts, code or file paths.
3. **Cheapest step that works.** Class swap (no AI) → quick path (one fast-model call) → full agent. A step that isn't sure hands over to the next one; it never guesses.
4. **Don't touch the user's project uninvited.** Changes land only to apply a request (always undoable), plus the one-time commit note the user agrees to.
5. **Every shortcut has an off switch** (`ILSE_QUICK`, `ILSE_HISTORY`, `ILSE_COMPONENT_CARD`, `ILSE_RESUME`, `ILSE_MODEL`), so runs can be compared in the journal.

## Map

| Path | What it does |
|---|---|
| `src/cli/default.ts` | The `ilse` command: setup, proxy, WS server, batching, the cost ladder, undo/redo, usage-limit pause |
| `src/cli/index.ts` | CLI flags and subcommands (commander) |
| `src/proxy/` | Proxy that injects the toolbar into the dev server's HTML; finds the dev server |
| `src/bridge/ws-server.ts` | WebSocket server (loopback, origin check), toolbar ↔ CLI messages |
| `src/bridge/augment.ts` | What the agent reads: source block, read hint, component card, Ilse history, scope |
| `src/context/locate.ts` | Browser element → `file:line` (AST + React dev stack); component card |
| `src/context/token-swap.ts` | Panel/class edits written into the JSX `className`, and retyped plain JSX text, no AI (`FAMILIES` maps CSS → Tailwind) |
| `src/agent/executor.ts` | Spawns the agent CLI, parses its stream, builds the batch prompt, failure reasons |
| `src/agent/agent-profile.ts` | Model tier per task, isolated env, Claude account, project instructions |
| `src/agent/quick-edit.ts` | Quick path: fast model → JSON `{remove, add, needsAgent}` → applied by token-swap |
| `src/agent/claude-accounts.ts` | Finds Claude logins (`CLAUDE_CONFIG_DIR`) to pick one per project |
| `src/agent/verify.ts` | After an agent batch: changed files that no longer parse → one repair turn, else undo |
| `src/agent/changeset.ts` | File snapshots before a batch → diff → undo / redo |
| `src/git/` | `.git/ilse/changes.jsonl` ledger (`ilse changes`), commit note for the project's agent |
| `src/mcp/` | MCP tools served by the running `ilse` at `/mcp`; stdio bridge `ilse-mcp` |
| `src/telemetry/journal.ts` | Session journal (toolbar → Settings → Logs) |
| `src/react/toolbar.tsx` | The toolbar: capture, card, gestures, draft history, settings |
| `src/react/property-panel.tsx` | Property panel (`PROPS` lists the controls) |
| `src/react/live-layout.ts` | Live drag/reorder/resize/move-into-container previews (DOM is never moved under React) |
| `src/i18n/messages.ts` | Every user-facing string, English and Portuguese |
| `src/design-context/` | Codebase analysis (token frequency, repeated patterns) — groundwork, not wired yet |

## Recipes

**Add a property to the panel**
1. Add it to `PROPS` in `src/react/property-panel.tsx` (and to `STYLE_KEYS` in `src/react/annotator.ts` if it must be captured).
2. Teach `FAMILIES` in `src/context/token-swap.ts` how to write it as a Tailwind class, so it applies without AI.
3. Test the class mapping in `src/context/__tests__/token-swap.test.ts`.

**Change what the agent is told**
- Per-annotation context: `src/bridge/augment.ts` (shared by spawned agents and MCP).
- Batch instructions: `buildBatchPrompt` in `src/agent/executor.ts`.
- Keep it short: every line is re-sent on every turn.

**Add a CLI flag or subcommand**
`src/cli/index.ts` (option + description key) → `DefaultOptions` in `src/cli/default.ts` → strings in `src/i18n/messages.ts` → the CLI section of `README.md`.

**Add user-facing text**
Add a key with `pt` and `en` to `src/i18n/messages.ts` and use `t('key')`. Don't hardcode strings.

**Add an agent CLI**
`detectAgent` and `buildArgs` in `src/agent/executor.ts` (flags for prompt, model, output); model tiers default in `src/agent/agent-profile.ts`.

## Conventions

- TypeScript strict, ES modules, imports end in `.js`.
- Comments explain **why**, next to the code they explain.
- Pure logic in small modules with tests in `__tests__/` beside them. UI is checked by hand.
- Code, comments and docs in English.

## Done means

- [ ] `npx tsc --noEmit -p .` clean, `npm test` passes, `npm run build` works.
- [ ] New logic has tests; UI changes were tried in a browser — or the PR says they weren't.
- [ ] New strings exist in English and Portuguese.
- [ ] README updated if users see the change (commands, flags, behavior).
- [ ] Flow changed (a new step, path, loop or setup question)? Update `scripts/architecture-svg.py` and regenerate both diagrams: `python3 scripts/architecture-svg.py en && python3 scripts/architecture-svg.py pt`.
- [ ] The rules above still hold.
