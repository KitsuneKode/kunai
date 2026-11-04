import { randomBytes } from "node:crypto";

export const COMPANION_SESSION_COOKIE = "kunai_companion_session";
const TOKEN_BYTES = 16;

export function mintCompanionRunSecret(): string {
  return randomBytes(TOKEN_BYTES).toString("hex");
}

export function companionLocalUrl(port: number, secret: string): string {
  return `http://127.0.0.1:${port}/#token=${secret}`;
}

export function readSessionToken(request: Request): string | null {
  const header = request.headers.get("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === COMPANION_SESSION_COOKIE) {
      const value = rest.join("=").trim();
      return /^[0-9a-f]{32}$/.test(value) ? value : null;
    }
  }
  return null;
}

export function sessionCookieHeader(token: string): string {
  return `${COMPANION_SESSION_COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/`;
}

export function validateCompanionRequestHost(request: Request, expectedHost: string): boolean {
  const headerHost = request.headers.get("host")?.trim().toLowerCase();
  const urlHost = new URL(request.url).host.toLowerCase();
  const host = (headerHost || urlHost).toLowerCase();
  if (!host) return false;
  return host === expectedHost.toLowerCase() && urlHost === expectedHost.toLowerCase();
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
