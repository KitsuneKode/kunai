# Repo Infrastructure Design

Date: 2026-05-07  
Status: Approved

## Scope

Improve CI visibility, add local developer guardrails, and polish contribution entry points. Binary publishing is explicitly deferred until after beta v1 ships.

---

## 1. CI Workflows

### `pr-ci.yml` — runs on every pull request

Four parallel jobs, then a build gate:

```
typecheck ─┐
lint      ─┤→ build (needs all four)
fmt       ─┤
test      ─┘
```

Each job:
1. `actions/checkout@v4`
2. `oven-sh/setup-bun@v2` (version from `package.json`)
3. `bun install --frozen-lockfile`
4. Its specific `turbo run <task>` command

Build job runs `turbo run build` only after all four pass.

Turborepo remote caching enabled on all jobs via `TURBO_TOKEN` and `TURBO_TEAM` repo secrets. Warm-cache runs skip unchanged package tasks entirely.

```yaml
permissions:
  contents: read
```

Concurrency group cancels in-progress runs on new pushes to the same PR branch.

### `ci.yml` — runs on push to main (gates the release workflow)

Stays simple and sequential:

```
verify (typecheck + lint + fmt + test) → build
```

This is the gate that the `release.yml` workflow depends on. No need to split jobs here — failures on main are investigated, not triaged by category.

Turborepo remote caching enabled here too (same secrets, shared cache with PR runs).

```yaml
permissions:
  contents: read
```

### `release.yml` — unchanged

Already correct: changesets action with OIDC publish, `id-token: write`, npm provenance. No changes needed.

---

## 2. Local DX — Husky + lint-staged

### Packages

Add to workspace root `package.json` devDependencies:
- `husky`
- `lint-staged`

### Hook files

`.husky/pre-commit` — runs lint-staged (fast, staged-only):
```sh
bunx lint-staged
```

`.husky/pre-push` — runs full test suite:
```sh
bun run test
```

### lint-staged config

In root `package.json`:
```json
"lint-staged": {
  "**/*.{ts,tsx}": ["oxlint", "oxfmt --write"],
  "**/*.{json,md}": ["oxfmt --write"]
}
```

Only staged files are touched — committing one file in `apps/cli` does not reformat `packages/providers`.

### Auto-install

Add to root `package.json` scripts:
```json
"prepare": "husky"
```

`bun install` installs hooks automatically for any contributor who clones the repo.

---

## 3. PR Template

`.github/pull_request_template.md`:

```markdown
## What changed
<!-- One sentence. -->

## Checklist
- [ ] Changeset added (`bun run changeset`) — or N/A for docs/infra/no-release changes
- [ ] `bun run typecheck && bun run lint && bun run fmt` passes locally
- [ ] Tests pass or new tests added for new behavior
```

The changeset line prevents "why didn't this release?" mysteries. The N/A escape hatch keeps it honest for non-release PRs.

---

## 4. Issue Template Polish

`config.yml` — add a link to `CONTRIBUTING.md` so contributors see it before filing:

```yaml
contact_links:
  - name: Contributing guide
    url: https://github.com/kitsunekode/kunai/blob/main/CONTRIBUTING.md
    about: How to set up, what to work on, and how to open a good PR.
```

No new templates — the existing three (bug, feature, provider) cover all real cases.

---

## Setup Requirements

Before the release workflow can use Turborepo remote caching, add these to GitHub repo secrets:
- `TURBO_TOKEN` — from vercel.com/account/tokens (free Vercel account)
- `TURBO_TEAM` — your Vercel team slug

npm Trusted Publishing (OIDC) for the release workflow is documented in `RELEASING.md`.

---

## What Is Not In Scope

- Pre-built Linux/macOS binaries — deferred until after beta v1 ships
- Branch protection rule configuration — done in GitHub repo settings, not in code
- Typecheck in pre-commit hook — too slow (15–30s), CI-only
