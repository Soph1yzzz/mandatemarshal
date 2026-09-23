import type { ImplementationLane } from "../core/types";

export const COMPLEXITY_TRIGGERS = [
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
  if (assessment.materialTriggers.includes("routine-worker-blocked")) {
    return {
      kind: "route",
      lane: "complex-implementer",
      reason: "explicit escalation after the Luna implementation lane reported blocked",
    };
  }
  return {
    kind: "route",
    lane: "routine-implementer",
    reason: "Luna-first policy: settled bounded implementation starts on the default lane",
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
