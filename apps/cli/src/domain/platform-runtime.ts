export function isAndroidRuntime(
  platform: string,
  env: Readonly<Record<string, string | undefined>>,
): boolean {
  return (
    platform === "android" ||
    Boolean(env["TERMUX_VERSION"]) ||
    Boolean(env["ANDROID_ROOT"]) ||
    env["PREFIX"]?.includes("com.termux") === true
  );
}
