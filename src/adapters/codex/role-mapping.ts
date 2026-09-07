import type { ImplementationLane, ReasoningEffort, RoutingEvidence } from "../../core/types";

export interface CodexNativeRoleConfig {
  nativeRole: string;
  model: string;
  effort: ReasoningEffort;
}

export interface CodexRoleMapping {
  parent: CodexNativeRoleConfig;
  routineImplementer: CodexNativeRoleConfig;
  complexImplementer: CodexNativeRoleConfig;
  freshReviewer: CodexNativeRoleConfig;
}

export const CODEX_FRONTIER_AUTHORITY_MODEL = "gpt-6-astra" as const;
export const CODEX_AUTHORITY_EFFORTS = ["low", "medium", "high", "xhigh", "max"] as const;
export type CodexAuthorityEffort = (typeof CODEX_AUTHORITY_EFFORTS)[number];
export const DEFAULT_CODEX_AUTHORITY_EFFORT: CodexAuthorityEffort = "medium";

export const CODEX_FRESH_REVIEWER_PROFILES = {
  "astra-low": {
    nativeRole: "fresh-reviewer",
    model: CODEX_FRONTIER_AUTHORITY_MODEL,
    effort: "low",
  },
  "astra-medium": {
    nativeRole: "fresh-reviewer",
    model: CODEX_FRONTIER_AUTHORITY_MODEL,
    effort: "medium",
  },
  "astra-high": {
    nativeRole: "fresh-reviewer",
    model: CODEX_FRONTIER_AUTHORITY_MODEL,
    effort: "high",
  },
  "astra-xhigh": {
    nativeRole: "fresh-reviewer",
    model: CODEX_FRONTIER_AUTHORITY_MODEL,
    effort: "xhigh",
  },
  "astra-max": {
    nativeRole: "fresh-reviewer",
    model: CODEX_FRONTIER_AUTHORITY_MODEL,
    effort: "max",
  },
  "sol-high-compat": {
    nativeRole: "fresh-reviewer",
    model: "gpt-5.6-sol",
    effort: "high",
  },
} as const satisfies Record<string, CodexNativeRoleConfig>;

export type CodexFreshReviewerProfileId = keyof typeof CODEX_FRESH_REVIEWER_PROFILES;

export function isCodexAuthorityEffort(value: unknown): value is CodexAuthorityEffort {
  return typeof value === "string" && (CODEX_AUTHORITY_EFFORTS as readonly string[]).includes(value);
}

export function isCodexFreshReviewerProfileId(value: unknown): value is CodexFreshReviewerProfileId {
  return typeof value === "string" && Object.hasOwn(CODEX_FRESH_REVIEWER_PROFILES, value);
}

export function freshReviewerProfileForAuthorityEffort(effort: CodexAuthorityEffort): CodexFreshReviewerProfileId {
  return `astra-${effort}` as CodexFreshReviewerProfileId;
}

export function authorityReviewerAgentNameForEffort(effort: CodexAuthorityEffort): string {
  return `mandatemarshal_fresh_reviewer_astra_${effort}`;
}

export function freshReviewerRoleForProfile(profile: CodexFreshReviewerProfileId): CodexNativeRoleConfig {
  if (!isCodexFreshReviewerProfileId(profile)) throw new Error(`CODEX_REVIEWER_PROFILE_INVALID:${String(profile)}`);
  return { ...CODEX_FRESH_REVIEWER_PROFILES[profile] };
}

export function codexRoleMappingForAuthorityEffort(effort: CodexAuthorityEffort): CodexRoleMapping {
  return {
    parent: {
      nativeRole: "parent",
      model: CODEX_FRONTIER_AUTHORITY_MODEL,
      effort,
    },
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
    freshReviewer: freshReviewerRoleForProfile(freshReviewerProfileForAuthorityEffort(effort)),
  };
}

export const DEFAULT_CODEX_ROLE_MAPPING: CodexRoleMapping = codexRoleMappingForAuthorityEffort(DEFAULT_CODEX_AUTHORITY_EFFORT);

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
