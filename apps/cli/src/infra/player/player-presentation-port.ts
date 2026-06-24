/** Shell presentation capability injected at composition time (keeps infra off app-shell). */
export type PlayerPresentationPort = {
  readonly isInteractiveShellMounted: () => boolean;
};

export const nonInteractivePlayerPresentation: PlayerPresentationPort = {
  isInteractiveShellMounted: () => false,
};
