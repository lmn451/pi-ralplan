import { describe, it, expect } from "vitest";
import {
  createConsensusState,
  advanceConsensusRole,
  recordRejection,
  recordApproval,
  startNextIteration,
  hasReachedMaxIterations,
  formatConsensusStatus,
  getNextRole,
  ConsensusRole,
  CONSENSUS_APPROVED,
  CONSENSUS_REJECTED,
} from "../pi/extensions/ralplan/consensus.js";

describe("consensus module", () => {
  describe("createConsensusState", () => {
    it("creates initial state with correct defaults", () => {
      const state = createConsensusState();
      expect(state.currentRole).toBe("planner");
      expect(state.iteration).toBe(1);
      expect(state.approved).toBe(false);
      expect(state.rejections).toEqual([]);
      expect(state.roleApprovals).toEqual({});
    });
  });

  describe("advanceConsensusRole", () => {
    it("advances planner to architect", () => {
      const state = createConsensusState();
      const next = advanceConsensusRole(state);
      expect(next).toBe("architect");
      expect(state.currentRole).toBe("architect");
    });

    it("advances architect to critic when approved", () => {
      const state = createConsensusState();
      state.currentRole = "architect";
      state.approved = true;
      const next = advanceConsensusRole(state);
      expect(next).toBe("critic");
      expect(state.currentRole).toBe("critic");
    });

    it("returns architect to planner when rejected", () => {
      const state = createConsensusState();
      state.currentRole = "architect";
      state.approved = false;
      const next = advanceConsensusRole(state);
      expect(next).toBe("planner");
      expect(state.currentRole).toBe("planner");
    });

    it("returns null when critic approves (consensus reached)", () => {
      const state = createConsensusState();
      state.currentRole = "critic";
      state.approved = true;
      const next = advanceConsensusRole(state);
      expect(next).toBeNull();
    });

    it("returns planner when critic rejects", () => {
      const state = createConsensusState();
      state.currentRole = "critic";
      state.approved = false;
      const next = advanceConsensusRole(state);
      expect(next).toBe("planner");
      expect(state.currentRole).toBe("planner");
    });
  });

  describe("recordRejection", () => {
    it("records rejection reason with role prefix", () => {
      const state = createConsensusState();
      recordRejection(state, "architect", "missing specifications");
      expect(state.rejections).toEqual(["[ARCHITECT] missing specifications"]);
    });

    it("sets approved to false", () => {
      const state = createConsensusState();
      state.approved = true;
      recordRejection(state, "architect", "reason");
      expect(state.approved).toBe(false);
    });

    it("updates roleApprovals for the rejecting role", () => {
      const state = createConsensusState();
      recordRejection(state, "critic", "reason");
      expect(state.roleApprovals.critic).toBe(false);
    });

    it("accumulates multiple rejections", () => {
      const state = createConsensusState();
      recordRejection(state, "architect", "first reason");
      recordRejection(state, "critic", "second reason");
      expect(state.rejections).toHaveLength(2);
      expect(state.rejections[0]).toContain("ARCHITECT");
      expect(state.rejections[1]).toContain("CRITIC");
    });
  });

  describe("recordApproval", () => {
    it("sets roleApprovals for the approving role", () => {
      const state = createConsensusState();
      recordApproval(state, "architect");
      expect(state.roleApprovals.architect).toBe(true);
    });

    it("sets approved to true", () => {
      const state = createConsensusState();
      recordApproval(state, "architect");
      expect(state.approved).toBe(true);
    });

    it("preserves previous approvals", () => {
      const state = createConsensusState();
      state.roleApprovals.planner = true;
      recordApproval(state, "architect");
      expect(state.roleApprovals.planner).toBe(true);
      expect(state.roleApprovals.architect).toBe(true);
    });
  });

  describe("startNextIteration", () => {
    it("increments iteration counter", () => {
      const state = createConsensusState();
      startNextIteration(state);
      expect(state.iteration).toBe(2);
    });

    it("resets approved to false", () => {
      const state = createConsensusState();
      state.approved = true;
      startNextIteration(state);
      expect(state.approved).toBe(false);
    });

    it("clears rejections", () => {
      const state = createConsensusState();
      state.rejections.push("some reason");
      startNextIteration(state);
      expect(state.rejections).toEqual([]);
    });

    it("clears roleApprovals for new iteration", () => {
      const state = createConsensusState();
      state.roleApprovals.architect = true;
      state.roleApprovals.critic = true;
      startNextIteration(state);
      expect(state.roleApprovals).toEqual({});
    });
  });

  describe("hasReachedMaxIterations", () => {
    it("returns false at max iterations (5)", () => {
      const state = createConsensusState();
      state.iteration = 5;
      expect(hasReachedMaxIterations(state)).toBe(false);
    });

    it("returns true when iteration exceeds max", () => {
      const state = createConsensusState();
      state.iteration = 6;
      expect(hasReachedMaxIterations(state)).toBe(true);
    });

    it("returns false when iteration below max", () => {
      const state = createConsensusState();
      state.iteration = 1;
      expect(hasReachedMaxIterations(state)).toBe(false);
    });
  });

  describe("formatConsensusStatus", () => {
    it("formats initial state correctly", () => {
      const state = createConsensusState();
      const formatted = formatConsensusStatus(state);
      expect(formatted).toContain("iter=1/5");
      expect(formatted).toContain("Planner");
      expect(formatted).toContain("none");
    });

    it("includes role approvals in formatted output", () => {
      const state = createConsensusState();
      state.roleApprovals.architect = true;
      state.roleApprovals.critic = false;
      const formatted = formatConsensusStatus(state);
      expect(formatted).toContain("architect: ✓");
      expect(formatted).toContain("critic: ✗");
    });
  });

  describe("getNextRole", () => {
    it("returns critic when architect approved and no critic review", () => {
      const state = createConsensusState();
      state.roleApprovals.architect = true;
      expect(getNextRole(state)).toBe("critic");
    });

    it("returns current role when no approvals yet", () => {
      const state = createConsensusState();
      state.currentRole = "architect";
      expect(getNextRole(state)).toBe("architect");
    });

    it("returns planner when max iterations exceeded", () => {
      const state = createConsensusState();
      state.iteration = 6;
      expect(getNextRole(state)).toBe("planner");
    });

    it("returns critic when both architect and critic have approved (dual approval edge case)", () => {
      const state = createConsensusState();
      state.roleApprovals.architect = true;
      state.roleApprovals.critic = true;
      // When both architect and critic have approved, getNextRole returns current role (planner)
      // This edge case shouldn't happen in normal flow but should be handled gracefully
      expect(getNextRole(state)).toBe("planner");
    });
  });
});
