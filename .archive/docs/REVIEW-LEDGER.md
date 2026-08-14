# `.docs/` review ledger

**Status:** Review only — no files were removed in this pass. One stale intro line in `providers.md` was corrected.

## Recommended remove or archive

| File                                      | Why                          | Action                               |
| ----------------------------------------- | ---------------------------- | ------------------------------------ |
| `.docs/KUNAI_ARCHITECTURE.md`             | Duplicates architecture docs | Merge into `architecture.md`, remove |
| `.docs/product-prd-v2.md`                 | Overlaps `product-prd.md`    | Pick one canonical PRD               |
| `.docs/launch-redesign-spec.md`           | Superseded                   | Archive                              |
| `.docs/cli-shell-redesign-workbook.md`    | Superseded                   | Archive                              |
| `.docs/coherence-audit-handoff-prompt.md` | One-shot agent prompt        | Archive                              |
| `.docs/bugs.md`                           | Stale bug dump               | Archive or link to GitHub issues     |
| `.docs/brainstorms/*.md`                  | Idea parking lot             | Move to `.plans/brainstorms/`        |
| `.docs/provider-examples.md`              | Legacy paths                 | Rewrite or archive                   |
| `.docs/subtitle-resolver-analysis.md`     | Research scratchpad          | Archive                              |

## Fixed in this pass

| File                 | Fix                                                                                                             |
| -------------------- | --------------------------------------------------------------------------------------------------------------- |
| `.docs/providers.md` | Intro now lists `videasy`, `vidlink`, `rivestream`, `allmanga`, `miruro` (not `vidking` as a production module) |

## Recommended fix (still open)

| File                                      | Issue                                                       |
| ----------------------------------------- | ----------------------------------------------------------- |
| `.docs/quickstart.md`                     | Overlaps `docs/users/getting-started` — add banner or align |
| `.docs/release-reliability-gate.md`       | Document videasy alias for live test names                  |
| `.docs/provider-dossiers/usage-matrix.md` | Verify against current registered providers                 |

## Published to end users (replaces `../../.docs/` links)

| Source                           | Published target                                                                     |
| -------------------------------- | ------------------------------------------------------------------------------------ |
| `cli-reference.md`               | `docs/users/cli-reference.mdx`                                                       |
| `diagnostics-guide.md`           | Excerpt in `docs/users/diagnostics-and-reporting.md` (full deep-dive optional later) |
| `download-offline-onboarding.md` | `docs/users/downloads-and-offline.md`                                                |

## Keep as agent-only

`architecture.md`, `engineering-guide.md`, `testing-strategy.md`, `debugging-map.md`, `diagnostics-guide.md`, `providers.md`, `provider-intake.md`, `ux-architecture.md`, `design-system.md`, and related deep references.

Full table: docs truth plan Appendix B.
