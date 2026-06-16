/** Pull the BBO JWT out of the /employee/ landing page HTML. */
export function extractJwtFromHtml(html: string): string {
  const named = html.match(/SESSION_AUTHENTICATION_KEY\s*=\s*["'](eyJ[A-Za-z0-9_\-]+\.[A-Za-z0-9_\-]+\.[A-Za-z0-9_\-]+)["']/);
  if (named) return named[1];
  const any = html.match(/eyJ[A-Za-z0-9_\-]+\.[A-Za-z0-9_\-]+\.[A-Za-z0-9_\-]+/);
  if (any) return any[0];
  throw new Error("Could not find a BBO JWT (authenticationKey) in the employee page. Login may have failed.");
}

function parseSetCookie(headers: Headers): string {
  const list = (headers as any).getSetCookie ? ((headers as any).getSetCookie() as string[]) : [];
  return list.map((c) => c.split(";")[0]).join("; ");
}

export interface LoginResult { jwt: string; landingHtml: string }

/** Log in to BBO; follow the one-time-key redirect to the landing page. Returns the JWT + landing HTML. */
export async function login(vanity: string, username: string, password: string): Promise<LoginResult> {
  const baseUrl = `https://${vanity}.bbo.bullhornstaffing.com`;
  const res = await fetch(`${baseUrl}/Login/`, {
    method: "POST",
    redirect: "manual",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ process: "login", flashEnabled: "true", username, password, rememberMe: "" }),
  });
  if (![200, 301, 302, 303].includes(res.status)) {
    throw new Error(`BBO login failed (HTTP ${res.status}). Check BULLHORN_USERNAME/PASSWORD.`);
  }
  const cookies = parseSetCookie(res.headers);
  const location = res.headers.get("location");
  // Resolve against baseUrl: handles absolute (http…), path-absolute (/employee…),
  // and protocol-relative (//host/employee…) — BBO sends the last form.
  const landingUrl = location ? new URL(location, baseUrl).toString() : `${baseUrl}/employee/`;
  const landing = await fetch(landingUrl, { headers: cookies ? { Cookie: cookies } : {} });
  const landingHtml = await landing.text();
  const jwt = extractJwtFromHtml(landingHtml);
  return { jwt, landingHtml };
}

export interface ResolveAuthResult { jwt: string; landingHtml: string | null }

/** Resolve the JWT (+ landing HTML when auto-login is used). BULLHORN_AUTH_KEY override skips login (no landing HTML). */
export async function resolveAuth(opts: {
  authKeyOverride?: string; vanity: string; username?: string; password?: string;
}): Promise<ResolveAuthResult> {
  if (opts.authKeyOverride && opts.authKeyOverride.trim()) {
    return { jwt: opts.authKeyOverride.trim(), landingHtml: null };
  }
  if (!opts.username || !opts.password) {
    throw new Error("No BULLHORN_AUTH_KEY and missing BULLHORN_USERNAME/PASSWORD for auto-login.");
  }
  return login(opts.vanity, opts.username, opts.password);
}
