# MandateMarshal v0.2.8 Release Checklist

This checklist is the publication gate for MandateMarshal v0.2.8.

## Scope

v0.2.8 activates the Codex Frontier Authority Profile after GPT-6 Astra availability. It changes authority-model routing and distribution verification without changing the provider-neutral role ontology.

The release is intentionally limited to:

- Parent root-session requirement -> `gpt-6-astra` / Owner-selected authority effort;
- Fresh Reviewer -> `gpt-6-astra` / exact same effort / fresh context / read-only;
- supported authority effort values `low | medium | high | xhigh | max`, matching the current verified Astra/Codex surface;
- routine/complex Implementers unchanged at Luna/Max and Terra/High;
- Sol retained only as explicit `sol-high-compat` reviewer configuration;
- no silent effort/model fallback;
- exact versioned-cache verification of all release-critical authority reviewer profiles;
- pure no-launch Codex exec-plan verification.

## Authority mapping

- [x] Default Parent requirement is Astra/Medium.
- [x] Default Fresh Reviewer is Astra/Medium, fresh and read-only.
- [x] `low`, `medium`, `high`, `xhigh`, and `max` mirror exactly from Parent authority requirement to Fresh Reviewer.
- [x] Routine Implementer remains Luna/Max.
- [x] Complex Implementer remains Terra/High.
- [x] Sol is reachable only through explicit `sol-high-compat` configuration.
- [x] Parent mismatch fails closed when host observation is supplied.
- [x] Unknown authority effort fails before launch planning.
- [x] Authority effort cannot be combined ambiguously with a reviewer override.
- [x] Unknown effort labels fail closed, and no Astra -> Sol or other silent fallback path exists.

## Install / update / use path

- [x] `package.json`, root plugin manifest, marketplace plugin manifest, and canonical Skill all report `0.2.8`.
- [x] Plugin Skill remains the single committed runtime Skill source.
- [x] Installer includes all five Astra authority reviewer profiles plus explicit Sol compatibility.
- [x] Root/template/plugin bundled agent copies are byte-identical.
- [x] v0.2.8 pin verification hashes the released authority profiles and compares the exact versioned plugin cache.
- [x] Missing/tampered v0.2.8 authority profile makes pin fail closed.
- [x] v0.2.7 and older pins are not retroactively required to contain the v0.2.8 authority profile set.
- [x] Normal CLI delegation still resolves through the pinned marketplace checkout.
- [x] No-launch integration proves selected authority effort reaches exact reviewer `codex exec` argv.
- [x] No-launch integration proves reviewer sandbox remains `read-only` and execution remains fresh/ephemeral where expected.
- [x] No-launch integration proves Luna/Terra worker routes remain unchanged.

## Codex process prohibition for this release audit

The requested validation for this update must not start a Codex process. Do not run `codex`, `codex exec`, `codex plugin`, `codex --version`, or any helper that invokes the real Codex executable. Installation/update behavior must be exercised through fake command runners and filesystem/cache fixtures; use-path behavior must be exercised through pure launch-plan construction and fake adapters.

- [x] Verification evidence contains no real Codex process launch.
- [x] Pin/update tests use fake `PinCommandRunner` only.
- [x] Runtime route tests use fake `CodexDriver` plus `buildCodexExecArgs` only.

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

Also perform a bounded self Codex-security review without launching Codex. Review authority-input validation, argv construction, model/effort fallback, Parent/reviewer separation, reviewer read-only request, pin/update trust boundaries, exact-cache path checks, release-tag/profile hashes, package surface, secrets/local paths, and unexpected executable invocation surfaces.

Required results before publication:

- [x] Frozen dependency install succeeds without lockfile drift.
- [x] Strict TypeScript diagnostics: `0`.
- [x] Full Bun test suite passes: 126 tests / 518 assertions.
- [x] Dependency vulnerabilities: `0`.
- [x] Config validation passes with no warnings/errors.
- [x] Artifact/publication scan returns no findings.
- [x] `git diff --check` is clean.
- [x] Package dry-run reports `mandatemarshal@0.2.8` with 99 intended files and no Ultra prototype profile.
- [x] No secret/credential or personal absolute path is added.
- [x] Self Codex-security review finds no unresolved material issue.

## Documentation

- [x] `README.md` documents Astra authority effort mirroring, Sol compatibility, pin hardening, and no silent fallback.
- [x] `docs/CODEX_SETUP.md` documents Parent root-session semantics, reviewer profiles, exact pin/update route, and no-launch plan testing.
- [x] `docs/ARCHITECTURE.md`, `SECURITY.md`, and `docs/DECISIONS.md` reflect the new authority boundary.
- [x] `CHANGELOG.md` contains v0.2.8 dated 2026-09-07.

## Publication

- [x] v0.2.8 release commit created from the audited candidate.
- [x] Clean committed candidate passes final no-Codex package/test smoke.
- [ ] Annotated `v0.2.8` tag created and pushed.
- [ ] GitHub Release `MandateMarshal v0.2.8` published from that tag.
- [ ] GitHub Actions passes on Ubuntu and Windows, or any pending/failure state is reported rather than guessed.

Publication must not proceed if any deterministic gate is red, the self Codex-security review has an unresolved material issue, the no-Codex audit constraint was violated, or the package/pin/use path is not mechanically evidenced.
