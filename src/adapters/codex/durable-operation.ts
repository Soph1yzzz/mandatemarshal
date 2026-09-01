import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import type { DurableOperationProbeResult, ImplementationReport, ReviewResult, RoutingEvidence } from "../../core/types";
import { assertReviewResult } from "../../core/validation";

export type CodexDurableOperationKind = "spawn-implementer" | "spawn-reviewer";

export interface CodexDurableOperationRecord {
  schemaVersion: 1;
  operationId: string;
  kind: CodexDurableOperationKind;
  threadId: string;
  startedAt: string;
  cwd: string;
  pid?: number;
  routing?: RoutingEvidence;
  candidateId?: string;
  completedAt?: string;
  result?: ImplementationReport | ReviewResult;
}

export function defaultCodexDurableOperationRoot(): string {
  return join(homedir(), ".mandatemarshal", "providers", "codex", "operations");
}

export function defaultCodexHome(): string {
  return process.env.CODEX_HOME ? resolve(process.env.CODEX_HOME) : join(homedir(), ".codex");
}

export class CodexDurableOperationStore {
  constructor(
    readonly root = defaultCodexDurableOperationRoot(),
    readonly codexHome = defaultCodexHome(),
  ) {}

  async recordStarted(input: Omit<CodexDurableOperationRecord, "schemaVersion" | "startedAt">): Promise<void> {
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    const existing = await this.read(input.operationId);
    if (existing && existing.threadId !== input.threadId) {
      throw new Error(`CODEX_DURABLE_OPERATION_THREAD_MISMATCH:${input.operationId}`);
    }
    const record: CodexDurableOperationRecord = {
      schemaVersion: 1,
      operationId: input.operationId,
      kind: input.kind,
      threadId: input.threadId,
      startedAt: existing?.startedAt ?? new Date().toISOString(),
      cwd: resolve(input.cwd),
      ...(input.pid === undefined ? {} : { pid: input.pid }),
      ...(input.routing === undefined ? {} : { routing: input.routing }),
      ...(input.candidateId === undefined ? {} : { candidateId: input.candidateId }),
      ...(existing?.completedAt === undefined ? {} : { completedAt: existing.completedAt }),
      ...(existing?.result === undefined ? {} : { result: existing.result }),
    };
    await atomicWriteJson(this.pathFor(input.operationId), record);
  }

  async recordCompleted(operationId: string, result: ImplementationReport | ReviewResult): Promise<void> {
    const current = await this.require(operationId);
    await atomicWriteJson(this.pathFor(operationId), {
      ...current,
      completedAt: new Date().toISOString(),
      result,
    } satisfies CodexDurableOperationRecord);
  }

  async read(operationId: string): Promise<CodexDurableOperationRecord | undefined> {
    assertOperationId(operationId);
    try {
      const parsed = JSON.parse(await readFile(this.pathFor(operationId), "utf8")) as CodexDurableOperationRecord;
      validateRecord(parsed, operationId);
      return parsed;
    } catch (error) {
      if (isErrorCode(error, "ENOENT")) return undefined;
      throw error;
    }
  }

  async observe(operationId: string): Promise<DurableOperationProbeResult> {
    const record = await this.read(operationId);
    if (!record) {
      return {
        outcome: "unknown",
        detail: "No Codex durable-operation mapping exists; absence is not proof that launch never escaped",
      };
    }
    if (record.result !== undefined) {
      return {
        outcome: "completed",
        detail: `Codex durable-operation record contains a completed ${record.kind} result`,
        result: recoveredResult(record),
      };
    }

    const sessionFile = await findSessionFile(this.codexHome, record.threadId);
    if (sessionFile) {
      const finalMessage = await readTaskCompleteMessage(sessionFile);
      if (finalMessage !== undefined) {
        const result = parseRecoveredResult(record, finalMessage);
        await this.recordCompleted(operationId, result);
        return {
          outcome: "completed",
          detail: `Recovered completed Codex session ${record.threadId} from persisted session JSONL`,
          result: recoveredResult({ ...record, result }),
        };
      }
    }

    if (record.pid !== undefined && isProcessAlive(record.pid)) {
      return {
        outcome: "in-progress",
        detail: `Codex process ${record.pid} for thread ${record.threadId} is still alive`,
      };
    }
    return {
      outcome: "unknown",
      detail: `Codex thread ${record.threadId} exists but has no verified completed result`,
    };
  }

  private pathFor(operationId: string): string {
    assertOperationId(operationId);
    return join(this.root, `${operationId}.json`);
  }

  private async require(operationId: string): Promise<CodexDurableOperationRecord> {
    const record = await this.read(operationId);
    if (!record) throw new Error(`CODEX_DURABLE_OPERATION_UNKNOWN:${operationId}`);
    return record;
  }
}

function recoveredResult(record: CodexDurableOperationRecord): unknown {
  if (!record.result) return undefined;
  if (record.kind === "spawn-implementer") {
    return {
      worker: {
        id: `codex-thread-${record.threadId}`,
        role: record.routing?.lane ?? "routine-implementer",
        ...(record.result && "candidateId" in record.result && record.result.candidateId !== undefined
          ? { candidateId: record.result.candidateId }
          : {}),
      },
      implementation: record.result,
    };
  }
  return {
    reviewer: {
      id: `codex-thread-${record.threadId}`,
      role: "fresh-reviewer",
      candidateId: record.candidateId ?? "",
    },
    review: record.result,
  };
}

function parseRecoveredResult(
  record: CodexDurableOperationRecord,
  finalMessage: string,
): ImplementationReport | ReviewResult {
  const raw = parseJsonObject(finalMessage);
  if (record.kind === "spawn-implementer") {
    if (!record.routing) throw new Error(`CODEX_DURABLE_ROUTING_MISSING:${record.operationId}`);
    const result = { ...raw, routing: record.routing } as unknown as ImplementationReport;
    validateRecoveredImplementation(result);
    return result;
  }
  if (!record.candidateId) throw new Error(`CODEX_DURABLE_CANDIDATE_MISSING:${record.operationId}`);
  const result = {
    ...raw,
    schemaVersion: 1,
    candidateId: record.candidateId,
  } as unknown as ReviewResult;
  assertReviewResult(result);
  return result;
}

async function findSessionFile(codexHome: string, threadId: string): Promise<string | undefined> {
  const sessions = join(codexHome, "sessions");
  return findFileRecursive(sessions, (name) => name.includes(threadId) && name.endsWith(".jsonl"));
}

async function findFileRecursive(
  directory: string,
  predicate: (name: string) => boolean,
): Promise<string | undefined> {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (isErrorCode(error, "ENOENT")) return undefined;
    throw error;
  }
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isFile() && predicate(entry.name)) return path;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const found = await findFileRecursive(join(directory, entry.name), predicate);
    if (found) return found;
  }
  return undefined;
}

async function readTaskCompleteMessage(path: string): Promise<string | undefined> {
  const content = await readFile(path, "utf8");
  let last: string | undefined;
  for (const line of content.split(/\r?\n/u)) {
    if (!line.trim()) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }
    if (typeof parsed !== "object" || parsed === null) continue;
    const outer = parsed as { type?: unknown; payload?: unknown };
    if (outer.type !== "event_msg" || typeof outer.payload !== "object" || outer.payload === null) continue;
    const payload = outer.payload as { type?: unknown; last_agent_message?: unknown };
    if (payload.type === "task_complete" && typeof payload.last_agent_message === "string") {
      last = payload.last_agent_message;
    }
  }
  return last;
}

function validateRecoveredImplementation(value: ImplementationReport): void {
  if (!(["complete", "partial", "blocked"] as const).includes(value.status)) {
    throw new Error("Recovered Codex implementation result has invalid status");
  }
  if (!value.routing?.lane || typeof value.objective !== "string") {
    throw new Error("Recovered Codex implementation result is missing routing/objective");
  }
  for (const key of ["changes", "commands", "verified", "judgmentCalls", "gaps", "authorityConcerns"] as const) {
    if (!Array.isArray(value[key])) throw new Error(`Recovered Codex implementation field ${key} must be an array`);
  }
}

function parseJsonObject(text: string): Record<string, unknown> {
  const unfenced = text.trim().replace(/^```(?:json)?\s*/iu, "").replace(/\s*```$/u, "").trim();
  const parsed: unknown = JSON.parse(unfenced);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("Recovered Codex final response is not a JSON object");
  }
  return parsed as Record<string, unknown>;
}

function isProcessAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function validateRecord(record: CodexDurableOperationRecord, operationId: string): void {
  if (record.schemaVersion !== 1 || record.operationId !== operationId || !record.threadId.trim()) {
    throw new Error(`CODEX_DURABLE_OPERATION_RECORD_INVALID:${operationId}`);
  }
}

function assertOperationId(operationId: string): void {
  if (!/^[A-Za-z0-9._-]+$/u.test(operationId)) throw new Error("Unsafe durable operation id");
}

async function atomicWriteJson(path: string, value: unknown): Promise<void> {
  const directory = dirname(path);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const temp = join(directory, `.${basename(path)}.${randomUUID()}.tmp`);
  await writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
  try {
    await rename(temp, path);
  } catch (error) {
    await unlink(temp).catch(() => undefined);
    throw error;
  }
}

function isErrorCode(error: unknown, code: string): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as { code?: unknown }).code === code;
}
