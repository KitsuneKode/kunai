# Kunai internal docs

Agent- and contributor-facing. How the system works and why. User-facing docs
live in [`docs/`](../docs/) and ship on the site; nothing here is linked from
there.

**The code wins.** When a doc disagrees with the tree, the tree is right and the
doc is the bug — fix it in the same change set. Vocabulary is
[glossary.md](./glossary.md).

Read the one or two files your change touches. Do not read this directory
end to end.

## Start here

| Question                                    | File                                                 |
| ------------------------------------------- | ---------------------------------------------------- |
| Where does feature X live?                  | [feature-map.md](./feature-map.md)                   |
| How does playback actually flow?            | [architecture.md](./architecture.md)                 |
| Which layer or package does this belong in? | [runtime-boundary-map.md](./runtime-boundary-map.md) |
| What do we call this?                       | [glossary.md](./glossary.md)                         |

## Subsystems

| Subject                                     | File                                                                                                                                                     |
| ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Provider contract, resolve, fallback, relay | [providers.md](./providers.md)                                                                                                                           |
| Adding or hardening a provider              | [provider-intake.md](./provider-intake.md) · [provider-agent-workflow.md](./provider-agent-workflow.md) · [provider-examples.md](./provider-examples.md) |
| Provider health, cache layers, reset        | [title-provider-health-and-cache-reset.md](./title-provider-health-and-cache-reset.md)                                                                   |
| Source, quality, audio, subtitle inventory  | [playback-source-inventory-contract.md](./playback-source-inventory-contract.md)                                                                         |
| IntroDB/AniSkip, MAL resolution, auto-skip  | [playback-timing-and-aniskip.md](./playback-timing-and-aniskip.md)                                                                                       |
| mpv reconnect on the persistent session     | [mpv-in-process-reconnect.md](./mpv-in-process-reconnect.md)                                                                                             |
| Shell flow, hotkeys, overlays, setup UX     | [ux-architecture.md](./ux-architecture.md) · [keybindings.md](./keybindings.md)                                                                          |
| Terminal styling and interaction patterns   | [design-system.md](./design-system.md) · [ui-redesign-playbook.md](./ui-redesign-playbook.md)                                                            |
| Poster previews, Kitty/iTerm2/Sixel         | [poster-image-rendering.md](./poster-image-rendering.md)                                                                                                 |
| `/discover` and recommendations             | [recommendations-and-discover.md](./recommendations-and-discover.md)                                                                                     |
| Share URLs, `/share`, `/watch`, `--open`    | [share-links.md](./share-links.md)                                                                                                                       |
| Discord presence and social status          | [presence-integrations.md](./presence-integrations.md)                                                                                                   |
| Download, offline library, onboarding       | [download-offline-onboarding.md](./download-offline-onboarding.md)                                                                                       |
| AniList/TMDB sync, the outbox, tracker auth | [tracker-sync.md](./tracker-sync.md)                                                                                                                     |

## Contracts and policy

| Subject                               | File                                                             |
| ------------------------------------- | ---------------------------------------------------------------- |
| Analytics consent, payload, redaction | [analytics-privacy-contract.md](./analytics-privacy-contract.md) |
| Lint rules and the anti-slop advisory | [lint-policy.md](./lint-policy.md)                               |
| Release gating                        | [release-reliability-gate.md](./release-reliability-gate.md)     |
| Decisions of record                   | [adr/](./adr/)                                                   |

## Working on it

| Subject                                      | File                                               |
| -------------------------------------------- | -------------------------------------------------- |
| Broad refactors, service extraction, caching | [engineering-guide.md](./engineering-guide.md)     |
| Tests, test seams, new runtime behaviours    | [testing-strategy.md](./testing-strategy.md)       |
| Debug logs, diagnostics panels, tracing      | [diagnostics-guide.md](./diagnostics-guide.md)     |
| Broad reliability or debugging sweeps        | [debugging-map.md](./debugging-map.md)             |
| CI, Husky, lint-staged, templates            | [repo-infrastructure.md](./repo-infrastructure.md) |
| Setup, local run flow, troubleshooting       | [quickstart.md](./quickstart.md)                   |
| Local UI prototype harnesses                 | [prototypes.md](./prototypes.md)                   |

## Directories

| Folder                                                | Holds                                            |
| ----------------------------------------------------- | ------------------------------------------------ |
| [features/](./features/)                              | Per-feature product rules                        |
| [provider-dossiers/](./provider-dossiers/)            | Per-provider research and runtime detail         |
| [agents/](./agents/)                                  | Issue tracker, triage labels, domain conventions |
| [adr/](./adr/)                                        | Decisions of record, sequentially numbered       |
| [research/](./research/) · [templates/](./templates/) | Raw research; doc templates                      |

## Parked

[architecture-v2.md](./architecture-v2.md) records the direction for web,
desktop, daemon, and cache surfaces so it is not re-derived. Parked, not
scheduled.
