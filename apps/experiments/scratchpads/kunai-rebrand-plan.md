# Kunai Rebranding & Monorepo Architecture Plan 🥷✨

## 1. The Rebrand: From `KitsuneSnipe` to `Kunai`
"Kunai" captures the essence perfectly: sharp, fast, lightweight, and precise. It throws away the clunky anime trope and embraces a sleek, mechanical, and stealthy identity suitable for an elite terminal tool.

### Changes to Make:
- **Repo Name:** Rename the GitHub repository to `kunai`.
- **Command Name:** Change the global bin command from `kitsunesnipe` to `kunai`.
  *(Example usage: `kunai watch "one piece"`, `kunai search "matrix"`)*
- **Package.json:** Update `"name": "kunai"`, update author and description.
- **Branding/UI:** Update the Ink shell ASCII art and colors to reflect a sleek, dark, and sharp aesthetic (think grays, deep reds, and pure white).

---

## 2. Playwright in the CLI: Is it light enough?
**Yes!** Using Playwright in a "Hybrid Full-Session" manner is incredibly efficient for our specific use case. 

Here's why it works great:
- We launch **one** persistent, hidden `BrowserContext` in the background when the app starts.
- We do **not** reload pages heavily or launch multiple instances. We use `page.evaluate()` to execute tiny `fetch()` calls directly inside the browser's network layer.
- This costs roughly ~150-250MB of RAM while running. For a modern desktop CLI app (especially one parsing video streams), this is extremely light. 
- It guarantees 100% success against Cloudflare's TLS fingerprinting, which is the biggest hurdle for CLI tools. It is the perfect balance between the speed of a raw fetch and the reliability of a real browser.

---

## 3. The Future: Turborepo / Monorepo Architecture
Moving to a monorepo (like Turborepo) is a fantastic strategic decision. As `Kunai` grows, it will inevitably become more than just a CLI.

### Proposed Architecture:
```text
kunai/
├── apps/
│   ├── cli/            # The main Ink terminal application (what we have now)
│   ├── web/            # A Next.js/Astro frontend (Documentation + Web Player)
│   └── desktop/        # (Future) Tauri/Electron wrapper for the web player
├── packages/
│   ├── scraper-core/   # Our extracted 0-RAM and Hybrid providers (Vidking, Miruro, Anikai)
│   ├── ui-kit/         # Shared UI components (if we share React logic between CLI/Web)
│   └── config/         # Shared TypeScript, ESLint, Prettier configs
```

### Why this is the best direction:
1. **The `scraper-core` Package:** By moving our scrapers into an independent package, we decouple them from the CLI. This means the exact same scraping logic can be used by the CLI, a Discord bot, a Next.js web app, or a mobile app without rewriting code!
2. **The Web Player:** You mentioned making a website to pipe these embed links into a better player. A monorepo makes this incredibly easy. The Next.js app can simply import `scraper-core`, fetch the stream URLs server-side, and pipe them directly to a custom `Video.js` or `Plyr` frontend. 
3. **Docs:** We can spin up an Astro site in `apps/docs` to host all our reverse-engineering playbooks.

### Should we do it soon?
**Yes.** Refactoring into a monorepo is much easier *before* the codebase becomes massive. Since we just finalized the core scraping logic, this is the perfect time to extract it into a package and set up Turborepo.