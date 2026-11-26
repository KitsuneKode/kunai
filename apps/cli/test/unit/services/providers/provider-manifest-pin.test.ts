import { describe, expect, test } from "bun:test";

import {
  defaultManifestUrl,
  pinnedManifestPublicKeys,
} from "@/services/providers/provider-manifest-pin";

describe("provider manifest pin", () => {
  test("an operator's own URL always wins", () => {
    expect(
      defaultManifestUrl({ KUNAI_PROVIDER_MANIFEST_URL: " https://ops.example/m.json " }),
    ).toBe("https://ops.example/m.json");
  });

  test("an operator's own keys never pair with the project URL", () => {
    expect(defaultManifestUrl({ KUNAI_PROVIDER_MANIFEST_PUBKEYS: '{"k":"pem"}' })).toBeUndefined();
  });

  test("the project URL is used only once a project key is pinned", () => {
    const pinned = Object.keys(pinnedManifestPublicKeys()).length > 0;
    expect(defaultManifestUrl({}) !== undefined).toBe(pinned);
  });
});
