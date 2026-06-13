# Dead modules (archived, not deleted) — 2026-06-13

These modules were verified **unreferenced** (zero static or dynamic imports anywhere
in `apps/cli/src` or `apps/cli/test`) during a react-doctor + grep cleanup pass. Rather
than delete them, they're parked here so the work isn't lost and can be revived. This
directory is under `archive/legacy/`, so it is excluded from the CLI build, typecheck,
and the architecture boundary test.

Original locations (restore by moving back into `apps/cli/src/...`):

| Archived path                                 | Original path                                              | Notes                                                                                                                      |
| --------------------------------------------- | ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `app-shell/primitives/FocusField.tsx`         | `apps/cli/src/app-shell/primitives/FocusField.tsx`         | superseded UI primitive                                                                                                    |
| `app-shell/primitives/Heatmap.tsx`            | `apps/cli/src/app-shell/primitives/Heatmap.tsx`            | superseded stats widget                                                                                                    |
| `app-shell/primitives/Heatmap.model.ts`       | `apps/cli/src/app-shell/primitives/Heatmap.model.ts`       | only used by Heatmap.tsx (also dead)                                                                                       |
| `app-shell/primitives/InsightLine.tsx`        | `apps/cli/src/app-shell/primitives/InsightLine.tsx`        | superseded UI primitive                                                                                                    |
| `app-shell/primitives/TabStrip.tsx`           | `apps/cli/src/app-shell/primitives/TabStrip.tsx`           | superseded UI primitive                                                                                                    |
| `app/OfflineLibraryPhase.ts`                  | `apps/cli/src/app/OfflineLibraryPhase.ts`                  | superseded by offline-playback flow; also removed its allowlist entry in `test/unit/architecture/boundary-imports.test.ts` |
| `app/title-display-model.ts`                  | `apps/cli/src/app/title-display-model.ts`                  | unused model                                                                                                               |
| `domain/session/AppIntent.ts`                 | `apps/cli/src/domain/session/AppIntent.ts`                 | unused intent type                                                                                                         |
| `services/playlists/PlaylistExportService.ts` | `apps/cli/src/services/playlists/PlaylistExportService.ts` | playlist export not wired (DurablePlaylistService is the live one)                                                         |
| `services/playlists/PlaylistImportService.ts` | `apps/cli/src/services/playlists/PlaylistImportService.ts` | playlist import not wired                                                                                                  |

If any of these is a planned feature you intend to wire up, move it back into `src` and
import it from a reachable entry point. If confirmed truly obsolete, this whole folder
can be deleted in one go.
