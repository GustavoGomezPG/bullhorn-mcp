export interface WeekDay { date: string; timesheetdetailId: string }
export interface WeekData { status: string; timesheetId?: string; days: WeekDay[] }

/**
 * Parse the `/php/timesheet/getData.php` XML into the week's day list + status.
 * BBO no longer server-renders day rows into the landing page; the page loads
 * them client-side from getData.php, whose XML looks like:
 *   <timesheetstatus>In Progress</timesheetstatus><timesheetid>N</timesheetid>
 *   <timesheetdetails>
 *     <timesheetitem><timesheetdetailId>N</timesheetdetailId>
 *       <timesheetdetailDate>2026-06-14</timesheetdetailDate>...</timesheetitem>
 *     ...
 *   </timesheetdetails>
 * An empty/absent timesheet (week not created yet) yields zero items.
 */
export function parseWeekXml(xml: string): WeekData {
  const days: WeekDay[] = [];
  const itemRe = /<timesheetitem>([\s\S]*?)<\/timesheetitem>/gi;
  let m: RegExpExecArray | null;
  while ((m = itemRe.exec(xml))) {
    const id = m[1].match(/<timesheetdetailId>\s*([\s\S]*?)\s*<\/timesheetdetailId>/i)?.[1];
    const date = m[1].match(/<timesheetdetailDate>\s*([\s\S]*?)\s*<\/timesheetdetailDate>/i)?.[1];
    if (id && date) days.push({ date: date.trim(), timesheetdetailId: id.trim() });
  }
  const status = xml.match(/<timesheetstatus>\s*([\s\S]*?)\s*<\/timesheetstatus>/i)?.[1]?.trim() ?? "";
  const timesheetId = xml.match(/<timesheetid>\s*(\d+)\s*<\/timesheetid>/i)?.[1];
  return { status, timesheetId, days };
}
