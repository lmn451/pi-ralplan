import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  readRalplanStateFile,
  writeRalplanStateFile,
  clearRalplanStateFile,
  buildDefaultState,
  validateRalplanState,
} from "../pi/extensions/ralplan/state.js";

import {
  buildPipelineTracking,
  DEFAULT_PIPELINE_CONFIG,
} from "../pi/extensions/ralplan/pipeline.js";

import { getDefaultArtifactFilename } from "../pi/extensions/ralplan/artifacts.js";

let tempDir: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "ralplan-test-"));
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

describe("readRalplanStateFile", () => {
  it("returns null when no state file exists", () => {
    expect(readRalplanStateFile(tempDir)).toBeNull();
  });

  it("reads back written state", () => {
    const pipeline = buildPipelineTracking(DEFAULT_PIPELINE_CONFIG);
    const state = buildDefaultState("test idea", pipeline, "session-123");
    writeRalplanStateFile(tempDir, state);

    const read = readRalplanStateFile(tempDir);
    expect(read).not.toBeNull();
    expect(read!.originalIdea).toBe("test idea");
    expect(read!.active).toBe(true);
    expect(read!.sessionId).toBe("session-123");
    expect(read!.version).toBe(3);
  });

  it("returns null for invalid json", () => {
    const statePath = join(tempDir, ".pi", "ralplan", "state.json");
    mkdirSync(join(tempDir, ".pi", "ralplan"), { recursive: true });
    writeFileSync(statePath, "not json", "utf-8");
    expect(readRalplanStateFile(tempDir)).toBeNull();
  });
});

describe("writeRalplanStateFile", () => {
  it("creates directories if needed", () => {
    const pipeline = buildPipelineTracking(DEFAULT_PIPELINE_CONFIG);
    const state = buildDefaultState("idea", pipeline);
    // tempDir/.pi/ralplan does not exist yet
    writeRalplanStateFile(tempDir, state);
    expect(readRalplanStateFile(tempDir)).not.toBeNull();
  });
});

describe("clearRalplanStateFile", () => {
  it("removes state file", () => {
    const pipeline = buildPipelineTracking(DEFAULT_PIPELINE_CONFIG);
    const state = buildDefaultState("idea", pipeline);
    writeRalplanStateFile(tempDir, state);
    expect(readRalplanStateFile(tempDir)).not.toBeNull();

    clearRalplanStateFile(tempDir);
    expect(readRalplanStateFile(tempDir)).toBeNull();
  });

  it("does not throw when file does not exist", () => {
    expect(() => clearRalplanStateFile(tempDir)).not.toThrow();
  });
});

describe("buildDefaultState", () => {
  it("builds state with correct defaults", () => {
    const pipeline = buildPipelineTracking(DEFAULT_PIPELINE_CONFIG);
    const state = buildDefaultState("my idea", pipeline, "s1");
    expect(state.version).toBe(3);
    expect(state.active).toBe(true);
    expect(state.originalIdea).toBe("my idea");
    expect(state.mode).toBe("ralplan");
    expect(state.specPath).toBe(`plans/${getDefaultArtifactFilename("spec")}`);
    expect(state.planPath).toBe(`plans/${getDefaultArtifactFilename("plan")}`);
    expect(state.sessionId).toBe("s1");
    expect(state.startedAt).toBeDefined();
  });

  it("builds state with brainstorm mode", () => {
    const pipeline = buildPipelineTracking(DEFAULT_PIPELINE_CONFIG);
    const state = buildDefaultState(
      "idea",
      pipeline,
      undefined,
      "brainstorm",
      tempDir,
    );
    expect(state.version).toBe(3);
    expect(state.mode).toBe("brainstorm");
    expect(state.brainstorm).toBeDefined();
    expect(state.brainstorm?.subPhase).toBe("expanding");
    expect(state.answersPath).toBeDefined();
  });

  it("migrates v1 state to v2", () => {
    const pipeline = buildPipelineTracking(DEFAULT_PIPELINE_CONFIG);
    const v1State = {
      version: 1,
      active: true,
      pipeline: pipeline,
      originalIdea: "test v1",
      specPath: "plans/spec.md",
      planPath: "plans/plan.md",
      startedAt: new Date().toISOString(),
    };
    mkdirSync(join(tempDir, ".pi", "ralplan"), { recursive: true });
    writeFileSync(
      join(tempDir, ".pi", "ralplan", "state.json"),
      JSON.stringify(v1State, null, 2),
      "utf-8",
    );
    const read = readRalplanStateFile(tempDir);
    expect(read).not.toBeNull();
    expect(read!.version).toBe(3);
    expect(read!.mode).toBe("ralplan");
    expect(read!.brainstorm).toBeUndefined();
  });
});

describe("readRalplanStateFile validation", () => {
  const writeState = (state: object) => {
    mkdirSync(join(tempDir, ".pi", "ralplan"), { recursive: true });
    writeFileSync(
      join(tempDir, ".pi", "ralplan", "state.json"),
      JSON.stringify(state, null, 2),
      "utf-8",
    );
  };

  describe("malformed state", () => {
    it("returns null when active field is missing", () => {
      const state = {
        version: 3,
        // active missing
        pipeline: { stages: [] },
        mode: "ralplan",
        originalIdea: "test",
        specPath: "plans/spec.md",
        planPath: "plans/plan.md",
        startedAt: new Date().toISOString(),
      };
      writeState(state);
      expect(readRalplanStateFile(tempDir)).toBeNull();
    });

    it("returns null when active is not a boolean", () => {
      const state = {
        version: 3,
        active: "true", // string, not boolean
        pipeline: { stages: [] },
        mode: "ralplan",
        originalIdea: "test",
        specPath: "plans/spec.md",
        planPath: "plans/plan.md",
        startedAt: new Date().toISOString(),
      };
      writeState(state);
      expect(readRalplanStateFile(tempDir)).toBeNull();
    });

    it("returns null when pipeline is missing", () => {
      const state = {
        version: 3,
        active: true,
        mode: "ralplan",
        originalIdea: "test",
        specPath: "plans/spec.md",
        planPath: "plans/plan.md",
        startedAt: new Date().toISOString(),
      };
      writeState(state);
      expect(readRalplanStateFile(tempDir)).toBeNull();
    });

    it("returns null when pipeline.stages is missing", () => {
      const state = {
        version: 3,
        active: true,
        pipeline: {
          /* stages missing */
        },
        mode: "ralplan",
        originalIdea: "test",
        specPath: "plans/spec.md",
        planPath: "plans/plan.md",
        startedAt: new Date().toISOString(),
      };
      writeState(state);
      expect(readRalplanStateFile(tempDir)).toBeNull();
    });

    it("returns null when pipeline.stages is not an array", () => {
      const state = {
        version: 3,
        active: true,
        pipeline: { stages: "not-an-array" },
        mode: "ralplan",
        originalIdea: "test",
        specPath: "plans/spec.md",
        planPath: "plans/plan.md",
        startedAt: new Date().toISOString(),
      };
      writeState(state);
      expect(readRalplanStateFile(tempDir)).toBeNull();
    });

    it("returns null when mode is missing", () => {
      const state = {
        version: 3,
        active: true,
        pipeline: { stages: [] },
        // mode missing
        originalIdea: "test",
        specPath: "plans/spec.md",
        planPath: "plans/plan.md",
        startedAt: new Date().toISOString(),
      };
      writeState(state);
      expect(readRalplanStateFile(tempDir)).toBeNull();
    });

    it("returns null when mode is not a string", () => {
      const state = {
        version: 3,
        active: true,
        pipeline: { stages: [] },
        mode: 123, // number, not string
        originalIdea: "test",
        specPath: "plans/spec.md",
        planPath: "plans/plan.md",
        startedAt: new Date().toISOString(),
      };
      writeState(state);
      expect(readRalplanStateFile(tempDir)).toBeNull();
    });

    it("returns null when sessionId is present but not a string", () => {
      const state = {
        version: 3,
        active: true,
        pipeline: { stages: [] },
        mode: "ralplan",
        sessionId: 12345, // number, not string
        originalIdea: "test",
        specPath: "plans/spec.md",
        planPath: "plans/plan.md",
        startedAt: new Date().toISOString(),
      };
      writeState(state);
      expect(readRalplanStateFile(tempDir)).toBeNull();
    });

    it("returns null when sessionId is an object instead of string", () => {
      const state = {
        version: 3,
        active: true,
        pipeline: { stages: [] },
        mode: "ralplan",
        sessionId: { id: "123" }, // object, not string
        originalIdea: "test",
        specPath: "plans/spec.md",
        planPath: "plans/plan.md",
        startedAt: new Date().toISOString(),
      };
      writeState(state);
      expect(readRalplanStateFile(tempDir)).toBeNull();
    });

    it("allows null sessionId", () => {
      const state = {
        version: 3,
        active: true,
        pipeline: { stages: [] },
        mode: "ralplan",
        sessionId: null,
        originalIdea: "test",
        specPath: "plans/spec.md",
        planPath: "plans/plan.md",
        startedAt: new Date().toISOString(),
      };
      writeState(state);
      expect(readRalplanStateFile(tempDir)).not.toBeNull();
    });

    it("allows undefined sessionId", () => {
      const state = {
        version: 3,
        active: true,
        pipeline: { stages: [] },
        mode: "ralplan",
        // sessionId not present
        originalIdea: "test",
        specPath: "plans/spec.md",
        planPath: "plans/plan.md",
        startedAt: new Date().toISOString(),
      };
      writeState(state);
      expect(readRalplanStateFile(tempDir)).not.toBeNull();
    });

    it("returns null for future version", () => {
      const state = {
        version: 99,
        active: true,
        pipeline: { stages: [] },
        mode: "ralplan",
        originalIdea: "test",
        specPath: "plans/spec.md",
        planPath: "plans/plan.md",
        startedAt: new Date().toISOString(),
      };
      writeState(state);
      expect(readRalplanStateFile(tempDir)).toBeNull();
    });
  });

  describe("version migration", () => {
    it("migrates v1 state through v2 to v3", () => {
      const pipeline = buildPipelineTracking(DEFAULT_PIPELINE_CONFIG);
      const v1State = {
        version: 1,
        active: true,
        pipeline: pipeline,
        originalIdea: "v1 migration test",
        specPath: "plans/spec.md",
        planPath: "plans/plan.md",
        startedAt: new Date().toISOString(),
      };
      writeState(v1State);
      const read = readRalplanStateFile(tempDir);
      expect(read).not.toBeNull();
      expect(read!.version).toBe(3);
      expect(read!.mode).toBe("ralplan");
      expect(read!.brainstorm).toBeUndefined();
      expect(read!.worktreePath).toBeUndefined();
    });

    it("migrates v2 state to v3", () => {
      const pipeline = buildPipelineTracking(DEFAULT_PIPELINE_CONFIG);
      const v2State = {
        version: 2,
        active: false,
        mode: "brainstorm",
        pipeline: pipeline,
        originalIdea: "v2 migration test",
        specPath: "plans/spec.md",
        planPath: "plans/plan.md",
        startedAt: new Date().toISOString(),
      };
      writeState(v2State);
      const read = readRalplanStateFile(tempDir);
      expect(read).not.toBeNull();
      expect(read!.version).toBe(3);
      expect(read!.mode).toBe("brainstorm");
      expect(read!.worktreePath).toBeUndefined();
    });

    it("preserves brainstorm state during v1 to v3 migration", () => {
      const pipeline = buildPipelineTracking(DEFAULT_PIPELINE_CONFIG);
      const v1BrainstormState = {
        version: 1,
        active: true,
        mode: "brainstorm",
        brainstorm: {
          subPhase: "expanding",
          answeredQuestions: [],
        },
        answersPath: "answers.md",
        pipeline: pipeline,
        originalIdea: "v1 brainstorm test",
        specPath: "plans/spec.md",
        planPath: "plans/plan.md",
        startedAt: new Date().toISOString(),
      };
      writeState(v1BrainstormState);
      const read = readRalplanStateFile(tempDir);
      expect(read).not.toBeNull();
      expect(read!.version).toBe(3);
      // Note: v1→v2 migration unconditionally sets mode to "ralplan"
      // so brainstorm mode is not preserved through migration
      expect(read!.mode).toBe("ralplan");
      // but brainstorm object is preserved
      expect(read!.brainstorm).toBeDefined();
      expect(read!.brainstorm!.subPhase).toBe("expanding");
    });

    it("returns null when v1 state is missing required fields after migration", () => {
      // v1 state missing mode field, after migration to v2 the validation would still fail
      // because the v2 migration adds mode if missing, but v1 without active would fail
      const v1IncompleteState = {
        version: 1,
        // active missing
        pipeline: { stages: [] },
        originalIdea: "v1 incomplete",
        specPath: "plans/spec.md",
        planPath: "plans/plan.md",
        startedAt: new Date().toISOString(),
      };
      writeState(v1IncompleteState);
      expect(readRalplanStateFile(tempDir)).toBeNull();
    });
  });
});

// T-7.1: validateRalplanState is the shared validation helper used by both
// readRalplanStateFile and the session-entry type guard. It should reject
// invalid shapes and migrate v1/v2 to v3.
describe("validateRalplanState (T-7.1)", () => {
  it("rejects non-object input", () => {
    expect(validateRalplanState(null)).toBeNull();
    expect(validateRalplanState(undefined)).toBeNull();
    expect(validateRalplanState("string")).toBeNull();
    expect(validateRalplanState(42)).toBeNull();
  });

  it("rejects missing required fields", () => {
    expect(validateRalplanState({})).toBeNull();
    expect(validateRalplanState({ version: 3 })).toBeNull();
    expect(
      validateRalplanState({
        version: 3,
        active: "not a bool",
        pipeline: { stages: [] },
        mode: "ralplan",
      }),
    ).toBeNull();
  });

  it("rejects missing stages array", () => {
    expect(
      validateRalplanState({
        version: 3,
        active: true,
        pipeline: {},
        mode: "ralplan",
      }),
    ).toBeNull();
  });

  it("migrates v1 to v3 and sets mode='ralplan'", () => {
    const result = validateRalplanState({
      version: 1,
      active: true,
      pipeline: { stages: [] },
      mode: "ignored",
    });
    expect(result).not.toBeNull();
    expect(result?.version).toBe(3);
    expect(result?.mode).toBe("ralplan");
  });

  it("migrates v2 to v3 without overwriting mode", () => {
    const result = validateRalplanState({
      version: 2,
      active: true,
      pipeline: { stages: [] },
      mode: "brainstorm",
    });
    expect(result?.version).toBe(3);
    expect(result?.mode).toBe("brainstorm");
  });

  it("accepts a valid v3 state", () => {
    const result = validateRalplanState({
      version: 3,
      active: true,
      pipeline: { stages: [] },
      mode: "ralplan",
    });
    expect(result).not.toBeNull();
  });

  it("rejects future versions (greater than CURRENT_VERSION=3)", () => {
    expect(
      validateRalplanState({
        version: 99,
        active: true,
        pipeline: { stages: [] },
        mode: "ralplan",
      }),
    ).toBeNull();
  });
});

