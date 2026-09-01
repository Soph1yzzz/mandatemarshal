import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RunStateMachine } from "../../src/core/state-machine";
import { DurableRunStore } from "../../src/runtime/durable-run-store";

describe("DurableRunStore", () => {
  test("persists append-only machine events and restores a state machine snapshot", async () => {
    const root = await mkdtemp(join(tmpdir(), "mandatemarshal-durable-"));
    const store = await DurableRunStore.create("run-a", root);
    const machine = new RunStateMachine("run-a");
    machine.transition("INTAKE");
    machine.transition("CONTRACT_CHECK");
    machine.transition("PLANNING");

    const count = await store.appendMachineEvents(machine.events);
    expect(count).toBe(3);
    await store.writeSnapshot(machine.snapshot(), { packetId: "p1" });

    const reopened = await DurableRunStore.open("run-a", root);
    const recovered = await reopened.recover<{ packetId: string }>();
    expect(recovered.journal).toHaveLength(3);
    expect(recovered.snapshot?.state.packetId).toBe("p1");
    expect(recovered.snapshot?.machine.state).toBe("PLANNING");

    const restored = RunStateMachine.restore(recovered.snapshot!.machine, recovered.machineEvents);
    expect(restored.state).toBe("PLANNING");
    expect(restored.events).toHaveLength(3);
  });

  test("rejects journal sequence corruption instead of guessing", async () => {
    const root = await mkdtemp(join(tmpdir(), "mandatemarshal-durable-corrupt-"));
    const store = await DurableRunStore.create("run-b", root);
    const machine = new RunStateMachine("run-b");
    machine.transition("INTAKE");
    await store.appendMachineEvents(machine.events);

    const original = await readFile(store.journalPath, "utf8");
    const first = JSON.parse(original.trim()) as Record<string, unknown>;
    first.sequence = 7;
    await writeFile(store.journalPath, `${JSON.stringify(first)}\n`, "utf8");

    const reopened = await DurableRunStore.open("run-b", root).catch((error) => error);
    expect(reopened).toBeInstanceOf(Error);
    expect(String(reopened)).toContain("sequence gap");
  });

  test("restored PASS remains bound to the exact candidate", async () => {
    const machine = new RunStateMachine("run-c");
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
    machine.setCandidate("candidate-a");
    machine.transition("FRESH_REVIEWING", {
      parentInspectedCandidate: true,
      verificationEvidenceAvailable: true,
      unresolvedParentBlocker: false,
    });
    machine.applyReview({
      schemaVersion: 1,
      verdict: "PASS",
      candidateId: "candidate-a",
      reason: "ok",
      findings: [],
      requiredAction: "none",
      residualRisk: "none",
    });

    const restored = RunStateMachine.restore(machine.snapshot(), machine.events);
    restored.transition("ACCEPTING");
    expect(restored.state).toBe("ACCEPTING");
    restored.setCandidate("candidate-b");
    expect(() => restored.transition("COMPLETED", { evidenceRetained: true, postReviewMutation: false })).toThrow(
      "Fresh PASS is stale or absent",
    );
  });
});
