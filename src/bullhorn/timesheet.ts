import type { BullhornClient } from "./client.js";
import { BullhornError } from "./client.js";
import { parseDay, type Block, type DayData } from "./xml.js";
import { parseWeekHtml, parseWeekXml, type WeekData } from "./page.js";

const EDITABLE_STATUSES = new Set(["", "not created", "in progress"]);

export class StatusGuardError extends Error {
  constructor(public status: string) {
    super(`Refusing to modify timesheet: status is "${status}" (editable only when Not Created / In Progress).`);
    this.name = "StatusGuardError";
  }
}

export function isEditableStatus(status: string): boolean {
  return EDITABLE_STATUSES.has(status.trim().toLowerCase());
}

export function assertEditable(status: string): void {
  if (!isEditableStatus(status)) throw new StatusGuardError(status);
}

/** Parse the current week's day list + status from the post-login landing HTML. */
export function loadCurrentWeek(landingHtml: string): WeekData {
  return parseWeekHtml(landingHtml);
}

/**
 * Fetch a week's day list + status from BBO's getData.php. This is the source of
 * truth for day rows — the landing page no longer renders them (it loads them
 * client-side from this same endpoint). `periodEndDate` is the week's Saturday in
 * `yy-mm-dd` form (e.g. "26-06-20"). Zero days means the week isn't created yet.
 */
export async function fetchWeek(
  client: BullhornClient, assignmentId: string, periodEndDate: string,
): Promise<WeekData> {
  const xml = await client.postForm("/php/timesheet/getData.php", { assignmentId, periodEndDate });
  return parseWeekXml(xml);
}

export async function getDay(client: BullhornClient, timesheetdetailId: string): Promise<DayData> {
  const xml = await client.postForm("/php/timesheet/getTimesheetDay.php", { timesheetdetailId });
  return parseDay(xml);
}

/** Encode blocks into 1-based form fields. Existing blocks keep their timesheetBlockId; new blocks send "". */
export function buildBlockFields(blocks: Block[]): Record<string, string> {
  const f: Record<string, string> = {};
  blocks.forEach((b, idx) => {
    const i = idx + 1;
    f[`block[${i}][timesheetBlockId]`] = b.timesheetBlockId ?? "";
    f[`block[${i}][timesheetBlockHours]`] = String(b.hours);
    f[`block[${i}][timesheetBlockMinutes]`] = String(b.minutes);
    f[`block[${i}][timesheetBlockType]`] = String(b.type);
    f[`block[${i}][timesheetBlockNote]`] = b.note;
  });
  return f;
}

export async function updateDay(
  client: BullhornClient, timesheetdetailId: string, maxCheckinId: string, blocks: Block[],
): Promise<DayData> {
  const xml = await client.postForm("/php/timesheet/updateDay.php", {
    timesheetdetailId, maxCheckinId, ...buildBlockFields(blocks),
  });
  return parseDay(xml);
}

/**
 * Create the week's blank timesheet. Returns true if newly created, false if it already existed
 * (BBO returns an "already been created" error in that case, which is treated as success).
 */
export async function createWeek(
  client: BullhornClient, assignmentId: string, periodEndDate: string, timezoneOffset: string,
): Promise<boolean> {
  try {
    await client.postForm("/php/timesheet/create.php", { assignmentId, periodEndDate, timezoneOffset, subaction: "Blank" });
    return true;
  } catch (e) {
    if (e instanceof BullhornError && e.code === "BULLHORN_ERROR" && /already.*created/i.test(e.message)) return false;
    throw e;
  }
}
