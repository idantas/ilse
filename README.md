<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/idantas/ilse/main/.github/assets/logo-ilse-dark.svg">
    <img src="https://raw.githubusercontent.com/idantas/ilse/main/.github/assets/logo-ilse.svg" alt="Ilse" width="220">
  </picture>
</p>

<p align="center"><b>English</b> · <a href="https://github.com/idantas/ilse/blob/main/LEIAME.md">Português</a></p>

**Improve your app's interface in the browser, with your own coding agent.**

You open your app in the browser, point at what's wrong and say how it should be — or adjust it right there. Your AI coding agent changes the code. You see the result on the page, and keep it or undo it.

> **Side project, in beta.** For whoever shapes the interface — designer, frontend developer, PM — working on the real app with a coding agent. Free to use, with the code open to read.

## What you can do

- **Point and say.** Click an element, select a piece of text or draw an area, and write what should change: *"more space between the cards"*, *"this title should be stronger"*.
- **Adjust it yourself.** A property panel: size, position, layout, spacing, typography, colors, borders, effects. You see the change live before sending it.
- **Change a component's props.** Select a component and the panel shows its props and variants, read from your code. Pick another variant and Ilse rewrites it in the code — no AI.
- **Edit text, duplicate and remove things.** Retype a text right in the panel, duplicate an element (a list row becomes a new item in its data), or remove it.
- **Move things around.** Drag to reorder, move into or out of a container, resize.
- **Draw it.** Sketch on the page with the pencil, or paste a screenshot as a reference.
- **See your components.** The Library lists the components your project already has: search them, see where each one is on the page.
- **Write your design system.** *Create design system* (or `ilse ds`) writes your components and tokens to `.ilse/ds/DESIGN.md`, from the code, no AI. *Add to AGENTS.md* points any agent at it, with or without Ilse running.
- **Undo anything.** ⌘Z puts the code back exactly as it was, even after restarting Ilse. No need to ask the AI to revert.
- **Keeps the page and CI working.** After each change Ilse runs your project's typecheck and the tests that cover it; what the change broke, the agent fixes before it's called done. New errors on the page show up with *Ask for a fix* and *Undo*.

## What you need

- A **React** project that runs on your computer (Next.js, Vite…).
- An **AI coding agent** installed and logged in: [Claude Code](https://claude.com/claude-code), Codex, Cursor CLI or Gemini CLI.

Ilse uses *your* agent and *your* account. It has no account, key or server of its own, and nothing leaves your machine.

## Try it

In your project's folder — no need to start the app first — run:

```bash
npx ilse-design@latest
```

Ilse is on npm as [`ilse-design`](https://www.npmjs.com/package/ilse-design) and needs Node.js 18 or newer. `@latest` makes sure you get the newest version, even if an older one is installed on your machine.

Ilse starts your dev server (`npm run dev`) behind itself and opens your app at its usual address — `http://localhost:3000`, or whatever port it uses — with the toolbar on top. Logins, SSO and callbacks keep working. The first run asks a few questions and takes about a minute. Next time, just `ilse` if you [installed it](https://github.com/idantas/ilse/blob/main/docs/reference.md#install).

Prefer to run the dev server yourself? `--separate` opens Ilse on its own address, `localhost:4700`. More ways: the [Vite plugin](https://github.com/idantas/ilse/blob/main/docs/reference.md#on-your-apps-own-port-vite-plugin), the [bookmarklet or the Chrome extension (experimental)](https://github.com/idantas/ilse/blob/main/docs/reference.md#any-local-page-bookmarklet-or-chrome-extension).

Not comfortable with the terminal? Ask your agent: *"Install and run Ilse in this project — see https://github.com/idantas/ilse"*.

## What it costs

Ilse runs on your agent's plan, so it uses that plan's limits. It always picks the cheapest way that works:

- **Panel adjustments** that map to a class in your code are made by Ilse itself — no AI, instant, nothing from your plan.
- **Small requests** go to a fast, cheaper model: a few seconds.
- **Bigger ones** (new screens, structure) go to the full agent — the most expensive step, so it's used only when needed.

## Go deeper

- [How it works](https://github.com/idantas/ilse/blob/main/docs/how-it-works.md) — how Ilse finds the code, the cost ladder, models, safety checks, usage limits, undo and commits.
- [Reference](https://github.com/idantas/ilse/blob/main/docs/reference.md) — commands, settings, connecting your agent over MCP, logs, compatibility.
- [Free × Pro](https://github.com/idantas/ilse/blob/main/docs/free-vs-pro.md) — what's free and what comes with Ilse Pro (test mode, journeys).
- [AGENTS.md](https://github.com/idantas/ilse/blob/main/AGENTS.md) — for contributors and their agents.

## Why "Ilse"

AI took away much of the work of writing interface code, but craft still needs human judgment. Ilse puts that judgment next to the agent: you point at what's wrong, the agent fixes it, you approve.

> "Design is a tool for improving humanity." — Ilse Crawford

## Contributing

Issues and pull requests are welcome — see [CONTRIBUTING.md](https://github.com/idantas/ilse/blob/main/CONTRIBUTING.md). Security problems go privately: [SECURITY.md](https://github.com/idantas/ilse/blob/main/SECURITY.md).

[PolyForm Shield 1.0.0](https://github.com/idantas/ilse/blob/main/LICENSE): free to use, change and share — just not to build a product that competes with Ilse. Versions up to 0.5.1 were MIT; see [NOTICE](https://github.com/idantas/ilse/blob/main/NOTICE).
