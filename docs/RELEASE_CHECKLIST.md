# MandateMarshal v0.1.0 Release Checklist

This checklist is the publication gate for the first public OSS release.

## Code and contracts

- [x] Public name is MandateMarshal.
- [x] Provider-neutral core contains no provider/model branding.
- [x] Implementation packet routing and return contract are schema-required; R2 expected/forbidden side-effect rule fields are restored.
- [x] Fresh Reviewer protocol is exactly `PASS | FIX | ESCALATE`.
- [x] Fresh Reviewer cannot self-fix by workflow design.
- [x] Post-fix and post-mutation freshness are enforced.
- [x] Owner-level policy cannot be silently mutated by Parent/Reviewer APIs.
- [x] Routine-to-complex reclassification is explicit and auditable.
- [x] Capability failure is distinct from complexity reclassification.
- [x] No silent model/role/effort fallback exists in the Codex adapter.
- [x] Activation is explicit-first and project-persistent; unregistered projects do not auto-activate.
- [x] Activation state is external to the target repository and malformed/tampered records fail closed.

## Deterministic evidence

- [x] Required command/flag checks exist.
- [x] Configurable forbidden-artifact scan exists.
- [x] Write-path ownership check exists.
- [x] Candidate identity / repository-state evidence exists.
- [x] Default run evidence storage avoids dirtying target repositories.

## Provider surfaces

- [x] Codex routine default: Luna / Max.
- [x] Codex complex default: Terra / High.
- [x] Codex Fresh Reviewer default: Sol / High.
- [x] Fresh Reviewer template requests read-only sandbox.
- [x] Claude Code portability seam passes fixture-level conformance.
- [x] Real Codex host smoke passes on the current installed CLI (Luna/Max complete, Terra/High complete, Sol/High Fresh Reviewer PASS).

## Quality gates

- [x] Runtime/integration/conformance tests pass.
- [x] Strict TypeScript typecheck passes against declared Bun/Node/TypeScript development types (`44` files, `0` diagnostics).
- [x] Final test + typecheck rerun passes after security/R2 hardening (`50/50` tests, `160` assertions, `0` type diagnostics).
- [x] Pre-Git publication-set scan finds no secret, credential, local absolute path, dangerous Codex bypass flag, or generated artifact.
- [x] Package dry-run excludes the local AuthorityFlow source bundle/master and contains the intended MandateMarshal distribution surface.
- [x] Packed-package install smoke succeeds from an isolated temp install; the published `mandatemarshal` CLI activates a temp project without dirtying it. No runtime/package code changed afterward; later edits are release-policy/docs only.
- [x] `bun.lock` is present and clean-clone-equivalent frozen-install verification passed after the final runtime/package-code change; later edits are release-policy/docs only.
- [x] Git index audit after repository initialization finds no secret, credential, local path, source bundle, or generated artifact in the publication set.
- [x] Bounded v0.1 security gate passes: dependency audit, trust-boundary/static review, publication-set secret/local-path scan, regression/conformance tests, strict typecheck, clean-clone frozen-install verification, package dry-run, and isolated packed-package install smoke.
- [x] Independent release-blocking static security review completed: candidate identity, capability truthfulness, activation integrity, persisted evidence immutability/permissions, CLI flag injection surface, package contents, secrets/local paths, and write/process surfaces were reviewed; resulting hardening is covered by tests.
- [x] Full Codex Security is explicitly optional for v0.1 (D-024); an unfinished or unavailable full scan is not a release blocker at the current repository size/attack surface.

## Reproducible v0.1 security gate

For ordinary v0.1.x releases, use the bounded gate below rather than requiring a full Codex Security scan:

```bash
bun install --frozen-lockfile
bun audit
bun run check
npm pack --dry-run --json
```

Also review the intended Git/publication set for secrets, local absolute paths, generated artifacts, dangerous bypass flags, unexpected executable/write surfaces, and trust-boundary changes. Re-run the isolated packed-package install smoke when runtime/package code changes. Escalate to a full higher-assurance security scan when the attack surface materially grows (for example network-facing inputs, untrusted parsers/deserializers, or broader plugin/process privilege).

## Release engineering

- [x] MIT `LICENSE` present.
- [x] `THIRD_PARTY_NOTICES.md` present.
- [x] `CHANGELOG.md` contains v0.1.0.
- [x] `SECURITY.md` present.
- [x] README and setup documentation present.
- [x] Git repository initialized.
- [x] Clean initial release commit prepared and published from `main` at `845c9067b9efc9bbec67a262500adb0583377ed0`.
- [x] Public GitHub repository created as `Soph1yzzz/mandatemarshal`.
- [x] Annotated `v0.1.0` tag and GitHub Release published; the tag peels to the audited release commit above.
- [x] GitHub Actions CI passed on both `ubuntu-latest` and `windows-latest` for the release commit.

Publication must not proceed until the mandatory bounded v0.1 security gate above is green. Full Codex Security is optional under D-024 and may be added for materially larger future attack surfaces.
