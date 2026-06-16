export type AssignmentMap = Record<string, number>;

export function parseAssignmentMap(json: string): AssignmentMap {
  const raw: unknown = JSON.parse(json);
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("Assignment map must be a JSON object of { projectName: assignmentId }.");
  }
  const out: AssignmentMap = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof v !== "number" || !Number.isInteger(v)) throw new Error(`Assignment map entry "${k}" must be an integer assignmentId.`);
    out[k] = v;
  }
  return out;
}

export function resolveAssignmentId(map: AssignmentMap, project: string, defaultId: string): string {
  return project in map ? String(map[project]) : defaultId;
}
