import type { SettingRowDef, SettingsRegistryContext } from "../types";

type TrackerId = "anilist" | "tmdb";

/**
 * Tracker sync settings.
 *
 * Connection itself lives in `/sync` (it needs an interactive browser flow);
 * this page owns the persisted toggles that decide whether a connected account
 * is actually written to. Those flags shipped in config but nothing read them,
 * so the settings surface never existed either.
 */
function trackerRows(
  ctx: SettingsRegistryContext,
  id: TrackerId,
  label: string,
  supportsProgress: boolean,
): SettingRowDef[] {
  const connection = ctx.syncSnapshot.connections[id];

  const statusDetail =
    connection.state === "connected"
      ? `connected${connection.username ? ` as @${connection.username}` : ""}`
      : connection.state === "needs-reauth"
        ? connection.reason
        : `not connected — run /sync to link your ${label} account`;

  const rows: SettingRowDef[] = [
    {
      kind: "status",
      id: `sync:${id}:status`,
      label: `${label} account`,
      detail: statusDetail,
      tone:
        connection.state === "connected"
          ? "success"
          : connection.state === "needs-reauth"
            ? "warning"
            : "info",
    },
    {
      kind: "boolean",
      id: `sync:${id}:enabled`,
      label: `${label} sync`,
      detail: `Allow Kunai to write to your ${label} account`,
      read: (config) => config.sync[id].enabled,
      write: (config, value) => ({
        ...config,
        sync: { ...config.sync, [id]: { ...config.sync[id], enabled: value } },
      }),
    },
  ];

  if (supportsProgress) {
    rows.push({
      kind: "boolean",
      id: `sync:${id}:trackWatched`,
      label: `${label} episode progress`,
      detail: "Update your list automatically when an episode finishes",
      read: (config) => config.sync[id].trackWatched,
      write: (config, value) => ({
        ...config,
        sync: { ...config.sync, [id]: { ...config.sync[id], trackWatched: value } },
      }),
    });
  } else {
    // Say why the toggle is absent rather than offering one that cannot work.
    rows.push({
      kind: "status",
      id: `sync:${id}:progress-note`,
      label: `${label} episode progress`,
      detail: "Not supported — TMDB has no watch-progress API. AniList tracks anime progress.",
      tone: "info",
    });
  }

  rows.push({
    kind: "boolean",
    id: `sync:${id}:syncList`,
    label: `${label} watchlist`,
    detail: `Mirror watchlist and favourites with ${label}`,
    read: (config) => config.sync[id].syncList,
    write: (config, value) => ({
      ...config,
      sync: { ...config.sync, [id]: { ...config.sync[id], syncList: value } },
    }),
  });

  return rows;
}

export function syncSettingsRows(ctx: SettingsRegistryContext): SettingRowDef[] {
  const queue = ctx.syncSnapshot.queue;

  return [
    {
      kind: "section",
      id: "section:sync",
      label: "Sync",
      detail: "Tracker accounts — connect them from /sync",
    },
    ...trackerRows(ctx, "anilist", "AniList", true),
    ...trackerRows(ctx, "tmdb", "TMDB", false),
    ...(queue.pending > 0 || queue.dead > 0
      ? ([
          {
            kind: "status",
            id: "sync:queue",
            label: "Pending pushes",
            detail:
              queue.dead > 0
                ? `${queue.pending} waiting to retry · ${queue.dead} gave up after repeated failures`
                : `${queue.pending} waiting to retry`,
            tone: queue.dead > 0 ? "error" : "warning",
          },
        ] satisfies SettingRowDef[])
      : []),
    {
      kind: "action",
      id: "sync:drain",
      label: "Retry pending pushes now",
      detail: "Clear backoff and re-send anything queued for your trackers",
      run: async (actionCtx) => {
        const summary = await actionCtx.container.syncService.syncNow([]);
        if (summary.connected === 0) return "No tracker accounts connected.";
        if (summary.failed > 0) {
          return `${summary.failed} push(es) still failing. ${summary.failures[0] ?? ""}`.trim();
        }
        return summary.succeeded > 0
          ? `Sent ${summary.succeeded} pending update(s).`
          : "Nothing pending.";
      },
    },
  ];
}
