/**
 * Event handlers for the RALPLAN extension.
 *
 * Wires up all 6 event subscriptions (input, before_agent_start,
 * agent_end, session_start, session_tree, turn_end) to the shared
 * `RalplanContext`.
 *
 * Per plans/spec-2026-06-01-v2.md T-11: extracted from the previous
 * 1,257-line god module.
 */
import { readFileSync } from "node:fs";
import {
  buildPipelineTracking,
  resolvePipelineConfig,
  getCurrentStageAdapter,
  advanceStage,
  getPipelineStatus,
  getStageMaxIterations,
  incrementStageIteration,
} from "./pipeline.js";
import {
  detectSignal,
  detectBrainstormSignal,
  getLastAssistantText,
  BRAINSTORM_OPEN_QUESTIONS_READY,
} from "./signals.js";
import {
  getBrainstormAwaitingPrompt,
  getBrainstormSteeringPrompt,
  getTransitionPrompt,
} from "./prompts.js";
import { hasBypassPrefix, looksLikeBroadRequest } from "./gate.js";
import { resolveOpenQuestionsPath } from "./utils.js";
import { buildDefaultState, type RalplanState } from "./state.js";
import { createAndAttachWorktree } from "./worktree-helper.js";
import { appendArtifact } from "./artifacts.js";
import {
  processBrainstormAgentEnd,
  processBrainstormInput,
  transitionSubPhase,
  withQuestions,
  shouldSuppressSignals,
  parseOpenQuestions,
} from "./brainstorm.js";
import type { RalplanContext } from "./state-mgmt.js";

/**
 * Detect if a RALPLAN-skill keyword appears in a prompt. Pure function,
 * exposed for the test suite (tests/skill-detection.test.ts).
 */
function detectRalplanSkillUsage(
  prompt: string,
): "ralplan" | "brainstorm" | null {
  const lower = prompt.toLowerCase();

  if (lower.includes("ralplan") || lower.includes("/ralplan")) {
    if (lower.includes("brainstorm")) return "brainstorm";
    return "ralplan";
  }
  if (lower.includes("brainstorm")) return "brainstorm";
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

export function registerHandlers(ctx: RalplanContext): void {
  const { pi } = ctx;

  // -- input -------------------------------------------------------------------
  pi.on("input", async (event, ectx) => {
    if (event.source === "extension") return { action: "continue" as const };

    const text = event.text.trim();

    // Brainstorm answer accumulation during awaiting-answers
    const state = ctx.getState();
    if (state && state.mode === "brainstorm" && state.brainstorm?.subPhase === "awaiting-answers") {
      const result = processBrainstormInput(state, text);
      state.brainstorm = result.appendAnswer
        ? (await import("./brainstorm.js")).appendAnswer(
            state.brainstorm,
            result.appendAnswer.question,
            result.appendAnswer.answer,
          )
        : state.brainstorm;
      if (state.answersPath) {
        try {
          if (result.appendAnswer) {
            appendArtifact(
              ctx.getWorkspaceDir(),
              "answers.md",
              `\n### Q: ${result.appendAnswer.question}\n${result.appendAnswer.answer}\n`,
            );
          }
        } catch {
          // File I/O failure — state is still updated in-memory
        }
      }
      ctx.persistState();
      ctx.updateUI(ectx);
      return { action: "continue" as const };
    }

    // Ralplan-first gate: if user makes a broad request and no active session,
    // suggest ralplan first. Skip if explicitly bypassed.
    if (!ctx.isActive() && looksLikeBroadRequest(text) && !hasBypassPrefix(text)) {
      ectx.ui.notify(
        "This looks like a broad request. Consider using /ralplan for consensus planning first, or prefix with 'force:' to bypass.",
        "info",
      );
    }

    return { action: "continue" as const };
  });

  // -- before_agent_start -------------------------------------------------------
  pi.on("before_agent_start", async (event, ectx) => {
    // Auto-start from --ralplan flag or --brainstorm flag only.
    // (skill usage from prompt content no longer auto-starts — it only notifies)
    if (!ctx.isActive() && ctx.getAutoStartMode() === null) {
      if (pi.getFlag("ralplan") === true) {
        ctx.setAutoStartMode("ralplan");
      } else if (pi.getFlag("brainstorm") === true) {
        ctx.setAutoStartMode("brainstorm");
      } else {
        // Detect skill usage from prompt content. If matched, suggest /ralplan
        // explicitly — do NOT auto-start (avoids surprise planning sessions).
        const detected = detectRalplanSkillUsage(event.prompt);
        if (detected) {
          ectx.ui.notify(
            "This prompt mentions RALPLAN. Run /ralplan to start a planning session.",
            "info",
          );
        }
      }
    }

    // Skip auto-start if session already has ralplan state
    const hasRalplanState = ectx.sessionManager
      .getEntries()
      .some((e) => e.type === "custom" && (e as { customType?: string }).customType === "ralplan-state");

    const autoStartMode = ctx.getAutoStartMode();
    if (!ctx.isActive() && autoStartMode !== null && !hasRalplanState) {
      const mode = autoStartMode;
      ctx.setAutoStartMode(null);

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

      const worktree = createAndAttachWorktree(ectx, ctx.getSessionCwd(), idea);

      const newState: RalplanState = buildDefaultState(
        idea,
        tracking,
        undefined,
        mode,
        ctx.getSessionCwd(),
      );
      newState.worktreePath = worktree.ok ? worktree.path : undefined;
      ctx.setState(newState);
      ctx.persistState();
      ctx.updateUI(ectx);

      const label = mode === "brainstorm" ? "BRAINSTORM" : "RALPLAN";
      ectx.ui.notify(`${label} started (via --${mode}): ${idea}`, "info");
    }

    if (!ctx.isActive() || !ctx.getState()) return;

    const adapter = getCurrentStageAdapter(ctx.getState()!.pipeline);
    if (!adapter) return;

    const context = ctx.buildContext();
    if (!context) return;

    // During brainstorm awaiting-answers, inject steering prompt
    const cur = ctx.getState()!;
    if (
      cur.mode === "brainstorm" &&
      cur.brainstorm?.subPhase === "awaiting-answers"
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

  // -- agent_end ---------------------------------------------------------------
  pi.on("agent_end", async (event, ectx) => {
    const state = ctx.getState();
    if (!ctx.isActive() || !state) return;

    const currentStage = state.pipeline.stages[state.pipeline.currentStageIndex];
    if (!currentStage) return;

    // Deduplication
    const branch = ectx.sessionManager.getBranch();
    const lastEntry = branch[branch.length - 1];
    const currentEntryId = lastEntry?.id ?? null;
    if (currentEntryId && currentEntryId === ctx.getLastAdvancedEntryId()) {
      return;
    }

    const lastText = getLastAssistantText(event.messages);
    if (!lastText) return;

    // Brainstorm signal routing
    if (state.mode === "brainstorm" && currentStage.id === "ralplan") {
      if (shouldSuppressSignals(state)) {
        const sub = state.brainstorm?.subPhase;

        if (sub === "expanding") {
          if (detectBrainstormSignal(lastText, BRAINSTORM_OPEN_QUESTIONS_READY)) {
            const questionsPath = resolveOpenQuestionsPath(ctx.getWorkspaceDir());
            let questions: string[] = [];
            try {
              const content = readFileSync(questionsPath, "utf-8");
              questions = parseOpenQuestions(content);
            } catch {
              ectx.ui.notify(
                "Warning: Could not read open questions file. Proceeding with empty list.",
                "warning",
              );
            }

            if (questions.length === 0) {
              ectx.ui.notify(
                "No open questions found. Proceeding directly to planning.",
                "warning",
              );
              state.brainstorm = transitionSubPhase(
                state.brainstorm!,
                "planning",
              );
              ctx.persistState();
              ctx.updateUI(ectx);

              const context = ctx.buildContext();
              if (context) {
                const { getBrainstormResumePrompt } = await import("./prompts.js");
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

            state.brainstorm = withQuestions(
              transitionSubPhase(state.brainstorm!, "awaiting-answers"),
              questions,
            );
            ctx.persistState();
            ctx.updateUI(ectx);

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
          }
          return;
        }

        return; // awaiting-answers: total signal suppression
      }

      if (state.brainstorm?.subPhase === "planning") {
        if (detectSignal(lastText, currentStage.id)) {
          // Fall through to advancement logic below
        } else {
          return;
        }
      }
    }

    if (detectSignal(lastText, currentStage.id)) {
      ctx.setLastAdvancedEntryId(currentEntryId);
      const currentId = currentStage.id;
      const pipelineCtx = ctx.buildContext();
      const result = advanceStage(state.pipeline, pipelineCtx ?? undefined);
      state.pipeline = result.tracking;
      ctx.persistState();
      ctx.updateUI(ectx);

      if (result.phase === "complete") {
        ectx.ui.notify(
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
        ctx.deactivateState(ectx);
        ctx.updateUI(ectx);
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
        ctx.deactivateState(ectx);
        ctx.updateUI(ectx);
        return;
      }

      const pipelineContext = ctx.buildContext();
      if (pipelineContext && result.adapter) {
        const prompt = result.adapter.getPrompt(pipelineContext);
        const transitionText = `${getTransitionPrompt(currentId, result.adapter.id)}\n\n${prompt}`;
        pi.sendUserMessage(transitionText);
      }
    }
  });

  // -- session_start ------------------------------------------------------------
  pi.on("session_start", async (_event, ectx) => {
    ctx.reconstructFromSession(ectx);
    ctx.updateUI(ectx);

    const state = ctx.getState();
    if (
      state?.mode === "brainstorm" &&
      state.brainstorm?.subPhase === "awaiting-answers"
    ) {
      ectx.ui.notify(
        "🧠 Brainstorm session resumed. Awaiting your answers.",
        "info",
      );
    }
  });

  // -- session_tree -------------------------------------------------------------
  pi.on("session_tree", async (_event, ectx) => {
    ctx.reconstructFromSession(ectx);
    ctx.updateUI(ectx);

    const state = ctx.getState();
    if (
      state?.mode === "brainstorm" &&
      state.brainstorm?.subPhase === "awaiting-answers"
    ) {
      ectx.ui.notify(
        "🧠 Brainstorm session resumed. Awaiting your answers.",
        "info",
      );
    }
  });

  // -- turn_end -----------------------------------------------------------------
  pi.on("turn_end", async (_event, ectx) => {
    const state = ctx.getState();
    if (!ctx.isActive() || !state) return;

    // T-8: per-stage maxIterations. QA = 5; verification = configured
    // (default 100); planning/execution = DEFAULT_STAGE_MAX_ITERATIONS.
    const currentStage = state.pipeline.stages[state.pipeline.currentStageIndex];
    const maxIters = getStageMaxIterations(
      currentStage.id,
      state.pipeline.pipelineConfig,
    );
    if (currentStage.iterations >= maxIters) {
      ectx.ui.notify(
        `Maximum iterations (${maxIters}) reached for ${currentStage.id}. Please review and manually approve or use /ralplan:skip to proceed.`,
        "warning",
      );
      return;
    }

    state.pipeline = incrementStageIteration(state.pipeline);
    ctx.persistState();
    ctx.updateUI(ectx);
  });


  // Touch unused processBrainstormAgentEnd reference (it's wired but used
  // implicitly via the agent_end handler's brainstorm branch).
  void processBrainstormAgentEnd;
  void getPipelineStatus;
}
