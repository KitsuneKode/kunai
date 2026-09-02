function hasUnsafeControlCharacter(value: string): boolean {
  return Array.from(value).some((character) => {
    const code = character.charCodeAt(0);
    return code <= 31 || code === 127;
  });
}

export function parsePortableHttpUrl(value: string, label: string, base?: string | URL): URL {
  if (hasUnsafeControlCharacter(value)) {
    throw new Error(`${label} must be an absolute credential-free HTTPS URL`);
  }

  let parsed: URL;
  try {
    parsed = new URL(value, base);
  } catch {
    throw new Error(`${label} must be an absolute credential-free HTTPS URL`);
  }
  if (
    parsed.protocol !== "https:" ||
    parsed.username !== "" ||
    parsed.password !== "" ||
    parsed.hash !== ""
  ) {
    throw new Error(`${label} must be an absolute credential-free HTTPS URL`);
  }
  return parsed;
}

export function requirePortableHttpUrl(value: string, label: string): string {
  parsePortableHttpUrl(value, label);
  return value;
}
