---
status: current
lastReviewed: "2026-10-08"
---

# Download removal

> Agent-facing (L3). Never linked from published docs. Users: see `docs/users/`.

`DownloadService.deleteJob` returns a receipt: `deleted` after the database
commit, `missing` when the record is already absent, or `retained` with a reason.
An active download or incomplete publication must be cancelled or recovered
before removal. A stale UI snapshot cannot delete a newly claimed job.

`DownloadJobsRepository.deleteInactive` checks the observed update time and claim
generation under a SQLite writer transaction. Its synchronous cleanup callback
never awaits. Associated offline assets and the job are deleted in that same
transaction; tracks and artwork references cascade. The `deleted` event runs
only after commit. No listener is responsible for durable asset removal.

Artifact removal requires a completed or repairable job with no conflicting
owner. A recorded publication identity must still match an existing destination;
a missing file is already removed and permits retrying cleanup. Permission or
filesystem failures retain the record and report failure. Some files may already
have been removed before a later sidecar fails; filesystem removal cannot be
rolled back. Refreshing the library rechecks those paths, and retrying removal
can finish the remaining files. Database failures propagate and roll back record
and asset deletion; they never emit `deleted`.

Record-only removal preserves files, including unqualified staging residue. It
is the explicit escape for a replaced or unproved artifact. Expiry alone does
not authorize removal of a retired worker's staging files.

`deleteDownloads` collects one result per selection, including persistence
errors. Library, Downloads, their command workflows, and the offline action
router remove only successfully removed or already absent records from local UI
state and display retained reasons. Downloads confirmation uses the job id,
so a list refresh cannot transfer confirmation to another row. `X` explicitly
removes only the record and keeps local files; `x` removes completed artifacts
and their record, or only the record for failed/queued jobs. Confirmation tracks
both the job id and removal mode. The footer states which action will occur.

This contract applies to anime, movies, series, and YouTube jobs on all desktop
platforms. It does not implement abandoned staging-directory collection or
resolve collisions during offline title-identity relocation.
