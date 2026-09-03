import { randomUUID } from "node:crypto";
import { appendFile, mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { canonicalProjectPath, defaultMandateMarshalHome, projectActivationId } from "./project-activation";
import { observeRepositoryCandidate } from "./repo-state";

export const RUN_TRACE_RETENTION_DAYS = 30;
const RUN_TRACE_RETENTION_MS = RUN_TRACE_RETENTION_DAYS * 24 * 60 * 60 * 1000;
const RUN_RECEIPT_LOCK_WAIT_MS = 2_000;
const RUN_RECEIPT_LOCK_STALE_MS = 5 * 60 * 1000;

export type RunReceiptMode = "skill-contract" | "durable-runtime";
export type RunReceiptStatus = "active" | "fix-required" | "escalated" | "completed" | "aborted";
export type RunReceiptVerdict = "PASS" | "FIX" | "ESCALATE";
export type RunReceiptLifecycleTransition =
  | "implementer-started"
  | "parent-verified"
  | "reviewer-started"
  | "review-verdict"
  | "correction-started"
  | "run-completed"
  | "run-aborted";
export type RunReceiptEventType =
  | "run-started"
  | "implementer-started"
  | "candidate-observed"
  | "parent-verified"
  | "reviewer-started"
  | "review-verdict"
  | "correction-started"
  | "run-completed"
  | "run-aborted";

export interface RunReceipt {
  schemaVersion: 1;
  runId: string;
  mode: RunReceiptMode;
  projectId: string;
  projectPath: string;
  projectName: string;
  mandatemarshalVersion: string;
  startedAt: string;
  updatedAt: string;
  status: RunReceiptStatus;
  eventCount: number;
  traceRetentionDays: 30;
  lastEventType: RunReceiptEventType;
  candidateId?: string;
  gitHead?: string;
  parentVerifiedCandidateId?: string;
  latestImplementerThreadId?: string;
  latestReviewerThreadId?: string;
  latestVerdict?: RunReceiptVerdict;
  freshPassCandidateId?: string;
}

export interface RunTraceEvent {
  schemaVersion: 1;
  runId: string;
  sequence: number;
  timestamp: string;
  type: RunReceiptEventType;
  candidateId?: string;
  gitHead?: string;
  threadId?: string;
  verdict?: RunReceiptVerdict;
}

export interface RunReceiptEventInput {
  candidateId?: string;
  gitHead?: string;
  threadId?: string;
  verdict?: RunReceiptVerdict;
}

export interface RunReceiptOptions {
  storageRoot?: string;
  traceRoot?: string;
  now?: () => Date;
  idFactory?: () => string;
  mandatemarshalVersion?: string;
}

export interface RunHistoryResult {
  schemaVersion: 1;
  runId: string;
  retentionDays: 30;
  available: boolean;
  partial: boolean;
  receipt: RunReceipt;
  events: RunTraceEvent[];
}

export function defaultRunReceiptRoot(): string {
  return join(defaultMandateMarshalHome(), "receipts");
}

export function defaultRunTraceRoot(): string {
  return join(tmpdir(), "mandatemarshal", "traces");
}

export async function startRunReceipt(
  projectPath: string,
  mode: RunReceiptMode = "skill-contract",
  options: RunReceiptOptions = {},
): Promise<RunReceipt> {
  const canonical = await requireExistingProjectDirectory(projectPath);
  const projectId = await projectActivationId(canonical);
  return withReceiptLock(`project-${projectId}`, options, async () => {
    const active = await activeProjectReceipts(projectId, options);
    if (active.length > 1) throw new Error(`RUN_RECEIPT_AMBIGUOUS_ACTIVE:${projectId}:${active.map((receipt) => receipt.runId).join(",")}`);
    if (active.length === 1) throw new Error(`RUN_RECEIPT_ACTIVE_EXISTS:${projectId}:${active[0]!.runId}`);
    return createRunReceipt(canonical, projectId, mode, options);
  });
}

export async function ensureRunReceipt(
  projectPath: string,
  mode: RunReceiptMode = "skill-contract",
  options: RunReceiptOptions = {},
): Promise<{ created: boolean; receipt: RunReceipt }> {
  const canonical = await requireExistingProjectDirectory(projectPath);
  const projectId = await projectActivationId(canonical);
  return withReceiptLock(`project-${projectId}`, options, async () => {
    const active = await activeProjectReceipts(projectId, options);
    if (active.length > 1) throw new Error(`RUN_RECEIPT_AMBIGUOUS_ACTIVE:${projectId}:${active.map((receipt) => receipt.runId).join(",")}`);
    const existing = active[0];
    if (existing) {
      if (existing.mode !== mode) throw new Error(`RUN_RECEIPT_MODE_MISMATCH:${existing.runId}:${existing.mode}:${mode}`);
      return { created: false, receipt: existing };
    }
    return { created: true, receipt: await createRunReceipt(canonical, projectId, mode, options) };
  });
}

async function createRunReceipt(
  canonicalProject: string,
  projectId: string,
  mode: RunReceiptMode,
  options: RunReceiptOptions,
): Promise<RunReceipt> {
  const now = currentDate(options).toISOString();
  const id = sanitizeGeneratedRunId((options.idFactory ?? randomUUID)());
  const runId = `mm-${now.slice(0, 10).replaceAll("-", "")}-${id}`;
  const version = options.mandatemarshalVersion ?? (await readLocalPackageVersion());
  const receipt: RunReceipt = {
    schemaVersion: 1,
    runId,
    mode,
    projectId,
    projectPath: canonicalProject,
    projectName: basename(canonicalProject),
    mandatemarshalVersion: version,
    startedAt: now,
    updatedAt: now,
    status: "active",
    eventCount: 1,
    traceRetentionDays: RUN_TRACE_RETENTION_DAYS,
    lastEventType: "run-started",
  };

  await bestEffortPruneExpiredRunTraces(options);
  await writeReceiptExclusive(receipt, options);
  await bestEffortAppendTrace(
    {
      schemaVersion: 1,
      runId,
      sequence: 1,
      timestamp: now,
      type: "run-started",
    },
    options,
  );
  return receipt;
}

async function activeProjectReceipts(projectId: string, options: RunReceiptOptions): Promise<RunReceipt[]> {
  return (await listRunReceipts(options)).filter(
    (receipt) => receipt.projectId === projectId && receipt.status !== "completed" && receipt.status !== "aborted",
  );
}

export async function captureRunCandidate(runId: string, options: RunReceiptOptions = {}): Promise<RunReceipt> {
  const receipt = await readRunReceipt(runId, options);
  const observation = await observeRepositoryCandidate(receipt.projectPath);
  return recordRunReceiptEvent(
    runId,
    "candidate-observed",
    {
      candidateId: observation.candidateId,
      ...(observation.state.baseRevision === undefined ? {} : { gitHead: observation.state.baseRevision }),
    },
    options,
  );
}

/**
 * Bridge a Skill lifecycle transition into the persistent receipt without requiring
 * the Parent to manually shuttle candidate IDs between `capture` and `record`.
 * Candidate-bound transitions mechanically re-observe the repository first. An
 * unchanged observation is not duplicated in the temporary trace; a changed
 * observation is persisted before the requested transition so stale bindings are
 * invalidated even when the transition then fails closed.
 */
export async function advanceRunReceiptLifecycle(
  runId: string,
  transition: RunReceiptLifecycleTransition,
  input: RunReceiptEventInput = {},
  options: RunReceiptOptions = {},
): Promise<RunReceipt> {
  if (
    transition === "parent-verified" ||
    transition === "reviewer-started" ||
    transition === "review-verdict" ||
    transition === "run-completed"
  ) {
    const candidateId = await refreshRunCandidate(runId, options);
    return recordRunReceiptEvent(
      runId,
      transition,
      transition === "run-completed" ? input : { ...input, candidateId },
      options,
    );
  }

  return recordRunReceiptEvent(runId, transition, input, options);
}

async function refreshRunCandidate(runId: string, options: RunReceiptOptions): Promise<string> {
  const receipt = await readRunReceipt(runId, options);
  const observation = await observeRepositoryCandidate(receipt.projectPath);
  const gitHead = observation.state.baseRevision;
  const sameCandidate = receipt.candidateId === observation.candidateId;
  const sameGitHead = receipt.gitHead === gitHead || (receipt.gitHead === undefined && gitHead === undefined);
  if (sameCandidate && sameGitHead) return observation.candidateId;

  await recordRunReceiptEvent(
    runId,
    "candidate-observed",
    {
      candidateId: observation.candidateId,
      ...(gitHead === undefined ? {} : { gitHead }),
    },
    options,
  );
  return observation.candidateId;
}

export async function recordRunReceiptEvent(
  runId: string,
  type: Exclude<RunReceiptEventType, "run-started">,
  input: RunReceiptEventInput = {},
  options: RunReceiptOptions = {},
): Promise<RunReceipt> {
  assertSafeRunId(runId);
  await bestEffortPruneExpiredRunTraces(options);
  return withReceiptLock(`run-${runId}`, options, async () => {
    const receipt = await readRunReceipt(runId, options);
    if (receipt.status === "completed" || receipt.status === "aborted") {
      throw new Error(`RUN_RECEIPT_TERMINAL:${runId}:${receipt.status}`);
    }
    const timestamp = currentDate(options).toISOString();
    const sequence = receipt.eventCount + 1;
    const event: RunTraceEvent = {
      schemaVersion: 1,
      runId,
      sequence,
      timestamp,
      type,
      ...(input.candidateId === undefined ? {} : { candidateId: requireNonEmpty(input.candidateId, "candidateId") }),
      ...(input.gitHead === undefined ? {} : { gitHead: requireNonEmpty(input.gitHead, "gitHead") }),
      ...(input.threadId === undefined ? {} : { threadId: requireNonEmpty(input.threadId, "threadId") }),
      ...(input.verdict === undefined ? {} : { verdict: input.verdict }),
    };
    const updated = applyEvent(receipt, event);
    await persistReceipt(updated, options);
    await bestEffortAppendTrace(event, options);
    return updated;
  });
}

export async function readRunReceipt(runId: string, options: RunReceiptOptions = {}): Promise<RunReceipt> {
  assertSafeRunId(runId);
  const file = receiptPath(runId, options);
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(file, "utf8"));
  } catch (error) {
    if (isMissingFile(error)) throw new Error(`RUN_RECEIPT_NOT_FOUND:${runId}`);
    throw error;
  }
  return validateReceipt(parsed, runId);
}

export async function listRunReceipts(options: RunReceiptOptions = {}): Promise<RunReceipt[]> {
  await bestEffortPruneExpiredRunTraces(options);
  const root = receiptRoot(options);
  let names: string[];
  try {
    names = (await readdir(root)).filter((name) => name.endsWith(".json"));
  } catch (error) {
    if (isMissingFile(error)) return [];
    throw error;
  }
  const receipts = await Promise.all(
    names.map(async (name) => {
      const runId = name.slice(0, -5);
      return readRunReceipt(runId, options);
    }),
  );
  return receipts.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || b.runId.localeCompare(a.runId));
}

export async function readRunHistory(runId: string, options: RunReceiptOptions = {}): Promise<RunHistoryResult> {
  await bestEffortPruneExpiredRunTraces(options);
  const receipt = await readRunReceipt(runId, options);
  const file = tracePath(runId, options);
  let text: string;
  try {
    text = await readFile(file, "utf8");
  } catch (error) {
    if (isTraceUnavailable(error)) {
      return {
        schemaVersion: 1,
        runId,
        retentionDays: RUN_TRACE_RETENTION_DAYS,
        available: false,
        partial: false,
        receipt,
        events: [],
      };
    }
    throw error;
  }
  const events = text
    .split(/\r?\n/u)
    .filter((line) => line.trim().length > 0)
    .map((line) => validateTraceEvent(JSON.parse(line) as unknown, runId));
  const contiguous = events.every((event, index) => index === 0 || event.sequence === events[index - 1]!.sequence + 1);
  const partial =
    events.length > 0 &&
    (events[0]!.sequence !== 1 || !contiguous || events.at(-1)!.sequence !== receipt.eventCount);
  return {
    schemaVersion: 1,
    runId,
    retentionDays: RUN_TRACE_RETENTION_DAYS,
    available: true,
    partial,
    receipt,
    events,
  };
}

export async function pruneExpiredRunTraces(options: RunReceiptOptions = {}): Promise<number> {
  const root = traceRoot(options);
  let receiptNames: string[];
  try {
    receiptNames = await readdir(receiptRoot(options));
  } catch (error) {
    if (isMissingFile(error)) return 0;
    throw error;
  }
  const knownRunIds = new Set(
    receiptNames
      .filter((name) => name.endsWith(".json"))
      .map((name) => name.slice(0, -5))
      .filter(isSafeRunId),
  );
  let names: string[];
  try {
    names = (await readdir(root)).filter((name) => {
      if (!name.endsWith(".jsonl")) return false;
      const runId = name.slice(0, -6);
      return isSafeRunId(runId) && knownRunIds.has(runId);
    });
  } catch (error) {
    if (isMissingFile(error)) return 0;
    throw error;
  }
  const cutoff = currentDate(options).getTime() - RUN_TRACE_RETENTION_MS;
  let deleted = 0;
  for (const name of names) {
    const file = join(root, name);
    const info = await stat(file);
    if (info.mtimeMs >= cutoff) continue;
    await rm(file, { force: true });
    deleted += 1;
  }
  return deleted;
}

function applyEvent(receipt: RunReceipt, event: RunTraceEvent): RunReceipt {
  const next: RunReceipt = {
    ...receipt,
    updatedAt: event.timestamp,
    eventCount: event.sequence,
    lastEventType: event.type,
  };

  switch (event.type) {
    case "implementer-started": {
      if (!event.threadId) throw new Error("RUN_RECEIPT_THREAD_REQUIRED:implementer-started");
      next.latestImplementerThreadId = event.threadId;
      next.status = "active";
      return next;
    }
    case "candidate-observed": {
      if (!event.candidateId) throw new Error("RUN_RECEIPT_CANDIDATE_REQUIRED:candidate-observed");
      if (next.candidateId !== event.candidateId) {
        delete next.parentVerifiedCandidateId;
        delete next.latestVerdict;
        delete next.freshPassCandidateId;
      }
      next.candidateId = event.candidateId;
      if (event.gitHead !== undefined) next.gitHead = event.gitHead;
      next.status = "active";
      return next;
    }
    case "parent-verified": {
      requireCurrentCandidate(next, event, "parent-verified");
      const candidateId = event.candidateId;
      if (!candidateId) throw new Error("RUN_RECEIPT_CANDIDATE_REQUIRED:parent-verified");
      next.parentVerifiedCandidateId = candidateId;
      return next;
    }
    case "reviewer-started": {
      requireCurrentCandidate(next, event, "reviewer-started");
      if (next.parentVerifiedCandidateId !== next.candidateId) {
        throw new Error(`RUN_RECEIPT_PARENT_VERIFICATION_REQUIRED:${receipt.runId}`);
      }
      if (!event.threadId) throw new Error("RUN_RECEIPT_THREAD_REQUIRED:reviewer-started");
      next.latestReviewerThreadId = event.threadId;
      return next;
    }
    case "review-verdict": {
      requireCurrentCandidate(next, event, "review-verdict");
      if (!event.verdict) throw new Error("RUN_RECEIPT_VERDICT_REQUIRED:review-verdict");
      next.latestVerdict = event.verdict;
      if (event.verdict === "PASS") {
        if (next.parentVerifiedCandidateId !== next.candidateId) {
          throw new Error(`RUN_RECEIPT_PARENT_VERIFICATION_REQUIRED:${receipt.runId}`);
        }
        const candidateId = next.candidateId;
        if (!candidateId) throw new Error("RUN_RECEIPT_CANDIDATE_REQUIRED:review-verdict");
        next.freshPassCandidateId = candidateId;
        next.status = "active";
      } else if (event.verdict === "FIX") {
        delete next.freshPassCandidateId;
        next.status = "fix-required";
      } else {
        delete next.freshPassCandidateId;
        next.status = "escalated";
      }
      return next;
    }
    case "correction-started": {
      if (next.status !== "fix-required") throw new Error(`RUN_RECEIPT_FIX_REQUIRED:${receipt.runId}`);
      next.status = "active";
      return next;
    }
    case "run-completed": {
      if (!next.candidateId || next.freshPassCandidateId !== next.candidateId) {
        throw new Error(`RUN_RECEIPT_FRESH_PASS_REQUIRED:${receipt.runId}`);
      }
      next.status = "completed";
      return next;
    }
    case "run-aborted": {
      next.status = "aborted";
      return next;
    }
    case "run-started":
      throw new Error("RUN_RECEIPT_DUPLICATE_START");
  }
}

function requireCurrentCandidate(receipt: RunReceipt, event: RunTraceEvent, type: RunReceiptEventType): void {
  if (!event.candidateId) throw new Error(`RUN_RECEIPT_CANDIDATE_REQUIRED:${type}`);
  if (!receipt.candidateId || receipt.candidateId !== event.candidateId) {
    throw new Error(`RUN_RECEIPT_CANDIDATE_MISMATCH:${type}:${receipt.candidateId ?? "none"}:${event.candidateId}`);
  }
}

async function writeReceiptExclusive(receipt: RunReceipt, options: RunReceiptOptions): Promise<void> {
  const file = receiptPath(receipt.runId, options);
  await mkdir(dirname(file), { recursive: true, mode: 0o700 });
  await writeFile(file, `${JSON.stringify(receipt, null, 2)}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
}

async function persistReceipt(receipt: RunReceipt, options: RunReceiptOptions): Promise<void> {
  const file = receiptPath(receipt.runId, options);
  await mkdir(dirname(file), { recursive: true, mode: 0o700 });
  const temporary = `${file}.tmp-${process.pid}-${Date.now()}`;
  try {
    await writeFile(temporary, `${JSON.stringify(receipt, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    await rename(temporary, file);
  } finally {
    await rm(temporary, { force: true }).catch(() => undefined);
  }
}

async function appendTrace(event: RunTraceEvent, options: RunReceiptOptions): Promise<void> {
  const file = tracePath(event.runId, options);
  await mkdir(dirname(file), { recursive: true, mode: 0o700 });
  await appendFile(file, `${JSON.stringify(event)}\n`, { encoding: "utf8", mode: 0o600 });
}

async function bestEffortAppendTrace(event: RunTraceEvent, options: RunReceiptOptions): Promise<void> {
  await appendTrace(event, options).catch(() => undefined);
}

async function bestEffortPruneExpiredRunTraces(options: RunReceiptOptions): Promise<void> {
  await pruneExpiredRunTraces(options).catch(() => undefined);
}

interface ReceiptLockHandle {
  file: string;
  token: string;
}

async function withReceiptLock<T>(key: string, options: RunReceiptOptions, work: () => Promise<T>): Promise<T> {
  const lock = await acquireReceiptLock(key, options);
  try {
    return await work();
  } finally {
    await releaseReceiptLock(lock);
  }
}

async function acquireReceiptLock(key: string, options: RunReceiptOptions): Promise<ReceiptLockHandle> {
  if (!/^[A-Za-z0-9._-]+$/u.test(key)) throw new Error(`RUN_RECEIPT_LOCK_KEY_INVALID:${key}`);
  const directory = join(receiptRoot(options), ".locks");
  const file = join(directory, `${key}.lock`);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const deadline = Date.now() + RUN_RECEIPT_LOCK_WAIT_MS;
  const token = randomUUID();

  while (true) {
    try {
      await writeFile(file, `${JSON.stringify({ token, pid: process.pid, createdAt: new Date().toISOString() })}\n`, {
        encoding: "utf8",
        mode: 0o600,
        flag: "wx",
      });
      return { file, token };
    } catch (error) {
      if (!isErrorCode(error, "EEXIST")) throw error;
      try {
        const info = await stat(file);
        if (Date.now() - info.mtimeMs > RUN_RECEIPT_LOCK_STALE_MS) {
          await rm(file, { force: true });
          continue;
        }
      } catch (statError) {
        if (isMissingFile(statError)) continue;
        throw statError;
      }
      if (Date.now() >= deadline) throw new Error(`RUN_RECEIPT_LOCKED:${key}`);
      await delay(10);
    }
  }
}

async function releaseReceiptLock(lock: ReceiptLockHandle): Promise<void> {
  try {
    const current = JSON.parse(await readFile(lock.file, "utf8")) as { token?: unknown };
    if (current.token === lock.token) await rm(lock.file, { force: true });
  } catch (error) {
    if (!isMissingFile(error)) return;
  }
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}

function receiptRoot(options: RunReceiptOptions): string {
  return options.storageRoot ? resolve(options.storageRoot) : defaultRunReceiptRoot();
}

function traceRoot(options: RunReceiptOptions): string {
  return options.traceRoot ? resolve(options.traceRoot) : defaultRunTraceRoot();
}

function receiptPath(runId: string, options: RunReceiptOptions): string {
  assertSafeRunId(runId);
  return join(receiptRoot(options), `${runId}.json`);
}

function tracePath(runId: string, options: RunReceiptOptions): string {
  assertSafeRunId(runId);
  return join(traceRoot(options), `${runId}.jsonl`);
}

function currentDate(options: RunReceiptOptions): Date {
  return (options.now ?? (() => new Date()))();
}

async function requireExistingProjectDirectory(projectPath: string): Promise<string> {
  const canonical = await canonicalProjectPath(projectPath);
  let info;
  try {
    info = await stat(canonical);
  } catch (error) {
    if (isMissingFile(error)) throw new Error(`RUN_RECEIPT_PROJECT_NOT_FOUND:${canonical}`);
    throw error;
  }
  if (!info.isDirectory()) throw new Error(`RUN_RECEIPT_PROJECT_NOT_DIRECTORY:${canonical}`);
  return canonical;
}

function sanitizeGeneratedRunId(value: string): string {
  const sanitized = value.replace(/[^A-Za-z0-9._-]/gu, "").slice(0, 36);
  if (!sanitized) throw new Error("RUN_RECEIPT_ID_GENERATION_FAILED");
  return sanitized;
}

function assertSafeRunId(runId: string): void {
  if (!isSafeRunId(runId)) throw new Error(`Unsafe run id: ${runId}`);
}

function isSafeRunId(runId: string): boolean {
  return /^[A-Za-z0-9._-]+$/u.test(runId);
}

function requireNonEmpty(value: string, field: string): string {
  if (!value.trim()) throw new Error(`RUN_RECEIPT_FIELD_EMPTY:${field}`);
  return value;
}

function validateReceipt(value: unknown, expectedRunId: string): RunReceipt {
  if (!isRecord(value) || value.schemaVersion !== 1 || value.runId !== expectedRunId) {
    throw new Error(`RUN_RECEIPT_INVALID:${expectedRunId}`);
  }
  if (value.mode !== "skill-contract" && value.mode !== "durable-runtime") throw new Error(`RUN_RECEIPT_INVALID_MODE:${expectedRunId}`);
  if (!isString(value.projectId) || !isString(value.projectPath) || !isString(value.projectName)) throw new Error(`RUN_RECEIPT_INVALID_PROJECT:${expectedRunId}`);
  if (!isString(value.mandatemarshalVersion) || !isString(value.startedAt) || !isString(value.updatedAt)) throw new Error(`RUN_RECEIPT_INVALID_METADATA:${expectedRunId}`);
  if (!isRunStatus(value.status) || !isPositiveInteger(value.eventCount)) throw new Error(`RUN_RECEIPT_INVALID_STATE:${expectedRunId}`);
  if (value.traceRetentionDays !== RUN_TRACE_RETENTION_DAYS || !isRunEventType(value.lastEventType)) throw new Error(`RUN_RECEIPT_INVALID_TRACE_POLICY:${expectedRunId}`);
  for (const key of ["candidateId", "gitHead", "parentVerifiedCandidateId", "latestImplementerThreadId", "latestReviewerThreadId", "freshPassCandidateId"] as const) {
    if (value[key] !== undefined && !isString(value[key])) throw new Error(`RUN_RECEIPT_INVALID_FIELD:${expectedRunId}:${key}`);
  }
  if (value.latestVerdict !== undefined && !isVerdict(value.latestVerdict)) throw new Error(`RUN_RECEIPT_INVALID_VERDICT:${expectedRunId}`);
  if (value.parentVerifiedCandidateId !== undefined && value.parentVerifiedCandidateId !== value.candidateId) {
    throw new Error(`RUN_RECEIPT_INVALID_PARENT_BINDING:${expectedRunId}`);
  }
  if (value.freshPassCandidateId !== undefined && value.freshPassCandidateId !== value.candidateId) {
    throw new Error(`RUN_RECEIPT_INVALID_PASS_BINDING:${expectedRunId}`);
  }
  if (value.latestVerdict === "PASS" && value.freshPassCandidateId !== value.candidateId) {
    throw new Error(`RUN_RECEIPT_INVALID_PASS_STATE:${expectedRunId}`);
  }
  if ((value.latestVerdict === "FIX" || value.latestVerdict === "ESCALATE") && value.freshPassCandidateId !== undefined) {
    throw new Error(`RUN_RECEIPT_INVALID_NONPASS_STATE:${expectedRunId}`);
  }
  if (value.status === "completed" && (!value.candidateId || value.freshPassCandidateId !== value.candidateId)) {
    throw new Error(`RUN_RECEIPT_INVALID_COMPLETION:${expectedRunId}`);
  }
  return value as unknown as RunReceipt;
}

function validateTraceEvent(value: unknown, expectedRunId: string): RunTraceEvent {
  if (!isRecord(value) || value.schemaVersion !== 1 || value.runId !== expectedRunId) throw new Error(`RUN_TRACE_INVALID:${expectedRunId}`);
  if (!isPositiveInteger(value.sequence) || !isString(value.timestamp) || !isRunEventType(value.type)) throw new Error(`RUN_TRACE_INVALID_EVENT:${expectedRunId}`);
  if (value.candidateId !== undefined && !isString(value.candidateId)) throw new Error(`RUN_TRACE_INVALID_CANDIDATE:${expectedRunId}`);
  if (value.gitHead !== undefined && !isString(value.gitHead)) throw new Error(`RUN_TRACE_INVALID_GIT_HEAD:${expectedRunId}`);
  if (value.threadId !== undefined && !isString(value.threadId)) throw new Error(`RUN_TRACE_INVALID_THREAD:${expectedRunId}`);
  if (value.verdict !== undefined && !isVerdict(value.verdict)) throw new Error(`RUN_TRACE_INVALID_VERDICT:${expectedRunId}`);
  return value as unknown as RunTraceEvent;
}

function isRunStatus(value: unknown): value is RunReceiptStatus {
  return value === "active" || value === "fix-required" || value === "escalated" || value === "completed" || value === "aborted";
}

function isRunEventType(value: unknown): value is RunReceiptEventType {
  return value === "run-started" || value === "implementer-started" || value === "candidate-observed" || value === "parent-verified" || value === "reviewer-started" || value === "review-verdict" || value === "correction-started" || value === "run-completed" || value === "run-aborted";
}

function isVerdict(value: unknown): value is RunReceiptVerdict {
  return value === "PASS" || value === "FIX" || value === "ESCALATE";
}

function isString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isMissingFile(error: unknown): boolean {
  return isErrorCode(error, "ENOENT");
}

function isTraceUnavailable(error: unknown): boolean {
  return isErrorCode(error, "ENOENT") || isErrorCode(error, "ENOTDIR");
}

function isErrorCode(error: unknown, code: string): boolean {
  return isRecord(error) && error.code === code;
}

async function readLocalPackageVersion(): Promise<string> {
  const packageJson = JSON.parse(await readFile(join(import.meta.dir, "..", "..", "package.json"), "utf8")) as { version?: unknown };
  if (typeof packageJson.version !== "string" || !packageJson.version.trim()) throw new Error("PACKAGE_VERSION_INVALID");
  return packageJson.version;
}
