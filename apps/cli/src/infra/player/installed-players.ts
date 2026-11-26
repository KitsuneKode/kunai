import {
  detectPlayerPlatform,
  resolvePlayerMode,
  type PlayerChoice,
  type PlayerMode,
} from "@/domain/playback/player-choice";

import { discoverMpvInvocation } from "./mpv-discovery";
import { discoverVlcBinary } from "./vlc/vlc-launch";

/** Which desktop players this machine has, for `--player auto`. */
export function detectInstalledPlayers(): { readonly mpv: boolean; readonly vlc: boolean } {
  return { mpv: discoverMpvInvocation() !== null, vlc: discoverVlcBinary() !== null };
}

/**
 * The player this machine will use for `choice`. Startup's dependency check and
 * the container both call this, so they always agree.
 */
export function resolveMachinePlayerMode(choice: PlayerChoice): PlayerMode {
  // Android ignores `installed`: it hands playback to another app.
  return resolvePlayerMode({
    choice,
    platform: detectPlayerPlatform(),
    installed: detectInstalledPlayers(),
  });
}
