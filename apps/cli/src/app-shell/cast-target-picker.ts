import { chooseFromListShell, chooseTextInputShell } from "@/app-shell/pickers";
import {
  LOCAL_PLAYBACK_TARGET,
  type GoogleCastPlaybackTarget,
  type PlaybackTarget,
} from "@/domain/playback/playback-target";
import { googleCastTargetFromSelector } from "@/services/playback/cast/cast-target-selector";
import { discoverGoogleCastTargets } from "@/services/playback/cast/discover-google-cast-targets";

type TargetChoice =
  | { readonly kind: "target"; readonly target: PlaybackTarget }
  | { readonly kind: "manual" }
  | { readonly kind: "refresh" };

type ChooseGoogleCastTargetDeps = {
  readonly discover: () => Promise<readonly GoogleCastPlaybackTarget[]>;
  readonly choose: (
    options: readonly { value: TargetChoice; label: string; detail: string }[],
  ) => Promise<TargetChoice | null>;
  readonly enterAddress: () => Promise<string | null>;
};

export async function chooseGoogleCastTargetShell(
  deps: ChooseGoogleCastTargetDeps = {
    discover: () => discoverGoogleCastTargets(),
    choose: (options) =>
      chooseFromListShell({
        title: "Select playback device",
        subtitle: "Choose where Kunai should play this session",
        options,
      }),
    enterAddress: () =>
      chooseTextInputShell({
        title: "Connect to Google Cast",
        subtitle: "Use an IP address or .local hostname when LAN discovery is unavailable",
        label: "Device address",
        placeholder: "192.168.1.50 or living-room-tv.local",
      }),
  },
): Promise<PlaybackTarget | null> {
  for (;;) {
    const targets = await deps.discover();
    const selected = await deps.choose([
      {
        value: { kind: "target", target: LOCAL_PLAYBACK_TARGET },
        label: "This device",
        detail: "Local · mpv",
      },
      ...targets.flatMap((target) => [
        {
          value: { kind: "target" as const, target },
          label: `${target.name} · Video + audio`,
          detail: `${target.modelName ?? "Google Cast"} · ${target.host}:${target.port ?? 8009}`,
        },
        {
          value: {
            kind: "target" as const,
            target: {
              kind: "split-audio" as const,
              id: `split-audio:${target.id}`,
              name: `This device + ${target.name}`,
              audioTarget: target,
              capabilities: ["audio", "video"] as const,
            },
          },
          label: `${target.name} · Audio only`,
          detail: "Video on this device · experimental synchronized remote audio",
        },
      ]),
      {
        value: { kind: "manual" },
        label: "Enter device address…",
        detail: "Use a receiver IP address, hostname, or host:port",
      },
      {
        value: { kind: "refresh" },
        label: "Refresh devices",
        detail:
          targets.length === 0
            ? "No receivers discovered; retry the LAN search"
            : "Search the LAN again",
      },
    ]);
    if (!selected) return null;
    if (selected.kind === "target") return selected.target;
    if (selected.kind === "refresh") continue;
    const address = await deps.enterAddress();
    if (address?.trim()) return googleCastTargetFromSelector(address);
  }
}
