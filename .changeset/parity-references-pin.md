---
"@kitsunekode/kunai": patch
---

chore(scripts): pin upstream parity references and verify cites against them

`scripts/parity-references.json` records the reference checkout's real
version (`version_number`, since upstream git tags lag it) and
`verify:parity-references` enforces it two ways: semver cites of a reference
in manifests/dossiers must match the pin or carry a full date/historical
wording, and when the local checkout exists its `version_number` must match
the pin. The stale `5.1.2` cites this flagged (hianime manifest, dossier,
client comment) are now `5.1.4`, and the allmanga parity policy no longer
points at `master` for code upstream deleted in v5.0.
