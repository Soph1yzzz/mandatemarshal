# Portable Host Entry

MandateMarshal core reasons about semantic roles and capabilities, never provider brand names.

A host adapter should expose truthfully whether it can provide:

- fresh context;
- implementation workers;
- exact model/role selection;
- reasoning/effort selection;
- requested vs observed read-only isolation;
- command observation;
- repository-state observation;
- worktree isolation;
- correction to an existing child;
- hooks/plugins;
- routing observation.

If a mandatory capability is unavailable, hold only the affected transition and report the exact capability gap. Do not silently substitute another role/model/effort or claim degraded behavior is compliant.

Provider mappings belong behind adapters. The same core state machine must remain usable with Codex, Claude Code, or future hosts without provider-name branching in `src/core/**`.
