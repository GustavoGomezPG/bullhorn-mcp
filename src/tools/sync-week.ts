import { z } from "zod";
import type { BullhornConfig } from "../config.js";
import { runBullhornSync } from "./sync-core.js";

export function buildSyncWeekTool(config: BullhornConfig) {
  return {
    name: "bullhorn_sync_blitzit_week",
    description:
      "Sync the current Bullhorn week (Sun–Sat) of completed Blitzit tasks into the BBO timesheet as time blocks. Default this week. Preview by default; confirm:true writes. Never submits. Current week only (past/future weeks not supported yet).",
    inputSchema: {
      date: z.string().optional().describe("Any date within the target week, YYYY-MM-DD (default today). Must be the current week."),
      listId: z.string().optional().describe("Optional Blitzit list id filter."),
      confirm: z.boolean().optional().describe("Set true to write; otherwise preview."),
    },
    handler: async (args: { date?: string; listId?: string; confirm?: boolean }) =>
      runBullhornSync(config, { date: args.date, listId: args.listId, confirm: args.confirm, mode: "week" }),
  };
}
