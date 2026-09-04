<div align="center">

# MandateMarshal

### Give coding agents autonomy without accidentally giving them authority.

**Authority-aware orchestration for Codex and coding agents.**<br>
Bounded implementation. Fresh read-only review. Durable recovery. Deterministic evidence. No silent fallback.

[![CI](https://github.com/Soph1yzzz/mandatemarshal/actions/workflows/ci.yml/badge.svg)](https://github.com/Soph1yzzz/mandatemarshal/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/Soph1yzzz/mandatemarshal?display_name=tag)](https://github.com/Soph1yzzz/mandatemarshal/releases/latest)
[![License](https://img.shields.io/github/license/Soph1yzzz/mandatemarshal)](LICENSE)
[![Codex](https://img.shields.io/badge/Codex-supported-111827)](docs/CODEX_SETUP.md)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6)](tsconfig.json)

[Quick start](#quick-start) · [Why it exists](#why-mandatemarshal-exists) · [Durable runtime](docs/DURABLE_RUNTIME.md) · [Codex setup](docs/CODEX_SETUP.md) · [Architecture](docs/ARCHITECTURE.md) · [Security](SECURITY.md)

<img src="./assets/mandatemarshal-social-preview.png" alt="MandateMarshal social preview" width="100%" />

</div>

MandateMarshal separates **who may execute** from **who may decide**. Give coding agents room to work inside settled boundaries without letting implementation uncertainty silently become project policy.

## In 30 seconds

| Without MandateMarshal | With MandateMarshal |
| --- | --- |
| The agent asks you about every local implementation choice | Parent owns architecture and decomposition inside your Owner Contracts |
| Uncertainty silently turns into a new permanent rule | `DETECT -> INVESTIGATE -> PROPOSE -> HOLD -> ESCALATE` |
| A reviewer drifts into becoming a second architect | Fresh Reviewer is QA-only: `PASS | FIX | ESCALATE` |
| A requested model/role is unavailable and something else runs | Exact route or loud capability failure; no silent fallback |
| Review passes, then the candidate changes | The old `PASS` is invalid because review is bound to candidate identity |
| A child claims verification happened | Deterministic evidence captures commands, repository state, paths, and artifacts |
| The orchestrator crashes after launching a child | Durable intent/observation records prevent blind duplicate launches and recover proven completed work |

The core rule is simple:

> **Autonomy does not imply authority.**

## Quick start

### Verify from source

```bash
git clone https://github.com/Soph1yzzz/mandatemarshal.git
cd mandatemarshal
bun install --frozen-lockfile
bun run check
```

### Prepare a Codex project

Bootstrap the CLI once, pin the Codex integration to a released version, then explicitly activate the target project:

```bash
bun link
mandatemarshal pin latest
mandatemarshal activation enable /path/to/your-project
```

Use an exact release when you want reproducibility:

```bash
mandatemarshal pin 0.2.7
mandatemarshal pin status
mandatemarshal version
```

`mandatemarshal version` prints the runtime, exact pin, installed plugin, versioned plugin-cache manifest, cache Skill, and any legacy global Skill in one view. `mandatemarshal --version` and `mandatemarshal -v` print only the runtime version for scripts.

`pin` uses Codex's native plugin marketplace and treats Codex's exact versioned plugin cache (`~/.codex/plugins/cache/mandatemarshal/mandatemarshal/<version>`) as the only runtime Skill authority. The cache manifest and Skill version plus LF-normalized content hash must match the published release exactly. MandateMarshal no longer mirrors a discoverable global Skill into `~/.codex/skills/mandatemarshal`; an official legacy `SKILL.md` is removed during pinning only after its LF-normalized content is proven to match its own published release, while a customized same-name Skill causes pinning to stop rather than deleting it or falling back. After pinning or changing versions, start a new Codex session. Once that bundled Skill is loaded, say:

```text
Use MandateMarshal for this project.
```

The first use is explicit. After activation, MandateMarshal can continue for later work in the same project without making you repeat its name on every request. Since v0.2.5, Skill-driven objectives also use a lightweight canonical run receipt so a FIX/PASS loop can be traced across host-context continuations without forcing the full durable engine. See [Run Receipts](docs/RUN_RECEIPTS.md) and [Codex setup](docs/CODEX_SETUP.md).

## How it works

```mermaid
flowchart LR
    O["User / Owner Contracts"] --> P["Parent Orchestrator"]
    P --> R["Routine Implementer<br/>Luna / Max"]
    P --> C["Complex Implementer<br/>Terra / High"]
    R --> V["Parent Verification"]
    C --> V
    V --> F["Fresh Reviewer<br/>frontier profile · read-only"]
    F -->|PASS| A["Accept exact candidate"]
    F -->|FIX| P
    F -->|ESCALATE| O
```

The model names above are the **Codex adapter defaults**, not assumptions in the provider-neutral core. A candidate that changes after review loses its `PASS` and must be reviewed again.

## Why MandateMarshal exists

Powerful coding agents fail in two opposite ways:

- **Micromanagement:** they ask the user about every local implementation choice.
- **Authority overreach:** they encounter uncertainty and silently rewrite project policy, interfaces, or permanent constraints in order to finish.

Fresh reviewers create another failure mode when they drift from QA into becoming a second architect.

MandateMarshal encodes a different hierarchy:

```text
User / Owner
    ^ owner-level decisions only
    |
Parent Orchestrator ----> Implementer
    |                        |
    +---- Evidence/State <---+
    |
    +----> Fresh Reviewer (read-only QA)
```

That hierarchy is the concrete expression of the rule above: implementation authority stays bounded by Owner authority.

### Dogfooding evidence: independent review caught a production-only boundary bug

The Fresh Reviewer split has paid for itself in real project use. In downstream dogfooding, the Parent's focused verification passed, but a new read-only Fresh Reviewer found a production-only namespace-boundary defect that the focused checks had missed. The reviewer returned `FIX`; the bounded correction was made, the candidate was independently reviewed again, and only the newly reviewed candidate proceeded to downstream smoke. This is evidence that independent final-candidate review can add value; it is not a claim that a Fresh Reviewer catches every bug.

That is evidence for the architecture, not a claim that an independent reviewer catches every defect. The useful property is narrower: implementation and acceptance do not share exactly the same context and incentives, and a read-only reviewer can block a concrete final-candidate defect without acquiring authority to redesign the project.

## Role model

| Role | Owns | Must not do |
| --- | --- | --- |
| User / Owner | Project-level goals, Owner Contracts, exceptions, permanent and materially irreversible decisions | Be forced to decide routine implementation detail |
| Parent Orchestrator | Architecture, decomposition, semantic routing, verification, review handling, final acceptance | Silently mutate Owner Contracts |
| Routine Implementer | Bounded implementation inside a settled packet | Redesign architecture, self-promote lanes, or create Git commits/tags/pushes unless explicitly delegated |
| Complex Implementer | Higher-context bounded implementation | Treat complexity as permission to change Owner policy or create repository commits by default |
| Fresh Reviewer | Read-only QA/code/execution-contract findings | Implement fixes, mutate the repository, or act as a second architect |

Reviewer verdicts are exactly:

```text
PASS | FIX | ESCALATE
```

There is no reviewer `rethink` authority.

## Owner conflict protocol

When a request conflicts with an Owner Contract, Parent follows:

```text
DETECT -> INVESTIGATE -> PROPOSE -> HOLD -> ESCALATE
```

`HOLD` applies only to the affected action. Uncertainty must not create a permanent prohibition.

## Codex support

MandateMarshal is packaged for Codex and uses Codex custom-agent, model/effort routing, sandbox, Plugin, and Skill surfaces. Real-host acceptance smoke has executed the complete routine, complex, and Fresh Reviewer lanes successfully on Codex. v0.2 additionally runs a real Luna/Max durable-session smoke that persists the Codex thread ID and recovers the completed operation through the durable observer.

## Codex defaults

These are adapter defaults, not core assumptions:

| Semantic role | Default Codex model | Effort |
| --- | --- | --- |
| `routine-implementer` | `gpt-5.6-luna` | `max` |
| `complex-implementer` | `gpt-5.6-terra` | `high` |
| `fresh-reviewer` | selected frontier reviewer profile | `high` |
| Parent | inherit | inherit |

v0.2.7 ships two explicit Fresh Reviewer profiles at the Codex adapter boundary: `astra-high` (`gpt-6-astra` / High) and `sol-high-compat` (`gpt-5.6-sol` / High). During Astra's staged rollout, the packaged default remains `sol-high-compat` until the active Codex host exposes the exact Astra model. The rollout switch is one adapter-level selector; once switched, Sol remains an explicit compatibility profile rather than a silent fallback. The provider-neutral core never depends on either model name.

A settled bounded packet routes routine-first. Material complexity can be explicitly reclassified to complex with a `LaneReclassified` event. Failure to launch Luna/Max is **not** a reason to silently use Terra/High, and requesting Astra never authorizes silently substituting Sol.

Current Codex agent configuration supports project-scoped custom agents, per-agent model/reasoning configuration, and read-only sandbox requests. MandateMarshal records requested and observed capability separately rather than claiming requested isolation was enforced.

## Deterministic evidence

MandateMarshal uses machines for mechanical facts and model judgment for contextual review.

Built-in evidence primitives cover:

- exact command ledger ingestion;
- required/forbidden command checks;
- required flag checks such as a repository-specific `python -B` policy;
- Git/non-Git candidate identity;
- before/after repository state;
- diff capture;
- allowed/forbidden write-path checks;
- configurable forbidden-artifact scans;
- external run-artifact persistence.

By default persistent run evidence is written under:

```text
~/.mandatemarshal/runs/<run-id>/
```

so the target repository is not dirtied merely by being orchestrated.

## Skill run receipts and lifecycle bridge — v0.2.7

Normal Codex Skill orchestration carries one canonical MandateMarshal run identity across the full implementation/FIX/PASS loop. v0.2.6 added `run advance`; v0.2.7 makes candidate observation practical for repositories with large ignored artifact trees and defines the active-run version-upgrade boundary:

```bash
mandatemarshal run ensure /path/to/project
mandatemarshal run advance <run-id> parent-verified
mandatemarshal run advance <run-id> reviewer-started --thread <reviewer-handle>
mandatemarshal run advance <run-id> review-verdict --verdict PASS
mandatemarshal run advance <run-id> run-completed
mandatemarshal run show <run-id>
```

The persistent receipt under `~/.mandatemarshal/receipts/` stores only small authority/recovery facts such as project identity, current candidate, Git HEAD, Parent verification, thread references, and Fresh Reviewer binding. For Git repositories, candidate identity is now derived from Git HEAD, porcelain state, the HEAD-relative binary diff, and the bytes of non-ignored untracked files. MandateMarshal does **not** recursively hash unchanged tracked files or ignored artifact trees. This preserves candidate sensitivity to tracked and untracked work while avoiding the downstream dogfood failure mode where large frozen/ignored artifact trees were re-read on every candidate-bound transition. Non-Git repositories retain the recursive content digest fallback.

`run ensure` also defines an explicit version boundary. A live receipt may move in place across a newer patch release on the same minor line (for example `0.2.6 -> 0.2.7`) while preserving its run ID and original version. The upgrade is recorded as `runtime-upgraded`, and candidate, Parent-verification, verdict, and Fresh-PASS bindings are cleared so a changed candidate algorithm or runtime cannot inherit stale authority. Downgrades and cross-line automatic migration fail closed.

Project-level receipt creation and run-level receipt updates use short-lived filesystem locks to avoid duplicate active runs and lost updates across concurrent host contexts. Detailed structured trace lives under the OS temporary directory (`%TEMP%\\mandatemarshal\\traces` on Windows) with a **fixed 30-day TTL**. Trace writes/cleanup are best-effort and never delete or invalidate the persistent minimal receipt. The TTL remains intentionally fixed at 30 days in v0.2.7; configurability may be considered later if real-world use justifies it.

A `skill-contract` receipt improves traceability but is not the same claim as durable external-operation reconciliation. See [Run Receipts](docs/RUN_RECEIPTS.md).

## Durable crash recovery — v0.2

Durability can be enabled per orchestration run. The runtime persists an append-only journal and snapshots outside the target repository:

```text
~/.mandatemarshal/runtime/<run-id>/
```

Important external operations are recorded as an intent before execution and reconciled from observed state after a crash. Recovery distinguishes:

- completed work that can be reused;
- authoritative non-execution that permits retry;
- work that is still running;
- ambiguous work that must stop as `reconciliation-required` rather than risk a duplicate side effect.

A single-writer lease with heartbeat prevents two Parent runtimes from advancing the same durable run concurrently.

For Codex durable operations, MandateMarshal records the persistent Codex thread ID under `~/.mandatemarshal/providers/codex/operations/`. Completed session JSONL can be recovered without relaunching the child. Incomplete Codex sessions are deliberately **not** auto-resumed when side-effect safety cannot be proven.

Operator inspection:

```bash
mandatemarshal run status <run-id>
mandatemarshal run resume <run-id>
```

See [Durable Runtime](docs/DURABLE_RUNTIME.md) for recovery semantics, fault-injection coverage, and deliberate v0.2 limits.

## Fresh-review gate

A run may report compliant completion only when:

1. the current request is resolved under active Owner Contracts;
2. the implementation packet is complete;
3. Parent inspected the actual candidate;
4. required deterministic verification/evidence is available;
5. a **new fresh reviewer** returned `PASS` for the exact current candidate;
6. candidate identity did not change during or after review;
7. no escalation or Owner decision remains pending.

Any `FIX` invalidates the previous review. Any candidate mutation invalidates the previous `PASS`.

## Install from source

Requirements:

- Bun 1.3+
- Node.js 22+ for compatible tooling
- Codex CLI only when using the real Codex CLI driver
- access to the exact configured models/effort levels when using those mappings

```bash
bun install --frozen-lockfile
bun run check
bun run validate:config
```

### Preferred Codex install/update: pin a release

After the one-time CLI bootstrap, update Codex with one command:

```bash
mandatemarshal pin latest
```

Or pin an exact release:

```bash
mandatemarshal pin 0.2.7
mandatemarshal pin status
mandatemarshal version
```

`mandatemarshal version` is the quick human check: it reports the active runtime version, exact pin, installed Codex plugin version, canonical versioned-cache manifest/Skill versions, any legacy global Skill, and an `OK`/drift status. `--version`/`-v` emit only the runtime version.

The selected Git tag is installed through Codex's native plugin marketplace. MandateMarshal records the marketplace/runtime checkout separately from the exact versioned plugin-cache source under `~/.mandatemarshal/pin.json`. The versioned cache is the only runtime Skill authority; pinning fails instead of searching another copy when that exact cache is missing or mismatched. Legacy global Skill discovery is not used as a fallback. Normal CLI commands still delegate to the CLI source from the pinned marketplace checkout.

Start a new Codex session after changing the pin.

### Manual fallback: project-scoped Codex agent profiles

If you intentionally do not use the plugin marketplace, run MandateMarshal's legacy installer with the target `.codex/agents` directory:

```bash
bun run install:codex-agents -- /path/to/target/.codex/agents
```

The installer refuses to overwrite existing agent profiles unless `--force` is explicitly supplied after review.

The generated profiles request:

- Luna/Max + `workspace-write` for routine implementation;
- Terra/High + `workspace-write` for complex implementation;
- the current default Sol/High + `read-only` Fresh Reviewer;
- an explicit Astra/High + `read-only` Fresh Reviewer profile ready for rollout;
- an explicit Sol/High compatibility reviewer profile for post-rollout use.

See `docs/CODEX_SETUP.md`.

## Plugin / Skill packaging

The repository includes both the source packaging and a Codex marketplace package:

```text
.agents/plugins/marketplace.json
.codex-plugin/plugin.json
plugins/mandatemarshal/.codex-plugin/plugin.json
plugins/mandatemarshal/skills/mandatemarshal/
plugins/mandatemarshal/agents/                 # bundled agent profiles
skills/orchestration/SKILL.md                  # migration pointer only; not a runtime Skill
skills/orchestration/references/               # migration pointers only
```

`plugins/mandatemarshal/skills/mandatemarshal/` is the **single committed runtime Skill source**. The historical `skills/orchestration/` path intentionally contains only frontmatter-free migration pointers, avoiding two committed copies of the same Skill while keeping old repository links understandable.

MandateMarshal uses **explicit-first, project-persistent activation**. An unregistered project does not activate automatically. The first use requires an explicit user selection; after that, the same project can continue under MandateMarshal without repeating the brand on every request until explicitly disabled.

Persistent activation is stored outside the target repository:

```text
~/.mandatemarshal/projects/<project-id>.json
```

so activation itself does not dirty the project.

CLI controls:

```bash
mandatemarshal activation enable /path/to/project
mandatemarshal activation status /path/to/project
mandatemarshal activation disable /path/to/project
```

v0.1 project identity is based on the canonical project path. Moving or renaming a project may therefore require explicit activation again.

**Host limitation:** some Codex/agent hosts decide whether to load a Skill before MandateMarshal code can inspect this external registry. In those environments, a brand-new host context cannot yet be guaranteed to rediscover activation automatically; current-context continuation is the v0.1 fallback. MandateMarshal does not use that limitation as an excuse to auto-activate unrelated projects.

## Library architecture

```text
src/
  core/             # provider-neutral contracts, authority, state machine
  orchestrator/     # routing and PASS/FIX/ESCALATE loops
  runtime/          # deterministic evidence and persistence
  adapters/
    codex/           # Codex mapping + CLI driver
    claude-code/     # v0.1 experimental portability bridge
    generic/         # mock/conformance adapter
```

Provider/model branding is forbidden from `src/core/**` and enforced by the test suite.

### Core API sketch

```ts
import {
  CodexAdapter,
  CodexCliDriver,
  OrchestrationEngine,
  computeRepositoryCandidateId,
} from "mandatemarshal";

const driver = new CodexCliDriver({ cwd: process.cwd() });
const adapter = new CodexAdapter(driver);

// ParentController is application/host supplied because Owner-contract and
// architecture judgment must not be silently hardcoded into the transport.
const engine = new OrchestrationEngine(adapter, parentController);
const result = await engine.run(userRequest);
```

See `docs/ARCHITECTURE.md` for the contract boundaries.

## Configuration

`config.example.json` demonstrates the current v1 configuration schema. Hard invariants for a compliant run include:

- mandatory fresh review;
- fresh reviewer context required;
- `PASS | FIX | ESCALATE` only;
- reviewer never self-fixes;
- no silent model/role/effort fallback;
- post-review mutation invalidates `PASS`;
- Owner Contracts cannot be silently changed.

Repository-specific policies such as Python no-bytecode remain opt-in configuration, not global MandateMarshal law.

## Tests

The current suite covers authority, state, execution evidence, routing, durable crash recovery, Codex adapter conformance, provider-neutral core, and Claude portability fixtures.

Important regressions include:

- uncertainty cannot become silent permanent disablement;
- fresh `PASS` is mandatory and candidate-bound;
- stale review cannot authorize a mutated candidate;
- reviewer mutation blocks completion;
- reviewer `rethink` is schema-invalid;
- missing `python -B` is detected when configured;
- forbidden `.pyc` is detected mechanically;
- unowned writes are rejected;
- routine routes to Luna/Max;
- material complexity routes/reclassifies to Terra/High;
- unavailable exact effort/model selection does not silently fall back;
- a mock Claude Code bridge runs the same provider-neutral orchestration path;
- journal sequence corruption fails closed;
- an ambiguous crashed Implementer or Fresh Reviewer launch is not duplicated;
- an authoritatively absent operation can be retried once;
- a proven completed Codex durable operation is recovered without relaunching the child;
- Parent verification can safely retry after crash because that boundary is explicitly idempotent;
- a completed artifact bundle can be reconciled after a crash before the completion event was journaled;
- a live run lease heartbeat prevents stale-owner takeover.

Run:

```bash
bun test
```

## Pre-1.0 versioning

MandateMarshal uses the 0.x line as architecture milestones rather than treating every backward-compatible operational improvement as a new minor architecture. The current `0.2.x` line is reserved for compatibility-preserving real-world stabilization: traceability, packaging, recovery diagnostics, and bugs reproduced through dogfooding. `0.3.0` is reserved for the larger worktree-per-run, semantic-checkpoint, and candidate-lineage milestone.

## Claude Code status

Claude Code remains an **experimental bridge contract and conformance fixture**, not production parity. A real production-grade Claude Code adapter is planned after the provider-neutral seam has been validated in practice.

MandateMarshal deliberately does not market fixture-level portability as full runtime support.

## Security model

MandateMarshal is an orchestration layer, so security includes truthful reporting of authority and capability—not only conventional code vulnerabilities.

Threats explicitly considered include:

- capability spoofing;
- silent fallback;
- reviewer mutation;
- prompt injection through repository content;
- fabricated evidence;
- authority laundering;
- infinite perfection loops;
- permanent policy mutation under uncertainty.

See `SECURITY.md`.

## Upstream / provenance

The design specification was influenced by ideas in **Sol Advisor** (MIT), especially architect-first orchestration, bounded implementation packets, fresh review, and adapter direction.

MandateMarshal v0.1 source code in this repository was implemented independently from the supplied specification rather than copied from Sol Advisor source. If future versions import substantial upstream code, `THIRD_PARTY_NOTICES.md` must be updated with the exact upstream revision and derived files while preserving MIT notices.

## License

MIT. See `LICENSE`.

---

**MandateMarshal:** autonomy for implementation, explicit ownership for decisions.
