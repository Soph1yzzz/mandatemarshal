# MandateMarshal v0.2.6 Release Checklist

This checklist is the publication gate for MandateMarshal v0.2.6.

## Scope

v0.2.6 is a compatibility-preserving stabilization hotfix from TenhoZero dogfooding. Candidate calculation remains unchanged; the release strengthens the connection from the Skill-driven lifecycle to the lightweight receipt lifecycle without expanding persistent receipts into conversation/log storage.

The release is intentionally limited to:

- `run advance` as the preferred Skill-facing lifecycle bridge;
- mechanical candidate re-observation for candidate-bound transitions;
- persistence of changed candidates before a transition is evaluated, so stale bindings fail closed;
- no redundant `candidate-observed` trace event when the candidate is unchanged;
- existing `run capture` / `run record` retained for compatibility and diagnostics;
- Codex default-model rolling policy documented at the adapter/configuration boundary, with no speculative Astra identifier baked into runtime configuration.

## Skill-run lifecycle bridge

- [x] `mandatemarshal run advance <run-id> implementer-started --thread <id>` records the Implementer locator.
- [x] `parent-verified` mechanically observes and binds the exact current candidate without caller-supplied candidate ID.
- [x] `reviewer-started` mechanically re-observes the candidate before binding the reviewer locator.
- [x] `review-verdict` mechanically re-observes the candidate before recording `PASS | FIX | ESCALATE`.
- [x] `run-completed` mechanically re-observes before enforcing Fresh PASS for the unchanged candidate.
- [x] A changed candidate is persisted before a requested high-level transition is evaluated.
- [x] An unchanged candidate does not add a redundant `candidate-observed` trace event.
- [x] Generic `run record` still cannot fabricate `candidate-observed`.
- [x] Low-level `run capture` / `run record` remain backward compatible.
- [x] Persistent receipts remain structured minimal state only; prompts/conversations/large logs are not added.

## Existing authority / evidence contract

- [x] Parent verification remains candidate-bound.
- [x] Fresh Reviewer PASS remains candidate-bound.
- [x] `FIX`, `ESCALATE`, or candidate mutation invalidates old Fresh PASS as applicable.
- [x] `run-completed` requires Fresh PASS for the exact current candidate.
- [x] Public receipt creation remains fixed to `skill-contract`.
- [x] Run evidence remains outside the target repository by default.
- [x] Detailed trace remains best-effort under the OS temp directory with fixed 30-day TTL.
- [x] Native plugin Skill remains the single committed runtime Skill source.
- [x] Implementers still do not own commit/tag/push unless explicitly delegated.

## Model evolution contract

- [x] Semantic roles remain independent from concrete model generations.
- [x] Current runtime defaults remain Luna/Max, Terra/High, Sol/High for v0.2.6.
- [x] Roadmap records migration of Fresh Reviewer default from Sol to Astra once Astra is officially available in the relevant Codex host and its exact interface is verified.
- [x] Future stronger appropriate frontier models may replace current defaults at the adapter/configuration boundary.
- [x] No silent fallback to an older model is introduced.
- [x] No speculative Astra model ID or reasoning-effort identifier is committed before release availability is known.

## Version consistency

- [x] `package.json` reports `0.2.6`.
- [x] Root Codex plugin manifest reports `0.2.6`.
- [x] Marketplace/native plugin manifest reports `0.2.6`.
- [x] Canonical native-plugin Skill frontmatter reports `0.2.6`.
- [x] Conformance tests enforce release-version alignment and single canonical Skill-source behavior.

## Required verification

Run from the audited checkout without launching any Codex coding agent/model:

```bash
bun run typecheck
bun test
bun audit
bun run validate:config
bun run scan:artifacts
git diff --check
npm pack --dry-run --json
```

Also perform the bounded local self-security review defined by `docs/DECISIONS.md` D-024: dependency audit, trust-boundary/static inspection, secret/local-path/publication-set checks, regression/conformance tests, package surface review, and command-injection/path-boundary review. **Do not invoke Codex Security or any Codex coding/reviewer model for this release.**

Required results before publication:

- [x] Strict TypeScript diagnostics: `0`.
- [x] Full Bun test suite: `105/105` pass (`393` assertions).
- [x] Dependency vulnerabilities: `0`.
- [x] Config validation passes with no warnings/errors.
- [x] Artifact/publication scan returns no findings.
- [x] `git diff --check`: clean.
- [x] Package dry-run reports `mandatemarshal@0.2.6`, `78` files, intended public surface only.
- [x] No secret/credential or personal absolute path is added.
- [x] No new shell/process-execution surface is introduced by the lifecycle bridge.
- [x] No dangerous Codex bypass behavior or duplicate runtime Skill is introduced.
- [x] Self security review finds no unresolved material issue.
- [x] No Codex Security, Codex coding agent, or Fresh Reviewer model was launched for this release review.

## Documentation

- [x] `README.md` documents `run advance` and minimal receipt behavior.
- [x] `docs/RUN_RECEIPTS.md` documents automatic candidate re-observation and low-level compatibility commands.
- [x] `docs/CODEX_SETUP.md` documents v0.2.6 lifecycle commands.
- [x] `docs/ROADMAP.md` records the Astra/future-frontier rolling model policy and v0.2.6 dogfood finding.
- [x] `docs/DECISIONS.md` records the lifecycle bridge and model-evolution decisions.
- [x] `CHANGELOG.md` contains v0.2.6 dated 2026-09-04.

## Publication

- [x] v0.2.6 release commit created from the audited working tree.
- [x] Clean committed candidate passes frozen-install/package smoke without launching Codex.
- [ ] Annotated `v0.2.6` tag created and pushed.
- [ ] GitHub Release `MandateMarshal v0.2.6` published from that tag.
- [ ] GitHub Actions passes on Ubuntu and Windows, or any pending state is reported rather than guessed.
- [ ] Local `mandatemarshal pin latest` / version alignment is checked without launching a Codex coding agent/model when safely available.

Publication must not proceed if any deterministic gate is red or if the local self-security review finds an unresolved material issue.
