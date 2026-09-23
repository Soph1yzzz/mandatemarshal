import type { ImplementationLane, RoutingEvidence } from "../../core/types";

export interface CodexNativeRoleConfig {
  nativeRole: string;
  model: string;
  effort: string;
}

export interface CodexRoleMapping {
  parent: CodexNativeRoleConfig;
  routineImplementer: CodexNativeRoleConfig;
  complexImplementer: CodexNativeRoleConfig;
  freshReviewer: CodexNativeRoleConfig;
}

export const CODEX_AUTHORITY_MODEL = "gpt-6-sol" as const;
export const CODEX_AUTHORITY_EFFORT = "high" as const;
export const CODEX_DEFAULT_IMPLEMENTER_MODEL = "gpt-6-luna" as const;
export const CODEX_DEFAULT_IMPLEMENTER_EFFORT = "max" as const;
export const CODEX_ESCALATION_IMPLEMENTER_MODEL = "gpt-6-sol" as const;
export const CODEX_ESCALATION_IMPLEMENTER_EFFORT = "high" as const;

export const DEFAULT_CODEX_ROLE_MAPPING: CodexRoleMapping = {
  parent: {
    nativeRole: "parent",
    model: CODEX_AUTHORITY_MODEL,
    effort: CODEX_AUTHORITY_EFFORT,
  },
  routineImplementer: {
    nativeRole: "routine-implementer",
    model: CODEX_DEFAULT_IMPLEMENTER_MODEL,
    effort: CODEX_DEFAULT_IMPLEMENTER_EFFORT,
  },
  complexImplementer: {
    nativeRole: "complex-implementer",
    model: CODEX_ESCALATION_IMPLEMENTER_MODEL,
    effort: CODEX_ESCALATION_IMPLEMENTER_EFFORT,
  },
  freshReviewer: {
    nativeRole: "fresh-reviewer",
    model: CODEX_AUTHORITY_MODEL,
    effort: CODEX_AUTHORITY_EFFORT,
  },
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
