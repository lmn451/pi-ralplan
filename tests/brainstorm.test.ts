import { describe, it, expect } from "bun:test";
import {
  createBrainstormState,
  transitionSubPhase,
  appendAnswer,
  withQuestions,
  isAwaitingAnswers,
  isBrainstormMode,
  shouldSuppressSignals,
  formatAnswersForPrompt,
  parseOpenQuestions,
  parseUserAnswer,
  sanitizeForPrompt,
  skipQuestions,
  doneAnswering,
  processBrainstormAgentEnd,
  processBrainstormInput,
  type BrainstormState,
  type BrainstormSubPhase,
} from "../pi/extensions/ralplan/brainstorm.js";
import {
  detectBrainstormSignal,
  BRAINSTORM_OPEN_QUESTIONS_READY,
} from "../pi/extensions/ralplan/signals.js";
import type { RalplanState } from "../pi/extensions/ralplan/state.js";
import { buildPipelineTracking, DEFAULT_PIPELINE_CONFIG } from "../pi/extensions/ralplan/pipeline.js";

describe("createBrainstormState", () => {
  it("returns correct default state", () => {
    const state = createBrainstormState();
    expect(state.subPhase).toBe("expanding");
    expect(state.questions).toEqual([]);
    expect(state.answers).toEqual([]);
    expect(state.awaitingSince).toBeUndefined();
  });
});

describe("transitionSubPhase", () => {
  it("transitions between sub-phases", () => {
    const state = createBrainstormState();
    const awaiting = transitionSubPhase(state, "awaiting-answers");
    expect(awaiting.subPhase).toBe("awaiting-answers");
    expect(awaiting.awaitingSince).toBeDefined();
  });

  it("returns new object (immutability)", () => {
    const state = createBrainstormState();
    const result = transitionSubPhase(state, "planning");
    expect(state.subPhase).toBe("expanding"); // original unchanged
    expect(result.subPhase).toBe("planning");
  });
});

describe("appendAnswer", () => {
  it("appends an answer", () => {
    const state = createBrainstormState();
    const result = appendAnswer(state, "What architecture?", "Microservices");
    expect(result.answers).toHaveLength(1);
    expect(result.answers[0]).toEqual({ question: "What architecture?", answer: "Microservices" });
  });

  it("returns new object (immutability)", () => {
    const state = createBrainstormState();
    const result = appendAnswer(state, "Q1", "A1");
    expect(state.answers).toHaveLength(0); // original unchanged
    expect(result.answers).toHaveLength(1);
  });
});

describe("withQuestions", () => {
  it("sets questions", () => {
    const state = createBrainstormState();
    const result = withQuestions(state, ["Q1", "Q2"]);
    expect(result.questions).toEqual(["Q1", "Q2"]);
    expect(state.questions).toEqual([]); // original unchanged
  });
});

describe("formatAnswersForPrompt", () => {
  it("returns empty string for empty answers", () => {
    expect(formatAnswersForPrompt([])).toBe("");
  });

  it("formats Q&A pairs as markdown", () => {
    const result = formatAnswersForPrompt([
      { question: "What architecture?", answer: "Microservices" },
    ]);
    expect(result).toContain("Answered Questions");
    expect(result).toContain("What architecture?");
    expect(result).toContain("Microservices");
  });
});

describe("isAwaitingAnswers", () => {
  it("returns true for awaiting-answers", () => {
    const state = transitionSubPhase(createBrainstormState(), "awaiting-answers");
    expect(isAwaitingAnswers(state)).toBe(true);
  });

  it("returns false for other sub-phases", () => {
    expect(isAwaitingAnswers(createBrainstormState())).toBe(false);
    expect(isAwaitingAnswers(undefined)).toBe(false);
  });
});

describe("shouldSuppressSignals", () => {
  it("returns true for expanding and awaiting-answers", () => {
    const pipeline = buildPipelineTracking(DEFAULT_PIPELINE_CONFIG);
    const ralplanState: RalplanState = {
      version: 2,
      active: true,
      mode: "brainstorm",
      pipeline,
      originalIdea: "test",
      startedAt: new Date().toISOString(),
      brainstorm: createBrainstormState(),
    };
    expect(shouldSuppressSignals(ralplanState)).toBe(true); // expanding

    ralplanState.brainstorm = transitionSubPhase(ralplanState.brainstorm!, "awaiting-answers");
    expect(shouldSuppressSignals(ralplanState)).toBe(true); // awaiting-answers
  });

  it("returns false for planning sub-phase", () => {
    const pipeline = buildPipelineTracking(DEFAULT_PIPELINE_CONFIG);
    const state: RalplanState = {
      version: 2,
      active: true,
      mode: "brainstorm",
      pipeline,
      originalIdea: "test",
      startedAt: new Date().toISOString(),
      brainstorm: transitionSubPhase(createBrainstormState(), "planning"),
    };
    expect(shouldSuppressSignals(state)).toBe(false);
  });

  it("returns false for ralplan mode", () => {
    const pipeline = buildPipelineTracking(DEFAULT_PIPELINE_CONFIG);
    const state: RalplanState = {
      version: 2,
      active: true,
      mode: "ralplan",
      pipeline,
      originalIdea: "test",
      startedAt: new Date().toISOString(),
    };
    expect(shouldSuppressSignals(state)).toBe(false);
  });

  it("returns false for null state", () => {
    expect(shouldSuppressSignals(null)).toBe(false);
  });
});

describe("parseOpenQuestions", () => {
  it("extracts questions from markdown", () => {
    const md = `## Something\n\nSome text\n\n## Open Questions\n\n- What is the architecture?\n- How should we handle errors?\n\n## Other section`;
    const questions = parseOpenQuestions(md);
    expect(questions.length).toBeGreaterThanOrEqual(2);
    expect(questions).toContain("What is the architecture?");
  });

  it("extracts questions from the brainstorm prompt format", () => {
    const md = `## Open Questions — 2026-04-26\n\n- [ ] **Q:** What is the architecture?\n  **Why:** This blocks planning.\n- [ ] **Q:** How should we handle errors?\n  **Why:** This affects the API shape.`;
    expect(parseOpenQuestions(md)).toEqual([
      "What is the architecture?",
      "How should we handle errors?",
    ]);
  });

  it("extracts questions from brainstorm mode headings with a prefixed topic", () => {
    const md = `## Brainstorm Mode - Open Questions - 2026-04-26\n\n- [ ] Synchronous ask_user tool vs. async chat replies? — Drives architecture`;
    expect(parseOpenQuestions(md)).toEqual([
      "Synchronous ask_user tool vs. async chat replies?",
    ]);
  });

  it("returns empty array for missing section", () => {
    const md = "No questions here";
    expect(parseOpenQuestions(md)).toEqual([]);
  });

  it("returns empty array on malformed input", () => {
    expect(parseOpenQuestions("")).toEqual([]);
    expect(parseOpenQuestions(null as unknown as string)).toEqual([]);
  });
});

describe("parseUserAnswer", () => {
  it("maps to single question", () => {
    const result = parseUserAnswer("Microservices", ["What architecture?"]);
    expect(result.question).toBe("What architecture?");
    expect(result.answer).toBe("Microservices");
  });

  it("stores as freeform for multiple questions", () => {
    const result = parseUserAnswer("Some answer", ["Q1", "Q2"]);
    expect(result.question).toBe("[freeform]");
    expect(result.answer).toBe("Some answer");
  });
});

describe("skipQuestions", () => {
  it("transitions from expanding to planning", () => {
    const state = createBrainstormState();
    const result = skipQuestions(state);
    expect(result.subPhase).toBe("planning");
    expect(result.answers).toHaveLength(1);
    expect(result.answers[0].question).toBe("[SKIP]");
  });

  it("transitions from awaiting-answers to planning", () => {
    const state = transitionSubPhase(createBrainstormState(), "awaiting-answers");
    const result = skipQuestions(state);
    expect(result.subPhase).toBe("planning");
    expect(result.answers).toHaveLength(1);
  });
});

describe("doneAnswering", () => {
  it("transitions from awaiting-answers to planning", () => {
    const state = transitionSubPhase(createBrainstormState(), "awaiting-answers");
    const result = doneAnswering(state);
    expect(result.subPhase).toBe("planning");
  });
});

describe("detectBrainstormSignal", () => {
  it("detects OPEN_QUESTIONS_READY signal", () => {
    expect(detectBrainstormSignal("Some text BRAINSTORM_OPEN_QUESTIONS_READY more text", BRAINSTORM_OPEN_QUESTIONS_READY)).toBe(true);
  });

  it("returns false for absent signal", () => {
    expect(detectBrainstormSignal("Some text without the signal", BRAINSTORM_OPEN_QUESTIONS_READY)).toBe(false);
  });
});
describe("sanitizeForPrompt", () => {
  it("escapes triple backticks", () => {
    expect(sanitizeForPrompt("```code```")).toBe("\\`\\`\\`code\\`\\`\\`");
  });

  it("escapes PIPELINE_RALPLAN_COMPLETE", () => {
    const result = sanitizeForPrompt("done PIPELINE_RALPLAN_COMPLETE");
    expect(result).not.toContain("PIPELINE_RALPLAN_COMPLETE");
    expect(result).toContain("PIPELINE\\_RALPLAN\\_COMPLETE");
  });

  it("escapes BRAINSTORM_OPEN_QUESTIONS_READY", () => {
    const result = sanitizeForPrompt("got BRAINSTORM_OPEN_QUESTIONS_READY");
    expect(result).not.toContain("BRAINSTORM_OPEN_QUESTIONS_READY");
    expect(result).toContain("BRAINSTORM\\_OPEN\\_QUESTIONS\\_READY");
  });

  it("leaves normal text unchanged", () => {
    expect(sanitizeForPrompt("hello world")).toBe("hello world");
  });
});

describe("processBrainstormAgentEnd", () => {
  const noOpDetectBrainstorm = (_t: string, _s: string) => false;
  const noOpDetectSignal = (_t: string, _s: string) => false;

  function makeState(subPhase: BrainstormSubPhase): RalplanState {
    return {
      version: 2,
      active: true,
      mode: "brainstorm",
      pipeline: buildPipelineTracking(DEFAULT_PIPELINE_CONFIG),
      originalIdea: "test",
      startedAt: new Date().toISOString(),
      brainstorm: { subPhase, questions: [], answers: [] },
    };
  }

  it("suppresses signals in expanding sub-phase", () => {
    const state = makeState("expanding");
    const result = processBrainstormAgentEnd(state, "some text", null, noOpDetectBrainstorm, noOpDetectSignal);
    expect(result.action).toBe("suppress");
  });

  it("suppresses signals in awaiting-answers sub-phase", () => {
    const state = makeState("awaiting-answers");
    const result = processBrainstormAgentEnd(state, "some text", null, noOpDetectBrainstorm, noOpDetectSignal);
    expect(result.action).toBe("suppress");
  });

  it("detects OPEN_QUESTIONS_READY in expanding", () => {
    const state = makeState("expanding");
    const detectBrainstorm = (t: string, s: string) => t.includes(s);
    const result = processBrainstormAgentEnd(
      state,
      "done BRAINSTORM_OPEN_QUESTIONS_READY",
      "## Open Questions\n- What architecture?",
      detectBrainstorm,
      noOpDetectSignal,
    );
    expect(result.action).toBe("transition-to-awaiting");
    expect(result.questions).toHaveLength(1);
  });

  it("auto-transitions to planning on empty questions", () => {
    const state = makeState("expanding");
    const detectBrainstorm = (t: string, s: string) => t.includes(s);
    const result = processBrainstormAgentEnd(
      state,
      "done BRAINSTORM_OPEN_QUESTIONS_READY",
      "",  // empty questions content
      detectBrainstorm,
      noOpDetectSignal,
    );
    expect(result.action).toBe("transition-to-planning");
    expect(result.error).toBeDefined();
  });

  it("allows PIPELINE_RALPLAN_COMPLETE in planning sub-phase", () => {
    const state = makeState("planning");
    const detectSignal = (_t: string, _s: string) => true;  // simulate detection
    const result = processBrainstormAgentEnd(
      state,
      "done PIPELINE_RALPLAN_COMPLETE",
      null,
      noOpDetectBrainstorm,
      detectSignal,
    );
    expect(result.action).toBe("advance");
  });

  it("suppresses PIPELINE_RALPLAN_COMPLETE in expanding", () => {
    const state = makeState("expanding");
    const detectSignal = (_t: string, _s: string) => true;  // simulate detection
    const result = processBrainstormAgentEnd(
      state,
      "done PIPELINE_RALPLAN_COMPLETE",
      null,
      noOpDetectBrainstorm,
      detectSignal,
    );
    expect(result.action).toBe("suppress");
  });
});

describe("processBrainstormInput", () => {
  it("returns freeform answer for multiple questions", () => {
    const state: RalplanState = {
      version: 2,
      active: true,
      mode: "brainstorm",
      pipeline: buildPipelineTracking(DEFAULT_PIPELINE_CONFIG),
      originalIdea: "test",
      startedAt: new Date().toISOString(),
      brainstorm: {
        subPhase: "awaiting-answers",
        questions: ["Q1", "Q2"],
        answers: [],
      },
    };
    const result = processBrainstormInput(state, "my answer");
    expect(result.appendAnswer.question).toBe("[freeform]");
    expect(result.appendAnswer.answer).toBe("my answer");
    expect(result.suppressGate).toBe(true);
  });

  it("maps to single question", () => {
    const state: RalplanState = {
      version: 2,
      active: true,
      mode: "brainstorm",
      pipeline: buildPipelineTracking(DEFAULT_PIPELINE_CONFIG),
      originalIdea: "test",
      startedAt: new Date().toISOString(),
      brainstorm: {
        subPhase: "awaiting-answers",
        questions: ["What architecture?"],
        answers: [],
      },
    };
    const result = processBrainstormInput(state, "microservices");
    expect(result.appendAnswer.question).toBe("What architecture?");
    expect(result.appendAnswer.answer).toBe("microservices");
  });
});
