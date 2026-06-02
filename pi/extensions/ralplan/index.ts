/**
 * RALPLAN extension entry point.
 *
 * This file is intentionally a thin wiring module per
 * plans/spec-2026-06-01-v2.md T-11 (split the 1,257-line god module).
 *
 *   index.ts       — you are here: registers adapters + delegates to modules
 *   state-mgmt.ts  — context factory + lifecycle helpers
 *   commands.ts    — slash commands
 *   tools.ts       — pi tools
 *   handlers.ts    — pi.on() event handlers
 */
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { registerAdapters } from "./pipeline.js";
import {
  ralplanAdapter,
  executionAdapter,
  ralphAdapter,
  qaAdapter,
} from "./adapters.js";
import { createRalplanContext } from "./state-mgmt.js";
import { registerCommands } from "./commands.js";
import { registerTools } from "./tools.js";
import { registerHandlers } from "./handlers.js";

// Register adapters globally (must happen at module load)
registerAdapters([ralplanAdapter, executionAdapter, ralphAdapter, qaAdapter]);

export default function ralplanExtension(pi: ExtensionAPI): void {
  // Register CLI flags
  pi.registerFlag("ralplan", {
    description:
      "Start a RALPLAN consensus planning session with the initial prompt",
    type: "boolean",
    default: false,
  });
  pi.registerFlag("brainstorm", {
    description: "Start a brainstorm-mode session with the initial prompt",
    type: "boolean",
    default: false,
  });

  // Build the shared context (state + helpers)
  const ctx = createRalplanContext(pi);

  // Wire up the three sub-modules
  registerCommands(ctx);
  registerTools(ctx);
  registerHandlers(ctx);
  // Initial UI render is done by session_start when a session actually starts.
}

