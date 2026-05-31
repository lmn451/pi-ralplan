import { describe, it, expect } from "vitest";

describe("detectRalplanSkillUsage", () => {
  // We test the logic directly since it's a private function
  // The actual integration is tested via extension-commands.test.ts

  function detectRalplanSkillUsage(
    prompt: string,
  ): "ralplan" | "brainstorm" | null {
    const lower = prompt.toLowerCase();

    // Explicit skill invocations
    if (lower.includes("ralplan") || lower.includes("/ralplan")) {
      // Check if it's brainstorm specifically
      if (lower.includes("brainstorm")) return "brainstorm";
      return "ralplan";
    }

    // Standalone brainstorm keyword (RALPLAN brainstorm mode)
    if (lower.includes("brainstorm")) {
      return "brainstorm";
    }

    // Consensus planning keywords
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

    // Plan artifact paths
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

  describe("explicit skill invocations", () => {
    it("detects 'ralplan' keyword", () => {
      expect(detectRalplanSkillUsage("use ralplan to plan this")).toBe(
        "ralplan",
      );
      expect(detectRalplanSkillUsage("RALPLAN")).toBe("ralplan");
      expect(detectRalplanSkillUsage("Ralplan")).toBe("ralplan");
    });

    it("detects '/ralplan' command", () => {
      expect(detectRalplanSkillUsage("/ralplan")).toBe("ralplan");
      expect(detectRalplanSkillUsage("invoke /ralplan for planning")).toBe(
        "ralplan",
      );
    });

    it("detects 'brainstorm' keyword and returns brainstorm mode", () => {
      expect(detectRalplanSkillUsage("use ralplan brainstorm")).toBe(
        "brainstorm",
      );
      expect(detectRalplanSkillUsage("brainstorm with ralplan")).toBe(
        "brainstorm",
      );
      // "brainstorm mode" alone should trigger brainstorm (implicit RALPLAN)
      expect(detectRalplanSkillUsage("use brainstorm mode")).toBe("brainstorm");
    });
  });

  describe("consensus planning keywords", () => {
    it("detects 'consensus planning'", () => {
      expect(detectRalplanSkillUsage("use consensus planning")).toBe("ralplan");
      expect(detectRalplanSkillUsage("CONSENSUS PLANNING")).toBe("ralplan");
    });

    it("detects 'architect review'", () => {
      expect(detectRalplanSkillUsage("need architect review")).toBe("ralplan");
    });

    it("detects 'critic review'", () => {
      expect(detectRalplanSkillUsage("awaiting critic review")).toBe("ralplan");
    });

    it("detects planner + architect + critic together", () => {
      expect(detectRalplanSkillUsage("planner and architect and critic")).toBe(
        "ralplan",
      );
      expect(
        detectRalplanSkillUsage("the planner, architect, and critic roles"),
      ).toBe("ralplan");
    });

    it("does not trigger on partial role mentions", () => {
      expect(detectRalplanSkillUsage("planner and architect only")).toBe(null);
      expect(detectRalplanSkillUsage("just a planner")).toBe(null);
    });
  });

  describe("plan artifact paths", () => {
    it("detects plans/drafts/ path", () => {
      expect(
        detectRalplanSkillUsage("look at plans/drafts/plan_draft.md"),
      ).toBe("ralplan");
    });

    it("detects plans/spec path", () => {
      expect(detectRalplanSkillUsage("read plans/spec.md")).toBe("ralplan");
    });

    it("detects plans/plan path", () => {
      expect(detectRalplanSkillUsage("update plans/plan.md")).toBe("ralplan");
    });

    it("detects plan.md", () => {
      expect(detectRalplanSkillUsage("the plan.md file")).toBe("ralplan");
    });
  });

  describe("non-ralplan prompts", () => {
    it("returns null for regular prompts", () => {
      expect(detectRalplanSkillUsage("hello world")).toBe(null);
      expect(detectRalplanSkillUsage("write a function")).toBe(null);
      expect(detectRalplanSkillUsage("fix the bug")).toBe(null);
    });

    it("does not trigger on unrelated 'plan' mentions", () => {
      expect(detectRalplanSkillUsage("plan a party")).toBe(null);
      expect(detectRalplanSkillUsage("plan for the weekend")).toBe(null);
    });

    it("does not trigger on 'plans' without specific paths", () => {
      expect(detectRalplanSkillUsage("make plans")).toBe(null);
    });
  });
});
