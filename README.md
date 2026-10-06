<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset=".github/assets/logo-ilse-dark.svg">
    <img src=".github/assets/logo-ilse.svg" alt="Ilse" width="220">
  </picture>
</p>

<p align="center"><b>English</b> · <a href="README.pt-BR.md">Português</a></p>

**The designer's eye inside the code agent.**

You open your app in the browser, point at what's wrong and say how it should be — or adjust it right there, like in Figma. Your AI coding agent changes the code. You see the result on the page, and keep it or undo it.

> **Side project, in beta.** Made by a designer, for designers who work with code agents. Free and open source.

## What you can do

- **Point and say.** Click an element, select a piece of text or draw an area, and write what should change: *"more space between the cards"*, *"this title should be stronger"*.
- **Adjust it yourself.** A property panel like Figma's: size, layout, spacing, typography, colors, borders. You see the change live before sending it.
- **Edit text and remove things.** Retype a text right in the panel, or remove an element.
- **Move things around.** Drag to reorder, move into or out of a container, resize.
- **Draw it.** Sketch on the page with the pencil, or paste a screenshot as a reference.
- **Undo anything.** ⌘Z puts the code back exactly as it was. No need to ask the AI to revert.

## What you need

- A **React** project that runs on your computer (Next.js, Vite…).
- An **AI coding agent** installed and logged in: [Claude Code](https://claude.com/claude-code), Codex, Cursor CLI or Gemini CLI.

Ilse uses *your* agent and *your* account. It has no account, key or server of its own, and nothing leaves your machine.

## Try it

In your project's folder, with the app running (`npm run dev`), open a second terminal and run:

```bash
npx github:idantas/ilse
```

Ilse opens your app at **http://localhost:4700** with its toolbar on top. Work there instead of your usual address. The first run asks a couple of questions and takes about a minute.

Rather stay on your usual address (logins and callbacks tied to it)? In Vite projects, use the [Vite plugin](docs/reference.md#on-your-apps-own-port-vite-plugin); in any project, the [bookmarklet or Chrome extension](docs/reference.md#any-local-page-bookmarklet-or-chrome-extension).

Not comfortable with the terminal? Ask your agent: *"Install and run Ilse in this project — see https://github.com/idantas/ilse"*.

## What it costs

Ilse runs on your agent's plan, so it uses that plan's limits. It always picks the cheapest way that works:

- **Panel adjustments** that map to a class in your code are made by Ilse itself — no AI, instant, nothing from your plan.
- **Small requests** go to a fast, cheaper model: a few seconds.
- **Bigger ones** (new screens, structure) go to the full agent — the most expensive step, so it's used only when needed.

## Go deeper

- [How it works](docs/how-it-works.md) — how Ilse finds the code, the cost ladder, models, safety checks, usage limits, undo and commits.
- [Reference](docs/reference.md) — commands, settings, connecting your agent over MCP, logs, compatibility.
- [AGENTS.md](AGENTS.md) — for contributors and their agents.

## Why "Ilse"

AI freed designers from the execution bottleneck, but craft still needs human judgment. Ilse is the designer's eye inside the agent: you point at what's wrong, the agent fixes it, you approve.

> "Design is a tool for improving humanity." — Ilse Crawford

## Contributing

Issues and pull requests are welcome — see [CONTRIBUTING.md](CONTRIBUTING.md). Security problems go privately: [SECURITY.md](SECURITY.md).

MIT license — see [LICENSE](LICENSE).
