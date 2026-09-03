---
name: mandatemarshal
version: "0.2.3"
description: >
  Authority-aware coding-agent orchestration with explicit Owner/Parent/Implementer/Fresh-Reviewer
  boundaries, deterministic execution evidence, mandatory fresh QA, and no silent model/role fallback.
  Use when the user explicitly selects MandateMarshal/$mandatemarshal, or when the current coding
  project was previously explicitly activated for MandateMarshal and that activation is available
  through the project activation registry or the current host context.
---

# MandateMarshal

MandateMarshal gives coding agents broad implementation autonomy without silently granting them authority to rewrite project-level constraints.

## Invocation and project activation

MandateMarshal is **explicit-first, project-persistent**:

1. For an unregistered project, require an explicit user selection such as `MandateMarshalを使って`, `Use MandateMarshal`, or `$mandatemarshal`.
2. On that first explicit selection, enable the current project in the external activation registry when the packaged CLI/helper is available: `mandatemarshal activation enable <project-root>`.
3. Once enabled, later coding requests in the same project may continue under MandateMarshal without repeating the brand. If this Skill is loaded, `mandatemarshal activation status <project-root>` is authoritative when available.
4. An explicit request to stop/disable MandateMarshal disables that project: `mandatemarshal activation disable <project-root>`.
5. Never carry activation from one project to another merely because the conversation continues.

The registry lives outside the target repository under `~/.mandatemarshal/projects/` by default, so activation must not dirty the project.

### Current host limitation

A host may decide whether to load a Skill **before** MandateMarshal code can query the external registry. Therefore MandateMarshal cannot currently guarantee registry-driven auto-rediscovery in every brand-new host context. When pre-dispatch registry lookup is unavailable, continuation in an already-active project may rely on the current Codex/host context. This is a host-discovery limitation, not permission to auto-activate unrelated projects.

Do not recursively invoke MandateMarshal from inside one of its own Implementer or Reviewer roles.

## Authority hierarchy

1. **User / Owner** owns project-level goals, Owner Contracts, exceptions, permanent policy, and materially irreversible decisions.
2. **Parent Orchestrator** owns architecture, decomposition, routing, verification, and acceptance inside Owner Contracts.
3. **Implementer** owns bounded implementation detail inside a complete implementation packet.
4. **Fresh Reviewer** owns findings only. It is read-only QA, not a second architect.

Autonomy does not imply authority.

## Parent conflict protocol

When a request conflicts with an Owner Contract:

`DETECT -> INVESTIGATE -> PROPOSE -> HOLD -> ESCALATE`

Investigate before escalating. Hold only the conflicting action. Continue independent safe work where auditable. Never turn uncertainty into permanent prohibition.

## Routing

Core roles are semantic:

- `routine-implementer`
- `complex-implementer`
- `fresh-reviewer`

Default Codex mapping:

- routine -> GPT-5.6 Luna / Max
- complex -> GPT-5.6 Terra / High
- fresh reviewer -> GPT-5.6 Sol / High

These mappings are adapter configuration, not core ontology. A material complexity trigger may produce an explicit `LaneReclassified` event. Failure to launch a configured lane is a capability error and never authorizes silent substitution.

## Implementation packet

Before delegation, provide:

- semantic routing lane and reason;
- objective;
- owned files/paths;
- interfaces;
- constraints;
- execution contract, including expected/forbidden side effects when relevant;
- verification contract;
- return contract.

An incomplete packet must not enter implementation.

## Evidence

Prefer deterministic collection for deterministic facts:

- exact commands and exit codes;
- required flags;
- before/after repository state;
- full relevant diff;
- untracked/forbidden artifacts;
- write-path ownership;
- verification results.

Treat reported child evidence as reported, not observed.

## Fresh QA gate

Every compliant completion requires a fresh reviewer for the exact final candidate.

Reviewer verdicts are exactly:

- `PASS`
- `FIX`
- `ESCALATE`

The reviewer must remain read-only and must not implement fixes. A `FIX` invalidates the old review; after correction and Parent verification, start a new fresh reviewer. Any post-review candidate mutation invalidates the verdict.

If a reviewer discovers a concern requiring architecture or Owner authority, it returns `ESCALATE`; it does not redesign the system.

## Completion

Report compliant completion only when:

- request is resolved under current Owner Contracts;
- packet was complete;
- Parent inspected the actual candidate;
- required deterministic verification/evidence is available;
- final fresh reviewer returned PASS for the exact candidate;
- candidate remained unchanged after review;
- no escalation or Owner decision is pending.

Read `references/role-contracts.md` and `references/portable-entry.md` for compact host-neutral contracts.
