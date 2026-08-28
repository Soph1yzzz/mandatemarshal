import { describe, expect, test } from "bun:test";
import { CodexAdapter, CodexCapabilityError, type CodexDriver } from "../../src/adapters/codex/adapter";
import { CodexCliDriver } from "../../src/adapters/codex/cli-driver";
import type { HostCapabilities, ImplementationReport, ReviewResult } from "../../src/core/types";
import { evidence, implementation, packet, review } from "../fixtures/factories";

const caps: HostCapabilities = {
  freshContext: true,
  subagents: true,
  persistentChildCorrection: false,
  requestedReadOnly: true,
  observedReadOnly: false,
  exactRoleSelection: false,
  exactModelSelection: true,
  reasoningSelection: true,
  commandObservation: "full",
  repoStateObservation: true,
  worktreeIsolation: false,
  hooks: true,
  plugins: true,
  routingObservation: false,
};

function driver(overrides: Partial<CodexDriver> = {}) {
  const implementationRequests: Array<{ model: string; effort: string }> = [];
  const reviewerRequests: Array<{ model: string; effort: string; fresh: boolean; readOnly: boolean }> = [];
  const impl = implementation("c1");
  const rev = review("PASS", "c1");
  const base: CodexDriver = {
    async capabilities() { return caps; },
    async runImplementer(input) {
      implementationRequests.push({ model: input.role.model, effort: input.role.effort });
      return { id: "i1", result: impl };
    },
    async runReviewer(input) {
      reviewerRequests.push({ model: input.role.model, effort: input.role.effort, fresh: input.fresh, readOnly: input.readOnly });
      return { id: "r1", result: rev };
    },
    ...overrides,
  };
  return { base, implementationRequests, reviewerRequests };
}

describe("Codex adapter conformance", () => {
  test("CLI driver reports only capabilities it directly establishes", async () => {
    const observed = await new CodexCliDriver({ cwd: process.cwd() }).capabilities();
    expect(observed.commandObservation).toBe("reported-only");
    expect(observed.repoStateObservation).toBeFalse();
    expect(observed.observedReadOnly).toBeFalse();
    expect(observed.hooks).toBeFalse();
    expect(observed.plugins).toBeFalse();
  });

  test("routine lane requests exact Luna/Max", async () => {
    const d = driver();
    const adapter = new CodexAdapter(d.base);
    const handle = await adapter.spawnImplementer({ packet: packet("routine-implementer") });
    await adapter.readWorkerResult(handle);
    expect(d.implementationRequests).toEqual([{ model: "gpt-5.6-luna", effort: "max" }]);
  });

  test("complex lane requests exact Terra/High", async () => {
    const d = driver();
    const adapter = new CodexAdapter(d.base);
    await adapter.spawnImplementer({ packet: packet("complex-implementer") });
    expect(d.implementationRequests).toEqual([{ model: "gpt-5.6-terra", effort: "high" }]);
  });

  test("fresh reviewer requests Sol/High in fresh read-only mode", async () => {
    const d = driver();
    const adapter = new CodexAdapter(d.base);
    const handle = await adapter.spawnFreshReviewer({
      candidateId: "c1",
      objective: "test",
      interfaces: [],
      constraints: [],
      allowedPaths: ["src/**"],
      evidence: evidence(),
    });
    await adapter.readReviewerResult(handle);
    expect(d.reviewerRequests).toEqual([{ model: "gpt-5.6-sol", effort: "high", fresh: true, readOnly: true }]);
  });

  test("unavailable exact effort blocks before delegation; no fallback", async () => {
    let calls = 0;
    const d = driver({
      async capabilities() { return { ...caps, reasoningSelection: false }; },
      async runImplementer() {
        calls += 1;
        return { id: "should-not-run", result: implementation("x") };
      },
    });
    const adapter = new CodexAdapter(d.base);
    await expect(adapter.spawnImplementer({ packet: packet() })).rejects.toBeInstanceOf(CodexCapabilityError);
    expect(calls).toBe(0);
  });

  test("Luna launch failure propagates; adapter does not substitute Terra", async () => {
    const attempted: string[] = [];
    const d = driver({
      async runImplementer(input) {
        attempted.push(input.role.model);
        throw new Error("configured model unavailable");
      },
    });
    const adapter = new CodexAdapter(d.base);
    await expect(adapter.spawnImplementer({ packet: packet("routine-implementer") })).rejects.toThrow("configured model unavailable");
    expect(attempted).toEqual(["gpt-5.6-luna"]);
  });
});
