import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CodexDurableOperationStore } from "../../src/adapters/codex/durable-operation";
import { packet, review } from "../fixtures/factories";

async function writeSession(codexHome: string, threadId: string, finalMessage?: string): Promise<void> {
  const dir = join(codexHome, "sessions", "2026", "08", "31");
  await mkdir(dir, { recursive: true });
  const lines = [
    JSON.stringify({ timestamp: "2026-08-31T00:00:00Z", type: "session_meta", payload: { id: threadId } }),
    ...(finalMessage === undefined
      ? []
      : [
          JSON.stringify({
            timestamp: "2026-08-31T00:00:01Z",
            type: "event_msg",
            payload: { type: "task_complete", last_agent_message: finalMessage },
          }),
        ]),
  ];
  await writeFile(join(dir, `rollout-test-${threadId}.jsonl`), `${lines.join("\n")}\n`, "utf8");
}

describe("CodexDurableOperationStore", () => {
  test("absence of a mapping is unknown, not proof that a launch never happened", async () => {
    const root = await mkdtemp(join(tmpdir(), "mandatemarshal-codex-op-root-"));
    const codexHome = await mkdtemp(join(tmpdir(), "mandatemarshal-codex-home-"));
    const store = new CodexDurableOperationStore(root, codexHome);
    const observation = await store.observe("op-missing");
    expect(observation.outcome).toBe("unknown");
  });

  test("recovers a completed implementation result from persisted Codex session JSONL", async () => {
    const root = await mkdtemp(join(tmpdir(), "mandatemarshal-codex-op-impl-"));
    const codexHome = await mkdtemp(join(tmpdir(), "mandatemarshal-codex-home-impl-"));
    const store = new CodexDurableOperationStore(root, codexHome);
    const threadId = "01a00000-0000-7000-8000-000000000001";
    const routing = packet().routing;
    await store.recordStarted({
      operationId: "op-impl",
      kind: "spawn-implementer",
      threadId,
      cwd: process.cwd(),
      routing,
    });
    await writeSession(
      codexHome,
      threadId,
      JSON.stringify({
        status: "complete",
        objective: "implemented",
        changes: ["src/a.ts"],
        commands: ["bun test"],
        verified: ["tests pass"],
        judgmentCalls: [],
        gaps: [],
        authorityConcerns: [],
        candidateId: "candidate-1",
      }),
    );

    const observation = await store.observe("op-impl");
    expect(observation.outcome).toBe("completed");
    if (observation.outcome !== "completed") throw new Error("unexpected observation");
    const result = observation.result as {
      worker: { id: string; role: string; candidateId?: string };
      implementation: { candidateId?: string; routing: { lane: string } };
    };
    expect(result.worker.id).toContain(threadId);
    expect(result.worker.role).toBe(routing.lane);
    expect(result.implementation.candidateId).toBe("candidate-1");
    expect(result.implementation.routing.lane).toBe(routing.lane);

    const persisted = await store.read("op-impl");
    expect(persisted?.completedAt).toBeDefined();
    expect(persisted?.result).toBeDefined();
  });

  test("recovers a completed fresh review and rebinds the expected candidate", async () => {
    const root = await mkdtemp(join(tmpdir(), "mandatemarshal-codex-op-review-"));
    const codexHome = await mkdtemp(join(tmpdir(), "mandatemarshal-codex-home-review-"));
    const store = new CodexDurableOperationStore(root, codexHome);
    const threadId = "01a00000-0000-7000-8000-000000000002";
    await store.recordStarted({
      operationId: "op-review",
      kind: "spawn-reviewer",
      threadId,
      cwd: process.cwd(),
      candidateId: "candidate-2",
    });
    const source = review("PASS", "wrong-candidate");
    const { schemaVersion: _schemaVersion, candidateId: _candidateId, ...wireReview } = source;
    await writeSession(codexHome, threadId, JSON.stringify(wireReview));

    const observation = await store.observe("op-review");
    expect(observation.outcome).toBe("completed");
    if (observation.outcome !== "completed") throw new Error("unexpected observation");
    const result = observation.result as {
      reviewer: { candidateId: string };
      review: { candidateId: string; verdict: string };
    };
    expect(result.reviewer.candidateId).toBe("candidate-2");
    expect(result.review.candidateId).toBe("candidate-2");
    expect(result.review.verdict).toBe("PASS");
  });

  test("an incomplete persisted thread remains unknown rather than being resumed automatically", async () => {
    const root = await mkdtemp(join(tmpdir(), "mandatemarshal-codex-op-incomplete-"));
    const codexHome = await mkdtemp(join(tmpdir(), "mandatemarshal-codex-home-incomplete-"));
    const store = new CodexDurableOperationStore(root, codexHome);
    const threadId = "01a00000-0000-7000-8000-000000000003";
    await store.recordStarted({
      operationId: "op-incomplete",
      kind: "spawn-reviewer",
      threadId,
      cwd: process.cwd(),
      candidateId: "candidate-3",
    });
    await writeSession(codexHome, threadId);

    const observation = await store.observe("op-incomplete");
    expect(observation.outcome).toBe("unknown");
    expect(observation.detail).toContain(threadId);
  });

  test("malformed completed session output fails closed", async () => {
    const root = await mkdtemp(join(tmpdir(), "mandatemarshal-codex-op-bad-"));
    const codexHome = await mkdtemp(join(tmpdir(), "mandatemarshal-codex-home-bad-"));
    const store = new CodexDurableOperationStore(root, codexHome);
    const threadId = "01a00000-0000-7000-8000-000000000004";
    await store.recordStarted({
      operationId: "op-bad",
      kind: "spawn-implementer",
      threadId,
      cwd: process.cwd(),
      routing: packet().routing,
    });
    await writeSession(codexHome, threadId, JSON.stringify({ status: "complete", objective: "missing arrays" }));
    await expect(store.observe("op-bad")).rejects.toThrow("must be an array");
  });
});
