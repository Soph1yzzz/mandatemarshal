# MandateMarshal v0.2.7 Release Checklist

This checklist is the publication gate for MandateMarshal v0.2.7.

## Scope

v0.2.7 is a compatibility-preserving stabilization release driven by downstream dogfooding. It keeps the v0.2.x authority model intact while making Skill-run candidate observation usable in large artifact repositories, defining safe active-receipt patch upgrades, and preparing the Fresh Reviewer lane for GPT-6 Astra without silently changing model availability assumptions.

The release is intentionally limited to:

- Git candidate observation bounded to HEAD/status, HEAD-relative binary diff, and non-ignored untracked bytes;
- ignored/frozen artifact trees excluded from recursive Git candidate hashing;
- compatible active-receipt patch upgrades recorded in place with stale authority bindings invalidated;
- automatic downgrade and cross-line receipt migration rejected;
- explicit `astra-high` and `sol-high-compat` Fresh Reviewer profiles at the Codex adapter boundary;
- Luna/Max and Terra/High implementation defaults unchanged;
- current packaged Fresh Reviewer selector retained on Sol compatibility until exact Astra availability is observed in the active Codex host;
- public dogfooding evidence for independent Fresh Reviewer value, without universalizing one finding.

## Candidate identity

- [x] Tracked worktree mutations change candidate identity.
- [x] Non-ignored untracked same-path content mutations change candidate identity.
- [x] Ignored artifact mutations do not change candidate identity or require recursive artifact reads.
- [x] Non-Git candidate behavior retains the recursive digest fallback.
- [x] Git untracked paths are constrained beneath the repository root, while valid in-repo names such as `..candidate.txt` remain accepted.

## Active receipt version boundary

- [x] `0.2.6 -> 0.2.7` active receipt upgrade preserves the run ID.
- [x] `startedWithVersion` records the original runtime after upgrade.
- [x] `runtime-upgraded` records exact from/to versions.
- [x] Upgrade clears candidate, Git HEAD, Parent verification, verdict, and Fresh-PASS bindings.
- [x] Automatic downgrade fails closed.
- [x] Cross-minor/major and prerelease automatic migration fail closed.

## Reviewer model evolution

- [x] Routine Implementer remains Luna/Max.
- [x] Complex Implementer remains Terra/High.
- [x] `astra-high` maps exactly to `gpt-6-astra` / High.
- [x] `sol-high-compat` maps exactly to `gpt-5.6-sol` / High.
- [x] During staged rollout, the packaged default remains the Sol compatibility profile until exact Astra host availability is observed.
- [x] Selecting Astra never silently falls back to Sol.
- [x] Semantic core roles contain no model-generation dependency.

## Authority / evidence contract

- [x] Parent verification remains candidate-bound.
- [x] Fresh Reviewer PASS remains candidate-bound.
- [x] `FIX`, `ESCALATE`, candidate mutation, or compatible runtime upgrade invalidates stale Fresh PASS as applicable.
- [x] `run-completed` requires Fresh PASS for the exact current candidate.
- [x] Public receipt creation remains fixed to `skill-contract`.
- [x] Native plugin Skill remains the single committed runtime Skill source.
- [x] Implementers still do not own commit/tag/push unless explicitly delegated.

## Version consistency

- [x] `package.json` reports `0.2.7`.
- [x] Root Codex plugin manifest reports `0.2.7`.
- [x] Marketplace/native plugin manifest reports `0.2.7`.
- [x] Canonical native-plugin Skill frontmatter reports `0.2.7`.
- [x] Conformance/version tests enforce release alignment.

## Required verification

Run from the audited checkout:

```bash
bun install --frozen-lockfile
bun run typecheck
bun test
bun audit
bun run validate:config
bun run scan:artifacts
git diff --check
npm pack --dry-run --json
```

Also perform the bounded local self-security review defined by D-024: dependency audit, trust-boundary/static inspection, secret/local-path/publication-set checks, regression/conformance tests, package surface review, and command/path-boundary review. The repository completion contract additionally requires a fresh read-only reviewer PASS for the exact final candidate.

Required results before publication:

- [x] Frozen dependency install succeeds without lockfile drift.
- [x] Strict TypeScript diagnostics: `0`.
- [x] Full Bun test suite passes.
- [x] Dependency vulnerabilities: `0`.
- [x] Config validation passes with no warnings/errors.
- [x] Artifact/publication scan returns no findings.
- [x] `git diff --check` is clean.
- [x] Package dry-run reports `mandatemarshal@0.2.7` and intended public surface only.
- [x] No secret/credential or personal absolute path is added.
- [x] New filesystem/version/profile surfaces have bounded adversarial coverage, including the valid `..name` path-boundary regression.
- [x] Self-security review finds no unresolved material issue after the bounded path-boundary correction.
- [x] Release-specific Fresh Review gate satisfied for the exact final candidate by an Owner-approved substitute review on 2026-09-04: a separate read-only review pass re-checked correctness, regressions, scope, packaging, and security boundaries after the external Sol/High and explicit Terra/High reviewer launches were blocked by the Codex account usage limit. The substitute review returned `PASS`; no implementation change followed.

## Documentation

- [x] `README.md` documents v0.2.7 candidate scaling, version upgrades, Astra profiles, and anonymized downstream dogfooding evidence.
- [x] `docs/RUN_RECEIPTS.md` documents delta-bounded Git candidate observation and runtime upgrades.
- [x] `docs/CODEX_SETUP.md` documents explicit Astra/Sol profiles and v0.2.7 receipt behavior.
- [x] `docs/ARCHITECTURE.md`, `SECURITY.md`, and `docs/DECISIONS.md` reflect the new boundaries.
- [x] `CHANGELOG.md` contains v0.2.7 dated 2026-09-04.

## Publication

- [ ] v0.2.7 release commit created from the audited candidate.
- [ ] Clean committed candidate passes final package/test smoke.
- [ ] Annotated `v0.2.7` tag created and pushed.
- [ ] GitHub Release `MandateMarshal v0.2.7` published from that tag.
- [ ] GitHub Actions passes on Ubuntu and Windows, or any pending state is reported rather than guessed.

Publication must not proceed if any deterministic gate is red, the release-specific Fresh Review gate is unsatisfied for the exact candidate, or the local self-security review finds an unresolved material issue.
