# Run Receipts and Temporary Trace — v0.2.6

MandateMarshal uses a lightweight run envelope for Skill-driven orchestration so real Codex work can be traced without forcing every Skill invocation through the full durable engine. v0.2.6 adds a lifecycle bridge so normal Skill transitions no longer depend on manually copying candidate IDs between separate capture/record commands.

## Two evidence layers

### Persistent receipt

The latest recovery- and authority-relevant facts live outside the target repository under:

```text
~/.mandatemarshal/receipts/<run-id>.json
```

A receipt is intentionally small. It records the canonical run ID, project identity, MandateMarshal version, run mode, current/terminal status, mechanically observed candidate identity, Git HEAD when available, latest Implementer/Reviewer thread references, Parent verification binding, latest verdict, and Fresh PASS candidate binding.

Receipt cleanup is not part of the detailed-trace TTL. A trace expiring must not erase facts needed to determine which candidate was verified or passed.

### Detailed developer trace

Structured lifecycle events are also appended under the OS temporary directory:

```text
Windows: %TEMP%\mandatemarshal\traces\<run-id>.jsonl
Unix:   $TMPDIR/mandatemarshal/traces/<run-id>.jsonl
         or the platform temporary directory when TMPDIR is not set
```

The trace has a fixed **30-day TTL** in v0.2.6. Receipt/trace operations opportunistically delete trace files whose last filesystem modification is older than 30 days. There is no background service and no TTL configuration in v0.2.6.

If an active run receives another event after its old trace expired, a new trace file may begin at a later sequence. `run history` reports that history as partial. The persistent receipt remains authoritative for the current minimal state.

A configurable TTL may be considered later if real-world use justifies it; v0.2.6 deliberately keeps the policy fixed.

## Skill-driven lifecycle

For a normal Skill-driven objective:

```text
mandatemarshal run ensure <project-root>
```

`ensure`:

- reuses the only active receipt for the same canonical project;
- creates a new receipt if none exists;
- serializes concurrent creation with a short-lived project lock so simultaneous host contexts converge on one active run;
- fails rather than guessing if multiple active receipts already exist.

Use the lifecycle bridge for normal Skill operation:

```text
mandatemarshal run advance <run-id> implementer-started --thread <thread-or-handle>
mandatemarshal run advance <run-id> parent-verified
mandatemarshal run advance <run-id> reviewer-started --thread <reviewer-thread-or-handle>
mandatemarshal run advance <run-id> review-verdict --verdict PASS|FIX|ESCALATE
mandatemarshal run advance <run-id> run-completed
```

`parent-verified`, `reviewer-started`, `review-verdict`, and `run-completed` mechanically re-observe the repository candidate from Git state, diff, and worktree bytes before publishing the requested transition. Git HEAD is stored separately when available and is never treated as the complete candidate identity.

If the observation changed, `run advance` first persists `candidate-observed`, which invalidates stale Parent/PASS bindings before the requested transition is evaluated. If the candidate is unchanged, the observation is not duplicated in the temporary trace; the transition itself carries the mechanically observed candidate binding where required.

A `FIX` clears any Fresh PASS binding. Record `mandatemarshal run advance <run-id> correction-started`, correct the bounded issue, Parent-verify it, and use a new Fresh Reviewer. Completion remains fail-closed and is rejected unless the mechanically re-observed current candidate retains a Fresh `PASS`.

Low-level `run capture` and `run record` remain available for compatibility and developer diagnostics. Generic `run record` still cannot publish `candidate-observed`, so callers cannot fabricate mechanical candidate evidence.

## Inspection

```text
mandatemarshal run list
mandatemarshal run show <run-id>
mandatemarshal run history <run-id>
```

`show` reads the persistent minimal receipt. `history` combines that receipt with the temporary structured trace when the trace is still available. Run-level receipt updates are serialized with a short-lived filesystem lock so concurrent contexts cannot silently lose an event; trace appends occur under the same run lock to preserve sequence order.

## Durable runtime distinction

The receipt schema can distinguish `skill-contract` from `durable-runtime`, but v0.2.6's public `run start` / `run ensure` CLI always creates `skill-contract` receipts and rejects a caller-supplied mode override. `durable-runtime` is reserved for a future/internal integration that can prove the actual durable engine created the run; it cannot be claimed by a CLI label alone.

A Skill receipt improves real-world traceability but does not claim durable external-operation reconciliation merely because a receipt exists. The existing durable runtime remains the stronger crash-recovery mechanism for external operation intent/observation/reconciliation. These two concepts must not be silently conflated.
