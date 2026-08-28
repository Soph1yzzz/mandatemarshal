import { describe, expect, test } from "bun:test";
import { InvalidTransitionError, RunStateMachine } from "../../src/core/state-machine";
import { review } from "../fixtures/factories";

function reachFreshReview(machine: RunStateMachine, candidate = "c1"): void {
  machine.transition("INTAKE");
  machine.transition("CONTRACT_CHECK");
  machine.transition("PLANNING");
  machine.transition("READY_TO_DELEGATE");
  machine.transition("IMPLEMENTING", {
    implementationPacketComplete: true,
    adapterCapabilityAvailable: true,
    exactLaneKnown: true,
  });
  machine.transition("PARENT_VERIFYING", {
    implementationReportReturned: true,
    candidateObservable: true,
  });
  machine.setCandidate(candidate);
  machine.transition("FRESH_REVIEWING", {
    parentInspectedCandidate: true,
    verificationEvidenceAvailable: true,
  });
}

describe("RunStateMachine", () => {
  test("cannot complete without fresh PASS", () => {
    const machine = new RunStateMachine("r1");
    reachFreshReview(machine);
    expect(() => machine.transition("ACCEPTING")).toThrow(InvalidTransitionError);
  });

  test("fresh PASS authorizes only the exact candidate", () => {
    const machine = new RunStateMachine("r2");
    reachFreshReview(machine, "c1");
    machine.applyReview(review("PASS", "c1"));
    machine.setCandidate("c2");
    expect(() => machine.transition("ACCEPTING")).toThrow(/fresh PASS/i);
  });

  test("FIX invalidates review and requires a new review path", () => {
    const machine = new RunStateMachine("r3");
    reachFreshReview(machine, "c1");
    machine.applyReview(review("FIX", "c1"));
    expect(machine.state).toBe("CORRECTION_REQUIRED");
    machine.transition("IMPLEMENTING");
    machine.transition("PARENT_VERIFYING", {
      implementationReportReturned: true,
      candidateObservable: true,
    });
    machine.setCandidate("c2");
    machine.transition("FRESH_REVIEWING", {
      parentInspectedCandidate: true,
      verificationEvidenceAvailable: true,
    });
    expect(() => machine.transition("ACCEPTING")).toThrow(/fresh PASS/i);
  });

  test("reviewer ESCALATE goes to authority conflict", () => {
    const machine = new RunStateMachine("r4");
    reachFreshReview(machine, "c1");
    machine.applyReview(review("ESCALATE", "c1"));
    expect(machine.state).toBe("AUTHORITY_CONFLICT");
  });

  test("post-review mutation blocks completion", () => {
    const machine = new RunStateMachine("r5");
    reachFreshReview(machine, "c1");
    machine.applyReview(review("PASS", "c1"));
    machine.transition("ACCEPTING");
    expect(() => machine.transition("COMPLETED", { evidenceRetained: true, postReviewMutation: true })).toThrow(/mutated/i);
  });
});
