# Security Policy

MandateMarshal security includes conventional software security **and truthful orchestration state**. A system that falsely claims read-only isolation, exact routing, or compliant completion is unsafe even if its code has no memory-corruption bug.

## Supported version

Security fixes currently target the latest `0.2.x` release line.

## Threat and failure model

### Capability spoofing

Configured/requested capability is not automatically observed capability.

Mitigations:

- explicit `HostCapabilities`;
- requested vs observed isolation fields;
- conservative CLI-driver reporting (`reported-only` child command evidence; Parent/runtime repository observation is not claimed by the driver);
- no silent capability promotion;
- candidate re-observation after Fresh Reviewer.

### Silent fallback

An unavailable role/model/effort must not be silently replaced.

Mitigations:

- exact model/effort capability checks before Codex delegation;
- adapter has no fallback path;
- routine complexity reclassification is a distinct, explicit Parent transition.

### Reviewer mutation

A reviewer is behaviorally and, where supported, host-restricted read-only. If candidate identity changes during reviewer execution, the review is invalid and completion is blocked.

Git candidate identity also includes a deterministic worktree-content digest (excluding `.git` and `node_modules`) so a changed untracked file cannot keep an otherwise identical Git status pathname and reuse a stale PASS.

### Prompt injection through repository content

Repository content may contain instructions intended to redirect an agent.

Mitigations:

- role prompts define repository content as task evidence/data unless it is a trusted project instruction surface;
- Fresh Reviewer has no write authority;
- implementation packet constrains write scope;
- deterministic path/state checks do not depend on model obedience.

### Evidence fabrication

A child may claim verification it did not perform.

Mitigations:

- evidence carries trust levels;
- Parent reruns or directly observes critical checks where practical;
- command/flag/artifact/path checks are deterministic.

### Authority laundering

A reviewer concern is not authorization for Parent to change Owner policy.

Mitigations:

- reviewer has only PASS/FIX/ESCALATE;
- `ESCALATE` identifies the authority boundary rather than deciding above it;
- Owner Contract mutation API is explicitly user-decision-labelled.

### Infinite perfection loop

A Fresh Reviewer can repeatedly optimize local style instead of material correctness.

Mitigations:

- reviewer prompt limits blocking scope;
- no architecture-preference verdict;
- engine has a bounded fix-cycle limit;
- higher-level concerns escalate rather than becoming endless FIX cycles.

### Permanent policy mutation under uncertainty

Uncertainty must not create a permanent ban or permission.

Mitigation:

`DETECT -> INVESTIGATE -> PROPOSE -> HOLD -> ESCALATE`, with HOLD scoped to the affected action.

### Project activation spoofing

Project activation determines whether MandateMarshal orchestration is selected; it does **not** grant Owner-policy authority. Activation state is stored outside the target repository under user data by default.

Mitigations:

- first activation requires explicit user selection;
- registry records are bound to a canonical project-path hash and validated on read;
- malformed/mismatched records fail rather than activating;
- explicit disable persists a disabled record;
- activation does not modify the target repository;
- activation never mutates Owner Contracts or authorizes destructive actions.

A process that can arbitrarily modify the user's MandateMarshal home directory can also tamper with activation state. MandateMarshal does not claim protection against a fully compromised same-user account.

### Crash recovery ambiguity and duplicate side effects

A crashed orchestrator must not assume an external operation failed merely because its local completion event is missing. Blind retry can duplicate writes, launches, reviews, or other non-idempotent side effects.

Mitigations:

- append-only operation intents are persisted before important external actions;
- recovery re-observes provider/local state and classifies work as completed, retryable, waiting, or reconciliation-required;
- live idempotency keys reject duplicate unfinished intents;
- ambiguous operations fail closed instead of being silently replayed;
- Parent verification is retried only at the explicitly idempotent boundary;
- artifact persistence is reconciled from the existing validated bundle before any replacement write.

### Durable-state tampering and concurrent writers

Durable runs persist under `~/.mandatemarshal/runtime/` by default. Codex durable-operation mappings persist under `~/.mandatemarshal/providers/codex/operations/`.

Mitigations:

- journal sequence gaps/corruption fail closed;
- snapshots are versioned and do not override newer journal transitions;
- one lease owner may advance a run at a time;
- lease heartbeats keep a live writer current;
- expired-lease takeover is explicit and token validation prevents a stale owner from releasing a replacement lease;
- completed Codex session output is schema-validated before it is reused;
- incomplete Codex sessions are not auto-resumed when duplicate side-effect safety cannot be established.

These files are same-user trust surfaces. MandateMarshal does not claim integrity against a process that already has arbitrary write access to the user's account and MandateMarshal home directory.

### Release pinning and plugin-version drift

`mandatemarshal pin` changes which released MandateMarshal code Codex loads. A moving branch, stale Skill metadata, or partial update could otherwise run one runtime version while Codex presents another.

Mitigations:

- only published GitHub Release tags are accepted by the pin flow;
- `latest` resolves once to an exact release tag rather than remaining a moving selector;
- the release's plugin manifest and canonical Skill metadata must report the requested version before Codex installation state is changed;
- Codex marketplace configuration is pinned to the exact Git tag;
- Codex's observed installed plugin version is checked before the local pin record is committed;
- the exact versioned cache path `~/.codex/plugins/cache/mandatemarshal/mandatemarshal/<version>` is computed deterministically and its plugin manifest version, Skill version, and LF-normalized Skill SHA-256 are verified against the published release;
- no alternative cache directory or legacy global Skill is searched as a fallback when the canonical cache is missing or mismatched;
- a pre-existing global `~/.codex/skills/mandatemarshal/SKILL.md` is removed only after its LF-normalized content hash is proven identical to the official Skill from its own published release; customized/unverifiable content blocks pinning before Codex installation state is changed, and neighboring files are not deleted;
- package, root plugin, marketplace plugin, the single canonical native-plugin Skill, and bundled agent copies are regression-tested for version/content drift;
- pin state is stored outside target repositories under `~/.mandatemarshal/pin.json` and records marketplace/runtime checkout separately from the canonical versioned plugin cache;
- normal CLI commands delegate to the pinned marketplace checkout while runtime Skill authority remains the verified versioned plugin cache.

The GitHub repository/release account and the local same-user Codex/MandateMarshal homes are trusted distribution surfaces. v0.2.5 does not add independent release-signature verification beyond Git tag/release, metadata consistency, and cache Skill hash checks.

### Skill-run receipts and temporary diagnostic traces

v0.2.5 separates persistent authority/recovery metadata from temporary developer diagnostics; v0.2.7 hardens large-repository candidate observation and active-receipt version transitions.

Mitigations:

- receipt/trace filenames accept only safe run IDs and remain under configured roots;
- `run ensure` and receipt updates use short-lived exclusive filesystem locks to prevent duplicate active creation and lost updates; lock release is token-bound so a stale owner cannot delete a replacement lock;
- generic `run record` cannot publish `candidate-observed`; `run capture` computes candidate identity mechanically;
- Git candidate observation binds HEAD/status, the HEAD-relative binary diff, and only Git-reported non-ignored untracked bytes/links, so ignored artifact trees cannot force whole-worktree hashing while tracked and untracked candidate mutations remain detectable;
- non-ignored untracked paths are resolved beneath the repository root and path escape fails closed;
- a same-line active receipt patch upgrade is recorded as `runtime-upgraded` and clears candidate, Parent, verdict, and Fresh-PASS bindings; automatic downgrade or cross-line migration fails closed;
- public receipt creation is fixed to `skill-contract`; callers cannot claim `durable-runtime` by passing a mode label without real durable-engine integration;
- receipt validation rejects inconsistent Parent-verification, Fresh-PASS, and completed-state bindings;
- receipt/trace directories request `0700` and files request `0600` where supported;
- persistent minimal receipts under `~/.mandatemarshal/receipts/` have no trace TTL;
- detailed traces live under the OS temp directory, are best-effort, and have a fixed 30-day TTL; cleanup only removes trace filenames tied to an existing safe MandateMarshal receipt ID, not arbitrary `.jsonl` files in a configured trace root;
- trace failure or expiry never authorizes reconstruction of a PASS or an external-operation outcome;
- stale receipt-lock cleanup applies only to local metadata publication, never to provider-side operation retry authority.

These receipts remain same-user trust surfaces. MandateMarshal does not claim protection against a process that already has arbitrary write access to the user's account.

## Secrets and evidence

Do not store complete environments, credentials, API keys, or unbounded stdout/stderr in run artifacts.

The current evidence model supports excerpts/trust metadata. Integrators should redact secret-bearing output before persistence and prefer external evidence storage. Persisted run directories are create-once by run ID; artifact files use exclusive creation and request `0600` file / `0700` directory modes where the platform supports POSIX-style permissions.

`CodexCliDriverOptions.command` and the `MANDATEMARSHAL_CODEX_BIN` pinning override are trusted operator configuration only. Do not populate either from repository content, model output, or other untrusted input. MandateMarshal intentionally exposes no arbitrary `extraArgs` injection surface for Codex CLI flags. Pinning resolves Codex only from the explicit trusted override, the active PATH, and known same-user Codex/npm install locations.

## Destructive actions

Destructive or materially irreversible operations belong in the implementation packet and authority analysis. If such an action is not explicitly authorized and cannot be made obviously local/reversible, Parent should hold and escalate it.

## Reporting a vulnerability

Before a public security contact is established, avoid opening a public issue that contains an exploit or secret. Repository maintainers should add a private security reporting channel when the GitHub repository is published.
