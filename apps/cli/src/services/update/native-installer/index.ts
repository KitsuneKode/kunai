export {
  installLatest,
  checkInstall,
  type InstallLatestResult,
  type SetupMessage,
} from "./install-latest";
export { lockCurrentVersion } from "./version-lock";
export { cleanupOldVersions } from "./cleanup-versions";
export { getInstallDiagnostics, type InstallDiagnostic } from "./install-diagnostic";
