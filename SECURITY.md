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
- the pinned plugin's Skill/agent files overwrite the known legacy global MandateMarshal copies so stale pre-v0.2.2 manual installs cannot win discovery;
- package, root plugin, marketplace plugin, canonical Skill, marketplace Skill, and bundled agent copies are regression-tested for version/content drift;
- pin state is stored outside target repositories under `~/.mandatemarshal/pin.json`;
- normal CLI commands delegate to the pinned marketplace checkout so a newer Skill cannot silently drive an older runtime implementation.

The GitHub repository/release account and the local same-user Codex/MandateMarshal homes are trusted distribution surfaces. v0.2.2 does not add independent release-signature verification beyond Git tag/release and metadata consistency checks.

## Secrets and evidence

Do not store complete environments, credentials, API keys, or unbounded stdout/stderr in run artifacts.

The current evidence model supports excerpts/trust metadata. Integrators should redact secret-bearing output before persistence and prefer external evidence storage. Persisted run directories are create-once by run ID; artifact files use exclusive creation and request `0600` file / `0700` directory modes where the platform supports POSIX-style permissions.

`CodexCliDriverOptions.command` and the `MANDATEMARSHAL_CODEX_BIN` pinning override are trusted operator configuration only. Do not populate either from repository content, model output, or other untrusted input. MandateMarshal intentionally exposes no arbitrary `extraArgs` injection surface for Codex CLI flags. Pinning resolves Codex only from the explicit trusted override, the active PATH, and known same-user Codex/npm install locations.

## Destructive actions

Destructive or materially irreversible operations belong in the implementation packet and authority analysis. If such an action is not explicitly authorized and cannot be made obviously local/reversible, Parent should hold and escalate it.

## Reporting a vulnerability

Before a public security contact is established, avoid opening a public issue that contains an exploit or secret. Repository maintainers should add a private security reporting channel when the GitHub repository is published.
