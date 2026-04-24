import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { StringEnum } from "@mariozechner/pi-ai";

import {
  registerAdapters,
  buildPipelineTracking,
  resolvePipelineConfig,
  getCurrentStageAdapter,
  advanceStage,
  incrementStageIteration,
  getPipelineStatus,
  formatPipelineHUD,
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
} from "./state.js";

import { detectSignal, getLastAssistantText } from "./signals.js";
import { getTransitionPrompt } from "./prompts.js";
import { readPlanningArtifacts } from "./artifacts.js";

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

  // Track whether we auto-started from --ralplan flag (only once)
  let autoStartedFromFlag = false;

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
      directory: process.cwd(),
      sessionId: state.sessionId,
      specPath: state.specPath,
      planPath: state.planPath,
      openQuestionsPath: ".pi/ralplan/plans/open-questions.md",
      config: state.pipeline.pipelineConfig,
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
    };
    pi.appendEntry(CUSTOM_TYPE, persisted);
    writeRalplanStateFile(process.cwd(), state);
  }

  function deactivateState(): void {
    if (state) {
      state.active = false;
      state.completedAt = new Date().toISOString();
      persistState();
    }
    state = null;
    clearRalplanStateFile(process.cwd());
  }

  function updateUI(ctx: ExtensionContext): void {
    if (!isActive() || !state) {
      ctx.ui.setStatus("ralplan", undefined);
      ctx.ui.setWidget("ralplan-progress", undefined);
      return;
    }

    const status = getPipelineStatus(state.pipeline);
    const currentName =
      getCurrentStageAdapter(state.pipeline)?.name ??
      (status.isComplete ? "Complete" : "None");
    ctx.ui.setStatus("ralplan", ctx.ui.theme.fg("accent", `📋 ${currentName} (${status.progress})`));

    const hud = formatPipelineHUD(state.pipeline);
    ctx.ui.setWidget("ralplan-progress", hud);
  }

  function reconstructFromSession(ctx: ExtensionContext): void {
    const entries = ctx.sessionManager.getEntries();

    // Find the most recent ralplan-state entry
    const ralplanEntry = entries
      .filter(
        (e: {
          type: string;
          customType?: string;
          data?: PersistedState;
        }) => e.type === "custom" && e.customType === CUSTOM_TYPE,
      )
      .pop() as { data?: PersistedState } | undefined;

    if (ralplanEntry?.data) {
      const data = ralplanEntry.data;
      state = {
        version: 1,
        active: data.active,
        pipeline: data.tracking,
        originalIdea: data.originalIdea,
        specPath: data.specPath,
        planPath: data.planPath,
        sessionId: data.sessionId,
        startedAt: data.tracking.stages[0]?.startedAt ?? new Date().toISOString(),
      };
      return;
    }

    // Fallback to file-based state
    const fileState = readRalplanStateFile(process.cwd());
    if (fileState) {
      state = fileState;
    }
  }

  // ==========================================================================
  // COMMANDS
  // ==========================================================================

  pi.registerFlag("ralplan", {
    description: "Start a RALPLAN consensus planning session with the initial prompt",
    type: "boolean",
    default: false,
  });

  pi.registerCommand("ralplan", {
    description: "Start consensus planning for an idea",
    handler: async (args, ctx) => {
      const idea = args.trim() || "Implement the requested feature";

      const config = resolvePipelineConfig();
      const tracking = buildPipelineTracking(config);

      // Activate first stage
      if (
        tracking.currentStageIndex >= 0 &&
        tracking.currentStageIndex < tracking.stages.length
      ) {
        tracking.stages[tracking.currentStageIndex].status = "active";
        tracking.stages[tracking.currentStageIndex].startedAt =
          new Date().toISOString();
      }

      state = buildDefaultState(idea, tracking, undefined);
      persistState();
      updateUI(ctx);

      ctx.ui.notify(`RALPLAN started: ${idea}`, "info");

      // Trigger the first stage immediately
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

  pi.registerCommand("ralplan:status", {
    description: "Show current pipeline status",
    handler: async (_args, ctx) => {
      if (!isActive() || !state) {
        ctx.ui.notify("No active RALPLAN session. Use /ralplan to start one.", "info");
        return;
      }

      const status = getPipelineStatus(state.pipeline);
      const lines = formatPipelineHUD(state.pipeline);
      const msg = `**RALPLAN Status**\n\nProgress: ${status.progress}\n\n${lines.join("\n")}`;
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

      const ok = await ctx.ui.confirm("Cancel RALPLAN?", "This will discard the current pipeline.");
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
      if (currentStageIndex >= 0 && currentStageIndex < stages.length) {
        stages[currentStageIndex].status = "skipped";
      }

      const pipelineCtx = buildContext();
      const result = advanceStage(state.pipeline, pipelineCtx ?? undefined);
      state.pipeline = result.tracking;
      persistState();
      updateUI(ctx);

      if (result.phase === "complete") {
        ctx.ui.notify("RALPLAN pipeline complete!", "success");
        deactivateState();
        return;
      }

      if (result.phase === "failed") {
        ctx.ui.notify(`RALPLAN stage failed: ${result.tracking.stages[result.tracking.currentStageIndex]?.error ?? "Unknown error"}`, "error");
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

  pi.registerCommand("ralplan:artifacts", {
    description: "List planning artifacts",
    handler: async (_args, ctx) => {
      const artifacts = readPlanningArtifacts(process.cwd());
      const parts: string[] = [];

      if (artifacts.specPaths.length > 0) {
        parts.push(`**Specs:**\n${artifacts.specPaths.map((p) => `- ${p}`).join("\n")}`);
      }
      if (artifacts.planPaths.length > 0) {
        parts.push(`**Plans:**\n${artifacts.planPaths.map((p) => `- ${p}`).join("\n")}`);
      }
      if (artifacts.testSpecPaths.length > 0) {
        parts.push(`**Test Specs:**\n${artifacts.testSpecPaths.map((p) => `- ${p}`).join("\n")}`);
      }

      if (parts.length === 0) {
        ctx.ui.notify("No planning artifacts found in .pi/ralplan/plans/", "info");
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
      reason: Type.Optional(Type.String({ description: "Reason for advancement" })),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      if (!isActive() || !state) {
        return {
          content: [{ type: "text", text: "No active RALPLAN session." }],
          details: {},
        };
      }

      const currentId = state.pipeline.stages[state.pipeline.currentStageIndex]?.id;
      const pipelineCtx = buildContext();
      const result = advanceStage(state.pipeline, pipelineCtx ?? undefined);
      state.pipeline = result.tracking;
      persistState();
      updateUI(ctx);

      if (result.phase === "complete") {
        deactivateState();
        return {
          content: [{ type: "text", text: "RALPLAN pipeline complete! All stages finished." }],
          details: { phase: "complete" },
        };
      }

      if (result.phase === "failed") {
        deactivateState();
        return {
          content: [{ type: "text", text: `RALPLAN stage failed: ${result.tracking.stages[result.tracking.currentStageIndex]?.error ?? "Unknown error"}` }],
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
    description: "Submit a planning artifact (spec, plan, test-spec) to the ralplan pipeline",
    parameters: Type.Object({
      type: StringEnum(["spec", "plan", "test-spec"] as const),
      content: Type.String({ description: "Markdown content of the artifact" }),
      filename: Type.Optional(Type.String({ description: "Custom filename (default: auto-generated)" })),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const { writeArtifact } = await import("./artifacts.js");
      const { ensureRalplanDir } = await import("./utils.js");

      ensureRalplanDir(process.cwd());

      const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
      const filename = params.filename || `${params.type}-${timestamp}.md`;
      const path = writeArtifact(process.cwd(), filename, params.content);

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
      planning: Type.Optional(StringEnum(["ralplan", "direct", "skip"] as const)),
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
      else if (params.verification && config.verification !== false) {
        config.verification = { engine: "ralph", maxIterations: 100 };
      }

      if (params.qa !== undefined) config.qa = params.qa;

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

  // Detect /ralplan or keyword in user input
  pi.on("input", async (event, ctx) => {
    if (event.source === "extension") return { action: "continue" };

    const text = event.text.trim();

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
    // Auto-start from --ralplan flag on first prompt
    if (!isActive() && pi.getFlag("ralplan") === true && !autoStartedFromFlag) {
      autoStartedFromFlag = true;
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

      state = buildDefaultState(idea, tracking, undefined);
      persistState();
      updateUI(ctx);
      ctx.ui.notify(`RALPLAN started (via --ralplan): ${idea}`, "info");
      // Continue to inject the stage prompt below
    }

    if (!isActive() || !state) return;

    const adapter = getCurrentStageAdapter(state.pipeline);
    if (!adapter) return;

    const context = buildContext();
    if (!context) return;

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

    const currentStage = state.pipeline.stages[state.pipeline.currentStageIndex];
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

    if (detectSignal(lastText, currentStage.id)) {
      lastAdvancedEntryId = currentEntryId;
      const currentId = currentStage.id;
      const pipelineCtx = buildContext();
      const result = advanceStage(state.pipeline, pipelineCtx ?? undefined);
      state.pipeline = result.tracking;
      persistState();
      updateUI(ctx);

      if (result.phase === "complete") {
        ctx.ui.notify("RALPLAN Pipeline Complete! ✓ All stages finished successfully.", "success");
        pi.sendMessage(
          {
            customType: "ralplan-complete",
            content: `## RALPLAN Pipeline Complete! ✓

All stages finished successfully.`,
            display: true,
          },
          { triggerTurn: false },
        );
        deactivateState();
        updateUI(ctx);
        return;
      }

      if (result.phase === "failed") {
        pi.sendMessage(
          {
            customType: "ralplan-failed",
            content: `## RALPLAN Pipeline Failed

Error: ${result.tracking.stages[result.tracking.currentStageIndex]?.error ?? "Unknown error"}`,
            display: true,
          },
          { triggerTurn: false },
        );
        deactivateState();
        updateUI(ctx);
        return;
      }

      const pipelineContext = buildContext();
      if (pipelineContext && result.adapter) {
        const prompt = result.adapter.getPrompt(pipelineContext);
        pi.sendUserMessage(
          `${getTransitionPrompt(currentId, result.adapter.id)}\n\n${prompt}`,
          { deliverAs: "followUp" },
        );
      }
    }
  });

  // Restore state on session start / resume / fork
  pi.on("session_start", async (_event, ctx) => {
    reconstructFromSession(ctx);
    updateUI(ctx);
  });

  pi.on("session_tree", async (_event, ctx) => {
    reconstructFromSession(ctx);
    updateUI(ctx);
  });

  // Handle turn_end for iteration counting
  pi.on("turn_end", async (_event, ctx) => {
    if (!isActive() || !state) return;
    state.pipeline = incrementStageIteration(state.pipeline);
    persistState();
    updateUI(ctx);
  });
}

// ============================================================================
// HEURISTICS
// ============================================================================

// Concrete anchors that indicate a well-specified request (passes the gate)
const CONCRETE_ANCHORS = [
  /[a-zA-Z0-9_\-./]+\.[a-zA-Z]{2,}/, // file paths with extensions
  /#[0-9]+/, // issue/PR numbers
  /[a-z]+[A-Z][a-zA-Z]+/, // camelCase symbols
  /[A-Z][a-z]+[A-Z][a-zA-Z]+/, // PascalCase symbols
  /[a-z]+_[a-z_]+/, // snake_case symbols
  /\d+\.\s+/, // numbered steps
  /```[a-z]*\n/, // code blocks
  /acceptance criteria/i,
  /error[:\s]/i,
  /test\s+(runner|suite|file)/i,
];

// Broad execution keywords that suggest underspecified work
const BROAD_INDICATORS = [
  "build me",
  "create a",
  "implement",
  "develop",
  "make a",
  "write a",
  "design a",
  "set up",
  "add feature",
  "new feature",
  "improve",
  "optimize",
  "refactor",
  "fix this",
  "update the",
];

const BYPASS_PREFIXES = ["force:", "! "];

function hasBypassPrefix(text: string): boolean {
  const trimmed = text.trim().toLowerCase();
  return BYPASS_PREFIXES.some((p) => trimmed.startsWith(p));
}

function hasConcreteAnchor(text: string): boolean {
  return CONCRETE_ANCHORS.some((re) => re.test(text));
}

function looksLikeBroadRequest(text: string): boolean {
  const lower = text.toLowerCase();
  // Must have a broad indicator
  const hasBroad = BROAD_INDICATORS.some((ind) => lower.includes(ind));
  // Must be reasonably short (<= 15 effective words) OR lack concrete anchors
  const words = text.split(/\s+/).filter((w) => w.length > 0);
  const isShort = words.length <= 15;
  const hasAnchor = hasConcreteAnchor(text);

  // Gate fires when: broad indicator present AND short AND no concrete anchor
  return hasBroad && isShort && !hasAnchor;
}
