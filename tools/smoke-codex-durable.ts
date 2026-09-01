import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CodexCliDriver } from "../src/adapters/codex/cli-driver";
import { CodexDurableOperationStore } from "../src/adapters/codex/durable-operation";
import { DEFAULT_CODEX_ROLE_MAPPING } from "../src/adapters/codex/role-mapping";
import type { ImplementationPacket } from "../src/core/types";

const operationRoot = await mkdtemp(join(tmpdir(), "mandatemarshal-codex-durable-smoke-"));
const operationId = `smoke-${randomUUID()}`;
const idempotencyKey = `smoke:${operationId}`;
const packet: ImplementationPacket = {
  schemaVersion: 1,
  routing: {
    lane: "routine-implementer",
    reason: "Durable Codex CLI smoke test",
    requestedModel: DEFAULT_CODEX_ROLE_MAPPING.routineImplementer.model,
    requestedEffort: DEFAULT_CODEX_ROLE_MAPPING.routineImplementer.effort,
  },
  objective: {
    outcome: "Inspect the repository without modifying files and return a complete implementation report stating that the durable smoke check was observed.",
  },
  ownership: { allowedPaths: ["README.md"] },
  interfaces: [],
  constraints: [
    "Do not modify any file.",
    "Do not run network-write, publication, deployment, or destructive commands.",
    "This is a transport smoke test only.",
  ],
  executionContract: {
    allowedWritePaths: [],
    expectedSideEffects: ["No repository mutation"],
    forbiddenSideEffects: ["Repository mutation", "Network write", "Publication"],
  },
  verification: [
    { kind: "inspect", target: "repository", success: "No file mutation is required" },
  ],
  returnContract: "Return the MandateMarshal implementation report JSON only.",
};

try {
  const driver = new CodexCliDriver({ cwd: process.cwd(), durableOperationRoot: operationRoot });
  const run = await driver.runImplementer({
    role: DEFAULT_CODEX_ROLE_MAPPING.routineImplementer,
    request: {
      packet,
      durable: { operationId, idempotencyKey },
    },
  });
  const mapping = await new CodexDurableOperationStore(operationRoot).read(operationId);
  if (!mapping?.threadId) throw new Error("Durable Codex smoke did not persist a thread id");
  if (!mapping.completedAt || !mapping.result) throw new Error("Durable Codex smoke did not persist a completed result");

  const observed = await driver.observeDurableOperation({
    operationId,
    idempotencyKey,
    kind: "spawn-implementer",
    payload: { lane: "routine-implementer" },
  });
  if (observed.outcome !== "completed") {
    throw new Error(`Durable Codex observation was ${observed.outcome}: ${observed.detail}`);
  }

  console.log(JSON.stringify({
    status: "PASS",
    operationId,
    threadId: mapping.threadId,
    driverHandle: run.id,
    requestedModel: DEFAULT_CODEX_ROLE_MAPPING.routineImplementer.model,
    requestedEffort: DEFAULT_CODEX_ROLE_MAPPING.routineImplementer.effort,
    reportStatus: run.result.status,
    durableObservation: observed.outcome,
  }, null, 2));
} finally {
  await rm(operationRoot, { recursive: true, force: true });
}
