import { readFileSync, writeFileSync, existsSync, unlinkSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { resolveStatePath, resolveAnswersPath } from "./utils.js";
import type { PipelineTracking } from "./pipeline.js";
import type { BrainstormState } from "./brainstorm.js";

export type RalplanMode = "ralplan" | "brainstorm";

export interface RalplanState {
  version: number;
  active: boolean;
  mode: RalplanMode;
  pipeline: PipelineTracking;
  originalIdea: string;
  specPath?: string;
  planPath?: string;
  answersPath?: string;
  brainstorm?: BrainstormState;
  sessionId?: string;
  startedAt: string;
  completedAt?: string;
}

const CURRENT_VERSION = 2;

/** Read ralplan state from file */
export function readRalplanStateFile(directory: string): RalplanState | null {
  const path = resolveStatePath(directory);
  if (!existsSync(path)) return null;
  try {
    const raw = readFileSync(path, "utf-8");
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (typeof parsed.version !== "number" || parsed.version > CURRENT_VERSION) {
      // Future version, can't read
      return null;
    }
    // v1 → v2 migration
    if (parsed.version === 1) {
      parsed.version = 2;
      parsed.mode = "ralplan";
      // brainstorm and answersPath are undefined — correct for v1
    }
    return parsed as unknown as RalplanState;
  } catch {
    return null;
  }
}

/** Write ralplan state to file */
export function writeRalplanStateFile(directory: string, state: RalplanState): void {
  const path = resolveStatePath(directory);
  mkdirSync(dirname(path), { recursive: true });
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

import { createBrainstormState } from "./brainstorm.js";

/** Build default state for a new ralplan session */
export function buildDefaultState(
  idea: string,
  pipeline: PipelineTracking,
  sessionId?: string,
  mode: RalplanMode = "ralplan",
  directory?: string,
): RalplanState {
  const state: RalplanState = {
    version: CURRENT_VERSION,
    active: true,
    mode,
    pipeline,
    originalIdea: idea,
    specPath: ".pi/ralplan/plans/spec.md",
    planPath: ".pi/ralplan/plans/plan.md",
    sessionId,
    startedAt: new Date().toISOString(),
  };

  if (mode === "brainstorm") {
    state.brainstorm = createBrainstormState();
    state.answersPath = directory
      ? resolveAnswersPath(directory)
      : ".pi/ralplan/plans/answers.md";
  }

  return state;
}