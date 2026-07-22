import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

import type { LocalPackageCandidate } from "../../../../../scripts/npm-publication-plan";
import {
  buildLocalPackageCandidates,
  type CommandPort,
  createNpmRegistryPort,
  parsePublishArgs,
  reconcileNpmPublication,
  type RegistryPackageMetadata,
  type RegistryPort,
} from "../../../../../scripts/publish-npm-release";

const PLATFORM_IDS = [
  "linux-x64",
  "linux-x64-musl",
  "linux-arm64",
  "linux-arm64-musl",
  "darwin-x64",
  "darwin-arm64",
  "windows-x64",
  "windows-arm64",
] as const;

const CANDIDATE_FIXTURE_ROOT = mkdtempSync(join(tmpdir(), "kunai-publication-plan-"));
afterAll(() => rmSync(CANDIDATE_FIXTURE_ROOT, { recursive: true, force: true }));

function candidates(version = "1.2.3"): LocalPackageCandidate[] {
  const result = [
    ...PLATFORM_IDS.map((id) => ({
      name: `@kitsunekode/kunai-${id}`,
      version,
      tarballPath: join(CANDIDATE_FIXTURE_ROOT, `${id}.tgz`),
      integrity: `sha512-${Buffer.from(id).toString("base64")}`,
      role: "platform" as const,
    })),
    {
      name: "@kitsunekode/kunai",
      version,
      tarballPath: join(CANDIDATE_FIXTURE_ROOT, "kunai-npm.tgz"),
      integrity: `sha512-${Buffer.from("launcher").toString("base64")}`,
      role: "launcher" as const,
    },
  ];
  for (const candidate of result) writeFileSync(candidate.tarballPath, candidate.name);
  return result;
}

function metadata(candidate: LocalPackageCandidate): RegistryPackageMetadata {
  return {
    name: candidate.name,
    version: candidate.version,
    integrity: candidate.integrity,
  };
}

describe("local npm publication candidates", () => {
  test("packs canonical platform inputs and inspects the preserved launcher tarball", async () => {
    const root = mkdtempSync(join(tmpdir(), "kunai-publication-candidates-"));
    const platformDirectory = join(root, "npm-platform");
    const tarballDirectory = join(root, "tarballs");
    const launcherTarballPath = join(root, "kunai-npm.tgz");
    const launcherManifestPath = join(root, "package.json");
    mkdirSync(platformDirectory, { recursive: true });
    writeFileSync(launcherTarballPath, "preserved launcher bytes");
    writeFileSync(
      launcherManifestPath,
      JSON.stringify({ name: "@kitsunekode/kunai", version: "1.2.3" }),
    );

    const commands: string[][] = [];
    const command: CommandPort = async (request) => {
      commands.push([request.command, ...request.args]);
      const source = request.args.at(-1)!;
      if (source === launcherTarballPath) {
        return {
          exitCode: 0,
          stdout: JSON.stringify([
            {
              name: "@kitsunekode/kunai",
              version: "1.2.3",
              integrity: `sha512-${Buffer.from("launcher").toString("base64")}`,
              filename: basename(launcherTarballPath),
            },
          ]),
          stderr: "",
        };
      }

      const id = basename(source);
      const filename = `${id}.tgz`;
      mkdirSync(tarballDirectory, { recursive: true });
      writeFileSync(join(tarballDirectory, filename), `packed ${id}`);
      return {
        exitCode: 0,
        stdout: JSON.stringify([
          {
            name: `@kitsunekode/kunai-${id}`,
            version: "1.2.3",
            integrity: `sha512-${Buffer.from(id).toString("base64")}`,
            filename,
          },
        ]),
        stderr: "",
      };
    };

    try {
      const result = await buildLocalPackageCandidates({
        command,
        launcherManifestPath,
        launcherTarballPath,
        platformDirectory,
        platformTarballDirectory: tarballDirectory,
      });

      expect(result.map((candidate) => candidate.name)).toEqual([
        ...PLATFORM_IDS.map((id) => `@kitsunekode/kunai-${id}`),
        "@kitsunekode/kunai",
      ]);
      const expectedRoles: LocalPackageCandidate["role"][] = [
        ...PLATFORM_IDS.map((): LocalPackageCandidate["role"] => "platform"),
        "launcher" as const,
      ];
      expect(result.map((candidate) => candidate.role)).toEqual(expectedRoles);
      expect(commands.slice(0, 8).every((invocation) => invocation[0] === "npm")).toBe(true);
      expect(
        commands.slice(0, 8).every((invocation) => invocation.includes("--pack-destination")),
      ).toBe(true);
      expect(commands.at(-1)).toEqual([
        "npm",
        "pack",
        "--json",
        "--dry-run",
        "--ignore-scripts",
        launcherTarballPath,
      ]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("validates all candidates before any registry work", async () => {
    const localCandidates = candidates();
    localCandidates[4] = { ...localCandidates[4]!, integrity: "" };
    let registryCalls = 0;

    await expect(
      reconcileNpmPublication({
        candidates: localCandidates,
        confirmed: false,
        command: async () => ({ exitCode: 0, stdout: "", stderr: "" }),
        registry: {
          queryIntegrity: async () => {
            registryCalls += 1;
            return null;
          },
          queryMetadata: async () => null,
        },
      }),
    ).rejects.toThrow(/integrity/i);
    expect(registryCalls).toBe(0);
  });
});

describe("npm registry error classification", () => {
  test("treats only npm E404 not-found output as an absent version", async () => {
    const candidate = candidates()[0]!;
    const packageSpec = `${candidate.name}@${candidate.version}`;
    const calls: string[][] = [];
    const registry = createNpmRegistryPort(async (request) => {
      calls.push([request.command, ...request.args]);
      return {
        exitCode: 1,
        stdout: JSON.stringify({
          error: {
            code: "E404",
            summary:
              "404 Not Found - GET https://registry.npmjs.org/@kitsunekode%2fkunai-linux-x64",
            detail: `The requested resource '${packageSpec}' could not be found.`,
          },
        }),
        stderr: "npm error code E404\nnpm error 404 Not Found",
      };
    });

    expect(await registry.queryIntegrity(candidate)).toBeNull();
    expect(calls).toEqual([
      ["npm", "view", "@kitsunekode/kunai-linux-x64@1.2.3", "dist.integrity", "--json"],
    ]);
  });

  test("accepts npm's E404 no-match wording for a missing exact version", async () => {
    const candidate = candidates()[0]!;
    const packageSpec = `${candidate.name}@${candidate.version}`;
    const registry = createNpmRegistryPort(async () => ({
      exitCode: 1,
      stdout: JSON.stringify({
        error: {
          code: "E404",
          summary: `No match found for version ${candidate.version}`,
          detail: `The requested resource '${packageSpec}' could not be found.`,
        },
      }),
      stderr: "",
    }));

    expect(await registry.queryIntegrity(candidate)).toBeNull();
  });

  test("propagates E404 when an authentication-token message contains not found", async () => {
    const registry = createNpmRegistryPort(async () => ({
      exitCode: 1,
      stdout: JSON.stringify({
        error: {
          code: "E404",
          summary: "authentication token not found",
          detail: "Run npm login to create a token.",
        },
      }),
      stderr: "npm error code E404",
    }));

    await expect(registry.queryIntegrity(candidates()[0]!)).rejects.toThrow(/npm view/i);
  });

  test("propagates E404 for an unrelated missing registry resource", async () => {
    const registry = createNpmRegistryPort(async () => ({
      exitCode: 1,
      stdout: JSON.stringify({
        error: {
          code: "E404",
          summary: "404 Not Found - GET https://registry.npmjs.org/unrelated-package",
          detail: "The requested resource 'unrelated-package@9.9.9' could not be found.",
        },
      }),
      stderr: "npm error code E404",
    }));

    await expect(registry.queryIntegrity(candidates()[0]!)).rejects.toThrow(/npm view/i);
  });

  test("propagates E404 with malformed structured error fields", async () => {
    const registry = createNpmRegistryPort(async () => ({
      exitCode: 1,
      stdout: JSON.stringify({
        error: {
          code: "E404",
          summary: ["authentication token not found"],
          detail: null,
        },
      }),
      stderr: "npm error code E404",
    }));

    await expect(registry.queryIntegrity(candidates()[0]!)).rejects.toThrow(/npm view/i);
  });

  test("propagates auth, permission, timeout, and other registry failures", async () => {
    for (const failure of [
      { exitCode: 1, stdout: "", stderr: "npm error code E401\nnpm error Unauthorized" },
      { exitCode: 1, stdout: "", stderr: "npm error code E403\nnpm error Forbidden" },
      { exitCode: 1, stdout: "", stderr: "npm error code ETIMEDOUT" },
      { exitCode: 1, stdout: "not json", stderr: "registry exploded" },
    ]) {
      const registry = createNpmRegistryPort(async () => failure);
      await expect(registry.queryIntegrity(candidates()[0]!)).rejects.toThrow(/npm view/i);
    }
  });

  test("rejects malformed successful registry JSON", async () => {
    const registry = createNpmRegistryPort(async () => ({
      exitCode: 0,
      stdout: "not-json",
      stderr: "",
    }));

    await expect(registry.queryIntegrity(candidates()[0]!)).rejects.toThrow(/JSON/i);
  });
});

describe("resumable npm publication orchestration", () => {
  test("reconciles all platforms before making the launcher decision", async () => {
    const localCandidates = candidates();
    const decisions: string[] = [];
    const registry: RegistryPort = {
      queryIntegrity: async (candidate) => {
        decisions.push(candidate.name);
        return candidate.integrity;
      },
      queryMetadata: async (candidate) => metadata(candidate),
    };

    await reconcileNpmPublication({
      candidates: localCandidates,
      confirmed: true,
      command: async () => ({ exitCode: 0, stdout: "", stderr: "" }),
      registry,
    });

    expect(decisions).toEqual(localCandidates.map((candidate) => candidate.name));
    expect(decisions.at(-1)).toBe("@kitsunekode/kunai");
  });

  test("resumes partial state by skipping identical versions and publishing only missing ones", async () => {
    const localCandidates = candidates();
    const registryState = new Map(
      localCandidates.slice(0, 3).map((candidate) => [candidate.name, metadata(candidate)]),
    );
    const published: string[] = [];
    const command: CommandPort = async (request) => {
      expect(request.command).toBe("npm");
      expect(request.args.slice(0, 1)).toEqual(["publish"]);
      expect(request.args.slice(2)).toEqual(["--access", "public", "--provenance"]);
      const candidate = localCandidates.find((item) => item.tarballPath === request.args[1])!;
      published.push(candidate.name);
      registryState.set(candidate.name, metadata(candidate));
      return { exitCode: 0, stdout: "", stderr: "" };
    };
    const registry: RegistryPort = {
      queryIntegrity: async (candidate) => registryState.get(candidate.name)?.integrity ?? null,
      queryMetadata: async (candidate) => registryState.get(candidate.name) ?? null,
    };

    const result = await reconcileNpmPublication({
      candidates: localCandidates,
      confirmed: true,
      command,
      registry,
    });

    expect(result.slice(0, 3).map((decision) => decision.action)).toEqual(["skip", "skip", "skip"]);
    expect(published).toEqual(localCandidates.slice(3).map((candidate) => candidate.name));
    expect(published.at(-1)).toBe("@kitsunekode/kunai");
  });

  test("fails when post-reconciliation verification does not exactly match", async () => {
    const localCandidates = candidates();
    let launcherQueried = false;
    const registry: RegistryPort = {
      queryIntegrity: async (candidate) => {
        if (candidate.role === "launcher") launcherQueried = true;
        return null;
      },
      queryMetadata: async (candidate) => ({
        ...metadata(candidate),
        integrity: "sha512-wrong",
      }),
    };

    await expect(
      reconcileNpmPublication({
        candidates: localCandidates,
        confirmed: true,
        command: async () => ({ exitCode: 0, stdout: "", stderr: "" }),
        registry,
      }),
    ).rejects.toThrow(/verification.*integrity/i);
    expect(launcherQueried).toBe(false);
  });

  test("dry-run produces real decisions without invoking npm publish", async () => {
    const localCandidates = candidates();
    const commands: string[][] = [];
    const result = await reconcileNpmPublication({
      candidates: localCandidates,
      confirmed: false,
      command: async (request) => {
        commands.push([request.command, ...request.args]);
        return { exitCode: 0, stdout: "", stderr: "" };
      },
      registry: {
        queryIntegrity: async () => null,
        queryMetadata: async () => {
          throw new Error("dry-run must not verify an unpublished version");
        },
      },
    });

    expect(result).toHaveLength(9);
    expect(result.every((decision) => decision.action === "publish")).toBe(true);
    expect(commands).toEqual([]);
  });

  test("dry-run re-verifies exact metadata for versions it decides to skip", async () => {
    const localCandidates = candidates();
    const verified: string[] = [];

    await reconcileNpmPublication({
      candidates: localCandidates,
      confirmed: false,
      command: async () => {
        throw new Error("dry-run must not publish");
      },
      registry: {
        queryIntegrity: async (candidate) => candidate.integrity,
        queryMetadata: async (candidate) => {
          verified.push(candidate.name);
          return metadata(candidate);
        },
      },
    });

    expect(verified).toEqual(localCandidates.map((candidate) => candidate.name));
  });

  test("requires explicit --yes and supports an explicit --dry-run alias", () => {
    expect(parsePublishArgs([])).toEqual({ confirmed: false });
    expect(parsePublishArgs(["--dry-run"])).toEqual({ confirmed: false });
    expect(parsePublishArgs(["--yes"])).toEqual({ confirmed: true });
    expect(() => parsePublishArgs(["--yes", "--dry-run"])).toThrow(/cannot.*together/i);
  });
});
