# MandateMarshal Decision Log

This log records settled implementation decisions that must not be silently reopened by later agents.

## D-001 — Public name

**Decision:** Rename the provisional `AuthorityFlow` working name to **MandateMarshal** before public release.

**Approved by Owner:** 2026-08-27.

## D-002 — Authority hierarchy

**Decision:** User/Owner is above Parent. Parent owns architecture inside Owner Contracts but cannot silently mutate Owner-level policy.

## D-003 — Fresh review

**Decision:** Every compliant completion requires a fresh reviewer bound to the exact final candidate.

Reviewer scope is QA/code/execution-contract review only. Verdicts are exactly `PASS | FIX | ESCALATE`. Reviewer never implements its own fixes.

## D-004 — Fail-closed semantics

**Decision:** Hold only the affected action. Uncertainty cannot create a permanent prohibition or Owner-policy mutation.

Normative conflict flow:

`DETECT -> INVESTIGATE -> PROPOSE -> HOLD -> ESCALATE`

## D-005 — Implementation lanes

**Decision:** Core uses semantic `routine-implementer` and `complex-implementer` lanes. Provider mappings remain adapter-level.

Codex v0.1 defaults:

- routine -> GPT-5.6 Luna / Max
- complex -> GPT-5.6 Terra / High
- Fresh Reviewer -> GPT-5.6 Sol / High
- Parent -> inherit

## D-006 — No silent fallback

**Decision:** Never silently substitute model, effort, semantic lane, role, permission, isolation, or host capability.

Routine-worker complexity reclassification is an explicit Parent decision with a `LaneReclassified` event. A failed/unavailable routine lane is a capability failure, not complexity evidence.

## D-007 — Mechanical evidence

**Decision:** Deterministic mechanisms own deterministic facts where practical: command/flag checks, repository-state delta, candidate identity, artifact scans, path ownership, and verification evidence.

## D-008 — Provider-neutral core

**Decision:** `src/core/**` contains no provider/model branding. Adapters own provider-specific mapping and mechanics.

A conformance test mechanically enforces this boundary.

## D-009 — Runtime / language

**Decision:** TypeScript. Bun is the initial runtime/toolchain. Core remains free of Bun-specific API dependencies.

## D-010 — Claude Code v0.1 scope

**Decision:** v0.1 proves the portability seam with an experimental bridge and conformance fixture. Production runtime parity is not claimed.

## D-011 — Upstream derivation

**Decision:** The v0.1 implementation is written independently from the supplied specification rather than copying Sol Advisor source code. Sol Advisor remains documented design inspiration under MIT.

If future source is copied or substantially derived, update `THIRD_PARTY_NOTICES.md` with the exact upstream revision and derived files.

## D-012 — Run artifact location

**Decision:** Persistent run artifacts default to external user storage under `~/.mandatemarshal/runs/`, avoiding target-repository dirtiness.

## Owner-approved R2 clarifications — 2026-08-27

The original R2 bundle claimed the public name was the only unresolved item, but implementation review found four internal contract mismatches. The Owner explicitly approved the recommended resolutions before implementation:

### D-013 — Routing field is mandatory

`ImplementationPacket.routing` is mandatory in TypeScript and JSON Schema. A packet without a known semantic lane cannot enter implementation.

### D-014 — Canonical implementation packet schema name

Use `schemas/implementation-packet.schema.json` as the canonical filename. The older `task-packet.schema.json` name from the archived R2 bundle is not the implemented public schema.

### D-015 — Fresh Reviewer Codex default

Codex Fresh Reviewer default is formally **GPT-5.6 Sol / High**, not merely an example-config value.

### D-016 — Routing observation capability

`routingObservation` is part of the v0.1 `HostCapabilities` contract.

## Implementation clarification — reviewer mutation

### D-017 — Candidate re-observation after Fresh Reviewer

The Parent-facing orchestration contract includes candidate re-observation after reviewer execution. If candidate identity differs from the pre-review verified candidate, the review is invalidated and compliant completion is blocked with `REVIEWER_MUTATED_CANDIDATE`.

This implements the existing reviewer-mutation invariant; it does not expand reviewer authority or Owner policy.

## Owner-approved invocation behavior — 2026-08-27

### D-018 — Explicit-first, project-persistent activation

**Decision:** MandateMarshal must not auto-activate on an unregistered project. The first activation for a project requires explicit user selection. After that explicit activation, MandateMarshal may continue automatically for later coding work in the same project until the user explicitly disables it.

Persistent activation state is stored outside the target repository under `~/.mandatemarshal/projects/` by default. v0.1 project identity is based on the canonical project path, so moving/renaming the project may require explicit activation again.

The external registry is authoritative once MandateMarshal is loaded, but current Codex/host Skill discovery may occur before MandateMarshal can query that registry. v0.1 therefore permits current-context continuation as a fallback when pre-dispatch registry lookup is unavailable. This host limitation is documented as future improvement rather than expanding v0.1 into a larger host-integration project.

## Release security hardening — 2026-08-27

### D-019 — Candidate identity includes non-Git worktree bytes

**Decision:** Git diff/status alone are insufficient candidate identity because untracked-file contents are absent from normal Git diff output. The v0.1 repository candidate therefore incorporates a deterministic worktree-content digest (excluding `.git` and `node_modules`) so content changes under an unchanged untracked pathname invalidate stale review.

### D-020 — Codex CLI capability reporting is conservative

**Decision:** `CodexCliDriver` reports only capabilities established by that driver. Child command evidence is `reported-only`; repository-state observation remains a Parent/runtime responsibility; read-only is requested but not independently observed; hooks/plugins are not claimed merely because a Codex installation may support them.

### D-021 — Persisted run evidence is immutable by run ID

**Decision:** An existing run artifact directory must never be overwritten. Run directories are created once, artifact files use exclusive creation, and private filesystem modes are requested where the platform supports them. Reusing a run ID is an error rather than an evidence rewrite.

### D-022 — Compliant configuration validation is fail-closed

**Decision:** Runtime JSON validation must reject incomplete role mappings, a disabled Fresh Reviewer read-only request, malformed evidence policy entries, and malformed Owner Contracts. TypeScript types alone are not accepted as validation for untyped configuration input.

### D-023 — R2 packet return/side-effect fields are restored

**Decision:** The R2 `return contract` is a required non-empty v0.1 packet string. R2 also names expected and forbidden side-effect rules without defining a rule object shape; v0.1 therefore represents each `SideEffectRule` minimally as a non-empty string and exposes optional `expectedSideEffects` / `forbiddenSideEffects` arrays in the execution contract. This restores the omitted R2 surface without inventing a larger side-effect ontology.

## Owner-approved v0.1 release security gate — 2026-08-28

### D-024 — Full Codex Security is optional, not a mandatory v0.1 release gate

**Decision:** MandateMarshal v0.1 does not require a full Codex Security repository scan before every release. For the current repository size and attack surface, the mandatory release gate is the bounded, reproducible security suite already exercised locally: dependency audit, trust-boundary/static review, secret/local-path/publication-set scans, regression and conformance tests, strict typecheck, clean-clone frozen-install verification, package dry-run, and isolated packed-package install smoke.

A full Codex Security scan remains an optional higher-assurance review for future releases or materially larger attack surfaces, such as new network-facing inputs, remote services, parsers/deserializers for untrusted data, broader plugin execution, or other substantial privilege boundaries. An unavailable or unfinished Codex Security run is therefore not a release blocker by itself.

**Approved by Owner:** 2026-08-28.

## v0.2 durable-runtime decisions — 2026-08-31

### D-025 — Recovery uses journal plus observation, not blind retry

**Decision:** Important external operations are preceded by a durable intent record. After a crash, an unfinished intent is reconciled from observed external state and classified as completed, retryable, waiting, or reconciliation-required. Runtime process death alone is never evidence that the external action did not happen.

### D-026 — Journal is authoritative for replay; snapshots are acceleration

**Decision:** Durable state-machine events are append-only and sequence checked. Snapshots carry engine continuation data, but a transition durably appended after the latest snapshot is recovered by replaying the journal rather than discarded in favor of the older snapshot.

### D-027 — Durable runs are single-writer

**Decision:** One lease owner may advance a durable run at a time. Live owners renew the lease. Expired takeover is explicit, and lease tokens prevent a stale owner from releasing a replacement lease.

### D-028 — Codex persistent sessions are observed conservatively

**Decision:** Normal Codex runs remain ephemeral. A durable Codex operation persists its thread/session and external operation mapping outside the target repository. A validated completed session may be recovered without relaunching the child. An incomplete thread is not automatically resumed solely because `codex exec resume` exists; if duplicate side-effect safety cannot be proven, recovery remains reconciliation-required.

## v0.2.2 update/pin decision — 2026-09-03

### D-029 — Codex updates pin an exact released Git tag

**Decision:** MandateMarshal's preferred Codex update path is `mandatemarshal pin <version|latest>`. `latest` resolves once to a published GitHub Release and is then treated as that exact version. The Codex plugin marketplace is configured at the corresponding immutable Git tag, and the package/plugin/Skill versions must match before the pin is accepted.

The pin record lives outside target repositories under `~/.mandatemarshal/pin.json`. Normal CLI commands delegate to the CLI source in the pinned marketplace checkout so plugin/Skill metadata and runtime implementation do not silently drift apart. Changing the pin requires a new Codex session to reload Skill/agent metadata.

## v0.2.3 Windows pin hotfix — 2026-09-03

### D-030 — Pinning resolves the installed Codex CLI rather than assuming shell PATH

**Decision:** `mandatemarshal pin` resolves Codex from an explicit override, the active PATH, and known Codex/npm install locations before failing. A Windows shell where `codex` is installed but absent from the inherited PATH must not make release pinning unusable.
