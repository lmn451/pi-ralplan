import { describe, it, expect } from "vitest";
import {
  hasBypassPrefix,
  hasConcreteAnchor,
  looksLikeBroadRequest,
} from "../pi/extensions/ralplan/gate.js";

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
      expect(hasConcreteAnchor("1. Add input validation\n2. Write tests")).toBe(
        true,
      );
    });

    it("detects code blocks", () => {
      expect(hasConcreteAnchor("ralph add: ```ts\nconst x = 1\n```")).toBe(
        true,
      );
    });

    it("detects acceptance criteria", () => {
      expect(
        hasConcreteAnchor("add login - acceptance criteria: user can sign in"),
      ).toBe(true);
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
      expect(looksLikeBroadRequest("implement auth in src/auth.ts")).toBe(
        false,
      );
    });

    it("does not gate requests with issue numbers", () => {
      expect(looksLikeBroadRequest("implement #42")).toBe(false);
    });

    it("does not gate requests with function names", () => {
      expect(looksLikeBroadRequest("fix processKeywordDetector")).toBe(false);
    });

    it("does not gate requests with numbered steps", () => {
      expect(
        looksLikeBroadRequest("implement:\n1. Add validation\n2. Write tests"),
      ).toBe(false);
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
