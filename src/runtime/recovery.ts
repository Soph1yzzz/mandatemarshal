import { randomUUID } from "node:crypto";
import { open, readFile, rename, unlink } from "node:fs/promises";
import { join } from "node:path";
import type { DurableOperationProbeResult, RunState } from "../core/types";
import { DurableRunStore, type DurableJournalEntry } from "./durable-run-store";

export type DurableOperationKind =
  | "spawn-implementer"
  | "spawn-reviewer"
  | "parent-verify"
  | "persist-artifacts"
  | "custom";

export type DurableRetryPolicy = "idempotent" | "observe-before-retry" | "never-retry";

export interface DurableOperationIntent<T = unknown> {
  operationId: string;
  kind: DurableOperationKind;
  idempotencyKey: string;
  retryPolicy: DurableRetryPolicy;
  requestedAt: string;
  payload?: T;
}

export type DurableOperationObservation = DurableOperationProbeResult;

export type DurableOperationDecision =
  | { status: "completed"; operation: DurableOperationIntent; detail: string; result?: unknown }
  | { status: "retryable"; operation: DurableOperationIntent; detail: string }
  | { status: "waiting"; operation: DurableOperationIntent; detail: string }
  | { status: "reconciliation-required"; operation: DurableOperationIntent; detail: string };

export interface DurableOperationRecord {
  intent: DurableOperationIntent;
  state: RunState;
  intentSequence: number;
  completed: boolean;
  abandoned: boolean;
  terminalSequence?: number;
  completionResult?: unknown;
  lastObservation?: DurableOperationObservation;
}

export type DurableOperationObserver = (
  operation: DurableOperationIntent,
) => Promise<DurableOperationObservation>;

export class DurableRecoveryCoordinator {
  constructor(private readonly store: DurableRunStore) {}

  async beginOperation<T>(input: {
    state: RunState;
    kind: DurableOperationKind;
    idempotencyKey: string;
    retryPolicy: DurableRetryPolicy;
    payload?: T;
    operationId?: string;
  }): Promise<DurableOperationIntent<T>> {
    if (!input.idempotencyKey.trim()) throw new Error("Durable operation requires an idempotency key");
    const intent: DurableOperationIntent<T> = {
      operationId: input.operationId ?? randomUUID(),
      kind: input.kind,
      idempotencyKey: input.idempotencyKey,
      retryPolicy: input.retryPolicy,
      requestedAt: new Date().toISOString(),
      ...(input.payload === undefined ? {} : { payload: input.payload }),
    };
    const existing = (await this.operations()).find(
      (record) => record.intent.idempotencyKey === intent.idempotencyKey && !record.abandoned,
    );
    if (existing) {
      throw new Error(`Duplicate durable operation idempotency key: ${intent.idempotencyKey}`);
    }
    await this.store.append({
      type: "operation-intent",
      state: input.state,
      operationId: intent.operationId,
      payload: intent,
    });
    return intent;
  }

  async completeOperation<T>(input: {
    state: RunState;
    operationId: string;
    result?: T;
  }): Promise<void> {
    const record = await this.requirePending(input.operationId);
    await this.store.append({
      type: "operation-completed",
      state: input.state,
      operationId: input.operationId,
      payload: {
        idempotencyKey: record.intent.idempotencyKey,
        ...(input.result === undefined ? {} : { result: input.result }),
      },
    });
  }

  async abandonOperation(input: { state: RunState; operationId: string; reason: string }): Promise<void> {
    if (!input.reason.trim()) throw new Error("Abandoning an operation requires a reason");
    await this.requirePending(input.operationId);
    await this.store.append({
      type: "operation-abandoned",
      state: input.state,
      operationId: input.operationId,
      payload: { reason: input.reason },
    });
  }

  async observeAndReconcile(
    operationId: string,
    state: RunState,
    observer: DurableOperationObserver,
  ): Promise<DurableOperationDecision> {
    const record = await this.requirePending(operationId);
    const observation = await observer(record.intent);
    await this.store.append({
      type: "operation-observation",
      state,
      operationId,
      payload: observation,
    });

    if (observation.outcome === "completed") {
      await this.completeOperation({
        state,
        operationId,
        ...(observation.result === undefined ? {} : { result: observation.result }),
      });
      return {
        status: "completed",
        operation: record.intent,
        detail: observation.detail,
        ...(observation.result === undefined ? {} : { result: observation.result }),
      };
    }
    if (observation.outcome === "not-found") {
      return { status: "retryable", operation: record.intent, detail: observation.detail };
    }
    if (observation.outcome === "in-progress") {
      return { status: "waiting", operation: record.intent, detail: observation.detail };
    }
    return {
      status: "reconciliation-required",
      operation: record.intent,
      detail: observation.detail,
    };
  }

  async reconcilePending(state: RunState, observer: DurableOperationObserver): Promise<DurableOperationDecision[]> {
    const pending = (await this.operations()).filter((record) => !record.completed && !record.abandoned);
    const decisions: DurableOperationDecision[] = [];
    for (const record of pending) {
      if (record.intent.retryPolicy === "idempotent") {
        decisions.push({
          status: "retryable",
          operation: record.intent,
          detail: "Operation is explicitly declared idempotent and may be safely re-executed after recovery",
        });
        continue;
      }
      decisions.push(await this.observeAndReconcile(record.intent.operationId, state, observer));
    }
    return decisions;
  }

  async operations(): Promise<DurableOperationRecord[]> {
    const journal = await this.store.readJournal();
    const records = new Map<string, DurableOperationRecord>();
    for (const entry of journal) this.applyEntry(records, entry);
    return [...records.values()];
  }

  async pendingOperations(): Promise<DurableOperationRecord[]> {
    return (await this.operations()).filter((record) => !record.completed && !record.abandoned);
  }

  private applyEntry(records: Map<string, DurableOperationRecord>, entry: DurableJournalEntry): void {
    const operationId = entry.operationId;
    if (!operationId) return;
    if (entry.type === "operation-intent") {
      const intent = entry.payload as DurableOperationIntent;
      if (!intent || intent.operationId !== operationId) {
        throw new Error(`Malformed durable operation intent: ${operationId}`);
      }
      if (records.has(operationId)) throw new Error(`Duplicate durable operation id: ${operationId}`);
      records.set(operationId, {
        intent,
        state: entry.state,
        intentSequence: entry.sequence,
        completed: false,
        abandoned: false,
      });
      return;
    }
    const record = records.get(operationId);
    if (!record) throw new Error(`Operation event precedes intent: ${operationId}`);
    if (entry.type === "operation-observation") {
      record.lastObservation = entry.payload as DurableOperationObservation;
    } else if (entry.type === "operation-completed") {
      if (record.completed || record.abandoned) throw new Error(`Operation already terminal: ${operationId}`);
      record.completed = true;
      record.terminalSequence = entry.sequence;
      const payload = entry.payload as { result?: unknown } | undefined;
      if (payload?.result !== undefined) record.completionResult = payload.result;
    } else if (entry.type === "operation-abandoned") {
      if (record.completed || record.abandoned) throw new Error(`Operation already terminal: ${operationId}`);
      record.abandoned = true;
      record.terminalSequence = entry.sequence;
    }
  }

  private async requirePending(operationId: string): Promise<DurableOperationRecord> {
    const record = (await this.operations()).find((candidate) => candidate.intent.operationId === operationId);
    if (!record) throw new Error(`Unknown durable operation: ${operationId}`);
    if (record.completed || record.abandoned) throw new Error(`Durable operation is already terminal: ${operationId}`);
    return record;
  }
}

export interface RunLeaseRecord {
  schemaVersion: 1;
  runId: string;
  ownerId: string;
  token: string;
  acquiredAt: string;
  expiresAt: string;
}

export class RunLease {
  private _record: RunLeaseRecord;

  private constructor(
    readonly path: string,
    record: RunLeaseRecord,
  ) {
    this._record = record;
  }

  get record(): RunLeaseRecord {
    return this._record;
  }

  static async acquire(input: {
    store: DurableRunStore;
    ownerId: string;
    ttlMs?: number;
    allowExpiredTakeover?: boolean;
    now?: Date;
  }): Promise<RunLease> {
    if (!input.ownerId.trim()) throw new Error("Run lease ownerId must be non-empty");
    const path = join(input.store.runDir, "lease.json");
    const now = input.now ?? new Date();
    const ttlMs = input.ttlMs ?? 60_000;
    if (!Number.isFinite(ttlMs) || ttlMs <= 0) throw new Error("Run lease ttlMs must be positive");

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const record: RunLeaseRecord = {
        schemaVersion: 1,
        runId: input.store.runId,
        ownerId: input.ownerId,
        token: randomUUID(),
        acquiredAt: now.toISOString(),
        expiresAt: new Date(now.getTime() + ttlMs).toISOString(),
      };
      try {
        await writeExclusiveJson(path, record);
        return new RunLease(path, record);
      } catch (error) {
        if (!isErrorCode(error, "EEXIST")) throw error;
        const current = JSON.parse(await readFile(path, "utf8")) as RunLeaseRecord;
        if (new Date(current.expiresAt).getTime() > now.getTime()) {
          throw new Error(`RUN_LEASE_HELD:${current.ownerId}`);
        }
        if (!input.allowExpiredTakeover) {
          throw new Error(`RUN_LEASE_EXPIRED_REQUIRES_TAKEOVER:${current.ownerId}`);
        }
        try {
          await rename(path, `${path}.stale.${randomUUID()}`);
        } catch (renameError) {
          if (isErrorCode(renameError, "ENOENT")) continue;
          throw renameError;
        }
      }
    }
    throw new Error("RUN_LEASE_ACQUIRE_RACE");
  }

  async renew(ttlMs = 60_000, now = new Date()): Promise<void> {
    if (!Number.isFinite(ttlMs) || ttlMs <= 0) throw new Error("Run lease ttlMs must be positive");
    const current = JSON.parse(await readFile(this.path, "utf8")) as RunLeaseRecord;
    if (current.token !== this._record.token) throw new Error("RUN_LEASE_TOKEN_MISMATCH");
    const next: RunLeaseRecord = {
      ...current,
      expiresAt: new Date(now.getTime() + ttlMs).toISOString(),
    };
    await atomicReplaceJson(this.path, next);
    this._record = next;
  }

  async release(): Promise<void> {
    const current = JSON.parse(await readFile(this.path, "utf8")) as RunLeaseRecord;
    if (current.token !== this._record.token) throw new Error("RUN_LEASE_TOKEN_MISMATCH");
    await unlink(this.path);
  }
}

function isErrorCode(error: unknown, code: string): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as { code?: unknown }).code === code;
}

async function writeExclusiveJson(path: string, value: unknown): Promise<void> {
  const handle = await open(path, "wx", 0o600);
  try {
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function atomicReplaceJson(path: string, value: unknown): Promise<void> {
  const tempPath = `${path}.tmp.${randomUUID()}`;
  await writeExclusiveJson(tempPath, value);
  try {
    await rename(tempPath, path);
  } catch (error) {
    await unlink(tempPath).catch(() => undefined);
    throw error;
  }
}
