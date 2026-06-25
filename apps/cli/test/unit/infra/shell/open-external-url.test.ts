import { afterEach, describe, expect, test } from "bun:test";

import {
  defaultKunaiDocsUrl,
  isExternalUrlOpeningDisabled,
  openExternalUrl,
  openExternalUrlAndWait,
} from "@/infra/shell/open-external-url";

const ORIGINAL_DISABLE = process.env.KUNAI_DISABLE_EXTERNAL_URL;
const ORIGINAL_DOCS_URL = process.env.KUNAI_DOCS_URL;

afterEach(() => {
  if (ORIGINAL_DISABLE === undefined) {
    delete process.env.KUNAI_DISABLE_EXTERNAL_URL;
  } else {
    process.env.KUNAI_DISABLE_EXTERNAL_URL = ORIGINAL_DISABLE;
  }
  if (ORIGINAL_DOCS_URL === undefined) {
    delete process.env.KUNAI_DOCS_URL;
  } else {
    process.env.KUNAI_DOCS_URL = ORIGINAL_DOCS_URL;
  }
});

describe("open-external-url", () => {
  test("preload disables external URL opening during tests", () => {
    expect(process.env.KUNAI_DISABLE_EXTERNAL_URL).toBe("1");
    expect(isExternalUrlOpeningDisabled()).toBe(true);
  });

  test("openExternalUrlAndWait is a no-op when disabled", async () => {
    process.env.KUNAI_DISABLE_EXTERNAL_URL = "1";
    await expect(openExternalUrlAndWait(defaultKunaiDocsUrl())).resolves.toBe(false);
    openExternalUrl(defaultKunaiDocsUrl());
  });

  test("default docs URL respects KUNAI_DOCS_URL override", () => {
    process.env.KUNAI_DOCS_URL = "https://example.com/docs";
    expect(defaultKunaiDocsUrl()).toBe("https://example.com/docs");
  });
});
