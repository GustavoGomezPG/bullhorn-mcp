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
