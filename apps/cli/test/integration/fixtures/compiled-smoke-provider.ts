/**
 * Absolute-path smoke fixture marker for the compiled binary harness.
 * The binary loads bundled modules after verifying this path exists under
 * `KUNAI_COMPILED_SMOKE=1` + absolute `KUNAI_COMPILED_SMOKE_FIXTURE`.
 */
export {
  allanimeSmokeProviderModule,
  providerModules,
  videasySmokeProviderModule,
} from "../../../src/app/compiled-smoke/fixture-provider";
