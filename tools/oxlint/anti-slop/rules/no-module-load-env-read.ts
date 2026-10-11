import type { ESTree } from "@oxlint/plugins";
import { defineRule } from "@oxlint/plugins";

/**
 * An expression inside a function body runs on each call; an expression in a
 * module-level position runs once at import time. Environment reads baked at
 * module load ignore `storageRootEnv` / `KUNAI_CONFIG_DIR` overrides applied
 * after import — the `FileStorage`/`ui.ts` class of bug where a profile path
 * or config dir resolved once at startup cannot be redirected by tests or the
 * agent verification loop.
 */

const FUNCTION_BOUNDARY = new Set([
  "FunctionDeclaration",
  "FunctionExpression",
  "ArrowFunctionExpression",
]);

/** True when the node's ancestor chain reaches Program without crossing a call boundary. */
const isModuleLoadPosition = (node: ESTree.Node): boolean => {
  let current: ESTree.Node | null = node.parent;
  while (current) {
    if (FUNCTION_BOUNDARY.has(current.type)) return false;
    // Instance field initializers run per-construction; only `static` fields
    // (and static blocks) evaluate at class definition time.
    if (current.type === "PropertyDefinition" && !current.static) return false;
    if (current.type === "Program") return true;
    current = current.parent;
  }
  return false;
};

const isIdentifierNamed = (node: ESTree.Node | null, name: string): boolean =>
  node?.type === "Identifier" && node.name === name;

const memberPropertyName = (node: ESTree.MemberExpression): string | null =>
  !node.computed && node.property.type === "Identifier" ? node.property.name : null;

/**
 * `process.env` / `Bun.env` / `import.meta.env` — but only when a snapshot is
 * taken at module load: a scalar member read (`process.env.HOME`) or a
 * destructure (`const { HOME } = process.env`). Storing the env object itself
 * (`env: process.env`) keeps a live reference and is exempt — nothing is
 * frozen by that.
 */
const isEnvNamespaceRead = (node: ESTree.MemberExpression): boolean => {
  const prop = memberPropertyName(node);
  if (prop !== "env") return false;
  const object = node.object;
  const isNamespace =
    isIdentifierNamed(object, "process") ||
    isIdentifierNamed(object, "Bun") ||
    object.type === "MetaProperty";
  if (!isNamespace) return false;
  const parent = node.parent;
  if (parent.type === "MemberExpression" && parent.object === node) return true;
  return (
    parent.type === "VariableDeclarator" &&
    parent.init === node &&
    parent.id.type === "ObjectPattern"
  );
};

/** Named environment reads we know return host-dependent values. */
const ENV_READ_CALLS = new Map<string, ReadonlySet<string>>([
  ["getKunaiPaths", new Set(["*"])],
  ["process", new Set(["cwd"])],
  ["os", new Set(["homedir", "tmpdir", "platform", "arch"])],
  ["Bun", new Set(["which"])],
]);

const isEnvReadCall = (node: ESTree.CallExpression): boolean => {
  const callee = node.callee;
  if (callee.type === "Identifier") return ENV_READ_CALLS.get(callee.name)?.has("*") ?? false;
  if (callee.type !== "MemberExpression") return false;
  const prop = memberPropertyName(callee);
  return prop !== null && (ENV_READ_CALLS.get(sourceObjectName(callee))?.has(prop) ?? false);
};

const sourceObjectName = (member: ESTree.MemberExpression): string =>
  member.object.type === "Identifier" ? member.object.name : "";

/** Ban environment reads in positions evaluated once at module load. */
export const noModuleLoadEnvReadRule = defineRule({
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow environment reads (process.env, getKunaiPaths, cwd/home resolution) in module-level initializers; resolve them inside functions so tests and embedders can redirect them.",
    },
    messages: {
      moduleLoadEnvRead:
        "Environment read evaluated once at module load. Move it into the function or constructor that needs it so tests and the agent loop can redirect it.",
    },
  },
  createOnce(context) {
    const reportIfModuleLoad = (node: ESTree.Node) => {
      if (isModuleLoadPosition(node)) context.report({ node, messageId: "moduleLoadEnvRead" });
    };
    return {
      MemberExpression(node) {
        if (isEnvNamespaceRead(node)) reportIfModuleLoad(node);
      },
      CallExpression(node) {
        if (isEnvReadCall(node)) reportIfModuleLoad(node);
      },
    };
  },
});
