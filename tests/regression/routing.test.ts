import { describe, expect, test } from "bun:test";
import { classifyImplementation, reclassifyBlockedRoutine } from "../../src/orchestrator/routing";
import { DEFAULT_CODEX_ROLE_MAPPING, routingEvidenceForLane } from "../../src/adapters/codex/role-mapping";

 describe("routing regressions", () => {
  test("settled routine task maps to Luna/Max", () => {
    const decision = classifyImplementation({
      packetSettled: true,
      ownerDecisionUnresolved: false,
      materialTriggers: [],
    });
    expect(decision).toEqual({
      kind: "route",
      lane: "routine-implementer",
      reason: "settled bounded implementation with no material complexity trigger",
    });
    const evidence = routingEvidenceForLane(DEFAULT_CODEX_ROLE_MAPPING, "routine-implementer", "test");
    expect(evidence.requestedModel).toBe("gpt-5.6-luna");
    expect(evidence.requestedEffort).toBe("max");
  });

  test("material complexity maps to Terra/High", () => {
    const decision = classifyImplementation({
      packetSettled: true,
      ownerDecisionUnresolved: false,
      materialTriggers: ["public-interface-risk"],
    });
    expect(decision.kind).toBe("route");
    if (decision.kind !== "route") throw new Error("unexpected hold");
    expect(decision.lane).toBe("complex-implementer");
    const evidence = routingEvidenceForLane(DEFAULT_CODEX_ROLE_MAPPING, decision.lane, decision.reason);
    expect(evidence.requestedModel).toBe("gpt-5.6-terra");
    expect(evidence.requestedEffort).toBe("high");
  });

  test("routine blocked reclassification is explicit", () => {
    expect(reclassifyBlockedRoutine("cross-subsystem root cause")).toEqual({
      from: "routine-implementer",
      to: "complex-implementer",
      event: "LaneReclassified",
      reason: "cross-subsystem root cause",
    });
  });

  test("unresolved owner decision is a hold, never a route", () => {
    expect(classifyImplementation({
      packetSettled: true,
      ownerDecisionUnresolved: true,
      materialTriggers: [],
    }).kind).toBe("hold");
  });
});
