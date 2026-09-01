import { describe, expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RunStateMachine } from "../../src/core/state-machine";
import type { ImplementationPacket, ImplementerSpawnRequest, ReviewerHandle, WorkerHandle } from "../../src/core/types";
import { MockAdapter } from "../../src/adapters/generic/mock-adapter";
import { DurableEngineRuntime } from "../../src/orchestrator/durable-runtime";
import { OrchestrationEngine, type ParentController } from "../../src/orchestrator/engine";
import { persistRunArtifacts } from "../../src/runtime/evidence-store";
import { evidence, implementation, packet, review } from "../fixtures/factories";

function parentController(initial: ImplementationPacket, initialCandidate = "none"): ParentController<string> {
  let currentCandidate = initialCandidate;
  return {
    async plan() {
      return { kind: "ready", packet: initial } as const;
    },
    async verify(_packet, report) {
      currentCandidate = report.candidateId ?? "missing";
      return { passed: true, candidateId: currentCandidate, evidence: evidence() };
    },
    async observeCandidateId() {
      return currentCandidate;
    },
    async reclassifyBlocked() {
      return null;
    },
    async correction(previous) {
      return previous;
    },
    async escalateReview() {
      throw new Error("not used");
    },
  };
}

class CrashAfterImplementerLaunchAdapter extends MockAdapter {
  launches = 0;

  override async spawnImplementer(input: ImplementerSpawnRequest): Promise<WorkerHandle> {
    const handle = await super.spawnImplementer(input);
    this.launches += 1;
    throw new Error(`SIMULATED_CRASH_AFTER_IMPLEMENTER_LAUNCH:${handle.id}`);
  }
}

class CrashAfterReviewerLaunchAdapter extends MockAdapter {
  reviewerLaunches = 0;

  override async spawnFreshReviewer(input: Parameters<MockAdapter["spawnFreshReviewer"]>[0]): Promise<ReviewerHandle> {
    const handle = await super.spawnFreshReviewer(input);
    this.reviewerLaunches += 1;
    throw new Error(`SIMULATED_CRASH_AFTER_REVIEWER_LAUNCH:${handle.id}`);
  }
}

describe("OrchestrationEngine durable recovery", () => {
  test("ambiguous unfinished implementer launch stops instead of launching a duplicate", async () => {
    const root = await mkdtemp(join(tmpdir(), "mandatemarshal-engine-ambiguous-"));
    const runId = "durable-ambiguous";
    const p = packet();
    const crashing = new CrashAfterImplementerLaunchAdapter([implementation("c1")], []);
    const first = new OrchestrationEngine(crashing, parentController(p), {
      runId,
      persistArtifacts: false,
      durability: { root, ownerId: "first" },
    });
    await expect(first.run("request")).rejects.toThrow("SIMULATED_CRASH_AFTER_IMPLEMENTER_LAUNCH");
    expect(crashing.launches).toBe(1);

    const resumedAdapter = new MockAdapter([implementation("should-not-run")], [review("PASS", "should-not-run")]);
    const resumed = new OrchestrationEngine(resumedAdapter, parentController(p), {
      runId,
      persistArtifacts: false,
      durability: { root, resume: true, ownerId: "resume" },
    });
    const result = await resumed.run("request");
    expect(result.status).toBe("reconciliation-required");
    expect(resumedAdapter.spawnedLanes).toEqual([]);
  });

  test("authoritative not-found observation permits one safe retry", async () => {
    const root = await mkdtemp(join(tmpdir(), "mandatemarshal-engine-retry-"));
    const runId = "durable-retry";
    const p = packet();
    const crashing = new CrashAfterImplementerLaunchAdapter([implementation("lost")], []);
    const first = new OrchestrationEngine(crashing, parentController(p), {
      runId,
      persistArtifacts: false,
      durability: { root, ownerId: "first" },
    });
    await expect(first.run("request")).rejects.toThrow();

    const resumedAdapter = new MockAdapter([implementation("c1")], [review("PASS", "c1")]);
    const resumed = new OrchestrationEngine(resumedAdapter, parentController(p), {
      runId,
      persistArtifacts: false,
      durability: {
        root,
        resume: true,
        ownerId: "resume",
        observer: async (operation) => {
          expect(operation.kind).toBe("spawn-implementer");
          return { outcome: "not-found", detail: "provider confirms the crashed launch never became durable" };
        },
      },
    });
    const result = await resumed.run("request");
    expect(result.status).toBe("completed");
    expect(resumedAdapter.spawnedLanes).toEqual(["routine-implementer"]);
  });

  test("completed observation resumes after implementation without relaunching implementer", async () => {
    const root = await mkdtemp(join(tmpdir(), "mandatemarshal-engine-complete-"));
    const runId = "durable-complete";
    const p = packet();
    const crashing = new CrashAfterImplementerLaunchAdapter([implementation("c1")], []);
    const first = new OrchestrationEngine(crashing, parentController(p), {
      runId,
      persistArtifacts: false,
      durability: { root, ownerId: "first" },
    });
    await expect(first.run("request")).rejects.toThrow();

    const resumedAdapter = new MockAdapter([], [review("PASS", "c1")]);
    const resumed = new OrchestrationEngine(resumedAdapter, parentController(p), {
      runId,
      persistArtifacts: false,
      durability: {
        root,
        resume: true,
        ownerId: "resume",
        observer: async (operation) => ({
          outcome: "completed",
          detail: "provider recovered the finished implementation result",
          result: {
            worker: { id: "recovered-worker", role: "routine-implementer", candidateId: "c1" },
            implementation: implementation("c1"),
          },
        }),
      },
    });
    const result = await resumed.run("request");
    expect(result.status).toBe("completed");
    expect(resumedAdapter.spawnedLanes).toEqual([]);
    expect(resumedAdapter.reviewCandidates).toEqual(["c1"]);
  });

  test("ambiguous unfinished reviewer launch stops instead of launching a second reviewer", async () => {
    const root = await mkdtemp(join(tmpdir(), "mandatemarshal-review-ambiguous-"));
    const runId = "durable-review-ambiguous";
    const p = packet();
    const crashing = new CrashAfterReviewerLaunchAdapter([implementation("c1")], [review("PASS", "c1")]);
    const first = new OrchestrationEngine(crashing, parentController(p), {
      runId,
      persistArtifacts: false,
      durability: { root, ownerId: "first" },
    });
    await expect(first.run("request")).rejects.toThrow("SIMULATED_CRASH_AFTER_REVIEWER_LAUNCH");
    expect(crashing.reviewerLaunches).toBe(1);

    const resumedAdapter = new MockAdapter([], [review("PASS", "c1")]);
    const resumed = new OrchestrationEngine(resumedAdapter, parentController(p, "c1"), {
      runId,
      persistArtifacts: false,
      durability: { root, resume: true, ownerId: "resume" },
    });
    const result = await resumed.run("request");
    expect(result.status).toBe("reconciliation-required");
    expect(resumedAdapter.reviewCandidates).toEqual([]);
  });

  test("recovered reviewer completion continues to acceptance without a duplicate fresh review", async () => {
    const root = await mkdtemp(join(tmpdir(), "mandatemarshal-review-complete-"));
    const runId = "durable-review-complete";
    const p = packet();
    const crashing = new CrashAfterReviewerLaunchAdapter([implementation("c1")], [review("PASS", "c1")]);
    const first = new OrchestrationEngine(crashing, parentController(p), {
      runId,
      persistArtifacts: false,
      durability: { root, ownerId: "first" },
    });
    await expect(first.run("request")).rejects.toThrow("SIMULATED_CRASH_AFTER_REVIEWER_LAUNCH");

    const resumedAdapter = new MockAdapter([], []);
    const resumed = new OrchestrationEngine(resumedAdapter, parentController(p, "c1"), {
      runId,
      persistArtifacts: false,
      durability: {
        root,
        resume: true,
        ownerId: "resume",
        observer: async (operation) => {
          expect(operation.kind).toBe("spawn-reviewer");
          return {
            outcome: "completed",
            detail: "provider recovered the finished fresh review",
            result: {
              reviewer: { id: "recovered-reviewer", role: "fresh-reviewer", candidateId: "c1" },
              review: review("PASS", "c1"),
            },
          };
        },
      },
    });
    const result = await resumed.run("request");
    expect(result.status).toBe("completed");
    expect(resumedAdapter.spawnedLanes).toEqual([]);
    expect(resumedAdapter.reviewCandidates).toEqual([]);
    expect(result.events.some((event) => event.type === "ReviewPassed")).toBeTrue();
  });

  test("idempotent Parent verification is retried after a crash without requiring provider observation", async () => {
    const root = await mkdtemp(join(tmpdir(), "mandatemarshal-parent-verify-retry-"));
    const runId = "durable-parent-verify-retry";
    const p = packet();
    const crashingParent = parentController(p);
    crashingParent.verify = async () => {
      throw new Error("SIMULATED_CRASH_DURING_PARENT_VERIFY");
    };
    const first = new OrchestrationEngine(new MockAdapter([implementation("c1")], []), crashingParent, {
      runId,
      persistArtifacts: false,
      durability: { root, ownerId: "first" },
    });
    await expect(first.run("request")).rejects.toThrow("SIMULATED_CRASH_DURING_PARENT_VERIFY");

    const resumedAdapter = new MockAdapter([], [review("PASS", "c1")]);
    const resumed = new OrchestrationEngine(resumedAdapter, parentController(p), {
      runId,
      persistArtifacts: false,
      durability: { root, resume: true, ownerId: "resume" },
    });
    const result = await resumed.run("request");
    expect(result.status).toBe("completed");
    expect(resumedAdapter.spawnedLanes).toEqual([]);
    expect(resumedAdapter.reviewCandidates).toEqual(["c1"]);
  });

  test("completed artifact bundle is reconciled after a crash before operation completion is journaled", async () => {
    const root = await mkdtemp(join(tmpdir(), "mandatemarshal-artifact-recovery-"));
    const artifactRoot = await mkdtemp(join(tmpdir(), "mandatemarshal-artifact-output-"));
    const runId = "durable-artifact-recovery";
    const p = packet();
    const impl = implementation("c1");
    const ev = evidence();
    const rev = review("PASS", "c1");
    const machine = new RunStateMachine(runId);
    machine.transition("INTAKE");
    machine.transition("CONTRACT_CHECK");
    machine.transition("PLANNING");
    machine.transition("READY_TO_DELEGATE");
    machine.transition("IMPLEMENTING", {
      implementationPacketComplete: true,
      unresolvedOwnerConflict: false,
      adapterCapabilityAvailable: true,
      exactLaneKnown: true,
    });
    machine.transition("PARENT_VERIFYING", {
      implementationReportReturned: true,
      candidateObservable: true,
    });
    machine.setCandidate("c1");
    machine.transition("FRESH_REVIEWING", {
      parentInspectedCandidate: true,
      verificationEvidenceAvailable: true,
      unresolvedParentBlocker: false,
    });
    machine.applyReview(rev);
    machine.transition("ACCEPTING");

    const runtime = await DurableEngineRuntime.create(runId, { root, ownerId: "setup" });
    await runtime.checkpoint(machine, {
      schemaVersion: 1,
      stage: "accepting",
      packet: p,
      fixCycles: 0,
      implementation: impl,
      evidence: ev,
      verification: { passed: true, candidateId: "c1", evidence: ev },
      review: rev,
    });
    await runtime.beginOperation({
      machine,
      kind: "persist-artifacts",
      idempotencyKey: `artifacts:${runId}:c1`,
      retryPolicy: "observe-before-retry",
      payload: { candidateId: "c1" },
    });
    const artifactDir = await persistRunArtifacts(
      runId,
      {
        run: { schemaVersion: 1, status: "completed", candidateId: "c1" },
        events: machine.events,
        evidence: ev,
        review: rev,
      },
      artifactRoot,
    );
    await runtime.release();

    const resumed = new OrchestrationEngine(new MockAdapter([], []), parentController(p, "c1"), {
      runId,
      artifactRoot,
      durability: { root, resume: true, ownerId: "resume" },
    });
    const result = await resumed.run("request");
    expect(result.status).toBe("completed");
    if (result.status !== "completed") throw new Error("unexpected result");
    expect(result.artifactDir).toBe(artifactDir);
    expect(result.events.at(-1)?.payload).toEqual({ from: "ACCEPTING", to: "COMPLETED" });
  });
});
