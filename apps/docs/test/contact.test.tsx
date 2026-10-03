import { describe, expect, test } from "bun:test";

import { renderToStaticMarkup } from "react-dom/server";

import { ContactSection } from "../components/workshop/contact-section";
import { contactChannels, CONTACT_EMAIL, GITHUB_PROFILE_URL } from "../lib/contact";

describe("contact channels", () => {
  test("public channels come before the private one", () => {
    const ids = contactChannels.map((channel) => channel.id);
    expect(ids.indexOf("discussions")).toBeLessThan(ids.indexOf("email"));
    expect(ids.at(-1)).toBe("email");
  });

  test("every channel says what it is for and where it goes", () => {
    for (const channel of contactChannels) {
      expect(channel.useFor.length).toBeGreaterThan(20);
      expect(channel.href.startsWith("https://") || channel.href.startsWith("mailto:")).toBe(true);
    }
  });

  test("only the mailto link stays in the tab", () => {
    for (const channel of contactChannels) {
      expect(channel.external).toBe(!channel.href.startsWith("mailto:"));
    }
  });

  test("the email is a plain address with no query that would pre-fill or track", () => {
    expect(CONTACT_EMAIL).toMatch(/^[^@\s?]+@[^@\s?]+\.[a-z]+$/);
    expect(contactChannels.find((channel) => channel.id === "email")?.href).toBe(
      `mailto:${CONTACT_EMAIL}`,
    );
  });
});

describe("ContactSection", () => {
  const html = renderToStaticMarkup(<ContactSection />);

  test("is the target of the footer's contact link", () => {
    expect(html).toContain('id="contact"');
  });

  test("renders every channel as a link", () => {
    for (const channel of contactChannels) expect(html).toContain(`href="${channel.href}"`);
  });

  test("opens external channels in a new tab and says so", () => {
    expect(html).toContain('target="_blank"');
    expect(html).toContain("opens in a new tab");
  });

  test("links the GitHub profile and collects nothing: no form, no input", () => {
    expect(html).toContain(`href="${GITHUB_PROFILE_URL}"`);
    expect(html).not.toContain("<form");
    expect(html).not.toContain("<input");
  });
});
