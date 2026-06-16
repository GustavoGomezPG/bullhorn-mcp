import type { BullhornConfig } from "../config.js";
import { text } from "../util.js";
import { resolveAuth } from "../bullhorn/auth.js";
import { createBullhornClient } from "../bullhorn/client.js";
import { fetchWeek, getDay, updateDay, assertEditable, createWeek } from "../bullhorn/timesheet.js";
import { bullhornWeek } from "../bullhorn/period.js";
import { getBlitzitAuth } from "../blitzit/auth.js";
import { createBlitzitClient } from "../blitzit/client.js";
import { fetchWeekDoneTasks } from "../blitzit/tasks.js";
import { planBullhornSync, DEDUP_SEP } from "../plan/plan.js";
import { epochMsToDateInTz } from "../bullhorn/time.js";
import type { Block } from "../bullhorn/xml.js";

type Result = { content: Array<{ type: "text"; text: string }> };

/** Shared engine for the day + week Bullhorn sync tools. Current week only. */
export async function runBullhornSync(
  config: BullhornConfig,
  opts: { date?: string; listId?: string; confirm?: boolean; mode: "day" | "week" },
): Promise<Result> {
  const tz = config.workdayTz;
  const today = epochMsToDateInTz(Date.now(), tz);
  const ref = opts.date ?? today;
  const targetWeek = bullhornWeek(ref);
  const authArgs = {
    authKeyOverride: config.authKeyOverride, vanity: config.vanity, username: config.username, password: config.password,
  };

  // 1) Auth → JWT, then load the week from getData.php. BBO no longer server-renders
  //    day rows into the landing page (it loads them client-side from getData.php), so
  //    we hit that endpoint directly. This also lets the BULLHORN_AUTH_KEY override work,
  //    since we no longer need the post-login landing HTML to read day rows.
  const auth = await resolveAuth(authArgs);
  const bbo = createBullhornClient({ authKey: auth.jwt }, config.vanity);
  const periodEndDate = bullhornWeek(today).periodEndDate; // landing page is current-week only
  let week = await fetchWeek(bbo, config.assignmentId, periodEndDate);
  if (week.days.length === 0) {
    // Week not created yet — create the blank timesheet (no-op if it already exists),
    // then re-fetch. The JWT rotates inside the client across these calls.
    await createWeek(bbo, config.assignmentId, periodEndDate, config.timezoneOffset);
    week = await fetchWeek(bbo, config.assignmentId, periodEndDate);
    if (week.days.length === 0) {
      return text({ error: "Created the Bullhorn week but getData.php returned no day rows. Open BBO and verify the timesheet, then retry." });
    }
  }
  const loadedStart = week.days[0].date;
  const loadedEnd = week.days[week.days.length - 1].date;
  const dayId = new Map(week.days.map((d) => [d.date, d.timesheetdetailId]));

  // 2) Current-week-only guard.
  if (opts.mode === "day" && !(ref >= loadedStart && ref <= loadedEnd)) {
    return text({ error: `Date ${ref} is outside the current Bullhorn week (${loadedStart}…${loadedEnd}). Past/future weeks aren't supported yet — only the current week can be synced.` });
  }
  if (opts.mode === "week" && targetWeek.start !== loadedStart) {
    return text({ error: `Requested week (${targetWeek.start}…${targetWeek.end}) is not the current Bullhorn week (${loadedStart}…${loadedEnd}). Past/future weeks aren't supported yet.` });
  }

  const targetDates = opts.mode === "day" ? [ref] : week.days.map((d) => d.date);
  const confirm = !!opts.confirm;
  if (confirm) assertEditable(week.status); // throws StatusGuardError if the week is locked/submitted/approved

  // 3) Blitzit done-tasks across the week window, then bucket by tz date.
  const { idToken, uid } = await getBlitzitAuth();
  const fromMs = Date.parse(`${loadedStart}T00:00:00Z`) - 2 * 86400000;
  const toMs = Date.parse(`${loadedEnd}T00:00:00Z`) + 2 * 86400000;
  const all = await fetchWeekDoneTasks(createBlitzitClient(idToken), uid, fromMs, toMs, opts.listId);
  const targetSet = new Set(targetDates);
  const tasks = all.filter((t) => targetSet.has(epochMsToDateInTz(t.endTimeMs, tz)));

  // 4) Per-day plan + (optional) write.
  const days: Array<Record<string, unknown>> = [];
  const skippedZero: Array<{ id: string; project: string }> = [];
  const skippedDuplicates: Array<{ date: string; note: string }> = [];

  for (const date of targetDates) {
    const dayTasks = tasks.filter((t) => epochMsToDateInTz(t.endTimeMs, tz) === date);
    if (dayTasks.length === 0) continue;
    const detailId = dayId.get(date)!;
    const day = await getDay(bbo, detailId);
    const existingKeys = new Set(day.blocks.map((b) => `${date}${DEDUP_SEP}${b.note}`));
    const plan = planBullhornSync({ tasks: dayTasks, tz, existingKeys });
    skippedZero.push(...plan.skippedZero);
    skippedDuplicates.push(...plan.skippedDuplicates);
    const newBlocks: Block[] = (plan.days[0]?.blocks ?? []).map((b) => ({
      hours: b.hours, minutes: b.minutes, note: b.note, type: 0, editable: true,
    }));
    if (newBlocks.length === 0) { days.push({ date, added: 0, note: "nothing new to add" }); continue; }
    if (!confirm) {
      days.push({ date, willAdd: newBlocks.map((b) => ({ note: b.note, hours: b.hours, minutes: b.minutes })) });
    } else {
      await updateDay(bbo, detailId, day.maxCheckinId, [...day.blocks, ...newBlocks]);
      days.push({ date, added: newBlocks.length });
    }
  }

  return text({
    mode: confirm ? "logged" : "preview",
    week: { start: loadedStart, end: loadedEnd, status: week.status },
    targetDates, days, skippedZero, skippedDuplicates,
    ...(confirm ? {} : { hint: "Set confirm:true to write these blocks to Bullhorn." }),
  });
}
