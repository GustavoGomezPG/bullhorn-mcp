import { describe, it, expect } from "vitest";
import { parseDescription, normalizeTask, decodeEntities, fetchWeekDoneTasks } from "./tasks.js";
import type { BlitzitClient, FirestoreDoc } from "./client.js";

describe("decodeEntities", () => {
  it("decodes common HTML entities", () => {
    expect(decodeEntities("A &amp; B &lt;x&gt; &quot;q&quot; &#39;y&#39;")).toBe('A & B <x> "q" \'y\'');
  });
});

describe("parseDescription", () => {
  it("splits <strong>topic</strong><br>detail", () => {
    expect(parseDescription("<strong>Website</strong><br>Fixed the header")).toEqual({ topic: "Website", detail: "Fixed the header" });
  });
  it("handles missing <strong>", () => {
    expect(parseDescription("just text")).toEqual({ topic: "", detail: "just text" });
  });
});

describe("normalizeTask", () => {
  it("maps Firestore fields", () => {
    const fields = {
      title: { stringValue: "Datamax" }, description: { stringValue: "<strong>Web</strong><br>DNS" },
      timeTaken: { integerValue: "3600000" }, endTime: { integerValue: "1780000000000" },
      listId: { stringValue: "L1" }, board: { stringValue: "done" },
    };
    expect(normalizeTask("x", fields)).toEqual({
      id: "x", project: "Datamax", topic: "Web", detail: "DNS", seconds: 3600, endTimeMs: 1780000000000, listId: "L1", board: "done",
    });
  });
});

function mockClient(docs: FirestoreDoc[]): BlitzitClient { return { queryTasksByOwner: async () => docs }; }
const doc = (id: string, board: string, endTimeMs: number): FirestoreDoc => ({
  id, fields: { title: { stringValue: "Datamax" }, board: { stringValue: board }, description: { stringValue: "<strong>W</strong><br>x" }, timeTaken: { integerValue: "3600000" }, endTime: { integerValue: String(endTimeMs) }, listId: { stringValue: "L1" } },
});

describe("fetchWeekDoneTasks", () => {
  it("keeps only done tasks in [fromMs,toMs)", async () => {
    const c = mockClient([doc("a", "done", 1000), doc("b", "done", 5000), doc("c", "todo", 1500)]);
    expect((await fetchWeekDoneTasks(c, "u", 500, 2000)).map(t => t.id)).toEqual(["a"]);
  });
});
