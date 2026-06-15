export interface BullhornWeek { start: string; end: string; days: string[]; periodEndDate: string }

function ymd(d: Date): string { return d.toISOString().slice(0, 10); }
function yyMmDd(iso: string): string { return iso.slice(2); } // "2026-06-20" -> "26-06-20"

/** Sun–Sat week (calendar dates) containing the given YYYY-MM-DD date. */
export function bullhornWeek(date: string): BullhornWeek {
  const m = date.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) throw new Error(`Invalid date: "${date}". Use YYYY-MM-DD.`);
  const base = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  const sundayOffset = -base.getUTCDay(); // 0 = Sunday
  const start = new Date(base.getTime() + sundayOffset * 86400000);
  const days = Array.from({ length: 7 }, (_, i) => ymd(new Date(start.getTime() + i * 86400000)));
  return { start: days[0], end: days[6], days, periodEndDate: yyMmDd(days[6]) };
}
