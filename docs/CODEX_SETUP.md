# Codex Setup

MandateMarshal uses semantic roles in core and maps them to Codex-specific agent profiles only at the adapter/packaging boundary.

## Default mapping

| Role | Model | Reasoning effort | Requested sandbox |
| --- | --- | --- | --- |
| routine implementer | `gpt-5.6-luna` | `max` | `workspace-write` |
| complex implementer | `gpt-5.6-terra` | `high` | `workspace-write` |
| fresh reviewer | `gpt-5.6-sol` | `high` | `read-only` |
| Parent | inherit | inherit | host/session policy |

These mappings are exact requests. If the active Codex runtime cannot provide an exact configured model/effort combination, MandateMarshal must report the capability/configuration failure rather than silently substituting another role.

## Release pinning and updates

v0.2.2 adds a Codex-native update path. After the one-time MandateMarshal CLI bootstrap, use:

```bash
mandatemarshal pin latest
```

to resolve the latest published GitHub Release and pin Codex to that exact tag, or:

```bash
mandatemarshal pin 0.2.6
```

for a reproducible exact version. `mandatemarshal pin status` reports the recorded pin and detects installed-plugin/cache/Skill drift.

`mandatemarshal version` reports the runtime, pin, installed plugin, exact versioned-cache manifest/Skill versions, and any legacy global Skill together. `mandatemarshal --version` and `mandatemarshal -v` print only the runtime version.

The pin flow:

1. resolves and verifies a published MandateMarshal GitHub Release before mutating Codex state;
2. verifies the release's plugin manifest and the single canonical Skill at `plugins/mandatemarshal/skills/mandatemarshal/SKILL.md` report the same version;
3. checks any pre-existing global `~/.codex/skills/mandatemarshal/SKILL.md` before mutation; only an official released MandateMarshal Skill whose LF-normalized content hash matches its own release is eligible for automatic removal, while customized content blocks pinning;
4. configures the MandateMarshal Git repository as a Codex plugin marketplace at the exact release tag;
5. installs the `mandatemarshal@mandatemarshal` plugin from that marketplace;
6. verifies Codex reports the expected installed plugin version;
7. computes exactly `~/.codex/plugins/cache/mandatemarshal/mandatemarshal/<version>` as the canonical runtime plugin cache and verifies its plugin manifest version, Skill version, and LF-normalized Skill SHA-256 against the published release;
8. removes only the proven legacy global `SKILL.md` file so native plugin discovery is the only runtime Skill authority without deleting unrelated neighboring files;
9. stores the marketplace/runtime checkout and canonical versioned-cache source separately under `~/.mandatemarshal/pin.json`.

Normal MandateMarshal CLI commands still delegate to the CLI source inside the pinned marketplace checkout. Skill discovery is different: only the exact verified versioned plugin cache is authoritative. MandateMarshal does not search alternative cache copies or fall back to the legacy global Skill when the canonical cache is missing or mismatched.

Start a new Codex session after changing the pin so Codex reloads the selected Skill and agent metadata. On Windows, MandateMarshal resolves Codex from PATH first and then from known Codex/npm install locations, so `pin` does not require `codex` itself to be on the current shell PATH.

## Project-scoped agent profiles

Codex supports project-scoped custom agent definitions under:

```text
<target-repository>/.codex/agents/*.toml
```

MandateMarshal ships reviewed templates in `templates/codex-agents/`. Implementer profiles do not create Git commits, tags, or pushes unless the Parent packet explicitly delegates that exact repository operation; semantic commit/checkpoint ownership stays with Parent by default.

Install them into a target repository:

```bash
bun run install:codex-agents -- /path/to/target/.codex/agents
```

The installer refuses to overwrite an existing file. Use `--force` only after manually reviewing the destination and intended replacement.

After adding or changing custom agent profiles, start a new Codex session so future subagent tasks load the updated definitions.

## Real CLI driver

`CodexCliDriver` uses the installed Codex CLI and passes the exact configured model, reasoning effort, and sandbox request to `codex exec`. Normal runs remain ephemeral; v0.2 durable operations persist the Codex thread/session so a proven completed result can be recovered after an orchestrator crash.

Implementation child:

```text
codex exec --ephemeral ... -m <model> -c model_reasoning_effort="<effort>" -s workspace-write
```

Fresh Reviewer:

```text
codex exec --ephemeral ... -m <model> -c model_reasoning_effort="<effort>" -s read-only
```

The driver does not contain a model fallback table.

For a durable operation, MandateMarshal records the operation-to-thread mapping outside the target repository under `~/.mandatemarshal/providers/codex/operations/`. It observes the persisted Codex session JSONL conservatively: a validated completed result may be reused, a still-running process is reported as waiting, and an incomplete/ambiguous session remains reconciliation-required. `codex exec resume` availability is not treated as proof that automatic continuation is side-effect safe.

## Requested vs observed isolation

`sandbox_mode = "read-only"` is a requested host restriction. MandateMarshal keeps these facts separate:

- requested read-only;
- observed/enforced read-only when the host exposes evidence.

The current CLI driver conservatively reports `observedReadOnly = false` because a successful read-only request is not by itself independent proof that no mutation occurred.

The orchestration engine therefore also re-observes candidate identity after Fresh Reviewer execution. If repository/candidate state changed, the review is invalidated even if the reviewer returned PASS.

## Plugin / Skill

MandateMarshal also ships a Codex marketplace manifest, plugin package, and orchestration Skill:

```text
.agents/plugins/marketplace.json
plugins/mandatemarshal/.codex-plugin/plugin.json
plugins/mandatemarshal/skills/mandatemarshal/SKILL.md
plugins/mandatemarshal/agents/*.toml
.codex-plugin/plugin.json
skills/orchestration/SKILL.md   # migration pointer only; no Skill frontmatter
```

`plugins/mandatemarshal/skills/mandatemarshal/` is the single committed runtime Skill source. The historical root `skills/orchestration/` path is deliberately a frontmatter-free migration pointer rather than a second committed Skill copy.

The Skill is **explicit-first, project-persistent**. An unregistered project requires an explicit first selection. That selection may be persisted outside the target repository with:

```bash
mandatemarshal activation enable /path/to/project
```

Later coding requests in the same project may continue without repeating the brand. Explicit disable is available with `mandatemarshal activation disable /path/to/project`.

The registry defaults to `~/.mandatemarshal/projects/`, so activation does not dirty the target repository. v0.1 identifies a project by canonical path; moving/renaming it may require explicit activation again.

## Skill-run receipts — v0.2.6

When the packaged CLI is available, Skill-driven coding objectives use a lightweight canonical run envelope. Prefer the lifecycle bridge for normal operation:

```bash
mandatemarshal run ensure /path/to/project
mandatemarshal run advance <run-id> parent-verified
mandatemarshal run advance <run-id> reviewer-started --thread <reviewer-handle>
mandatemarshal run advance <run-id> review-verdict --verdict PASS
mandatemarshal run advance <run-id> run-completed
mandatemarshal run show <run-id>
```

`ensure` reuses the only active receipt for the canonical project, creates one when none exists, serializes concurrent creation with a short-lived project lock, and fails on ambiguous multiple active receipts. Candidate-bound `run advance` transitions mechanically re-observe Git state, diff, and worktree bytes, persisting a changed candidate before evaluating the requested transition. Unchanged observations do not add redundant candidate trace events. Low-level `capture`/`record` remain available for compatibility and diagnostics, and generic `run record` still cannot publish `candidate-observed`.

The persistent minimal receipt lives under `~/.mandatemarshal/receipts/`. Run-level receipt updates use a short-lived filesystem lock to avoid lost updates. Detailed structured trace lives in the OS temp directory under `mandatemarshal/traces/`, is best-effort, and has a fixed 30-day TTL in v0.2.6. The trace TTL is not configurable in this release and never applies to the persistent receipt. See `docs/RUN_RECEIPTS.md`.

A `skill-contract` receipt is traceability evidence, not a claim that the full durable external-operation reconciliation layer was active.

Codex may choose which Skills to load before MandateMarshal code can inspect the external registry. Therefore registry-driven rediscovery across every brand-new Codex context is not guaranteed in v0.1; current-context continuation is the fallback when pre-dispatch lookup is unavailable.

## Capability errors

Expected fail-loudly conditions include:

- `REVIEW_CAPABILITY_UNAVAILABLE`
- `EXACT_MODEL_SELECTION_UNAVAILABLE`
- `EXACT_EFFORT_SELECTION_UNAVAILABLE`
- `PERSISTENT_CORRECTION_UNAVAILABLE`
- `REVIEW_CANDIDATE_MISMATCH`

A capability error is not a complexity trigger. For example, failure to launch Luna/Max must not be re-labelled as justification to launch Terra/High.

## References

Current Codex documentation should be re-checked at release time because model identifiers and host capabilities evolve:

- https://developers.openai.com/codex/subagents
- https://developers.openai.com/codex/models
- https://developers.openai.com/codex/plugins
