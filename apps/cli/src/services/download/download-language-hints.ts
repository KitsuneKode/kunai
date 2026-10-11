import type { ShellMode } from "@/domain/types";
import { resolveAnimeAudioIntent } from "@kunai/providers";

/** Maps session/profile language fields into columns stored on download_jobs for re-resolve. */
export function persistLanguageHintsFromEnqueueInput(input: {
  readonly mode?: ShellMode;
  readonly audioPreference?: string;
  readonly subtitlePreference?: string;
}): { readonly subLang?: string; readonly animeLang?: "sub" | "dub" } {
  const subtitle = input.subtitlePreference?.trim();
  const subLang = subtitle && subtitle.length > 0 ? subtitle : "eng";
  if (input.mode === "anime") {
    return {
      subLang,
      animeLang: resolveAnimeAudioIntent(input.audioPreference ?? "").catalogMode,
    };
  }
  return { subLang };
}
