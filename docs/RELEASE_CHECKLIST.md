# MandateMarshal v0.2.5 Release Checklist

This checklist is the publication gate for MandateMarshal v0.2.5.

## Scope

v0.2.5 is a compatibility-preserving real-world stabilization release. It does not replace the authority state machine or the v0.2 durable engine. It connects normal Skill-driven work to lightweight traceability, removes the duplicated committed runtime Skill source, and hardens operational boundaries discovered through TengoZero dogfooding.

The release is intentionally limited to:

- one committed native-plugin Skill source;
- Skill-run canonical run identity and lightweight persistent receipts;
- fixed 30-day temporary detailed traces;
- candidate capture, run inspection, and receipt concurrency hardening;
- default Git commit ownership remaining with Parent unless explicitly delegated;
- versioning/roadmap clarification for the 0.2.x stabilization line.

## Canonical Skill source

- [x] `plugins/mandatemarshal/skills/mandatemarshal/SKILL.md` is the only committed frontmatter-bearing runtime Skill source.
- [x] `skills/orchestration/SKILL.md` is only a migration pointer and has no Skill frontmatter.
- [x] v0.2.5+ release pin verification hashes the native-plugin Skill source.
- [x] Legacy pre-v0.2.5 published Skill paths remain usable only for provenance verification of old global Skills, never as runtime fallback.

## Skill-run receipt contract

- [x] `mandatemarshal run ensure <project>` creates or reuses the single active receipt for a project.
- [x] `mandatemarshal run start <project>` refuses to create a second active receipt for the same project.
- [x] Concurrent `ensure` calls serialize and converge on one active receipt.
- [x] Multiple pre-existing active receipts fail closed as ambiguous rather than guessing.
- [x] `mandatemarshal run capture <run-id>` mechanically records candidate identity from Git state/diff/worktree bytes and separately records Git HEAD when available.
- [x] Generic `run record` cannot publish `candidate-observed` or caller-supplied Git HEAD.
- [x] Public receipt creation is fixed to `skill-contract`; `--mode durable-runtime` is rejected instead of allowing an evidence-label spoof.
- [x] Parent verification is bound to the current candidate.
- [x] Fresh Reviewer `PASS` is bound to the current candidate.
- [x] `FIX`, `ESCALATE`, or candidate mutation invalidates the old Fresh PASS as applicable.
- [x] `run-completed` requires Fresh PASS for the exact current candidate.
- [x] Receipt validation rejects inconsistent Parent/PASS/completion bindings.
- [x] Run-level receipt updates use short-lived exclusive filesystem locks to prevent lost updates.

## Trace retention contract

- [x] Recovery/authority-critical minimal receipt state persists under `~/.mandatemarshal/receipts/` by default.
- [x] Detailed trace is stored under the OS temp directory under `mandatemarshal/traces/`.
- [x] Detailed trace retention is fixed at 30 days in v0.2.5.
- [x] The 30-day TTL is not configurable in v0.2.5; later configurability is roadmap-only.
- [x] Trace cleanup never deletes persistent receipts.
- [x] Trace write/cleanup failure is best-effort and does not invalidate a successfully persisted receipt.
- [x] Expired/missing trace never authorizes reconstruction of PASS or provider-side outcomes.

## Git ownership contract

- [x] Routine Implementer does not create commits/tags/pushes unless the packet explicitly delegates the exact repository operation.
- [x] Complex Implementer has the same restriction.
- [x] Fresh Reviewer remains read-only and never creates repository mutations.
- [x] Parent owns semantic commit/checkpoint decisions by default.

## Version consistency

- [x] `package.json` reports `0.2.5`.
- [x] Root Codex plugin manifest reports `0.2.5` and points at the native-plugin Skill directory.
- [x] Marketplace plugin manifest reports `0.2.5`.
- [x] Canonical native-plugin Skill frontmatter reports `0.2.5`.
- [x] Conformance tests enforce release-version alignment and single canonical Skill-source behavior.

## Required verification

Run from the audited checkout without launching any Codex coding agent/model:

```bash
bun run typecheck
bun test
bun audit
git diff --check
npm pack --dry-run --json
```

Required results before publication:

- [x] Strict TypeScript diagnostics: `0`.
- [x] Full Bun test suite: `103/103` pass (`384` assertions).
- [x] Dependency vulnerabilities: `0`.
- [x] `git diff --check`: clean.
- [x] Package dry-run: `mandatemarshal@0.2.5`, `78` files, intended public surface only.
- [x] Local/private artifacts such as `docs/ROADMAP.md` and `.stackmarshal/` are absent from the package/publication set.
- [x] Publication-set scan finds no secret/credential, personal absolute path, dangerous Codex bypass flag, or stale duplicated-Skill claim.
- [x] Self security review covers receipt path safety, token-bound locking, temp cleanup boundaries, candidate evidence, PASS binding, durable-mode labeling, release pin verification, and command injection surfaces; no unresolved material issue remains.

Do not invoke Codex Security, Codex CLI coding agents, Fresh Reviewer models, or any other Codex model as part of this release publication procedure. Security review for this release is performed locally through deterministic tests, dependency/static inspection, and bounded manual code review.

## Documentation

- [x] `README.md` documents Skill-run receipts and fixed 30-day trace retention.
- [x] `docs/RUN_RECEIPTS.md` documents persistent vs temporary evidence boundaries.
- [x] `docs/CODEX_SETUP.md` documents Skill-run receipt commands and the single canonical Skill source.
- [x] `docs/ARCHITECTURE.md` documents the Skill-run receipt boundary separately from `DurableEngineRuntime`.
- [x] `docs/DECISIONS.md` records v0.2.5 traceability, Skill-source, versioning, and Git-ownership decisions.
- [x] `SECURITY.md` documents receipt/trace trust and cleanup boundaries.
- [x] `CHANGELOG.md` contains v0.2.5 dated 2026-09-03.

## Publication

- [x] Existing v0.1.0 through v0.2.4 releases remain untouched.
- [ ] v0.2.5 release commit created from the audited working tree.
- [ ] GitHub Actions passes on Ubuntu and Windows.
- [ ] Annotated `v0.2.5` tag pushed.
- [ ] GitHub Release `MandateMarshal v0.2.5` published from that tag.
- [ ] Local install successfully pins `latest` to v0.2.5 without launching a Codex coding agent/model.
- [ ] Local `mandatemarshal version` reports runtime/pin/plugin/cache/Skill 0.2.5 with `Status: OK`.

Publication must not proceed if any deterministic gate is red or if the self security review finds an unresolved material issue.
