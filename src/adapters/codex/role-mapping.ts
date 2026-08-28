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
  freshReviewer: {
    nativeRole: "fresh-reviewer",
    model: "gpt-5.6-sol",
    effort: "high",
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
