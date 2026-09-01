import { randomUUID } from "node:crypto";
import type {
  ExecutionEvidence,
  ImplementationPacket,
  ImplementationReport,
  ReviewResult,
  WorkerHandle,
  ReviewerHandle,
} from "../core/types";
import { RunStateMachine } from "../core/state-machine";
import { DurableRunStore } from "../runtime/durable-run-store";
import {
  DurableRecoveryCoordinator,
  RunLease,
  type DurableOperationDecision,
  type DurableOperationIntent,
  type DurableOperationObserver,
  type DurableOperationRecord,
} from "../runtime/recovery";

export type DurableEngineStage =
  | "created"
  | "planned"
  | "implementing"
  | "implementation-complete"
  | "verified"
  | "reviewing"
  | "review-complete"
  | "accepting";

export interface DurableEngineState {
  schemaVersion: 1;
  stage: DurableEngineStage;
  packet?: ImplementationPacket;
  fixCycles: number;
  implementation?: ImplementationReport | undefined;
  evidence?: ExecutionEvidence | undefined;
  verification?: {
    passed: boolean;
    candidateId: string;
    evidence: ExecutionEvidence;
    blocker?: string;
  } | undefined;
  review?: ReviewResult | undefined;
  worker?: WorkerHandle | undefined;
  reviewer?: ReviewerHandle | undefined;
  artifactDir?: string;
  correctionPreparedFor?: string;
}

export interface DurableRuntimeOptions {
  root?: string;
  resume?: boolean;
  ownerId?: string;
  observer?: DurableOperationObserver;
  allowExpiredLeaseTakeover?: boolean;
  leaseTtlMs?: number;
}

export interface DurableRuntimeResume {
  machine: RunStateMachine;
  state: DurableEngineState;
  snapshotSequence: number;
  pending: DurableOperationDecision[];
  operations: DurableOperationRecord[];
}

export class DurableEngineRuntime {
  private machineEventCount = 0;
  private heartbeatTimer: ReturnType<typeof setInterval> | undefined;
  private heartbeatError: Error | undefined;

  private constructor(
    readonly store: DurableRunStore,
    readonly recovery: DurableRecoveryCoordinator,
    private readonly lease: RunLease,
    machineEventCount: number,
    private readonly leaseTtlMs: number,
  ) {
    this.machineEventCount = machineEventCount;
    this.startHeartbeat();
  }

  static async create(runId: string, options: DurableRuntimeOptions = {}): Promise<DurableEngineRuntime> {
    const store = await DurableRunStore.create(runId, options.root);
    const leaseTtlMs = options.leaseTtlMs ?? 60_000;
    const lease = await RunLease.acquire({
      store,
      ownerId: options.ownerId ?? `process-${process.pid}-${randomUUID()}`,
      ttlMs: leaseTtlMs,
    });
    return new DurableEngineRuntime(store, new DurableRecoveryCoordinator(store), lease, 0, leaseTtlMs);
  }

  static async resume(runId: string, options: DurableRuntimeOptions = {}): Promise<DurableRuntimeResume & { runtime: DurableEngineRuntime }> {
    const store = await DurableRunStore.open(runId, options.root);
    const recovered = await store.recover<DurableEngineState>();
    if (!recovered.snapshot) throw new Error(`DURABLE_SNAPSHOT_MISSING:${runId}`);
    const leaseTtlMs = options.leaseTtlMs ?? 60_000;
    const lease = await RunLease.acquire({
      store,
      ownerId: options.ownerId ?? `process-${process.pid}-${randomUUID()}`,
      ttlMs: leaseTtlMs,
      allowExpiredTakeover: options.allowExpiredLeaseTakeover ?? true,
    });
    const runtime = new DurableEngineRuntime(
      store,
      new DurableRecoveryCoordinator(store),
      lease,
      recovered.machineEvents.length,
      leaseTtlMs,
    );

    const machine = RunStateMachine.replay(runId, recovered.machineEvents);
    const pendingRecords = await runtime.recovery.pendingOperations();
    const pending: DurableOperationDecision[] = [];
    if (pendingRecords.length > 0) {
      if (!options.observer) {
        for (const record of pendingRecords) {
          pending.push({
            status: "reconciliation-required",
            operation: record.intent,
            detail: "No operation observer was supplied for an unfinished durable operation",
          });
        }
      } else {
        pending.push(...(await runtime.recovery.reconcilePending(machine.state, options.observer)));
      }
    }

    return {
      runtime,
      machine,
      state: recovered.snapshot.state,
      snapshotSequence: recovered.snapshot.sequence,
      pending,
      operations: await runtime.recovery.operations(),
    };
  }

  async checkpoint(machine: RunStateMachine, state: DurableEngineState): Promise<void> {
    this.assertLeaseHealthy();
    this.machineEventCount = await this.store.appendMachineEvents(machine.events, this.machineEventCount);
    await this.store.writeSnapshot(machine.snapshot(), state);
  }

  async beginOperation(input: {
    machine: RunStateMachine;
    kind: "spawn-implementer" | "spawn-reviewer" | "parent-verify" | "persist-artifacts" | "custom";
    idempotencyKey: string;
    retryPolicy: "idempotent" | "observe-before-retry" | "never-retry";
    payload?: unknown;
  }): Promise<DurableOperationIntent> {
    this.assertLeaseHealthy();
    return this.recovery.beginOperation({
      state: input.machine.state,
      kind: input.kind,
      idempotencyKey: input.idempotencyKey,
      retryPolicy: input.retryPolicy,
      ...(input.payload === undefined ? {} : { payload: input.payload }),
    });
  }

  async completeOperation(input: {
    machine: RunStateMachine;
    operationId: string;
    result?: unknown;
  }): Promise<void> {
    this.assertLeaseHealthy();
    await this.recovery.completeOperation({
      state: input.machine.state,
      operationId: input.operationId,
      ...(input.result === undefined ? {} : { result: input.result }),
    });
  }

  async abandonRetryablePending(decisions: readonly DurableOperationDecision[], machine: RunStateMachine): Promise<void> {
    for (const decision of decisions) {
      if (decision.status !== "retryable") continue;
      await this.recovery.abandonOperation({
        state: machine.state,
        operationId: decision.operation.operationId,
        reason: `Authoritative not-found observation permits retry: ${decision.detail}`,
      });
    }
  }

  async release(): Promise<void> {
    if (this.heartbeatTimer !== undefined) clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = undefined;
    await this.lease.release();
  }

  private startHeartbeat(): void {
    const everyMs = Math.max(1_000, Math.floor(this.leaseTtlMs / 3));
    this.heartbeatTimer = setInterval(() => {
      void this.lease.renew(this.leaseTtlMs).catch((error) => {
        this.heartbeatError = error instanceof Error ? error : new Error(String(error));
      });
    }, everyMs);
    this.heartbeatTimer.unref?.();
  }

  private assertLeaseHealthy(): void {
    if (this.heartbeatError) {
      throw new Error(`RUN_LEASE_HEARTBEAT_FAILED:${this.heartbeatError.message}`);
    }
  }
}
