import { readFileSync, writeFileSync, existsSync, unlinkSync } from "node:fs";
import { resolveStatePath } from "./utils.js";
import type { PipelineTracking } from "./pipeline.js";

export interface RalplanState {
  version: number;
  active: boolean;
  pipeline: PipelineTracking;
  originalIdea: string;
  specPath?: string;
  planPath?: string;
  sessionId?: string;
  startedAt: string;
  completedAt?: string;
}

const CURRENT_VERSION = 1;

/** Read ralplan state from file */
export function readRalplanStateFile(directory: string): RalplanState | null {
  const path = resolveStatePath(directory);
  if (!existsSync(path)) return null;
  try {
    const raw = readFileSync(path, "utf-8");
    const parsed = JSON.parse(raw) as RalplanState;
    if (parsed.version !== CURRENT_VERSION) {
      // Future: handle migrations
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

/** Write ralplan state to file */
export function writeRalplanStateFile(directory: string, state: RalplanState): void {
  const path = resolveStatePath(directory);
  writeFileSync(path, JSON.stringify(state, null, 2), "utf-8");
}

/** Clear ralplan state file */
export function clearRalplanStateFile(directory: string): void {
  const path = resolveStatePath(directory);
  try {
    if (existsSync(path)) {
      unlinkSync(path);
    }
  } catch {
    // ignore
  }
}

/** Build default state for a new ralplan session */
export function buildDefaultState(
  idea: string,
  pipeline: PipelineTracking,
  sessionId?: string,
): RalplanState {
  return {
    version: CURRENT_VERSION,
    active: true,
    pipeline,
    originalIdea: idea,
    specPath: ".pi/ralplan/plans/spec.md",
    planPath: ".pi/ralplan/plans/plan.md",
    sessionId,
    startedAt: new Date().toISOString(),
  };
}
