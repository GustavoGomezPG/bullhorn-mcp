import { describe, it, expect } from "vitest";
import { text } from "./util.js";

describe("text", () => {
  it("wraps a value as a JSON text content block", () => {
    const r = text({ a: 1 });
    expect(r.content[0].type).toBe("text");
    expect(JSON.parse(r.content[0].text)).toEqual({ a: 1 });
  });
});
