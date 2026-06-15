export type TrailerPlaybackPort = {
  /** Play a URL in mpv (yt-dlp). Returns false if it could not start. */
  readonly playUrl: (url: string) => Promise<boolean>;
  readonly openInBrowser: (url: string) => Promise<void>;
};

/** Play a trailer in mpv, falling back to the browser when mpv/yt-dlp cannot. */
export async function playTrailer(
  port: TrailerPlaybackPort,
  url: string | undefined,
): Promise<void> {
  if (!url) return;
  let played = false;
  try {
    played = await port.playUrl(url);
  } catch {
    played = false;
  }
  if (!played) await port.openInBrowser(url);
}
