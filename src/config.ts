export interface BullhornConfig {
  vanity: string;
  username?: string;
  password?: string;
  authKeyOverride?: string;
  assignmentId: string;
  timezoneOffset: string;
  workdayTz: string;
  assignmentMapPath?: string;
}

type EnvLike = Record<string, string | undefined>;

export function loadConfig(env: EnvLike = process.env): BullhornConfig {
  const vanity = (env.BULLHORN_VANITY ?? "").trim();
  if (!vanity) throw new Error("BULLHORN_VANITY is required (e.g. 'provisionsgroup').");
  const assignmentId = (env.BULLHORN_ASSIGNMENT_ID ?? "").trim();
  if (!assignmentId) throw new Error("BULLHORN_ASSIGNMENT_ID is required (default Bullhorn assignment).");
  return {
    vanity,
    username: (env.BULLHORN_USERNAME ?? "").trim() || undefined,
    password: (env.BULLHORN_PASSWORD ?? "").trim() || undefined,
    authKeyOverride: (env.BULLHORN_AUTH_KEY ?? "").trim() || undefined,
    assignmentId,
    timezoneOffset: (env.BULLHORN_TIMEZONE_OFFSET ?? "420").trim() || "420",
    workdayTz: (env.BULLHORN_WORKDAY_TZ ?? "").trim() || "UTC",
    assignmentMapPath: (env.BULLHORN_ASSIGNMENT_MAP ?? "").trim() || undefined,
  };
}
