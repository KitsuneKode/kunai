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
  readonly audioLanguage?: string;
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
    ? defaultYtdlPlaybackFormat(input.audioLanguage)
    : input.forDownload
      ? buildYtdlFormatSelector(input.qualityLabel, input.audioLanguage)
      : buildYtdlFormatSelector(input.qualityLabel ?? "1080p", input.audioLanguage);
  // Downloads fetch the chosen subtitle sidecar separately in DownloadService and
  // delete yt-dlp's staging directory on completion. Passing `--sub-langs all
  // --write-subs --write-auto-subs` here caused yt-dlp to issue ~940 subtitle
  // HTTP requests before byte 1 of video and abort the whole job on a single 429.
  const cliArgs = [
    ...buildYoutubeYtdlCliArgs(input.forDownload ? { ...input, subtitleLanguage: "none" } : input),
  ];
  if (input.forDownload) {
    cliArgs.push("--merge-output-format", "mp4");
  }
  return {
    cliArgs,
    formatSelector,
    mpvFormat: formatSelector,
    mpvRawOptions: joinMpvYtdlRawOptions(buildYoutubeMpvYtdlRawOptions(input)),
    mpvScriptOpts: buildYoutubeMpvScriptOpts(),
  };
}
