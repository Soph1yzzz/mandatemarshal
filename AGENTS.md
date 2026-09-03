# MandateMarshal Repository Contract

This file is normative for this repository. The archived R2 specification bundle remains design provenance; this file plus `docs/DECISIONS.md` define the implemented v0.2 contract.

## Mission

Build a portable, authority-aware coding-agent orchestration system where agents maximize autonomous execution inside settled boundaries and escalate decisions they do not own.

## Invariants

1. User/Owner is the highest decision authority.
2. Autonomy does not imply authority.
3. Parent may optimize inside Owner Contracts but may not silently rewrite them.
4. Owner-level conflicts follow `DETECT -> INVESTIGATE -> PROPOSE -> HOLD -> ESCALATE`.
5. Hold only the affected action; uncertainty must not create permanent policy.
6. Implementers operate inside complete packets and settled architecture.
7. Every compliant completion requires a fresh reviewer for the exact final candidate.
8. Fresh Reviewer is read-only QA/code/execution review, not a second architect.
9. Reviewer verdicts are exactly `PASS | FIX | ESCALATE`.
10. Reviewer never implements its own fixes.
11. Any correction or post-review candidate mutation invalidates the old review.
12. Mechanical facts should be verified deterministically where possible.
13. Never silently substitute model, role, effort, permission, isolation, or capability.
14. Core remains provider-neutral; provider names belong behind adapters/configuration.
15. Codex v0.1 defaults: routine = Luna/Max, complex = Terra/High, fresh reviewer = Sol/High.
16. Complexity reclassification is explicit and distinct from capability fallback.
17. Run evidence must not dirty the target repository by default.
18. MandateMarshal activation is explicit-first and project-persistent; activation state must live outside the target repository by default and must not grant Owner-policy authority.
19. Durable recovery must never infer that an unfinished external operation is safe to repeat merely because MandateMarshal crashed.
20. Durable state is append-only/replayable where possible; corrupt or ambiguous recovery evidence fails closed.
21. A durable run has one active writer. Expired-lease takeover must be explicit and must not let a stale owner release the replacement lease.
22. Provider session resumability is not equivalent to side-effect-safe retry. Incomplete provider sessions remain reconciliation-required unless completion or non-execution can be observed.
23. When the packaged CLI is available, Skill-driven coding objectives use one canonical run receipt across the full FIX/PASS loop; do not invent run IDs or silently fork a continuation into a second active receipt.
24. Recovery-critical receipt state is persistent under `~/.mandatemarshal/`; detailed developer trace is temporary, uses the OS temp directory, and has a fixed 30-day TTL in v0.2.5.
25. `plugins/mandatemarshal/skills/mandatemarshal/` is the single committed runtime Skill source. `skills/orchestration/` is migration-pointer material only and must not regain Skill frontmatter or a duplicate runtime copy.
26. Implementers do not create Git commits, tags, or pushes unless the implementation packet explicitly delegates that exact operation; Parent owns semantic commit/checkpoint decisions by default.

## Approved R2 implementation clarifications

The Owner approved these resolutions before v0.1 implementation:

- Implementation packet `routing` is required in both code and JSON Schema.
- Canonical schema filename is `schemas/implementation-packet.schema.json`.
- Codex Fresh Reviewer default is GPT-5.6 Sol / High.
- `routingObservation` is part of `HostCapabilities`.
- Implementation packet `returnContract` is required.
- R2 expected/forbidden side-effect rules are represented minimally as string rules in v0.1.

## Ownership

- `src/core/**`: provider-neutral authority, state, evidence contracts.
- `src/orchestrator/**`: orchestration policy and explicit state transitions.
- `src/adapters/**`: host/provider integration only.
- `src/runtime/**`: deterministic evidence, durable journal/snapshot persistence, recovery, leases, and activation utilities.
- `schemas/**`: wire contracts.
- `skills/**`, `prompts/**`, `templates/**`, `.codex-plugin/**`: host packaging and role behavior.
- `tests/**`: authority, execution, routing, portability, and integration regressions.

## Completion

Do not call a MandateMarshal run compliant-complete without a fresh PASS bound to the unchanged final candidate, retained evidence, and no pending escalation or Owner decision.
