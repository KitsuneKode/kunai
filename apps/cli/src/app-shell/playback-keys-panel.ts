import { bindingsForScope, bindingKeys, type KeyBinding } from "@/app-shell/keybindings";
import { contentKindHasEpisodes, type ContentKind } from "@/domain/media/content-kind";

/**
 * The playback screen's discoverable key card.
 *
 * Playback listed its keys in two places that both assumed you already knew
 * them: a single dense GO row, and the `?` overlay — which a first-time user has
 * no reason to press. Meanwhile the screen itself is mostly empty while mpv owns
 * the video. This fills that space with the real keys, grouped, for the first
 * few playbacks, then gets out of the way for good.
 */

export type PlaybackKeysGroup = {
  readonly title: string;
  readonly rows: readonly { readonly keys: string; readonly label: string }[];
};

export type PlaybackKeysPanelModel = {
  readonly visible: boolean;
  readonly groups: readonly PlaybackKeysGroup[];
  /** Shown under the card so dismissing it never feels like a trap. */
  readonly footnote: string;
};

/**
 * How many playbacks show the card before it retires itself. Three is enough to
 * read it without it becoming wallpaper — past that it is noise for someone who
 * has already learned the keys, and `?` still has everything.
 */
export const PLAYBACK_KEYS_PANEL_SESSIONS = 3;

/** Keys that only mean something when there are other episodes to move between. */
const EPISODIC_BINDING_IDS = new Set(["player-next", "player-previous", "player-episode"]);

/** Ordered groups. Anything not named here is deliberately left to `?`. */
const GROUPS: readonly { readonly title: string; readonly ids: readonly string[] }[] = [
  { title: "watch", ids: ["player-next", "player-previous", "player-episode", "player-skip"] },
  { title: "stream", ids: ["player-source", "player-quality", "player-fallback"] },
  { title: "session", ids: ["player-autoplay", "player-autoskip", "player-stop"] },
];

function rowFor(binding: KeyBinding): { keys: string; label: string } {
  return { keys: bindingKeys(binding), label: binding.hintLabel ?? binding.label };
}

export function buildPlaybackKeysPanel(input: {
  readonly contentKind: ContentKind | undefined;
  readonly titleType?: import("@/domain/types").ContentType;
  /** How many playbacks have already shown this card. */
  readonly sessionsSeen: number;
  /** User turned it off, or the terminal has no room for it. */
  readonly suppressed?: boolean;
  readonly bindings?: readonly KeyBinding[];
}): PlaybackKeysPanelModel {
  const episodic = contentKindHasEpisodes(input.contentKind, input.titleType);
  const available = input.bindings ?? bindingsForScope("player");
  const byId = new Map(available.map((binding) => [binding.id, binding]));

  const groups: PlaybackKeysGroup[] = [];
  for (const group of GROUPS) {
    const rows = group.ids
      // A movie has no next/previous/episode list, so those keys would point at
      // nothing — the same rule the footer and GO row already follow.
      .filter((id) => episodic || !EPISODIC_BINDING_IDS.has(id))
      .map((id) => byId.get(id))
      .filter((binding): binding is KeyBinding => binding !== undefined)
      .map(rowFor);
    if (rows.length > 0) groups.push({ title: group.title, rows });
  }

  return {
    visible:
      !input.suppressed && input.sessionsSeen < PLAYBACK_KEYS_PANEL_SESSIONS && groups.length > 0,
    groups,
    footnote: "? for all keys · these stay live while mpv has focus",
  };
}
