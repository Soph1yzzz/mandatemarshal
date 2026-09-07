import { describe, expect, test } from "bun:test";
import { classifyImplementation, reclassifyBlockedRoutine } from "../../src/orchestrator/routing";
import {
  CODEX_FRONTIER_AUTHORITY_MODEL,
  DEFAULT_CODEX_AUTHORITY_EFFORT,
  authorityReviewerAgentNameForEffort,
  DEFAULT_CODEX_ROLE_MAPPING,
  codexRoleMappingForAuthorityEffort,
  freshReviewerProfileForAuthorityEffort,
  freshReviewerRoleForProfile,
  routingEvidenceForLane,
} from "../../src/adapters/codex/role-mapping";

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

  test("Astra authority effort is shared by Parent and Fresh Reviewer", () => {
    expect(DEFAULT_CODEX_AUTHORITY_EFFORT).toBe("medium");
    expect(DEFAULT_CODEX_ROLE_MAPPING.parent).toEqual({
      nativeRole: "parent",
      model: CODEX_FRONTIER_AUTHORITY_MODEL,
      effort: "medium",
    });
    expect(DEFAULT_CODEX_ROLE_MAPPING.freshReviewer).toEqual({
      nativeRole: "fresh-reviewer",
      model: CODEX_FRONTIER_AUTHORITY_MODEL,
      effort: "medium",
    });
    for (const effort of ["low", "medium", "high", "xhigh", "max"] as const) {
      const mapping = codexRoleMappingForAuthorityEffort(effort);
      expect(mapping.parent.model).toBe("gpt-6-astra");
      expect(mapping.parent.effort).toBe(effort);
      expect(mapping.freshReviewer.model).toBe("gpt-6-astra");
      expect(mapping.freshReviewer.effort).toBe(effort);
      expect(freshReviewerRoleForProfile(freshReviewerProfileForAuthorityEffort(effort))).toEqual(mapping.freshReviewer);
      expect(authorityReviewerAgentNameForEffort(effort)).toBe(`mandatemarshal_fresh_reviewer_astra_${effort}`);
    }
  });

  test("Sol remains explicit compatibility only", () => {
    expect(freshReviewerRoleForProfile("sol-high-compat")).toEqual({
      nativeRole: "fresh-reviewer",
      model: "gpt-5.6-sol",
      effort: "high",
    });
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
