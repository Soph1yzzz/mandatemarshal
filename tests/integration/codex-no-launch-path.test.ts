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

describe("Codex no-launch authority route", () => {
  test("manual agent installer lays down every authority profile without invoking Codex", async () => {
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
      const files = (await readdir(target)).sort();
      for (const file of [
        "mandatemarshal_fresh_reviewer.toml",
        "mandatemarshal_fresh_reviewer_astra_low.toml",
        "mandatemarshal_fresh_reviewer_astra_medium.toml",
        "mandatemarshal_fresh_reviewer_astra_high.toml",
        "mandatemarshal_fresh_reviewer_astra_xhigh.toml",
        "mandatemarshal_fresh_reviewer_astra_max.toml",
        "mandatemarshal_fresh_reviewer_sol_compat.toml",
      ]) {
        expect(files).toContain(file);
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("selected Parent Astra effort reaches the exact fresh reviewer exec plan without spawning Codex", async () => {
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
    const adapter = new CodexAdapter(driver, { authorityEffort: "max" });
    adapter.assertParentAuthoritySelection({ model: "gpt-6-astra", effort: "max" });
    await adapter.spawnFreshReviewer({
      candidateId: "candidate-1",
      objective: "verify no-launch route",
      interfaces: [],
      constraints: [],
      allowedPaths: ["src/**"],
      evidence: evidence(),
    });
    expect(reviewerRole).toEqual({ nativeRole: "fresh-reviewer", model: "gpt-6-astra", effort: "max" });
    const args = buildCodexExecArgs({
      cwd: process.cwd(),
      role: reviewerRole!,
      sandbox: "read-only",
      schemaPath: "C:/tmp/review-schema.json",
      outputPath: "C:/tmp/review-output.json",
      persistent: false,
    });
    expect(args).toContain("gpt-6-astra");
    expect(args).toContain('model_reasoning_effort="max"');
    expect(args).toContain("read-only");
    expect(args).toContain("--ephemeral");
    expect(args).not.toContain("gpt-5.6-sol");
  });

  test("implementation lanes remain Luna/Max and Terra/High while authority uses Astra", async () => {
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
    const adapter = new CodexAdapter(driver, { authorityEffort: "low" });
    expect(adapter.parentAuthorityRequirement()).toEqual({ nativeRole: "parent", model: "gpt-6-astra", effort: "low" });
    await adapter.spawnImplementer({ packet: packet("routine-implementer") });
    await adapter.spawnImplementer({ packet: packet("complex-implementer") });
    expect(requests).toEqual([
      { model: "gpt-5.6-luna", effort: "max" },
      { model: "gpt-5.6-terra", effort: "high" },
    ]);
  });
});
