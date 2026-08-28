import type { ImplementationLane } from "../core/types";

export const COMPLEXITY_TRIGGERS = [
  "architecture-ambiguity",
  "broad-refactor-or-migration",
  "concurrency",
  "security-sensitive",
  "difficult-debugging",
  "non-trivial-algorithm",
  "public-interface-risk",
  "cross-subsystem-context",
  "high-context",
  "wide-blast-radius",
  "routine-worker-blocked",
] as const;

export type ComplexityTrigger = typeof COMPLEXITY_TRIGGERS[number];

export interface RoutingAssessment {
  packetSettled: boolean;
  ownerDecisionUnresolved: boolean;
  materialTriggers: ComplexityTrigger[];
}

export type RoutingDecision =
  | { kind: "hold"; reason: string }
  | { kind: "route"; lane: ImplementationLane; reason: string };

export function classifyImplementation(assessment: RoutingAssessment): RoutingDecision {
  if (assessment.ownerDecisionUnresolved) {
    return { kind: "hold", reason: "owner decision unresolved" };
  }
  if (!assessment.packetSettled) {
    return { kind: "hold", reason: "implementation packet is not settled" };
  }
  if (assessment.materialTriggers.length > 0) {
    return {
      kind: "route",
      lane: "complex-implementer",
      reason: `material complexity: ${assessment.materialTriggers.join(", ")}`,
    };
  }
  return {
    kind: "route",
    lane: "routine-implementer",
    reason: "settled bounded implementation with no material complexity trigger",
  };
}

export function reclassifyBlockedRoutine(reason: string): {
  from: "routine-implementer";
  to: "complex-implementer";
  event: "LaneReclassified";
  reason: string;
} {
  if (!reason.trim()) throw new Error("Reclassification requires an explicit reason");
  return {
    from: "routine-implementer",
    to: "complex-implementer",
    event: "LaneReclassified",
    reason,
  };
}
