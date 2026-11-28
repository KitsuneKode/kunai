import { stripCurrentLabel } from "@/domain/current-label";
import { isProviderEnabled, setProviderEnabled } from "@/domain/provider/provider-switches";

import {
  applyAnimeProviderOrder,
  applySeriesProviderOrder,
  applyYoutubeProviderOrder,
  resolveAnimeProviderOrder,
  resolveSeriesProviderOrder,
  resolveYoutubeProviderOrder,
} from "../provider-order";
import type { SettingRowDef, SettingsRegistryContext } from "../types";
import { configLabel, describeVideasySessionToken } from "./shared";

function providerEnumOptions(ctx: SettingsRegistryContext, kind: "series" | "anime" | "youtube") {
  const options =
    kind === "series"
      ? ctx.seriesProviderOptions
      : kind === "anime"
        ? ctx.animeProviderOptions
        : ctx.youtubeProviderOptions;
  return options.map((option) => ({
    value: option.value,
    label: stripCurrentLabel(option.label),
    detail: option.detail,
  }));
}

function providerToggleRows(
  ctx: SettingsRegistryContext,
  kind: "series" | "anime" | "youtube",
): SettingRowDef[] {
  const options =
    kind === "series"
      ? ctx.seriesProviderOptions
      : kind === "anime"
        ? ctx.animeProviderOptions
        : ctx.youtubeProviderOptions;
  return options.map((option): SettingRowDef => ({
    kind: "boolean",
    id: `provider:enabled:${option.value}`,
    effectTiming: "next-playback",
    configKeys: ["disabledProviders"],
    label: `Enable ${stripCurrentLabel(option.label)}`,
    detail:
      kind === "series"
        ? "Movies and series: off removes it from resolve and fallback"
        : kind === "anime"
          ? "Anime: off removes it from resolve and fallback"
          : "YouTube: off removes it from resolve and fallback",
    read: (config) => isProviderEnabled(config.disabledProviders, option.value),
    write: (config, value) => ({
      ...config,
      disabledProviders: setProviderEnabled(config.disabledProviders, option.value, value),
    }),
  }));
}

export function providerSettingsRows(ctx: SettingsRegistryContext): SettingRowDef[] {
  return [
    {
      kind: "section",
      id: "section:sources",
      label: "Sources",
      tabLabel: "Sources",
      detail: "Providers, fallback order, switches, relay, and YouTube metadata",
    },
    {
      kind: "subheading",
      id: "subheading:providers",
      label: "Providers",
      detail: "Choose a default provider and order your automatic fallbacks",
    },
    {
      kind: "enum",
      id: "provider",
      effectTiming: "next-playback",
      configKeys: ["provider"],
      label: "Movies and series provider",
      detail: "Movies and series: used on new searches until you pick another provider",
      options: providerEnumOptions(ctx, "series"),
      presentation: "submenu",
      read: (config) => config.provider,
      write: (config, value) => ({ ...config, provider: value }),
    },
    {
      kind: "enum",
      id: "animeProvider",
      effectTiming: "next-playback",
      configKeys: ["animeProvider"],
      label: "Anime provider",
      detail: "Anime mode default: used on new anime searches until changed in-session",
      options: providerEnumOptions(ctx, "anime"),
      presentation: "submenu",
      read: (config) => config.animeProvider,
      write: (config, value) => ({ ...config, animeProvider: value }),
    },
    {
      kind: "enum",
      id: "youtubeProvider",
      effectTiming: "next-playback",
      configKeys: ["youtubeProvider"],
      gate: { predicate: () => ctx.youtubeProviderOptions.length > 1 },
      label: "YouTube provider",
      detail: "YouTube mode default: used on new YouTube searches until changed in-session",
      options: providerEnumOptions(ctx, "youtube"),
      presentation: "submenu",
      read: (config) => config.youtubeProvider,
      write: (config, value) => ({ ...config, youtubeProvider: value }),
    },
    {
      kind: "reorder",
      id: "providerPriority",
      effectTiming: "next-playback",
      configKeys: ["provider", "providerPriority"],
      label: configLabel("providerPriority"),
      detail: "Try order for movies and series — first entry is default, rest are fallbacks",
      resolveOrder: resolveSeriesProviderOrder,
      applyOrder: applySeriesProviderOrder,
      providerOptions: (orderCtx) => orderCtx.seriesProviderOptions,
    },
    {
      kind: "reorder",
      id: "animeProviderPriority",
      effectTiming: "next-playback",
      configKeys: ["animeProvider", "animeProviderPriority"],
      label: configLabel("animeProviderPriority"),
      detail:
        "Your configured anime fallback order; the provider picker offers every available provider",
      resolveOrder: resolveAnimeProviderOrder,
      applyOrder: applyAnimeProviderOrder,
      providerOptions: (orderCtx) => orderCtx.animeProviderOptions,
    },
    {
      kind: "reorder",
      id: "youtubeProviderPriority",
      effectTiming: "next-playback",
      configKeys: ["youtubeProvider", "youtubeProviderPriority"],
      gate: { predicate: () => ctx.youtubeProviderOptions.length > 1 },
      label: configLabel("youtubeProviderPriority"),
      detail: "Try order for YouTube — first entry is default, rest are fallbacks",
      resolveOrder: resolveYoutubeProviderOrder,
      applyOrder: applyYoutubeProviderOrder,
      providerOptions: (orderCtx) => orderCtx.youtubeProviderOptions,
    },
    {
      kind: "subheading",
      id: "subheading:provider-toggles",
      label: "Provider switches",
      detail: "Off providers stay off; enable a provider to restore an empty lane",
      configKeys: ["disabledProviders"],
    },
    ...providerToggleRows(ctx, "series"),
    ...providerToggleRows(ctx, "anime"),
    ...providerToggleRows(ctx, "youtube"),
    {
      kind: "text",
      id: "videasySessionToken",
      effectTiming: "next-playback",
      configKeys: ["videasySessionToken"],
      label: configLabel("videasySessionToken"),
      detail:
        "Optional — only if Videasy blocks resolves. Mint once on cineplay.to; resolution stays direct HTTP (no browser at playback)",
      placeholder: "Type your Videasy session token, then press Enter",
      sensitive: true,
      envOverride: "KUNAI_VIDEASY_SESSION_TOKEN",
      read: (config) => config.videasySessionToken,
      apply: (config, value) => ({ ...config, videasySessionToken: value.trim() }),
      validate: (value) =>
        !value.trim() || (value.trim().length >= 16 && !/\s/.test(value.trim()))
          ? null
          : "Type a Videasy session token, or clear to unset.",
    },
    {
      kind: "enum",
      id: "videasyAppId",
      effectTiming: "next-playback",
      configKeys: ["videasyAppId"],
      label: "Videasy session source",
      detail: "Match the site where you created the optional session token",
      options: [
        {
          value: "vidking",
          label: "Vidking",
          detail: "Use sessions minted by the public vidking.net embed player",
        },
        {
          value: "bc-frontend",
          label: "Cineplay",
          detail: "Use sessions created by Cineplay playback pages",
        },
      ],
      presentation: "submenu",
      read: (config) => config.videasyAppId,
      write: (config, value) =>
        value === "bc-frontend"
          ? { ...config, videasyAppId: "bc-frontend" }
          : { ...config, videasyAppId: "vidking" },
    },
    {
      kind: "status",
      id: "videasySessionTokenStatus",
      label: "Videasy session token status",
      detail: describeVideasySessionToken(ctx.config),
      tone: describeVideasySessionToken(ctx.config) === "missing" ? "warning" : "info",
    },
  ];
}
