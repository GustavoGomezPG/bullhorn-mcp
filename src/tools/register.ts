import type { BullhornConfig } from "../config.js";
import { buildSyncDayTool } from "./sync-day.js";
import { buildSyncWeekTool } from "./sync-week.js";
import { buildListTimeTool } from "./time-list.js";

export interface ToolDescriptor {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  handler: (args: any) => Promise<{ content: Array<{ type: "text"; text: string }> }>;
}

export function collectTools(config: BullhornConfig): ToolDescriptor[] {
  return [buildSyncDayTool(config), buildSyncWeekTool(config), buildListTimeTool(config)] as ToolDescriptor[];
}
