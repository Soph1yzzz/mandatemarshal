import { describe, expect, test } from "bun:test";
import { classifyImplementation, reclassifyBlockedRoutine } from "../../src/orchestrator/routing";
import {
  CODEX_AUTHORITY_EFFORT,
  CODEX_AUTHORITY_MODEL,
  DEFAULT_CODEX_ROLE_MAPPING,
  routingEvidenceForLane,
} from "../../src/adapters/codex/role-mapping";

describe("routing regressions", () => {
  test("settled implementation starts on GPT-6 Luna/Max", () => {
    const decision = classifyImplementation({
      packetSettled: true,
      ownerDecisionUnresolved: false,
      materialTriggers: [],
    });
    expect(decision).toEqual({
      kind: "route",
      lane: "routine-implementer",
      reason: "Luna-first policy: settled bounded implementation starts on the default lane",
    });
    const evidence = routingEvidenceForLane(DEFAULT_CODEX_ROLE_MAPPING, "routine-implementer", "test");
    expect(evidence.requestedModel).toBe("gpt-6-luna");
    expect(evidence.requestedEffort).toBe("max");
  });

  test("only an observed blocked-Luna trigger routes to the Sol escalation lane", () => {
    const decision = classifyImplementation({
      packetSettled: true,
      ownerDecisionUnresolved: false,
      materialTriggers: ["routine-worker-blocked"],
    });
    expect(decision).toEqual({
      kind: "route",
      lane: "complex-implementer",
      reason: "explicit escalation after the Luna implementation lane reported blocked",
    });
    const evidence = routingEvidenceForLane(DEFAULT_CODEX_ROLE_MAPPING, "complex-implementer", "test");
    expect(evidence.requestedModel).toBe("gpt-6-sol");
    expect(evidence.requestedEffort).toBe("high");
  });

  test("Parent and Fresh Reviewer are fixed to GPT-6 Sol/High", () => {
    expect(CODEX_AUTHORITY_MODEL).toBe("gpt-6-sol");
    expect(CODEX_AUTHORITY_EFFORT).toBe("high");
    expect(DEFAULT_CODEX_ROLE_MAPPING.parent).toEqual({
      nativeRole: "parent",
      model: "gpt-6-sol",
      effort: "high",
    });
    expect(DEFAULT_CODEX_ROLE_MAPPING.freshReviewer).toEqual({
      nativeRole: "fresh-reviewer",
      model: "gpt-6-sol",
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
