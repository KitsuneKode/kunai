import { buildYoutubeSubtitlePreferencePlan } from "./subtitle-language";
import { buildYtdlFormatSelector, defaultYtdlPlaybackFormat } from "./yt-dlp-metadata";
import {
  buildYoutubeMpvScriptOpts,
  buildYoutubeMpvYtdlRawOptions,
  buildYoutubeYtdlCliArgs,
  joinMpvYtdlRawOptions,
  type YoutubeYtdlOptionsInput,
} from "./ytdl-options";

export type YoutubeYtdlProfileInput = YoutubeYtdlOptionsInput & {
  readonly qualityLabel?: string;
  readonly forDownload?: boolean;
};

export type YoutubeYtdlProfile = {
  readonly cliArgs: readonly string[];
  readonly formatSelector: string;
  readonly mpvFormat: string;
  readonly mpvRawOptions?: string;
  readonly mpvScriptOpts: string;
};

export function buildYoutubeYtdlProfile(input: YoutubeYtdlProfileInput): YoutubeYtdlProfile {
  const formatSelector = input.isLive
    ? defaultYtdlPlaybackFormat()
    : buildYtdlFormatSelector(input.qualityLabel ?? "1080p");
  const cliArgs = [...buildYoutubeYtdlCliArgs(input)];
  if (input.forDownload) {
    cliArgs.push("--merge-output-format", "mp4");
    if (buildYoutubeSubtitlePreferencePlan(input.subtitleLanguage).ytdlpSubLangs) {
      cliArgs.push("--write-subs", "--write-auto-subs");
    }
  }
  return {
    cliArgs,
    formatSelector,
    mpvFormat: formatSelector,
    mpvRawOptions: joinMpvYtdlRawOptions(buildYoutubeMpvYtdlRawOptions(input)),
    mpvScriptOpts: buildYoutubeMpvScriptOpts(),
  };
}
