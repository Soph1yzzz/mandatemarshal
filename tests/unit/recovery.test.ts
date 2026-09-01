import { describe, expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DurableRunStore } from "../../src/runtime/durable-run-store";
import { DurableRecoveryCoordinator, RunLease } from "../../src/runtime/recovery";

describe("DurableRecoveryCoordinator", () => {
  test("completed observation closes an unfinished operation without reissuing it", async () => {
    const root = await mkdtemp(join(tmpdir(), "mandatemarshal-recovery-complete-"));
    const store = await DurableRunStore.create("run-r1", root);
    const recovery = new DurableRecoveryCoordinator(store);
    const intent = await recovery.beginOperation({
      state: "IMPLEMENTING",
      kind: "spawn-implementer",
      idempotencyKey: "worker:packet-1",
      retryPolicy: "observe-before-retry",
      payload: { packetId: "packet-1" },
    });

    let observations = 0;
    const decision = await recovery.observeAndReconcile(intent.operationId, "IMPLEMENTING", async () => {
      observations += 1;
      return { outcome: "completed", detail: "provider reports finished", result: { handleId: "worker-9" } };
    });

    expect(observations).toBe(1);
    expect(decision.status).toBe("completed");
    expect(await recovery.pendingOperations()).toHaveLength(0);
    const records = await recovery.operations();
    expect(records[0]?.completionResult).toEqual({ handleId: "worker-9" });
  });

  test("authoritative not-found is retryable but unknown is reconciliation-required", async () => {
    const root = await mkdtemp(join(tmpdir(), "mandatemarshal-recovery-unknown-"));
    const store = await DurableRunStore.create("run-r2", root);
    const recovery = new DurableRecoveryCoordinator(store);
    const absent = await recovery.beginOperation({
      state: "IMPLEMENTING",
      kind: "spawn-implementer",
      idempotencyKey: "worker:absent",
      retryPolicy: "never-retry",
    });
    const unknown = await recovery.beginOperation({
      state: "FRESH_REVIEWING",
      kind: "spawn-reviewer",
      idempotencyKey: "reviewer:unknown",
      retryPolicy: "never-retry",
    });

    const absentDecision = await recovery.observeAndReconcile(absent.operationId, "IMPLEMENTING", async () => ({
      outcome: "not-found",
      detail: "provider authoritatively reports no matching operation",
    }));
    const unknownDecision = await recovery.observeAndReconcile(unknown.operationId, "FRESH_REVIEWING", async () => ({
      outcome: "unknown",
      detail: "provider cannot determine whether launch escaped before crash",
    }));

    expect(absentDecision.status).toBe("retryable");
    expect(unknownDecision.status).toBe("reconciliation-required");
    expect(await recovery.pendingOperations()).toHaveLength(2);
  });

  test("duplicate idempotency keys are rejected while the prior operation is live", async () => {
    const root = await mkdtemp(join(tmpdir(), "mandatemarshal-recovery-key-"));
    const store = await DurableRunStore.create("run-r3", root);
    const recovery = new DurableRecoveryCoordinator(store);
    await recovery.beginOperation({
      state: "IMPLEMENTING",
      kind: "spawn-implementer",
      idempotencyKey: "same-key",
      retryPolicy: "observe-before-retry",
    });
    await expect(
      recovery.beginOperation({
        state: "IMPLEMENTING",
        kind: "spawn-implementer",
        idempotencyKey: "same-key",
        retryPolicy: "observe-before-retry",
      }),
    ).rejects.toThrow("Duplicate durable operation idempotency key");
  });
});

describe("RunLease", () => {
  test("renew extends lease ownership so a live writer cannot be taken over", async () => {
    const root = await mkdtemp(join(tmpdir(), "mandatemarshal-lease-renew-"));
    const store = await DurableRunStore.create("run-l0", root);
    const lease = await RunLease.acquire({
      store,
      ownerId: "owner-a",
      ttlMs: 1_000,
      now: new Date("2026-08-31T00:00:00.000Z"),
    });
    await lease.renew(1_000, new Date("2026-08-31T00:00:00.800Z"));
    expect(lease.record.expiresAt).toBe("2026-08-31T00:00:01.800Z");
    await expect(
      RunLease.acquire({
        store,
        ownerId: "owner-b",
        ttlMs: 1_000,
        now: new Date("2026-08-31T00:00:01.200Z"),
        allowExpiredTakeover: true,
      }),
    ).rejects.toThrow("RUN_LEASE_HELD:owner-a");
    await lease.release();
  });

  test("enforces single writer and allows explicit expired takeover", async () => {
    const root = await mkdtemp(join(tmpdir(), "mandatemarshal-lease-"));
    const store = await DurableRunStore.create("run-l1", root);
    const firstNow = new Date("2026-08-31T00:00:00.000Z");
    const first = await RunLease.acquire({ store, ownerId: "owner-a", ttlMs: 1_000, now: firstNow });

    await expect(
      RunLease.acquire({ store, ownerId: "owner-b", ttlMs: 1_000, now: new Date("2026-08-31T00:00:00.500Z") }),
    ).rejects.toThrow("RUN_LEASE_HELD:owner-a");

    await expect(
      RunLease.acquire({ store, ownerId: "owner-b", ttlMs: 1_000, now: new Date("2026-08-31T00:00:02.000Z") }),
    ).rejects.toThrow("RUN_LEASE_EXPIRED_REQUIRES_TAKEOVER:owner-a");

    const second = await RunLease.acquire({
      store,
      ownerId: "owner-b",
      ttlMs: 1_000,
      now: new Date("2026-08-31T00:00:02.000Z"),
      allowExpiredTakeover: true,
    });
    expect(second.record.ownerId).toBe("owner-b");
    await expect(first.release()).rejects.toThrow();
    await second.release();
  });
});
