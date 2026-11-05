import { randomBytes } from "node:crypto";

const TOKEN_BYTES = 16;

export function mintCompanionRunSecret(): string {
  return randomBytes(TOKEN_BYTES).toString("hex");
}

export function companionLocalUrl(port: number, secret: string): string {
  return `http://127.0.0.1:${port}/#token=${secret}`;
}

/** Page credentials are explicit: loopback cookies have no port isolation. */
export function readCompanionCredential(request: Request): string | null {
  return /^Bearer ([0-9a-f]{32})$/.exec(request.headers.get("authorization") ?? "")?.[1] ?? null;
}

export function validateCompanionRequestHost(request: Request, expectedHost: string): boolean {
  const urlHost = new URL(request.url).host;
  const raw = request.headers.get("host") ?? urlHost;
  // Parse only an authority, never a URL, userinfo, alias or path. URL.host
  // then normalizes the default HTTP port exactly as the browser does.
  if (!/^127\.0\.0\.1(?::[0-9]{1,5})?$/.test(raw)) return false;
  try {
    return new URL(`http://${raw}`).host === expectedHost && urlHost === expectedHost;
  } catch {
    return false;
  }
}

export function validateCompanionRequestOrigin(request: Request, expectedOrigin: string): boolean {
  const method = request.method.toUpperCase();
  const origin = request.headers.get("origin");
  if (origin && origin !== expectedOrigin) return false;
  if (request.headers.get("sec-fetch-site") === "cross-site") return false;
  return method === "GET" || method === "HEAD" || origin === expectedOrigin;
}

export function isCompanionApiPath(pathname: string): boolean {
  return pathname.startsWith("/api/");
}
