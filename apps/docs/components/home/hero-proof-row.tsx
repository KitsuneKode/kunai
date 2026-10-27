import { NPM_PACKAGE_NAME, NPM_PACKAGE_URL } from "@/lib/install-commands";
import { IconExternalLink } from "@tabler/icons-react";
import Link from "next/link";

type HeroProofRowProps = {
  readonly publishedVersion?: string;
  readonly providerCount: number;
};

/**
 * The four facts a visitor needs before they will paste a shell command:
 * what it costs them, what it runs, how many providers, and where the package
 * lives. Every value is derived — none is written down twice.
 */
export function HeroProofRow({ publishedVersion, providerCount }: HeroProofRowProps) {
  return (
    <ul className="kunai-proof-row">
      <li>
        <Link href="/releases">
          {publishedVersion ? (
            <>
              v<span className="tabular-nums">{publishedVersion}</span>
            </>
          ) : (
            "Release notes"
          )}
        </Link>
      </li>
      <li>
        <Link href="/docs/users/providers">
          <span className="tabular-nums">{providerCount}</span> direct providers
        </Link>
      </li>
      <li>
        <a href={NPM_PACKAGE_URL} target="_blank" rel="noreferrer noopener">
          {NPM_PACKAGE_NAME}
          <IconExternalLink className="ml-1 inline size-3 align-[-0.1em]" stroke={1.5} />
        </a>
      </li>
      <li>
        <a
          href="https://github.com/KitsuneKode/kunai/blob/main/LICENSE"
          target="_blank"
          rel="noreferrer noopener"
        >
          MIT licensed
        </a>
      </li>
    </ul>
  );
}
