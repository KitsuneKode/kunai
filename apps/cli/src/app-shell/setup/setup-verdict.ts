// "Can this machine play?" — answered in one line
//
// The first setup screen used to lead with a six-row dependency table and ask
// nothing. Most machines pass every row, so the table was a screen of green
// ticks between a new user and the first thing to watch. The verdict is the
// same row model reduced to what a person choosing a lane needs to know: is
// there a player, and does the lane under the cursor need something that is
// missing here. The table itself stays one key away.
//
// Layout and copy: `.reference/design/cli/kunai-onboarding-v4.html`.

import type { CapabilitySnapshot } from "@/ui";

import type { ScopedDependencyRow } from "./dependency-rows";

export type SetupLane = "series" | "anime" | "youtube";

/** How much room the screen has. Supporting text goes before the decision does. */
export type SetupDensity = "wide" | "narrow" | "tiny";

export type VerdictLine = {
  readonly kind: "ok" | "warn" | "blocked" | "command" | "hint";
  readonly text: string;
};

export type SetupVerdict = {
  readonly lines: readonly VerdictLine[];
  /** Something on this screen wants a fix: `r` moves to the front of the footer. */
  readonly attention: boolean;
  readonly playerReady: boolean;
};

/**
 * Density from the space the screen really gets, not the terminal's.
 *
 * Rows decide as much as columns. A setup screen that is too tall does not
 * scroll, it drops rows, so each layout is only chosen where all of it fits:
 * the narrow consent screen needs 25 rows at phone width and 24 at full width.
 */
export function setupDensity(contentWidth: number, rows: number): SetupDensity {
  if (contentWidth < 44 || rows < 20) return "tiny";
  if (contentWidth < 70) return rows < 25 ? "tiny" : "narrow";
  if (rows < 24) return "tiny";
  return rows < 28 ? "narrow" : "wide";
}

/** The player this session was resolved to and does not have, by row id. */
function missingPlayer(snapshot: CapabilitySnapshot): "mpv" | "vlc" | null {
  if (snapshot.vlcRequired && !snapshot.vlc) return "vlc";
  if (snapshot.mpvRequired && !snapshot.mpv) return "mpv";
  return null;
}

const BLOCKED_TITLE = {
  "no-player": {
    wide: "No video player found — nothing can play yet",
    narrow: "No video player found",
    tiny: "No video player found",
  },
  mpv: {
    wide: "mpv not found — the selected player is unavailable",
    narrow: "mpv not found",
    tiny: "mpv not found",
  },
  vlc: {
    wide: "VLC not found — nothing can play yet",
    narrow: "VLC not found",
    tiny: "VLC not found",
  },
} satisfies Record<string, Record<SetupDensity, string>>;

const BLOCKED_HINT = {
  "no-player": {
    wide: "Run it in another terminal, then press r. VLC works too.",
    narrow: "Install it, then press r. VLC works too.",
    tiny: "then press r · VLC works too",
  },
  mpv: {
    wide: "Install mpv, then press r — or start Kunai with --player vlc.",
    narrow: "Install mpv, then press r.",
    tiny: "then press r",
  },
  vlc: {
    wide: "Install it, then press r — or start Kunai with --player mpv.",
    narrow: "Install it, then press r.",
    tiny: "then press r",
  },
} satisfies Record<keyof typeof BLOCKED_TITLE, Record<SetupDensity, string>>;

/** The dependency a lane leans on beyond a player, by row id. */
const LANE_DEPENDENCY = {
  series: null,
  anime: "curl-impersonate",
  youtube: "yt-dlp",
} satisfies Record<SetupLane, string | null>;

function laneWarning(lane: SetupLane, density: SetupDensity): VerdictLine[] {
  if (lane === "anime") {
    return [
      {
        kind: "warn",
        text:
          density === "tiny"
            ? "Anime search may come back empty"
            : "Anime search can come back empty here",
      },
    ];
  }
  return [{ kind: "warn", text: "YouTube needs yt-dlp" }];
}

export function buildSetupVerdict(input: {
  readonly snapshot: CapabilitySnapshot;
  readonly rows: readonly ScopedDependencyRow[];
  readonly lane: SetupLane;
  readonly density: SetupDensity;
  /** The player this session will drive, when it is not mpv. */
  readonly playerName?: string | undefined;
}): SetupVerdict {
  const { snapshot, rows, lane, density } = input;
  const lines: VerdictLine[] = [];
  // The snapshot carries the one capability rule for the selected player: a
  // session resolved to VLC is ready without mpv, and the reverse.
  const missing = missingPlayer(snapshot);
  const playerReady = missing === null;

  if (playerReady) {
    const name =
      input.playerName ??
      (snapshot.vlcRequired ? "VLC" : snapshot.mpv ? "mpv" : "your video player");
    lines.push({ kind: "ok", text: `Ready to play in ${name}` });
  } else {
    const message = missing === "mpv" && !snapshot.vlc ? "no-player" : missing;
    lines.push({ kind: "blocked", text: BLOCKED_TITLE[message][density] });
    const fix = rows.find((row) => row.id === missing)?.fix;
    if (fix) lines.push({ kind: "command", text: fix });
    lines.push({ kind: "hint", text: BLOCKED_HINT[message][density] });
  }

  const dependencyId = LANE_DEPENDENCY[lane];
  const dependency = dependencyId ? rows.find((row) => row.id === dependencyId) : undefined;
  const laneNeedsFix = Boolean(dependency && dependency.state !== "ok");
  if (dependency && laneNeedsFix) {
    lines.push(...laneWarning(lane, density));
    if (dependency.fix) lines.push({ kind: "command", text: dependency.fix });
    if (lane === "anime" && density === "wide") {
      lines.push({
        kind: "hint",
        text: "Cloudflare turns away plain requests. Shows & movies are not affected.",
      });
    }
  }

  return { lines, attention: !playerReady || laneNeedsFix, playerReady };
}
