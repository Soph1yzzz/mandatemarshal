# Durable Runtime — v0.2

MandateMarshal v0.2 adds a durable orchestration runtime for crash recovery without weakening the authority model.

The central rule is:

> A crash does not turn uncertainty into permission to repeat an external action.

## What is persisted

Durable runs live outside the target repository by default:

```text
~/.mandatemarshal/runtime/<run-id>/
  meta.json
  events.jsonl
  lease.json                 # only while a live writer owns the run
  snapshots/
    <sequence>-<time>.json
```

Provider recovery metadata also lives outside the target repository. For Codex:

```text
~/.mandatemarshal/providers/codex/operations/<operation-id>.json
```

The target repository is not dirtied merely because durability is enabled.

## Journal

`events.jsonl` is append-only and sequence checked. Entries include:

- state-machine events;
- external-operation intent;
- external-operation observation;
- external-operation completion;
- explicit abandonment of a retryable operation;
- operator commands.

Each append is flushed before the runtime proceeds past the corresponding durable boundary.

A missing or corrupt sequence fails closed. MandateMarshal does not silently skip a broken section of the journal.

## Snapshots and replay

Snapshots contain the current state-machine snapshot plus the durable engine state required to continue orchestration.

Recovery uses both:

1. the latest valid snapshot for durable engine data;
2. persisted state-machine events replayed in order to recover transitions that may have been journaled after the last snapshot.

This closes the crash window where a transition reached the journal but the following snapshot write did not complete.

A Fresh Reviewer `PASS` remains bound to the exact candidate after replay. Recovery never revives a stale PASS for a different candidate.

## External-operation protocol

Potentially non-idempotent boundaries use an explicit protocol:

```text
operation intent
  -> external action
  -> observe actual external state
  -> operation completion
```

Current durable boundaries include:

- implementer launch;
- Fresh Reviewer launch;
- Parent verification;
- final run-artifact persistence.

Every operation receives an operation ID and idempotency key.

On recovery an unfinished operation is classified as one of:

- `completed` — external evidence proves it finished; reuse the observed result;
- `retryable` — authoritative evidence proves the operation did not happen;
- `waiting` — the original operation is still running;
- `reconciliation-required` — the runtime cannot prove what happened.

`reconciliation-required` is a deliberate safety state. It prevents a crash from causing a duplicate external action.

## Single-writer lease

A durable run has one active writer.

The runtime acquires a lease with:

- owner ID;
- random token;
- acquisition time;
- expiry time.

The live runtime renews the lease periodically. A second writer cannot enter while the lease is current.

An expired lease is not taken over implicitly by ordinary acquisition. Recovery must explicitly allow expired-lease takeover. Token checks prevent an old owner from releasing a lease that has already been replaced.

## Codex durable observation

Normal Codex v0.1-style runs remain ephemeral.

When a MandateMarshal durable operation is supplied, the Codex CLI driver instead:

1. starts Codex with JSON event output and persistent session storage;
2. observes `thread.started` as soon as Codex emits it;
3. records the operation ID to Codex thread ID mapping outside the target repository;
4. stores the final validated implementation/review result when the call returns successfully.

After a MandateMarshal crash, the Codex adapter can inspect that mapping and Codex's persisted session JSONL.

Safe outcomes are:

- validated completed result exists -> recover it without launching a duplicate child;
- the Codex process is still alive -> report `waiting`;
- a thread exists but no validated completion can be proven -> report `reconciliation-required`;
- no mapping exists -> report `unknown`, not `not-found`.

MandateMarshal intentionally does **not** automatically call `codex exec resume` for an incomplete thread. Session resumability does not by itself prove that replaying the remaining work cannot duplicate a non-idempotent side effect.

## Operator CLI

Inspect a durable run:

```bash
mandatemarshal run status <run-id>
```

Record a resume request and receive the engine resume options when the run is safe to resume:

```bash
mandatemarshal run resume <run-id>
```

Use `--root <path>` when the runtime root is not the default.

The CLI does not edit snapshots directly. Operator actions are appended as journal commands.

A reconciliation-required status uses a distinct non-zero exit code so automation cannot confuse it with a safe resume.

## Library use

Enable durability by supplying `durability` to `OrchestrationEngine`:

```ts
const engine = new OrchestrationEngine(adapter, parent, {
  runId: "run-123",
  durability: {},
});
```

Resume the same run:

```ts
const engine = new OrchestrationEngine(adapter, parent, {
  runId: "run-123",
  durability: { resume: true },
});
```

If the adapter implements durable-operation observation, the engine uses it automatically. A caller can also supply an explicit `durability.observer` for another host/runtime.

## Fault-injection coverage

v0.2 regression tests deliberately simulate crashes at critical boundaries, including:

- immediately after implementer launch;
- immediately after Fresh Reviewer launch;
- completed external work before MandateMarshal records operation completion;
- ambiguous unfinished external work;
- journal corruption;
- lease expiry and takeover.

The tests assert that ambiguous operations are not silently duplicated.

## Deliberate v0.2 limits

v0.2 is the durable recovery foundation, not yet the full fleet control plane.

It does **not** yet provide:

- automatic worktree-per-run isolation;
- semantic Git checkpoint commits and candidate lineage across worktrees;
- a built-in daemon that keeps a run detached after the launching host process exits;
- a scheduler or multi-run fleet queue;
- a dashboard;
- automatic continuation of an incomplete Codex thread when side-effect safety cannot be proven.

Those features should build on this journal/reconciliation layer rather than bypass it.
