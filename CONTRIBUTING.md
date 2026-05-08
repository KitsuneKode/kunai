# Contributing to Kunai

Kunai is a community-maintained terminal CLI for watching movies, series, and anime. Contributions are welcome — from quick bug fixes to new provider support to platform parity work.

---

## Where to start

Not sure what to pick up? Here are the highest-value areas:

| Area                       | What's needed                                                                              |
| -------------------------- | ------------------------------------------------------------------------------------------ |
| **Provider fixes**         | Providers break when upstream sites change. Reports with diagnostics output help the most. |
| **macOS / Windows parity** | Testing and documenting platform-specific gotchas around mpv and terminal rendering.       |
| **Test coverage**          | Pure functions (formatters, URL builders, cache TTL logic) are undertested.                |
| **Documentation**          | Clearer first-run guidance, install troubleshooting, and terminal compatibility notes.     |
| **Performance / UX**       | Shell rendering polish, load time improvements, hotkey edge cases.                         |

Browse [open issues](https://github.com/kitsunekode/kunai/issues) for specific tasks tagged `good first issue` or `help wanted`.

---

## Development setup

**Requirements:** [Bun](https://bun.sh) and [mpv](https://mpv.io).

```sh
git clone https://github.com/kitsunekode/kunai.git
cd kunai
bun install
```

Run in dev mode:

```sh
bun run dev
```

With a search query pre-filled:

```sh
bun run dev -- -S "Dune"
```

---

## Before opening a PR

Run all checks from the repo root:

```sh
bun run typecheck
bun run lint
bun run fmt
bun run test
```

For CI-equivalent validation:

```sh
bun run ci
bun run build
```

All four checks must pass. If `bun run fmt` makes changes, commit them.

---

## Working on providers

Providers live in `apps/cli/src/services/providers/`. Before touching provider code:

1. Read `.docs/providers.md` for the provider model and constraints.
2. Read `.docs/provider-intake.md` for the research and hardening process.
3. Check `apps/experiments/scratchpads/` for existing capture notes on the provider.

When reporting a provider breakage, always include:

- The provider ID (visible in the source picker)
- Exact command used
- OS and terminal
- Output of `/ export-diagnostics` from inside the shell

---

## Adding a changeset

This project uses [Changesets](https://github.com/changesets/changesets) for versioning.

Add a changeset for any user-facing change (feature, fix, behavior change, deprecation):

```sh
bun run changeset
```

- Select the affected package (usually `@kitsunekode/kunai`).
- Choose the semver bump level: `patch` for fixes, `minor` for new features.
- Write a concise user-facing description.
- Include platform notes when relevant (Linux, macOS, Windows differences).

Skip changesets for internal-only changes that don't affect published artifacts or user behavior.

Commit the generated file in `.changeset/`.

---

## Commit and PR guidance

- Keep PRs focused on one thing — a bug fix, a feature, a doc update.
- Explain the "why" in the PR description, not just the "what".
- Include test updates when behavior changes.
- For release-relevant work, ensure a changeset is present.
- Reference the issue number when closing one (`Closes #123`).

---

## Turborepo notes

- This is a Turborepo monorepo. Run tasks from the repo root, not from package directories.
- Add task scripts in package-level `package.json` files.
- Register tasks in `turbo.json`.
- Keep root scripts as delegators (`turbo run <task>`).

---

## Release automation

- Pushes to `main` run `.github/workflows/release.yml`.
- Changesets action opens/updates a "version packages" PR.
- Merging that PR bumps package versions and updates changelogs.
- A follow-up run publishes to npm and creates GitHub release notes.
- npm publish uses Trusted Publishing (OIDC + provenance).

See `RELEASING.md` for full release-operator details.

---

## Code of conduct

Be direct and kind. Focus feedback on code and behavior, not people. If something isn't working for you in the contribution process, open an issue.
