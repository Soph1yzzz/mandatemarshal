import { describe, expect, test } from "bun:test";
import { buildEscalationPacket } from "../../src/core/authority";
import type { ImplementationPacket, ReviewResult } from "../../src/core/types";
import { MockAdapter } from "../../src/adapters/generic/mock-adapter";
import { OrchestrationEngine, type ParentController } from "../../src/orchestrator/engine";
import { evidence, implementation, packet, review } from "../fixtures/factories";

function parentController(initial: ImplementationPacket, mutateAfterReview = false): ParentController<string> {
  let currentCandidate = "none";
  return {
    async plan() {
      return { kind: "ready", packet: initial } as const;
    },
    async verify(_packet, report) {
      currentCandidate = report.candidateId ?? "missing";
      return { passed: true, candidateId: currentCandidate, evidence: evidence() };
    },
    async observeCandidateId() {
      return mutateAfterReview ? `${currentCandidate}-mutated` : currentCandidate;
    },
    async reclassifyBlocked() {
      return null;
    },
    async correction(previous, _review) {
      return {
        ...previous,
        routing: { ...previous.routing, reason: "bounded correction after FIX" },
      };
    },
    async escalateReview(_packet, result: ReviewResult) {
      return buildEscalationPacket({
        source: "reviewer",
        existingContract: "settled public interface",
        newRequirement: result.reason,
        whyConflict: "Reviewer found an issue outside bounded QA repair authority.",
        checked: ["bounded fix feasibility"],
        simultaneouslySatisfiable: "uncertain",
        options: [{
          name: "hold",
          description: "Hold the conflicting action for owner decision.",
          preservesOwnerContract: true,
          reversibility: "reversible",
        }],
        decisionRequired: "Approve an owner-significant change?",
        heldAction: "Architecture-changing correction",
      });
    },
  };
}

describe("OrchestrationEngine", () => {
  test("happy path completes only after fresh PASS", async () => {
    const p = packet();
    const adapter = new MockAdapter([implementation("c1")], [review("PASS", "c1")]);
    const engine = new OrchestrationEngine(adapter, parentController(p), { persistArtifacts: false, runId: "happy" });
    const result = await engine.run("request");
    expect(result.status).toBe("completed");
    expect(adapter.reviewCandidates).toEqual(["c1"]);
    expect(result.events.some((event) => event.type === "ReviewPassed")).toBeTrue();
  });

  test("FIX requires correction and a NEW fresh review of new candidate", async () => {
    const p = packet();
    const adapter = new MockAdapter(
      [implementation("c1"), implementation("c2")],
      [review("FIX", "c1"), review("PASS", "c2")],
    );
    const engine = new OrchestrationEngine(adapter, parentController(p), { persistArtifacts: false, runId: "fix-loop" });
    const result = await engine.run("request");
    expect(result.status).toBe("completed");
    expect(adapter.reviewCandidates).toEqual(["c1", "c2"]);
  });

  test("reviewer ESCALATE returns owner decision pending instead of redesign", async () => {
    const p = packet();
    const adapter = new MockAdapter([implementation("c1")], [review("ESCALATE", "c1")]);
    const engine = new OrchestrationEngine(adapter, parentController(p), { persistArtifacts: false, runId: "escalate" });
    const result = await engine.run("request");
    expect(result.status).toBe("user-decision-pending");
    if (result.status !== "user-decision-pending") throw new Error("unexpected result");
    expect(result.escalation.heldAction).toBe("Architecture-changing correction");
  });

  test("reviewer mutation invalidates review and blocks completion", async () => {
    const p = packet();
    const adapter = new MockAdapter([implementation("c1")], [review("PASS", "c1")]);
    const engine = new OrchestrationEngine(adapter, parentController(p, true), { persistArtifacts: false, runId: "mutation" });
    const result = await engine.run("request");
    expect(result.status).toBe("blocked");
    if (result.status !== "blocked") throw new Error("unexpected result");
    expect(result.reason).toBe("REVIEWER_MUTATED_CANDIDATE");
  });

  test("routine worker blockage may be explicitly reclassified to complex", async () => {
    const p = packet("routine-implementer");
    const { candidateId: _unusedCandidateId, ...baseBlocked } = implementation("unused", "routine-implementer");
    const blocked = {
      ...baseBlocked,
      status: "blocked" as const,
      gaps: ["cross-subsystem root cause exceeds bounded routine packet"],
    };
    const adapter = new MockAdapter(
      [blocked, implementation("c2", "complex-implementer")],
      [review("PASS", "c2")],
    );
    const parent = parentController(p);
    parent.reclassifyBlocked = async (current, report) => ({
      ...current,
      routing: {
        lane: "complex-implementer",
        reason: "Parent inspected explicit routine-worker complexity blockage",
        reclassifiedFrom: "routine-implementer",
        reclassificationReason: report.gaps[0] ?? "routine worker blocked",
      },
    });
    const engine = new OrchestrationEngine(adapter, parent, { persistArtifacts: false, runId: "reclassify" });
    const result = await engine.run("request");
    expect(result.status).toBe("completed");
    expect(adapter.spawnedLanes).toEqual(["routine-implementer", "complex-implementer"]);
    expect(result.events.some((event) => event.type === "LaneReclassified")).toBeTrue();
  });

  test("missing fresh-context capability blocks compliant completion", async () => {
    const p = packet();
    const baseCaps = await new MockAdapter([], []).capabilities();
    const adapter = new MockAdapter(
      [implementation("c1")],
      [review("PASS", "c1")],
      { ...baseCaps, freshContext: false },
    );
    const engine = new OrchestrationEngine(adapter, parentController(p), { persistArtifacts: false, runId: "no-review" });
    const result = await engine.run("request");
    expect(result.status).toBe("blocked");
    if (result.status !== "blocked") throw new Error("unexpected result");
    expect(result.reason).toBe("REVIEW_CAPABILITY_UNAVAILABLE");
  });
});
