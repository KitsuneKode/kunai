/**
 * Whether this launch needs yt-dlp at startup. A YouTube share link needs it as
 * much as `-y` or a saved youtube mode does; it used to be checked only from
 * the flag and the saved mode, before the link was considered, so a shared
 * video started without the check that explains a missing yt-dlp.
 */
export function launchNeedsYtDlp(
  args: { readonly offline?: boolean; readonly youtube?: boolean },
  savedMode: string | undefined,
  shareKind: string | undefined,
): boolean {
  if (args.offline) return false;
  return Boolean(args.youtube) || savedMode === "youtube" || shareKind === "video";
}
