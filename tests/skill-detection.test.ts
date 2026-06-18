import { describe, it, expect } from "vitest";

describe("detectRalplanSkillUsage", () => {
  // We test the logic directly since it's a private function. The actual
  // integration is tested via extension-commands.test.ts. Keep this copy in
  // lockstep with the production function in pi/extensions/ralplan/index.ts.
  //
  // RULE: ONLY slash-command forms (/ralplan, /brainstorm) trigger
  // auto-start. Anything else returns null so the planner/architect/critic
  // role prompts (which all mention "ralplan" naturally) don't spin up a
  // fresh pipeline for each consensus round.
  function detectRalplanSkillUsage(
    prompt: string,
  ): "ralplan" | "brainstorm" | null {
    const lower = prompt.trim().toLowerCase();
    if (!lower) return null;

    if (/^\/ralplan\b/.test(lower)) {
      return /\bbrainstorm\b/.test(lower) ? "brainstorm" : "ralplan";
    }
    if (/^\/brainstorm\b/.test(lower)) {
      return "brainstorm";
    }

    return null;
  }

  describe("slash-command form (SHOULD trigger)", () => {
    it("detects bare /ralplan", () => {
      expect(detectRalplanSkillUsage("/ralplan")).toBe("ralplan");
    });

    it("detects /ralplan with payload", () => {
      expect(detectRalplanSkillUsage("/ralplan build me auth flow")).toBe(
        "ralplan",
      );
      expect(detectRalplanSkillUsage("/ralplan: add caching")).toBe("ralplan");
      expect(detectRalplanSkillUsage("/ralplan - do the refactor")).toBe(
        "ralplan",
      );
    });

    it("detects /ralplan brainstorm as brainstorm mode", () => {
      expect(detectRalplanSkillUsage("/ralplan brainstorm")).toBe("brainstorm");
      expect(detectRalplanSkillUsage("/ralplan brainstorm my idea")).toBe(
        "brainstorm",
      );
    });

    it("detects /brainstorm", () => {
      expect(detectRalplanSkillUsage("/brainstorm")).toBe("brainstorm");
      expect(detectRalplanSkillUsage("/brainstorm my idea")).toBe("brainstorm");
    });

    it("is case-insensitive on the slash command", () => {
      expect(detectRalplanSkillUsage("/RALPLAN")).toBe("ralplan");
      expect(detectRalplanSkillUsage("/Brainstorm")).toBe("brainstorm");
    });
  });

  // Regression: each of these previously triggered a fresh pipeline because
  // the bare-substring check matched on "ralplan", "architect review",
  // "critic review", or `plans/...` path mentions inside role prompts and
  // file references. The fix is slash-only — NONE of these may trigger.
  describe("non-slash inputs (MUST NOT trigger)", () => {
    it("does not trigger on bare 'ralplan' or 'RALPLAN'", () => {
      expect(detectRalplanSkillUsage("ralplan")).toBe(null);
      expect(detectRalplanSkillUsage("RALPLAN")).toBe(null);
      expect(detectRalplanSkillUsage("Ralplan")).toBe(null);
    });

    it("does not trigger on directive phrasing without a slash", () => {
      expect(detectRalplanSkillUsage("use ralplan to plan this")).toBe(null);
      expect(detectRalplanSkillUsage("start ralplan for auth flow")).toBe(null);
      expect(detectRalplanSkillUsage("run ralplan")).toBe(null);
      expect(detectRalplanSkillUsage("begin ralplan")).toBe(null);
      expect(detectRalplanSkillUsage("trigger ralplan")).toBe(null);
      expect(detectRalplanSkillUsage("kickoff ralplan")).toBe(null);
      expect(detectRalplanSkillUsage("invoke ralplan")).toBe(null);
      expect(detectRalplanSkillUsage("apply ralplan")).toBe(null);
      expect(detectRalplanSkillUsage("make ralplan")).toBe(null);
      expect(detectRalplanSkillUsage("do ralplan")).toBe(null);
    });

    it("does not trigger on start-of-prompt directive without a slash", () => {
      expect(detectRalplanSkillUsage("ralplan: build auth flow")).toBe(null);
      expect(detectRalplanSkillUsage("ralplan - add caching")).toBe(null);
      expect(detectRalplanSkillUsage("ralplan do the refactor")).toBe(null);
      expect(detectRalplanSkillUsage("brainstorm with ralplan")).toBe(null);
    });

    it("does not trigger on the architect role prompt", () => {
      const prompt =
        "You are the Architect. Review the ralplan consensus plan and provide feedback.";
      expect(detectRalplanSkillUsage(prompt)).toBe(null);
    });

    it("does not trigger on the critic role prompt", () => {
      const prompt =
        "You are the Critic. Review the ralplan-DR plan for gaps and reject weak decisions.";
      expect(detectRalplanSkillUsage(prompt)).toBe(null);
    });

    it("does not trigger on the planner role prompt", () => {
      const prompt =
        "You are Planner. Your mission is to produce a ralplan consensus plan via structured consultation.";
      expect(detectRalplanSkillUsage(prompt)).toBe(null);
    });

    it("does not trigger on 'architect review' alone", () => {
      expect(detectRalplanSkillUsage("need architect review")).toBe(null);
      expect(detectRalplanSkillUsage("awaiting critic review")).toBe(null);
    });

    it("does not trigger on consensus-planning phrasing alone", () => {
      expect(detectRalplanSkillUsage("use consensus planning")).toBe(null);
      expect(detectRalplanSkillUsage("CONSENSUS PLANNING")).toBe(null);
    });

    it("does not trigger on plan artifact path mentions", () => {
      expect(
        detectRalplanSkillUsage("look at plans/drafts/plan_draft.md"),
      ).toBe(null);
      expect(detectRalplanSkillUsage("read plans/spec.md")).toBe(null);
      expect(detectRalplanSkillUsage("update plans/plan.md")).toBe(null);
      expect(detectRalplanSkillUsage("the plan.md file")).toBe(null);
    });

    it("does not trigger on bare 'brainstorm' embedded mid-sentence", () => {
      expect(detectRalplanSkillUsage("let's brainstorm about this")).toBe(null);
      expect(detectRalplanSkillUsage("use brainstorm mode")).toBe(null);
    });
  });

  describe("non-ralplan prompts (regression)", () => {
    it("returns null for regular prompts", () => {
      expect(detectRalplanSkillUsage("hello world")).toBe(null);
      expect(detectRalplanSkillUsage("write a function")).toBe(null);
      expect(detectRalplanSkillUsage("fix the bug")).toBe(null);
    });

    it("does not trigger on unrelated 'plan' mentions", () => {
      expect(detectRalplanSkillUsage("plan a party")).toBe(null);
      expect(detectRalplanSkillUsage("plan for the weekend")).toBe(null);
    });

    it("returns null for empty/whitespace prompts", () => {
      expect(detectRalplanSkillUsage("")).toBe(null);
      expect(detectRalplanSkillUsage("   \n\t  ")).toBe(null);
    });
  });
});
