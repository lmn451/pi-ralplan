/**
 * Slash-command handlers for the RALPLAN extension.
 *
 * Each command takes the shared `RalplanContext` (which exposes both the
 * pi runtime and the state-management helpers) plus the per-call
 * `ExtensionContext` from pi.
 *
 * Per plans/spec-2026-06-01-v2.md T-11: extracted from the previous
 * 1,257-line god module. index.ts calls `registerCommands(ctx)` to wire
 * all 8 commands at extension load.
 */
import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import {
  buildPipelineTracking,
  resolvePipelineConfig,
  getCurrentStageAdapter,
  getPipelineStatus,
  formatPipelineHUD,
  skipCurrentStage,
} from "./pipeline.js";
import { buildDefaultState, type RalplanState } from "./state.js";
import { getTransitionPrompt } from "./prompts.js";
import {
  appendArtifact,
  getDefaultArtifactFilename,
  readPlanningArtifacts,
} from "./artifacts.js";
import { createAndAttachWorktree } from "./worktree-helper.js";
import { doneAnswering, skipQuestions } from "./brainstorm.js";
import type { RalplanContext } from "./state-mgmt.js";

export function registerCommands(ctx: RalplanContext): void {
  const { pi } = ctx;

  // -- /ralplan ----------------------------------------------------------------
  pi.registerCommand("ralplan", {
    description: "Start consensus planning for an idea",
    handler: async (args, ectx) => {
      if (ctx.isActive()) {
        ectx.ui.notify(
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
      const worktree = createAndAttachWorktree(
        ectx,
        ctx.getSessionCwd(),
        idea,
      );

      const newState: RalplanState = buildDefaultState(
        idea,
        tracking,
        undefined,
        "ralplan",
        ctx.getSessionCwd(),
      );
      newState.worktreePath = worktree.ok ? worktree.path : undefined;
      ctx.setState(newState);
      ctx.persistState();
      ctx.updateUI(ectx);

      ectx.ui.notify(`RALPLAN started: ${idea}`, "info");

      const context = ctx.buildContext();
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

  // -- /brainstorm -------------------------------------------------------------
  pi.registerCommand("brainstorm", {
    description:
      "Start brainstorm planning for an idea (user answers open questions)",
    handler: async (args, ectx) => {
      if (ctx.isActive()) {
        ectx.ui.notify(
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

      const worktree = createAndAttachWorktree(
        ectx,
        ctx.getSessionCwd(),
        idea,
      );

      const newState: RalplanState = buildDefaultState(
        idea,
        tracking,
        undefined,
        "brainstorm",
        ctx.getSessionCwd(),
      );
      newState.worktreePath = worktree.ok ? worktree.path : undefined;
      ctx.setState(newState);
      ctx.persistState();
      ctx.updateUI(ectx);

      ectx.ui.notify(`BRAINSTORM started: ${idea}`, "info");

      const context = ctx.buildContext();
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

  // -- /ralplan:status ----------------------------------------------------------
  pi.registerCommand("ralplan:status", {
    description: "Show current pipeline status",
    handler: async (_args, ectx) => {
      const state = ctx.getState();
      if (!ctx.isActive() || !state) {
        ectx.ui.notify(
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
      ectx.ui.notify(msg, "info");
    },
  });

  // -- /ralplan:cancel ----------------------------------------------------------
  pi.registerCommand("ralplan:cancel", {
    description: "Cancel active ralplan session",
    handler: async (_args, ectx) => {
      if (!ctx.isActive()) {
        ectx.ui.notify("No active RALPLAN session to cancel.", "info");
        return;
      }

      const ok = await ectx.ui.confirm(
        "Cancel RALPLAN?",
        "This will discard the current pipeline.",
      );
      if (!ok) return;

      // T-9.3: cancel preserves the worktree so users can review artifacts.
      ctx.deactivateState(ectx, { suppressCleanup: true });
      ctx.updateUI(ectx);
      ectx.ui.notify("RALPLAN cancelled.", "info");
    },
  });

  // -- /ralplan:skip ------------------------------------------------------------
  pi.registerCommand("ralplan:skip", {
    description: "Skip current stage",
    handler: async (_args, ectx) => {
      const state = ctx.getState();
      if (!ctx.isActive() || !state) {
        ectx.ui.notify("No active RALPLAN session.", "info");
        return;
      }

      const { stages, currentStageIndex } = state.pipeline;
      const pipelineCtx = ctx.buildContext();
      const result = skipCurrentStage(state.pipeline, pipelineCtx ?? undefined);
      state.pipeline = result.tracking;
      ctx.persistState();
      ctx.updateUI(ectx);

      if (result.phase === "complete") {
        ectx.ui.notify("RALPLAN pipeline complete!", "info");
        ctx.deactivateState(ectx);
        return;
      }

      if (result.phase === "failed") {
        ectx.ui.notify(
          `RALPLAN stage failed: ${result.tracking.stages[result.tracking.currentStageIndex]?.error ?? "Unknown error"}`,
          "error",
        );
        ctx.deactivateState(ectx);
        return;
      }

      const context = ctx.buildContext();
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

  // -- /ralplan:done-answering --------------------------------------------------
  pi.registerCommand("ralplan:done-answering", {
    description: "Signal that you're done answering brainstorm questions",
    handler: async (_args, ectx) => {
      const state = ctx.getState();
      if (!ctx.isActive() || !state) {
        ectx.ui.notify("No active session.", "info");
        return;
      }

      if (
        state.mode !== "brainstorm" ||
        state.brainstorm?.subPhase !== "awaiting-answers"
      ) {
        ectx.ui.notify("Not currently awaiting answers.", "info");
        return;
      }

      state.brainstorm = doneAnswering(state.brainstorm);
      ctx.persistState();
      ctx.updateUI(ectx);

      const context = ctx.buildContext();
      if (context) {
        // Defer to the helper if available, or just send directly.
        // (No setTimeout needed in current pi; see T-1.)
        const { getBrainstormResumePrompt } = await import("./prompts.js");
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

  // -- /ralplan:skip-questions --------------------------------------------------
  pi.registerCommand("ralplan:skip-questions", {
    description:
      "Skip brainstorm open questions and proceed to planning (escape hatch)",
    handler: async (_args, ectx) => {
      const state = ctx.getState();
      if (!ctx.isActive() || !state) {
        ectx.ui.notify("No active session.", "info");
        return;
      }

      if (state.mode !== "brainstorm") {
        ectx.ui.notify("Not in brainstorm mode.", "info");
        return;
      }

      const sub = state.brainstorm?.subPhase;
      if (sub !== "expanding" && sub !== "awaiting-answers") {
        ectx.ui.notify("Not currently in a phase with open questions.", "info");
        return;
      }

      state.brainstorm = skipQuestions(state.brainstorm!);

      if (state.answersPath) {
        appendArtifact(
          ctx.getWorkspaceDir(),
          "answers.md",
          "\n## Skipped — User declined to answer open questions. Proceeding with best-effort planning.\n",
        );
      }

      ctx.persistState();
      ctx.updateUI(ectx);

      const context = ctx.buildContext();
      if (context) {
        const { getBrainstormResumePrompt } = await import("./prompts.js");
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

  // -- /ralplan:artifacts -------------------------------------------------------
  pi.registerCommand("ralplan:artifacts", {
    description: "List planning artifacts",
    handler: async (_args, ectx) => {
      const artifacts = readPlanningArtifacts(ctx.getWorkspaceDir());
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
        ectx.ui.notify("No planning artifacts found in plans/", "info");
      } else {
        ectx.ui.notify(parts.join("\n\n"), "info");
      }
    },
  });

  // Touch unused import so tree-shakers don't drop it (it's used above
  // dynamically in the done-answering and skip-questions handlers).
  void getDefaultArtifactFilename;
}
