# Plan 002: Bind free-text `workflow_dispatch` inputs via `env:` instead of interpolating them into `run:`

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan in
> `advisor-plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat faf1afd22..HEAD -- .github/workflows/release.yml .github/workflows/provider-matrix.yml`
> If either file changed since this plan was written, compare the "Current
> state" excerpts against the live file before proceeding; on a mismatch,
> treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: security
- **Planned at**: commit `faf1afd22`, 2026-10-09

## Why this matters

Two workflows interpolate free-text `workflow_dispatch` inputs directly into
a shell `run:` block. Anyone with **write access** who can trigger a
`workflow_dispatch` can therefore execute arbitrary shell in a workflow that
runs from the default branch — without merging a workflow change, which is
normally the code-execution precondition protected by branch review. In
`release.yml` the affected job carries `id-token: write` +
`attestations: write` and inherits workflow-level `TURBO_TOKEN`, so the
concrete exposure is token exfiltration and OIDC minting from a privileged
job. This is defense-in-depth (write access is required; no fork/PR path
exists), and GitHub's own guidance is to pass inputs through `env:`. The fix
is a mechanical two-site change.

An audit on 2026-10-09 grepped every `${{ inputs.* }}` /
`${{ github.event.inputs.* }}` occurrence in `.github/workflows/` — 9 hits
total; only the 2 below land inside `run:` strings. The others are YAML
`env:`/`with:` values, which do not re-enter the shell expanded. Keep it that
way.

## Current state

- `.github/workflows/release.yml` — free-text input declared at lines 41-45:

```yaml
workflow_dispatch:
  inputs:
    version:
      description: Exact @kitsunekode/kunai version to build and publish (e.g. 0.3.0)
      required: true
      type: string
```

Workflow-level env includes `TURBO_TOKEN: ${{ secrets.TURBO_TOKEN }}`
(`release.yml:57-59`). The `candidate` job grants
`id-token: write` / `attestations: write` (`release.yml:112-116`). The
offending step (lines ~151-165):

```yaml
- name: Check dispatch version matches package.json
  id: ver
  run: |
    set -euo pipefail
    EXPECTED="${{ inputs.version }}"
    ACTUAL="$(bun -e 'console.log(require("./apps/cli/package.json").version)')"
    if [[ "$ACTUAL" != "$EXPECTED" ]]; then
      echo "::error::version mismatch: workflow_dispatch=${EXPECTED} package.json=${ACTUAL}"
      exit 1
    fi
```

- `.github/workflows/provider-matrix.yml` — free-text input at lines 12-15
  (`providers`, `type: string` implied), offending step at lines ~60-70:

```yaml
run: |
  set +e
  providers="${{ github.event.inputs.providers }}"
  if [ -n "$providers" ]; then
    # shellcheck disable=SC2086
    bun run test:live:matrix $providers
  else
    bun run test:live:matrix
  fi
```

Note the deliberate word-splitting: `$providers` is a space-separated list
and the `shellcheck disable=SC2086` comment must stay.

- The repo has **no actionlint** (grepped `.github/` + `package.json`:
  zero hits), so verification is grep-based — see Steps.
- `.plans/2026-10-01-r07-build-and-analytics.md` owns a broader
  "pull_request_target / untrusted input handling" review; this plan supplies
  the two concrete instances. Do not edit that plan file.

## Commands you will need

| Purpose                                | Command                                                                                                                                                                                                     | Expected on success                                                                                                                                                                                     |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Find remaining in-shell interpolations | see Step 3 verify                                                                                                                                                                                           | no output                                                                                                                                                                                               |
| Lint                                   | `bun run lint`                                                                                                                                                                                              | exit 0 (17 pre-existing warnings = baseline)                                                                                                                                                            |
| Typecheck                              | `bun run typecheck`                                                                                                                                                                                         | exit 0 (workflows are not typechecked; this is a no-op sanity check)                                                                                                                                    |
| YAML sanity                            | `bun -e 'import("yaml").then(m=>{for(const f of [".github/workflows/release.yml",".github/workflows/provider-matrix.yml"]) m.parse(require("node:fs").readFileSync(f,"utf8")); console.log("parsed ok")})'` | `parsed ok` — if the `yaml` package is not resolvable, use `bunx js-yaml .github/workflows/release.yml > /dev/null && bunx js-yaml .github/workflows/provider-matrix.yml > /dev/null && echo parsed ok` |

## Scope

**In scope** (the only files you should modify):

- `.github/workflows/release.yml`
- `.github/workflows/provider-matrix.yml`

**Out of scope** (do NOT touch, even though they look related):

- Any other workflow or composite action (`.github/actions/**`) — the audit
  confirmed their input usages are `env:`/`with:` positions, not shell.
- `.plans/2026-10-01-r07-build-and-analytics.md` — owned by another track.
- The `set +e` in provider-matrix and the `shellcheck disable=SC2086` —
  deliberate; keep them.
- Job/permissions/triggers structure — this is a binding-style change only.

## Git workflow

- Branch: `advisor/002-workflow-input-binding`
- Commit style: `fix(ci): bind dispatch inputs via env instead of run interpolation`
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: release.yml — bind `inputs.version` through step `env:`

In the `Check dispatch version matches package.json` step, add a step-level
`env` and consume the variable:

```yaml
- name: Check dispatch version matches package.json
  id: ver
  env:
    INPUT_VERSION: ${{ inputs.version }}
  run: |
    set -euo pipefail
    EXPECTED="$INPUT_VERSION"
    ACTUAL="$(bun -e 'console.log(require("./apps/cli/package.json").version)')"
    if [[ "$ACTUAL" != "$EXPECTED" ]]; then
      echo "::error::version mismatch: workflow_dispatch=${EXPECTED} package.json=${ACTUAL}"
      exit 1
    fi
    echo "version=${ACTUAL}" >> "$GITHUB_OUTPUT"
    echo "tag=v${ACTUAL}" >> "$GITHUB_OUTPUT"
```

Keep everything else in the step identical (the two `GITHUB_OUTPUT` lines
already exist — preserve them exactly as in the live file).

**Verify**: `grep -n 'EXPECTED="\${{ inputs' .github/workflows/release.yml` →
no output; `grep -n 'INPUT_VERSION' .github/workflows/release.yml` → shows
the `env:` line and the `EXPECTED="$INPUT_VERSION"` line.

### Step 2: provider-matrix.yml — bind `github.event.inputs.providers` through step `env:`

```yaml
env:
  MATRIX_PROVIDERS: ${{ github.event.inputs.providers }}
run: |
  set +e
  providers="$MATRIX_PROVIDERS"
  if [ -n "$providers" ]; then
    # shellcheck disable=SC2086
    bun run test:live:matrix $providers
  else
    bun run test:live:matrix
  fi
```

Preserve the surrounding step keys (name/uses/etc.) exactly as in the live
file; only add `env:` and change the two lines shown.

**Verify**: `grep -n 'github.event.inputs' .github/workflows/provider-matrix.yml` →
only the `MATRIX_PROVIDERS:` env line matches.

### Step 3: Repo-wide confirmation

Run:

```
grep -rn -B0 '\${{ inputs\.\|\${{ github\.event\.inputs\.' .github/workflows .github/actions 2>/dev/null
```

Then inspect each hit: every one must sit on an `env:`, `with:`, `if:`, or
`uses:` line — **never** inside a `run: |` block. (At `faf1afd22` there were 9
hits total; after your change, the two shell-string hits are gone.)

**Verify**: the command below reports no input-context expansion on a line
that is inside a `run:` block — mechanically:

```
awk '/run: \|/{inrun=1} /^[^ ]/{if(!/^ *run:/) inrun=0} inrun && /\$\{\{ (inputs|github\.event\.inputs)\./ {print FILENAME": "FNR": "$0}' .github/workflows/*.yml
```

→ no output.

### Step 4: YAML parse + gates

Parse both files (command from the table), then run `bun run lint`.

**Verify**: `parsed ok` and lint exit 0.

## Test plan

- No unit tests exist for workflow YAML and none should be added here
  (out of scope; the awk check in Step 3 is the regression net for this
  change). If the operator later wants a permanent gate, that belongs to the
  r07 review track noted above.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `grep -rn '\${{ inputs\.' .github/workflows/release.yml` → only `env:`-position lines
- [ ] `grep -rn 'github.event.inputs' .github/workflows/provider-matrix.yml` → only the `env:`-position line
- [ ] Step 3 awk check → no output
- [ ] Both files parse as YAML
- [ ] `bun run lint` exits 0; `bun run typecheck` exits 0
- [ ] No files outside the in-scope list are modified (`git status`)
- [ ] `advisor-plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- The excerpts don't match the live files (drift since `faf1afd22`).
- Your grep finds a **third** in-`run:` input interpolation site the audit
  missed — report it rather than fixing it unprompted (it may be a different
  trust posture).
- The provider-matrix step's word-splitting behavior changes (e.g. shellcheck
  or CI starts failing on quoting) — revert and report.
- A step's verification fails twice after a reasonable fix attempt.

## Maintenance notes

- Any future workflow that takes a `workflow_dispatch` input must bind it via
  step `env:`; if the r07 track adds an actionlint step, these two files
  should pass it unchanged.
- A reviewer should confirm the scripts behave identically for normal inputs
  (a version string like `0.3.0`, a provider list like `hianime miruro`) —
  the only semantic delta is that shell metacharacters in the input are now
  data, not code. That is the intent.
- Follow-up deferred: a permanent CI check for this pattern (r07's
  untrusted-input review owns it).
