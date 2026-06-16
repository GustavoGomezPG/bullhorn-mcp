import { describe, it, expect } from "vitest";
import { planBullhornSync } from "./plan.js";
import type { BlitzitTask } from "../blitzit/tasks.js";

const TZ = "America/Los_Angeles";
const jun8 = Date.UTC(2026, 5, 8, 15, 0, 0); // ~08:00 PDT -> 2026-06-08
const task = (id: string, seconds: number, topic = "Web", detail = "did x"): BlitzitTask =>
  ({ id, project: "Datamax", topic, detail, seconds, endTimeMs: jun8, listId: "L1", board: "done" });

describe("planBullhornSync", () => {
  it("groups tasks into per-day blocks with note + hours/minutes", () => {
    const plan = planBullhornSync({ tasks: [task("a", 3600), task("b", 5400)], tz: TZ, existingKeys: new Set() });
    expect(plan.days).toHaveLength(1);
    expect(plan.days[0].date).toBe("2026-06-08");
    expect(plan.days[0].blocks).toEqual([
      { note: "Datamax :: Web :: did x", hours: 1, minutes: 0 },
      { note: "Datamax :: Web :: did x", hours: 1, minutes: 30 },
    ]);
  });
  it("skips zero-duration tasks", () => {
    const plan = planBullhornSync({ tasks: [task("a", 0)], tz: TZ, existingKeys: new Set() });
    expect(plan.days).toHaveLength(0);
    expect(plan.skippedZero).toEqual([{ id: "a", project: "Datamax" }]);
  });
  it("skips duplicates already present (date + note)", () => {
    const plan = planBullhornSync({ tasks: [task("a", 3600)], tz: TZ, existingKeys: new Set(["2026-06-08 Datamax :: Web :: did x"]) });
    expect(plan.days).toHaveLength(0);
    expect(plan.skippedDuplicates).toEqual([{ date: "2026-06-08", note: "Datamax :: Web :: did x" }]);
  });
  it("fills empty topic/detail so the note is always 3-part", () => {
    const plan = planBullhornSync({ tasks: [task("a", 60, "", "")], tz: TZ, existingKeys: new Set() });
    expect(plan.days[0].blocks[0].note).toBe("Datamax :: General :: Datamax");
  });
});
