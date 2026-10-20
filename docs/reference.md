# Reference

**English** · [Português](reference.pt-BR.md) · [← README](../README.md)

## Install

Run it without installing, in your project's folder:

```bash
npx ilse-design@latest
```

Ilse is on npm as [`ilse-design`](https://www.npmjs.com/package/ilse-design); it needs Node.js 18 or newer. Keep `@latest`: without it, `npx` runs a copy already installed on your machine, however old.

To keep the command around, install it once — the same command updates it:

```bash
npm install -g ilse-design@latest   # installs it as `ilse` / `ilse-design`
```

When a newer version is out, Ilse says so at startup, with the command to update. Every version is also a [GitHub Release](https://github.com/idantas/ilse/releases).

## Where Ilse opens

By default Ilse **starts your dev server behind itself and takes its usual port**. It runs your `dev` script (or `start`) on a hidden port — the app's port + 10000 — and puts its proxy on the app's own port:

```
localhost:3000  →  Ilse (proxy + toolbar)  →  localhost:13000  (your dev server)
```

The browser keeps the same address, so what is tied to it keeps working: the login saved in the browser, cookies, SSO and OAuth callbacks, links in emails. Nothing is written to the project, and any browser works. Ctrl+C stops Ilse and the dev server together; the dev server's log shows up in Ilse's terminal.

- **The port:** detected — a `--port` / `-p` in the script, else `server.port` in `vite.config`, else the framework default (Next 3000, Vite 5173). The first time in each project Ilse shows it — *Your app will run at localhost:5173* — and you **run on this port** or **change the port**. The choice is saved per project in `~/.ilse/config.json`; `ilse-design --port <n>` changes it later, `--target <n>` overrides it for one run.
- **Monorepos:** when the root script is a task runner (`turbo dev`, …), Ilse finds the Vite and Next apps in the workspace (`workspaces` in `package.json`, or `pnpm-workspace.yaml`) and runs the app's own `dev` script from its folder — the runner wouldn't pass the hidden port on. Several apps: it asks once which one to open.
- **The hidden port:** `PORT` for everyone, plus `--port` for Next and Vite (a flag after the script's own wins over it).
- **Port already in use:** Ilse says who holds it (another `ilse`, or another app's dev server) and offers, best first: a free port your code names (`.env.example`, `next.config`, `vite.config`, auth/middleware files, the dev script); stopping the other `ilse` when your login is tied to that port; the next free port — with a warning when the login points to the taken one; or a port you type. The choice is saved for this project. Real `.env` files are never opened: only committed templates, and only `host:port` and the variable name are kept. When the code doesn't say, Ilse asks once whether the login depends on the port. It never puts the toolbar over a server it didn't start. Without a terminal to ask, it stops and lists the ports your code names. The toolbar is used right on the app's port only when the project's `vite.config` loads `ilse-design/vite`.
- **Separate address:** `--separate` for one run, or choose it in the first run. You run the dev server yourself and Ilse opens `localhost:4700`; anything tied to the original address (logins, callbacks) stays there.
- **Not covered yet:** a dev script that starts several servers at once (they'd all get the same `PORT`), apps that need other workspace services running alongside, and frameworks that read neither `PORT` nor `--port`. Use `--separate` there.

## Modes

The first run asks how Ilse should hand annotations to your agent:

- **Automatic** (recommended): Ilse calls your agent. Nothing to paste.
- **From your agent's chat (MCP)**: your agent pulls the annotations — see [Connect your agent](#connect-your-agent-mcp).
- **Clipboard**: Ilse copies each annotation and you paste it anywhere.

## The toolbar

### Point and adjust

- **3 ways to point:** click an element, select text, or draw an area.
- **Select the parent:** the ↰ button on the note card moves the selection up to the containing element (library wrappers of the same size are skipped). The element's label at the top of the card opens its place in the page: a couple of elements above, the ones beside it and the ones inside, named by the component that renders them. Hover a row to see it on the page; click to select it. A click inside an SVG selects the whole `<svg>`; ⌘-click (Ctrl-click) selects the exact element, such as one path of an icon.
- **Property panel:** text, position (static · relative · absolute · fixed · sticky with X/Y; out of the flow the element drags anywhere, ignoring its parent's layout), layout (width/height as Fixed · Hug · Fill, flow, alignment, gap, padding and margin per side), typography (size, weight, line height, left · center · right alignment), colors, stroke, radius, opacity and effects (shadow, blur, backdrop blur — shown when the element has them, "+" adds a shadow) — with your project's scale and tokens.
- **None:** spacing, radius and stroke-weight lists start with *None* (zero) — no padding, square corners, no stroke.
- **Stroke:** *+* adds one and shows its color, weight, style and sides; *−* takes it away.
- **Apply to — only this one or all:** when the element belongs to a component repeated on the page. With *All · N*, panel edits preview on every instance at once.
- **Edit text:** text elements get a *Text* field at the top of the panel. Text that comes from a variable, prop or translation goes to the agent, which changes it at the source.
- **Remove an element:** *Remove element* at the bottom of the panel, or the Delete key (fn+⌫ on a Mac) while the note is empty — ⌫ works once focus is out of the note. From a `.map` list, only that item goes unless *Apply to* says all.
- **Move for real:** drag to reorder, or into and out of containers; the page re-flows live. The drag moves what is selected — a cell, not its row; a title, not its card. To move the container, select it first (↰ or the tree).
- **Resize:** drag the handles, with snap-to-grid.
- **Pencil:** sketch on the page; the strokes are read and sent along. A sketch over empty space is anchored on the element that holds it, so the agent gets its file like a click does.
- **Reference images:** paste or upload a screenshot or SVG.

### Review the page

- **Scan:** checks the whole page and lists design issues by category — contrast, typography, spacing, accessibility, components. Hover an issue to see where it is.

### Toolbar and settings

- **Run:** sends the pending annotations together. **Stop:** interrupts the agent; annotations go back to pending.
- **Live progress:** see each fix land as the agent works.
- **Pause animations:** freeze tooltips, toasts and dropdowns to annotate them.
- **Hide markers:** hide the annotation dots on the page.
- **Clear annotations:** removes them all (click twice to confirm).
- **Settings:** connection and annotation status, the Claude account in use, **Design System** (paste a W3C `tokens.json` when Ilse doesn't find your tokens), **Snap to grid**, **Connect agent** (MCP), **Logs**, **Project memory** ([what it shows](how-it-works.md#project-memory)), **Keyboard shortcuts** and **Language** (English / Portuguese, detected automatically).

### Keyboard shortcuts

Also in Settings → **Keyboard shortcuts**, and in the tooltip of every control that has one. Single keys never fire while you type in a field.

| Keys | What it does |
|---|---|
| `V` | Switch between selecting elements and using the page |
| `I` `I` | Bring the toolbar back to its default place (after dragging it out of sight) |
| `Esc` | Close what is on top (note, scan, settings), then the toolbar |
| `⌘`-click (`Ctrl`-click) | Select the exact element inside an SVG |
| `⌘↵` (`Ctrl+Enter`) | Send the note |
| `Delete` (fn+⌫) | Remove the selected element, with the note empty |
| `⌘Z` / `⇧⌘Z` | Undo / redo: a draft step, or the last applied change |
| Pencil: `↵` · `⌘Z` · `Esc` | Finish the sketch · undo the last stroke · discard it |

Every prompt carries `ilse · annotation <id> · <Component> · <file>`, so past fixes are searchable in your agent's history.

## CLI

```bash
ilse-design                 # start your dev server behind Ilse on its usual port, listen
ilse-design --separate      # this run: open on a separate address (localhost:4700); run the dev server yourself
ilse-design --same-port     # this run: the usual address, even if the setup chose the separate one
ilse-design --port 5173     # the port your app runs on, saved for this project
ilse-design --target 3000   # dev server port, if auto-detection misses it
ilse-design --proxy-port 4800
ilse-design --no-open       # don't open the browser
ilse-design --mode mcp      # MCP mode for this run only
ilse-design --inject        # put <Ilse /> in your layout instead of using the proxy
ilse-design --reset         # answer the setup questions again (mode, where Ilse opens)
ilse-design --account       # choose again which Claude account this project uses
ilse-design changes         # what Ilse changed that isn't committed yet
ilse-design bookmarklet     # the bookmarklet that puts the toolbar on any local page
```

These assume a global install. Without it, use `npx ilse-design@latest` instead of `ilse-design`. The command is also available as `ilse`.

**Environment switches**, mostly for comparing runs:

| Variable | Effect |
|---|---|
| `ILSE_DEBUG=1` | Show prompts, models, token usage and cache hits per run |
| `ILSE_MODEL=<model>` | One model for everything |
| `ILSE_QUICK=0` | No quick step |
| `ILSE_HISTORY=0` | No Ilse history in the prompt |
| `ILSE_CHECK=off` | No project checks after a change; `types` runs only the typecheck |
| `ILSE_COMPONENT_CARD=0` | No component card |
| `ILSE_RESUME=1` | Resume the agent session between batches |
| `ILSE_AGENT_USER_CONTEXT=1` | Let the agent load your personal `CLAUDE.md` and memory |

## Project checks

After each change Ilse runs the project's typecheck and the tests that cover the changed files, and the agent fixes what the change broke ([how it works](how-it-works.md#passing-ci)). It finds them on its own: `tsc` when there is a `tsconfig.json`, and `vitest` or `jest` from `package.json`. To point it elsewhere, in `.ilserc.json`:

```json
{
  "check": {
    "typecheck": "pnpm typecheck",
    "test": "pnpm test --",
    "timeoutMs": 180000
  },
  "protected": [
    { "path": "components/ui/**", "note": "a copy of the prototype — change it with a patch in scripts/prototype/patches/" },
    "src/generated/**"
  ]
}
```

- `typecheck`: a command whose output reads like `tsc`'s, or `false` to skip it.
- `test`: a command that gets the changed files appended; only its exit code is read. `false` skips the tests.
- `timeoutMs`: per command (default 3 minutes). A check that runs out of time is skipped, not failed.
- `protected`: globs, or `{ path, note }`. The agent is told not to edit them (with the note), and an edit there is handed back to fix.

`ILSE_CHECK=off` turns all of it off; `ILSE_CHECK=types` keeps only the typecheck. The journal records how long the checks took and how many problems they found — never which.

## Logs

Toolbar → Settings → **Logs** copies the session journal as Markdown or JSON (also saved in `~/.ilse/logs/`). For every annotation: the path it took (no-AI swap, quick, agent or MCP, and the model), whether it was located, how long you spent composing it, a timeline (queued → agent started → first edit → resolved), whether you undid it, and per agent run the turns, tools, tokens and cost.

It never records your note text, prompts, code or file paths.

## Connect your agent (MCP)

To work from your agent's chat, install Ilse in your agents once:

```bash
ilse mcp install              # asks which of the agents found: claude-code, claude-desktop, cursor, codex, gemini
ilse mcp install cursor       # just one
ilse mcp install --print      # show what would change, change nothing
ilse mcp uninstall            # take it out again
```

Each agent gets the `ilse-mcp` bridge, which finds the `ilse` running in the agent's project by itself. Only Ilse's entry is touched; a settings file that doesn't parse is left alone. Once installed, every new conversation knows Ilse's rules — including calling `ilse_changes` before a commit, so edits made through Ilse don't look like strangers. Then run `ilse-design --mode mcp` in the project. (The toolbar settings → **Connect agent** still shows the blocks to paste by hand.)

At the start of a conversation, start the watch once:

- **Claude Code:** `/mcp__ilse__watch`
- **Claude Desktop:** pick **watch** from Ilse's prompts in the attachments (+) menu
- **Any agent:** say "Watch the Ilse annotations."

The agent then waits, receives, edits, reports back and waits again. Chat agents don't watch forever: after a long pause it may stop — just say it again, or use the automatic mode.

The endpoint is served on `localhost` and protected by a token in `~/.ilse/token`. For Claude Desktop the block uses `ilse-mcp`, a small bridge to the running Ilse.

## Which Claude account Ilse uses

Claude Code keeps one login per configuration directory (`CLAUDE_CONFIG_DIR`), so a machine can hold a personal and a work account side by side. Ilse finds the logged-in ones (`~/.claude`, any `~/.claude-*`, and directories your shell profile sets) and, when there is more than one, asks which to use in this project:

```
Which Claude account should Ilse use in this project?
● you@gmail.com · Pro                     ~/.claude
○ you@company.com · Team (Company)        ~/.claude-company
```

The choice is saved per project in `~/.ilse/config.json` (never in the repo) and shown in the startup line and the toolbar settings. `ilse-design --account` asks again. To add an account, log in once with its own directory: `CLAUDE_CONFIG_DIR=~/.claude-work claude`.

## On your app's own port: Vite plugin

With `--separate`, the proxy gives your app a second address, `localhost:4700`, and whatever is tied to the original one stays there: the login session saved in the browser, OAuth callbacks, links in emails. With the Vite plugin the toolbar comes from your dev server itself, so you keep working on your usual address.

```bash
npm install -D ilse-design
```

```ts
// vite.config.ts
import { ilse } from "ilse-design/vite";

export default defineConfig({
  plugins: [react(), ilse()],
});
```

Run `ilse-design` as usual: it sees the toolbar is already on the page, skips the proxy and gives you your dev server's address.

- Only in `vite dev` — a production build never includes it.
- The toolbar is fetched from the running `ilse`, so it always matches the CLI. While `ilse` isn't running, the page loads an empty script and Vite says so once; start `ilse` and reload.
- `ilse({ port: 4748 })` if Ilse runs on another port (the startup line shows `ws://localhost:<port>`).
- To have it only when you ask for it, guard it: `plugins: [react(), ...(process.env.ILSE ? [ilse()] : [])]`.

**Without adding the package** — a monorepo, or a project that shouldn't depend on Ilse — the same takes a few lines in `vite.config.ts`, pointing at the running `ilse` (port 4747):

```ts
import type { Plugin } from "vite";

const ilseToolbar: Plugin = {
  name: "ilse-toolbar",
  apply: "serve",
  transformIndexHtml: () => [{ tag: "script", attrs: { src: "/__ilse/toolbar.js", defer: true }, injectTo: "body" }],
};

export default defineConfig({
  plugins: [react(), ilseToolbar],
  server: { proxy: { "/__ilse": "http://127.0.0.1:4747" } },
});
```

Keep the script on your app's own address, as above, rather than loading `http://localhost:4747/__ilse/toolbar.js` directly: a service worker (MSW, PWAs) can drop requests to another local port.

## Any local page: bookmarklet or Chrome extension

No proxy and nothing in the project, not even a dev dependency: your browser puts the toolbar on the page, on your usual address. Any framework.

**Bookmarklet.** With `ilse-design` running, open `http://localhost:4747/__ilse/bookmarklet` and drag the button to your bookmarks bar (`ilse-design bookmarklet` prints the link and the code). On your app's page, click the bookmark. A full reload takes the toolbar away; click again.

**Chrome extension** *(experimental — not on the Chrome Web Store yet, tested in automated runs only)*. Turns the toolbar on per site and brings it back on every reload. Load it once:

1. Find the folder. With Ilse installed globally (`npm install -g ilse-design@latest`), it's inside the package — print its path with:
   ```bash
   echo "$(npm root -g)/ilse-design/extension"
   ```
   Or use the `extension/` folder of a clone of this repository.
2. In Chrome, open `chrome://extensions`, turn on *Developer mode*, click *Load unpacked* and pick that folder.
3. On your app's page, with `ilse` running, click the Ilse icon — the badge says **ON**. Click again to turn it off.

After updating Ilse, click *Reload* on the extension's card in `chrome://extensions` to pick up the new version.

Both only work on `localhost` pages. They fetch the toolbar from the running `ilse` and run it in the page without a network request, so a service worker (MSW, PWAs) can't drop it. A page with a strict Content-Security-Policy can still block them; use the proxy there, which removes that header.

## Without the proxy: `<Ilse />` in your layout

If the proxy gets in the way and your app isn't on Vite — for example, auth callbacks bound to your dev port in Next.js:

```bash
npm install -D ilse-design
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

It renders nothing in production. Run `ilse-design` as usual and it skips the proxy.

Older versions of Ilse always wrote `<Ilse />` into the layout. So when it finds one it didn't mark as your choice, Ilse removes it and uses the toolbar without touching the project. To keep yours, run once with `--inject` (remembered in `.git/ilse/state.json`, outside the project's files).

## Compatibility

| Framework | Status |
|---|---|
| Next.js 13+ (App & Pages Router) | ✓ tested on 15 and 16 |
| Vite + React | ✓ tested on Vite 7 / React 19 |
| Create React App, Remix, Astro + React | should work, not re-tested |

| Agent | How Ilse uses it |
|---|---|
| Claude Code | runs `claude -p` (automatic) or via MCP |
| Codex, Cursor CLI, Gemini CLI | runs the CLI (automatic), not yet tested end to end |
| Anything else | clipboard |
