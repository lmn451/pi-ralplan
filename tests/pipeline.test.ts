import { describe, it, expect, afterEach } from "bun:test";
import {
  resolvePipelineConfig,
  buildPipelineTracking,
  getCurrentStageAdapter,
  getNextStageAdapter,
  advanceStage,
  skipCurrentStage,
  failCurrentStage,
  incrementStageIteration,
  getPipelineStatus,
  formatPipelineHUD,
  getAdapterById,
  registerAdapters,
  DEFAULT_PIPELINE_CONFIG,
  type PipelineConfig,
  type PipelineTracking,
  type PipelineContext,
  type PipelineStageAdapter,
} from "../pi/extensions/ralplan/pipeline.js";

import {
  ralplanAdapter,
  executionAdapter,
  ralphAdapter,
  qaAdapter,
} from "../pi/extensions/ralplan/adapters.js";

const DEFAULT_ADAPTERS = [
  ralplanAdapter,
  executionAdapter,
  ralphAdapter,
  qaAdapter,
] as const;
registerAdapters([...DEFAULT_ADAPTERS]);

// Restore default adapters after every test to prevent cross-test leakage
afterEach(() => {
  registerAdapters([...DEFAULT_ADAPTERS]);
});

describe("resolvePipelineConfig", () => {
  it("returns defaults when no overrides given", () => {
    const config = resolvePipelineConfig();
    expect(config.planning).toBe("ralplan");
    expect(config.execution).toBe("solo");
    expect(config.verification).toEqual({
      engine: "ralph",
      maxIterations: 100,
    });
    expect(config.qa).toBe(true);
  });

  it("applies user overrides", () => {
    const config = resolvePipelineConfig({
      planning: "direct",
      execution: "team",
      qa: false,
    });
    expect(config.planning).toBe("direct");
    expect(config.execution).toBe("team");
    expect(config.qa).toBe(false);
    expect(config.verification).toEqual({
      engine: "ralph",
      maxIterations: 100,
    });
  });

  it("allows disabling verification", () => {
    const config = resolvePipelineConfig({ verification: false });
    expect(config.verification).toBe(false);
  });

  it("allows disabling planning", () => {
    const config = resolvePipelineConfig({ planning: false });
    expect(config.planning).toBe(false);
    expect(config.execution).toBe("solo");
  });

  it("preserves partial verification overrides", () => {
    const config = resolvePipelineConfig({
      verification: { engine: "ralph", maxIterations: 50 },
    });
    expect(config.verification).toEqual({ engine: "ralph", maxIterations: 50 });
  });
});

describe("buildPipelineTracking", () => {
  it("creates all active stages with default config", () => {
    const tracking = buildPipelineTracking(DEFAULT_PIPELINE_CONFIG);
    expect(tracking.stages).toHaveLength(4);
    expect(tracking.stages[0].id).toBe("ralplan");
    expect(tracking.stages[0].status).toBe("pending");
    expect(tracking.stages[1].status).toBe("pending");
    expect(tracking.currentStageIndex).toBe(0);
  });

  it("skips stages based on config", () => {
    const config: PipelineConfig = {
      planning: false,
      execution: "solo",
      verification: false,
      qa: false,
    };
    const tracking = buildPipelineTracking(config);
    expect(tracking.stages[0].status).toBe("skipped"); // ralplan
    expect(tracking.stages[1].status).toBe("pending"); // execution
    expect(tracking.stages[2].status).toBe("skipped"); // ralph
    expect(tracking.stages[3].status).toBe("skipped"); // qa
    expect(tracking.currentStageIndex).toBe(1);
  });
});

describe("getCurrentStageAdapter", () => {
  it("returns the active stage adapter", () => {
    const tracking = buildPipelineTracking(DEFAULT_PIPELINE_CONFIG);
    const adapter = getCurrentStageAdapter(tracking);
    expect(adapter).toBeDefined();
    expect(adapter!.id).toBe("ralplan");
  });

  it("returns null when all stages skipped", () => {
    const config: PipelineConfig = {
      planning: false,
      execution: "solo",
      verification: false,
      qa: false,
    };
    const tracking = buildPipelineTracking(config);
    // execution is "solo" not false, so this test needs adjustment
    // Instead, let's manually set all to skipped
    tracking.stages.forEach((s) => (s.status = "skipped"));
    tracking.currentStageIndex = tracking.stages.length;
    expect(getCurrentStageAdapter(tracking)).toBeNull();
  });
});

describe("advanceStage", () => {
  it("advances from ralplan to execution", () => {
    const tracking = buildPipelineTracking(DEFAULT_PIPELINE_CONFIG);
    const result = advanceStage(tracking);
    expect(result.phase).toBe("execution");
    expect(result.adapter?.id).toBe("execution");
    expect(tracking.stages[0].status).toBe("complete");
    expect(tracking.stages[1].status).toBe("active");
  });

  it("advances through all stages to complete", () => {
    const tracking = buildPipelineTracking(DEFAULT_PIPELINE_CONFIG);
    let result = advanceStage(tracking);
    expect(result.phase).toBe("execution");
    result = advanceStage(tracking);
    expect(result.phase).toBe("ralph");
    result = advanceStage(tracking);
    expect(result.phase).toBe("qa");
    result = advanceStage(tracking);
    expect(result.phase).toBe("complete");
    expect(result.adapter).toBeNull();
  });

  it("skips disabled stages when advancing", () => {
    const config: PipelineConfig = {
      planning: "ralplan",
      execution: "solo",
      verification: false,
      qa: true,
    };
    const tracking = buildPipelineTracking(config);
    // ralplan active, execution pending, ralph skipped, qa pending
    const result = advanceStage(tracking);
    expect(result.phase).toBe("execution");
    const result2 = advanceStage(tracking);
    expect(result2.phase).toBe("qa"); // skips ralph
  });

  it("returns failed phase when adapter is missing for an active stage", () => {
    // Manually construct tracking where stage 1 is pending but adapter won't be found
    const tracking: PipelineTracking = {
      pipelineConfig: DEFAULT_PIPELINE_CONFIG,
      stages: [
        {
          id: "ralplan",
          status: "complete",
          iterations: 0,
          completedAt: "2024-01-01",
        },
        { id: "execution", status: "pending", iterations: 0 },
        { id: "ralph", status: "skipped", iterations: 0 },
        { id: "qa", status: "skipped", iterations: 0 },
      ],
      currentStageIndex: 0,
    };
    // Clear adapters so execution adapter is missing
    registerAdapters([]);
    const result = advanceStage(tracking);
    expect(result.phase).toBe("failed");
    expect(result.adapter).toBeNull();
    expect(tracking.stages[1].status).toBe("failed");
    expect(tracking.stages[1].error).toContain(
      'No adapter registered for stage "execution"',
    );
  });

  it("calls onExit and onEnter lifecycle hooks", () => {
    const exited: string[] = [];
    const entered: string[] = [];

    const mockAdapter: PipelineStageAdapter = {
      id: "ralplan",
      name: "Mock Planning",
      completionSignal: "MOCK_COMPLETE",
      shouldSkip: () => false,
      getPrompt: () => "mock prompt",
      onExit: () => exited.push("ralplan-exit"),
      onEnter: () => entered.push("ralplan-enter"),
    };

    const mockExec: PipelineStageAdapter = {
      id: "execution",
      name: "Mock Execution",
      completionSignal: "MOCK_EXEC_COMPLETE",
      shouldSkip: () => false,
      getPrompt: () => "mock exec",
      onEnter: () => entered.push("execution-enter"),
    };

    registerAdapters([mockAdapter, mockExec]);
    const config: PipelineConfig = {
      planning: "ralplan",
      execution: "solo",
      verification: false,
      qa: false,
    };
    const tracking = buildPipelineTracking(config);
    tracking.stages[0].status = "active";

    const ctx: PipelineContext = { idea: "test", directory: "/tmp", config };
    advanceStage(tracking, ctx);

    expect(exited).toContain("ralplan-exit");
    expect(entered).toContain("execution-enter");
  });

  it("marks skipped stages as skipped when explicitly skipped", () => {
    const tracking = buildPipelineTracking(DEFAULT_PIPELINE_CONFIG);
    tracking.stages[0].status = "active";

    const result = skipCurrentStage(tracking);

    expect(result.phase).toBe("execution");
    expect(tracking.stages[0].status).toBe("skipped");
    expect(tracking.stages[1].status).toBe("active");
  });
});

describe("failCurrentStage", () => {
  it("marks current stage as failed", () => {
    const tracking = buildPipelineTracking(DEFAULT_PIPELINE_CONFIG);
    failCurrentStage(tracking, "something broke");
    expect(tracking.stages[0].status).toBe("failed");
    expect(tracking.stages[0].error).toBe("something broke");
  });
});

describe("incrementStageIteration", () => {
  it("increments iteration counter", () => {
    const tracking = buildPipelineTracking(DEFAULT_PIPELINE_CONFIG);
    expect(tracking.stages[0].iterations).toBe(0);
    incrementStageIteration(tracking);
    expect(tracking.stages[0].iterations).toBe(1);
    incrementStageIteration(tracking);
    expect(tracking.stages[0].iterations).toBe(2);
  });
});

describe("getPipelineStatus", () => {
  it("reports correct status for fresh pipeline", () => {
    const tracking = buildPipelineTracking(DEFAULT_PIPELINE_CONFIG);
    const status = getPipelineStatus(tracking);
    expect(status.currentStage).toBeNull(); // none active yet, all pending
    expect(status.completedStages).toEqual([]);
    expect(status.isComplete).toBe(false);
    expect(status.progress).toBe("0/4 stages");
  });

  it("reports complete when all stages done", () => {
    const tracking = buildPipelineTracking(DEFAULT_PIPELINE_CONFIG);
    tracking.stages.forEach((s) => (s.status = "complete"));
    tracking.currentStageIndex = tracking.stages.length;
    const status = getPipelineStatus(tracking);
    expect(status.isComplete).toBe(true);
    expect(status.progress).toBe("4/4 stages");
  });
});

describe("formatPipelineHUD", () => {
  it("formats all stage statuses", () => {
    const tracking = buildPipelineTracking(DEFAULT_PIPELINE_CONFIG);
    const hud = formatPipelineHUD(tracking);
    expect(hud[0]).toContain("..") && expect(hud[0]).toContain("Planning");
    expect(hud[1]).toContain("..");
    expect(hud[2]).toContain("..");
    expect(hud[3]).toContain("..");
  });

  it("shows skipped stages", () => {
    const config: PipelineConfig = {
      planning: false,
      execution: "solo",
      verification: false,
      qa: false,
    };
    const tracking = buildPipelineTracking(config);
    const hud = formatPipelineHUD(tracking);
    expect(hud[0]).toContain("--");
    expect(hud[1]).toContain("..") && expect(hud[1]).toContain("Execution");
    expect(hud[2]).toContain("--");
    expect(hud[3]).toContain("--");
  });
});
