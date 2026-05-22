// ============================================================================
// CONSENSUS LOOP — Planner → Architect → Critic iteration with approval tracking
// ============================================================================

export type ConsensusRole = "planner" | "architect" | "critic";

export interface ConsensusState {
  /** Current active role in the consensus loop */
  currentRole: ConsensusRole;
  /** Which iteration of the consensus loop we're on (1-based) */
  iteration: number;
  /** Whether the current draft has been approved by Architect or Critic */
  approved: boolean;
  /** Reasons for rejection (if any) collected during this iteration */
  rejections: string[];
  /** History of role approvals for the current draft */
  roleApprovals: Partial<Record<ConsensusRole, boolean>>;
}

export const MAX_CONSENSUS_ITERATIONS = 5;

/** Signal strings for consensus approval/rejection */
export const CONSENSUS_APPROVED = "CONSENSUS_APPROVED";
export const CONSENSUS_REJECTED = "CONSENSUS_REJECTED";

/**
 * Create a fresh consensus state for starting a new plan draft review.
 * Initial iteration starts with Planner creating the draft.
 */
export function createConsensusState(): ConsensusState {
  return {
    currentRole: "planner",
    iteration: 1,
    approved: false,
    rejections: [],
    roleApprovals: {},
  };
}

/**
 * Advance to the next role in the consensus loop.
 * Returns the next role, or null if consensus is complete/terminated.
 */
export function advanceConsensusRole(
  state: ConsensusState,
): ConsensusRole | null {
  switch (state.currentRole) {
    case "planner":
      state.currentRole = "architect";
      break;
    case "architect":
      if (state.approved) {
        state.currentRole = "critic";
      } else {
        // Architect rejected — send back to planner
        state.currentRole = "planner";
      }
      break;
    case "critic":
      if (state.approved) {
        // Consensus reached — complete
        return null;
      } else {
        // Critic rejected — send back to planner
        state.currentRole = "planner";
      }
      break;
  }
  return state.currentRole;
}

/**
 * Record a rejection from a role with the reason.
 * If Architect rejects, iteration continues (Planner retries).
 * If Critic rejects, iteration continues (Planner retries).
 */
export function recordRejection(
  state: ConsensusState,
  role: ConsensusRole,
  reason: string,
): ConsensusState {
  state.rejections.push(`[${role.toUpperCase()}] ${reason}`);
  state.roleApprovals[role] = false;
  state.approved = false;
  return state;
}

/**
 * Record an approval from a role.
 * Architect approval advances to Critic.
 * Critic approval means consensus reached.
 */
export function recordApproval(
  state: ConsensusState,
  role: ConsensusRole,
): ConsensusState {
  state.roleApprovals[role] = true;
  state.approved = true;
  return state;
}

/**
 * Start a new iteration (Planner gets another chance to revise).
 * Increments iteration counter.
 */
export function startNextIteration(state: ConsensusState): ConsensusState {
  state.iteration++;
  state.approved = false;
  state.rejections = [];
  // Reset role approvals for new iteration — Architect/Critic must re-review
  state.roleApprovals = {};
  return state;
}

/**
 * Check if max iterations have been reached.
 * Returns true if iteration exceeds MAX_CONSENSUS_ITERATIONS without consensus.
 */
export function hasReachedMaxIterations(state: ConsensusState): boolean {
  return state.iteration > MAX_CONSENSUS_ITERATIONS;
}

/**
 * Get a human-readable summary of the current consensus state.
 */
export function formatConsensusStatus(state: ConsensusState): string {
  const roleLabel =
    state.currentRole.charAt(0).toUpperCase() + state.currentRole.slice(1);
  const approvalList = Object.entries(state.roleApprovals)
    .map(([role, approved]) => `${role}: ${approved ? "✓" : "✗"}`)
    .join(", ");

  return `Consensus[iter=${state.iteration}/${MAX_CONSENSUS_ITERATIONS}] ${roleLabel} | ${approvalList || "none"}`;
}

/**
 * Get the next role based on current state and approval status.
 * This determines which subagent prompt to use.
 */
export function getNextRole(state: ConsensusState): ConsensusRole {
  if (state.iteration > MAX_CONSENSUS_ITERATIONS) {
    return "planner"; // Will trigger termination check
  }

  // If we have architect approval and no critic review yet, next is critic
  if (state.roleApprovals.architect === true && !state.roleApprovals.critic) {
    return "critic";
  }

  // Otherwise next is based on current role
  return state.currentRole;
}
