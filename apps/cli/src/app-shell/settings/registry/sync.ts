import { describePauseState, pauseUntil, resolvePauseState } from "@/services/sync/sync-pause";
import type { SyncAdapter } from "@/services/sync/SyncAdapter";
import type { ConnectionState, TrackerId } from "@/services/sync/types";

import type { SettingRowDef, SettingsRegistryContext } from "../types";

/**
 * The sync page reads two typed projections and nothing else: what each adapter
 * says it can do, and whether its authorization is available. It never touches
 * `process.env`, never imports a credential, and never inspects adapter
 * internals — otherwise settings and the adapters end up with two different
 * opinions about what is connectable, and the one the user sees is the wrong one.
 */

function connectionSummary(connection: ConnectionState): {
  detail: string;
  tone: "success" | "warning" | "info";
} {
  switch (connection.state) {
    case "connected":
      return {
        detail: connection.username ? `connected as @${connection.username}` : "connected",
        tone: "success",
      };
    case "needs-reauth":
      return {
        detail: "sign-in expired — queued changes are held until you connect again",
        tone: "warning",
      };
    case "disconnected":
      return { detail: "not connected", tone: "info" };
  }
}

/** What each tracker actually writes, phrased from its declared capabilities. */
function capabilitySummary(adapter: SyncAdapter): string {
  const parts: string[] = [];
  if (adapter.capabilities.episodeProgress) parts.push("episode progress");
  if (adapter.capabilities.watchlistMembership) parts.push("watchlist");
  if (adapter.capabilities.favoriteMembership) parts.push("favourites");
  return parts.length > 0 ? parts.join(", ") : "nothing yet";
}

function unavailableDetail(ctx: SettingsRegistryContext, tracker: TrackerId): string | null {
  const availability = ctx.sync.authAvailability[tracker];
  if (availability.available) return null;
  return `unavailable: ${availability.reason}`;
}

const PAUSE_CHOICES = [
  { value: "resume", label: "Resume now", detail: "Deliver everything that queued up" },
  { value: "1h", label: "Pause for 1 hour", detail: "Keep queueing, deliver later" },
  { value: "8h", label: "Pause for 8 hours", detail: "Keep queueing, deliver later" },
  { value: "tomorrow", label: "Pause until tomorrow", detail: "Resumes at 9am" },
] as const;

function trackerRows(ctx: SettingsRegistryContext, adapter: SyncAdapter): SettingRowDef[] {
  const tracker = adapter.id;
  const connection = adapter.getConnection();
  const summary = connectionSummary(connection);
  const unavailable = unavailableDetail(ctx, tracker);
  const connected = connection.state === "connected";

  return [
    {
      kind: "status",
      id: `sync:${tracker}:status`,
      label: adapter.displayName,
      detail: unavailable ?? `${summary.detail} · writes ${capabilitySummary(adapter)}`,
      tone: unavailable ? "warning" : summary.tone,
    },
    {
      kind: "action",
      id: `sync:${tracker}:connection`,
      label: connected ? `Disconnect ${adapter.displayName}` : `Connect ${adapter.displayName}`,
      detail: unavailable
        ? "Authorization is not available; see the status above"
        : connected
          ? "Sign out locally. Your history and queued changes are kept."
          : "Opens your browser to approve. Nothing to configure.",
      ...(connected ? { tone: "danger" as const } : {}),
      run: async (context) => {
        const service = context.container.syncService;
        const target = service.adapters.find((candidate) => candidate.id === tracker);
        if (!target) return `${adapter.displayName} is not available.`;

        if (target.getConnection().state === "connected") {
          await target.disconnect({ signal: new AbortController().signal });
          return `Disconnected ${adapter.displayName}.`;
        }

        // TMDB's flow has an out-of-band step and says so through `onPrompt`.
        // Dropping it on the floor is why Connect TMDB looked like it did
        // nothing: the browser opened and nothing on screen explained the wait.
        const result = await target.connect({
          signal: new AbortController().signal,
          onPrompt: (note) =>
            context.container.stateManager.dispatch({
              type: "SET_PLAYBACK_FEEDBACK",
              note,
            }),
        });
        if (!result.ok) return `${adapter.displayName}: ${result.error}`;

        // Reconnecting is only finished when the work it was blocking moves.
        const resumed = service.resumeAfterReauth(tracker);
        if (resumed > 0) await service.drain();
        const now = target.getConnection();
        const who = now.state === "connected" && now.username ? ` as @${now.username}` : "";
        return `Connected to ${adapter.displayName}${who}.`;
      },
    },
    {
      kind: "boolean",
      id: `sync:${tracker}:enabled`,
      label: `${adapter.displayName} sync`,
      detail: "Off means never. To stop delivery for a while, use Pause sync instead.",
      read: (config) => config.sync[tracker].enabled,
      write: (config, value) => ({
        ...config,
        sync: { ...config.sync, [tracker]: { ...config.sync[tracker], enabled: value } },
      }),
    },
    {
      kind: "boolean",
      id: `sync:${tracker}:trackWatched`,
      label: "Send episode progress",
      detail: adapter.capabilities.episodeProgress
        ? "Push what you have watched as you watch it"
        : `${adapter.displayName} has no episode-progress API; this does nothing here`,
      // Gated on the declared capability rather than on the tracker's name, so
      // a control can never be offered for something no code path delivers.
      gate: { predicate: () => adapter.capabilities.episodeProgress },
      read: (config) => config.sync[tracker].trackWatched,
      write: (config, value) => ({
        ...config,
        sync: { ...config.sync, [tracker]: { ...config.sync[tracker], trackWatched: value } },
      }),
    },
    {
      kind: "boolean",
      id: `sync:${tracker}:syncList`,
      label: "Send watchlist and favourites",
      detail: `Mirror w (watchlist) and f (favourite) to ${adapter.displayName}`,
      gate: {
        predicate: () =>
          adapter.capabilities.watchlistMembership || adapter.capabilities.favoriteMembership,
      },
      read: (config) => config.sync[tracker].syncList,
      write: (config, value) => ({
        ...config,
        sync: { ...config.sync, [tracker]: { ...config.sync[tracker], syncList: value } },
      }),
    },
  ];
}

export function syncSettingsRows(ctx: SettingsRegistryContext): SettingRowDef[] {
  const status = ctx.sync.status;
  const pause = resolvePauseState(ctx.config.sync.pausedUntil);

  const backlog =
    status.pending > 0 ? `${status.pending} change${status.pending === 1 ? "" : "s"} queued` : null;
  const overallDetail =
    describePauseState(pause) ??
    (status.needsReauth > 0
      ? "a tracker needs signing in again"
      : status.connected === 0
        ? "no trackers connected"
        : (backlog ?? "up to date"));

  return [
    {
      kind: "section",
      id: "section:sync",
      label: "Sync",
      // Reachable, and honest about its state: the delivery path is covered by
      // tests but has not yet been verified against a live tracker account.
      detail: "Experimental · mirror what you watch to AniList and TMDB",
    },
    {
      kind: "status",
      id: "sync:status",
      label: "Sync status",
      // Backlog is worth saying even while paused: it is the reassurance that
      // pausing did not throw anything away.
      detail: pause.paused && backlog ? `${overallDetail} · ${backlog}` : overallDetail,
      tone:
        status.health === "ok"
          ? "success"
          : status.health === "error"
            ? "error"
            : status.health === "warn" || status.health === "paused"
              ? "warning"
              : "info",
    },
    {
      kind: "submenu",
      id: "sync:pause",
      label: "Pause sync",
      detail: "Hold delivery for a while. Changes keep queueing and go out on resume.",
      summarize: (config) =>
        describePauseState(resolvePauseState(config.sync.pausedUntil)) ?? "off",
      buildChoices: () => [...PAUSE_CHOICES],
      onPick: (config, value) => ({
        ...config,
        sync: {
          ...config.sync,
          pausedUntil:
            value === "resume" ? null : pauseUntil(value as "1h" | "8h" | "tomorrow", new Date()),
        },
      }),
    },
    ...ctx.sync.adapters.flatMap((adapter) => trackerRows(ctx, adapter)),
  ];
}
