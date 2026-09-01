import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type {
  DurableExecutionContext,
  DurableOperationProbe,
  DurableOperationProbeResult,
  HostCapabilities,
  ImplementationReport,
  ImplementerSpawnRequest,
  ReviewerSpawnRequest,
  ReviewResult,
  RoutingEvidence,
} from "../../core/types";
import { assertReviewResult } from "../../core/validation";
import type { CodexDriver, CodexDriverRun } from "./adapter";
import type { CodexNativeRoleConfig } from "./role-mapping";
import { CodexDurableOperationStore } from "./durable-operation";

interface DurableCodexExecContext {
  kind: "spawn-implementer" | "spawn-reviewer";
  context?: DurableExecutionContext;
  routing?: RoutingEvidence;
  candidateId?: string;
}

export interface CodexCliDriverOptions {
  cwd: string;
  /** Trusted operator configuration only. Do not bind this to repository or model output. */
  command?: string;
  durableOperationRoot?: string;
  codexHome?: string;
}

export class CodexCliDriver implements CodexDriver {
  private counter = 0;
  private readonly cwd: string;
  private readonly command: string;
  private readonly durableOperations: CodexDurableOperationStore;

  constructor(private readonly options: CodexCliDriverOptions) {
    this.cwd = resolve(options.cwd);
    this.command = options.command ?? (process.platform === "win32" ? "codex.cmd" : "codex");
    this.durableOperations = new CodexDurableOperationStore(options.durableOperationRoot, options.codexHome);
  }

  async capabilities(): Promise<HostCapabilities> {
    return {
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
  }

  async runImplementer(input: {
    role: CodexNativeRoleConfig;
    request: ImplementerSpawnRequest;
  }): Promise<CodexDriverRun<ImplementationReport>> {
    const prompt = [
      "You are a bounded MandateMarshal implementation worker.",
      "Implement only inside the supplied packet. Never redesign owner policy or silently change lane/model/effort.",
      "The packet is the settled task specification. Unrelated host-global workflow steps (for example external memory/Obsidian bookkeeping) are not prerequisites unless this packet requires them. Repository-local safety, ownership, and execution constraints remain binding.",
      "If blocked by a real packet/repository contradiction, report it rather than inventing policy.",
      "Return only judgment/result data matching the enforced output schema. Routing is bound by the adapter and must not be chosen by you.",
      "IMPLEMENTATION_PACKET:",
      JSON.stringify(input.request.packet, null, 2),
    ].join("\n\n");
    const execution = await this.runExec(input.role, prompt, "workspace-write", IMPLEMENTATION_REPORT_SCHEMA, {
      kind: "spawn-implementer",
      routing: input.request.packet.routing,
      ...(input.request.durable === undefined ? {} : { context: input.request.durable }),
    });
    const payload = parseJsonObject(execution.raw);
    const result = {
      ...payload,
      routing: input.request.packet.routing,
    } as unknown as ImplementationReport;
    validateImplementationReport(result);
    if (input.request.durable) {
      await this.durableOperations.recordCompleted(input.request.durable.operationId, result);
    }
    return { id: execution.threadId ? `codex-thread-${execution.threadId}` : `codex-impl-${++this.counter}`, result };
  }

  async runReviewer(input: {
    role: CodexNativeRoleConfig;
    request: ReviewerSpawnRequest;
    readOnly: true;
    fresh: true;
  }): Promise<CodexDriverRun<ReviewResult>> {
    const { durable: _durable, ...reviewPacket } = input.request;
    const prompt = [
      "You are a FRESH MandateMarshal QA/code reviewer. Remain read-only.",
      "You are not a second architect or policy maker. Never implement fixes.",
      "Review only the supplied candidate, packet constraints, repository-local constraints, and evidence. Do not ESCALATE solely because unrelated host-global workflow tooling or memory bookkeeping is unavailable.",
      "Verdicts are exactly PASS, FIX, or ESCALATE. Return JSON only matching the review-result contract.",
      "REVIEW_PACKET:",
      JSON.stringify(reviewPacket, null, 2),
    ].join("\n\n");
    const execution = await this.runExec(input.role, prompt, "read-only", REVIEW_RESULT_SCHEMA, {
      kind: "spawn-reviewer",
      candidateId: input.request.candidateId,
      ...(input.request.durable === undefined ? {} : { context: input.request.durable }),
    });
    const payload = parseJsonObject(execution.raw);
    const result = {
      ...payload,
      schemaVersion: 1,
      candidateId: input.request.candidateId,
    };
    assertReviewResult(result);
    if (input.request.durable) {
      await this.durableOperations.recordCompleted(input.request.durable.operationId, result);
    }
    return { id: execution.threadId ? `codex-thread-${execution.threadId}` : `codex-review-${++this.counter}`, result };
  }

  async observeDurableOperation(operation: DurableOperationProbe): Promise<DurableOperationProbeResult> {
    if (operation.kind !== "spawn-implementer" && operation.kind !== "spawn-reviewer") {
      return { outcome: "unknown", detail: `Codex CLI does not own durable operation kind ${operation.kind}` };
    }
    const record = await this.durableOperations.read(operation.operationId);
    if (record && record.kind !== operation.kind) {
      return {
        outcome: "unknown",
        detail: `Codex durable-operation kind mismatch: expected ${operation.kind}, found ${record.kind}`,
      };
    }
    return this.durableOperations.observe(operation.operationId);
  }

  private async runExec(
    role: CodexNativeRoleConfig,
    prompt: string,
    sandbox: "workspace-write" | "read-only",
    outputSchema: Record<string, unknown>,
    durable: DurableCodexExecContext,
  ): Promise<{ raw: string; threadId?: string }> {
    const temp = await mkdtemp(join(tmpdir(), "mandatemarshal-codex-"));
    const output = join(temp, "last-message.txt");
    const schemaPath = join(temp, "output-schema.json");
    try {
      await writeFile(schemaPath, JSON.stringify(outputSchema), "utf8");
      const persistent = durable.context !== undefined;
      const args = [
        "exec",
        ...(persistent ? ["--json"] : ["--ephemeral"]),
        "--skip-git-repo-check",
        "-C",
        this.cwd,
        "-m",
        role.model,
        "-c",
        `model_reasoning_effort=\"${role.effort}\"`,
        "-s",
        sandbox,
        "--output-schema",
        schemaPath,
        "--output-last-message",
        output,
        "-",
      ];
      const proc = Bun.spawn([this.command, ...args], {
        cwd: this.cwd,
        stdin: "pipe",
        stdout: "pipe",
        stderr: "pipe",
      });
      proc.stdin.write(prompt);
      proc.stdin.end();

      let threadId: string | undefined;
      let durableMappingError: Error | undefined;
      const stdoutPromise = persistent
        ? consumeCodexJsonStream(proc.stdout, async (event) => {
            if (event.type !== "thread.started" || typeof event.thread_id !== "string" || threadId !== undefined) return;
            threadId = event.thread_id;
            try {
              await this.durableOperations.recordStarted({
                operationId: durable.context!.operationId,
                kind: durable.kind,
                threadId,
                cwd: this.cwd,
                pid: proc.pid,
                ...(durable.routing === undefined ? {} : { routing: durable.routing }),
                ...(durable.candidateId === undefined ? {} : { candidateId: durable.candidateId }),
              });
            } catch (error) {
              durableMappingError = error instanceof Error ? error : new Error(String(error));
            }
          })
        : new Response(proc.stdout).text();

      const [code, stdout, stderr] = await Promise.all([
        proc.exited,
        stdoutPromise,
        new Response(proc.stderr).text(),
      ]);
      if (durableMappingError) {
        throw new Error(`CODEX_DURABLE_MAPPING_FAILED:${durableMappingError.message}`);
      }
      if (persistent && !threadId) {
        throw new Error("CODEX_DURABLE_THREAD_ID_UNOBSERVED");
      }
      if (code !== 0) {
        throw new Error(
          `CODEX_EXEC_FAILED exit=${code}; requested model=${role.model}; effort=${role.effort}; stderr=${clip(stderr || stdout)}`,
        );
      }
      return {
        raw: await readFile(output, "utf8"),
        ...(threadId === undefined ? {} : { threadId }),
      };
    } finally {
      await rm(temp, { recursive: true, force: true });
    }
  }
}

const IMPLEMENTATION_REPORT_SCHEMA: Record<string, unknown> = {
  type: "object",
  required: [
    "status",
    "objective",
    "changes",
    "commands",
    "verified",
    "judgmentCalls",
    "gaps",
    "authorityConcerns",
  ],
  properties: {
    status: { enum: ["complete", "partial", "blocked"] },
    objective: { type: "string" },
    changes: { type: "array", items: { type: "string" } },
    commands: { type: "array", items: { type: "string" } },
    verified: { type: "array", items: { type: "string" } },
    judgmentCalls: { type: "array", items: { type: "string" } },
    gaps: { type: "array", items: { type: "string" } },
    authorityConcerns: { type: "array", items: { type: "string" } },
  },
  additionalProperties: false,
};

const REVIEW_RESULT_SCHEMA: Record<string, unknown> = {
  type: "object",
  required: [
    "verdict",
    "reason",
    "findings",
    "requiredAction",
    "residualRisk",
  ],
  properties: {
    verdict: { enum: ["PASS", "FIX", "ESCALATE"] },
    reason: { type: "string" },
    findings: {
      type: "array",
      items: {
        type: "object",
        required: ["severity", "reference", "message"],
        properties: {
          severity: { enum: ["blocking", "warning", "info"] },
          reference: { type: "string" },
          message: { type: "string" },
        },
        additionalProperties: false,
      },
    },
    requiredAction: { type: "string" },
    residualRisk: { type: "string" },
  },
  additionalProperties: false,
};

function parseJsonObject(text: string): Record<string, unknown> {
  const trimmed = text.trim();
  const unfenced = trimmed
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();
  const parsed: unknown = JSON.parse(unfenced);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("Codex final response is not a JSON object");
  }
  return parsed as Record<string, unknown>;
}

function validateImplementationReport(value: ImplementationReport): void {
  if (!value || !(["complete", "partial", "blocked"] as const).includes(value.status)) {
    throw new Error("Invalid implementation report status");
  }
  if (!value.routing || !value.routing.lane) throw new Error("Implementation report missing routing");
  for (const key of ["changes", "commands", "verified", "judgmentCalls", "gaps", "authorityConcerns"] as const) {
    if (!Array.isArray(value[key])) throw new Error(`Implementation report field ${key} must be an array`);
  }
}

function clip(value: string, limit = 1200): string {
  return value.length <= limit ? value : `${value.slice(0, limit)}…`;
}

async function consumeCodexJsonStream(
  stream: ReadableStream<Uint8Array>,
  onEvent: (event: Record<string, unknown>) => Promise<void>,
): Promise<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let full = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const chunk = decoder.decode(value, { stream: true });
    full += chunk;
    buffer += chunk;
    while (true) {
      const newline = buffer.indexOf("\n");
      if (newline < 0) break;
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (!line) continue;
      try {
        const parsed: unknown = JSON.parse(line);
        if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
          await onEvent(parsed as Record<string, unknown>);
        }
      } catch {
        // Codex diagnostics may share stdout with JSONL. Preserve them for error reporting,
        // but only valid JSON objects participate in durable thread observation.
      }
    }
  }
  const tail = `${buffer}${decoder.decode()}`.trim();
  if (tail) {
    try {
      const parsed: unknown = JSON.parse(tail);
      if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
        await onEvent(parsed as Record<string, unknown>);
      }
    } catch {
      // Preserve non-JSON tail in the returned stdout only.
    }
  }
  return full + (tail && !full.endsWith(tail) ? tail : "");
}
