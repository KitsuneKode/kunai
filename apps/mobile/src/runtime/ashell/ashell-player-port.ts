import type { MobilePlayerPort } from "../../application/contracts";
import type { AShellCommandBridge } from "./ashell-command-bridge";
import type { AShellJsc } from "./ashell-globals";
import { toVlcXCallbackUrl } from "./vlc-url";

const RUNTIME_DIRECTORY = ".runtime";
const PLAYER_URL_PATH = `${RUNTIME_DIRECTORY}/player-url`;

function removePlayerUrl(jsc: AShellJsc): boolean {
  if (!jsc.isFile(PLAYER_URL_PATH)) return true;
  return jsc.deleteFile(PLAYER_URL_PATH) === 0 && !jsc.isFile(PLAYER_URL_PATH);
}

export function createAShellPlayerPort(input: {
  readonly jsc: AShellJsc;
  readonly bridge: AShellCommandBridge;
}): MobilePlayerPort {
  return {
    async handoff(request) {
      let result:
        | { readonly kind: "accepted"; readonly launcher: "openurl" }
        | { readonly kind: "rejected"; readonly reason: string };
      try {
        if (input.jsc.makeFolder(RUNTIME_DIRECTORY) !== 0 || !removePlayerUrl(input.jsc)) {
          throw new Error("player setup");
        }
        const playerUrl = toVlcXCallbackUrl(request.url);
        if (input.jsc.writeFile(PLAYER_URL_PATH, playerUrl) !== 0) {
          throw new Error("player write");
        }
        result =
          input.bridge.runFixedHelper("open-vlc") === 0
            ? { kind: "accepted", launcher: "openurl" }
            : { kind: "rejected", reason: "openurl-rejected" };
      } catch {
        result = { kind: "rejected", reason: "openurl-rejected" };
      } finally {
        if (!removePlayerUrl(input.jsc)) {
          result = { kind: "rejected", reason: "player-cleanup-failed" };
        }
      }
      return result;
    },
  };
}
