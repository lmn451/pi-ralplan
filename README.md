# pi-ralplan

Consensus-driven planning extension for [Pi](https://pi.dev). Brings the RALPLAN pipeline from oh-my-claudecode to Pi as an extension + skill package.

## Features

- **Consensus Planning** — Planner → Architect → Critic iteration loop
- **Configurable Pipeline** — RALPLAN → Execution → Verification → QA
- **Stage Prompt Injection** — Automatic stage-specific prompts via `before_agent_start`
- **Signal-Based Advancement** — Detects `PIPELINE_*_COMPLETE` signals to auto-advance
- **Session Persistence** — Dual persistence: session entries (branch-safe) + file state (resume)
- **UI Integration** — Status line and progress widget

## Installation

### As a Pi package

```bash
pi install git:github.com/yourusername/pi-ralplan
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

### Commands

| Command | Description |
|---------|-------------|
| `/ralplan [idea]` | Start consensus planning |
| `/ralplan:status` | Show pipeline status |
| `/ralplan:cancel` | Cancel active session |
| `/ralplan:skip` | Skip current stage |
| `/ralplan:artifacts` | List planning artifacts |

### Tools (callable by LLM)

| Tool | Description |
|------|-------------|
| `ralplan_advance` | Advance to next stage |
| `ralplan_submit_artifact` | Save spec/plan/test-spec |
| `ralplan_set_config` | Modify pipeline config |

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

## Architecture

```
.pi/extensions/ralplan/
├── index.ts      # Main extension entry point
├── pipeline.ts   # Stage machine + config
├── adapters.ts   # Stage prompt generators
├── prompts.ts    # Prompt templates
├── state.ts      # Session + file persistence
├── signals.ts    # Signal detection
├── artifacts.ts  # Plan file management
└── utils.ts      # Helpers

.pi/skills/ralplan/
├── SKILL.md                     # Skill definition
├── prompts/
│   ├── planner.md
│   ├── architect.md
│   └── critic.md
└── references/
    └── consensus-workflow.md
```

## License

MIT
