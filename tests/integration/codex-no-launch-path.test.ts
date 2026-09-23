import { describe, expect, test } from "bun:test";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CodexAdapter, type CodexDriver } from "../../src/adapters/codex/adapter";
import { buildCodexExecArgs } from "../../src/adapters/codex/cli-driver";
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
  commandObservation: "reported-only",
  repoStateObservation: false,
  worktreeIsolation: false,
  hooks: false,
  plugins: false,
  routingObservation: false,
};

describe("Codex no-launch v0.3 route", () => {
  test("manual agent installer lays down exactly the three active Sol/Luna profiles without invoking Codex", async () => {
    const root = await mkdtemp(join(tmpdir(), "mandatemarshal-agent-install-"));
    const target = join(root, ".codex", "agents");
    try {
      const proc = Bun.spawn([process.execPath, "tools/install-codex-agents.ts", target], {
        cwd: process.cwd(),
        stdout: "pipe",
        stderr: "pipe",
      });
      const [code, stderr] = await Promise.all([proc.exited, new Response(proc.stderr).text()]);
      expect(code).toBe(0);
      expect(stderr).toBe("");
      expect((await readdir(target)).sort()).toEqual([
        "mandatemarshal_complex_implementer.toml",
        "mandatemarshal_fresh_reviewer.toml",
        "mandatemarshal_routine_implementer.toml",
      ]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("fixed Sol/High reviewer reaches the exact fresh read-only exec plan without spawning Codex", async () => {
    let reviewerRole: { nativeRole: string; model: string; effort: string } | undefined;
    const driver: CodexDriver = {
      async capabilities() { return caps; },
      async runImplementer(): Promise<{ id: string; result: ImplementationReport }> {
        throw new Error("implementer must not be called in reviewer route test");
      },
      async runReviewer(input): Promise<{ id: string; result: ReviewResult }> {
        reviewerRole = input.role;
        return { id: "review-no-launch", result: review("PASS", "candidate-1") };
      },
    };
    const adapter = new CodexAdapter(driver);
    adapter.assertParentAuthoritySelection({ model: "gpt-6-sol", effort: "high" });
    await adapter.spawnFreshReviewer({
      candidateId: "candidate-1",
      objective: "verify no-launch route",
      interfaces: [],
      constraints: [],
      allowedPaths: ["src/**"],
      evidence: evidence(),
    });
    expect(reviewerRole).toEqual({ nativeRole: "fresh-reviewer", model: "gpt-6-sol", effort: "high" });
    const args = buildCodexExecArgs({
      cwd: process.cwd(),
      role: reviewerRole!,
      sandbox: "read-only",
      schemaPath: "C:/tmp/review-schema.json",
      outputPath: "C:/tmp/review-output.json",
      persistent: false,
    });
    expect(args).toContain("gpt-6-sol");
    expect(args).toContain('model_reasoning_effort="high"');
    expect(args).toContain("read-only");
    expect(args).toContain("--ephemeral");
    expect(args).not.toContain("gpt-6-astra");
  });

  test("implementation lanes are Luna/Max by default and Sol/High only for explicit escalation", async () => {
    const requests: Array<{ model: string; effort: string }> = [];
    const driver: CodexDriver = {
      async capabilities() { return caps; },
      async runImplementer(input) {
        requests.push({ model: input.role.model, effort: input.role.effort });
        return { id: `impl-${requests.length}`, result: implementation("candidate-impl") };
      },
      async runReviewer() {
        throw new Error("reviewer must not be called in implementation route test");
      },
    };
    const adapter = new CodexAdapter(driver);
    expect(adapter.parentAuthorityRequirement()).toEqual({ nativeRole: "parent", model: "gpt-6-sol", effort: "high" });
    await adapter.spawnImplementer({ packet: packet("routine-implementer") });
    await adapter.spawnImplementer({ packet: packet("complex-implementer") });
    expect(requests).toEqual([
      { model: "gpt-6-luna", effort: "max" },
      { model: "gpt-6-sol", effort: "high" },
    ]);
  });
});
