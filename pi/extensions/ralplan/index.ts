import type {
  ExtensionAPI,
  ExtensionContext,
} from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { StringEnum } from "@mariozechner/pi-ai";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  registerAdapters,
  buildPipelineTracking,
  resolvePipelineConfig,
  getCurrentStageAdapter,
  advanceStage,
  skipCurrentStage,
  incrementStageIteration,
  getPipelineStatus,
  formatPipelineHUD,
  syncTrackingToConfig,
  getStageMaxIterations,
  type PipelineTracking,
  type PipelineContext,
} from "./pipeline.js";


import {
  ralplanAdapter,
  executionAdapter,
  ralphAdapter,
  qaAdapter,
} from "./adapters.js";

import {
  readRalplanStateFile,
  writeRalplanStateFile,
  clearRalplanStateFile,
  buildDefaultState,
  type RalplanState,
  type RalplanMode,
} from "./state.js";

import {
  detectSignal,
  detectBrainstormSignal,
  getLastAssistantText,
  BRAINSTORM_OPEN_QUESTIONS_READY,
} from "./signals.js";

import {
  getTransitionPrompt,
  getBrainstormAwaitingPrompt,
  getBrainstormSteeringPrompt,
  getBrainstormResumePrompt,
} from "./prompts.js";

import {
  getDefaultArtifactFilename,
  readPlanningArtifacts,
  appendArtifact,
  writeArtifact,
} from "./artifacts.js";

import { hasBypassPrefix, looksLikeBroadRequest } from "./gate.js";
import { resolveOpenQuestionsPath } from "./utils.js";

import { cleanupWorktree } from "./worktree.js";

import { createAndAttachWorktree } from "./worktree-helper.js";


import {
  createBrainstormState,
  transitionSubPhase,
  appendAnswer,
  withQuestions,
  shouldSuppressSignals,
  isBrainstormMode,
  isAwaitingAnswers,
  parseOpenQuestions,
  skipQuestions,
  doneAnswering,
  processBrainstormAgentEnd,
  processBrainstormInput,
  type BrainstormState,
} from "./brainstorm.js";

// Register adapters globally
registerAdapters([ralplanAdapter, executionAdapter, ralphAdapter, qaAdapter]);

// ============================================================================
// TYPES & CONSTANTS
// ============================================================================

interface PersistedState {
  active: boolean;
  tracking: PipelineTracking;
  originalIdea: string;
  specPath: string;
  planPath: string;
  sessionId?: string;
  mode?: RalplanMode;
  answersPath?: string;
  brainstorm?: BrainstormState;
  worktreePath?: string; // NEW: Associated worktree
}

/**
 * Type guard for session-entry data. Mirrors the critical-field validation
 * in `state.ts:validateRalplanState` so a malformed entry falls back to
 * the file-based state instead of crashing the extension.
 */
function isPersistedState(x: unknown): x is PersistedState {
  if (typeof x !== "object" || x === null) return false;
  const obj = x as Record<string, unknown>;
  if (typeof obj.active !== "boolean") return false;
  if (typeof obj.tracking !== "object" || obj.tracking === null) return false;
  if (!Array.isArray((obj.tracking as Record<string, unknown>).stages)) return false;
  if (typeof obj.originalIdea !== "string") return false;
  if (typeof obj.specPath !== "string") return false;
  if (typeof obj.planPath !== "string") return false;
  if (obj.mode !== undefined && typeof obj.mode !== "string") return false;
  if (obj.sessionId !== undefined && typeof obj.sessionId !== "string") return false;
  return true;
}


const CUSTOM_TYPE = "ralplan-state";

// ============================================================================
// EXTENSION ENTRY POINT
// ============================================================================

export default function ralplanExtension(pi: ExtensionAPI): void {
  // In-memory state (reconstructed from session entries)
  let state: RalplanState | null = null;

  // Signal deduplication: track the last entry ID we advanced from
  let lastAdvancedEntryId: string | null = null;

  // Auto-start mode discriminant (replaces boolean)
  let autoStartMode: "ralplan" | "brainstorm" | null = null;

  // Captured working directory — set once at session start or /ralplan command
  let sessionCwd: string = process.cwd();

  // ==========================================================================
  // HELPERS
  // ==========================================================================

  function isActive(): boolean {
    return state?.active === true;
  }

  function getWorkspaceDir(): string {
    return state?.worktreePath ?? sessionCwd;
  }

  function toWorkspacePath(path?: string): string | undefined {
    if (!path || !state?.worktreePath) return path;
    return join(state.worktreePath, path);
  }

  // NOTE: worktreePath is included so executionAdapter.onEnter() can detect
  // if a worktree was already created. The guard "if (context.worktreePath) return;"
  // in onEnter prevents redundant creation.
  function buildContext(): PipelineContext | null {
    if (!state) return null;
    return {
      idea: state.originalIdea,
      directory: getWorkspaceDir(),
      cwd: getWorkspaceDir(), // Explicit cwd — set to worktreePath when available
      sessionId: state.sessionId,
      specPath: toWorkspacePath(state.specPath),
      planPath: toWorkspacePath(state.planPath),
      openQuestionsPath: state.worktreePath
        ? resolveOpenQuestionsPath(state.worktreePath)
        : "plans/open-questions.md",
      answersPath: toWorkspacePath(state.answersPath),
      config: state.pipeline.pipelineConfig,
      mode: state.mode,
      brainstorm: state.brainstorm,
      worktreePath: state.worktreePath,
    };
  }

  function persistState(): void {
    if (!state) return;
    const persisted: PersistedState = {
      active: state.active,
      tracking: state.pipeline,
      originalIdea: state.originalIdea,
      specPath: state.specPath || "plans/spec.md",
      planPath: state.planPath || "plans/plan.md",
      sessionId: state.sessionId,
      mode: state.mode,
      answersPath: state.answersPath,
      brainstorm: state.brainstorm,
      worktreePath: state.worktreePath,
    };
    pi.appendEntry(CUSTOM_TYPE, persisted);
    writeRalplanStateFile(sessionCwd, state);
  }

  function deactivateState(notifyCtx?: ExtensionContext): void {
    if (state) {
      // Best-effort worktree cleanup — warn but don't block deactivation
      if (state.worktreePath) {
        try {
          const result = cleanupWorktree(state.worktreePath);
          if (!result.success) {
            notifyCtx?.ui.notify(
              `Worktree cleanup failed: ${result.error}`,
              "warning",
            );
          } else {
            notifyCtx?.ui.notify(
              `Worktree cleaned up: ${state.worktreePath}`,
              "info",
            );
          }
        } catch {
          // cleanup not available or already removed
        }
      }
      state.active = false;
      state.completedAt = new Date().toISOString();
      persistState();
    }
    state = null;
    clearRalplanStateFile(sessionCwd);
  }

  function updateUI(ctx: ExtensionContext): void {
    if (!isActive() || !state) {
      ctx.ui.setStatus("ralplan", undefined);
      ctx.ui.setWidget("ralplan-progress", undefined);
      return;
    }

    // Brainstorm sub-phase status
    if (state.mode === "brainstorm" && state.brainstorm) {
      const sub = state.brainstorm.subPhase;
      let statusText: string;
      switch (sub) {
        case "expanding":
          statusText = "🧠 Expanding...";
          break;
        case "awaiting-answers":
          statusText = `🧠 Awaiting Answers (${state.brainstorm.questions.length} questions)`;
          break;
        case "planning":
          statusText = "🧠 Planning (Consensus)";
          break;
        default:
          statusText = "🧠 Brainstorm";
      }
      ctx.ui.setStatus("ralplan", ctx.ui.theme.fg("accent", statusText));
      ctx.ui.setWidget("ralplan-progress", formatPipelineHUD(state.pipeline));
      return;
    }

    const status = getPipelineStatus(state.pipeline);
    const currentName =
      getCurrentStageAdapter(state.pipeline)?.name ??
      (status.isComplete ? "Complete" : "None");
    ctx.ui.setStatus(
      "ralplan",
      ctx.ui.theme.fg("accent", `📋 ${currentName} (${status.progress})`),
    );

    const hud = formatPipelineHUD(state.pipeline);
    ctx.ui.setWidget("ralplan-progress", hud);
  }

  function reconstructFromSession(ctx: ExtensionContext): void {
    const entries = ctx.sessionManager.getEntries();

    // Find the most recent ralplan-state entry, validated by type guard
    // (T-7). Malformed entries fall through to the file-based fallback below.
    const ralplanEntry = entries
      .filter((e) => e.type === "custom" && e.customType === CUSTOM_TYPE)
      .pop();
    const data = ralplanEntry?.data;
    if (isPersistedState(data)) {

      const status = getPipelineStatus(data.tracking);

      state = {
        version: 3,
        active: status.isComplete ? false : data.active,
        mode: data.mode ?? "ralplan",
        pipeline: data.tracking,
        originalIdea: data.originalIdea,
        specPath: data.specPath,
        planPath: data.planPath,
        answersPath: data.answersPath,
        brainstorm: data.brainstorm,
        sessionId: data.sessionId,
        worktreePath: data.worktreePath,
        startedAt:
          data.tracking.stages[0]?.startedAt ?? new Date().toISOString(),
      };
      // Prevent auto-start logic from firing on a resumed session
      autoStartMode = null;
      return;
    }

    // Fallback to file-based state
    const fileState = readRalplanStateFile(sessionCwd);
    if (fileState) {
      state = fileState;
    }
  }

  // ==========================================================================
  // COMMANDS
  // ==========================================================================

  pi.registerFlag("ralplan", {
    description:
      "Start a RALPLAN consensus planning session with the initial prompt",
    type: "boolean",
    default: false,
  });

  pi.registerFlag("brainstorm", {
    description: "Start a brainstorm-mode session with the initial prompt",
    type: "boolean",
    default: false,
  });

  pi.registerCommand("ralplan", {
    description: "Start consensus planning for an idea",
    handler: async (args, ctx) => {
      if (isActive()) {
        ctx.ui.notify(
          "A planning session is already active. Use /ralplan:cancel to end it first.",
          "info",
        );
        return;
      }

      const idea = args.trim() || "Implement the requested feature";
      const config = resolvePipelineConfig();
      const tracking = buildPipelineTracking(config);

      if (
        tracking.currentStageIndex >= 0 &&
        tracking.currentStageIndex < tracking.stages.length
      ) {
        tracking.stages[tracking.currentStageIndex].status = "active";
        tracking.stages[tracking.currentStageIndex].startedAt =
          new Date().toISOString();
      }

      // Create worktree via helper (T-6 DRY).
      const worktree = createAndAttachWorktree(ctx, sessionCwd, idea);


      state = buildDefaultState(
        idea,
        tracking,
        undefined,
        "ralplan",
        sessionCwd,
      );
      state.worktreePath = worktree.ok ? worktree.path : undefined;

      persistState();
      updateUI(ctx);

      ctx.ui.notify(`RALPLAN started: ${idea}`, "info");

      const context = buildContext();
      if (context) {
        const adapter = getCurrentStageAdapter(tracking);
        if (adapter) {
          const prompt = adapter.getPrompt(context);
          pi.sendMessage(
            {
              customType: "ralplan-start",
              content: `## RALPLAN Pipeline Started

Idea: ${idea}
Stages: ${tracking.stages
                .filter((s) => s.status !== "skipped")
                .map((s) => s.id)
                .join(" → ")}

${prompt}`,
              display: true,
            },
            { triggerTurn: true, deliverAs: "steer" },
          );
        }
      }
    },
  });

  pi.registerCommand("brainstorm", {
    description:
      "Start brainstorm planning for an idea (user answers open questions)",
    handler: async (args, ctx) => {
      if (isActive()) {
        ctx.ui.notify(
          "A planning session is already active. Use /ralplan:cancel to end it first.",
          "info",
        );
        return;
      }

      const idea = args.trim() || "Implement the requested feature";
      const config = resolvePipelineConfig();
      const tracking = buildPipelineTracking(config);

      if (
        tracking.currentStageIndex >= 0 &&
        tracking.currentStageIndex < tracking.stages.length
      ) {
        tracking.stages[tracking.currentStageIndex].status = "active";
        tracking.stages[tracking.currentStageIndex].startedAt =
          new Date().toISOString();
      }
      // Create worktree via helper (T-6 DRY).
      const worktree = createAndAttachWorktree(ctx, sessionCwd, idea);


      state = buildDefaultState(
        idea,
        tracking,
        undefined,
        "brainstorm",
        sessionCwd,
      );
      state.worktreePath = worktree.ok ? worktree.path : undefined;

      persistState();
      updateUI(ctx);

      ctx.ui.notify(`BRAINSTORM started: ${idea}`, "info");

      const context = buildContext();
      if (context) {
        const adapter = getCurrentStageAdapter(tracking);
        if (adapter) {
          const prompt = adapter.getPrompt(context);
          pi.sendMessage(
            {
              customType: "brainstorm-start",
              content: `## BRAINSTORM Pipeline Started

Idea: ${idea}
Stages: ${tracking.stages
                .filter((s) => s.status !== "skipped")
                .map((s) => s.id)
                .join(" → ")}

${prompt}`,
              display: true,
            },
            { triggerTurn: true, deliverAs: "steer" },
          );
        }
      }
    },
  });

  pi.registerCommand("ralplan:status", {
    description: "Show current pipeline status",
    handler: async (_args, ctx) => {
      if (!isActive() || !state) {
        ctx.ui.notify(
          "No active RALPLAN session. Use /ralplan to start one.",
          "info",
        );
        return;
      }

      const status = getPipelineStatus(state.pipeline);
      const lines = formatPipelineHUD(state.pipeline);
      const modeLine =
        state.mode === "brainstorm"
          ? `\nMode: Brainstorm (${state.brainstorm?.subPhase ?? "unknown"})`
          : "";
      const msg = `**RALPLAN Status**\n\nProgress: ${status.progress}${modeLine}\n\n${lines.join("\n")}`;
      ctx.ui.notify(msg, "info");
    },
  });

  pi.registerCommand("ralplan:cancel", {
    description: "Cancel active ralplan session",
    handler: async (_args, ctx) => {
      if (!isActive()) {
        ctx.ui.notify("No active RALPLAN session to cancel.", "info");
        return;
      }

      const ok = await ctx.ui.confirm(
        "Cancel RALPLAN?",
        "This will discard the current pipeline.",
      );
      if (!ok) return;

      deactivateState(ctx);
      updateUI(ctx);
      ctx.ui.notify("RALPLAN cancelled.", "info");
    },
  });

  pi.registerCommand("ralplan:skip", {
    description: "Skip current stage",
    handler: async (_args, ctx) => {
      if (!isActive() || !state) {
        ctx.ui.notify("No active RALPLAN session.", "info");
        return;
      }

      const { stages, currentStageIndex } = state.pipeline;
      const pipelineCtx = buildContext();
      const result = skipCurrentStage(state.pipeline, pipelineCtx ?? undefined);
      state.pipeline = result.tracking;
      persistState();
      updateUI(ctx);

      if (result.phase === "complete") {
        ctx.ui.notify("RALPLAN pipeline complete!", "info");
        deactivateState(ctx);
        return;
      }

      if (result.phase === "failed") {
        ctx.ui.notify(
          `RALPLAN stage failed: ${result.tracking.stages[result.tracking.currentStageIndex]?.error ?? "Unknown error"}`,
          "error",
        );
        deactivateState(ctx);
        return;
      }

      const context = buildContext();
      if (context && result.adapter) {
        const prompt = result.adapter.getPrompt(context);
        pi.sendMessage(
          {
            customType: "ralplan-skip",
            content: `${getTransitionPrompt(stages[currentStageIndex].id, result.adapter.id)}\n\n${prompt}`,
            display: true,
          },
          { triggerTurn: true, deliverAs: "steer" },
        );
      }
    },
  });

  pi.registerCommand("ralplan:done-answering", {
    description: "Signal that you're done answering brainstorm questions",
    handler: async (_args, ctx) => {
      if (!isActive() || !state) {
        ctx.ui.notify("No active session.", "info");
        return;
      }

      if (
        state.mode !== "brainstorm" ||
        state.brainstorm?.subPhase !== "awaiting-answers"
      ) {
        ctx.ui.notify("Not currently awaiting answers.", "info");
        return;
      }

      // Transition to planning
      state.brainstorm = doneAnswering(state.brainstorm);
      persistState();
      updateUI(ctx);

      // Trigger next turn with resume prompt
      const context = buildContext();
      if (context) {
        pi.sendMessage(
          {
            customType: "brainstorm-done",
            content: getBrainstormResumePrompt(context),
            display: true,
          },
          { triggerTurn: true, deliverAs: "steer" },
        );
      }
    },
  });

  pi.registerCommand("ralplan:skip-questions", {
    description:
      "Skip brainstorm open questions and proceed to planning (escape hatch)",
    handler: async (_args, ctx) => {
      if (!isActive() || !state) {
        ctx.ui.notify("No active session.", "info");
        return;
      }

      if (state.mode !== "brainstorm") {
        ctx.ui.notify("Not in brainstorm mode.", "info");
        return;
      }

      const sub = state.brainstorm?.subPhase;
      if (sub !== "expanding" && sub !== "awaiting-answers") {
        ctx.ui.notify("Not currently in a phase with open questions.", "info");
        return;
      }

      // Skip questions — works from both expanding and awaiting-answers
      state.brainstorm = skipQuestions(state.brainstorm!);

      // Write sentinel to answers.md
      if (state.answersPath) {
        appendArtifact(
          getWorkspaceDir(),
          "answers.md",
          "\n## Skipped — User declined to answer open questions. Proceeding with best-effort planning.\n",
        );
      }

      persistState();
      updateUI(ctx);

      // Trigger next turn with resume prompt
      const context = buildContext();
      if (context) {
        pi.sendMessage(
          {
            customType: "brainstorm-skip-questions",
            content: getBrainstormResumePrompt(context),
            display: true,
          },
          { triggerTurn: true, deliverAs: "steer" },
        );
      }
    },
  });

  pi.registerCommand("ralplan:artifacts", {
    description: "List planning artifacts",
    handler: async (_args, ctx) => {
      const artifacts = readPlanningArtifacts(getWorkspaceDir());
      const parts: string[] = [];

      if (artifacts.specPaths.length > 0) {
        parts.push(
          `**Specs:**\n${artifacts.specPaths.map((p) => `- ${p}`).join("\n")}`,
        );
      }
      if (artifacts.planPaths.length > 0) {
        parts.push(
          `**Plans:**\n${artifacts.planPaths.map((p) => `- ${p}`).join("\n")}`,
        );
      }
      if (artifacts.testSpecPaths.length > 0) {
        parts.push(
          `**Test Specs:**\n${artifacts.testSpecPaths.map((p) => `- ${p}`).join("\n")}`,
        );
      }

      if (parts.length === 0) {
        ctx.ui.notify("No planning artifacts found in plans/", "info");
      } else {
        ctx.ui.notify(parts.join("\n\n"), "info");
      }
    },
  });

  // ==========================================================================
  // TOOLS
  // ==========================================================================

  pi.registerTool({
    name: "ralplan_advance",
    label: "Advance RALPLAN",
    description: "Explicitly advance to the next pipeline stage",
    parameters: Type.Object({
      reason: Type.Optional(
        Type.String({ description: "Reason for advancement" }),
      ),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      if (!isActive() || !state) {
        return {
          content: [{ type: "text", text: "No active RALPLAN session." }],
          details: {},
        };
      }

      const currentId =
        state.pipeline.stages[state.pipeline.currentStageIndex]?.id;
      const pipelineCtx = buildContext();
      const result = advanceStage(state.pipeline, pipelineCtx ?? undefined);
      state.pipeline = result.tracking;
      persistState();
      updateUI(ctx);

      if (result.phase === "complete") {
        deactivateState(ctx);
        return {
          content: [
            {
              type: "text",
              text: "RALPLAN pipeline complete! All stages finished.",
            },
          ],
          details: { phase: "complete" },
        };
      }

      if (result.phase === "failed") {
        deactivateState(ctx);
        return {
          content: [
            {
              type: "text",
              text: `RALPLAN stage failed: ${result.tracking.stages[result.tracking.currentStageIndex]?.error ?? "Unknown error"}`,
            },
          ],
          details: { phase: "failed" },
          isError: true,
        };
      }

      // Inject next stage prompt as a message
      const pipelineContext = buildContext();
      if (pipelineContext && result.adapter) {
        const prompt = result.adapter.getPrompt(pipelineContext);
        pi.sendMessage(
          {
            customType: "ralplan-advance",
            content: `${getTransitionPrompt(currentId ?? "unknown", result.adapter.id)}\n\n${prompt}`,
            display: true,
          },
          { triggerTurn: true, deliverAs: "followUp" },
        );
      }

      return {
        content: [
          {
            type: "text",
            text: `Advanced to ${result.adapter?.name ?? result.phase}. Triggering next stage...`,
          },
        ],
        details: { phase: result.phase },
      };
    },
  });

  pi.registerTool({
    name: "ralplan_submit_artifact",
    label: "Submit RALPLAN Artifact",
    description:
      "Submit a planning artifact (spec, plan, test-spec) to the ralplan pipeline",
    parameters: Type.Object({
      type: StringEnum(["spec", "plan", "test-spec"] as const),
      content: Type.String({ description: "Markdown content of the artifact" }),
      filename: Type.Optional(
        Type.String({
          description: "Custom filename (default: auto-generated)",
        }),
      ),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const { ensureRalplanDir } = await import("./utils.js");
      const targetDir = getWorkspaceDir();
      ensureRalplanDir(targetDir);

      const filename =
        params.filename || getDefaultArtifactFilename(params.type);
      const path = writeArtifact(targetDir, filename, params.content);

      return {
        content: [{ type: "text", text: `Artifact saved to ${path}` }],
        details: { type: params.type, path, filename },
      };
    },
  });

  pi.registerTool({
    name: "ralplan_set_config",
    label: "Set RALPLAN Config",
    description: "Modify pipeline configuration mid-flight",
    parameters: Type.Object({
      planning: Type.Optional(
        StringEnum(["ralplan", "direct", "skip"] as const),
      ),
      execution: Type.Optional(StringEnum(["team", "solo"] as const)),
      verification: Type.Optional(StringEnum(["ralph", "skip"] as const)),
      qa: Type.Optional(Type.Boolean()),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      if (!isActive() || !state) {
        return {
          content: [{ type: "text", text: "No active RALPLAN session." }],
          details: {},
        };
      }

      const config = state.pipeline.pipelineConfig;
      if (params.planning === "skip") config.planning = false;
      else if (params.planning) config.planning = params.planning;

      if (params.execution) config.execution = params.execution;

      if (params.verification === "skip") config.verification = false;
      else if (params.verification) {
        config.verification = { engine: "ralph", maxIterations: 100 };
      }

      if (params.qa !== undefined) config.qa = params.qa;

      state.pipeline = syncTrackingToConfig(state.pipeline);

      persistState();
      updateUI(ctx);

      return {
        content: [{ type: "text", text: `RALPLAN config updated.` }],
        details: { config },
      };
    },
  });

  // ==========================================================================
  // EVENT HANDLERS
  // ==========================================================================

  // Detect user input — handle answer accumulation and broad-request gate
  pi.on("input", async (event, ctx) => {
    if (event.source === "extension") return { action: "continue" };

    const text = event.text.trim();

    // Brainstorm answer accumulation during awaiting-answers
    if (
      isActive() &&
      isBrainstormMode(state) &&
      isAwaitingAnswers(state?.brainstorm)
    ) {
      const result = processBrainstormInput(state!, text);
      // Append answer to state
      state!.brainstorm = appendAnswer(
        state!.brainstorm!,
        result.appendAnswer.question,
        result.appendAnswer.answer,
      );
      // Append answer to answers.md on disk
      if (state!.answersPath) {
        try {
          appendArtifact(
            getWorkspaceDir(),
            "answers.md",
            `\n### Q: ${result.appendAnswer.question}\n${result.appendAnswer.answer}\n`,
          );
        } catch {
          // File I/O failure — state is still updated in-memory
        }
      }
      persistState();
      updateUI(ctx);
      // Stay in awaiting-answers — do NOT transition to planning
      return { action: "continue" };
    }

    // Ralplan-first gate: if user makes a broad request and no active session,
    // suggest ralplan first. Skip if explicitly bypassed.
    if (!isActive() && looksLikeBroadRequest(text) && !hasBypassPrefix(text)) {
      ctx.ui.notify(
        "This looks like a broad request. Consider using /ralplan for consensus planning first, or prefix with 'force:' to bypass.",
        "info",
      );
    }

    return { action: "continue" };
  });

  // Detect if RALPLAN skill is being used based on prompt content
  function detectRalplanSkillUsage(
    prompt: string,
  ): "ralplan" | "brainstorm" | null {
    const lower = prompt.toLowerCase();

    // Explicit skill invocations
    if (lower.includes("ralplan") || lower.includes("/ralplan")) {
      // Check if it's brainstorm specifically
      if (lower.includes("brainstorm")) return "brainstorm";
      return "ralplan";
    }

    // Standalone brainstorm keyword (RALPLAN brainstorm mode)
    if (lower.includes("brainstorm")) {
      return "brainstorm";
    }

    // Consensus planning keywords
    if (
      lower.includes("consensus planning") ||
      lower.includes("architect review") ||
      lower.includes("critic review") ||
      (lower.includes("planner") &&
        lower.includes("architect") &&
        lower.includes("critic"))
    ) {
      return "ralplan";
    }

    // Plan artifact paths
    if (
      lower.includes("plans/drafts/") ||
      lower.includes("plans/spec") ||
      lower.includes("plans/plan") ||
      lower.includes("plan.md")
    ) {
      return "ralplan";
    }

    return null;
  }

  // Inject stage prompt before agent starts
  pi.on("before_agent_start", async (event, ctx) => {
    // Auto-start from --ralplan flag or --brainstorm flag only.
    // (skill usage from prompt content no longer auto-starts — it only notifies)
    if (!isActive() && autoStartMode === null) {
      if (pi.getFlag("ralplan") === true) {
        autoStartMode = "ralplan";
      } else if (pi.getFlag("brainstorm") === true) {
        autoStartMode = "brainstorm";
      } else {
        // Detect skill usage from prompt content. If matched, suggest /ralplan
        // explicitly — do NOT auto-start (avoids surprise planning sessions).
        const detected = detectRalplanSkillUsage(event.prompt);
        if (detected) {
          ctx.ui.notify(
            "This prompt mentions RALPLAN. Run /ralplan to start a planning session.",
            "info",
          );
        }
      }
    }

    // Skip auto-start if session already has ralplan state (prevents race
    // between session resume and auto-start when --ralplan flag is present)
    const hasRalplanState = ctx.sessionManager
      .getEntries()
      .some((e) => e.type === "custom" && e.customType === CUSTOM_TYPE);

    if (!isActive() && autoStartMode !== null && !hasRalplanState) {
      // Capture mode and clear flag BEFORE any async work to prevent race
      // where two concurrent events could both enter this block
      const mode = autoStartMode;
      autoStartMode = null; // Prevent any other event from entering

      const idea = event.prompt.trim() || "Implement the requested feature";
      const config = resolvePipelineConfig();
      const tracking = buildPipelineTracking(config);

      if (
        tracking.currentStageIndex >= 0 &&
        tracking.currentStageIndex < tracking.stages.length
      ) {
        tracking.stages[tracking.currentStageIndex].status = "active";
        tracking.stages[tracking.currentStageIndex].startedAt =
          new Date().toISOString();
      }

      // Create worktree via helper (T-6 DRY).
      const worktree = createAndAttachWorktree(ctx, sessionCwd, idea);


      state = buildDefaultState(idea, tracking, undefined, mode, sessionCwd);
      state.worktreePath = worktree.ok ? worktree.path : undefined;

      persistState();
      updateUI(ctx);

      const label = mode === "brainstorm" ? "BRAINSTORM" : "RALPLAN";
      ctx.ui.notify(`${label} started (via --${mode}): ${idea}`, "info");
      // Continue to inject the stage prompt below
    }

    if (!isActive() || !state) return;

    const adapter = getCurrentStageAdapter(state.pipeline);
    if (!adapter) return;

    const context = buildContext();
    if (!context) return;

    // During brainstorm awaiting-answers, inject steering prompt
    // (This keeps the AI from going off-track during answer collection)
    if (
      state.mode === "brainstorm" &&
      state.brainstorm?.subPhase === "awaiting-answers"
    ) {
      return {
        message: {
          customType: "brainstorm-steering",
          content: getBrainstormSteeringPrompt(),
          display: false,
        },
      };
    }

    const prompt = adapter.getPrompt(context);

    return {
      message: {
        customType: "ralplan-prompt",
        content: `[RALPLAN ACTIVE — Stage: ${adapter.name}]

${prompt}`,
        display: false,
      },
    };
  });

  // Detect completion signals at agent_end
  pi.on("agent_end", async (event, ctx) => {
    if (!isActive() || !state) return;

    const currentStage =
      state.pipeline.stages[state.pipeline.currentStageIndex];
    if (!currentStage) return;

    // Deduplication: get the last entry ID to avoid re-advancing on the same turn
    const branch = ctx.sessionManager.getBranch();
    const lastEntry = branch[branch.length - 1];
    const currentEntryId = lastEntry?.id ?? null;
    if (currentEntryId && currentEntryId === lastAdvancedEntryId) {
      return;
    }

    const lastText = getLastAssistantText(event.messages);
    if (!lastText) return;

    // === BRAINSTORM SIGNAL ROUTING ===
    if (state.mode === "brainstorm" && currentStage.id === "ralplan") {
      // Use shouldSuppressSignals for consistent signal suppression
      if (shouldSuppressSignals(state)) {
        const sub = state.brainstorm?.subPhase;

        // expanding sub-phase: check for OPEN_QUESTIONS_READY
        if (sub === "expanding") {
          if (
            detectBrainstormSignal(lastText, BRAINSTORM_OPEN_QUESTIONS_READY)
          ) {
            // Parse questions from open-questions.md
            const questionsPath = resolveOpenQuestionsPath(getWorkspaceDir());
            let questions: string[] = [];
            try {
              const content = readFileSync(questionsPath, "utf-8");
              questions = parseOpenQuestions(content);
            } catch {
              ctx.ui.notify(
                "Warning: Could not read open questions file. Proceeding with empty list.",
                "warning",
              );
            }

            // Handle empty questions: auto-transition to planning
            if (questions.length === 0) {
              ctx.ui.notify(
                "No open questions found. Proceeding directly to planning.",
                "warning",
              );
              state.brainstorm = transitionSubPhase(
                state.brainstorm!,
                "planning",
              );
              persistState();
              updateUI(ctx);

              const context = buildContext();
              if (context) {
                pi.sendMessage(
                  {
                    customType: "brainstorm-auto-plan",
                    content: getBrainstormResumePrompt(context),
                    display: true,
                  },
                  { triggerTurn: true, deliverAs: "steer" },
                );
              }
              return;
            }

            // Transition to awaiting-answers
            state.brainstorm = withQuestions(
              transitionSubPhase(state.brainstorm!, "awaiting-answers"),
              questions,
            );
            persistState();
            updateUI(ctx);

            // Send awaiting prompt to user.
            // Called from agent_end — by the time we reach here, isStreaming is false,
            // so the message goes to the "else" branch (push to messages) per the
            // current pi API. No setTimeout needed.
            pi.sendMessage(
              {
                customType: "brainstorm-awaiting",
                content: getBrainstormAwaitingPrompt(questions),
                display: true,
              },
              { triggerTurn: false },
            );
            return;

            return;
          }
          // Other signals suppressed during expanding
          return;
        }

        // awaiting-answers: total signal suppression
        return;
      }

      // planning sub-phase: allow normal PIPELINE_RALPLAN_COMPLETE detection
      if (state.brainstorm?.subPhase === "planning") {
        if (detectSignal(lastText, currentStage.id)) {
          // Fall through to existing advancement logic below
        } else {
          return;
        }
      }
    }

    // === EXISTING SIGNAL DETECTION (non-brainstorm or brainstorm planning) ===
    if (detectSignal(lastText, currentStage.id)) {
      lastAdvancedEntryId = currentEntryId;
      const currentId = currentStage.id;
      const pipelineCtx = buildContext();
      const result = advanceStage(state.pipeline, pipelineCtx ?? undefined);
      state.pipeline = result.tracking;
      persistState();
      updateUI(ctx);
      if (result.phase === "complete") {
        ctx.ui.notify(
          "RALPLAN Pipeline Complete! ✓ All stages finished successfully.",
          "info",
        );
        // No setTimeout needed: in agent_end, isStreaming is false by the time we
        // reach here, so the message routes through the "else" branch and is
        // appended to the session.
        pi.sendMessage(
          {
            customType: "ralplan-complete",
            content: `## RALPLAN Pipeline Complete! ✓

All stages finished successfully.`,
            display: true,
          },
          { triggerTurn: false },
        );
        deactivateState(ctx);

        deactivateState(ctx);
        updateUI(ctx);
        return;
      }

      if (result.phase === "failed") {
        // Same reasoning as the "complete" branch above — no setTimeout needed.
        pi.sendMessage(
          {
            customType: "ralplan-failed",
            content: `## RALPLAN Pipeline Failed

Error: ${result.tracking.stages[result.tracking.currentStageIndex]?.error ?? "Unknown error"}`,
            display: true,
          },
          { triggerTurn: false },
        );
        deactivateState(ctx);

        return;
      }

      const pipelineContext = buildContext();
      if (pipelineContext && result.adapter) {
        const prompt = result.adapter.getPrompt(pipelineContext);
        const transitionText = `${getTransitionPrompt(currentId, result.adapter.id)}\n\n${prompt}`;
        // No setTimeout needed: in agent_end, isStreaming is false by the time we
        // reach here, so sendUserMessage routes through the normal prompt path.
        // (See comments in the "complete"/"failed" branches above.)
        pi.sendUserMessage(transitionText);
      }
    }
  });


  // Restore state on session start / resume / fork
  pi.on("session_start", async (_event, ctx) => {
    reconstructFromSession(ctx);
    updateUI(ctx);

    // Notify user if resuming an awaiting-answers brainstorm session
    if (
      state?.mode === "brainstorm" &&
      state.brainstorm?.subPhase === "awaiting-answers"
    ) {
      ctx.ui.notify(
        "🧠 Brainstorm session resumed. Awaiting your answers.",
        "info",
      );
    }
  });

  pi.on("session_tree", async (_event, ctx) => {
    reconstructFromSession(ctx);
    updateUI(ctx);

    // Notify user if resuming an awaiting-answers brainstorm session
    if (
      state?.mode === "brainstorm" &&
      state.brainstorm?.subPhase === "awaiting-answers"
    ) {
      ctx.ui.notify(
        "🧠 Brainstorm session resumed. Awaiting your answers.",
        "info",
      );
    }
  });

  // Handle turn_end for iteration counting
  pi.on("turn_end", async (_event, ctx) => {
    if (!isActive() || !state) return;

    // T-8: per-stage maxIterations. QA = 5; verification = configured
    // (default 100); planning/execution = DEFAULT_STAGE_MAX_ITERATIONS.
    const currentStage =
      state.pipeline.stages[state.pipeline.currentStageIndex];
    const maxIters = getStageMaxIterations(
      currentStage.id,
      state.pipeline.pipelineConfig,
    );
    if (currentStage.iterations >= maxIters) {
      ctx.ui.notify(
        `Maximum iterations (${maxIters}) reached for ${currentStage.id}. Please review and manually approve or use /ralplan:skip to proceed.`,
        "warning",
      );
      return; // Don't increment or process signals — escalate to user
    }


    state.pipeline = incrementStageIteration(state.pipeline);
    persistState();
    updateUI(ctx);
  });
}
