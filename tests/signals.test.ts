import { describe, it, expect } from "vitest";
import { detectSignal, getExpectedSignal, getLastAssistantText } from "../pi/extensions/ralplan/signals.js";

describe("detectSignal", () => {
  it("detects ralplan completion signal", () => {
    expect(detectSignal("Done! PIPELINE_RALPLAN_COMPLETE", "ralplan")).toBe(true);
    expect(detectSignal("Done!", "ralplan")).toBe(false);
  });

  it("detects execution completion signal", () => {
    expect(detectSignal("All tasks done. PIPELINE_EXECUTION_COMPLETE", "execution")).toBe(true);
    expect(detectSignal("Still working...", "execution")).toBe(false);
  });

  it("detects ralph completion signal", () => {
    expect(detectSignal("Approved. PIPELINE_RALPH_COMPLETE", "ralph")).toBe(true);
  });

  it("detects qa completion signal", () => {
    expect(detectSignal("Tests pass. PIPELINE_QA_COMPLETE", "qa")).toBe(true);
  });
});

describe("getExpectedSignal", () => {
  it("returns correct signals", () => {
    expect(getExpectedSignal("ralplan")).toBe("PIPELINE_RALPLAN_COMPLETE");
    expect(getExpectedSignal("execution")).toBe("PIPELINE_EXECUTION_COMPLETE");
    expect(getExpectedSignal("ralph")).toBe("PIPELINE_RALPH_COMPLETE");
    expect(getExpectedSignal("qa")).toBe("PIPELINE_QA_COMPLETE");
  });

  it("returns null for unknown stage", () => {
    expect(getExpectedSignal("unknown" as any)).toBeNull();
  });
});

describe("getLastAssistantText", () => {
  it("extracts string content", () => {
    const messages = [
      { role: "user", content: "hello" },
      { role: "assistant", content: "world" },
    ];
    expect(getLastAssistantText(messages)).toBe("world");
  });

  it("extracts text from array content", () => {
    const messages = [
      { role: "user", content: "hello" },
      { role: "assistant", content: [{ type: "text", text: "foo" }, { type: "text", text: "bar" }] },
    ];
    expect(getLastAssistantText(messages)).toBe("foo\nbar");
  });

  it("skips non-text blocks", () => {
    const messages = [
      {
        role: "assistant",
        content: [{ type: "tool_use", name: "bash" }, { type: "text", text: "result" }],
      },
    ];
    expect(getLastAssistantText(messages)).toBe("result");
  });

  it("returns null when no assistant message", () => {
    const messages = [{ role: "user", content: "hello" }];
    expect(getLastAssistantText(messages)).toBeNull();
  });

  it("returns null for empty messages", () => {
    expect(getLastAssistantText([])).toBeNull();
  });
});
