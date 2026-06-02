/**
 * Tool handlers for the RALPLAN extension.
 *
 * Each tool (ralplan_advance, ralplan_submit_artifact, ralplan_set_config)
 * takes the shared `RalplanContext` and pi's per-call `ToolContext`.
 *
 * Per plans/spec-2026-06-01-v2.md T-11: extracted from the previous
 * 1,257-line god module.
 */
import { Type } from "@sinclair/typebox";
import { StringEnum } from "@mariozechner/pi-ai";
import {
  advanceStage,
  getCurrentStageAdapter,
  syncTrackingToConfig,
} from "./pipeline.js";
import { getTransitionPrompt } from "./prompts.js";
import {
  writeArtifact,
  getDefaultArtifactFilename,
} from "./artifacts.js";
import type { RalplanContext } from "./state-mgmt.js";

export function registerTools(ctx: RalplanContext): void {
  const { pi } = ctx;

  pi.registerTool({
    name: "ralplan_advance",
    label: "Advance RALPLAN",
    description: "Explicitly advance to the next pipeline stage",
    parameters: Type.Object({
      reason: Type.Optional(
        Type.String({ description: "Reason for advancement" }),
      ),
    }),
    async execute(_toolCallId, _params, _signal, _onUpdate, ectx) {
      const state = ctx.getState();
      if (!ctx.isActive() || !state) {
        return {
          content: [{ type: "text", text: "No active RALPLAN session." }],
          details: {},
        };
      }

      const currentId = state.pipeline.stages[state.pipeline.currentStageIndex]?.id;
      const pipelineCtx = ctx.buildContext();
      const result = advanceStage(state.pipeline, pipelineCtx ?? undefined);
      state.pipeline = result.tracking;
      ctx.persistState();
      ctx.updateUI(ectx);

      if (result.phase === "complete") {
        ctx.deactivateState(ectx);
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
        ctx.deactivateState(ectx);
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
      const pipelineContext = ctx.buildContext();
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
    async execute(_toolCallId, params, _signal, _onUpdate, _ectx) {
      const { ensureRalplanDir } = await import("./utils.js");
      const targetDir = ctx.getWorkspaceDir();
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
    async execute(_toolCallId, params, _signal, _onUpdate, ectx) {
      const state = ctx.getState();
      if (!ctx.isActive() || !state) {
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

      ctx.persistState();
      ctx.updateUI(ectx);

      return {
        content: [{ type: "text", text: `RALPLAN config updated.` }],
        details: { config },
      };
    },
  });

  // Touch unused reference to keep types from being dropped by tree-shakers
  // (getCurrentStageAdapter is used by the ralplan_advance tool above).
  void getCurrentStageAdapter;
}
