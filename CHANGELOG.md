# Changelog

All notable changes to MandateMarshal are documented in this file.

## [Unreleased]

### Changed

- Reworked the README opening into a GitHub landing layer with a concise value comparison, quick start, status badges, and an inline authority/review flow.
- Added search-oriented package metadata and keywords for Codex, coding-agent orchestration, agent governance/safety, and developer-tool discovery.
- Added a repository social-preview banner and surfaced it in the README hero.

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
