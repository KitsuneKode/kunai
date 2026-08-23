import { CopyButton } from "@/components/ui/copy-button";
import {
  BUN_GLOBAL_INSTALL,
  GITHUB_RELEASES_URL,
  NPM_GLOBAL_INSTALL,
  NPM_PACKAGE_URL,
} from "@/lib/install-commands";
import { IconExternalLink } from "@tabler/icons-react";
import Link from "next/link";

/**
 * Secondary install paths, deliberately below the three-step native flow.
 * The package-manager route needs a Node or Bun runtime already present and
 * tracks the npm dist-tag rather than the binary channel, so it is offered as
 * an alternative — never as an equal.
 */
export function OtherInstallPaths() {
  return (
    <div className="kunai-other-paths">
      <div className="kunai-other-paths__head">
        <p className="kunai-step-label m-0">Other install paths</p>
        <p className="kunai-step-meta m-0">Already have Bun or Node? Install from npm instead.</p>
      </div>

      <div className="kunai-other-paths__commands">
        <code className="kunai-code-row">
          <span>{BUN_GLOBAL_INSTALL}</span>
          <CopyButton text={BUN_GLOBAL_INSTALL} label="bun-global-install" />
        </code>
        <code className="kunai-code-row">
          <span>{NPM_GLOBAL_INSTALL}</span>
          <CopyButton text={NPM_GLOBAL_INSTALL} label="npm-global-install" />
        </code>
      </div>

      <p className="kunai-other-paths__links">
        <a href={NPM_PACKAGE_URL} target="_blank" rel="noreferrer noopener">
          npm package
          <IconExternalLink className="ml-1 inline size-3 align-[-0.1em]" stroke={1.5} />
        </a>
        <a href={GITHUB_RELEASES_URL} target="_blank" rel="noreferrer noopener">
          Prebuilt binaries
          <IconExternalLink className="ml-1 inline size-3 align-[-0.1em]" stroke={1.5} />
        </a>
        <Link href="/docs/users/getting-started">Build from source</Link>
      </p>
    </div>
  );
}
