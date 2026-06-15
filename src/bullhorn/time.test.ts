import { describe, it, expect } from "vitest";
import { epochMsToDateInTz, splitSeconds } from "./time.js";

describe("splitSeconds", () => {
  it("splits seconds into hours and minutes", () => {
    expect(splitSeconds(3600)).toEqual({ hours: 1, minutes: 0 });
    expect(splitSeconds(5400)).toEqual({ hours: 1, minutes: 30 });
    expect(splitSeconds(900)).toEqual({ hours: 0, minutes: 15 });
  });
});

describe("epochMsToDateInTz", () => {
  it("maps an epoch to its local calendar date", () => {
    // 2026-06-08T15:53Z is morning in America/Los_Angeles -> same day
    expect(epochMsToDateInTz(Date.UTC(2026, 5, 8, 15, 53), "America/Los_Angeles")).toBe("2026-06-08");
    // 2026-06-15T03:00Z is still 2026-06-14 in LA (UTC-7)
    expect(epochMsToDateInTz(Date.UTC(2026, 5, 15, 3, 0), "America/Los_Angeles")).toBe("2026-06-14");
  });
});
