/**
 * Environment for a test that runs `git` against a fixture repository.
 *
 * Git exports `GIT_DIR`, `GIT_WORK_TREE`, `GIT_INDEX_FILE` and friends to the
 * hooks it runs, and inside a linked worktree they point at the real
 * repository. A test spawned from the pre-push hook that inherits them and runs
 * `git init --bare`, `git config` or `git commit` in its temp directory writes
 * to the developer's repository instead: it once set `core.bare=true`, pointed
 * `core.hooksPath` at /dev/null and committed fixture "before"/"after" commits
 * onto a real branch. Every git fixture starts from this.
 */
export function withoutGitEnv(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  return Object.fromEntries(Object.entries(env).filter(([key]) => !key.startsWith("GIT_")));
}
