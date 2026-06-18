import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  setAutoCleanup,
  getAutoCleanup,
  resetAutoCleanupForTests,
  DEFAULT_AUTO_CLEANUP,
} from "../pi/extensions/ralplan/worktree.js";

describe("worktree autoCleanup flag", () => {
  beforeEach(() => {
    resetAutoCleanupForTests();
  });

  afterEach(() => {
    resetAutoCleanupForTests();
  });

  it("defaults to DEFAULT_AUTO_CLEANUP (false)", () => {
    expect(getAutoCleanup()).toBe(DEFAULT_AUTO_CLEANUP);
    expect(getAutoCleanup()).toBe(false);
  });

  it("setAutoCleanup(true) flips the flag", () => {
    setAutoCleanup(true);
    expect(getAutoCleanup()).toBe(true);
  });

  it("setAutoCleanup(false) flips it back", () => {
    setAutoCleanup(true);
    setAutoCleanup(false);
    expect(getAutoCleanup()).toBe(false);
  });

  it("resetAutoCleanupForTests() restores default", () => {
    setAutoCleanup(true);
    resetAutoCleanupForTests();
    expect(getAutoCleanup()).toBe(false);
  });

  it("DEFAULT_AUTO_CLEANUP is false (preserves user work on completion)", () => {
    // Document the design choice: pipeline completion should NOT silently
    // destroy the worktree. Users opt in via setAutoCleanup(true) or by
    // calling cleanupWorktree() explicitly. /ralplan:cancel always preserves.
    expect(DEFAULT_AUTO_CLEANUP).toBe(false);
  });
});
