import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

async function runCli(args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  const proc = Bun.spawn([process.execPath, "bin/mandatemarshal.ts", ...args], {
    cwd: process.cwd(),
    env: { ...process.env, MANDATEMARSHAL_PINNED_EXEC: "1" },
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

test("run receipt CLI starts, records, lists, shows and traces a skill-contract run", async () => {
  const base = await mkdtemp(join(tmpdir(), "mandatemarshal-receipt-cli-"));
  const receiptRoot = join(base, "receipts");
  const traceRoot = join(base, "traces");
  const roots = ["--receipt-root", receiptRoot, "--trace-root", traceRoot];
  try {
    const forgedMode = await runCli(["run", "ensure", process.cwd(), "--mode", "durable-runtime", ...roots]);
    expect(forgedMode.code).not.toBe(0);
    expect(forgedMode.stderr).toContain("RUN_RECEIPT_MODE_OVERRIDE_UNAVAILABLE");

    const started = await runCli(["run", "start", process.cwd(), ...roots]);
    expect(started.code).toBe(0);
    const startPayload = JSON.parse(started.stdout) as { runId: string; mode: string; traceRetentionDays: number };
    expect(startPayload.mode).toBe("skill-contract");
    expect(startPayload.traceRetentionDays).toBe(30);
    const runId = startPayload.runId;

    const ensured = await runCli(["run", "ensure", process.cwd(), ...roots]);
    expect(ensured.code).toBe(0);
    expect(JSON.parse(ensured.stdout).created).toBeFalse();
    expect(JSON.parse(ensured.stdout).receipt.runId).toBe(runId);

    expect((await runCli(["run", "advance", runId, "implementer-started", "--thread", "impl-cli", ...roots])).code).toBe(0);
    const fabricated = await runCli(["run", "record", runId, "candidate-observed", "--candidate", "fabricated", ...roots]);
    expect(fabricated.code).not.toBe(0);
    expect(fabricated.stderr).toContain("RUN_RECEIPT_EVENT_INVALID:candidate-observed");

    const parentVerified = await runCli(["run", "advance", runId, "parent-verified", ...roots]);
    expect(parentVerified.code).toBe(0);
    const candidate = JSON.parse(parentVerified.stdout).candidateId as string;
    expect(candidate).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect((await runCli(["run", "advance", runId, "reviewer-started", "--thread", "review-cli", ...roots])).code).toBe(0);
    expect((await runCli(["run", "advance", runId, "review-verdict", "--verdict", "PASS", ...roots])).code).toBe(0);
    expect((await runCli(["run", "advance", runId, "run-completed", ...roots])).code).toBe(0);

    const shown = await runCli(["run", "show", runId, ...roots]);
    expect(shown.code).toBe(0);
    const showPayload = JSON.parse(shown.stdout);
    expect(showPayload.status).toBe("completed");
    expect(showPayload.freshPassCandidateId).toBe(candidate);
    expect(showPayload.latestReviewerThreadId).toBe("review-cli");

    const listed = await runCli(["run", "list", ...roots]);
    expect(listed.code).toBe(0);
    expect(JSON.parse(listed.stdout).runs.map((run: { runId: string }) => run.runId)).toContain(runId);

    const history = await runCli(["run", "history", runId, ...roots]);
    expect(history.code).toBe(0);
    const historyPayload = JSON.parse(history.stdout);
    expect(historyPayload.available).toBeTrue();
    expect(historyPayload.retentionDays).toBe(30);
    expect(historyPayload.events.at(-1).type).toBe("run-completed");
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});
