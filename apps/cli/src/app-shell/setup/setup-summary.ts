// Footers and the review screen's lines, as pure functions of the answers
//
// Split from `setup-shell.tsx`, which renders them: these read the answers and
// return rows, so they can be tested without mounting a screen.

import {
  AUDIO_PREFERENCE_OPTIONS,
  SUBTITLE_PREFERENCE_OPTIONS,
} from "@/domain/media/media-preferences";

import type { ScopedDependencyRow } from "./dependency-rows";
import { SETUP_LANGUAGE_LANES, type SetupPrefs, type SetupScreenId } from "./setup-model";
import type { FooterKey } from "./SetupFrame";
import { dependencyFooter, MODE_OPTIONS, type SummaryLine } from "./SetupScreens";

export function buildFooter(
  screen: Exclude<SetupScreenId, "start">,
  context: { readonly hasFix: boolean; readonly isFirst: boolean },
): readonly FooterKey[] {
  const back: FooterKey[] = context.isFirst ? [] : [{ key: "b", label: "back" }];
  switch (screen) {
    case "deps":
      return dependencyFooter(context.hasFix);
    case "mode":
      return [
        { key: "enter", label: "confirm" },
        { key: "↑↓", label: "choose" },
        ...back,
        { key: "s", label: "recommended" },
        { key: "S", label: "finish defaults" },
      ];
    case "language":
      // tab and ↑↓ are named in the screen body, right where they act; the
      // footer keeps only the decisions.
      return [
        { key: "enter", label: "next" },
        { key: "tab", label: "profile" },
        { key: "←→", label: "audio / subs" },
        { key: "a", label: "copy to all" },
        { key: "S", label: "finish defaults" },
        ...back,
      ];
    case "library":
      return [
        { key: "space", label: "toggle" },
        { key: "↑↓", label: "choose" },
        { key: "enter", label: "next" },
        { key: "s", label: "recommended" },
        { key: "S", label: "finish defaults" },
        ...back,
      ];
    case "analytics":
      return [
        { key: "↑↓", label: "choose" },
        { key: "enter", label: "confirm" },
        { key: "s", label: "don't share" },
        ...back,
      ];
    case "done":
      return [
        { key: "enter", label: "start watching" },
        { key: "b", label: "change something" },
      ];
  }
}

export function describeChoice(prefs: SetupPrefs): string {
  const modeLabel = MODE_OPTIONS.find((option) => option.value === prefs.mode)?.label ?? "Shows";
  return `${modeLabel} first · every profile stays editable`;
}

export function summaryLines(prefs: SetupPrefs): readonly SummaryLine[] {
  const lines: SummaryLine[] = [];
  for (const lane of SETUP_LANGUAGE_LANES) {
    const profile = prefs.languageProfiles[lane.value];
    const audio =
      AUDIO_PREFERENCE_OPTIONS.find((option) => option.value === profile.audio)?.label ??
      profile.audio;
    const subtitle =
      SUBTITLE_PREFERENCE_OPTIONS.find((option) => option.value === profile.subtitle)?.label ??
      profile.subtitle;
    lines.push({
      ok: true,
      label: `${lane.label} language`,
      detail: `${audio} audio · ${subtitle} subtitles`,
    });
  }
  lines.push({
    ok: prefs.downloadsEnabled,
    label: prefs.downloadsEnabled ? "Downloads on" : "Downloads off",
    detail: prefs.downloadsEnabled ? prefs.downloadQuality : "stream-only · change in /settings",
  });
  const skips = [prefs.skipIntro ? "intros" : null, prefs.skipCredits ? "credits" : null].filter(
    Boolean,
  );
  lines.push({
    ok: skips.length > 0,
    label: skips.length > 0 ? "Auto-skip" : "Auto-skip off",
    detail: skips.length > 0 ? skips.join(" and ") : "nothing skipped",
  });
  lines.push({
    ok: prefs.autoNext,
    label: prefs.autoNext ? "Autoplay on" : "Autoplay off",
    detail: prefs.autoNext ? "next episode rolls on" : "stops after each episode",
  });
  if (prefs.analyticsChoice !== "unchanged") {
    lines.push({
      ok: prefs.analyticsChoice === "enabled",
      label: prefs.analyticsChoice === "enabled" ? "Usage ping on" : "Usage ping off",
      detail: "change any time in /settings",
    });
  }
  // Accounts are linked after the wizard commits, so they are reported as
  // pending rather than done — saying "connected" before the browser has even
  // opened would be the kind of small lie that erodes the rest.
  if (prefs.connectAniList) {
    lines.push({
      ok: false,
      label: "AniList",
      detail: "opens after setup — your browser finishes the link",
    });
  }
  if (prefs.connectTmdb) {
    lines.push({
      ok: false,
      label: "TMDB",
      detail: "opens after setup — your browser finishes the link",
    });
  }
  if (prefs.presenceDiscord) {
    lines.push({
      ok: false,
      label: "Discord presence",
      detail: "connects when Discord is running",
    });
  }
  return lines;
}

export function outstandingLines(rows: readonly ScopedDependencyRow[]): readonly SummaryLine[] {
  return rows
    .filter((row) => row.state !== "ok" && row.fix !== null)
    .map((row) => ({ ok: false, label: row.name, detail: row.detail }));
}
