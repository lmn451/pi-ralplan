# pi-ralplan

[![npm](https://img.shields.io/npm/v/pi-ralplan?label=npm)](https://npmjs.com/package/pi-ralplan) [![GitHub](https://img.shields.io/github/v/tag/lmn451/pi-ralplan?label=github)](https://github.com/lmn451/pi-ralplan)

> **Note:** The `docs/` folder is managed by the [`pi-docs`](https://github.com/lmn451/pi-docs) package.
> **Best with pi-subagentura:** Works better when paired with the `pi-subagentura` package for spawning sub-agents.

Consensus-driven planning extension for [Pi](https://pi.dev). Brings the RALPLAN pipeline from oh-my-claudecode to Pi as an extension + skill package.

## Features

- **Consensus Planning** — Planner → Architect → Critic iteration loop
- **Configurable Pipeline** — RALPLAN → Execution → Verification → QA
- **Stage Prompt Injection** — Automatic stage-specific prompts via `before_agent_start`
- **Signal-Based Advancement** — Detects `PIPELINE_*_COMPLETE` signals to auto-advance
- **Session Persistence** — Dual persistence: session entries (branch-safe) + file state (resume)
- **UI Integration** — Status line and progress widget
- **Deliberate Mode** — Enhanced scrutiny for high-risk work (auth, migrations, production)

## Installation

### As a Pi package

```bash
pi install npm:pi-ralplan
```

Or for local development:

```bash
cd ~/dev/pi-ralplan
pi install -l .
```

### Manual (copy files)

Copy the extension and skill to your Pi directories:

```bash
mkdir -p ~/.pi/agent/extensions/ralplan
mkdir -p ~/.pi/agent/skills/ralplan
cp -r pi/extensions/ralplan/* ~/.pi/agent/extensions/ralplan/
cp -r pi/skills/ralplan/* ~/.pi/agent/skills/ralplan/
```

Then reload Pi with `/reload`.

## Usage

### Start a planning session

```
/ralplan build me a todo app
```

Or start Pi with the flag:

```bash
pi --ralplan "build me a todo app"
```

> **Auto-start is slash-only.** The pipeline auto-starts ONLY when the prompt
> begins with `/ralplan` or `/brainstorm` (or when `--ralplan` / `--brainstorm`
> flags are used). Bare mentions of `ralplan` or `brainstorm` in prose —
> including action verbs like `use ralplan to plan this` or start-of-prompt
> directives like `ralplan: build auth` — do NOT trigger auto-start. This
> prevents the planner/architect/critic role prompts (which all mention
> `ralplan` naturally in their role descriptions) from accidentally
> re-triggering a fresh pipeline for each consensus round. To start a pipeline
> from prose, prefix the prompt with `/`:
>
> ```
> /ralplan build me a todo app
> ```

### Worktrees

Each pipeline run creates a single Git worktree under `<repo>-worktrees/`.
Follow-up sessions launched from inside that worktree **reuse the same
worktree** instead of creating a sibling — one worktree per pipeline run,
regardless of how many consensus rounds are run. This is detected via
`git rev-parse --git-dir` vs `--git-common-dir` and works automatically; no
configuration required.

### Commands

| Command              | Description              |
| -------------------- | ------------------------ |
| `/ralplan [idea]`    | Start consensus planning |
| `/ralplan:status`    | Show pipeline status     |
| `/ralplan:cancel`    | Cancel active session    |
| `/ralplan:skip`      | Skip current stage       |
| `/ralplan:artifacts` | List planning artifacts  |

### Tools (callable by LLM)

| Tool                      | Description              |
| ------------------------- | ------------------------ |
| `ralplan_advance`         | Advance to next stage    |
| `ralplan_submit_artifact` | Save spec/plan/test-spec |
| `ralplan_set_config`      | Modify pipeline config   |

### Pipeline Stages

1. **RALPLAN** — Consensus planning (spec + plan creation)
2. **Execution** — Implement the approved plan
3. **Verification (RALPH)** — Review implementation quality
4. **QA** — Build / lint / test cycling

### Completion Signals

The LLM emits these signals to advance stages:

- `PIPELINE_RALPLAN_COMPLETE`
- `PIPELINE_EXECUTION_COMPLETE`
- `PIPELINE_RALPH_COMPLETE`
- `PIPELINE_QA_COMPLETE`

### Configuration

Add to `.pi/settings.json`:

```json
{
  "ralplan": {
    "planning": "ralplan",
    "execution": "solo",
    "verification": {
      "engine": "ralph",
      "maxIterations": 100
    },
    "qa": true
  }
}
```

| Option         | Values                                           | Description                      |
| -------------- | ------------------------------------------------ | -------------------------------- |
| `planning`     | `"ralplan"`, `"direct"`, `false`                 | Planning mode or skip            |
| `execution`    | `"solo"`, `"team"`                               | Sequential or parallel execution |
| `verification` | `{ engine: "ralph", maxIterations: n }`, `false` | Verification settings            |
| `qa`           | `true`, `false`                                  | Enable QA stage                  |

## Architecture

```
User Input → /ralplan Command → Pipeline Init → Stage Machine
                                      ↓
Agent Loop ← Signal Detection ← Agent Response ← Stage Prompt
```

```
pi/extensions/ralplan/
├── index.ts          # Main extension entry point
├── pipeline.ts       # Stage machine + config
├── adapters.ts       # Stage prompt generators
├── prompts.ts        # Prompt templates
├── state.ts          # Session + file persistence
├── signals.ts        # Signal detection
├── artifacts.ts      # Plan file management
├── worktree.ts       # Git worktree management (with reuse rule)
├── brainstorm.ts     # Brainstorm mode sub-phase logic
├── naming.ts         # Filename generation helpers
└── utils.ts          # Shared helpers

pi/skills/ralplan/
├── SKILL.md                      # Skill definition
├── prompts/
│   ├── planner.md
│   ├── architect.md
│   └── critic.md
└── references/
    └── consensus-workflow.md
```

## Troubleshooting

| Issue                    | Solution                                                          |
| ------------------------ | ----------------------------------------------------------------- |
| Signal not detected      | Ensure the exact signal text appears in the assistant response    |
| State lost after `/tree` | State is branch-safe; check `/.pi/ralplan/state.json` as fallback |
| Pipeline stuck           | Use `/ralplan:skip` to skip the current stage                     |
| Extension not loading    | Verify paths in `package.json` `pi.extensions` and run `/reload`  |

## Testing

```bash
npm test
```

## License

MIT
