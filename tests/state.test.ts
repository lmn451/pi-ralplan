import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  readRalplanStateFile,
  writeRalplanStateFile,
  clearRalplanStateFile,
  buildDefaultState,
} from "../pi/extensions/ralplan/state.js";
import { buildPipelineTracking, DEFAULT_PIPELINE_CONFIG } from "../pi/extensions/ralplan/pipeline.js";

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
    expect(read!.version).toBe(2);
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
    expect(state.version).toBe(2);
    expect(state.active).toBe(true);
    expect(state.originalIdea).toBe("my idea");
    expect(state.mode).toBe("ralplan");
    expect(state.specPath).toBe("plans/spec.md");
    expect(state.planPath).toBe("plans/plan.md");
    expect(state.sessionId).toBe("s1");
    expect(state.startedAt).toBeDefined();
  });

  it("builds state with brainstorm mode", () => {
    const pipeline = buildPipelineTracking(DEFAULT_PIPELINE_CONFIG);
    const state = buildDefaultState("idea", pipeline, undefined, "brainstorm", tempDir);
    expect(state.version).toBe(2);
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
    writeFileSync(join(tempDir, ".pi", "ralplan", "state.json"), JSON.stringify(v1State, null, 2), "utf-8");
    const read = readRalplanStateFile(tempDir);
    expect(read).not.toBeNull();
    expect(read!.version).toBe(2);
    expect(read!.mode).toBe("ralplan");
    expect(read!.brainstorm).toBeUndefined();
  });
});
