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

## Project-scoped agent profiles

Codex supports project-scoped custom agent definitions under:

```text
<target-repository>/.codex/agents/*.toml
```

MandateMarshal ships reviewed templates in `templates/codex-agents/`.

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

MandateMarshal also ships a Codex plugin manifest and orchestration Skill:

```text
.codex-plugin/plugin.json
skills/orchestration/SKILL.md
```

The Skill is **explicit-first, project-persistent**. An unregistered project requires an explicit first selection. That selection may be persisted outside the target repository with:

```bash
mandatemarshal activation enable /path/to/project
```

Later coding requests in the same project may continue without repeating the brand. Explicit disable is available with `mandatemarshal activation disable /path/to/project`.

The registry defaults to `~/.mandatemarshal/projects/`, so activation does not dirty the target repository. v0.1 identifies a project by canonical path; moving/renaming it may require explicit activation again.

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
