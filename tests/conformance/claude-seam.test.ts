import { expect, test } from "bun:test";
import { ClaudeCodeExperimentalAdapter, type ClaudeCodeBridge } from "../../src/adapters/claude-code/adapter.experimental";
import type { HostCapabilities } from "../../src/core/types";
import { OrchestrationEngine, type ParentController } from "../../src/orchestrator/engine";
import { evidence, implementation, packet, review } from "../fixtures/factories";

 test("mock Claude Code bridge runs the same provider-neutral happy path", async () => {
  const caps: HostCapabilities = {
    freshContext: true,
    subagents: true,
    persistentChildCorrection: true,
    requestedReadOnly: true,
    observedReadOnly: true,
    exactRoleSelection: true,
    exactModelSelection: true,
    reasoningSelection: true,
    commandObservation: "full",
    repoStateObservation: true,
    worktreeIsolation: true,
    hooks: true,
    plugins: true,
    routingObservation: true,
  };
  const bridge: ClaudeCodeBridge = {
    async capabilities() { return caps; },
    async implement(input) {
      return {
        handle: { id: "claude-worker", role: input.packet.routing.lane, candidateId: "c1" },
        report: implementation("c1", input.packet.routing.lane),
      };
    },
    async correct() {},
    async review(input) {
      return {
        handle: { id: "claude-review", role: "fresh-reviewer", candidateId: input.candidateId },
        result: review("PASS", input.candidateId),
      };
    },
  };
  const p = packet();
  let candidate = "c1";
  const parent: ParentController<string> = {
    async plan() { return { kind: "ready", packet: p }; },
    async verify(_packet, report) {
      candidate = report.candidateId ?? "missing";
      return { passed: true, candidateId: candidate, evidence: evidence() };
    },
    async observeCandidateId() { return candidate; },
    async reclassifyBlocked() { return null; },
    async correction(value) { return value; },
    async escalateReview() { throw new Error("not expected"); },
  };
  const engine = new OrchestrationEngine(new ClaudeCodeExperimentalAdapter(bridge), parent, {
    persistArtifacts: false,
    runId: "claude-seam",
  });
  const result = await engine.run("request");
  expect(result.status).toBe("completed");
});
