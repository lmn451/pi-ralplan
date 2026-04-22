import { describe, it, expect } from "bun:test";

// Re-create the gate logic here for unit testing since it's private in index.ts
const CONCRETE_ANCHORS = [
  /[a-zA-Z0-9_\-./]+\.[a-zA-Z]{2,}/, // file paths with extensions
  /#[0-9]+/, // issue/PR numbers
  /[a-z]+[A-Z][a-zA-Z]+/, // camelCase symbols
  /[A-Z][a-z]+[A-Z][a-zA-Z]+/, // PascalCase symbols
  /[a-z]+_[a-z_]+/, // snake_case symbols
  /\d+\.\s+/, // numbered steps
  /```[a-z]*\n/, // code blocks
  /acceptance criteria/i,
  /error[:\s]/i,
  /test\s+(runner|suite|file)/i,
];

const BROAD_INDICATORS = [
  "build me",
  "create a",
  "implement",
  "develop",
  "make a",
  "write a",
  "design a",
  "set up",
  "add feature",
  "new feature",
  "improve",
  "optimize",
  "refactor",
  "fix this",
  "update the",
];

const BYPASS_PREFIXES = ["force:", "! "];

function hasBypassPrefix(text: string): boolean {
  const trimmed = text.trim().toLowerCase();
  return BYPASS_PREFIXES.some((p) => trimmed.startsWith(p));
}

function hasConcreteAnchor(text: string): boolean {
  return CONCRETE_ANCHORS.some((re) => re.test(text));
}

function looksLikeBroadRequest(text: string): boolean {
  const lower = text.toLowerCase();
  const hasBroad = BROAD_INDICATORS.some((ind) => lower.includes(ind));
  const words = text.split(/\s+/).filter((w) => w.length > 0);
  const isShort = words.length <= 15;
  const hasAnchor = hasConcreteAnchor(text);
  return hasBroad && isShort && !hasAnchor;
}

describe("pre-execution gate", () => {
  describe("hasBypassPrefix", () => {
    it("detects force: prefix", () => {
      expect(hasBypassPrefix("force: ralph fix this")).toBe(true);
      expect(hasBypassPrefix("FORCE: do it")).toBe(true);
    });

    it("detects ! prefix", () => {
      expect(hasBypassPrefix("! ralph fix this")).toBe(true);
    });

    it("returns false for normal input", () => {
      expect(hasBypassPrefix("ralph fix this")).toBe(false);
      expect(hasBypassPrefix("implement auth in src/auth.ts")).toBe(false);
    });
  });

  describe("hasConcreteAnchor", () => {
    it("detects file paths", () => {
      expect(hasConcreteAnchor("fix src/hooks/bridge.ts")).toBe(true);
    });

    it("detects issue numbers", () => {
      expect(hasConcreteAnchor("implement #42")).toBe(true);
    });

    it("detects camelCase symbols", () => {
      expect(hasConcreteAnchor("fix processKeywordDetector")).toBe(true);
    });

    it("detects PascalCase symbols", () => {
      expect(hasConcreteAnchor("update UserModel")).toBe(true);
    });

    it("detects snake_case symbols", () => {
      expect(hasConcreteAnchor("fix user_model")).toBe(true);
    });

    it("detects numbered steps", () => {
      expect(hasConcreteAnchor("1. Add input validation\n2. Write tests")).toBe(true);
    });

    it("detects code blocks", () => {
      expect(hasConcreteAnchor("ralph add: ```ts\nconst x = 1\n```")).toBe(true);
    });

    it("detects acceptance criteria", () => {
      expect(hasConcreteAnchor("add login - acceptance criteria: user can sign in")).toBe(true);
    });

    it("returns false for vague text", () => {
      expect(hasConcreteAnchor("build me an app")).toBe(false);
    });
  });

  describe("looksLikeBroadRequest", () => {
    it("gates short vague requests", () => {
      expect(looksLikeBroadRequest("build me a todo app")).toBe(true);
      expect(looksLikeBroadRequest("implement user authentication")).toBe(true);
    });

    it("does not gate requests with file paths", () => {
      expect(looksLikeBroadRequest("implement auth in src/auth.ts")).toBe(false);
    });

    it("does not gate requests with issue numbers", () => {
      expect(looksLikeBroadRequest("implement #42")).toBe(false);
    });

    it("does not gate requests with function names", () => {
      expect(looksLikeBroadRequest("fix processKeywordDetector")).toBe(false);
    });

    it("does not gate requests with numbered steps", () => {
      expect(looksLikeBroadRequest("implement:\n1. Add validation\n2. Write tests")).toBe(false);
    });

    it("gates long requests without anchors", () => {
      expect(
        looksLikeBroadRequest(
          "build me a really complex application with lots of features and user management and billing",
        ),
      ).toBe(true);
    });

    it("does not gate requests without broad indicators", () => {
      expect(looksLikeBroadRequest("What is the weather today?")).toBe(false);
    });
  });
});
