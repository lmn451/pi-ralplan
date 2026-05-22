import { describe, it, expect } from "vitest";
import { createADR, type ADREntry } from "../pi/extensions/ralplan/adr.js";

describe("adr.ts", () => {
  describe("createADR()", () => {
    it("should create empty ADR", () => {
      const adr = createADR();
      expect(adr.entries).toEqual([]);
    });

    it("should add entries with auto-generated ID and timestamp", () => {
      const adr = createADR();
      const entry = adr.addEntry({
        type: "open-question",
        title: "Test Question",
        description: "Is this a test?",
        status: "pending",
      });

      expect(entry.id).toMatch(/^ADR-[a-f0-9]+$/);
      expect(entry.timestamp).toBeDefined();
      expect(entry.status).toBe("pending");
    });

    it("should approve entries", () => {
      const adr = createADR();
      const entry = adr.addEntry({
        type: "open-question",
        title: "Test Question",
        description: "Is this a test?",
        status: "pending",
      });

      adr.approve(entry.id, "test-author");

      const updated = adr.entries.find((e) => e.id === entry.id);
      expect(updated?.status).toBe("approved");
      expect(updated?.author).toBe("test-author");
    });

    it("should approve entries with reason", () => {
      const adr = createADR();
      const entry = adr.addEntry({
        type: "open-question",
        title: "Test Question",
        description: "Is this a test?",
        status: "pending",
      });

      adr.approve(entry.id, "test-author", "Looks good");

      const updated = adr.entries.find((e) => e.id === entry.id);
      expect(updated?.status).toBe("approved");
      expect(updated?.reason).toBe("Looks good");
    });

    it("should reject entries with reason", () => {
      const adr = createADR();
      const entry = adr.addEntry({
        type: "decision",
        title: "Test Decision",
        description: "Make a decision",
        status: "pending",
      });

      adr.reject(entry.id, "critic", "Not a good idea");

      const updated = adr.entries.find((e) => e.id === entry.id);
      expect(updated?.status).toBe("rejected");
      expect(updated?.reason).toBe("Not a good idea");
    });

    it("should throw on approve/reject for non-existent ID", () => {
      const adr = createADR();
      expect(() => adr.approve("non-existent-id", "author")).toThrow();
      expect(() => adr.reject("non-existent-id", "author", "reason")).toThrow();
    });

    it("should throw when approving already-rejected entry", () => {
      const adr = createADR();
      const entry = adr.addEntry({
        type: "decision",
        title: "Test Decision",
        description: "Make a decision",
        status: "pending",
      });

      adr.reject(entry.id, "critic", "Not a good idea");
      expect(() => adr.approve(entry.id, "author")).toThrow(
        "Cannot approve already-rejected entry",
      );
    });

    it("should throw when rejecting already-approved entry", () => {
      const adr = createADR();
      const entry = adr.addEntry({
        type: "decision",
        title: "Test Decision",
        description: "Make a decision",
        status: "pending",
      });

      adr.approve(entry.id, "author");
      expect(() => adr.reject(entry.id, "critic", "changed my mind")).toThrow(
        "Cannot reject already-approved entry",
      );
    });
  });

  describe("toMarkdown()", () => {
    it("should render empty ADR", () => {
      const adr = createADR();
      const md = adr.toMarkdown();
      expect(md).toContain("## Architecture Decision Record");
    });

    it("should render open questions section", () => {
      const adr = createADR();
      adr.addEntry({
        type: "open-question",
        title: "Q1",
        description: "Test question",
        status: "pending",
      });

      const md = adr.toMarkdown();
      expect(md).toContain("### Open Questions");
      expect(md).toContain("[ ] **Q1**");
    });

    it("should render answered questions with check", () => {
      const adr = createADR();
      const entry = adr.addEntry({
        type: "open-question",
        title: "Q1",
        description: "Test question",
        status: "pending",
      });
      adr.approve(entry.id, "analyst");

      const md = adr.toMarkdown();
      expect(md).toContain("[x] **Q1**");
    });

    it("should render decisions section", () => {
      const adr = createADR();
      adr.addEntry({
        type: "decision",
        title: "D1",
        description: "Use TypeScript",
        status: "approved",
      });

      const md = adr.toMarkdown();
      expect(md).toContain("### Decisions");
      expect(md).toContain("**D1** — Use TypeScript [approved]");
    });

    it("should render approvals section", () => {
      const adr = createADR();
      adr.addEntry({
        type: "approval",
        title: "Approve Plan",
        description: "Plan approved",
        status: "approved",
        author: "architect",
      });

      const md = adr.toMarkdown();
      expect(md).toContain("### Approvals");
      expect(md).toContain("✓ **Approve Plan** by architect");
    });

    it("should render approvals section with reason", () => {
      const adr = createADR();
      adr.addEntry({
        type: "approval",
        title: "Approve Plan",
        description: "Plan approved",
        status: "pending",
      });

      const entry = adr.entries[0];
      adr.approve(entry.id, "architect", "LGTM");

      const md = adr.toMarkdown();
      expect(md).toContain("### Approvals");
      expect(md).toContain("by architect — LGTM");
    });

    it("should render rejections section", () => {
      const adr = createADR();
      adr.addEntry({
        type: "rejection",
        title: "Reject Option",
        description: "Option rejected",
        status: "rejected",
        author: "critic",
        reason: "Too complex",
      });

      const md = adr.toMarkdown();
      expect(md).toContain("### Rejections");
      expect(md).toContain("✗ **Reject Option** by critic: Too complex");
    });

    it("should not render empty sections", () => {
      const adr = createADR();
      adr.addEntry({
        type: "decision",
        title: "D1",
        description: "Only a decision",
        status: "approved",
      });

      const md = adr.toMarkdown();
      expect(md).not.toContain("### Open Questions");
      expect(md).not.toContain("### Approvals");
    });
  });

  describe("entry types", () => {
    it("should support all entry types", () => {
      const adr = createADR();

      const q = adr.addEntry({
        type: "open-question",
        title: "Question",
        description: "Q",
        status: "pending",
      });

      const d = adr.addEntry({
        type: "decision",
        title: "Decision",
        description: "D",
        status: "pending",
      });

      const a = adr.addEntry({
        type: "approval",
        title: "Approval",
        description: "A",
        status: "approved",
      });

      const r = adr.addEntry({
        type: "rejection",
        title: "Rejection",
        description: "R",
        status: "rejected",
      });

      expect(adr.entries).toHaveLength(4);
      expect(adr.entries.find((e) => e.id === q.id)?.type).toBe(
        "open-question",
      );
      expect(adr.entries.find((e) => e.id === d.id)?.type).toBe("decision");
      expect(adr.entries.find((e) => e.id === a.id)?.type).toBe("approval");
      expect(adr.entries.find((e) => e.id === r.id)?.type).toBe("rejection");
    });
  });

  describe("new entry types (plan-iteration, tradeoff, critic-review, architect-review)", () => {
    it("should support plan-iteration with iteration number", () => {
      const adr = createADR();
      adr.addEntry({
        type: "plan-iteration",
        title: "Initial Plan Draft",
        description: "First iteration through architect review",
        status: "pending",
        iteration: 1,
      });

      const md = adr.toMarkdown();
      expect(md).toContain("### Plan Iterations");
      expect(md).toContain("**Iteration 1**: Initial Plan Draft");
    });

    it("should support tradeoff with options and alternatives", () => {
      const adr = createADR();
      adr.addEntry({
        type: "tradeoff",
        title: "Database Selection",
        description: "Chose PostgreSQL for ACID compliance",
        status: "approved",
        tradeoffs: ["PostgreSQL", "MongoDB", "Redis"],
        alternatives: [
          "MongoDB - Rejected due to no joins",
          "Redis - Rejected due to persistence requirements",
        ],
      });

      const md = adr.toMarkdown();
      expect(md).toContain("### Tradeoffs Discussed");
      expect(md).toContain("PostgreSQL");
      expect(md).toContain("MongoDB");
      expect(md).toContain("✗ MongoDB - Rejected");
    });

    it("should support critic-review with feedback", () => {
      const adr = createADR();
      adr.addEntry({
        type: "critic-review",
        title: "Plan Review Iteration 2",
        description: "Critic identified missing error handling",
        status: "rejected",
        feedback:
          "Missing error handling for network failures. Task 5 lacks validation.",
      });

      const md = adr.toMarkdown();
      expect(md).toContain("### Critic Reviews");
      expect(md).toContain("Feedback: Missing error handling");
    });

    it("should support architect-review with feedback", () => {
      const adr = createADR();
      adr.addEntry({
        type: "architect-review",
        title: "Architecture Review",
        description: "Technical feasibility check",
        status: "approved",
        feedback: "Design looks solid. Consider caching layer for performance.",
      });

      const md = adr.toMarkdown();
      expect(md).toContain("### Architect Reviews");
      expect(md).toContain("Design looks solid");
    });
  });
});
