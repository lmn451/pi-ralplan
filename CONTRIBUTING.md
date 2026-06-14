# Contributing to pi-ralplan

Thanks for your interest in contributing to pi-ralplan. This document covers
the project's contribution workflow and a few project-specific policies.

## Quick Start

```bash
git clone https://github.com/lmn451/pi-ralplan
cd pi-ralplan
npm install
npm test
```

## Workflow

1. **Open an issue first** for non-trivial changes. Bug fixes and small
   documentation improvements can go straight to a PR.
2. **Branch from `master`.** Use a descriptive branch name:
   - `feat/…` for new features
   - `fix/…` for bug fixes
   - `refactor/…` for refactors with no behavior change
   - `docs/…` for documentation only
   - `test/…` for test-only changes
   - `chore/…` for maintenance
3. **Commit in atomic units** with [Conventional Commits](https://www.conventionalcommits.org/):
   - `feat(planner): add open-questions parser`
   - `fix(pipeline): prevent double-advance on same turn`
   - `docs(adr): accept ADR 0007`
4. **Run the full test suite** before pushing: `npm test`.
5. **Open a PR** with a clear description, link to the originating issue, and
   a checklist of acceptance criteria.

## Project Policies

### State machine policy (ADR 0007)

This project **intentionally hand-rolls its finite state machine**. Do **not**
add `xstate`, `robot`, `robot3`, `machina`, `fsm`, `fsm-as2`, `finale`, `redux`,
or any similar state-machine library to `package.json` without first opening
a spec that triggers **at least one** of T-1..T-5 in
[ADR 0007](docs/adr/0007-hand-rolled-state-machine.md).

The current state machines are:

- **Pipeline:** 4 stages (`ralplan → execution → ralph → qa`) in
  `pi/extensions/ralplan/pipeline.ts`.
- **Brainstorm sub-machine:** 3 states (`expanding → awaiting-answers → planning`)
  in `pi/extensions/ralplan/brainstorm.ts`.

Visual diagrams (Mermaid) live in `architecture.md` §17. These must be kept
in sync with the source files if either changes.

A CI guard (`tests/no-fsm-deps.test.ts`) and a property-style test
(`tests/state-machine-invariants.test.ts`) enforce the FSM contract. Do not
delete these tests.

### Dependency policy

This project is a Pi extension and ships with **zero runtime dependencies**.
Peer dependencies on the host platform (`@earendil-works/pi-ai`,
`@earendil-works/pi-coding-agent`) are the only allowed runtime deps.
Dev dependencies for build tooling (`typescript`, `vitest`, `prettier`,
`husky`, `pretty-quick`) are also fine.

If you need a runtime dependency, open an issue first explaining why.

### Code style

- **TypeScript** with strict mode.
- **No default exports** except where the host platform requires them
  (e.g. the extension entry point).
- **Pure functions preferred** — most of `pi/extensions/ralplan/*` is pure
  or near-pure, which makes the test suite possible.
- **Comments only for non-obvious logic** — the code is the documentation.

### Commit messages

We use [Conventional Commits](https://www.conventionalcommits.org/). Each
commit should be atomic — one concern per commit. Never force-push to
`master`.

### Testing

- Tests live in `tests/` and as colocated `*.test.ts` files next to the
  module under test (both patterns are accepted; match the surrounding
  convention).
- Tests use **vitest** (`npm test` to run).
- For new FSM behavior, **update `tests/state-machine-invariants.test.ts`**
  to keep the executable spec in sync.
- For new dependencies, **update `tests/no-fsm-deps.test.ts`** only if the
  new dep is on the FSM forbid-list (in which case, do not add it — see
  the state machine policy above).

## Release Process

Releases are driven by `v*` git tags via trusted publishing (OIDC). See
`docs/publish.md` for the full process. Short version:

```bash
# 1. Bump version in package.json
# 2. Commit, tag, push
git add package.json
git commit -m "chore: bump version to X.Y.Z"
git tag vX.Y.Z
git push origin master
git push origin vX.Y.Z
```

## Questions?

Open an issue or check the `docs/` directory for architecture, ADRs, and
publishing workflow.
