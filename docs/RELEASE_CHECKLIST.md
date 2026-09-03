# MandateMarshal v0.2.2 Release Checklist

This checklist is the publication gate for MandateMarshal v0.2.2.

## Scope

v0.2.2 is intentionally narrow: it adds release pinning/update ergonomics for Codex and version-alignment guards. It does not change the authority model, routing policy, durable recovery semantics, or provider execution behavior.

## Code and authority contracts

- [x] Provider-neutral core contains no provider/model branding.
- [x] Fresh Reviewer protocol remains exactly `PASS | FIX | ESCALATE`.
- [x] Fresh Reviewer cannot self-fix by workflow design.
- [x] Post-fix and post-mutation freshness remain candidate-bound.
- [x] Owner-level policy cannot be silently mutated by Parent/Reviewer APIs.
- [x] Routine-to-complex reclassification remains explicit and auditable.
- [x] No silent model/role/effort fallback exists in the Codex adapter.
- [x] Activation remains explicit-first, project-persistent, external to the target repository, and fail-closed on malformed records.
- [x] Durable recovery behavior is unchanged from v0.2.1.

## Pin/update contract

- [x] `mandatemarshal pin <version>` accepts an exact released semantic version with or without a leading `v`.
- [x] `mandatemarshal pin latest` resolves the latest GitHub Release once and pins its exact tag.
- [x] `mandatemarshal pin status` reports the recorded pin and detects installed-plugin version drift.
- [x] The requested GitHub Release is verified before Codex plugin state is changed.
- [x] Root plugin manifest, marketplace plugin manifest, canonical Skill, and marketplace Skill all report the package release version.
- [x] Codex marketplace source is pinned to the exact Git tag rather than a moving branch.
- [x] Codex reports the expected installed plugin version before the pin record is committed.
- [x] Pin state is stored outside target repositories under `~/.mandatemarshal/pin.json`.
- [x] Normal CLI commands delegate to the CLI source in the pinned marketplace checkout, preventing a newer Skill from silently using an older runtime implementation.
- [x] Marketplace Skill/reference copies and all bundled agent profiles are regression-checked against canonical source files.
- [x] Changing a pin requires a new Codex session to reload Skill/agent metadata; this is documented.

## Codex plugin-manager surface

- [x] `.agents/plugins/marketplace.json` exposes the dedicated `plugins/mandatemarshal` package.
- [x] The marketplace plugin contains `.codex-plugin/plugin.json`, the MandateMarshal Skill/references, and all three reviewed agent profiles.
- [x] A real Codex plugin-manager smoke in an isolated temporary `CODEX_HOME` successfully adds the local marketplace, installs MandateMarshal v0.2.2, and reports it through `codex plugin list --json`.
- [x] The plugin-manager smoke does not execute a coding agent/model.
- [x] Real Codex agent/model smoke is not required for this patch release because provider execution code and model routing are unchanged.

## Verified quality gates

- [x] Strict TypeScript typecheck passes with `0` diagnostics.
- [x] Full test suite passes: `83/83` tests, `286` assertions.
- [x] `bun audit` reports `0` vulnerabilities on the final v0.2.2 tree.
- [x] `git diff --check` is clean on the final release candidate.
- [x] Package dry-run contains the intended v0.2.2 distribution surface (`76` files at final pre-release audit).
- [x] Local-only `docs/ROADMAP.md`, `.stackmarshal/`, provenance bundle/master, and generated local runtime state remain excluded from the publication surface.

## Reproducible v0.2.2 release gate

Run from the repository root:

```bash
bun install --frozen-lockfile
bun audit
bun run check
npm pack --dry-run --json
```

Also review the intended Git/publication set for secrets, credentials, personal/local absolute paths, generated artifacts, dangerous Codex bypass flags, unexpected executable/write surfaces, and trust-boundary changes.

Do not invoke real Codex coding agents as part of the publication procedure for this patch release. The only Codex-specific acceptance check required by v0.2.2 is plugin management in an isolated temporary `CODEX_HOME`.

Full Codex Security remains an optional higher-assurance review under D-024. Escalate to it when the attack surface materially grows.

## Documentation synchronization

- [x] `README.md` presents `mandatemarshal pin latest`, exact version pinning, and pin status as the preferred Codex update path.
- [x] `docs/CODEX_SETUP.md` documents exact-tag marketplace pinning and CLI delegation.
- [x] `CHANGELOG.md` contains v0.2.2 dated 2026-09-03.
- [x] `package.json`, root plugin manifest, marketplace plugin manifest, and Skill metadata are `0.2.2`.
- [x] Existing durable-runtime documentation remains valid and unchanged in behavior.

## Release engineering

- [x] Public repository remains `Soph1yzzz/mandatemarshal` with default branch `main`.
- [x] Existing v0.1.0, v0.2.0, and v0.2.1 releases remain untouched.
- [ ] v0.2.2 release commit created from the audited working tree.
- [ ] `main` pushed and GitHub Actions CI verified on the release commit.
- [ ] Annotated `v0.2.2` tag pushed.
- [ ] GitHub Release `MandateMarshal v0.2.2` published from that tag.

Publication must not proceed if the reproducible v0.2.2 gate is red or if local/private artifacts appear in the Git/package publication surface.
