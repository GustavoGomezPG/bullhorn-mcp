import type { BullhornConfig } from "../config.js";
import { text } from "../util.js";
import { resolveAuth } from "../bullhorn/auth.js";
import { createBullhornClient } from "../bullhorn/client.js";
import { fetchWeek, getDay } from "../bullhorn/timesheet.js";
import { bullhornWeek } from "../bullhorn/period.js";
import { epochMsToDateInTz } from "../bullhorn/time.js";

export function buildListTimeTool(config: BullhornConfig) {
  return {
    name: "bullhorn_list_my_time",
    description: "List existing Bullhorn timesheet blocks for the current Sun–Sat week. Read-only.",
    inputSchema: {},
    handler: async (_args: Record<string, never>) => {
      const auth = await resolveAuth({
        authKeyOverride: config.authKeyOverride, vanity: config.vanity, username: config.username, password: config.password,
      });
      const bbo = createBullhornClient({ authKey: auth.jwt }, config.vanity);
      // Day rows come from getData.php (the landing page no longer renders them);
      // this also lets the BULLHORN_AUTH_KEY override work for read-only listing.
      const today = epochMsToDateInTz(Date.now(), config.workdayTz);
      const week = await fetchWeek(bbo, config.assignmentId, bullhornWeek(today).periodEndDate);
      if (week.days.length === 0) return text({ error: "No current Bullhorn timesheet week found (getData.php returned no day rows)." });
      const days: any[] = [];
      for (const d of week.days) {
        const day = await getDay(bbo, d.timesheetdetailId);
        days.push({ date: d.date, hoursWorked: day.hoursWorked, blocks: day.blocks.map((b) => ({ note: b.note, hours: b.hours, minutes: b.minutes })) });
      }
      return text({ week: { start: week.days[0].date, end: week.days[week.days.length - 1].date, status: week.status }, days });
    },
  };
}
