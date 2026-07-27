/**
 * The CLI suites and the storage suites hit the same Windows teardown trap, so
 * they share one registry rather than two copies that can drift. The
 * implementation and the reasoning behind it live in `@kunai/storage/testing`.
 */
export {
  createTempStoreRegistry,
  type TempStoreKind,
  type TempStoreRegistry,
} from "@kunai/storage/testing";
