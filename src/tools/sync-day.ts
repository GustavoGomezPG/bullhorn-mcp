import { z } from "zod";
import type { BullhornConfig } from "../config.js";
import { runBullhornSync } from "./sync-core.js";

export function buildSyncDayTool(config: BullhornConfig) {
  return {
    name: "bullhorn_sync_blitzit_day",
    description:
      "Sync a single day of completed Blitzit tasks into the current Bullhorn (BBO) weekly timesheet as time blocks (default today, in your timezone). Use for 'sync my day to bullhorn'. Preview by default; confirm:true writes. Never submits. Skips zero-duration and already-present (date+note) entries. Current week only.",
    inputSchema: {
      date: z.string().optional().describe("Day to sync, YYYY-MM-DD (default today). Must fall in the current Bullhorn week."),
      listId: z.string().optional().describe("Optional Blitzit list id filter."),
      confirm: z.boolean().optional().describe("Set true to write; otherwise preview."),
    },
    handler: async (args: { date?: string; listId?: string; confirm?: boolean }) =>
      runBullhornSync(config, { date: args.date, listId: args.listId, confirm: args.confirm, mode: "day" }),
  };
}
