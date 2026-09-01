# MandateMarshal v0.2.0 Release Checklist

This checklist is the publication gate for MandateMarshal v0.2.0.

## Code and authority contracts

- [x] Provider-neutral core contains no provider/model branding.
- [x] Fresh Reviewer protocol remains exactly `PASS | FIX | ESCALATE`.
- [x] Fresh Reviewer cannot self-fix by workflow design.
- [x] Post-fix and post-mutation freshness remain candidate-bound.
- [x] Owner-level policy cannot be silently mutated by Parent/Reviewer APIs.
- [x] Routine-to-complex reclassification remains explicit and auditable.
- [x] No silent model/role/effort fallback exists in the Codex adapter.
- [x] Activation remains explicit-first, project-persistent, external to the target repository, and fail-closed on malformed records.

## Durable runtime

- [x] Important external operations persist an intent before execution.
- [x] Recovery distinguishes completed, retryable, waiting, and reconciliation-required outcomes from observed state.
- [x] Missing local completion state alone never proves an external operation did not happen.
- [x] Duplicate live idempotency keys are rejected.
- [x] Journal entries are append-only, sequence checked, and flushed before being relied on for recovery.
- [x] Versioned snapshots restore continuation state while newer state-machine transitions remain replayable from the journal.
- [x] Journal corruption/sequence gaps fail closed.
- [x] Durable runs enforce a single active writer with lease heartbeat, token validation, and explicit expired-lease takeover.
- [x] Implementer-launch crash recovery is covered by fault-injection tests.
- [x] Fresh Reviewer-launch crash recovery is covered by fault-injection tests.
- [x] Parent verification is retried only at its explicitly idempotent boundary.
- [x] Completed artifact bundles can be reconciled after crash without blind replacement writes.
- [x] `mandatemarshal run status` and `mandatemarshal run resume` inspect/request resume without direct snapshot editing.

## Codex provider surface

- [x] Codex routine default: Luna / Max.
- [x] Codex complex default: Terra / High.
- [x] Codex Fresh Reviewer default: Sol / High.
- [x] Fresh Reviewer requests read-only sandbox.
- [x] Ordinary Codex runs remain ephemeral.
- [x] Durable Codex operations persist operation-to-thread mapping outside the target repository.
- [x] A validated completed Codex session can be recovered without relaunching the child.
- [x] An incomplete/ambiguous Codex session is not auto-resumed merely because `codex exec resume` exists.
- [x] Claude Code remains explicitly experimental and fixture-level only; production parity is not claimed.

## Verified quality gates

- [x] Strict TypeScript typecheck passes with `0` diagnostics.
- [x] Full test suite passes: `73/73` tests, `247` assertions.
- [x] `bun audit` reports `0` vulnerabilities.
- [x] Real Codex three-lane smoke passes: Luna/Max complete, Terra/High complete, Sol/High Fresh Reviewer PASS.
- [x] Real durable Codex smoke passes: persistent thread captured and completed operation recovered by durable observer.
- [x] Windows real-host smoke cleanup is robust enough to exit `0` after the provider checks pass.
- [x] `git diff --check` is clean.
- [x] Package dry-run contains the intended v0.2 distribution surface (`64` files at final pre-release audit).
- [x] Local-only `docs/ROADMAP.md`, `.stackmarshal/`, provenance bundle/master, local npm-ignore helpers, and generated local runtime state are excluded from the publication surface.
- [x] No `NUL` local artifact remains in the repository root.

## Reproducible v0.2 release gate

Run from the repository root:

```bash
bun install --frozen-lockfile
bun audit
bun run check
bun run smoke:codex
bun run smoke:codex:durable
npm pack --dry-run --json
```

Also review the intended Git/publication set for secrets, credentials, personal/local absolute paths, generated artifacts, dangerous Codex bypass flags, unexpected executable/write surfaces, and trust-boundary changes.

Full Codex Security remains an optional higher-assurance review under D-024. Escalate to it when the attack surface materially grows, for example with network-facing inputs, untrusted parsers/deserializers, remote services, broader plugin/process privilege, or other substantial security boundaries.

## Documentation synchronization

- [x] `README.md` describes v0.2 durable recovery and its deliberate limits.
- [x] `docs/DURABLE_RUNTIME.md` documents journal, snapshots, operation reconciliation, leases, CLI, Codex durable behavior, and fault-injection coverage.
- [x] `docs/ARCHITECTURE.md` describes the durable runtime boundary.
- [x] `docs/CODEX_SETUP.md` distinguishes normal ephemeral Codex runs from durable persistent-thread runs.
- [x] `SECURITY.md` targets `0.2.x` and covers crash-recovery ambiguity, durable-state tampering, leases, and Codex persisted-session trust.
- [x] `docs/DECISIONS.md` contains v0.2 durable-runtime decisions.
- [x] `CHANGELOG.md` contains v0.2.0 dated 2026-09-01.
- [x] `package.json` version is `0.2.0` and metadata mentions durable recovery.

## Release engineering

- [x] Public repository remains `Soph1yzzz/mandatemarshal` with default branch `main`.
- [x] Existing `v0.1.0` release remains untouched.
- [ ] v0.2.0 release commit created from the audited working tree.
- [ ] `main` pushed and GitHub Actions CI verified on the release commit.
- [ ] Annotated `v0.2.0` tag pushed.
- [ ] GitHub Release `MandateMarshal v0.2.0` published from that tag.

Publication must not proceed if the reproducible v0.2 gate is red or if local/private artifacts appear in the Git/package publication surface.
