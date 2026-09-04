import type { ImplementationLane, ReasoningEffort, RoutingEvidence } from "../../core/types";

export interface CodexNativeRoleConfig {
  nativeRole: string;
  model: string;
  effort: ReasoningEffort;
}

export interface CodexRoleMapping {
  parent: { mode: "inherit" } | CodexNativeRoleConfig;
  routineImplementer: CodexNativeRoleConfig;
  complexImplementer: CodexNativeRoleConfig;
  freshReviewer: CodexNativeRoleConfig;
}

export const CODEX_FRESH_REVIEWER_PROFILES = {
  "astra-high": {
    nativeRole: "fresh-reviewer",
    model: "gpt-6-astra",
    effort: "high",
  },
  "sol-high-compat": {
    nativeRole: "fresh-reviewer",
    model: "gpt-5.6-sol",
    effort: "high",
  },
} as const satisfies Record<string, CodexNativeRoleConfig>;

export type CodexFreshReviewerProfileId = keyof typeof CODEX_FRESH_REVIEWER_PROFILES;

// Astra is officially rolling out, but the default must not move until the active
// Codex host can provide the exact model. Switching this single adapter-boundary
// selector is the rollout step; Sol then remains available only by explicit profile.
export const DEFAULT_CODEX_FRESH_REVIEWER_PROFILE: CodexFreshReviewerProfileId = "sol-high-compat";

export function freshReviewerRoleForProfile(profile: CodexFreshReviewerProfileId): CodexNativeRoleConfig {
  return { ...CODEX_FRESH_REVIEWER_PROFILES[profile] };
}

export const DEFAULT_CODEX_ROLE_MAPPING: CodexRoleMapping = {
  parent: { mode: "inherit" },
  routineImplementer: {
    nativeRole: "routine-implementer",
    model: "gpt-5.6-luna",
    effort: "max",
  },
  complexImplementer: {
    nativeRole: "complex-implementer",
    model: "gpt-5.6-terra",
    effort: "high",
  },
  freshReviewer: freshReviewerRoleForProfile(DEFAULT_CODEX_FRESH_REVIEWER_PROFILE),
};

export function implementationRoleForLane(mapping: CodexRoleMapping, lane: ImplementationLane): CodexNativeRoleConfig {
  return lane === "routine-implementer" ? mapping.routineImplementer : mapping.complexImplementer;
}

export function routingEvidenceForLane(
  mapping: CodexRoleMapping,
  lane: ImplementationLane,
  reason: string,
): RoutingEvidence {
  const selected = implementationRoleForLane(mapping, lane);
  return {
    lane,
    reason,
    requestedModel: selected.model,
    requestedEffort: selected.effort,
  };
}
