import { describe, it, expect } from "vitest";
import { bullhornWeek } from "./period.js";

describe("bullhornWeek", () => {
  it("computes the Sun–Sat week containing a Monday", () => {
    const w = bullhornWeek("2026-06-15"); // Mon
    expect(w.start).toBe("2026-06-14");   // Sun
    expect(w.end).toBe("2026-06-20");     // Sat
    expect(w.days).toEqual(["2026-06-14","2026-06-15","2026-06-16","2026-06-17","2026-06-18","2026-06-19","2026-06-20"]);
    expect(w.periodEndDate).toBe("26-06-20"); // YY-MM-DD of the Saturday end
  });
  it("treats Sunday as the start of its own week", () => {
    expect(bullhornWeek("2026-06-14").start).toBe("2026-06-14");
  });
  it("treats Saturday as the end of its week", () => {
    const w = bullhornWeek("2026-06-20");
    expect(w.start).toBe("2026-06-14");
    expect(w.end).toBe("2026-06-20");
  });
});
