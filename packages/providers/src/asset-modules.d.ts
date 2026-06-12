// Ambient declarations for `import x from "./file.wasm" with { type: "file" }`.
// Bun resolves these imports to a filesystem path string at runtime (a real path
// in dev/npm-bundle, a `/$bunfs/` path inside a `bun build --compile` binary).
declare module "*.wasm" {
  const path: string;
  export default path;
}
