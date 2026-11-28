import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { renderInstaller } from "../../../../scripts/packaging/render-installers";
import { createReleaseArchive } from "../../scripts/build-release-archives";
import { RELEASE_BINARY_TARGETS } from "../../src/services/update/platform-assets";
import {
  releaseSigningKeys,
  SIGNED_STATEMENT_SCENARIOS,
  signStatement,
  statementFor,
} from "../support/release-signing";
import {
  createInstallerSandbox,
  hostInstallShAsset,
  withCommandPath,
  withReleaseFixture,
  withSyntheticWindowsPayload,
} from "./helpers/installer-script-harness";

function installerShell(name: string) {
  return name === "install.ps1"
    ? Bun.which("pwsh")
    : process.platform !== "win32" && Bun.which("bash");
}

/** An OpenSSL that can verify raw Ed25519 (`pkeyutl -rawin`, OpenSSL 3+). */
function realOpenSsl3(): string | undefined {
  const candidates = [
    Bun.which("openssl"),
    "/opt/homebrew/opt/openssl@3/bin/openssl",
    "/usr/local/opt/openssl@3/bin/openssl",
  ];
  for (const candidate of candidates) {
    if (!candidate || !existsSync(candidate)) continue;
    const help = Bun.spawnSync([candidate, "pkeyutl", "-help"]);
    if (/^\s*-rawin(\s|$)/m.test(help.stdout.toString() + "\n" + help.stderr.toString()))
      return candidate;
  }
  return undefined;
}

const SCENARIOS = [
  ...SIGNED_STATEMENT_SCENARIOS,
  "tampered manifest",
  "missing",
  "unsigned archive",
  "signed archive",
  "LibreSSL first on PATH",
] as const;
type Scenario = (typeof SCENARIOS)[number];

const VERSION = "1.2.3";

for (const name of ["install.sh", "install.ps1"] as const) {
  const shell = installerShell(name);
  const openssl3 = realOpenSsl3();
  test.skipIf(!shell || !openssl3).each(SCENARIOS)(
    `${name} enforces its embedded key: %s`,
    async (scenario: Scenario) => {
      if (!shell || !openssl3) throw new Error("Missing shell or OpenSSL 3");
      // POSIX shims only: this reproduces Apple's LibreSSL /usr/bin/openssl.
      if (scenario === "LibreSSL first on PATH" && process.platform === "win32") return;
      const sandbox = createInstallerSandbox("signed-install");
      try {
        const { privateKey, spki } = releaseSigningKeys();
        const script = join(sandbox.root, name);
        const windows = name === "install.ps1";
        const source = renderInstaller(name, spki);
        writeFileSync(script, windows ? withSyntheticWindowsPayload(source) : source);
        const asset = windows
          ? `kunai-windows-${process.arch === "arm64" ? "arm64" : "x64"}.exe`
          : hostInstallShAsset();
        const body = "#!/bin/sh\nexit 0\n";
        const sums = createHash("sha256").update(body).digest("hex") + "  " + asset + "\n";
        const statement = statementFor(scenario);
        const signedManifest = scenario === "tampered manifest" ? sums + "\n" : sums;
        const prefix = `/download/v${VERSION}/`;
        // The release path every published archive takes: a signed
        // SHA256SUMS.archives selects the archive, its member is then checked
        // against the signed SHA256SUMS, and the raw asset is never fetched.
        const target = RELEASE_BINARY_TARGETS.find((candidate) => candidate.out === asset);
        if (!target) throw new Error(`Missing release target for ${asset}`);
        const archive =
          scenario === "signed archive"
            ? createReleaseArchive(target, new TextEncoder().encode(body))
            : undefined;
        const archiveSums = archive
          ? `${createHash("sha256").update(archive).digest("hex")}  ${target.archiveName}\n`
          : sums;

        let env: NodeJS.ProcessEnv = {
          ...sandbox.env,
          KUNAI_DOWNLOAD_MAX_ATTEMPTS: "1",
        };
        if (scenario === "LibreSSL first on PATH") {
          const shims = join(sandbox.root, "shims");
          // A keg-only Homebrew OpenSSL 3 under `brew --prefix`.
          const brewPrefix = join(sandbox.root, "homebrew");
          const keg = join(brewPrefix, "opt", "openssl@3", "bin");
          mkdirSync(shims);
          mkdirSync(keg, { recursive: true });
          symlinkSync(openssl3, join(keg, "openssl"));
          writeFileSync(
            join(shims, "openssl"),
            // Apple's LibreSSL: no -rawin in its help, and rejects it by name.
            '#!/bin/sh\nif [ "$2" = -help ]; then printf "Usage: pkeyutl [options]\\n -in file   input file\\n" >&2; exit 1; fi\necho "pkeyutl: Option unknown option -rawin" >&2\nexit 1\n',
            { mode: 0o755 },
          );
          writeFileSync(
            join(shims, "brew"),
            `#!/bin/sh\n[ "$*" = "--prefix" ] && echo '${brewPrefix}' && exit 0\nexit 1\n`,
            { mode: 0o755 },
          );
          env = withCommandPath(env, shims);
        }

        await withReleaseFixture(
          {
            [prefix + asset]: { body },
            [prefix + "SHA256SUMS"]: { body: sums },
            [prefix + "SHA256SUMS.archives"]:
              scenario === "unsigned archive" || archive ? { body: archiveSums } : { status: 404 },
            [prefix + target.archiveName]: archive ? { body: archive } : { status: 404 },
            [prefix + "SHA256SUMS.archives.sig"]: archive
              ? {
                  body: signStatement(
                    privateKey,
                    "valid",
                    VERSION,
                    "SHA256SUMS.archives",
                    archiveSums,
                  ),
                }
              : { status: 404 },
            [prefix + "SHA256SUMS.sig"]:
              scenario === "missing"
                ? { status: 404 }
                : {
                    body: signStatement(
                      privateKey,
                      statement,
                      VERSION,
                      "SHA256SUMS",
                      signedManifest,
                    ),
                  },
          },
          async (base, evidence) => {
            const args = windows
              ? ["-NoProfile", "-File", script, "-Version", VERSION, "-Yes", "-SkipDeps"]
              : [script, "--version", VERSION, "--yes", "--skip-deps"];
            const child = Bun.spawn([shell, ...args], {
              stdout: "pipe",
              stderr: "pipe",
              env: { ...env, KUNAI_DL_BASE: base },
            });
            const [stdout, stderr, status] = await Promise.all([
              new Response(child.stdout).text(),
              new Response(child.stderr).text(),
              child.exited,
            ]);
            const accepted =
              scenario === "valid" ||
              scenario === "signed archive" ||
              scenario === "LibreSSL first on PATH";
            if (accepted !== (status === 0)) throw new Error(stdout + stderr);
            expect(existsSync(join(sandbox.configDir, "install.json"))).toBe(accepted);
            if (archive) {
              expect(evidence.requests).toContain(prefix + "SHA256SUMS.archives.sig");
              expect(evidence.requests).toContain(prefix + target.archiveName);
              expect(evidence.requests).not.toContain(prefix + asset);
              expect(
                JSON.parse(readFileSync(join(sandbox.configDir, "install.json"), "utf8")),
              ).toMatchObject({
                archiveName: target.archiveName,
                archiveSha256: createHash("sha256").update(archive).digest("hex"),
                artifactName: asset,
              });
            }
            if (accepted) return;
            // Rejected before the binary is fetched, let alone activated.
            expect(evidence.requests).not.toContain(prefix + asset);
            // A missing verifier must not pass for a rejected signature.
            expect(stdout + stderr).not.toMatch(/require OpenSSL 3/i);
            expect(stdout + stderr).toMatch(
              scenario === "missing" || scenario === "unsigned archive"
                ? /signature/i
                : /signature verification failed/i,
            );
          },
        );
      } finally {
        sandbox.cleanup();
      }
    },
  );
}
