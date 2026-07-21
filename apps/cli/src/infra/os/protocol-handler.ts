import { mkdir } from "node:fs/promises";
import { join } from "node:path";

export type LinuxProtocolHandlerPaths = {
  readonly applicationsDir: string;
  readonly desktopPath: string;
};

export type ProtocolHandlerInstallPlan = {
  readonly supported: boolean;
  readonly writes: readonly { readonly path: string; readonly contents: string }[];
  readonly commands: readonly (readonly string[])[];
  readonly notes: readonly string[];
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

export function buildProtocolHandlerInstallPlan({
  platform = process.platform,
  executable = Bun.which("kunai") ?? process.argv[1] ?? "kunai",
  home = process.env.HOME,
  xdgDataHome = process.env.XDG_DATA_HOME,
}: {
  readonly platform?: NodeJS.Platform;
  readonly executable?: string;
  readonly home?: string;
  readonly xdgDataHome?: string;
} = {}): ProtocolHandlerInstallPlan {
  if (platform !== "linux") {
    return {
      supported: false,
      writes: [],
      commands: [],
      notes: [
        "Automatic kunai:// registration is implemented on Linux only.",
        "macOS and Windows should be handled by a packaged installer so the OS owns the protocol association.",
        "Every kunai:// launch still opens Kunai with local confirmation before playback or download starts.",
      ],
    };
  }

  const paths = resolveLinuxProtocolHandlerPaths({ home, xdgDataHome });
  return {
    supported: true,
    writes: [
      {
        path: paths.desktopPath,
        contents: buildLinuxProtocolDesktopEntry(executable),
      },
    ],
    commands: [["xdg-mime", "default", "kunai-protocol-handler.desktop", "x-scheme-handler/kunai"]],
    notes: [
      "Registers kunai:// links to call kunai --handoff-url %u.",
      "The handoff parser accepts only safe playback/download intents and requires local confirmation.",
    ],
  };
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
  const plan = buildProtocolHandlerInstallPlan({ executable, home, xdgDataHome });
  if (!plan.supported) {
    throw new Error(plan.notes.join(" "));
  }

  const paths = resolveLinuxProtocolHandlerPaths({ home, xdgDataHome });
  await mkdir(paths.applicationsDir, { recursive: true });
  const desktopEntry = plan.writes.find((write) => write.path === paths.desktopPath);
  await Bun.write(
    paths.desktopPath,
    desktopEntry?.contents ?? buildLinuxProtocolDesktopEntry(executable),
  );

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
