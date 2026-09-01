import { DurableRunStore, defaultDurableRunRoot } from "./durable-run-store";
import { DurableRecoveryCoordinator } from "./recovery";
import { RunStateMachine } from "../core/state-machine";

export interface DurableRunStatus {
  schemaVersion: 1;
  runId: string;
  runtimeDir: string;
  state: string;
  candidateId?: string;
  journalSequence: number;
  snapshotSequence: number;
  pendingOperations: Array<{
    operationId: string;
    kind: string;
    idempotencyKey: string;
    retryPolicy: string;
  }>;
  resumeStatus: "ready" | "reconciliation-required" | "terminal";
}

export async function inspectDurableRun(
  runId: string,
  root = defaultDurableRunRoot(),
): Promise<DurableRunStatus> {
  const store = await DurableRunStore.open(runId, root);
  const recovered = await store.recover();
  const machine = RunStateMachine.replay(runId, recovered.machineEvents);
  const pending = await new DurableRecoveryCoordinator(store).pendingOperations();
  const terminal = machine.state === "COMPLETED" || machine.state === "ABORTED";
  return {
    schemaVersion: 1,
    runId,
    runtimeDir: store.runDir,
    state: machine.state,
    ...(machine.snapshot().candidateId === undefined ? {} : { candidateId: machine.snapshot().candidateId }),
    journalSequence: recovered.journal.at(-1)?.sequence ?? 0,
    snapshotSequence: recovered.snapshot?.sequence ?? 0,
    pendingOperations: pending.map((record) => ({
      operationId: record.intent.operationId,
      kind: record.intent.kind,
      idempotencyKey: record.intent.idempotencyKey,
      retryPolicy: record.intent.retryPolicy,
    })),
    resumeStatus: terminal ? "terminal" : pending.length > 0 ? "reconciliation-required" : "ready",
  };
}

export async function recordResumeRequest(
  runId: string,
  root = defaultDurableRunRoot(),
): Promise<DurableRunStatus & { resumeOptions?: { runId: string; durability: { root: string; resume: true } } }> {
  const store = await DurableRunStore.open(runId, root);
  const status = await inspectDurableRun(runId, root);
  if (status.resumeStatus !== "ready") return status;
  await store.append({
    type: "operator-command",
    state: status.state as import("../core/types").RunState,
    payload: { command: "resume-requested" },
  });
  const refreshed = await inspectDurableRun(runId, root);
  return {
    ...refreshed,
    resumeOptions: {
      runId,
      durability: { root, resume: true },
    },
  };
}
