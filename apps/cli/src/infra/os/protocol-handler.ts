import { mkdir } from "node:fs/promises";
import { join } from "node:path";

export type LinuxProtocolHandlerPaths = {
  readonly applicationsDir: string;
  readonly desktopPath: string;
};

export function resolveLinuxProtocolHandlerPaths({
  home,
  xdgDataHome,
}: {
  readonly home: string | undefined;
  readonly xdgDataHome: string | undefined;
}): LinuxProtocolHandlerPaths {
  const dataHome = xdgDataHome || join(home || process.cwd(), ".local", "share");
  const applicationsDir = join(dataHome, "applications");
  return {
    applicationsDir,
    desktopPath: join(applicationsDir, "kunai-protocol-handler.desktop"),
  };
}

export function buildLinuxProtocolDesktopEntry(executable: string): string {
  return [
    "[Desktop Entry]",
    "Type=Application",
    "Name=Kunai",
    "Comment=Open safe Kunai playback and download handoff links",
    `Exec=${quoteDesktopExecToken(executable)} --handoff-url %u`,
    "Terminal=true",
    "NoDisplay=true",
    "Categories=AudioVideo;Player;",
    "MimeType=x-scheme-handler/kunai;",
    "",
  ].join("\n");
}

export async function installKunaiProtocolHandler({
  executable = Bun.which("kunai") ?? process.argv[1] ?? "kunai",
  home = process.env.HOME,
  xdgDataHome = process.env.XDG_DATA_HOME,
}: {
  readonly executable?: string;
  readonly home?: string;
  readonly xdgDataHome?: string;
} = {}): Promise<LinuxProtocolHandlerPaths> {
  if (process.platform !== "linux") {
    throw new Error(
      "Automatic kunai:// protocol registration is currently supported on Linux only",
    );
  }

  const paths = resolveLinuxProtocolHandlerPaths({ home, xdgDataHome });
  await mkdir(paths.applicationsDir, { recursive: true });
  await Bun.write(paths.desktopPath, buildLinuxProtocolDesktopEntry(executable));

  const xdgMime = Bun.which("xdg-mime");
  if (xdgMime) {
    const proc = Bun.spawn([
      xdgMime,
      "default",
      "kunai-protocol-handler.desktop",
      "x-scheme-handler/kunai",
    ]);
    const code = await proc.exited;
    if (code !== 0) {
      throw new Error(`xdg-mime failed while registering kunai:// handler (exit ${code})`);
    }
  }

  return paths;
}

function quoteDesktopExecToken(value: string): string {
  return `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}
