export function shouldFetchPlaybackTiming(input: {
  readonly networkAllowed: boolean;
  readonly hasTiming: boolean;
}): boolean {
  return input.networkAllowed && !input.hasTiming;
}
