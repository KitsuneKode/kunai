export type TmuxGraphicsContext = {
  readonly major: number;
  readonly minor: number;
  readonly passthrough: string;
  readonly clientTerm: string;
  /**
   * `client_termfeatures` of the single attached client. tmux answers DA1 for
   * itself, so this is the only evidence that the terminal behind tmux can draw
   * sixel; without `sixel` here tmux replaces the image with placeholder text.
   */
  readonly clientFeatures: readonly string[];
};

export function isTmuxPane(env: NodeJS.ProcessEnv): boolean {
  return Boolean(env.TMUX && !env.STY && !env.ZELLIJ && !env.ZELLIJ_SESSION_NAME);
}

export function tmuxSupportsVersion(tmux: TmuxGraphicsContext, minor: number): boolean {
  return tmux.major > 3 || (tmux.major === 3 && tmux.minor >= minor);
}

export function canUseTmuxPassthrough(
  env: NodeJS.ProcessEnv,
  tmux: TmuxGraphicsContext | undefined,
): boolean {
  return Boolean(
    tmux &&
    isTmuxPane(env) &&
    env.KUNAI_IMAGE_TMUX !== "0" &&
    tmuxSupportsVersion(tmux, 3) &&
    (tmux.passthrough === "on" || tmux.passthrough === "all") &&
    tmux.clientTerm &&
    !/^(?:screen|tmux)(?:-|$)/i.test(tmux.clientTerm),
  );
}

export function tmuxClientHasKitty(tmux: TmuxGraphicsContext | undefined): boolean {
  // Pane KITTY_WINDOW_ID and TERM_PROGRAM can survive a reattach from another
  // terminal. The attached client's TERM identifies the current outer terminal.
  return tmux?.clientTerm === "xterm-kitty" || tmux?.clientTerm === "xterm-ghostty";
}

export async function readTmuxGraphicsContext(
  env: NodeJS.ProcessEnv,
): Promise<TmuxGraphicsContext | undefined> {
  if (!isTmuxPane(env) || !env.TMUX_PANE || !/^%\d+$/.test(env.TMUX_PANE)) return;
  try {
    // Read the server version and effective pane option, including overrides.
    const command = Bun.spawn(
      [
        "tmux",
        "display-message",
        "-p",
        "-t",
        env.TMUX_PANE,
        "#{version}|#{allow-passthrough}|#{client_termname}|#{session_attached}|#{client_termfeatures}",
      ],
      { env, stdout: "pipe", stderr: "ignore", timeout: 100 },
    );
    const [output, code] = await Promise.all([command.stdout.text(), command.exited]);
    if (code !== 0) return;
    const [version, passthrough = "", clientTerm = "", attached, features = ""] = output
      .trim()
      .split("|");
    const parts = /^(\d+)\.(\d+)[a-z]*$/.exec(version ?? "");
    if (!parts) return;
    // With multiple clients we cannot assume every receiver speaks Kitty.
    return {
      major: Number(parts[1]),
      minor: Number(parts[2]),
      passthrough,
      clientTerm: attached === "1" ? clientTerm : "",
      clientFeatures: attached === "1" ? features.split(",").filter(Boolean) : [],
    };
  } catch {
    return;
  }
}

export function wrapTmuxPassthrough(escape: string): string {
  return `\x1bPtmux;${escape.replaceAll("\x1b", "\x1b\x1b")}\x1b\\`;
}
