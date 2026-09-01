# Architecture

MandateMarshal separates **authority**, **orchestration**, **provider integration**, and **mechanical evidence** so capability does not silently become decision ownership.

## Layers

### Core — `src/core/**`

Provider-neutral domain only:

- authority contracts;
- Owner Contract store;
- implementation/review/escalation wire types;
- candidate identity primitives;
- explicit run state machine;
- validation.

No provider/model branding is allowed here. A conformance test enforces the rule.

### Orchestrator — `src/orchestrator/**`

Owns policy transitions over core contracts:

- settled routine vs complex classification;
- explicit `LaneReclassified` events;
- implementation -> Parent verification -> fresh review loop;
- FIX correction loop;
- ESCALATE owner-decision path;
- fresh-review capability gating;
- reviewer-mutation detection;
- final completion gate.

### Runtime — `src/runtime/**`

Deterministic mechanisms:

- command-policy validation;
- forbidden-artifact scanning;
- write-path ownership checks;
- Git/non-Git repository state;
- candidate re-observation;
- external run-artifact persistence;
- external project-activation persistence;
- append-only durable run journals and sequence validation;
- durable snapshots plus state-machine replay;
- operation intent/observation/completion reconciliation;
- single-writer run leases with renewal and explicit expired takeover.

### Adapters — `src/adapters/**`

Host-specific mapping and transport:

- `codex/`: approved Codex role mappings, CLI driver, and durable-operation observer;
- `claude-code/`: experimental bridge contract only;
- `generic/`: deterministic mock used by conformance/integration tests.

Provider capability must be reported truthfully. Requested capability and observed capability are distinct.

## State machine

Primary happy path:

```text
IDLE
 -> INTAKE
 -> CONTRACT_CHECK
 -> PLANNING
 -> READY_TO_DELEGATE
 -> IMPLEMENTING
 -> PARENT_VERIFYING
 -> FRESH_REVIEWING
 -> ACCEPTING
 -> COMPLETED
```

### FIX loop

```text
FRESH_REVIEWING
 -> CORRECTION_REQUIRED
 -> IMPLEMENTING
 -> PARENT_VERIFYING
 -> FRESH_REVIEWING   # new reviewer context
```

The old review is invalid after correction/candidate change.

### Reviewer escalation

```text
FRESH_REVIEWING
 -> AUTHORITY_CONFLICT
 -> USER_DECISION_PENDING
```

Parent may instead resolve a reviewer concern inside Parent-owned architecture and replan when no Owner decision is required. Reviewer itself never owns that decision.

### Routine complexity reclassification

```text
routine IMPLEMENTING
 -> worker returns bounded BLOCKED complexity report
 -> Parent inspects reason
 -> LaneReclassified(routine -> complex)
 -> READY_TO_DELEGATE
 -> complex IMPLEMENTING
```

This path is intentionally different from model/capability failure. If the configured Luna/Max lane cannot launch, the adapter surfaces the capability failure and does not substitute Terra/High.

## Durable runtime boundary

v0.2 durability is opt-in per engine run and persists outside the target repository under `~/.mandatemarshal/runtime/` by default.

The runtime records important external boundaries as `intent -> external action -> observation -> completion`. A crash between those steps does not authorize a blind retry. Recovery classifies unfinished operations as completed, retryable, still running, or reconciliation-required from observed evidence.

State-machine events are replayable. Snapshots accelerate recovery but are not treated as a replacement for the journal: a transition durably appended after the last snapshot is recovered from the journal.

One lease owner may advance a durable run at a time. The live runtime renews its lease; takeover of an expired lease is explicit.

For durable Codex operations, the CLI driver persists the Codex thread ID outside the target repository and can recover a validated completed result from Codex session JSONL. An incomplete Codex thread is not automatically resumed because session resumability alone does not prove that retrying remaining work is side-effect safe.

See `docs/DURABLE_RUNTIME.md`.

## Project activation boundary

MandateMarshal activation is **explicit-first, project-persistent**. The first activation for a project requires explicit user selection. Runtime persistence then records activation outside the target repository under `~/.mandatemarshal/projects/` by default.

The v0.1 project key is a SHA-256 digest of the canonical project path. Registry records validate both that key and the canonical path before use. Explicit disable persists a disabled record.

Activation selects the MandateMarshal workflow; it does not grant or modify Owner Contracts, destructive-action permission, or architecture authority.

Host Skill discovery is outside the provider-neutral core. Some hosts decide whether to load the Skill before runtime code can query the registry, so v0.1 documents current-context continuation as a fallback rather than claiming universal pre-dispatch auto-rediscovery.

## Candidate identity

A reviewer PASS authorizes exactly one candidate identity.

For Git-backed repositories, the runtime helper derives identity from the base revision, status, diff, and a deterministic worktree-content digest. The additional digest closes the normal Git-diff gap for untracked-file contents. `.git` and `node_modules` are excluded from that filesystem digest. For non-Git repositories the same deterministic content-digest mechanism is the primary identity source.

Parent re-observes candidate identity after Fresh Reviewer execution. Any mutation blocks acceptance even if the reviewer returned PASS.

## Authority boundary

Owner Contracts can enter or change through the explicit user-decision API. There is intentionally no Parent/Reviewer mutation API on `OwnerContractStore`.

Parent conflict handling is decision-ready rather than passive:

1. detect exact conflict;
2. investigate simultaneous solutions;
3. prepare options, impacts, and reversibility;
4. hold only the conflicting action;
5. escalate the smallest Owner-only decision.

## Evidence trust

Evidence trust levels:

- `OBSERVED`
- `REPORTED`
- `INFERRED`
- `UNAVAILABLE`

Child claims must not be silently promoted to observed facts.

## ParentController boundary

`OrchestrationEngine` deliberately receives an application/host-supplied `ParentController`.

This boundary owns the judgment-heavy responsibilities that cannot be faithfully reduced to transport code:

- planning under Owner Contracts;
- candidate verification;
- observing the exact candidate state;
- deciding whether a routine worker's bounded blockage is true complexity;
- preparing bounded corrections;
- converting reviewer ESCALATE findings into a decision-ready escalation packet.

The engine owns state-transition enforcement; Parent owns contextual judgment within authority.
