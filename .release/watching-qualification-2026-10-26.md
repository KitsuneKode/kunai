# Watching candidate integration qualification — October 26, 2026

This is a preliminary qualification record, not merge or publication approval.
The user authorized the integration sequence; its stated gates still apply.
Runtime/artifact source: **763067b91ff3c0ad755987e9b419318cadddf8fe**.
Version: **0.3.0**. The pending Changesets plan proposes **0.4.0** after
integration; no version proposal was applied or publication attempted.

## Review disposition

One independent Antigravity Gemini 3.8 High review covered the combined watching
candidate at 8509853a7. All three actionable subtitle findings were reproduced:

- Repeated external-subtitle picks grew the real mpv inventory from 2 to 4 to 6
  to 8 tracks. Selection now refreshes file-local IDs, selects an existing track
  by ID, or adds only the requested new track with its metadata. Generation
  guards cover acknowledgements. Interactive picks do not emit late-lookup notes.
- Native Off observations left a stale selected subtitle URL. The phase now
  clears that URL while preserving inventory and the session language preference.
- Off with visibility disabled was labeled hidden. Off now takes precedence
  when no track is selected; a selected but invisible subtitle remains hidden.

Each runtime defect has a failing-first regression. Real mpv repeats now keep
2/2/2/2 tracks. A separate real PersistentMpvSession/IPC check proves late English
activation, explicit Off across late attachment, native On and visibility,
replacement observations with unchanged visibility, and a restored resume offset.

The parent also reproduced npm 12 returning keyed pack metadata where npm 11
returns an array. Candidate preparation supports both, requiring exactly one
record and matching map/record identity. Existing package/version/integrity and
artifact-context checks remain. Positive formats and malformed keyed records are
covered; no registry writes or lifecycle scripts were enabled. The release
workflow retains its pinned Node/npm toolchain.

PR668's final CodeRabbit review found one documentation path prefix omission.
The tracked path was verified and corrected in both relevant checkouts; PR668
normal push is 7b9acf451. PR669 retains its documented 3120 KiB development-only
bundle cap; the separate PR668 cap is 3096 KiB. Neither cap changed in this pass.
Public npm launcher limits remain 32 KiB packed / 64 KiB unpacked.

## Fresh local checks

- Forced workspace typecheck: 15 tasks, zero cached, pass.
- Forced workspace tests: **9,660 pass / 62 skip / 0 fail**, 26 tasks, zero cached.
- Forced lint: 14 tasks, zero cached, no errors; existing warnings remain.
- Preflight: anti-slop baseline, doc paths/frontmatter and root formatting pass;
  no baseline, rule, timeout or provider-probe requirement was weakened.
- Doc coverage, parity references and release guard pass.
- Forced bundle/host build: ten tasks, zero cached, pass. Development bundle:
  **3,179,789 bytes**, within the existing 3,194,880-byte cap.
- All ten native targets compiled freshly. Exact **22-file** archive/raw/checksum
  contract passes. Linux compiled smoke: **14 pass**. Installation from the
  exact preserved Linux archive, without raw fallback: **one pass**.
- Eleven npm packages prepared. Exact launcher tarball verification passes.
  Offline candidate install/execute using pinned npm 11: **five pass** through
  the standard CLI test-file harness. Host npm 12's default five-second named
  smoke initially timed out during its many real pack subprocesses; that failed
  attempt is retained and no timeout was raised to hide it.

Frozen native/npm bytes, SHA-256 manifests, source identity and evidence logs
are retained under private T3 userdata artifacts, in the
`kunai/20261026-763067b-qualification` directory. These 0.3.0 bytes cannot be
promoted as 0.4.0 or substituted for a main-branch OIDC-attested candidate.
The release guide and verifier summary now follow the actual ten-platform,
eleven-npm-package contract, including both Android targets.

## Live evidence and open gates

Four bounded headless mpv smokes decoded their 30-frame fixtures: VidLink /
Inception, VidRock / Fight Club, Movy / Fight Club, and YouTube / Me at the zoo.
These ran at 8509853a7; provider adapters are unchanged by this follow-up.
They are fixture/date/region-specific evidence, not all-title guarantees.

Default-route signoff rerun at 763067b, 2026-10-26T08:21:48Z, remains **red**:
VidLink / Dune did not resolve; the configured series and anime routes resolved
and probed successfully. A bounded direct request matching production's movie
endpoint and headers returned HTTP200 with a JSON null body for Dune. The
fixture, default order, deadlines and resolve gate were not changed to make the
signoff pass. That failed route requires provider recovery or an explicit scope
qualification before release.

Registry preflight found both Android npm names absent (HTTP404); the existing
nine launcher/desktop names are published at 0.3.0. An npm owner must bootstrap
the two Android packages and configure their trusted publishers before protected
publication can cover all eleven names. No placeholders were published.

No Android device was connected through adb. Physical Android/a-Shell, real
terminal image protocols, final main-branch hosted macOS/Windows, operator sync,
and protected provenance/publication remain separate gates. Local compilation
and Linux PowerShell fixtures do not establish those device/platform behaviors.

Integration remains ordered: clear maintainer-owned GitGuardian on PR668, merge
PR668, merge updated main normally into PR669, qualify/review that combined
revision, integrate PR669, reconcile already-included source PRs, then regenerate
version PR327. No shared history was rewritten and no remote main merge, release,
tag or package publication was performed in this pass.
