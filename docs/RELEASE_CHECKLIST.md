# MandateMarshal v0.2.3 Release Checklist

This checklist is the publication gate for MandateMarshal v0.2.3.

## Scope

v0.2.3 is a narrow Windows pinning hotfix. It preserves the v0.2.2 release-pinning/version UX and fixes Codex CLI discovery when `codex` is installed but not visible on the current shell PATH. It does not change authority, routing, durable recovery, reviewer behavior, or provider execution semantics.

## Code and authority contracts

- [x] Provider-neutral core contains no provider/model branding.
- [x] Fresh Reviewer protocol remains exactly `PASS | FIX | ESCALATE`.
- [x] No silent model/role/effort fallback exists in the Codex adapter.
- [x] Durable recovery behavior is unchanged from v0.2.2.
- [x] Activation behavior is unchanged from v0.2.2.

## Pin/update contract

- [x] `mandatemarshal pin <version>` and `mandatemarshal pin latest` retain exact released-tag semantics.
- [x] `mandatemarshal pin status` remains non-delegated so it can diagnose an older pinned runtime.
- [x] `mandatemarshal version` reports runtime, pin, installed-plugin, and legacy-Skill versions; `--version`/`-v` report the runtime version only.
- [x] Package, root plugin manifest, marketplace plugin manifest, canonical Skill, and marketplace Skill all report `0.2.3`.
- [x] Pinning verifies the GitHub Release before changing Codex plugin state.
- [x] Pinning verifies the installed Codex plugin version before committing the pin record.
- [x] Pin state remains outside target repositories under `~/.mandatemarshal/pin.json`.
- [x] Legacy Skill/agent copies remain synchronized from the pinned plugin package.

## Windows Codex CLI discovery

- [x] Explicit `PinRuntimeOptions.codexBin` remains highest priority.
- [x] `MANDATEMARSHAL_CODEX_BIN` remains an explicit trusted override.
- [x] Active PATH is checked with `Bun.which("codex")`.
- [x] Known Codex locations under `CODEX_HOME` are checked when PATH has no Codex executable.
- [x] Windows npm global Codex locations are checked as a compatibility fallback.
- [x] Missing Codex CLI fails with `CODEX_CLI_NOT_FOUND` instead of an opaque `uv_spawn 'codex'` ENOENT.
- [x] Unit regression covers a Windows Codex executable under `~/.codex/plugins/.plugin-appserver/codex.exe` while PATH discovery is disabled.
- [x] The detected plugin-appserver Codex binary was verified to expose `codex plugin` management commands.
- [x] Real normal-PowerShell acceptance test successfully pinned v0.2.2 despite `codex` not being on that shell's PATH.
- [x] The same acceptance run was observable as pinned by the v0.2.3 `pin status` path.

## Verified quality gates

- [x] Strict TypeScript typecheck passes with `0` diagnostics.
- [x] Full test suite passes: `86/86` tests, `294` assertions.
- [x] `bun audit` reports `0` vulnerabilities.
- [x] `git diff --check` is clean.
- [x] Package dry-run contains the intended v0.2.3 distribution surface (`76` files).
- [x] Local-only `docs/ROADMAP.md`, `.stackmarshal/`, provenance bundle/master, and generated runtime state remain excluded from publication.

## Reproducible v0.2.3 release gate

```bash
bun install --frozen-lockfile
bun audit
bun run check
npm pack --dry-run --json
```

Do not invoke real Codex coding agents as part of this patch-release publication procedure. Codex-specific validation is limited to plugin-manager/CLI discovery and pin management.

## Documentation synchronization

- [x] `README.md` uses v0.2.3 as the exact-pin example and documents the one-command version check.
- [x] `docs/CODEX_SETUP.md` documents Windows Codex CLI fallback discovery.
- [x] `docs/DECISIONS.md` records D-030 for installed-Codex resolution.
- [x] `CHANGELOG.md` contains v0.2.3 dated 2026-09-03.
- [x] package/plugin/Skill metadata are aligned at `0.2.3`.

## Release engineering

- [x] Public repository remains `Soph1yzzz/mandatemarshal` with default branch `main`.
- [x] Existing v0.1.0, v0.2.0, v0.2.1, and v0.2.2 releases remain untouched.
- [ ] v0.2.3 release commit created from the audited working tree.
- [ ] `main` pushed and GitHub Actions CI verified on the release commit.
- [ ] Annotated `v0.2.3` tag pushed.
- [ ] GitHub Release `MandateMarshal v0.2.3` published from that tag.

Publication must not proceed if the v0.2.3 gate is red or if local/private artifacts appear in the Git/package publication surface.
