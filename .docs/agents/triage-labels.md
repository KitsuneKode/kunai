---
status: current
lastReviewed: "2026-10-02"
---

# Triage Labels

> Agent-facing (L3). Never linked from published docs. Users: see `docs/users/`.

The skills speak in terms of five canonical triage roles. This file maps those roles to the actual label strings used in this repo's issue tracker.

| Canonical role    | Label in this tracker | Meaning                                  |
| ----------------- | --------------------- | ---------------------------------------- |
| `needs-triage`    | `needs-triage`        | Maintainer needs to evaluate this issue  |
| `needs-info`      | `needs-info`          | Waiting on reporter for more information |
| `ready-for-agent` | `ready-for-agent`     | Fully specified, ready for an AFK agent  |
| `ready-for-human` | `ready-for-human`     | Requires human implementation            |
| `wontfix`         | `wontfix`             | Will not be actioned                     |

When a skill mentions a role (e.g. "apply the AFK-ready triage label"), use the corresponding label string from this table. Every role maps to a label of the same name here; verified against `gh label list` on 2026-09-03.

Beyond the triage roles, type labels exist alongside them — notably `type:security` ("Security hardening") for non-sensitive hardening issues. Actual vulnerabilities never go through the tracker: they are reported privately via GitHub security advisories (see `SECURITY.md`), so `type:security` is for public-safe work like dependency pinning or header hardening.
