import type { PipelineStageId } from "./pipeline.js";

export const STAGE_SIGNALS: Record<PipelineStageId, string> = {
  ralplan: "PIPELINE_RALPLAN_COMPLETE",
  execution: "PIPELINE_EXECUTION_COMPLETE",
  ralph: "PIPELINE_RALPH_COMPLETE",
  qa: "PIPELINE_QA_COMPLETE",
};

/** Brainstorm-specific signals */
export const BRAINSTORM_OPEN_QUESTIONS_READY = "BRAINSTORM_OPEN_QUESTIONS_READY";

/** Detect if a completion signal is present in text for a given stage */
export function detectSignal(text: string, stageId: PipelineStageId): boolean {
  const signal = STAGE_SIGNALS[stageId];
  if (!signal) return false;
  return text.includes(signal);
}

/** Detect if a brainstorm-specific signal is present in text */
export function detectBrainstormSignal(text: string, signal: string): boolean {
  if (!signal) return false;
  return text.includes(signal);
}

/** Get the expected completion signal for a stage */
export function getExpectedSignal(stageId: PipelineStageId): string | null {
  return STAGE_SIGNALS[stageId] ?? null;
}

/** Extract the last assistant text content from messages */
export function getLastAssistantText(messages: Array<{ role: string; content?: unknown }>): string | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.role !== "assistant") continue;
    if (typeof msg.content === "string") return msg.content;
    if (Array.isArray(msg.content)) {
      return msg.content
        .filter((c): c is { type: string; text?: string } => typeof c === "object" && c !== null)
        .filter((c) => c.type === "text")
        .map((c) => c.text ?? "")
        .join("\n");
    }
  }
  return null;
}
