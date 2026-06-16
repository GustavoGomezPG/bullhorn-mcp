import type { BullhornConfig } from "../config.js";
import { text } from "../util.js";
import { resolveAuth } from "../bullhorn/auth.js";
import { createBullhornClient } from "../bullhorn/client.js";
import { loadCurrentWeek, getDay } from "../bullhorn/timesheet.js";

export function buildListTimeTool(config: BullhornConfig) {
  return {
    name: "bullhorn_list_my_time",
    description: "List existing Bullhorn timesheet blocks for the current Sun–Sat week. Read-only.",
    inputSchema: {},
    handler: async (_args: Record<string, never>) => {
      const auth = await resolveAuth({
        authKeyOverride: config.authKeyOverride, vanity: config.vanity, username: config.username, password: config.password,
      });
      if (!auth.landingHtml) {
        return text({ error: "BULLHORN_AUTH_KEY override cannot load the timesheet week. Set BULLHORN_USERNAME/PASSWORD so the MCP can read the landing page." });
      }
      const week = loadCurrentWeek(auth.landingHtml);
      if (week.days.length === 0) return text({ error: "No timesheet week found on the BBO landing page." });
      const bbo = createBullhornClient({ authKey: auth.jwt }, config.vanity);
      const days: any[] = [];
      for (const d of week.days) {
        const day = await getDay(bbo, d.timesheetdetailId);
        days.push({ date: d.date, hoursWorked: day.hoursWorked, blocks: day.blocks.map((b) => ({ note: b.note, hours: b.hours, minutes: b.minutes })) });
      }
      return text({ week: { start: week.days[0].date, end: week.days[week.days.length - 1].date, status: week.status }, days });
    },
  };
}
