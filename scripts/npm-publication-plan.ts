export interface LocalPackageCandidate {
  name: string;
  version: string;
  tarballPath: string;
  integrity: string;
  role: "platform" | "launcher";
}

export type PublicationDecision =
  | { action: "publish"; candidate: LocalPackageCandidate }
  | { action: "skip"; candidate: LocalPackageCandidate; registryIntegrity: string };

export function reconcileCandidate(
  candidate: LocalPackageCandidate,
  registryIntegrity: string | null,
): PublicationDecision {
  if (registryIntegrity === null) return { action: "publish", candidate };
  if (registryIntegrity === candidate.integrity) {
    return { action: "skip", candidate, registryIntegrity };
  }

  throw new Error(
    `[publish] ${candidate.name}@${candidate.version} already exists with different integrity ` +
      `(local ${candidate.integrity}, registry ${registryIntegrity}).`,
  );
}
