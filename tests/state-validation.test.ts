import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  mkdtempSync,
  writeFileSync,
  rmSync,
  existsSync,
  mkdirSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  validateRalplanState,
  isPersistedState,
  readRalplanStateFile,
  writeRalplanStateFile,
  buildDefaultState,
} from "../pi/extensions/ralplan/state.js";
import {
  buildPipelineTracking,
  resolvePipelineConfig,
} from "../pi/extensions/ralplan/pipeline.js";

describe("validateRalplanState (T-7)", () => {
  const validV3 = {
    version: 3,
    active: true,
    mode: "ralplan",
    pipeline: { stages: [{ id: "ralplan", status: "active", iterations: 0 }] },
    originalIdea: "test",
    specPath: "plans/spec.md",
    planPath: "plans/plan.md",
    sessionId: "abc",
    startedAt: "2026-01-01T00:00:00.000Z",
  };

  it("accepts a valid v3 state", () => {
    const result = validateRalplanState({ ...validV3 });
    expect(result).not.toBeNull();
    expect(result?.version).toBe(3);
  });

  it("migrates v1 → v2 → v3 (single call walks the chain)", () => {
    // Migration is incremental: v1→v2 sets mode, then v2→v3 bumps version.
    // A single call walks the whole chain so the persisted state is current.
    const v1 = { version: 1, active: true, pipeline: { stages: [] } };
    const result = validateRalplanState(
      v1 as unknown as Record<string, unknown>,
    );
    expect(result?.version).toBe(3);
    expect((result as unknown as { mode: string }).mode).toBe("ralplan");
  });

  it("migrates v2 → v3 (bump version)", () => {
    const v2 = { ...validV3, version: 2 };
    const result = validateRalplanState(
      v2 as unknown as Record<string, unknown>,
    );
    expect(result?.version).toBe(3);
  });

  it("rejects a future version (v4)", () => {
    const v4 = { ...validV3, version: 4 };
    expect(
      validateRalplanState(v4 as unknown as Record<string, unknown>),
    ).toBeNull();
  });

  it("rejects version < 1 (v0, v-1) — corrupted or hand-crafted state", () => {
    // v0 was never a real schema; v<1 means the file was hand-edited or
    // truncated. The field-level checks would otherwise accidentally accept
    // these as v3 because the critical fields happen to be present.
    const v0 = { ...validV3, version: 0 };
    const vNeg = { ...validV3, version: -1 };
    expect(
      validateRalplanState(v0 as unknown as Record<string, unknown>),
    ).toBeNull();
    expect(
      validateRalplanState(vNeg as unknown as Record<string, unknown>),
    ).toBeNull();
  });

  it("rejects when active is not boolean", () => {
    const bad = { ...validV3, active: "yes" };
    expect(
      validateRalplanState(bad as unknown as Record<string, unknown>),
    ).toBeNull();
  });

  it("rejects when pipeline is not an object", () => {
    const bad = { ...validV3, pipeline: null };
    expect(
      validateRalplanState(bad as unknown as Record<string, unknown>),
    ).toBeNull();
  });

  it("rejects when pipeline.stages is not an array", () => {
    const bad = { ...validV3, pipeline: { stages: "nope" } };
    expect(
      validateRalplanState(bad as unknown as Record<string, unknown>),
    ).toBeNull();
  });

  it("rejects when mode is missing", () => {
    const { mode, ...bad } = validV3;
    expect(
      validateRalplanState(bad as unknown as Record<string, unknown>),
    ).toBeNull();
  });

  it("accepts optional sessionId as undefined", () => {
    const { sessionId, ...rest } = validV3;
    expect(
      validateRalplanState(rest as unknown as Record<string, unknown>),
    ).not.toBeNull();
  });

  it("rejects when sessionId is the wrong type", () => {
    const bad = { ...validV3, sessionId: 42 };
    expect(
      validateRalplanState(bad as unknown as Record<string, unknown>),
    ).toBeNull();
  });
});

describe("isPersistedState type guard (T-7)", () => {
  const valid = {
    active: true,
    tracking: { stages: [{ id: "ralplan", status: "active", iterations: 0 }] },
    originalIdea: "test",
    specPath: "plans/spec.md",
    planPath: "plans/plan.md",
  };

  it("accepts a minimal valid PersistedState", () => {
    expect(isPersistedState(valid)).toBe(true);
  });

  it("accepts a fully-populated PersistedState", () => {
    const full = {
      ...valid,
      mode: "ralplan",
      sessionId: "abc",
      answersPath: "plans/answers.md",
      brainstorm: undefined,
      worktreePath: "/tmp/worktree",
      sessionCwd: "/tmp",
    };
    expect(isPersistedState(full)).toBe(true);
  });

  it("rejects null", () => {
    expect(isPersistedState(null)).toBe(false);
  });

  it("rejects non-objects", () => {
    expect(isPersistedState("string")).toBe(false);
    expect(isPersistedState(42)).toBe(false);
    expect(isPersistedState(undefined)).toBe(false);
  });

  it("rejects when active is not boolean", () => {
    expect(isPersistedState({ ...valid, active: "yes" })).toBe(false);
  });

  it("rejects when tracking.stages is not an array", () => {
    expect(isPersistedState({ ...valid, tracking: { stages: "nope" } })).toBe(
      false,
    );
  });

  it("rejects when originalIdea is missing", () => {
    const { originalIdea, ...bad } = valid;
    expect(isPersistedState(bad)).toBe(false);
  });

  it("rejects when specPath is wrong type", () => {
    expect(isPersistedState({ ...valid, specPath: 42 })).toBe(false);
  });

  it("rejects when planPath is wrong type", () => {
    expect(isPersistedState({ ...valid, planPath: 42 })).toBe(false);
  });

  it("accepts when optional mode/sessionId/answersPath are undefined", () => {
    const minimal = {
      active: true,
      tracking: { stages: [] },
      originalIdea: "x",
      specPath: "s",
      planPath: "p",
    };
    expect(isPersistedState(minimal)).toBe(true);
  });

  it("rejects when optional mode is wrong type", () => {
    expect(isPersistedState({ ...valid, mode: 42 })).toBe(false);
  });
});

describe("readRalplanStateFile uses validateRalplanState (T-7)", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "ralplan-state-test-"));
  });
  afterEach(() => {
    if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  });

  it("returns null for missing file", () => {
    expect(readRalplanStateFile(dir)).toBeNull();
  });

  it("returns null for malformed JSON", () => {
    const path = join(dir, ".pi", "ralplan", "state.json");
    mkdirSync(join(dir, ".pi", "ralplan"), { recursive: true });
    writeFileSync(path, "not json{", "utf-8");
    expect(readRalplanStateFile(dir)).toBeNull();
  });

  it("returns null for invalid shape (no v3 migration possible)", () => {
    const path = join(dir, ".pi", "ralplan", "state.json");
    mkdirSync(join(dir, ".pi", "ralplan"), { recursive: true });
    writeFileSync(path, JSON.stringify({ version: 3, garbage: true }), "utf-8");
    expect(readRalplanStateFile(dir)).toBeNull();
  });

  it("round-trips a valid state through write+read", () => {
    const tracking = buildPipelineTracking(resolvePipelineConfig());
    const state = buildDefaultState("test idea", tracking, "sess-1");
    writeRalplanStateFile(dir, state);
    const read = readRalplanStateFile(dir);
    expect(read).not.toBeNull();
    expect(read?.originalIdea).toBe("test idea");
    expect(read?.sessionId).toBe("sess-1");
  });
});
