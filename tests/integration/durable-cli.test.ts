import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RunStateMachine } from "../../src/core/state-machine";
import { DurableRunStore } from "../../src/runtime/durable-run-store";
import { DurableRecoveryCoordinator } from "../../src/runtime/recovery";

async function runCli(args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  const proc = Bun.spawn([process.execPath, "bin/mandatemarshal.ts", ...args], {
    cwd: process.cwd(),
    env: process.env,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [code, stdout, stderr] = await Promise.all([
    proc.exited,
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  return { code, stdout, stderr };
}

test("run CLI reports durable status and records a resume request without editing snapshot state", async () => {
  const root = await mkdtemp(join(tmpdir(), "mandatemarshal-run-cli-"));
  try {
    const store = await DurableRunStore.create("cli-ready", root);
    const machine = new RunStateMachine("cli-ready");
    machine.transition("INTAKE");
    await store.appendMachineEvents(machine.events);
    await store.writeSnapshot(machine.snapshot(), { marker: "unchanged" });

    const status = await runCli(["run", "status", "cli-ready", "--root", root]);
    expect(status.code).toBe(0);
    const statusPayload = JSON.parse(status.stdout);
    expect(statusPayload.state).toBe("INTAKE");
    expect(statusPayload.resumeStatus).toBe("ready");
    expect(statusPayload.pendingOperations).toEqual([]);

    const resume = await runCli(["run", "resume", "cli-ready", "--root", root]);
    expect(resume.code).toBe(0);
    const resumePayload = JSON.parse(resume.stdout);
    expect(resumePayload.resumeStatus).toBe("ready");
    expect(resumePayload.resumeOptions).toEqual({
      runId: "cli-ready",
      durability: { root, resume: true },
    });

    const recovered = await store.recover<{ marker: string }>();
    expect(recovered.snapshot?.state.marker).toBe("unchanged");
    expect(recovered.journal.some((entry) => entry.type === "operator-command")).toBeTrue();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("run CLI exits distinctly when unfinished operations require reconciliation", async () => {
  const root = await mkdtemp(join(tmpdir(), "mandatemarshal-run-cli-pending-"));
  try {
    const store = await DurableRunStore.create("cli-pending", root);
    const machine = new RunStateMachine("cli-pending");
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
    await store.appendMachineEvents(machine.events);
    await store.writeSnapshot(machine.snapshot(), { marker: "pending" });
    await new DurableRecoveryCoordinator(store).beginOperation({
      state: "IMPLEMENTING",
      kind: "spawn-implementer",
      idempotencyKey: "cli-pending-worker",
      retryPolicy: "observe-before-retry",
    });

    const status = await runCli(["run", "status", "cli-pending", "--root", root]);
    expect(status.code).toBe(4);
    const payload = JSON.parse(status.stdout);
    expect(payload.resumeStatus).toBe("reconciliation-required");
    expect(payload.pendingOperations).toHaveLength(1);

    const resume = await runCli(["run", "resume", "cli-pending", "--root", root]);
    expect(resume.code).toBe(4);
    expect(JSON.parse(resume.stdout).resumeStatus).toBe("reconciliation-required");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
