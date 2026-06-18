import { nowISO } from "./utils.js";

// ============================================================================
// TYPES
// ============================================================================

export type PipelineStageId = "ralplan" | "execution" | "ralph" | "qa";

// Per-stage max iteration caps. Single source of truth — the prompt templates
// (which hardcode their own cap) AND the runtime turn_end check both consult
// this helper. Keeps the two in lockstep so the prompt can't promise "Max 5"
// while the runtime check allows 100.
//
// Note: QA's prompt doesn't currently embed the cap; the cap lives in
// getStageMaxIterations. If you raise QA's cap, raise both.
export const DEFAULT_STAGE_MAX_ITERATIONS: Record<PipelineStageId, number> = {
  ralplan: 100,
  execution: 100,
  ralph: 100, // overridden at call time by config.verification.maxIterations
  qa: 5,
} as const;

export type PipelineTerminalState = "complete" | "failed" | "cancelled";
export type PipelinePhase = PipelineStageId | PipelineTerminalState;
export type StageStatus =
  | "pending"
  | "active"
  | "complete"
  | "failed"
  | "skipped";

export const STAGE_ORDER: readonly PipelineStageId[] = [
  "ralplan",
  "execution",
  "ralph",
  "qa",
] as const;

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
  /**
   * If true, `git worktree remove` runs automatically when the pipeline
   * completes (deactivateState). Default: false — the worktree is preserved
   * on completion. /ralplan:cancel always preserves the worktree regardless
   * of this flag (uses suppressCleanup at the call site).
   */
  autoCleanup?: boolean;
}

export const DEFAULT_PIPELINE_CONFIG: PipelineConfig = {
  planning: "ralplan",
  execution: "solo",
  verification: { engine: "ralph", maxIterations: 100 },
  qa: true,
};

export interface PipelineContext {
  idea: string;
  /**
   * Original repository directory — where `git worktree` was run from.
   * Used by path-derivation helpers (e.g. `resolveWorktreeRoot`).
   * MUST NOT be the worktree path; use `cwd` or `worktreePath` for that.
   */
  directory: string;
  /**
   * Actual working directory for the agent. Equals `worktreePath` when a
   * worktree exists, else falls back to `directory`. Use this to set the
   * agent's `cwd`.
   */
  cwd: string; // Explicit working directory — set to worktreePath when available, else sessionCwd
  sessionId?: string;
  specPath?: string;
  planPath?: string;
  openQuestionsPath?: string;
  answersPath?: string;
  config: PipelineConfig;
  mode?: "ralplan" | "brainstorm";
  brainstorm?: import("./brainstorm.js").BrainstormState;
  worktreePath?: string; // Associated worktree path (set during execution entry)
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

export function registerAdapters(
  adapters: readonly PipelineStageAdapter[],
): void {
  _adapters = adapters;
}

export function getAdapterById(
  id: PipelineStageId,
): PipelineStageAdapter | undefined {
  return _adapters.find((a) => a.id === id);
}

export function getActiveAdapters(
  config: PipelineConfig,
): PipelineStageAdapter[] {
  return _adapters.filter((adapter) => !adapter.shouldSkip(config));
}

/**
 * Per-stage max iteration cap. Single source of truth for both the prompt
 * templates (which bake the cap into the prompt text) and the runtime
 * turn_end check (which compares `currentStage.iterations` to the cap).
 *
 * Caps:
 * - `ralplan` / `execution` (planning stages): 100
 * - `qa` (build/lint/test cycling): 5
 * - `ralph` (verification loop): reads `config.verification.maxIterations`
 *   (default 100). Falls back to 100 if verification is disabled (the stage
 *   shouldn't be active in that case, but the helper stays total).
 */
export function getStageMaxIterations(
  stageId: PipelineStageId,
  config: PipelineConfig,
): number {
  switch (stageId) {
    case "ralplan":
    case "execution":
      return DEFAULT_STAGE_MAX_ITERATIONS[stageId];
    case "qa":
      return DEFAULT_STAGE_MAX_ITERATIONS.qa;
    case "ralph":
      return config.verification === false
        ? 100
        : (config.verification.maxIterations ?? 100);
  }
}

// ============================================================================
// CONFIG RESOLUTION
// ============================================================================

export function resolvePipelineConfig(
  userConfig?: Partial<PipelineConfig>,
): PipelineConfig {
  const config = { ...DEFAULT_PIPELINE_CONFIG };

  if (userConfig) {
    if (userConfig.planning !== undefined)
      config.planning = userConfig.planning;
    if (userConfig.execution !== undefined)
      config.execution = userConfig.execution;
    if (userConfig.verification !== undefined)
      config.verification = userConfig.verification;
    if (userConfig.qa !== undefined) config.qa = userConfig.qa;
  }

  return config;
}

// ============================================================================
// PIPELINE TRACKING
// ============================================================================

export function buildPipelineTracking(
  config: PipelineConfig,
): PipelineTracking {
  const stages: PipelineStageState[] = STAGE_ORDER.map((stageId) => {
    const adapter = getAdapterById(stageId);
    const isActive = adapter && !adapter.shouldSkip(config);
    return {
      id: stageId,
      status: isActive
        ? ("pending" as StageStatus)
        : ("skipped" as StageStatus),
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

export function syncTrackingToConfig(
  tracking: PipelineTracking,
): PipelineTracking {
  const { stages, currentStageIndex, pipelineConfig } = tracking;

  for (let i = 0; i < stages.length; i++) {
    if (i <= currentStageIndex) continue;
    const stage = stages[i];
    if (!stage) continue; // narrow type after noUncheckedIndexedAccess

    if (
      stage.status === "complete" ||
      stage.status === "failed" ||
      stage.status === "active"
    ) {
      continue;
    }

    const adapter = getAdapterById(stage.id);
    const shouldSkip = adapter?.shouldSkip(pipelineConfig) ?? false;

    if (shouldSkip) {
      stage.status = "skipped";
      stage.completedAt = nowISO();
      continue;
    }

    stage.status = "pending";
    stage.completedAt = undefined;
    stage.error = undefined;
  }

  return tracking;
}

// ============================================================================
// STAGE TRANSITIONS
// ============================================================================

export function getCurrentStageAdapter(
  tracking: PipelineTracking,
): PipelineStageAdapter | null {
  const { stages, currentStageIndex } = tracking;
  if (currentStageIndex < 0 || currentStageIndex >= stages.length) return null;

  const currentStage = stages[currentStageIndex];
  if (!currentStage) return null;
  if (currentStage.status === "skipped" || currentStage.status === "complete") {
    return getNextStageAdapter(tracking);
  }
  return getAdapterById(currentStage.id) ?? null;
}

export function getNextStageAdapter(
  tracking: PipelineTracking,
): PipelineStageAdapter | null {
  const { stages, currentStageIndex } = tracking;
  for (let i = currentStageIndex + 1; i < stages.length; i++) {
    const stage = stages[i];
    if (!stage) continue;
    if (stage.status !== "skipped") {
      return getAdapterById(stage.id) ?? null;
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
    const currentStage = stages[currentStageIndex];
    if (currentStage) {
      const currentAdapter = getAdapterById(currentStage.id);
      currentAdapter?.onExit?.(context);
    }
  }

  if (currentStageIndex >= 0 && currentStageIndex < stages.length) {
    const currentStage = stages[currentStageIndex];
    if (currentStage) {
      currentStage.status = "complete";
      currentStage.completedAt = nowISO();
    }
  }

  let nextIndex = -1;
  for (let i = currentStageIndex + 1; i < stages.length; i++) {
    const stage = stages[i];
    if (!stage) continue;
    if (stage.status !== "skipped") {
      nextIndex = i;
      break;
    }
  }

  if (nextIndex < 0) {
    tracking.currentStageIndex = stages.length;
    return { adapter: null, phase: "complete", tracking };
  }

  const nextStage = stages[nextIndex];
  if (!nextStage) {
    return { adapter: null, phase: "failed", tracking };
  }

  tracking.currentStageIndex = nextIndex;
  nextStage.status = "active";
  nextStage.startedAt = nowISO();

  const nextAdapter = getAdapterById(nextStage.id);
  if (!nextAdapter) {
    nextStage.status = "failed";
    nextStage.error = `No adapter registered for stage "${nextStage.id}"`;
    return { adapter: null, phase: "failed", tracking };
  }

  // Call onEnter for next stage
  if (context) {
    nextAdapter.onEnter?.(context);
  }

  return { adapter: nextAdapter, phase: nextStage.id, tracking };
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
    const currentStage = stages[currentStageIndex];
    if (currentStage) {
      const currentAdapter = getAdapterById(currentStage.id);
      currentAdapter?.onExit?.(context);
    }
  }

  if (currentStageIndex >= 0 && currentStageIndex < stages.length) {
    const currentStage = stages[currentStageIndex];
    if (currentStage) {
      currentStage.status = "skipped";
      currentStage.completedAt = nowISO();
    }
  }

  let nextIndex = -1;
  for (let i = currentStageIndex + 1; i < stages.length; i++) {
    const stage = stages[i];
    if (!stage) continue;
    if (stage.status !== "skipped") {
      nextIndex = i;
      break;
    }
  }

  if (nextIndex < 0) {
    tracking.currentStageIndex = stages.length;
    return { adapter: null, phase: "complete", tracking };
  }

  const nextStage = stages[nextIndex];
  if (!nextStage) {
    return { adapter: null, phase: "failed", tracking };
  }

  tracking.currentStageIndex = nextIndex;
  nextStage.status = "active";
  nextStage.startedAt = nowISO();

  const nextAdapter = getAdapterById(nextStage.id);
  if (!nextAdapter) {
    nextStage.status = "failed";
    nextStage.error = `No adapter registered for stage "${nextStage.id}"`;
    return { adapter: null, phase: "failed", tracking };
  }

  if (context) {
    nextAdapter.onEnter?.(context);
  }

  return { adapter: nextAdapter, phase: nextStage.id, tracking };
}

export function failCurrentStage(
  tracking: PipelineTracking,
  error: string,
): PipelineTracking {
  const { stages, currentStageIndex } = tracking;
  if (currentStageIndex >= 0 && currentStageIndex < stages.length) {
    const currentStage = stages[currentStageIndex];
    if (currentStage) {
      currentStage.status = "failed";
      currentStage.error = error;
    }
  }
  return tracking;
}

export function incrementStageIteration(
  tracking: PipelineTracking,
): PipelineTracking {
  const { stages, currentStageIndex } = tracking;
  if (currentStageIndex >= 0 && currentStageIndex < stages.length) {
    const currentStage = stages[currentStageIndex];
    if (currentStage) {
      currentStage.iterations++;
    }
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
