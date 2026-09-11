export type AndroidIntentTarget = "chooser" | "mpv" | "vlc";
export type AndroidIntentLauncher = "termux-am" | "am" | "termux-open" | "termux-open-url";

export type AndroidIntentPlan =
  | {
      readonly ok: true;
      readonly launcher: AndroidIntentLauncher;
      readonly argv: readonly string[];
    }
  | { readonly ok: false; readonly reason: "intent-launcher-missing" };

export type AndroidIntentLaunchers = {
  readonly termuxAm?: string;
  readonly am?: string;
  readonly termuxOpen?: string;
  readonly termuxOpenUrl?: string;
};

const PLAYER_PACKAGES = {
  mpv: "is.xyz.mpv",
  vlc: "org.videolan.vlc",
} as const;

function actionViewArgv(
  executable: string,
  target: AndroidIntentTarget,
  url: string,
): readonly string[] {
  const argv = [
    executable,
    "start",
    "-a",
    "android.intent.action.VIEW",
    "-d",
    url,
    "-t",
    "video/*",
  ];
  if (target !== "chooser") argv.push("-p", PLAYER_PACKAGES[target]);
  return argv;
}

export function resolveAndroidIntentPlan(input: {
  readonly target: AndroidIntentTarget;
  readonly url: string;
  readonly launchers: AndroidIntentLaunchers;
}): AndroidIntentPlan {
  if (input.launchers.termuxAm) {
    return {
      ok: true,
      launcher: "termux-am",
      argv: actionViewArgv(input.launchers.termuxAm, input.target, input.url),
    };
  }
  if (input.launchers.am) {
    return {
      ok: true,
      launcher: "am",
      argv: actionViewArgv(input.launchers.am, input.target, input.url),
    };
  }
  if (input.target === "chooser" && input.launchers.termuxOpen) {
    return {
      ok: true,
      launcher: "termux-open",
      argv: [
        input.launchers.termuxOpen,
        "--view",
        "--chooser",
        "--content-type",
        "video/*",
        input.url,
      ],
    };
  }
  if (input.target === "chooser" && input.launchers.termuxOpenUrl) {
    return {
      ok: true,
      launcher: "termux-open-url",
      argv: [input.launchers.termuxOpenUrl, input.url],
    };
  }
  return { ok: false, reason: "intent-launcher-missing" };
}
