# MandateMarshal v0.2.4 Release Checklist

This checklist is the publication gate for MandateMarshal v0.2.4.

## Scope

v0.2.4 is a narrow Skill-discovery canonicalization hotfix. It does not change authority, routing, durable recovery, reviewer behavior, activation semantics, or provider execution semantics.

The release changes only pin/discovery correctness:

- Codex's exact versioned plugin cache is the only runtime Skill authority.
- Marketplace checkout remains the pinned CLI runtime source.
- Legacy global Skill mirroring is removed.
- No sibling-cache or legacy-Skill search fallback is permitted.

## Canonical cache contract

- [x] Pin computes exactly `~/.codex/plugins/cache/mandatemarshal/mandatemarshal/<version>` (or the equivalent path under configured `CODEX_HOME`).
- [x] The exact cache must contain `.codex-plugin/plugin.json` with the requested version.
- [x] The exact cache must contain `skills/mandatemarshal/SKILL.md` with the requested version.
- [x] The cache Skill LF-normalized SHA-256 must match the canonical Skill from the published GitHub Release.
- [x] Missing exact cache fails with `PIN_CACHE_MISSING`; no alternate copy is searched.
- [x] Cache Skill hash/version mismatch fails closed.

## Legacy global Skill handling

- [x] Pin no longer creates or refreshes `~/.codex/skills/mandatemarshal`.
- [x] A pre-existing legacy `SKILL.md` is inspected before Codex installation state is changed.
- [x] Its declared version is resolved to the corresponding published MandateMarshal Release.
- [x] Automatic deletion is allowed only when the LF-normalized content hash matches that official released Skill.
- [x] Only the proven legacy `SKILL.md` is deleted; neighboring files/directories are preserved.
- [x] Customized or unverifiable content fails with `LEGACY_SKILL_CONFLICT` and is not deleted.
- [x] Successful pin requires no legacy global MandateMarshal Skill to remain discoverable.

## Pin state and version reporting

- [x] Pin-state schema v2 records `marketplaceSource`, `runtimeSource`, and `pluginCacheSource` separately.
- [x] Existing schema v1 records are read deterministically and mapped to the exact expected versioned-cache path without filesystem search.
- [x] `mandatemarshal version` reports runtime, pin, installed plugin, cache manifest, cache Skill, and legacy Skill state.
- [x] Any remaining legacy global Skill is reported as drift.

## Version consistency

- [x] `package.json` reports `0.2.4`.
- [x] Root Codex plugin manifest reports `0.2.4`.
- [x] Marketplace plugin manifest reports `0.2.4`.
- [x] Canonical Skill frontmatter reports `0.2.4`.
- [x] Marketplace Skill frontmatter reports `0.2.4`.
- [x] Conformance tests enforce release-version equality across these surfaces.

## Required verification

Run from a locked dependency checkout:

```bash
bun run typecheck
bun test
bun audit
npm pack --dry-run --json
```

Required results before publication:

- [x] Strict TypeScript diagnostics: `0`.
- [x] Full Bun test suite: `90/90` pass (`306` assertions).
- [x] Dependency vulnerabilities: `0`.
- [x] `git diff --check`: clean.
- [x] Package dry-run: `mandatemarshal@0.2.4`, `76` files, no local/private artifacts (`docs/ROADMAP.md`, `.stackmarshal/`, archived AuthorityFlow source/master).
- [x] Publication-set scan finds no secret, credential, personal absolute path, dangerous Codex bypass flag, or obsolete legacy-sync claim.

Do not invoke real Codex coding agents as part of this patch-release publication procedure. Codex-specific acceptance may use plugin-manager/pin-management commands only.

## Documentation

- [x] `README.md` documents the versioned plugin cache as the sole runtime Skill authority.
- [x] `docs/CODEX_SETUP.md` documents exact cache verification and legacy-Skill removal rules.
- [x] `SECURITY.md` documents cache hash verification and fail-closed legacy handling.
- [x] `docs/DECISIONS.md` contains the v0.2.4 canonicalization decision.
- [x] `CHANGELOG.md` contains v0.2.4 dated 2026-09-03.

## Publication

- [x] Existing v0.1.0 through v0.2.3 releases remain untouched.
- [ ] v0.2.4 release commit created from the audited working tree.
- [ ] GitHub Actions passes on Ubuntu and Windows.
- [ ] Annotated `v0.2.4` tag pushed.
- [ ] GitHub Release `MandateMarshal v0.2.4` published from that tag.

Publication must not proceed if this gate is red or if the exact versioned cache cannot be proven canonical without search/fallback.
