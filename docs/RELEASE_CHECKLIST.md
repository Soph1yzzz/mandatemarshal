# MandateMarshal v0.3.0 Release Checklist

This checklist is the publication gate for MandateMarshal v0.3.0.

## Scope

v0.3.0 replaces the active Codex routing policy with a two-model GPT-6 layout:

- Parent: GPT-6 Sol / High;
- Fresh Reviewer: GPT-6 Sol / High, fresh context, read-only;
- default implementation: GPT-6 Luna / Max;
- explicit blocked-Luna implementation escalation: GPT-6 Sol / High.

The legacy `complex-implementer` semantic name remains for wire compatibility, but predictive complexity routing is removed. Every settled implementation starts on Luna. Sol implementation is allowed only after an actual Luna blocker and explicit Parent reclassification.

Historical Astra, Terra, and GPT-5.6 Decision Log / changelog entries remain historical evidence. They are not current routing policy.

## Routing and configuration

- [x] Parent requirement is exactly `gpt-6-sol/high`.
- [x] Fresh Reviewer is exactly `gpt-6-sol/high`, fresh-context, read-only.
- [x] Routine Implementer is exactly `gpt-6-luna/max`.
- [x] Complex Implementer is exactly `gpt-6-sol/high`.
- [x] Settled packets always start on the routine/Luna lane.
- [x] Only an observed Luna blocker can support explicit `routine -> complex` reclassification.
- [x] Luna launch/capability failure does not silently fall back to Sol.
- [x] Astra, Terra, GPT-5.6, and old Sol-compat selectors are absent from active routing/config/install surfaces.

## Packaging and pin compatibility

- [x] Manual Codex agent installer exposes only the three v0.3.0 active profiles.
- [x] v0.3.0 package/plugin agent surface contains no obsolete active Astra or GPT-5.6 compatibility profiles.
- [x] v0.3.0 pin verification requires exactly the active Luna/Sol profile set.
- [x] v0.2.8-v0.2.9 pin verification still validates the historical Astra/Sol-compat profile set.
- [x] Package, root plugin manifest, marketplace plugin manifest, and canonical Skill all report `0.3.0`.

## Documentation and history

- [x] README.md documents Luna-first two-model routing.
- [x] README.ja.md documents the same policy in natural Japanese.
- [x] docs/CODEX_SETUP.md and docs/ARCHITECTURE.md describe blocked-Luna-only Sol escalation.
- [x] SECURITY.md documents no-silent-fallback and version-aware pin verification.
- [x] docs/DECISIONS.md adds v0.3.0 decisions without rewriting historical v0.2.x decisions.
- [x] CHANGELOG.md contains v0.3.0 dated 2026-09-23.
- [x] AGENTS.md current mapping matches v0.3.0.

## Required deterministic verification

Run from the audited checkout:

```bash
bun run typecheck
bun test
bun audit
bun run validate:config
bun run scan:artifacts
git diff --check
npm pack --dry-run --json
```

Use `bun install --frozen-lockfile` first only if dependencies are not already present; it must not change the lockfile.

Also perform a bounded self security review without launching a Codex model process. Check exact routing, stale profile exposure, version-pin backward compatibility, reviewer read-only policy, silent fallback paths, package contents, secrets/local paths, and dependency findings.

## Verification results

- [x] Frozen dependency state is usable without lockfile drift.
- [x] Strict TypeScript diagnostics: `0`.
- [x] Full Bun test suite passes.
- [x] Dependency audit has no unresolved material finding.
- [x] Config validation passes.
- [x] Artifact/publication scan passes.
- [x] `git diff --check` is clean.
- [x] Package dry-run contains the intended v0.3.0 surface only.
- [x] No secret/credential or personal absolute path is added.
- [x] Self security review finds no unresolved material issue.
- [x] README.ja.md passes the repository's natural-Japanese check or equivalent final review.

## Publication

- [ ] StackMarshal run `20260923-040630-bdc91404` reaches COMPLETE with sealed verification evidence.
- [ ] v0.3.0 release commit is created from the audited candidate.
- [ ] Clean committed candidate passes final package/test smoke.
- [ ] Annotated `v0.3.0` tag is created and pushed.
- [ ] GitHub Release `MandateMarshal v0.3.0` is published from that tag.
- [ ] Local MandateMarshal/Codex pin is updated to 0.3.0 and `mandatemarshal version` reports the expected state.
- [ ] GitHub Actions status is checked and any pending/failure state is reported rather than guessed.

Publication must not proceed while a deterministic gate is red, obsolete routing remains active, backward pin compatibility is broken, or the self security review has an unresolved material issue.
