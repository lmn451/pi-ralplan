import { describe, it, expect, vi, beforeEach } from "vitest";
import { mkdirSync } from "node:fs";
import {
  escapeForPrompt,
  resolveOpenQuestionsPath,
  resolvePlansDir,
  resolveAnswersPath,
  resolveStatePath,
  ensureRalplanDir,
  nowISO,
  deriveWorktreeName,
} from "../pi/extensions/ralplan/utils.js";

// Mock fs module
vi.mock("node:fs", () => ({
  mkdirSync: vi.fn(),
}));

describe("escapeForPrompt", () => {
  it("should escape backslashes", () => {
    const input = "path\\to\\file";
    const result = escapeForPrompt(input);
    expect(result).toBe("path\\\\to\\\\file");
  });

  it("should escape double quotes", () => {
    const input = 'say "hello"';
    const result = escapeForPrompt(input);
    expect(result).toBe('say \\"hello\\"');
  });

  it("should escape backticks", () => {
    const input = "code `example`";
    const result = escapeForPrompt(input);
    expect(result).toBe("code \\`example\\`");
  });

  it("should escape dollar signs", () => {
    const input = "price is $100";
    const result = escapeForPrompt(input);
    expect(result).toBe("price is \\$100");
  });

  it("should escape multiple special characters together", () => {
    const input = 'Use `code` and "quotes" with $var and \\slash';
    const result = escapeForPrompt(input);
    expect(result).toBe(
      'Use \\`code\\` and \\"quotes\\" with \\$var and \\\\slash',
    );
  });

  it("should handle empty string", () => {
    expect(escapeForPrompt("")).toBe("");
  });

  it("should handle string with no special characters", () => {
    const input = "hello world";
    expect(escapeForPrompt(input)).toBe("hello world");
  });

  it("should handle newlines (not escaped, but pass through)", () => {
    // newlines are not in the escape list, so they pass through
    const input = "line1\nline2";
    const result = escapeForPrompt(input);
    expect(result).toBe("line1\nline2");
  });
});

describe("resolvePlansDir", () => {
  it("should resolve plans directory from base directory", () => {
    const result = resolvePlansDir("/project/root");
    expect(result).toBe("/project/root/plans");
  });

  it("should handle directory with trailing slash", () => {
    const result = resolvePlansDir("/project/root/");
    expect(result).toBe("/project/root/plans");
  });
});

describe("resolveOpenQuestionsPath", () => {
  it("should resolve open-questions.md path from base directory", () => {
    const result = resolveOpenQuestionsPath("/project/root");
    expect(result).toBe("/project/root/plans/open-questions.md");
  });

  it("should derive correct path from planPath", () => {
    const directory = "/user/project";
    const result = resolveOpenQuestionsPath(directory);
    expect(result).toBe("/user/project/plans/open-questions.md");
  });
});

describe("resolveAnswersPath", () => {
  it("should resolve answers.md path from base directory", () => {
    const result = resolveAnswersPath("/project/root");
    expect(result).toBe("/project/root/plans/answers.md");
  });
});

describe("resolveStatePath", () => {
  it("should resolve state.json path in .pi/ralplan", () => {
    const result = resolveStatePath("/project/root");
    expect(result).toBe("/project/root/.pi/ralplan/state.json");
  });
});

describe("ensureRalplanDir", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should create plans directory recursively", () => {
    const directory = "/project/root";
    const result = ensureRalplanDir(directory);

    expect(mkdirSync).toHaveBeenCalledWith("/project/root/plans", {
      recursive: true,
    });
    expect(result).toBe("/project/root/plans");
  });

  it("should return the plans directory path", () => {
    const directory = "/different/path";
    const result = ensureRalplanDir(directory);

    expect(result).toBe("/different/path/plans");
  });
});

describe("nowISO", () => {
  it("should return ISO format timestamp", () => {
    const result = nowISO();
    // ISO timestamp format: 2024-01-15T10:30:00.000Z
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}.\d{3}Z$/);
  });

  it("should return current time (within 10 seconds of now)", () => {
    const before = Date.now();
    const result = nowISO();
    const after = Date.now();

    const resultMs = new Date(result).getTime();
    // The result should be within 10 seconds of current time
    expect(Math.abs(resultMs - before)).toBeLessThan(10000);
    expect(Math.abs(resultMs - after)).toBeLessThan(10000);
  });
});

describe("deriveWorktreeName (single source of truth)", () => {
  it("lowercases the idea", () => {
    expect(deriveWorktreeName("My Test Plan")).toBe("my-test-plan");
  });

  it("replaces non-alphanumeric runs with single hyphens", () => {
    expect(deriveWorktreeName("hello   world!!! test")).toBe(
      "hello-world-test",
    );
  });

  it("strips special characters", () => {
    expect(deriveWorktreeName("Plan #1: Build API!")).toBe("plan-1-build-api");
  });

  it("strips leading and trailing whitespace and hyphens", () => {
    expect(deriveWorktreeName("  ---hello---  ")).toBe("hello");
  });

  it("truncates to 40 chars", () => {
    const long = "a".repeat(100);
    expect(deriveWorktreeName(long)).toHaveLength(40);
  });

  it("falls back to 'plan' for empty / non-alphanumeric input", () => {
    expect(deriveWorktreeName("")).toBe("plan");
    expect(deriveWorktreeName("!!!")).toBe("plan");
    expect(deriveWorktreeName("---")).toBe("plan");
  });

  it("matches the result format used by both adapters.ts and worktree.ts", () => {
    // This test exists to catch drift if the helper is later duplicated.
    // Both call sites must produce the same name for the same input.
    const idea = "Implement OAuth2 Login Flow";
    const expected = "implement-oauth2-login-flow";
    expect(deriveWorktreeName(idea)).toBe(expected);
  });
});
