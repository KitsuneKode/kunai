# `.docs/archive/` — finished and superseded documents

Nothing in this folder is current. These files are kept because they explain
_why_ something is the way it is, not _what_ is true now.

**Do not route agents here.** Do not cite a file here as authority for current
behavior. If you need a fact, read the code or the live doc that replaced it.

## What lives here

| Kind                   | Examples                                                                                                 |
| ---------------------- | -------------------------------------------------------------------------------------------------------- |
| Dated one-shot audits  | `audit-mpv-ipc.md`, `audit-airing-episodes.md`, `test-suite-audit.md`                                    |
| Finished release gates | `e2e-regression-matrix.md`, `regression-baseline.md`                                                     |
| Agent handoff prompts  | `coherence-audit-handoff-prompt.md`                                                                      |
| Shipped design specs   | `launch-redesign-spec.md`, `flavor-naming-and-source-inventory-ux.md`                                    |
| Superseded vision/PRDs | `KUNAI_ARCHITECTURE.md`, `product-prd-v2.md`, `product-prd.md`, `experience-overview.md`, `brainstorms/` |
| Pre-rename research    | `subtitle-resolver-analysis.md`, `UNIFIED_PROVIDER_INTELLIGENCE.md`, `provider-integration-guide.md`     |
| Replaced references    | `cli-reference.md`, `execution-flow.md`, `bugs.md`                                                       |

## Where the current truth moved

| Archived                                                            | Current owner                                                                                        |
| ------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `cli-reference.md`                                                  | `docs/users/cli-reference.mdx` (generated from `--help`)                                             |
| `experience-overview.md`, `product-prd*.md`                         | `docs/users/*` for shipped scope; `.plans/kunai-beta-v1-scope-and-contracts.md` for locked decisions |
| `KUNAI_ARCHITECTURE.md`, `brainstorms/`                             | `.docs/architecture.md` (now) and `.docs/architecture-v2.md` (direction)                             |
| `execution-flow.md`                                                 | `.docs/architecture.md` + `.docs/runtime-boundary-map.md`                                            |
| telemetry privacy section of `experience-overview.md`               | `.docs/telemetry-privacy-contract.md`                                                                |
| `provider-integration-guide.md`, `UNIFIED_PROVIDER_INTELLIGENCE.md` | `.docs/providers.md`, `.docs/provider-dossiers/`                                                     |
| `launch-redesign-spec.md`                                           | `.docs/design-system.md`, `.docs/ui-redesign-playbook.md`                                            |

## Rule going forward

A doc moves here when it stops describing current behavior — when the work it
tracked shipped, when its verdict was recorded, or when another doc took over
its subject. Archive rather than delete: the reasoning is worth keeping, the
authority is not.
