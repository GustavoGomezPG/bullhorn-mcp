export interface WeekDay { date: string; timesheetdetailId: string }
export interface WeekData { status: string; timesheetId?: string; days: WeekDay[] }

/**
 * Parse the authenticated /employee/ landing page HTML into the current week's day list.
 * Day rows look like: <tr class="timesheetDay" timesheetdetailid="N" ...><td>...MM/DD/YYYY...</td>...</tr>
 * The week status renders as `Status">In Progress`.
 */
export function parseWeekHtml(rawHtml: string): WeekData {
  // Strip HTML comments first: real pages carry explanatory comments that can
  // contain marker-like text (e.g. a literal `Status">`), which would otherwise
  // be matched ahead of the genuine rendered label.
  const html = rawHtml.replace(/<!--[\s\S]*?-->/g, "");
  const days: WeekDay[] = [];
  const rowRe = /<tr[^>]*class="[^"]*timesheetDay[^"]*"[^>]*timesheetdetailid="(\d+)"[^>]*>([\s\S]*?)<\/tr>/gi;
  let m: RegExpExecArray | null;
  while ((m = rowRe.exec(html))) {
    const id = m[1];
    const dm = m[2].match(/(\d{2})\/(\d{2})\/(\d{4})/);
    if (dm) days.push({ date: `${dm[3]}-${dm[1]}-${dm[2]}`, timesheetdetailId: id });
  }
  const statusM = html.match(/Status">\s*([^<]+?)\s*</);
  const status = statusM ? statusM[1].trim() : "";
  const tsM = html.match(/timesheetId["'\s:=]{1,4}(\d+)/i);
  return { status, timesheetId: tsM ? tsM[1] : undefined, days };
}

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
