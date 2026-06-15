export function splitSeconds(totalSeconds: number): { hours: number; minutes: number } {
  const s = Math.max(0, Math.round(totalSeconds));
  return { hours: Math.floor(s / 3600), minutes: Math.round((s % 3600) / 60) };
}

/** Calendar date (YYYY-MM-DD) of an epoch (ms) in the given IANA tz. */
export function epochMsToDateInTz(epochMs: number, tz: string): string {
  const p: Record<string, string> = {};
  for (const part of new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(epochMs))) {
    if (part.type !== "literal") p[part.type] = part.value;
  }
  return `${p.year}-${p.month}-${p.day}`;
}
