import { describe, it, expect } from "vitest";
import {
  formatDate,
  sanitizeDescription,
  generatePlanFilename,
  generateSpecFilename,
  resolveFilenameIncrement,
} from "../pi/extensions/ralplan/naming.js";

describe("naming.ts", () => {
  describe("formatDate()", () => {
    it("should return YYYY-MM-DD format", () => {
      const date = new Date("2026-05-05T12:00:00Z");
      const result = formatDate(date);
      expect(result).toBe("2026-05-05");
    });

    it("should pad single digit months and days", () => {
      const date = new Date("2026-01-01T12:00:00Z");
      const result = formatDate(date);
      expect(result).toBe("2026-01-01");
    });

    it("should use current date when no argument provided", () => {
      const result = formatDate();
      expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });
  });

  describe("sanitizeDescription()", () => {
    it("should convert to lowercase", () => {
      const result = sanitizeDescription("Hello World");
      expect(result).toBe("hello-world");
    });

    it("should replace spaces with hyphens", () => {
      const result = sanitizeDescription("hello world test");
      expect(result).toBe("hello-world-test");
    });

    it("should remove leading and trailing hyphens", () => {
      const result = sanitizeDescription("  hello  ");
      expect(result).toBe("hello");
    });

    it("should collapse multiple hyphens", () => {
      const result = sanitizeDescription("hello   world");
      expect(result).toBe("hello-world");
    });

    it("should remove non-alphanumeric characters except hyphens", () => {
      const result = sanitizeDescription("hello@world!test");
      expect(result).toBe("hello-world-test");
    });

    it("should truncate to 50 characters", () => {
      const long = "a".repeat(60);
      const result = sanitizeDescription(long);
      expect(result.length).toBe(50);
    });

    it("should handle empty string", () => {
      const result = sanitizeDescription("");
      expect(result).toBe("");
    });
  });

  describe("generatePlanFilename()", () => {
    it("should generate plan filename with date", () => {
      const date = new Date("2026-05-05");
      const result = generatePlanFilename("my plan", date);
      expect(result).toBe("plan-2026-05-05-my-plan.md");
    });

    it("should sanitize description in filename", () => {
      const date = new Date("2026-05-05");
      const result = generatePlanFilename("My Plan With Spaces!", date);
      expect(result).toBe("plan-2026-05-05-my-plan-with-spaces.md");
    });

    it("should handle complex descriptions", () => {
      const date = new Date("2026-05-05");
      const result = generatePlanFilename("Add feature X/Y integration", date);
      expect(result).toBe("plan-2026-05-05-add-feature-x-y-integration.md");
    });
  });

  describe("generateSpecFilename()", () => {
    it("should generate spec filename with date", () => {
      const date = new Date("2026-05-05");
      const result = generateSpecFilename("my spec", date);
      expect(result).toBe("spec-2026-05-05-my-spec.md");
    });

    it("should sanitize description in filename", () => {
      const date = new Date("2026-05-05");
      const result = generateSpecFilename("My Spec!", date);
      expect(result).toBe("spec-2026-05-05-my-spec.md");
    });
  });

  describe("resolveFilenameIncrement()", () => {
    it("should return base name when counter is 0", () => {
      const result = resolveFilenameIncrement("plan-2026-05-05.md", 0);
      expect(result).toBe("plan-2026-05-05.md");
    });

    it("should append counter when counter > 0", () => {
      const result = resolveFilenameIncrement("plan-2026-05-05.md", 1);
      expect(result).toBe("plan-2026-05-05-1.md");
    });

    it("should handle multiple increments", () => {
      const result = resolveFilenameIncrement("plan-2026-05-05.md", 5);
      expect(result).toBe("plan-2026-05-05-5.md");
    });

    it("should handle filenames without extension", () => {
      const result = resolveFilenameIncrement("plan-2026-05-05", 2);
      expect(result).toBe("plan-2026-05-05-2");
    });
  });
});
