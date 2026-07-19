import { CopyButton } from "@/components/ui/copy-button";
import { CANONICAL_INSTALL, CANONICAL_SETUP } from "@/lib/install-commands";
import type { ReleaseNotesArtifact } from "@/lib/release-notes";

type ReleaseInstallPanelProps = {
  readonly release?: ReleaseNotesArtifact | null;
  readonly showCanonical?: boolean;
};

export function ReleaseInstallPanel({
  release = null,
  showCanonical = true,
}: ReleaseInstallPanelProps) {
  return (
    <div className="border-fd-border bg-fd-background flex flex-col gap-3 rounded-md border p-4 text-sm">
      {showCanonical ? (
        <>
          <p className="kunai-type-caption m-0">Canonical install</p>
          <code className="kunai-code-row">
            <span>{CANONICAL_INSTALL}</span>
            <CopyButton text={CANONICAL_INSTALL} label="release-canonical-install" />
          </code>
          <code className="kunai-code-row">
            <span>{CANONICAL_SETUP}</span>
            <CopyButton text={CANONICAL_SETUP} label="release-setup" />
          </code>
        </>
      ) : null}
      {release ? (
        <>
          <p className="kunai-type-caption m-0 mt-2">Versioned package shortcuts</p>
          <code className="kunai-code-row">
            <span>{release.install.bunx}</span>
            <CopyButton text={release.install.bunx} label={`release-bunx-${release.tag}`} />
          </code>
          <code className="text-fd-muted-foreground font-mono text-xs">{release.install.npm}</code>
        </>
      ) : null}
    </div>
  );
}
