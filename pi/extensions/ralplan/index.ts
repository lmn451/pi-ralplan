import type {
  ExtensionAPI,
  ExtensionContext,
} from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { StringEnum } from "@mariozechner/pi-ai";
import { readFileSync } from "node:fs";

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
} from "./artifacts.js";

import { hasBypassPrefix, looksLikeBroadRequest } from "./gate.js";
import {
  resolveOpenQuestionsPath,
} from "./utils.js";

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

  function buildContext(): PipelineContext | null {
    if (!state) return null;
    return {
      idea: state.originalIdea,
      directory: sessionCwd,
      sessionId: state.sessionId,
      specPath: state.specPath,
      planPath: state.planPath,
      openQuestionsPath: ".pi/ralplan/plans/open-questions.md",
      answersPath: state.answersPath,
      config: state.pipeline.pipelineConfig,
      mode: state.mode,
      brainstorm: state.brainstorm,
    };
  }

  function persistState(): void {
    if (!state) return;
    const persisted: PersistedState = {
      active: state.active,
      tracking: state.pipeline,
      originalIdea: state.originalIdea,
      specPath: state.specPath || ".pi/ralplan/plans/spec.md",
      planPath: state.planPath || ".pi/ralplan/plans/plan.md",
      sessionId: state.sessionId,
      mode: state.mode,
      answersPath: state.answersPath,
      brainstorm: state.brainstorm,
    };
    pi.appendEntry(CUSTOM_TYPE, persisted);
    writeRalplanStateFile(sessionCwd, state);
  }

  function deactivateState(): void {
    if (state) {
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

    // Find the most recent ralplan-state entry
    const ralplanEntry = entries
      .filter(
        (e: { type: string; customType?: string; data?: PersistedState }) =>
          e.type === "custom" && e.customType === CUSTOM_TYPE,
      )
      .pop() as { data?: PersistedState } | undefined;

    if (ralplanEntry?.data) {
      const data = ralplanEntry.data;
      const status = getPipelineStatus(data.tracking);
      state = {
        version: 2,
        active: status.isComplete ? false : data.active,
        mode: data.mode ?? "ralplan",
        pipeline: data.tracking,
        originalIdea: data.originalIdea,
        specPath: data.specPath,
        planPath: data.planPath,
        answersPath: data.answersPath,
        brainstorm: data.brainstorm,
        sessionId: data.sessionId,
        startedAt:
          data.tracking.stages[0]?.startedAt ?? new Date().toISOString(),
      };
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
    description:
      "Start a brainstorm-mode session with the initial prompt",
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

      state = buildDefaultState(idea, tracking, undefined, "ralplan", sessionCwd);
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
    description: "Start brainstorm planning for an idea (user answers open questions)",
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

      state = buildDefaultState(idea, tracking, undefined, "brainstorm", sessionCwd);
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
      const modeLine = state.mode === "brainstorm"
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

      deactivateState();
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
        ctx.ui.notify("RALPLAN pipeline complete!", "success");
        deactivateState();
        return;
      }

      if (result.phase === "failed") {
        ctx.ui.notify(
          `RALPLAN stage failed: ${result.tracking.stages[result.tracking.currentStageIndex]?.error ?? "Unknown error"}`,
          "error",
        );
        deactivateState();
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

      if (state.mode !== "brainstorm" || state.brainstorm?.subPhase !== "awaiting-answers") {
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
    description: "Skip brainstorm open questions and proceed to planning (escape hatch)",
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
        appendArtifact(sessionCwd, "answers.md",
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
      const artifacts = readPlanningArtifacts(sessionCwd);
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
        ctx.ui.notify(
          "No planning artifacts found in .pi/ralplan/plans/",
          "info",
        );
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
        deactivateState();
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
        deactivateState();
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
      const { writeArtifact } = await import("./artifacts.js");
      const { ensureRalplanDir } = await import("./utils.js");

      ensureRalplanDir(sessionCwd);

      const filename =
        params.filename || getDefaultArtifactFilename(params.type);
      const path = writeArtifact(sessionCwd, filename, params.content);

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
    if (isActive() && isBrainstormMode(state) && isAwaitingAnswers(state?.brainstorm)) {
      const result = processBrainstormInput(state!, text);
      // Append answer to state
      state!.brainstorm = appendAnswer(state!.brainstorm!, result.appendAnswer.question, result.appendAnswer.answer);
      // Append answer to answers.md on disk
      if (state!.answersPath) {
        try {
          appendArtifact(sessionCwd, "answers.md",
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

  // Inject stage prompt before agent starts
  pi.on("before_agent_start", async (event, ctx) => {
    // Auto-start from --ralplan or --brainstorm flag on first prompt
    if (!isActive() && autoStartMode === null) {
      if (pi.getFlag("ralplan") === true) {
        autoStartMode = "ralplan";
      } else if (pi.getFlag("brainstorm") === true) {
        autoStartMode = "brainstorm";
      }
    }

    if (!isActive() && autoStartMode !== null) {
      const mode = autoStartMode;
      autoStartMode = null; // Only auto-start once

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

      state = buildDefaultState(idea, tracking, undefined, mode, sessionCwd);
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
    if (state.mode === "brainstorm" && state.brainstorm?.subPhase === "awaiting-answers") {
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
          if (detectBrainstormSignal(lastText, BRAINSTORM_OPEN_QUESTIONS_READY)) {
            // Parse questions from open-questions.md
            const questionsPath = resolveOpenQuestionsPath(sessionCwd);
            let questions: string[] = [];
            try {
              const content = readFileSync(questionsPath, "utf-8");
              questions = parseOpenQuestions(content);
            } catch {
              ctx.ui.notify("Warning: Could not read open questions file. Proceeding with empty list.", "warn");
            }

            // Handle empty questions: auto-transition to planning
            if (questions.length === 0) {
              ctx.ui.notify("No open questions found. Proceeding directly to planning.", "warn");
              state.brainstorm = transitionSubPhase(state.brainstorm!, "planning");
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

            // Send awaiting prompt to user
            // Defer via setTimeout to escape agent_end phase where isStreaming
            // is still true — without this the message goes to the dead followUpQueue
            // and only appears on the NEXT user prompt.
            setTimeout(() => {
              pi.sendMessage(
                {
                  customType: "brainstorm-awaiting",
                  content: getBrainstormAwaitingPrompt(questions),
                  display: true,
                },
                { triggerTurn: false },
              );
            }, 0);
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
          "success",
        );
        // Defer via setTimeout to escape agent_end phase where isStreaming
        // is still true — without this the message goes to the dead followUpQueue
        // and only appears on the NEXT user prompt.
        setTimeout(() => {
          pi.sendMessage(
            {
              customType: "ralplan-complete",
              content: `## RALPLAN Pipeline Complete! ✓

All stages finished successfully.`,
              display: true,
            },
            { triggerTurn: false },
          );
        }, 0);
        deactivateState();
        updateUI(ctx);
        return;
      }

      if (result.phase === "failed") {
        // Defer via setTimeout to escape agent_end phase — same fix as ralplan-complete.
        setTimeout(() => {
          pi.sendMessage(
            {
              customType: "ralplan-failed",
              content: `## RALPLAN Pipeline Failed

Error: ${result.tracking.stages[result.tracking.currentStageIndex]?.error ?? "Unknown error"}`,
              display: true,
            },
            { triggerTurn: false },
          );
        }, 0);
        deactivateState();
        updateUI(ctx);
        return;
      }

      const pipelineContext = buildContext();
      if (pipelineContext && result.adapter) {
        const prompt = result.adapter.getPrompt(pipelineContext);
        const transitionText = `${getTransitionPrompt(currentId, result.adapter.id)}\n\n${prompt}`;
        // Defer via setTimeout to escape agent_end phase where isStreaming
        // is still true — without this the transition goes to the dead followUpQueue
        // and the next stage never starts until the user sends a message.
        setTimeout(() => {
          pi.sendUserMessage(transitionText);
        }, 0);
      }
    }
  });

  // Restore state on session start / resume / fork
  pi.on("session_start", async (_event, ctx) => {
    reconstructFromSession(ctx);
    updateUI(ctx);

    // Notify user if resuming an awaiting-answers brainstorm session
    if (state?.mode === "brainstorm" && state.brainstorm?.subPhase === "awaiting-answers") {
      ctx.ui.notify("🧠 Brainstorm session resumed. Awaiting your answers.", "info");
    }
  });

  pi.on("session_tree", async (_event, ctx) => {
    reconstructFromSession(ctx);
    updateUI(ctx);

    // Notify user if resuming an awaiting-answers brainstorm session
    if (state?.mode === "brainstorm" && state.brainstorm?.subPhase === "awaiting-answers") {
      ctx.ui.notify("🧠 Brainstorm session resumed. Awaiting your answers.", "info");
    }
  });

  // Handle turn_end for iteration counting
  pi.on("turn_end", async (_event, ctx) => {
    if (!isActive() || !state) return;
    state.pipeline = incrementStageIteration(state.pipeline);
    persistState();
    updateUI(ctx);
  });
}