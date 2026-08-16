// =============================================================================
// download-confirmation-shell.tsx — one mounted download confirmation.
//
// The previous implementation re-opened a fresh picker on every edit through a
// `while (true)` loop. Each pass mounted a new component, so the title poster
// was fetched again, and a live Kitty placement was replaced mid-session — the
// image visibly flickered every time you cycled quality. Mounting once and
// keeping the draft in local state removes that entirely: the poster request
// key depends on the title and fixed geometry, never on profile state.
// =============================================================================

import type { Container } from "@/container";
import { isTitleLevelContent } from "@/domain/media/content-kind";
import { formatMediaItemCount, presentMedia } from "@/domain/media/media-presentation";
import type { TitleInfo } from "@/domain/types";
import type {
  DownloadConfirmationProfile,
  DownloadIntentItem,
} from "@/services/download/DownloadIntentService";
import type { MediaKind } from "@kunai/types";
import { Box, Text, useInput } from "ink";
import React, { useCallback, useMemo, useState } from "react";

import {
  updateDownloadConfirmationProfile,
  type DownloadConfirmationEditAction,
} from "./download-confirmation-profile";
import { buildDownloadManagerLayout } from "./download-manager-view";
import { useOverlayOrTerminalSize } from "./overlay-layout-context";
import { PreviewRail } from "./primitives/PreviewRail";
import type { PreviewRailModel } from "./primitives/PreviewRail.model";
import { mountRootContent } from "./root-content-state";
import { truncateLine } from "./shell-text";
import { palette } from "./shell-theme";
import { usePosterPreview } from "./use-poster-preview";

/** Fixed poster geometry. Deliberately independent of the draft profile. */
const CONFIRMATION_POSTER_ROWS = 12;
const CONFIRMATION_POSTER_COLS = 30;

export type DownloadConfirmationResult =
  | { readonly type: "confirmed"; readonly profile: DownloadConfirmationProfile }
  | { readonly type: "cancelled" };

type ConfirmationAction =
  | {
      readonly kind: "commit";
      readonly enrollRunway: boolean;
      readonly label: string;
      readonly detail: string;
    }
  | {
      readonly kind: "edit";
      readonly action: DownloadConfirmationEditAction;
      readonly label: string;
      readonly detail: string;
    }
  | { readonly kind: "cancel"; readonly label: string; readonly detail: string };

function describeCleanup(profile: DownloadConfirmationProfile): string {
  return profile.cleanupPolicy.mode === "cleanup-watched"
    ? `suggest cleanup after ${profile.cleanupPolicy.graceDays} days watched`
    : "keep last watched episode local";
}

function describeProfile(profile: DownloadConfirmationProfile, title: TitleInfo): string {
  return [
    `${profile.audioPreference} audio`,
    `${profile.subtitlePreference} subtitles`,
    profile.qualityPreference
      ? `${profile.qualityPreference} quality`
      : "highest available quality",
    profile.cacheArtwork
      ? title.posterUrl
        ? "poster saved with download"
        : "artwork caching on (no poster yet)"
      : "no artwork saved",
    `destination: ${profile.outputDirectory ? "configured folder" : "default offline library"}`,
    describeCleanup(profile),
    "disk space checked before queueing",
    "provider resolve happens only after you confirm",
  ].join(" · ");
}

function buildActions(input: {
  readonly profile: DownloadConfirmationProfile;
  readonly title: TitleInfo;
  readonly isTitleLevel: boolean;
  readonly hasConfiguredDownloadPath: boolean;
}): readonly ConfirmationAction[] {
  const { profile, title, isTitleLevel, hasConfiguredDownloadPath } = input;
  const detail = describeProfile(profile, title);

  return [
    { kind: "commit", enrollRunway: false, label: "Queue download", detail },
    ...(isTitleLevel
      ? []
      : [
          {
            kind: "commit" as const,
            enrollRunway: true,
            label: "Queue download + keep next episodes ready",
            detail: `${detail} · offline runway keeps up to ${profile.runwayTarget ?? 1} released episodes ready`,
          },
        ]),
    {
      kind: "edit" as const,
      action: "cycle-quality" as const,
      label: `Quality: ${profile.qualityPreference ?? "highest"}`,
      detail: "Cycle download quality — highest available unless you cap it",
    },
    {
      kind: "edit" as const,
      action: "cycle-audio" as const,
      label: `Audio: ${profile.audioPreference}`,
      detail: "Cycle the audio language saved with downloads",
    },
    {
      kind: "edit" as const,
      action: "cycle-subtitle" as const,
      label: `Subtitles: ${profile.subtitlePreference}`,
      detail: "Cycle the subtitle language saved with downloads",
    },
    {
      kind: "edit" as const,
      action: "toggle-artwork" as const,
      label: `Artwork: ${profile.cacheArtwork ? "saved" : "off"}`,
      detail: "Save the title poster alongside the video for the offline library",
    },
    ...(hasConfiguredDownloadPath
      ? [
          {
            kind: "edit" as const,
            action: "toggle-destination" as const,
            label: `Save to: ${profile.outputDirectory ? "configured folder" : "default offline library"}`,
            detail: "Switch between your configured folder and the default library",
          },
        ]
      : []),
    ...(isTitleLevel
      ? []
      : [
          {
            kind: "edit" as const,
            action: "increase-runway" as const,
            label: `Keep ready ahead: ${profile.runwayTarget ?? 1} episode(s)`,
            detail: "Pre-download upcoming episodes so they are ready offline",
          },
          {
            kind: "edit" as const,
            action: "decrease-runway" as const,
            label: "Keep fewer ready ahead",
            detail: "Lower how many episodes are pre-downloaded",
          },
          {
            kind: "edit" as const,
            action: "toggle-cleanup" as const,
            label: `After watching: ${describeCleanup(profile)}`,
            detail: "Whether watched episodes are suggested for cleanup (never auto-deleted)",
          },
        ]),
    {
      kind: "cancel" as const,
      label: "Cancel",
      detail: "Close without downloading (or press Esc)",
    },
  ];
}

export function DownloadConfirmationContent({
  title,
  mediaKind,
  items,
  initialProfile,
  container,
  onFinish,
}: {
  readonly title: TitleInfo;
  readonly mediaKind: MediaKind;
  readonly items: readonly DownloadIntentItem[];
  readonly initialProfile: DownloadConfirmationProfile;
  readonly container: Container;
  readonly onFinish: (result: DownloadConfirmationResult) => void;
}): React.ReactElement {
  const [draft, setDraft] = useState(initialProfile);
  const [cursor, setCursor] = useState(0);
  const isTitleLevel = isTitleLevelContent(mediaKind, title.type);
  // Same list/rail split the download manager uses, so the two surfaces cannot
  // drift and there is only one width reservation to reason about.
  const { cols } = useOverlayOrTerminalSize();
  const layout = buildDownloadManagerLayout(cols);

  // The poster request identity: title artwork plus fixed geometry. Nothing
  // here reads `draft`, so no edit can re-key the fetch or replace the
  // on-screen Kitty placement.
  const { poster } = usePosterPreview(title.posterUrl, {
    rows: CONFIRMATION_POSTER_ROWS,
    cols: CONFIRMATION_POSTER_COLS,
    enabled: Boolean(title.posterUrl),
    variant: "preview",
    placementSlot: "overlay-picker",
  });

  const presentation = useMemo(
    () =>
      presentMedia({
        title: title.name,
        mediaKind,
        season: items[0]?.kind === "episode" ? items[0].episode.season : undefined,
        episode: items[0]?.kind === "episode" ? items[0].episode.episode : undefined,
        contentType: title.type,
      }),
    [title.name, title.type, mediaKind, items],
  );

  const actions = useMemo(
    () =>
      buildActions({
        profile: draft,
        title,
        isTitleLevel,
        hasConfiguredDownloadPath: Boolean(container.config.downloadPath.trim()),
      }),
    [draft, title, isTitleLevel, container.config.downloadPath],
  );

  const positionCodes = items
    .flatMap((item) =>
      item.kind === "episode"
        ? [
            presentMedia({
              title: title.name,
              mediaKind,
              season: item.episode.season,
              episode: item.episode.episode,
              contentType: title.type,
            }).positionLabel ?? [],
          ].flat()
        : [],
    )
    .join(", ");

  const subtitle = [
    formatMediaItemCount({ mediaKind, contentType: title.type, count: items.length }),
    positionCodes || null,
    "edits stay local until you queue",
  ]
    .filter(Boolean)
    .join(" · ");

  const run = useCallback(
    (action: ConfirmationAction) => {
      if (action.kind === "cancel") {
        onFinish({ type: "cancelled" });
        return;
      }
      if (action.kind === "commit") {
        onFinish({
          type: "confirmed",
          profile: { ...draft, enrollKeepWatchingOffline: action.enrollRunway },
        });
        return;
      }
      setDraft((current) =>
        updateDownloadConfirmationProfile(
          current,
          action.action,
          container.config.downloadPath,
          container.config.autoCleanupGraceDays,
        ),
      );
    },
    [draft, onFinish, container.config.downloadPath, container.config.autoCleanupGraceDays],
  );

  useInput((_input, key) => {
    if (key.escape) {
      onFinish({ type: "cancelled" });
      return;
    }
    if (key.upArrow) {
      setCursor((index) => (index - 1 + actions.length) % actions.length);
      return;
    }
    if (key.downArrow) {
      setCursor((index) => (index + 1) % actions.length);
      return;
    }
    if (key.return) {
      const action = actions[Math.min(cursor, actions.length - 1)];
      if (action) run(action);
    }
  });

  const railModel: PreviewRailModel = {
    title: presentation.title,
    subtitle: presentation.positionLabel ?? presentation.kindLabel,
    posterUrl: title.posterUrl,
    posterState: title.posterUrl ? "ready" : "none",
    facts: [
      {
        label: "Items",
        value: formatMediaItemCount({ mediaKind, contentType: title.type, count: items.length }),
      },
      { label: "Quality", value: draft.qualityPreference ?? "highest" },
      { label: "Audio", value: draft.audioPreference },
      { label: "Subtitles", value: draft.subtitlePreference },
    ],
  };

  return (
    <Box flexDirection="row" width={layout.columns}>
      <Box flexDirection="column" width={layout.listWidth}>
        <Text color={palette.text} bold>
          {truncateLine(`Download ${presentation.title}?`, layout.listWidth)}
        </Text>
        <Text color={palette.muted} dimColor>
          {truncateLine(subtitle, layout.listWidth)}
        </Text>
        <Box flexDirection="column" marginTop={1}>
          {actions.map((action, index) => {
            const selected = index === cursor;
            return (
              <Box key={`${action.kind}-${action.label}`} flexDirection="column">
                <Text color={selected ? palette.accent : palette.text} bold={selected}>
                  {truncateLine(`${selected ? "\u258c " : "  "}${action.label}`, layout.listWidth)}
                </Text>
                {selected ? (
                  <Text color={palette.muted} dimColor wrap="truncate">
                    {truncateLine(`    ${action.detail}`, layout.listWidth)}
                  </Text>
                ) : null}
              </Box>
            );
          })}
        </Box>
      </Box>
      {layout.showRail ? (
        <Box marginLeft={2}>
          <PreviewRail model={railModel} width={layout.railWidth} poster={poster} />
        </Box>
      ) : null}
    </Box>
  );
}

/**
 * Mount the confirmation exactly once and resolve with the confirmed profile,
 * or null when the user backs out.
 */
export async function openDownloadConfirmationShell(input: {
  readonly title: TitleInfo;
  readonly mediaKind: MediaKind;
  readonly items: readonly DownloadIntentItem[];
  readonly initialProfile: DownloadConfirmationProfile;
  readonly container: Container;
}): Promise<DownloadConfirmationProfile | null> {
  const session = mountRootContent<DownloadConfirmationResult>({
    kind: "picker",
    renderContent: (finish) => (
      <DownloadConfirmationContent
        title={input.title}
        mediaKind={input.mediaKind}
        items={input.items}
        initialProfile={input.initialProfile}
        container={input.container}
        onFinish={finish}
      />
    ),
    fallbackValue: { type: "cancelled" },
  });

  const result = await session.result;
  return result.type === "confirmed" ? result.profile : null;
}
