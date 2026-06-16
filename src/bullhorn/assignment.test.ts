import { describe, it, expect } from "vitest";
import { resolveAssignmentId, parseAssignmentMap } from "./assignment.js";

describe("assignment", () => {
  it("uses the project map when present", () => {
    const map = parseAssignmentMap('{"Datamax":7001}');
    expect(resolveAssignmentId(map, "Datamax", "6599")).toBe("7001");
  });
  it("falls back to the default for unmapped projects", () => {
    expect(resolveAssignmentId({}, "Whatever", "6599")).toBe("6599");
  });
  it("rejects a non-integer assignment id in the map", () => {
    expect(() => parseAssignmentMap('{"X":"abc"}')).toThrow(/integer/i);
  });
});
