import { codeMetadata } from "@/lib/code-metadata";

function playbackFor(os: string): string {
  if (os === "android") {
    const targets = codeMetadata.playerSupport.androidTargets.map((target) => {
      if (target === "mpv") return "mpv-android";
      if (target === "vlc") return "VLC";
      return target;
    });
    return `${targets.join(" / ")} handoff`;
  }
  return codeMetadata.playerSupport.desktopManagedPlayers
    .map((player) => (player === "vlc" ? "VLC" : player))
    .join(" or ");
}

function installerFor(os: string): string {
  return os === "windows" ? "install.ps1" : "install.sh";
}

function statusLabel(tier: string): string {
  if (tier === "supported") return "Supported";
  if (tier === "beta") return "Beta";
  return "Experimental";
}

function targetLabel(id: string, libc: string | undefined): string {
  if (libc === "musl") return `${id} (musl)`;
  if (libc === "bionic") return `${id} (Bionic)`;
  return id;
}

export function PlatformSupportTable() {
  return (
    <div className="not-prose overflow-x-auto">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b text-left">
            <th className="py-2 pr-4 font-medium">Target</th>
            <th className="py-2 pr-4 font-medium">Playback</th>
            <th className="py-2 pr-4 font-medium">Binary install</th>
            <th className="py-2 font-medium">Status</th>
          </tr>
        </thead>
        <tbody>
          {codeMetadata.releaseTargets.map((target) => (
            <tr key={target.id} className="border-fd-border/50 border-b align-top">
              <td className="py-3 pr-4 font-mono text-xs whitespace-nowrap">
                {targetLabel(target.id, target.libc)}
              </td>
              <td className="py-3 pr-4 text-xs">{playbackFor(target.os)}</td>
              <td className="py-3 pr-4 font-mono text-xs">
                {installerFor(target.os)} → {target.out}
              </td>
              <td className="py-3 text-xs font-medium">{statusLabel(target.supportTier)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="text-fd-muted-foreground mt-2 text-xs">
        Generated from the Kunai {codeMetadata.cliVersion} release target contract.
      </p>
    </div>
  );
}
