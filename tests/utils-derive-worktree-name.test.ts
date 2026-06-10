import { describe, it, expect } from "vitest";
import { deriveWorktreeName } from "../pi/extensions/ralplan/utils.js";

describe("deriveWorktreeName", () => {
  it("lowercases and replaces non-alphanumerics with dashes", () => {
    expect(deriveWorktreeName("Build Me A TODO App")).toBe("build-me-a-todo-app");
  });

  it("strips leading and trailing dashes", () => {
    expect(deriveWorktreeName("---hello---")).toBe("hello");
    expect(deriveWorktreeName("--abc--")).toBe("abc");
  });

  it("collapses consecutive non-alphanumerics", () => {
    expect(deriveWorktreeName("foo   bar!!!baz")).toBe("foo-bar-baz");
    expect(deriveWorktreeName("a/b\\c d")).toBe("a-b-c-d");
  });

  it("truncates to 40 characters", () => {
    const long = "a".repeat(100);
    expect(deriveWorktreeName(long).length).toBe(40);
  });

  it("falls back to 'plan' for empty/all-separator inputs", () => {
    expect(deriveWorktreeName("")).toBe("plan");
    expect(deriveWorktreeName("---")).toBe("plan");
    expect(deriveWorktreeName("!!!")).toBe("plan");
  });

  it("matches the previous inlined behavior exactly", () => {
    // Pinned cases from the pre-refactor inlined logic
    const cases: Array<[string, string]> = [
      ["add user auth", "add-user-auth"],
      ["Refactor Auth Module", "refactor-auth-module"],
      ["  spaces  around  ", "spaces-around"],
      ["café-au-lait", "caf-au-lait"], // unicode letters are stripped
      ["v1.2.3", "v1-2-3"],
    ];
    for (const [input, expected] of cases) {
      expect(deriveWorktreeName(input)).toBe(expected);
    }
  });
});
