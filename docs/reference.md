# Reference

**English** · [Português](reference.pt-BR.md) · [← README](../README.md)

## Install

Run it without installing:

```bash
npx github:idantas/ilse
```

Ilse isn't on npm yet, so this installs straight from GitHub and builds on the first run. To keep the command around, install it once — in two steps, because npm can't build a package during a global install from git:

```bash
npm pack git+https://github.com/idantas/ilse.git   # builds the package from GitHub
npm install -g ./ilse-design-*.tgz                  # installs it as `ilse` / `ilse-design`
```

## Modes

The first run asks how Ilse should hand annotations to your agent:

- **Automatic** (recommended): Ilse calls your agent. Nothing to paste.
- **From your agent's chat (MCP)**: your agent pulls the annotations — see [Connect your agent](#connect-your-agent-mcp).
- **Clipboard**: Ilse copies each annotation and you paste it anywhere.

## The toolbar

### Point and adjust

- **3 ways to point:** click an element, select text, or draw an area.
- **Select the parent:** the ↰ button on the note card moves the selection up to the containing element (library wrappers of the same size are skipped). A click inside an SVG selects the whole `<svg>`; ⌘-click (Ctrl-click) selects the exact element, such as one path of an icon.
- **Property panel:** text, layout (width/height as Fixed · Hug · Fill, flow, alignment, gap, padding and margin per side), typography, colors, stroke, radius and opacity — with your project's scale and tokens.
- **None:** spacing, radius and stroke-weight lists start with *None* (zero) — no padding, square corners, no stroke.
- **Stroke:** *+* adds one and shows its color, weight, style and sides; *−* takes it away.
- **Apply to — only this one or all:** when the element belongs to a component repeated on the page. With *All · N*, panel edits preview on every instance at once.
- **Edit text:** text elements get a *Text* field at the top of the panel. Text that comes from a variable, prop or translation goes to the agent, which changes it at the source.
- **Remove an element:** *Remove element* at the bottom of the panel, or the Delete key (fn+⌫ on a Mac) while the note is empty — ⌫ works once focus is out of the note. From a `.map` list, only that item goes unless *Apply to* says all.
- **Move for real:** drag to reorder, or into and out of containers; the page re-flows live.
- **Resize:** drag the handles, with snap-to-grid.
- **Pencil:** sketch on the page; the strokes are read and sent along.
- **Reference images:** paste or upload a screenshot or SVG.

### Review the page

- **Scan:** checks the whole page and lists design issues by category — contrast, typography, spacing, accessibility, components. Hover an issue to see where it is.
- **Suggestions for one element:** the glasses button on the card shows that element's issues. *Fix all suggestions* sends them as one request; *Review with AI* runs your agent to review reuse, consistency and tokens (uses your account).

### Toolbar and settings

- **Run:** sends the pending annotations together. **Stop:** interrupts the agent; annotations go back to pending.
- **Live progress:** see each fix land as the agent works.
- **Pause animations:** freeze tooltips, toasts and dropdowns to annotate them.
- **Hide markers:** hide the annotation dots on the page.
- **Clear annotations:** removes them all (click twice to confirm).
- **Settings:** connection and annotation status, the Claude account in use, **Design System** (paste a W3C `tokens.json` when Ilse doesn't find your tokens), **Snap to grid**, **Language** (English / Portuguese, detected automatically), **Connect agent** (MCP) and **Logs**.

Every prompt carries `ilse · annotation <id> · <Component> · <file>`, so past fixes are searchable in your agent's history.

## CLI

```bash
ilse-design                 # find the dev server, open the proxy (skipped with the Vite plugin), listen
ilse-design --target 3000   # dev server port, if auto-detection misses it
ilse-design --proxy-port 4800
ilse-design --no-open       # don't open the browser
ilse-design --mode mcp      # MCP mode for this run only
ilse-design --inject        # put <Ilse /> in your layout instead of using the proxy
ilse-design --reset         # choose the mode again
ilse-design --account       # choose again which Claude account this project uses
ilse-design changes         # what Ilse changed that isn't committed yet
ilse-design bookmarklet     # the bookmarklet that puts the toolbar on any local page
```

These assume a global install. Without it, use `npx github:idantas/ilse` instead of `ilse-design`. The command is also available as `ilse`.

**Environment switches**, mostly for comparing runs:

| Variable | Effect |
|---|---|
| `ILSE_DEBUG=1` | Show prompts, models, token usage and cache hits per run |
| `ILSE_MODEL=<model>` | One model for everything |
| `ILSE_QUICK=0` | No quick step |
| `ILSE_HISTORY=0` | No Ilse history in the prompt |
| `ILSE_COMPONENT_CARD=0` | No component card |
| `ILSE_RESUME=1` | Resume the agent session between batches |
| `ILSE_AGENT_USER_CONTEXT=1` | Let the agent load your personal `CLAUDE.md` and memory |

## Logs

Toolbar → Settings → **Logs** copies the session journal as Markdown or JSON (also saved in `~/.ilse/logs/`). For every annotation: the path it took (no-AI swap, quick, agent or MCP, and the model), whether it was located, how long you spent composing it, a timeline (queued → agent started → first edit → resolved), whether you undid it, and per agent run the turns, tools, tokens and cost.

It never records your note text, prompts, code or file paths.

## Connect your agent (MCP)

To work from your agent's chat (Claude Desktop, Claude Code, Cursor…): run `ilse-design --mode mcp`, open the toolbar settings → **Connect agent**, copy the block for your agent and paste it into its MCP settings.

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

The proxy gives your app a second address, `localhost:4700`, and whatever is tied to the original one stays there: the login session saved in the browser, OAuth callbacks, links in emails. With the Vite plugin the toolbar comes from your dev server itself, so you keep working on your usual address.

```bash
npm install -D github:idantas/ilse
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

**Chrome extension.** Turns the toolbar on per site and brings it back on every reload. Load it once: `chrome://extensions` → *Developer mode* → *Load unpacked* → the `extension/` folder of this repo. Then, on your app's page, click the Ilse icon — the badge says **ON**. Click again to turn it off.

Both only work on `localhost` pages. They fetch the toolbar from the running `ilse` and run it in the page without a network request, so a service worker (MSW, PWAs) can't drop it. A page with a strict Content-Security-Policy can still block them; use the proxy there, which removes that header.

## Without the proxy: `<Ilse />` in your layout

If the proxy gets in the way and your app isn't on Vite — for example, auth callbacks bound to your dev port in Next.js:

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

It renders nothing in production. Run `ilse-design` as usual and it skips the proxy.

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
