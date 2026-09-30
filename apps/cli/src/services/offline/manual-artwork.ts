/**
 * Power saver skips background artwork. A poster the user opened is a manual
 * request and still fetches when `powerSaverAllowManualArtwork` is on.
 */
export function manualArtworkFetchAllowed(config: {
  readonly powerSaverMode: boolean;
  readonly powerSaverAllowManualArtwork: boolean;
}): boolean {
  if (!config.powerSaverMode) return true;
  return config.powerSaverAllowManualArtwork;
}
