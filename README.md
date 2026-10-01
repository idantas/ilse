<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset=".github/assets/logo-ilse-dark.svg">
    <img src=".github/assets/logo-ilse.svg" alt="Ilse" width="220">
  </picture>
</p>

**The designer's eye inside the code agent.**

Point at what's wrong in the browser. Your agent fixes it in the code. You approve.

```bash
cd your-react-project
npx github:idantas/ilse
```

That's the whole setup. No import, no changes to your project.

Or ask your coding agent:

```
Install and run Ilse in this project — see https://github.com/idantas/ilse
```

> Ilse 0.5 isn't on npm yet, so this installs straight from GitHub and builds on the first run (takes a minute). To keep the command around, install it once — in two steps, because npm can't build a package during a global install straight from git:
>
> ```bash
> npm pack git+https://github.com/idantas/ilse.git   # builds the package from GitHub
> npm install -g ./ilse-design-*.tgz                  # installs it as `ilse` / `ilse-design`
> ```

---

## Step by step

**Once**

1. Have a code agent installed and logged in: Claude Code, Codex, Cursor CLI or Gemini CLI. For the MCP mode, an agent app like Claude Desktop is enough.
2. The first time you run Ilse, pick a mode:
   - **Automatic** (recommended): Ilse calls your agent. Nothing to say, nothing to paste.
   - **From your agent's chat (MCP)**: your agent pulls the annotations. See [Connect your agent](#connect-your-agent-mcp).
   - **Clipboard**: Ilse copies each annotation and you paste it anywhere.

**Every time**

1. Terminal 1, in your project: `npm run dev`.
2. Terminal 2, same folder: `npx github:idantas/ilse` (or `ilse-design`, if installed globally). Add `--mode mcp` to use the MCP mode for this run only.
3. Work on `http://localhost:4700` instead of your usual dev URL.
4. Click an element, write what should change or tweak it in the property panel, and send.
5. The change appears in the page. Don't like it? ⌘Z / Ctrl+Z.

**MCP mode only**

- Once per agent: toolbar → Settings → **Connect agent** → pick your agent → **Copy** → paste it into the agent's MCP settings.
- Once per conversation: start the watch (`/mcp__ilse__watch` in Claude Code, or say "Watch the Ilse annotations").

## How it works

![How Ilse works: setup once, then every tweak goes from pointing in the browser to the cheapest step that can apply it — class swap, quick model or full agent — and back to the page, with undo and a commit ledger](.github/assets/ilse-architecture.svg)

<sub>Diagram source: `scripts/architecture-svg.py` (`python3 scripts/architecture-svg.py en` / `pt`).</sub>

1. Start your dev server as usual (`npm run dev`).
2. In another terminal, in the same folder, run `npx github:idantas/ilse`.
3. Ilse finds your dev server and opens **`http://localhost:4700`**, which is your app with the Ilse toolbar on top. Hot reload keeps working.
4. Click an element, select text or draw an area. Say what should change, or tweak it in the property panel.
5. Send. Your agent edits the code, and you see the result live.
6. Don't like it? Hit **Undo** in the toolbar (or ⌘Z / Ctrl+Z) and the files go back exactly as they were, with no agent involved.

Ilse uses **the agent you already have** (Claude Code, Codex, Cursor CLI, Gemini CLI), logged in with your own account. Ilse has no API key, no account and no server of its own.

---

## Why the agent gets it right

Before your agent is called, Ilse does the searching for it:

- **Exact source location.** The clicked element is resolved to `file:line` in your repo, and the agent gets the code snippet with the request, so it starts at the right JSX node instead of grepping around. Two independent signals agree on it: the code itself (classes, text, attributes, parsed from the AST) and React's own dev stack (which component rendered the element, in which file, and where that component is used). No bundler plugin.
- **Only the slice it needs.** The agent is told which lines to read, not to open the whole file — a 900-line component is ~10k tokens, re-sent on every turn.
- **Component card.** For a reused component, the agent gets where it is defined, whether it takes a `className`, and where it is used — the questions it would otherwise spend turns grepping for.
- **Ilse's own history.** The last few changes Ilse made to the same file ride along ("decided by the designer, keep them"), so a new fix doesn't undo an earlier one. Sessions start fresh; this short history replaces resuming the whole previous conversation.
- **Your design tokens.** Tokens from `tailwind.config`, Tailwind v4 `@theme`, CSS variables or W3C `tokens.json` are detected on startup, so the agent uses the project's token rather than a hardcoded value.
- **Only what matters.** Styles are filtered by intent: if you say "wrong color", only color information goes along.
- **Your references.** Paste a screenshot from Figma or drop an SVG; SVGs are copied into the project as assets.

## The cheapest step that works

Every annotation takes the cheapest route that can apply it:

1. **Class swap — no AI.** A property-panel edit that maps cleanly to a Tailwind class (gap 12px → 16px, weight 500 → 600, a color from your tokens, a border, a width), or retyped text that is written as plain text in the JSX, is changed by Ilse itself. Instant, no tokens.
2. **Quick — one call, fast model.** A note about one located element that is really a class change ("a bit more space", "stronger title") goes to your agent's fast model with only that element's code, no tools, and comes back as "remove these classes, add those". Ilse applies it. About $0.01 and a few seconds. Notes that plainly need more than classes ("remove", "swap the icon", "a carousel") skip straight to the agent, and the decisions for a batch are asked in parallel, so one slow answer doesn't hold up the rest.
3. **Agent.** Anything bigger — new UI, structure, several files — runs your agent, isolated (no personal `CLAUDE.md` or memory, the project's own instructions only), without a shell, on a model sized to the task. If a cheap run changes no file, it is retried once a tier up. Since the agent can't build your project, Ilse parses every file it changed: if one no longer parses, the agent gets one turn to fix exactly that error, and if it is still broken the whole batch is undone and the card shows where.

**Models.** Two tiers per agent, `fast` and `strong`; open-ended work keeps the agent's own default. Claude ships with `haiku` / `sonnet`; set your own in `.ilserc.json`:

```json
{ "models": { "fast": "haiku", "strong": "sonnet" } }
{ "models": { "codex": { "fast": "…", "strong": "…" } } }
```

`ILSE_MODEL=<model>` forces one model for everything.

**Apply to this one or all.** When the element belongs to a component repeated on the page, the card asks: *only this one* (an override at this usage) or *all of them* (the component's definition).

## When your agent hits its usage limit

Ilse runs on your agent's account, so it shares that account's limits. For Claude, usage on claude.ai, the Desktop app and Claude Code all counts toward the same limit — on the **same account**. If the Desktop app keeps working while Ilse is limited, they are on different accounts: check which one Ilse uses (startup line, toolbar settings) and switch with `--account`.

When the limit hits:

- **You see why.** The agent's own message ("You've hit your session limit · resets 7:30pm") and the account, not just a failed run.
- **Nothing piles up failing.** Ilse stops calling the agent until the reset time it read from that message.
- **Annotations wait and resume on their own** shortly after the reset — no need to send them again. (The queue lives in the running `ilse`: if you restart it before the reset, they go back to pending.)
- **Panel edits keep working.** Class swaps don't use the agent.

To keep going before the reset: switch to an account with room left (`--account`), or use the clipboard mode and paste into any chat.

## Commits know what Ilse changed

Ilse's edits land through another process, so the session that later commits didn't make them. Ilse keeps a ledger in `.git/ilse/changes.jsonl` (per clone, never committed): for every batch, the designer's note, panel edits and files.

- `ilse changes` prints what Ilse changed that isn't committed yet, ready to write the commit message (also the `ilse_changes` MCP tool).
- On the first run in a git repo, Ilse asks to add a short note to your `AGENTS.md` / `CLAUDE.md` telling your agent to include those changes.

## Undo

⌘Z works at two levels, depending on what you are doing:

- **While you adjust** (the card is open and you changed something): ⌘Z steps back through that draft — a panel value, a drag, a resize — on screen only. At the start of the draft it stops; it never reaches into files you already applied.
- **After it's applied:** ⌘Z (or the **Undo** button) restores the files of the latest change, newest first, and ⇧⌘Z puts it back. You don't have to ask the LLM to revert anything.

- The shortcut doesn't take over while you type in a field, and with nothing to undo your page's own ⌘Z keeps working.
- Files you edited again afterwards are left alone.
- The annotation goes back to pending, so you can adjust it and send it again.

---

## Features

- **3 capture modes:** click an element, select text, or draw an area
- **Property panel:** layout (width/height as Fixed · Hug · Fill, flow, alignment, gap, padding and margin per side), typography, colors, stroke and radius — with your project's scale and tokens
- **Edit text:** a text element gets a *Text* field at the top of the panel. Type and see it on the page; text that comes from a variable, prop or translation goes to the agent, which changes it at the source.
- **Remove an element:** *Remove element* at the bottom of the panel, or the Delete key (fn+⌫ on a Mac) while the note is empty — ⌫ works once focus is out of the note. It disappears on screen right away; the agent takes it out of the code (from a `.map` list, only that item unless *Apply to* says all). The command's × or ⌘Z brings it back.
- **Move for real:** drag to reorder, or into and out of containers, and the page re-flows live
- **Move and resize:** drag or resize elements with snap-to-grid, and the gesture becomes the instruction
- **Reference images:** paste or upload a screenshot or SVG
- **Animation freeze:** pause animations to annotate tooltips, toasts and dropdowns
- **Batch send:** annotate several elements, send them together
- **Stop:** interrupt the agent at any time; annotations go back to pending
- **Live progress:** see each fix land as the agent works
- **History-friendly:** every prompt carries `ilse · annotation <id> · <Component> · <file>`, so past fixes are searchable in your agent's history (for example with [ctx](https://github.com/ctxrs/ctx))
- **English / Portuguese:** auto-detected

---

## CLI

```bash
ilse-design                 # find the dev server, open the proxy, listen
ilse-design --target 3000   # dev server port, if auto-detection misses it
ilse-design --proxy-port 4800
ilse-design --no-open       # don't open the browser
ilse-design --inject        # put <Ilse /> in your layout instead of using the proxy
ilse-design --reset         # choose mode again (automatic / clipboard)
ilse-design --account       # choose again which Claude account this project uses
ilse-design changes         # what Ilse changed that isn't committed yet
```

These assume a global install (see the two commands at the top). Without it, prefix them with `npx github:idantas/ilse` instead of `ilse-design`. The command is also available as `ilse`.

The first run asks for a mode:
- **Automatic** (recommended): Ilse calls your agent.
- **Clipboard**: Ilse copies the annotation so you can paste it into any agent's chat.

Set `ILSE_DEBUG=1` to see prompts, token usage and cache hits per run.

Switches, for comparing runs: `ILSE_QUICK=0` (no quick step), `ILSE_HISTORY=0` (no Ilse history in the prompt), `ILSE_COMPONENT_CARD=0`, `ILSE_RESUME=1` (resume the agent session between batches), `ILSE_AGENT_USER_CONTEXT=1` (let the agent load your personal `CLAUDE.md` and memory).

**Logs.** Toolbar → Settings → **Logs** copies the session journal as Markdown or JSON. For every annotation it records:
- the path it took: no-AI swap, quick, agent or MCP (and the model);
- whether the element was located;
- how long you spent composing it;
- a step-by-step timeline: queued → agent started talking → first edit → resolved;
- whether you undid it;
- for each agent run: turns, tools used, tokens and cost.

It never records your note text, prompts, code or file paths. It is also saved in `~/.ilse/logs/`.

### Connect your agent (MCP)

Prefer to work from your agent's chat (Claude Desktop, Claude Code, Cursor…)? Run `ilse-design --mode mcp`, open the toolbar settings, then **Connect agent**, and copy the block for your agent. Your agent then pulls the annotations, applies them, and reports back to the toolbar.

You don't ask for each annotation. At the start of a conversation, start the watch once:

- **Claude Code:** type `/mcp__ilse__watch`.
- **Claude Desktop:** pick **watch** from Ilse's prompts in the attachments (+) menu.
- **Any agent:** or just say "Watch the Ilse annotations."

It then loops on its own: it waits, receives, edits, reports back, and waits again. Chat agents don't watch forever, though. After a long pause or many annotations, the agent may stop and reply in the chat; just say it again. If you don't want to think about this at all, use the default **automatic** mode, where Ilse calls the agent for you.

- The MCP endpoint is served by Ilse on `localhost`, protected by a token in `~/.ilse/token`.
- Nothing leaves your machine.
- For Claude Desktop, the block uses `ilse-mcp`, a small bridge to the running Ilse.

### Which Claude account Ilse uses

Claude Code keeps one login per configuration directory (`CLAUDE_CONFIG_DIR`), so a machine can hold, say, a personal Pro account and a work Team account side by side. On start, Ilse finds the accounts that are logged in — the default `~/.claude`, any `~/.claude-*` folder, and directories your shell profile sets — and, when there is more than one, asks which to use in this project:

```
Which Claude account should Ilse use in this project?
● you@gmail.com · Pro                     ~/.claude
○ you@company.com · Team (Company)        ~/.claude-company
```

- The choice is saved per project (in `~/.ilse/config.json`, never in the repo) and every run uses it — the agent and the quick step — whatever account the terminal you started Ilse from happens to have.
- The account shows in the startup line and in the toolbar settings.
- `ilse-design --account` asks again. To add an account, log in once with its own directory: `CLAUDE_CONFIG_DIR=~/.claude-work claude`.

---

## Optional: `<Ilse />` in your layout

If you'd rather not use the proxy, for example because auth callbacks are bound to your dev port:

```bash
npm install -D github:idantas/ilse
```

```tsx
// app/layout.tsx (Next.js) or your root component (Vite)
import { Ilse } from "ilse-design/react";

export default function RootLayout({ children }) {
  return (
    <html>
      <body>
        {children}
        <Ilse />
      </body>
    </html>
  );
}
```

It renders nothing in production. Then run `ilse-design` as usual, and it will skip the proxy.

---

## Compatibility

| Framework | Status |
|---|---|
| Next.js 13+ (App & Pages Router) | ✓ tested on 16 |
| Vite + React | ✓ tested on Vite 7 / React 19 |
| Create React App, Remix, Astro + React | should work, not re-tested |

| Agent | How Ilse uses it |
|---|---|
| Claude Code | runs `claude -p` (automatic) or via MCP |
| Codex, Cursor CLI, Gemini CLI | runs the CLI (automatic), not yet tested end to end |
| Anything else | clipboard |

---

## Philosophy

AI freed designers from the execution bottleneck, but craft still demands human judgment.

Ilse is the designer's eye inside the agent: you point at what's wrong, the agent fixes it, you approve. Magic, but in control.

> "Design is a tool for improving humanity." — Ilse Crawford

---

## Contributing

Issues and pull requests are welcome. The repo is built with coding agents and documented for them first: open your agent in the repo and it reads [AGENTS.md](AGENTS.md) — commands, rules, code map, recipes and what "done" means. Humans: same file, plus [CONTRIBUTING.md](CONTRIBUTING.md). Security problems go privately: [SECURITY.md](SECURITY.md).

## License

MIT — see [LICENSE](LICENSE).
