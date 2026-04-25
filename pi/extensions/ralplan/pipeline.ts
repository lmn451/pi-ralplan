import { nowISO } from "./utils.js";

// ============================================================================
// TYPES
// ============================================================================

export type PipelineStageId = "ralplan" | "execution" | "ralph" | "qa";
export type PipelineTerminalState = "complete" | "failed" | "cancelled";
export type PipelinePhase = PipelineStageId | PipelineTerminalState;
export type StageStatus = "pending" | "active" | "complete" | "failed" | "skipped";

export const STAGE_ORDER: readonly PipelineStageId[] = ["ralplan", "execution", "ralph", "qa"] as const;

export type ExecutionBackend = "team" | "solo";

export interface VerificationConfig {
  engine: "ralph";
  maxIterations: number;
}

export interface PipelineConfig {
  planning: "ralplan" | "direct" | false;
  execution: ExecutionBackend;
  verification: VerificationConfig | false;
  qa: boolean;
}

export const DEFAULT_PIPELINE_CONFIG: PipelineConfig = {
  planning: "ralplan",
  execution: "solo",
  verification: { engine: "ralph", maxIterations: 100 },
  qa: true,
};

export interface PipelineContext {
  idea: string;
  directory: string;
  sessionId?: string;
  specPath?: string;
  planPath?: string;
  openQuestionsPath?: string;
  config: PipelineConfig;
}

export interface PipelineStageState {
  id: PipelineStageId;
  status: StageStatus;
  startedAt?: string;
  completedAt?: string;
  iterations: number;
  error?: string;
}

export interface PipelineTracking {
  pipelineConfig: PipelineConfig;
  stages: PipelineStageState[];
  currentStageIndex: number;
}

export interface PipelineStageAdapter {
  readonly id: PipelineStageId;
  readonly name: string;
  readonly completionSignal: string;
  shouldSkip(config: PipelineConfig): boolean;
  getPrompt(context: PipelineContext): string;
  onEnter?(context: PipelineContext): void;
  onExit?(context: PipelineContext): void;
}

// ============================================================================
// ADAPTER REGISTRY
// ============================================================================

let _adapters: readonly PipelineStageAdapter[] = [];

export function registerAdapters(adapters: readonly PipelineStageAdapter[]): void {
  _adapters = adapters;
}

export function getAdapterById(id: string): PipelineStageAdapter | undefined {
  return _adapters.find((a) => a.id === id);
}

export function getActiveAdapters(config: PipelineConfig): PipelineStageAdapter[] {
  return _adapters.filter((adapter) => !adapter.shouldSkip(config));
}

// ============================================================================
// CONFIG RESOLUTION
// ============================================================================

export function resolvePipelineConfig(userConfig?: Partial<PipelineConfig>): PipelineConfig {
  const config = { ...DEFAULT_PIPELINE_CONFIG };

  if (userConfig) {
    if (userConfig.planning !== undefined) config.planning = userConfig.planning;
    if (userConfig.execution !== undefined) config.execution = userConfig.execution;
    if (userConfig.verification !== undefined) config.verification = userConfig.verification;
    if (userConfig.qa !== undefined) config.qa = userConfig.qa;
  }

  return config;
}

// ============================================================================
// PIPELINE TRACKING
// ============================================================================

export function buildPipelineTracking(config: PipelineConfig): PipelineTracking {
  const stages: PipelineStageState[] = STAGE_ORDER.map((stageId) => {
    const adapter = getAdapterById(stageId);
    const isActive = adapter && !adapter.shouldSkip(config);
    return {
      id: stageId,
      status: isActive ? ("pending" as StageStatus) : ("skipped" as StageStatus),
      iterations: 0,
    };
  });

  const firstActiveIndex = stages.findIndex((s) => s.status !== "skipped");

  return {
    pipelineConfig: config,
    stages,
    currentStageIndex: firstActiveIndex >= 0 ? firstActiveIndex : 0,
  };
}

// ============================================================================
// STAGE TRANSITIONS
// ============================================================================

export function getCurrentStageAdapter(tracking: PipelineTracking): PipelineStageAdapter | null {
  const { stages, currentStageIndex } = tracking;
  if (currentStageIndex < 0 || currentStageIndex >= stages.length) return null;

  const currentStage = stages[currentStageIndex];
  if (currentStage.status === "skipped" || currentStage.status === "complete") {
    return getNextStageAdapter(tracking);
  }
  return getAdapterById(currentStage.id) ?? null;
}

export function getNextStageAdapter(tracking: PipelineTracking): PipelineStageAdapter | null {
  const { stages, currentStageIndex } = tracking;
  for (let i = currentStageIndex + 1; i < stages.length; i++) {
    if (stages[i].status !== "skipped") {
      return getAdapterById(stages[i].id) ?? null;
    }
  }
  return null;
}

export function advanceStage(
  tracking: PipelineTracking,
  context?: PipelineContext,
): {
  adapter: PipelineStageAdapter | null;
  phase: PipelinePhase;
  tracking: PipelineTracking;
} {
  const { stages, currentStageIndex } = tracking;

  // Call onExit for current stage
  if (context && currentStageIndex >= 0 && currentStageIndex < stages.length) {
    const currentAdapter = getAdapterById(stages[currentStageIndex].id);
    currentAdapter?.onExit?.(context);
  }

  if (currentStageIndex >= 0 && currentStageIndex < stages.length) {
    stages[currentStageIndex].status = "complete";
    stages[currentStageIndex].completedAt = nowISO();
  }

  let nextIndex = -1;
  for (let i = currentStageIndex + 1; i < stages.length; i++) {
    if (stages[i].status !== "skipped") {
      nextIndex = i;
      break;
    }
  }

  if (nextIndex < 0) {
    tracking.currentStageIndex = stages.length;
    return { adapter: null, phase: "complete", tracking };
  }

  tracking.currentStageIndex = nextIndex;
  stages[nextIndex].status = "active";
  stages[nextIndex].startedAt = nowISO();

  const nextAdapter = getAdapterById(stages[nextIndex].id);
  if (!nextAdapter) {
    stages[nextIndex].status = "failed";
    stages[nextIndex].error = `No adapter registered for stage "${stages[nextIndex].id}"`;
    return { adapter: null, phase: "failed", tracking };
  }

  // Call onEnter for next stage
  if (context) {
    nextAdapter.onEnter?.(context);
  }

  return { adapter: nextAdapter, phase: stages[nextIndex].id, tracking };
}

export function skipCurrentStage(
  tracking: PipelineTracking,
  context?: PipelineContext,
): {
  adapter: PipelineStageAdapter | null;
  phase: PipelinePhase;
  tracking: PipelineTracking;
} {
  const { stages, currentStageIndex } = tracking;

  if (context && currentStageIndex >= 0 && currentStageIndex < stages.length) {
    const currentAdapter = getAdapterById(stages[currentStageIndex].id);
    currentAdapter?.onExit?.(context);
  }

  if (currentStageIndex >= 0 && currentStageIndex < stages.length) {
    stages[currentStageIndex].status = "skipped";
    stages[currentStageIndex].completedAt = nowISO();
  }

  let nextIndex = -1;
  for (let i = currentStageIndex + 1; i < stages.length; i++) {
    if (stages[i].status !== "skipped") {
      nextIndex = i;
      break;
    }
  }

  if (nextIndex < 0) {
    tracking.currentStageIndex = stages.length;
    return { adapter: null, phase: "complete", tracking };
  }

  tracking.currentStageIndex = nextIndex;
  stages[nextIndex].status = "active";
  stages[nextIndex].startedAt = nowISO();

  const nextAdapter = getAdapterById(stages[nextIndex].id);
  if (!nextAdapter) {
    stages[nextIndex].status = "failed";
    stages[nextIndex].error = `No adapter registered for stage "${stages[nextIndex].id}"`;
    return { adapter: null, phase: "failed", tracking };
  }

  if (context) {
    nextAdapter.onEnter?.(context);
  }

  return { adapter: nextAdapter, phase: stages[nextIndex].id, tracking };
}

export function failCurrentStage(tracking: PipelineTracking, error: string): PipelineTracking {
  const { stages, currentStageIndex } = tracking;
  if (currentStageIndex >= 0 && currentStageIndex < stages.length) {
    stages[currentStageIndex].status = "failed";
    stages[currentStageIndex].error = error;
  }
  return tracking;
}

export function incrementStageIteration(tracking: PipelineTracking): PipelineTracking {
  const { stages, currentStageIndex } = tracking;
  if (currentStageIndex >= 0 && currentStageIndex < stages.length) {
    stages[currentStageIndex].iterations++;
  }
  return tracking;
}

// ============================================================================
// STATUS & INSPECTION
// ============================================================================

export function getPipelineStatus(tracking: PipelineTracking): {
  currentStage: PipelineStageId | null;
  completedStages: PipelineStageId[];
  pendingStages: PipelineStageId[];
  skippedStages: PipelineStageId[];
  isComplete: boolean;
  progress: string;
} {
  const completed: PipelineStageId[] = [];
  const pending: PipelineStageId[] = [];
  const skipped: PipelineStageId[] = [];
  let current: PipelineStageId | null = null;

  for (const stage of tracking.stages) {
    switch (stage.status) {
      case "complete":
        completed.push(stage.id);
        break;
      case "active":
        current = stage.id;
        break;
      case "pending":
        pending.push(stage.id);
        break;
      case "skipped":
        skipped.push(stage.id);
        break;
    }
  }

  const activeStages = tracking.stages.filter((s) => s.status !== "skipped");
  const completedCount = completed.length;
  const totalActive = activeStages.length;
  const isComplete = current === null && pending.length === 0;
  const progress = `${completedCount}/${totalActive} stages`;

  return {
    currentStage: current,
    completedStages: completed,
    pendingStages: pending,
    skippedStages: skipped,
    isComplete,
    progress,
  };
}

export function formatPipelineHUD(tracking: PipelineTracking): string[] {
  const lines: string[] = [];
  for (const stage of tracking.stages) {
    const adapter = getAdapterById(stage.id);
    const name = adapter?.name ?? stage.id;
    switch (stage.status) {
      case "complete":
        lines.push(`[OK] ${name}`);
        break;
      case "active":
        lines.push(`[>>] ${name} (iter ${stage.iterations})`);
        break;
      case "pending":
        lines.push(`[..] ${name}`);
        break;
      case "skipped":
        lines.push(`[--] ${name}`);
        break;
      case "failed":
        lines.push(`[!!] ${name}`);
        break;
    }
  }
  return lines;
}
