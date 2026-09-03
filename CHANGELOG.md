# Changelog

All notable changes to MandateMarshal are documented in this file.

## [Unreleased]

## [0.2.4] - 2026-09-03

### Fixed

- Canonicalized Codex Skill discovery on the exact versioned plugin cache instead of treating the marketplace checkout and legacy global Skill as interchangeable runtime sources.
- `mandatemarshal pin` now verifies the cache plugin version, cache Skill version, and LF-normalized cache Skill SHA-256 against the published release and fails closed instead of searching another copy.
- Automatic legacy global Skill mirroring was removed. A proven official legacy `SKILL.md` is deleted only after release-provenance verification; customized same-name Skill content blocks pinning before Codex installation state changes, and neighboring files are preserved.
- Pin-state schema v2 records marketplace/runtime checkout separately from the canonical versioned plugin-cache source, while schema v1 records are migrated deterministically when read.
- `mandatemarshal version` now reports plugin-cache and cache-Skill versions explicitly and treats any remaining legacy global Skill as drift.

## [0.2.3] - 2026-09-03

### Fixed

- Fixed `mandatemarshal pin` on Windows shells where `codex` is installed but not present on the inherited PATH by resolving the Codex executable from PATH and known Codex/npm install locations before failing.
- `mandatemarshal version` now labels an installation with no release pin as `UNPINNED` instead of presenting missing plugin/Skill state as `OK`.

## [0.2.2] - 2026-09-03

### Added

- Added `mandatemarshal pin <version|latest>` and `mandatemarshal pin status` so Codex can switch MandateMarshal releases through its native plugin marketplace instead of manual Skill/agent copying.
- Added a MandateMarshal Codex marketplace manifest and plugin-bundled agent profiles so a pinned Git tag provides the Skill, agent definitions, plugin metadata, and CLI source from the same release.
- Pinned CLI delegation now forwards normal MandateMarshal commands to the CLI bundled inside the selected plugin release, preventing a newer Skill from silently running against an older launcher implementation.
- Added `mandatemarshal version` for one-command runtime/pin/plugin/Skill alignment reporting, plus script-friendly `--version` and `-v` aliases.

### Fixed

- Package, Codex plugin manifest, and Skill frontmatter versions are now checked as one release version so Codex cannot keep reporting stale Skill metadata after an update.

## [0.2.1] - 2026-09-03

### Fixed

- Aligned the Codex plugin manifest version with the published package version so installed Codex integrations no longer report the stale v0.1.0 metadata after the v0.2 release.
- Added a conformance regression that fails CI whenever the package and Codex plugin manifest versions diverge again.

## [0.2.0] - 2026-09-01

### Added

- Durable append-only run journal with strict sequence validation and flushed writes at orchestration boundaries.
- Versioned durable snapshots plus state-machine event replay so transitions committed after the latest snapshot survive restart.
- External-operation intent/observation/completion protocol with explicit `completed`, `retryable`, `waiting`, and `reconciliation-required` recovery outcomes.
- Operation idempotency keys that reject duplicate live intents and prevent a crash from silently launching a second implementer or reviewer.
- Single-writer durable run leases with renewal, token validation, and explicit expired-lease takeover.
- Durable `OrchestrationEngine` resume path covering implementer launch, Parent verification, Fresh Reviewer launch, and final artifact persistence.
- `mandatemarshal run status` and `mandatemarshal run resume` operator CLI surfaces backed by journal events rather than direct snapshot mutation.
- Codex durable-operation mapping outside the target repository, persistent Codex thread capture, and completed-result recovery from Codex session JSONL.
- Real-host Luna/Max durable Codex smoke test validating thread persistence and completed-operation observation.
- JSON Schemas for durable journal entries and durable run snapshots.
- Crash/fault-injection regressions for implementer/reviewer launch boundaries, ambiguous operations, recovered completions, journal corruption, and lease takeover/renewal.
- Dedicated durable-runtime architecture documentation.

### Changed

- Reworked the README opening into a GitHub landing layer with a concise value comparison, quick start, status badges, and an inline authority/review flow.
- Added search-oriented package metadata and keywords for Codex, coding-agent orchestration, agent governance/safety, and developer-tool discovery.
- Added a repository social-preview banner and surfaced it in the README hero.
- Codex CLI runs remain ephemeral by default, but durable MandateMarshal operations now persist their Codex session so completed work can be recovered after an orchestrator crash.
- Repository contract now explicitly requires fail-closed recovery for ambiguous external operations and single-writer durable execution.

### Fixed

- Durable snapshot filenames now use a monotonic snapshot ordinal and serialized snapshot writes, preventing same-millisecond filename collisions on fast filesystems such as Linux CI while preserving existing snapshot filename compatibility.

### Deliberate limits

- v0.2 does not yet provide worktree-per-run isolation, semantic Git checkpoints, a built-in detached daemon, fleet scheduling, or a dashboard.
- Incomplete Codex threads are not auto-resumed when MandateMarshal cannot prove that continuing would avoid duplicate non-idempotent side effects.

## [0.1.0] - 2026-08-28

### Added

- Provider-neutral authority model separating User/Owner, Parent, Implementer, and Fresh Reviewer responsibilities.
- Explicit orchestration state machine that requires a fresh reviewer `PASS` for the exact final candidate before compliant completion.
- `PASS | FIX | ESCALATE` reviewer protocol with no reviewer self-fix or architecture-policy authority.
- Owner-contract escalation flow: `DETECT -> INVESTIGATE -> PROPOSE -> HOLD -> ESCALATE`.
- Deterministic evidence for command policy, required flags, repository state, ownership, forbidden artifacts, and candidate identity.
- Configurable Python no-bytecode regression support, including missing `-B` and `.pyc` / `__pycache__` detection.
- Codex adapter with semantic routine/complex lanes and exact no-silent-fallback model/effort requests.
- Codex v0.1 defaults: routine implementer = Luna/Max, complex implementer = Terra/High, fresh reviewer = Sol/High.
- Explicit routine-to-complex `LaneReclassified` flow when a routine worker reports bounded complexity blockage.
- Fresh-review mutation detection through candidate re-observation, including untracked-file content changes in candidate identity.
- Project-scoped Codex agent templates and installer.
- Codex plugin/Skill packaging.
- Explicit-first, project-persistent activation registry stored outside target repositories, with enable/status/disable CLI controls and missing-path activation rejection.
- Experimental Claude Code bridge and provider-neutral conformance seam.
- JSON Schemas for implementation packets, review results, escalations, run events, and project activation records.
- README, architecture, Codex setup, security, and decision documentation.
- Immutable persisted run evidence by run ID, with exclusive file creation and private filesystem modes where supported.
- Conservative Codex CLI capability reporting that distinguishes reported child evidence from Parent/runtime observation.
- Fail-closed runtime config validation for Fresh Reviewer read-only requests, semantic role mappings, evidence policy entries, and Owner Contracts.
- Regression/conformance/integration test suite covering authority overreach, reviewer overreach, stale review, reviewer mutation, routing, silent fallback, forbidden bytecode, evidence overwrite, untracked candidate mutation, activation integrity, and portability.

### Specification corrections accepted before implementation

- Implementation packet `routing` is mandatory in both prose and schema.
- Canonical schema filename is `implementation-packet.schema.json`.
- Fresh Reviewer Codex default is formally Sol/High.
- `routingObservation` is part of the host capability contract.
- Implementation packet `returnContract` is required as specified by R2.
- R2 expected/forbidden side-effect rules are restored as minimal v0.1 string-rule arrays.

### Notes

- MandateMarshal v0.1.0 was implemented independently from the local specification bundle; no substantial Sol Advisor source-code copy was identified in this release.
- The mandatory v0.1 release security gate is the bounded reproducible audit suite (dependency/static/publication/test/package checks). Full Codex Security remains an optional higher-assurance review for materially larger future attack surfaces rather than a per-release requirement.
