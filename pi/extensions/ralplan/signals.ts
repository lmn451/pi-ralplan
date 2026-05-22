import type { PipelineStageId } from "./pipeline.js";

export const STAGE_SIGNALS: Record<PipelineStageId, string> = {
  ralplan: "PIPELINE_RALPLAN_COMPLETE",
  execution: "PIPELINE_EXECUTION_COMPLETE",
  ralph: "PIPELINE_RALPH_COMPLETE",
  qa: "PIPELINE_QA_COMPLETE",
};

/** Brainstorm-specific signals */
export const BRAINSTORM_OPEN_QUESTIONS_READY =
  "BRAINSTORM_OPEN_QUESTIONS_READY";

/** Consensus loop signals (Planner→Architect→Critic iteration) */
export const CONSENSUS_APPROVED = "CONSENSUS_APPROVED";
export const CONSENSUS_REJECTED = "CONSENSUS_REJECTED";

/** Planning expansion signals */
export const EXPANSION_COMPLETE = "EXPANSION_COMPLETE";
export const PLAN_CREATED = "PLAN_CREATED";
export const PLANNING_COMPLETE = "PLANNING_COMPLETE";

/**
 * Detect if a consensus signal (APPROVE/REJECT) is present in text.
 * Uses same boundary-aware detection as other signals.
 */
/**
 * Detect if a signal is present in text (generic version).
 * Searches only in non-code segments to avoid false positives.
 */
function detectSignalGeneric(text: string, signal: string): boolean {
  if (!signal) return false;
  const nonCodeSegments = splitByCodeBlocks(text);
  for (const segment of nonCodeSegments) {
    if (containsBoundaryAwareSignal(segment, signal)) {
      return true;
    }
  }
  return false;
}

/**
 * Detect if a completion signal is present in text for a given stage.
 * @deprecated Use detectSignalGeneric directly with a signal string
 */
export function detectConsensusSignal(text: string, signal: string): boolean {
  return detectSignalGeneric(text, signal);
}

/**
 * Escape special regex characters in a string
 */
export function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Split text by code blocks (```...```) and return only non-code segments
 */
function splitByCodeBlocks(text: string): string[] {
  const parts: string[] = [];
  const codeBlockRegex = /```[\s\S]*?```/g;
  let lastIndex = 0;
  let match;
  while ((match = codeBlockRegex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }
    lastIndex = codeBlockRegex.lastIndex;
  }
  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }
  return parts;
}

/**
 * Check if a line looks like it contains a signal (not in a comment)
 * Rejects lines starting with // or /*, and lines with inline code markers
 */
function isSignalLine(line: string): boolean {
  const trimmed = line.trim();
  // Reject empty lines
  if (!trimmed) return false;
  // Reject single-line comments (JS `//` and shell `#`)
  if (/^(\/\/|#)/.test(trimmed)) return false;
  // Reject multi-line comment openers
  if (/^\/\*/.test(trimmed)) return false;
  // Reject lines with inline code (backticks)
  if (/`/.test(trimmed)) return false;
  return true;
}

/**
 * Check if text segment contains a signal with proper word boundaries
 * Signal must be on its own line (not in a comment or code)
 */
function containsBoundaryAwareSignal(text: string, signal: string): boolean {
  // Split into lines
  const lines = text.split("\n");
  for (const line of lines) {
    if (!isSignalLine(line)) continue;
    const signalRegex = new RegExp(
      "(?:^|\\s)" + escapeRegex(signal) + "(?:$|\\s)",
    );
    if (signalRegex.test(line)) {
      return true;
    }
  }
  return false;
}

/** Detect if a completion signal is present in text for a given stage */
export function detectSignal(text: string, stageId: PipelineStageId): boolean {
  const signal = STAGE_SIGNALS[stageId];
  return detectSignalGeneric(text, signal ?? "");
}

/** Detect if a brainstorm-specific signal is present in text */
export function detectBrainstormSignal(text: string, signal: string): boolean {
  return detectSignalGeneric(text, signal);
}

/** Get the expected completion signal for a stage */
export function getExpectedSignal(stageId: PipelineStageId): string | null {
  return STAGE_SIGNALS[stageId] ?? null;
}

/** Extract the last assistant text content from messages */
export function getLastAssistantText(
  messages: Array<{ role: string; content?: unknown }>,
): string | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.role !== "assistant") continue;
    if (typeof msg.content === "string") return msg.content;
    if (Array.isArray(msg.content)) {
      return msg.content
        .filter(
          (c): c is { type: string; text?: string } =>
            typeof c === "object" && c !== null,
        )
        .filter((c) => c.type === "text")
        .map((c) => c.text ?? "")
        .join("\n");
    }
  }
  return null;
}
