import { stripCurrentLabel } from "@/domain/current-label";

import {
  applyAnimeProviderOrder,
  applySeriesProviderOrder,
  applyYoutubeProviderOrder,
  describeProviderOrder,
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

export function providerSettingsRows(ctx: SettingsRegistryContext): SettingRowDef[] {
  return [
    {
      kind: "section",
      id: "section:providers",
      label: "Providers",
      detail: "Choose a default provider and order your automatic fallbacks",
    },
    {
      kind: "enum",
      id: "provider",
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
      label: configLabel("providerPriority"),
      detail: "Try order for movies and series — first entry is default, rest are fallbacks",
      resolveOrder: resolveSeriesProviderOrder,
      applyOrder: applySeriesProviderOrder,
      providerOptions: (orderCtx) => orderCtx.seriesProviderOptions,
    },
    {
      kind: "reorder",
      id: "animeProviderPriority",
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
      gate: { predicate: () => ctx.youtubeProviderOptions.length > 1 },
      label: configLabel("youtubeProviderPriority"),
      detail: "Try order for YouTube — first entry is default, rest are fallbacks",
      resolveOrder: resolveYoutubeProviderOrder,
      applyOrder: applyYoutubeProviderOrder,
      providerOptions: (orderCtx) => orderCtx.youtubeProviderOptions,
    },
    {
      kind: "text",
      id: "videasySessionToken",
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

export function summarizeProviderOrder(config: SettingsRegistryContext["config"]): string {
  return describeProviderOrder(resolveSeriesProviderOrder(config));
}
