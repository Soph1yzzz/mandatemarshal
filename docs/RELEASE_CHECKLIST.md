# MandateMarshal v0.2.9 Release Checklist

This checklist is the publication gate for MandateMarshal v0.2.9.

## Scope

v0.2.9 is a compatibility-preserving authority-state release. It does not change the v0.2.8 Astra/Luna/Terra routing policy. The release adds a generic machine-readable authority ledger to Skill-run receipts and a reconciliation path that recomputes repository facts instead of trusting handoff prose.

The release is intentionally limited to:

- explicit review-purpose slugs;
- generic PASS grant scopes with no project-specific vocabulary in core;
- `current | historical | consumed | revoked` grant lifecycle;
- candidate/runtime drift invalidation of current grants;
- scope-specific supersession by newer PASS evidence;
- explicit consume/revoke operations;
- candidate/HEAD reconciliation plus exact fully-qualified Git-ref observation;
- no authority creation from README, AGENTS, handoff documents, tags, or branches;
- existing v0.2.8 model routing unchanged.

## Authority-state behavior

- [x] PASS grants bind to the exact current Parent-verified candidate.
- [x] Grants require an explicit/current review kind.
- [x] FIX/ESCALATE cannot create grants.
- [x] Candidate mutation moves every current grant to `historical`.
- [x] Compatible runtime upgrade moves every current grant to `historical`.
- [x] A newer PASS supersedes only scopes it explicitly re-grants.
- [x] `consume` and `revoke` require exactly one current matching scope.
- [x] Historical/consumed/revoked grants do not silently become current again.
- [x] Existing review flows with no review kind or grant remain compatible.
- [x] Receipt validation fails closed on malformed, stale, duplicate-current, or inconsistent grant state.

## Reconciliation and Git boundary

- [x] `run reconcile` re-observes candidate identity and Git HEAD before reporting authority.
- [x] Candidate drift is persisted through the existing candidate-observation path.
- [x] Optional Git refs must be fully-qualified `refs/...` values.
- [x] Ref observation uses argv-based exact Git plumbing; no shell interpolation is introduced.
- [x] Annotated tags report object type and peeled commit evidence.
- [x] Ref presence is evidence only and never creates a grant.
- [x] Human-facing prose is not a competing authority database.

## CLI surface

- [x] `run authority <run-id>` exposes the machine authority view.
- [x] `run reconcile <run-id> [--ref refs/...]...` exposes reconciliation evidence.
- [x] `run advance ... reviewer-started --review-kind <slug>` binds review purpose.
- [x] `run advance ... review-verdict --verdict PASS --grant <slug>...` creates scoped grants.
- [x] `run consume <run-id> --scope <slug>` records intentional use.
- [x] `run revoke <run-id> --scope <slug>` records explicit withdrawal.

## Codex process prohibition for this release audit

The requested audit must not start a Codex process. Do not run `codex`, `codex exec`, `codex plugin`, `codex --version`, or any helper that invokes the real Codex executable.

- [x] Verification evidence contains no real Codex process launch.
- [x] Existing no-launch adapter/pin tests remain green.

## Required deterministic verification

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

Also perform a bounded self Codex-security review without launching Codex. Review new slug/ref inputs, receipt validation, grant-state transitions, locking/concurrency, Git argv construction, package surface, secrets/local paths, dependency findings, and unexpected executable invocation surfaces.

Required results before publication:

- [x] Frozen dependency install succeeds without lockfile drift.
- [x] Strict TypeScript diagnostics: `0`.
- [x] Full Bun test suite passes: 131 tests / 563 assertions across 25 files.
- [x] Dependency vulnerabilities: `0`.
- [x] Config validation passes with no warnings/errors.
- [x] Artifact/publication scan returns no findings.
- [x] `git diff --check` is clean.
- [x] Package dry-run reports `mandatemarshal@0.2.9` with 100 intended files.
- [x] No secret/credential or personal absolute path is added.
- [x] Self Codex-security review finds no unresolved material issue; the abort-path grant-lifetime issue found during review was corrected and regression-tested.

## Documentation and metadata

- [x] `package.json`, root plugin manifest, marketplace plugin manifest, and canonical Skill report `0.2.9`.
- [x] `README.md` documents scoped authority and reconciliation.
- [x] `README.ja.md` documents the same behavior in natural Japanese.
- [x] `docs/CODEX_SETUP.md`, `docs/RUN_RECEIPTS.md`, `docs/ARCHITECTURE.md`, `SECURITY.md`, and `docs/DECISIONS.md` reflect the authority-state boundary.
- [x] `CHANGELOG.md` contains v0.2.9 dated 2026-09-13.

## Publication

- [ ] v0.2.9 release commit created from the audited candidate.
- [ ] Clean committed candidate passes final no-Codex package/test smoke.
- [ ] Annotated `v0.2.9` tag created and pushed.
- [ ] GitHub Release `MandateMarshal v0.2.9` published from that tag.
- [ ] GitHub Actions passes on Ubuntu and Windows, or any pending/failure state is reported rather than guessed.

Publication must not proceed if any deterministic gate is red, the self Codex-security review has an unresolved material issue, the no-Codex audit constraint was violated, or reconciliation can manufacture authority from non-receipt evidence.
