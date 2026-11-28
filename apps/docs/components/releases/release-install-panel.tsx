import { InstallDock } from "@/components/home/install-dock";
import { CopyButton } from "@/components/ui/copy-button";
import { CANONICAL_INSTALL, CANONICAL_SETUP, NATIVE_INSTALL_PS1 } from "@/lib/install-commands";
import type { ReleaseNotesArtifact } from "@/lib/release-notes";

type ReleaseInstallPanelProps = {
  readonly release?: ReleaseNotesArtifact | null;
  readonly showCanonical?: boolean;
};

export function ReleaseInstallPanel({
  release = null,
  showCanonical = true,
}: ReleaseInstallPanelProps) {
  const showVersioned = release?.status === "published";

  return (
    <div className="kunai-bento-tile flex flex-col gap-4 text-sm">
      {showCanonical ? (
        <>
          <p className="kunai-bento-tile__label m-0">Canonical install</p>
          <InstallDock
            unixCommand={CANONICAL_INSTALL}
            windowsCommand={NATIVE_INSTALL_PS1}
            labelPrefix="release-canonical-install"
          />
          <code className="kunai-code-row">
            <span>{CANONICAL_SETUP}</span>
            <CopyButton text={CANONICAL_SETUP} label="release-setup" />
          </code>
        </>
      ) : null}
      {showVersioned && release ? (
        <>
          <p className="kunai-bento-tile__label m-0 mt-2">Versioned package shortcuts</p>
          <code className="kunai-code-row">
            <span>{release.install.bunx}</span>
            <CopyButton text={release.install.bunx} label={`release-bunx-${release.tag}`} />
          </code>
          <code className="font-mono text-xs text-[var(--home-text-4)]">{release.install.npm}</code>
        </>
      ) : null}
    </div>
  );
}
