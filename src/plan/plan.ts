import type { BlitzitTask } from "../blitzit/tasks.js";
import { splitSeconds, epochMsToDateInTz } from "../bullhorn/time.js";

export const DEDUP_SEP = " ";

export interface PlanBlock { note: string; hours: number; minutes: number }
export interface DayBlocks { date: string; blocks: PlanBlock[] }
export interface SyncPlan {
  days: DayBlocks[];
  skippedZero: Array<{ id: string; project: string }>;
  skippedDuplicates: Array<{ date: string; note: string }>;
}

function note(t: BlitzitTask): string {
  const topic = t.topic.trim();
  const detail = t.detail.trim();
  // Blitzit titles already encode `Client::SubProject::Description`, so use the title
  // as-is. Only apply the `project :: topic :: description` form when the task carries a
  // genuine description distinct from its title (otherwise the title gets duplicated).
  return detail && detail !== t.project
    ? `${t.project} :: ${topic || "General"} :: ${detail}`
    : t.project;
}

export function planBullhornSync(params: {
  tasks: BlitzitTask[];
  tz: string;
  existingKeys: Set<string>; // `${date}${DEDUP_SEP}${note}`
}): SyncPlan {
  const { tasks, tz, existingKeys } = params;
  const byDay = new Map<string, PlanBlock[]>();
  const skippedZero: SyncPlan["skippedZero"] = [];
  const skippedDuplicates: SyncPlan["skippedDuplicates"] = [];

  for (const t of [...tasks].sort((a, b) => a.endTimeMs - b.endTimeMs)) {
    if (t.seconds <= 0) { skippedZero.push({ id: t.id, project: t.project }); continue; }
    const date = epochMsToDateInTz(t.endTimeMs, tz);
    const n = note(t);
    if (existingKeys.has(`${date}${DEDUP_SEP}${n}`)) { skippedDuplicates.push({ date, note: n }); continue; }
    const { hours, minutes } = splitSeconds(t.seconds);
    if (!byDay.has(date)) byDay.set(date, []);
    byDay.get(date)!.push({ note: n, hours, minutes });
  }

  const days = [...byDay.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([date, blocks]) => ({ date, blocks }));
  return { days, skippedZero, skippedDuplicates };
}
