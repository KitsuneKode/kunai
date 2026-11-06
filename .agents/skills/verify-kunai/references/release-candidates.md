# Candidate Integrity and Provider Registration Verification

## 1. Candidate Source Revision and Dirty State

Every verification report must bind to the exact source candidate revision and working tree state:

- **Candidate Commit SHA**: Captured via `git rev-parse HEAD`. Must match the evaluated pull request or integration branch HEAD (e.g. `aed24a230`).
- **Dirty Tree State**: Captured via `git status --porcelain`. A candidate with uncommitted modifications must be recorded as `dirty: true`, detailing which files differ. Never claim clean status on a dirty tree.

In automated test harnesses (`agent:kitty`, `agent:drive`), this state is recorded directly in `results.json`:

```json
{
  "revision": {
    "commitSha": "aed24a230...",
    "dirty": true
  }
}
```

## 2. Provider Verification Pipeline: Declaration → Loader → Registry

A recurring failure mode is assuming that because a provider module exists in `packages/providers` or has passing unit tests, it is registered and available for live resolution. **It is not.**

The four-stage production registration chain:

1. **Module Declaration & Export**:
   The provider adapter exists in `packages/providers/src/<provider-id>/` and exports its `CoreProviderModule` (e.g. `vidlinkProviderModule`).
2. **Production Loader Inclusion**:
   The provider must be imported and returned by `loadProductionProviderModules()` in `apps/cli/src/container/bootstrap-providers.ts`. If an adapter is omitted from this loader, the CLI container never imports it in production.
3. **Provider Engine & Registry Registration**:
   `bootstrapProviders()` passes the loaded modules to `createProviderEngine()` and `createProviderRegistry()`.
4. **Active Module Priority & Filter**:
   `getOrderedModules()` filters the modules against `config.disabledProviders` and orders them according to `providerPriority`, `animeProviderPriority`, or `youtubeProviderPriority`.

### Verification Test Pattern

To prove a provider is registered in the production engine without creating a duplicate registry that can drift:

```ts
import { loadProductionProviderModules } from "@/container/bootstrap-providers";

const modules = await loadProductionProviderModules({
  providerPriority: [],
  animeProviderPriority: [],
  youtubeProviderPriority: [],
});
const registeredIds = modules.map((m) => m.manifest.id);
expect(registeredIds).toContain("vidlink");
```

### Unintegrated provider trees

Inspect the provider owner's current branch and the evaluated candidate at the
same time. Record commit SHAs and loader IDs in the report, rather than embedding
a fixed provider count in this reusable skill. An exported adapter or configured
priority is insufficient when the production loader omits it. Preserve the
provider owner's edits and qualify only the combined candidate after integration.

## 3. Config Migration and User Preference Preservation

When defaults or priority lists evolve between versions:

- **Rule**: Migrations must preserve explicit user choices. An updated default must not overwrite a user-configured setting.
- **Verification Recipe**:
  1. Seed profile with explicit non-default settings (e.g. `"provider": "movy"`, `"footerHints": "minimal"`, `"analytics": "declined"`).
  2. Boot the candidate binary or `agent:drive`.
  3. Wait for boot and inspect `config.json`.
  4. **Observable Proof**: Explicit settings (`"provider": "movy"`, `"footerHints": "minimal"`) remain intact; new config keys receive their default values without clobbering existing keys.
  5. **Reverse/Failure Case**: If a default resets `"provider"` to `"videasy"`, or erases `"footerHints"`, the test fails as a migration regression.
