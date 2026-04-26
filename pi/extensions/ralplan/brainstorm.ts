import type { RalplanState } from "./state.js";
import { getSectionContent } from "./artifacts.js";

// ============================================================================
// TYPES
// ============================================================================

export type BrainstormSubPhase = "expanding" | "awaiting-answers" | "planning";

export interface QandA {
  question: string;
  answer: string;
}

export interface BrainstormState {
  subPhase: BrainstormSubPhase;
  questions: string[];
  answers: QandA[];
  awaitingSince?: string;
}

// ============================================================================
// CONSTRUCTOR
// ============================================================================

export function createBrainstormState(): BrainstormState {
  return {
    subPhase: "expanding",
    questions: [],
    answers: [],
  };
}

// ============================================================================
// IMMUTABLE STATE TRANSITIONS
// ============================================================================

export function transitionSubPhase(
  state: BrainstormState,
  target: BrainstormSubPhase,
): BrainstormState {
  return {
    ...state,
    subPhase: target,
    awaitingSince: target === "awaiting-answers" ? new Date().toISOString() : undefined,
  };
}

export function appendAnswer(
  state: BrainstormState,
  question: string,
  answer: string,
): BrainstormState {
  return {
    ...state,
    answers: [...state.answers, { question, answer }],
  };
}

export function withQuestions(state: BrainstormState, questions: string[]): BrainstormState {
  return {
    ...state,
    questions,
  };
}

// ============================================================================
// PREDICATES
// ============================================================================

export function isAwaitingAnswers(state: BrainstormState | undefined): boolean {
  return state?.subPhase === "awaiting-answers";
}

export function isBrainstormMode(state: RalplanState | null): boolean {
  return state?.mode === "brainstorm";
}

export function shouldSuppressSignals(state: RalplanState | null): boolean {
  if (!state || state.mode !== "brainstorm") return false;
  const sub = state.brainstorm?.subPhase;
  return sub === "expanding" || sub === "awaiting-answers";
}

// ============================================================================
// FORMATTING & SANITIZATION
// ============================================================================

/** Sanitize user-provided content for safe prompt injection.
 *  Escapes triple backticks and known signal strings. */
export function sanitizeForPrompt(text: string): string {
  return text
    .replace(/```/g, "\\\u0060\\\u0060\\\u0060")
    .replace(/PIPELINE_RALPLAN_COMPLETE/g, "PIPELINE\\_RALPLAN\\_COMPLETE")
    .replace(/PIPELINE_EXECUTION_COMPLETE/g, "PIPELINE\\_EXECUTION\\_COMPLETE")
    .replace(/PIPELINE_RALPH_COMPLETE/g, "PIPELINE\\_RALPH\\_COMPLETE")
    .replace(/PIPELINE_QA_COMPLETE/g, "PIPELINE\\_QA\\_COMPLETE")
    .replace(/BRAINSTORM_OPEN_QUESTIONS_READY/g, "BRAINSTORM\\_OPEN\\_QUESTIONS\\_READY");
}

/** Format Q+A pairs as markdown for prompt injection */
export function formatAnswersForPrompt(answers: QandA[]): string {
  if (answers.length === 0) return "";
  const lines = ["### Answered Questions", ""];
  for (const qa of answers) {
    lines.push(`**Q:** ${qa.question}`);
    lines.push(`**A:** ${sanitizeForPrompt(qa.answer)}`);
    lines.push("");
  }
  return lines.join("\n");
}

// ============================================================================
// PARSING
// ============================================================================

/** Parse open questions from markdown content.
 *  Uses getSectionContent from artifacts.ts.
 *  Returns empty array on failure (graceful degradation). */
export function parseOpenQuestions(markdown: string): string[] {
  try {
    const section = getSectionContent(markdown, "Open Questions");
    if (!section) return [];

    const questions: string[] = [];
    const lines = section.split("\n");
    for (const line of lines) {
      const match = line.match(/^-\s*\[?\s*\]?\s*\*{0,2}([^*]+)\*{0,2}\s*$/);
      if (match && match[1].trim()) {
        questions.push(match[1].trim());
      }
      // Also match numbered list items
      const numMatch = line.match(/^\d+\.\s+(.+)/);
      if (numMatch && numMatch[1].trim()) {
        questions.push(numMatch[1].trim());
      }
    }
    return questions;
  } catch {
    return [];
  }
}

/** Parse raw user text into a Q+A entry.
 *  Maps text to known questions if possible, otherwise stores as freeform. */
export function parseUserAnswer(rawText: string, questions: string[]): QandA {
  // If there's exactly one unanswered question, map to it
  if (questions.length === 1) {
    return { question: questions[0], answer: rawText };
  }
  // Otherwise, store as freeform
  return { question: "[freeform]", answer: rawText };
}

// ============================================================================
// COMMAND HELPERS
// ============================================================================

/** Skip questions — works from both expanding and awaiting-answers sub-phases */
export function skipQuestions(state: BrainstormState): BrainstormState {
  return {
    ...transitionSubPhase(state, "planning"),
    answers: [
      ...state.answers,
      {
        question: "[SKIP]",
        answer: "User skipped open questions. Proceeding with best-effort planning.",
      },
    ],
  };
}

/** Done answering — transitions from awaiting-answers to planning */
export function doneAnswering(state: BrainstormState): BrainstormState {
  return transitionSubPhase(state, "planning");
}

// ============================================================================
// EXTRACTED EVENT HANDLER LOGIC (for testability)
// ============================================================================

export interface BrainstormAgentEndResult {
  action: "suppress" | "transition-to-awaiting" | "transition-to-planning" | "advance";
  questions?: string[];
  error?: string;
}

/** Process an agent_end event during brainstorm mode.
 *  Returns instruction for the handler to execute. */
export function processBrainstormAgentEnd(
  state: RalplanState,
  lastText: string,
  openQuestionsContent: string | null,
  detectBrainstormSignalFn: (text: string, signal: string) => boolean,
  detectSignalFn: (text: string, stageId: string) => boolean,
): BrainstormAgentEndResult {
  const sub = state.brainstorm?.subPhase;

  // expanding: suppress pipeline signals, check for OPEN_QUESTIONS_READY
  if (sub === "expanding") {
    if (detectSignalFn(lastText, "ralplan")) {
      return { action: "suppress" };
    }
    if (detectBrainstormSignalFn(lastText, "BRAINSTORM_OPEN_QUESTIONS_READY")) {
      let questions: string[] = [];
      if (openQuestionsContent) {
        questions = parseOpenQuestions(openQuestionsContent);
      }
      if (questions.length === 0) {
        return { action: "transition-to-planning", error: "No open questions found. Proceeding directly to planning." };
      }
      return { action: "transition-to-awaiting", questions };
    }
    return { action: "suppress" };
  }

  // awaiting-answers: total signal suppression
  if (sub === "awaiting-answers") {
    return { action: "suppress" };
  }

  // planning: allow normal pipeline advancement
  if (sub === "planning") {
    if (detectSignalFn(lastText, "ralplan")) {
      return { action: "advance" };
    }
  }

  return { action: "suppress" };
}

export interface BrainstormInputResult {
  appendAnswer: QandA;
  suppressGate: boolean;
}

/** Process an input event during brainstorm awaiting-answers */
export function processBrainstormInput(
  state: RalplanState,
  rawText: string,
): BrainstormInputResult {
  const questions = state.brainstorm?.questions ?? [];
  return {
    appendAnswer: parseUserAnswer(rawText.trim(), questions),
    suppressGate: true,
  };
}