import { describe, it, expect, vi, afterEach } from "vitest";
import { extractJwtFromHtml, resolveAuth, login } from "./auth.js";

describe("extractJwtFromHtml", () => {
  it("pulls SESSION_AUTHENTICATION_KEY assignment", () => {
    expect(extractJwtFromHtml(`<script>var SESSION_AUTHENTICATION_KEY = "eyJ0eXAi.aaa.bbb";</script>`)).toBe("eyJ0eXAi.aaa.bbb");
  });
  it("falls back to any JWT in the html", () => {
    expect(extractJwtFromHtml(`<input value="eyJabc.def.ghi">`)).toBe("eyJabc.def.ghi");
  });
  it("throws when no JWT present", () => {
    expect(() => extractJwtFromHtml("<html>no token</html>")).toThrow(/jwt|token/i);
  });
});

describe("resolveAuth", () => {
  it("uses BULLHORN_AUTH_KEY override with no landing html", async () => {
    const r = await resolveAuth({ authKeyOverride: "manual-jwt", vanity: "v" });
    expect(r).toEqual({ jwt: "manual-jwt", landingHtml: null });
  });
  it("throws when no override and no credentials", async () => {
    await expect(resolveAuth({ vanity: "v" })).rejects.toThrow(/USERNAME|credentials|auto-login/i);
  });
});

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; vi.restoreAllMocks(); });

describe("login", () => {
  it("follows the redirect with cookies and returns jwt + landing html", async () => {
    const calls: any[] = [];
    globalThis.fetch = vi.fn(async (url: any, init: any) => {
      calls.push({ url: String(url), init });
      if (String(url).endsWith("/Login/")) {
        const h = new Headers({ location: "/employee/?authenticationKey=HEX" });
        h.append("set-cookie", "SESSIONID=abc; Path=/");
        h.append("set-cookie", "other=1; Path=/");
        return new Response("", { status: 302, headers: h });
      }
      return new Response(`<script>var SESSION_AUTHENTICATION_KEY = "eyJ0.body.sig";</script><tr class="timesheetDay" timesheetdetailid="1"><td>06/14/2026</td></tr>`, { status: 200 });
    }) as any;
    const r = await login("v", "u", "p");
    expect(r.jwt).toBe("eyJ0.body.sig");
    expect(r.landingHtml).toContain("timesheetDay");
    expect(calls[1].url).toContain("/employee/?authenticationKey=HEX");
    expect(calls[1].init.headers.Cookie).toContain("SESSIONID=abc");
  });
});
