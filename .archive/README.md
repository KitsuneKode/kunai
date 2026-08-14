# Archive — no authority

Everything under `.archive/` is **history**. It records what was believed or
planned at a point in time. It does not describe how Kunai works now.

**Never cite a file in this folder as current behavior.** If an archived doc
disagrees with the tree, the tree is right and the archived doc is simply old —
it is not a bug to fix here. Fix the live doc instead.

This folder is excluded from agent indexes (`.claudeignore`, `.cursorignore`)
and is not walked by the doc verifiers. Its paths are expected to be stale.

## What is here

| Folder            | Was                 | Holds                                             |
| ----------------- | ------------------- | ------------------------------------------------- |
| `docs/`           | `.docs/archive/`    | Superseded agent subject docs                     |
| `plans/`          | `.plans/archive/`   | Landed and superseded roadmap plans               |
| `numbered-plans/` | `plans/archive/`    | Completed external-audit plans                    |
| `superpowers/`    | `docs/superpowers/` | The closed SDD wave — specs and plans             |
| `legacy/`         | `archive/legacy/`   | Verified-dead runtime modules, kept for reference |

`legacy/` is code, not prose. Nothing active imports it, and
`apps/cli/test/unit/architecture/boundary-imports.test.ts` fails if anything
starts to.

## Where current truth lives

| Looking for          | Read                                              |
| -------------------- | ------------------------------------------------- |
| Unfinished work      | [`.plans/roadmap.md`](../.plans/roadmap.md)       |
| How the system works | [`.docs/`](../.docs/) — start at `feature-map.md` |
| Domain vocabulary    | [`.docs/glossary.md`](../.docs/glossary.md)       |
| User-facing docs     | [`docs/users/`](../docs/users/)                   |

## Adding to the archive

Move a plan or doc here in the **same change set** that finishes or supersedes
its core. Transfer any verified residue to one open row on the roadmap first —
never leave a landed checklist active merely because unchecked boxes remain.
