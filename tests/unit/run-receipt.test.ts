import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  advanceRunReceiptLifecycle,
  captureRunCandidate,
  ensureRunReceipt,
  listRunReceipts,
  pruneExpiredRunTraces,
  readRunHistory,
  readRunReceipt,
  recordRunReceiptEvent,
  RUN_TRACE_RETENTION_DAYS,
  startRunReceipt,
} from "../../src/runtime/run-receipt";

async function roots(prefix: string): Promise<{ base: string; storageRoot: string; traceRoot: string }> {
  const base = await mkdtemp(join(tmpdir(), prefix));
  return { base, storageRoot: join(base, "receipts"), traceRoot: join(base, "traces") };
}

async function runCommand(cwd: string, args: string[]): Promise<void> {
  const proc = Bun.spawn(args, { cwd, stdout: "pipe", stderr: "pipe" });
  const [code, stderr] = await Promise.all([proc.exited, new Response(proc.stderr).text()]);
  if (code !== 0) throw new Error(`${args.join(" ")} failed: ${stderr}`);
}

test("skill-contract run gets a canonical persistent receipt and temporary trace", async () => {
  const { base, storageRoot, traceRoot } = await roots("mandatemarshal-receipt-");
  try {
    const receipt = await startRunReceipt(process.cwd(), "skill-contract", {
      storageRoot,
      traceRoot,
      mandatemarshalVersion: "0.2.5",
      idFactory: () => "unit-a",
      now: () => new Date("2026-09-03T12:00:00.000Z"),
    });

    expect(receipt.runId).toBe("mm-20260903-unit-a");
    expect(receipt.mode).toBe("skill-contract");
    expect(receipt.mandatemarshalVersion).toBe("0.2.5");
    expect(receipt.traceRetentionDays).toBe(30);

    const persisted = await readRunReceipt(receipt.runId, { storageRoot, traceRoot });
    expect(persisted).toEqual(receipt);

    const history = await readRunHistory(receipt.runId, { storageRoot, traceRoot });
    expect(history.available).toBeTrue();
    expect(history.partial).toBeFalse();
    expect(history.events.map((event) => event.type)).toEqual(["run-started"]);
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

test("receipt tracks candidate-bound Parent verification, fresh review and completion", async () => {
  const { base, storageRoot, traceRoot } = await roots("mandatemarshal-receipt-flow-");
  try {
    const options = {
      storageRoot,
      traceRoot,
      mandatemarshalVersion: "0.2.5",
      idFactory: () => "flow",
      now: () => new Date("2026-09-03T12:00:00.000Z"),
    };
    const receipt = await startRunReceipt(process.cwd(), "skill-contract", options);
    await recordRunReceiptEvent(receipt.runId, "implementer-started", { threadId: "impl-1" }, options);
    await recordRunReceiptEvent(receipt.runId, "candidate-observed", { candidateId: "candidate-a", gitHead: "abc123" }, options);
    await recordRunReceiptEvent(receipt.runId, "parent-verified", { candidateId: "candidate-a" }, options);
    await recordRunReceiptEvent(receipt.runId, "reviewer-started", { candidateId: "candidate-a", threadId: "review-1" }, options);
    await recordRunReceiptEvent(receipt.runId, "review-verdict", { candidateId: "candidate-a", verdict: "PASS" }, options);
    const completed = await recordRunReceiptEvent(receipt.runId, "run-completed", {}, options);

    expect(completed.status).toBe("completed");
    expect(completed.candidateId).toBe("candidate-a");
    expect(completed.gitHead).toBe("abc123");
    expect(completed.parentVerifiedCandidateId).toBe("candidate-a");
    expect(completed.latestImplementerThreadId).toBe("impl-1");
    expect(completed.latestReviewerThreadId).toBe("review-1");
    expect(completed.latestVerdict).toBe("PASS");
    expect(completed.freshPassCandidateId).toBe("candidate-a");

    const history = await readRunHistory(receipt.runId, { storageRoot, traceRoot });
    expect(history.events.map((event) => event.type)).toEqual([
      "run-started",
      "implementer-started",
      "candidate-observed",
      "parent-verified",
      "reviewer-started",
      "review-verdict",
      "run-completed",
    ]);
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

test("Skill lifecycle advance mechanically observes candidate without duplicate unchanged capture events", async () => {
  const { base, storageRoot, traceRoot } = await roots("mandatemarshal-receipt-advance-");
  try {
    const options = { storageRoot, traceRoot, mandatemarshalVersion: "0.2.6", idFactory: () => "advance" };
    const receipt = await startRunReceipt(process.cwd(), "skill-contract", options);

    await advanceRunReceiptLifecycle(receipt.runId, "implementer-started", { threadId: "impl-advance" }, options);
    const parent = await advanceRunReceiptLifecycle(receipt.runId, "parent-verified", {}, options);
    expect(parent.candidateId).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(parent.parentVerifiedCandidateId).toBe(parent.candidateId);

    await advanceRunReceiptLifecycle(receipt.runId, "reviewer-started", { threadId: "review-advance" }, options);
    await advanceRunReceiptLifecycle(receipt.runId, "review-verdict", { verdict: "PASS" }, options);
    const completed = await advanceRunReceiptLifecycle(receipt.runId, "run-completed", {}, options);
    expect(completed.status).toBe("completed");
    expect(completed.freshPassCandidateId).toBe(completed.candidateId);

    const history = await readRunHistory(receipt.runId, options);
    expect(history.events.map((event) => event.type)).toEqual([
      "run-started",
      "implementer-started",
      "candidate-observed",
      "parent-verified",
      "reviewer-started",
      "review-verdict",
      "run-completed",
    ]);
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

test("lifecycle advance persists a changed candidate before rejecting stale completion", async () => {
  const { base, storageRoot, traceRoot } = await roots("mandatemarshal-receipt-advance-mutation-");
  const project = join(base, "project");
  try {
    await mkdir(project);
    await runCommand(project, ["git", "init"]);
    await runCommand(project, ["git", "config", "user.email", "mandatemarshal-test@example.invalid"]);
    await runCommand(project, ["git", "config", "user.name", "MandateMarshal Test"]);
    const tracked = join(project, "tracked.txt");
    await writeFile(tracked, "base\n", "utf8");
    await runCommand(project, ["git", "add", "tracked.txt"]);
    await runCommand(project, ["git", "commit", "-m", "base"]);

    const options = { storageRoot, traceRoot, mandatemarshalVersion: "0.2.6", idFactory: () => "advance-mutation" };
    const receipt = await startRunReceipt(project, "skill-contract", options);
    const verified = await advanceRunReceiptLifecycle(receipt.runId, "parent-verified", {}, options);
    await advanceRunReceiptLifecycle(receipt.runId, "reviewer-started", { threadId: "review-before-mutation" }, options);
    await advanceRunReceiptLifecycle(receipt.runId, "review-verdict", { verdict: "PASS" }, options);

    await writeFile(tracked, "mutated after pass\n", "utf8");
    await expect(advanceRunReceiptLifecycle(receipt.runId, "run-completed", {}, options)).rejects.toThrow(
      "RUN_RECEIPT_FRESH_PASS_REQUIRED",
    );

    const persisted = await readRunReceipt(receipt.runId, options);
    expect(persisted.candidateId).not.toBe(verified.candidateId);
    expect(persisted.parentVerifiedCandidateId).toBeUndefined();
    expect(persisted.freshPassCandidateId).toBeUndefined();
    expect(persisted.lastEventType).toBe("candidate-observed");
  } finally {
    await rm(base, { recursive: true, force: true, maxRetries: 8, retryDelay: 100 });
  }
});

test("FIX and candidate mutation invalidate the old review before a new PASS", async () => {
  const { base, storageRoot, traceRoot } = await roots("mandatemarshal-receipt-fix-");
  try {
    const options = { storageRoot, traceRoot, mandatemarshalVersion: "0.2.5", idFactory: () => "fix" };
    const receipt = await startRunReceipt(process.cwd(), "skill-contract", options);
    await recordRunReceiptEvent(receipt.runId, "candidate-observed", { candidateId: "c1" }, options);
    await recordRunReceiptEvent(receipt.runId, "parent-verified", { candidateId: "c1" }, options);
    await recordRunReceiptEvent(receipt.runId, "reviewer-started", { candidateId: "c1", threadId: "r1" }, options);
    const fixed = await recordRunReceiptEvent(receipt.runId, "review-verdict", { candidateId: "c1", verdict: "FIX" }, options);
    expect(fixed.status).toBe("fix-required");
    expect(fixed.freshPassCandidateId).toBeUndefined();

    await recordRunReceiptEvent(receipt.runId, "correction-started", {}, options);
    const changed = await recordRunReceiptEvent(receipt.runId, "candidate-observed", { candidateId: "c2" }, options);
    expect(changed.parentVerifiedCandidateId).toBeUndefined();
    expect(changed.latestVerdict).toBeUndefined();
    expect(changed.freshPassCandidateId).toBeUndefined();

    await expect(recordRunReceiptEvent(receipt.runId, "reviewer-started", { candidateId: "c2", threadId: "r2" }, options)).rejects.toThrow("RUN_RECEIPT_PARENT_VERIFICATION_REQUIRED");
    await expect(recordRunReceiptEvent(receipt.runId, "run-completed", {}, options)).rejects.toThrow("RUN_RECEIPT_FRESH_PASS_REQUIRED");
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

test("detailed traces expire after fixed 30-day TTL while the minimal receipt persists", async () => {
  const { base, storageRoot, traceRoot } = await roots("mandatemarshal-receipt-ttl-");
  try {
    const started = new Date("2026-01-01T00:00:00.000Z");
    const receipt = await startRunReceipt(process.cwd(), "skill-contract", {
      storageRoot,
      traceRoot,
      mandatemarshalVersion: "0.2.5",
      idFactory: () => "ttl",
      now: () => started,
    });
    const traceFile = join(traceRoot, `${receipt.runId}.jsonl`);
    const unrelated = join(traceRoot, "unrelated.jsonl");
    await writeFile(unrelated, "do not delete\n", "utf8");
    await Promise.all([utimes(traceFile, started, started), utimes(unrelated, started, started)]);

    const deleted = await pruneExpiredRunTraces({
      storageRoot,
      traceRoot,
      now: () => new Date("2026-02-01T00:00:01.000Z"),
    });
    expect(RUN_TRACE_RETENTION_DAYS).toBe(30);
    expect(deleted).toBe(1);
    expect(await Bun.file(unrelated).exists()).toBeTrue();

    const persisted = await readRunReceipt(receipt.runId, { storageRoot, traceRoot });
    expect(persisted.runId).toBe(receipt.runId);
    const history = await readRunHistory(receipt.runId, { storageRoot, traceRoot });
    expect(history.available).toBeFalse();
    expect(history.events).toEqual([]);
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

test("start refuses a second active run for the same project", async () => {
  const { base, storageRoot, traceRoot } = await roots("mandatemarshal-receipt-start-unique-");
  try {
    const options = { storageRoot, traceRoot, mandatemarshalVersion: "0.2.5", idFactory: () => "unique" };
    const first = await startRunReceipt(process.cwd(), "skill-contract", options);
    await expect(startRunReceipt(process.cwd(), "skill-contract", options)).rejects.toThrow(`RUN_RECEIPT_ACTIVE_EXISTS:${first.projectId}:${first.runId}`);
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

test("run creation rejects a missing project path", async () => {
  const { base, storageRoot, traceRoot } = await roots("mandatemarshal-receipt-missing-project-");
  try {
    await expect(
      ensureRunReceipt(join(base, "does-not-exist"), "skill-contract", { storageRoot, traceRoot, mandatemarshalVersion: "0.2.5" }),
    ).rejects.toThrow("RUN_RECEIPT_PROJECT_NOT_FOUND");
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

test("concurrent ensure calls converge on one active run", async () => {
  const { base, storageRoot, traceRoot } = await roots("mandatemarshal-receipt-concurrent-ensure-");
  try {
    const options = { storageRoot, traceRoot, mandatemarshalVersion: "0.2.5", idFactory: () => "concurrent" };
    const [first, second] = await Promise.all([
      ensureRunReceipt(process.cwd(), "skill-contract", options),
      ensureRunReceipt(process.cwd(), "skill-contract", options),
    ]);
    expect(first.receipt.runId).toBe(second.receipt.runId);
    expect([first.created, second.created].sort()).toEqual([false, true]);
    const receipts = await listRunReceipts(options);
    expect(receipts).toHaveLength(1);
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

test("concurrent run events serialize receipt and trace sequence", async () => {
  const { base, storageRoot, traceRoot } = await roots("mandatemarshal-receipt-concurrent-events-");
  try {
    const options = { storageRoot, traceRoot, mandatemarshalVersion: "0.2.5", idFactory: () => "event-lock" };
    const receipt = await startRunReceipt(process.cwd(), "skill-contract", options);
    await Promise.all([
      recordRunReceiptEvent(receipt.runId, "implementer-started", { threadId: "impl-a" }, options),
      recordRunReceiptEvent(receipt.runId, "implementer-started", { threadId: "impl-b" }, options),
    ]);
    const persisted = await readRunReceipt(receipt.runId, options);
    expect(persisted.eventCount).toBe(3);
    const history = await readRunHistory(receipt.runId, options);
    expect(history.events.map((event) => event.sequence)).toEqual([1, 2, 3]);
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

test("temporary trace failure does not invalidate the persistent receipt", async () => {
  const { base, storageRoot } = await roots("mandatemarshal-receipt-trace-best-effort-");
  const traceRoot = join(base, "trace-root-is-a-file");
  try {
    await writeFile(traceRoot, "block directory creation\n", "utf8");
    const receipt = await startRunReceipt(process.cwd(), "skill-contract", {
      storageRoot,
      traceRoot,
      mandatemarshalVersion: "0.2.5",
      idFactory: () => "trace-best-effort",
    });
    expect((await readRunReceipt(receipt.runId, { storageRoot, traceRoot })).runId).toBe(receipt.runId);
    const history = await readRunHistory(receipt.runId, { storageRoot, traceRoot });
    expect(history.available).toBeFalse();
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

test("ensure reuses the only active project run and capture records mechanical candidate identity", async () => {
  const { base, storageRoot, traceRoot } = await roots("mandatemarshal-receipt-ensure-");
  try {
    const options = { storageRoot, traceRoot, mandatemarshalVersion: "0.2.5", idFactory: () => "ensure" };
    const first = await ensureRunReceipt(process.cwd(), "skill-contract", options);
    expect(first.created).toBeTrue();
    const second = await ensureRunReceipt(process.cwd(), "skill-contract", options);
    expect(second.created).toBeFalse();
    expect(second.receipt.runId).toBe(first.receipt.runId);

    const captured = await captureRunCandidate(first.receipt.runId, options);
    expect(captured.candidateId).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(captured.gitHead).toMatch(/^[a-f0-9]{40}$/);
    expect(captured.lastEventType).toBe("candidate-observed");
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

test("ensure upgrades an active same-line receipt in place and invalidates stale candidate bindings", async () => {
  const { base, storageRoot, traceRoot } = await roots("mandatemarshal-receipt-version-upgrade-");
  try {
    const oldOptions = { storageRoot, traceRoot, mandatemarshalVersion: "0.2.6", idFactory: () => "upgrade" };
    const started = await ensureRunReceipt(process.cwd(), "skill-contract", oldOptions);
    expect(started.created).toBeTrue();
    expect(started.upgraded).toBeFalse();
    const captured = await captureRunCandidate(started.receipt.runId, oldOptions);
    const candidateId = captured.candidateId;
    if (!candidateId) throw new Error("expected mechanical candidate identity");
    await recordRunReceiptEvent(captured.runId, "parent-verified", { candidateId }, oldOptions);
    await recordRunReceiptEvent(captured.runId, "reviewer-started", { candidateId, threadId: "review-old" }, oldOptions);
    await recordRunReceiptEvent(captured.runId, "review-verdict", { candidateId, verdict: "PASS" }, oldOptions);

    const upgraded = await ensureRunReceipt(process.cwd(), "skill-contract", {
      storageRoot,
      traceRoot,
      mandatemarshalVersion: "0.2.7",
    });
    expect(upgraded.created).toBeFalse();
    expect(upgraded.upgraded).toBeTrue();
    expect(upgraded.receipt.runId).toBe(started.receipt.runId);
    expect(upgraded.receipt.startedWithVersion).toBe("0.2.6");
    expect(upgraded.receipt.mandatemarshalVersion).toBe("0.2.7");
    expect(upgraded.receipt.lastEventType).toBe("runtime-upgraded");
    expect(upgraded.receipt.candidateId).toBeUndefined();
    expect(upgraded.receipt.parentVerifiedCandidateId).toBeUndefined();
    expect(upgraded.receipt.latestVerdict).toBeUndefined();
    expect(upgraded.receipt.freshPassCandidateId).toBeUndefined();

    const history = await readRunHistory(started.receipt.runId, { storageRoot, traceRoot });
    const versionEvent = history.events.at(-1);
    expect(versionEvent?.type).toBe("runtime-upgraded");
    expect(versionEvent?.fromVersion).toBe("0.2.6");
    expect(versionEvent?.toVersion).toBe("0.2.7");
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

test("ensure rejects receipt downgrade and cross-line automatic migration", async () => {
  const { base, storageRoot, traceRoot } = await roots("mandatemarshal-receipt-version-reject-");
  try {
    const projectA = join(base, "project-a");
    const projectB = join(base, "project-b");
    await Promise.all([mkdir(projectA), mkdir(projectB)]);
    await ensureRunReceipt(projectA, "skill-contract", {
      storageRoot,
      traceRoot,
      mandatemarshalVersion: "0.2.7",
      idFactory: () => "downgrade",
    });
    await expect(
      ensureRunReceipt(projectA, "skill-contract", { storageRoot, traceRoot, mandatemarshalVersion: "0.2.6" }),
    ).rejects.toThrow("RUN_RECEIPT_VERSION_DOWNGRADE_UNSUPPORTED");

    await ensureRunReceipt(projectB, "skill-contract", {
      storageRoot,
      traceRoot,
      mandatemarshalVersion: "0.2.6",
      idFactory: () => "cross-line",
    });
    await expect(
      ensureRunReceipt(projectB, "skill-contract", { storageRoot, traceRoot, mandatemarshalVersion: "0.3.0" }),
    ).rejects.toThrow("RUN_RECEIPT_VERSION_UPGRADE_INCOMPATIBLE");
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

test("tampered persistent PASS binding fails closed on read", async () => {
  const { base, storageRoot, traceRoot } = await roots("mandatemarshal-receipt-tamper-");
  try {
    const options = { storageRoot, traceRoot, mandatemarshalVersion: "0.2.5", idFactory: () => "tamper" };
    const receipt = await startRunReceipt(process.cwd(), "skill-contract", options);
    const file = join(storageRoot, `${receipt.runId}.json`);
    await writeFile(
      file,
      `${JSON.stringify({
        ...receipt,
        candidateId: "candidate-a",
        parentVerifiedCandidateId: "candidate-a",
        latestVerdict: "PASS",
        freshPassCandidateId: "candidate-b",
      }, null, 2)}\n`,
      "utf8",
    );
    await expect(readRunReceipt(receipt.runId, options)).rejects.toThrow("RUN_RECEIPT_INVALID_PASS_BINDING");
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

test("run list returns persistent receipts newest first", async () => {
  const { base, storageRoot, traceRoot } = await roots("mandatemarshal-receipt-list-");
  try {
    const olderProject = join(base, "older-project");
    const newerProject = join(base, "newer-project");
    await Promise.all([mkdir(olderProject), mkdir(newerProject)]);
    await startRunReceipt(olderProject, "skill-contract", {
      storageRoot,
      traceRoot,
      mandatemarshalVersion: "0.2.5",
      idFactory: () => "older",
      now: () => new Date("2026-09-01T00:00:00.000Z"),
    });
    await startRunReceipt(newerProject, "skill-contract", {
      storageRoot,
      traceRoot,
      mandatemarshalVersion: "0.2.5",
      idFactory: () => "newer",
      now: () => new Date("2026-09-02T00:00:00.000Z"),
    });
    const receipts = await listRunReceipts({ storageRoot, traceRoot });
    expect(receipts.map((receipt) => receipt.runId)).toEqual(["mm-20260902-newer", "mm-20260901-older"]);
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});
