import { tag } from "./xml.js";

export class BullhornError extends Error {
  constructor(public code: "AUTH_EXPIRED" | "HTTP_ERROR" | "BULLHORN_ERROR", message: string) {
    super(message);
    this.name = "BullhornError";
  }
}

export interface Session { authKey: string }

export interface BullhornClient {
  /** POST form-encoded to a BBO php endpoint, injecting + rotating the session authKey. Returns the XML body. */
  postForm(path: string, fields: Record<string, string>): Promise<string>;
}

export function createBullhornClient(session: Session, vanity: string): BullhornClient {
  const base = `https://${vanity}.bbo.bullhornstaffing.com`;
  return {
    async postForm(path, fields) {
      const body = new URLSearchParams({ authenticationKey: session.authKey, ...fields });
      const res = await fetch(`${base}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body,
      });
      if (res.status === 401 || res.status === 403) {
        throw new BullhornError("AUTH_EXPIRED", `BBO auth rejected (HTTP ${res.status}). Re-login or refresh BULLHORN_AUTH_KEY.`);
      }
      // BBO uses HTTP 209 for normal responses; accept any 2xx, reject other statuses.
      if (res.status < 200 || res.status >= 300) {
        throw new BullhornError("HTTP_ERROR", `BBO request failed (HTTP ${res.status}) for ${path}.`);
      }
      const xml = await res.text();
      // Rotate the JWT from the response when present.
      const fresh = tag(xml, "authenticationKey");
      if (fresh && fresh.trim()) session.authKey = fresh.trim();
      // A returned login form usually means the JWT expired.
      if (/<form[^>]*id=["']loginForm["']/.test(xml)) {
        throw new BullhornError("AUTH_EXPIRED", "BBO returned the login page; the session/JWT expired.");
      }
      const status = tag(xml, "errorStatus");
      if (status && status.trim().toLowerCase() !== "okay") {
        const msg = tag(xml, "errorMessage");
        throw new BullhornError("BULLHORN_ERROR", `BBO error for ${path}: ${(msg ?? status).trim()}`);
      }
      return xml;
    },
  };
}
