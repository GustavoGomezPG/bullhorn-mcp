import { describe, it, expect } from "vitest";
import { collectTools } from "./register.js";
import type { BullhornConfig } from "../config.js";

const config = { vanity: "v", assignmentId: "6599", timezoneOffset: "420", workdayTz: "America/Los_Angeles" } as BullhornConfig;

describe("collectTools", () => {
  it("registers the three bullhorn tools", () => {
    const names = collectTools(config).map((t) => t.name).sort();
    expect(names).toEqual(["bullhorn_list_my_time", "bullhorn_sync_blitzit_day", "bullhorn_sync_blitzit_week"]);
  });
});
