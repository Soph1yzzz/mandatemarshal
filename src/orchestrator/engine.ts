import { createHash, randomUUID } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { RunStateMachine } from "../core/state-machine";
import type {
  DurableOperationProbeResult,
  EscalationPacket,
  ExecutionEvidence,
  HostAdapter,
  ImplementationPacket,
  ImplementationReport,
  ReviewResult,
  RunEvent,
} from "../core/types";
import { defaultRunRoot, persistRunArtifacts } from "../runtime/evidence-store";
import type { DurableOperationDecision, DurableOperationRecord } from "../runtime/recovery";
import {
  DurableEngineRuntime,
  type DurableEngineState,
  type DurableRuntimeOptions,
} from "./durable-runtime";

export type ParentPlan =
  | { kind: "ready"; packet: ImplementationPacket }
  | { kind: "escalate"; escalation: EscalationPacket };

export interface ParentVerification {
  passed: boolean;
  candidateId: string;
  evidence: ExecutionEvidence;
  blocker?: string;
}

export interface ParentController<Request = unknown> {
  plan(request: Request): Promise<ParentPlan>;
  verify(packet: ImplementationPacket, report: ImplementationReport): Promise<ParentVerification>;
  observeCandidateId(): Promise<string>;
  reclassifyBlocked(packet: ImplementationPacket, report: ImplementationReport): Promise<ImplementationPacket | null>;
  correction(packet: ImplementationPacket, review: ReviewResult): Promise<ImplementationPacket>;
  escalateReview(packet: ImplementationPacket, review: ReviewResult): Promise<EscalationPacket>;
}

export type OrchestrationResult =
  | {
      status: "completed";
      runId: string;
      candidateId: string;
      implementation: ImplementationReport;
      review: ReviewResult;
      evidence: ExecutionEvidence;
      events: readonly RunEvent[];
      artifactDir?: string;
      runtimeDir?: string;
    }
  | {
      status: "blocked";
      runId: string;
      reason: string;
      events: readonly RunEvent[];
      runtimeDir?: string;
    }
  | {
      status: "user-decision-pending";
      runId: string;
      escalation: EscalationPacket;
      events: readonly RunEvent[];
      runtimeDir?: string;
    }
  | {
      status: "reconciliation-required";
      runId: string;
      reason: string;
      operations: readonly DurableOperationDecision[];
      events: readonly RunEvent[];
      runtimeDir: string;
    };

export interface OrchestratorOptions {
  runId?: string;
  maxFixCycles?: number;
  persistArtifacts?: boolean;
  artifactRoot?: string;
  durability?: DurableRuntimeOptions | false;
}

export class OrchestrationEngine<Request = unknown> {
  constructor(
    private readonly adapter: HostAdapter,
    private readonly parent: ParentController<Request>,
    private readonly options: OrchestratorOptions = {},
  ) {}

  async run(request: Request): Promise<OrchestrationResult> {
    if (this.options.durability && this.options.durability.resume && !this.options.runId) {
      throw new Error("Durable resume requires an explicit runId");
    }

    const runId = this.options.runId ?? randomUUID();
    const durability = this.options.durability === false ? undefined : this.options.durability;
    let durable: DurableEngineRuntime | undefined;
    let machine: RunStateMachine;
    let durableState: DurableEngineState = {
      schemaVersion: 1,
      stage: "created",
      fixCycles: 0,
    };

    if (durability?.resume) {
      const resumeDurability: DurableRuntimeOptions = {
        ...durability,
        observer: async (
          operation: Parameters<NonNullable<DurableRuntimeOptions["observer"]>>[0],
        ): Promise<DurableOperationProbeResult> => {
          if (operation.kind === "persist-artifacts") {
            return observePersistedArtifacts(runId, this.options.artifactRoot);
          }
          if (durability.observer) return durability.observer(operation);
          if (this.adapter.observeDurableOperation) return this.adapter.observeDurableOperation(operation);
          return {
            outcome: "unknown",
            detail: `No durable observer is available for operation kind ${operation.kind}`,
          };
        },
      };
      const resumed = await DurableEngineRuntime.resume(runId, resumeDurability);
      durable = resumed.runtime;
      machine = resumed.machine;
      durableState = cloneDurableState(resumed.state);
      hydrateOperationsAfterSnapshot(durableState, resumed.operations, resumed.snapshotSequence);
      normalizeStageForMachine(durableState, machine);

      const unresolved = resumed.pending.filter(
        (decision) => decision.status === "waiting" || decision.status === "reconciliation-required",
      );
      if (unresolved.length > 0) {
        try {
          return {
            status: "reconciliation-required",
            runId,
            reason: unresolved.some((decision) => decision.status === "reconciliation-required")
              ? "UNFINISHED_OPERATION_AMBIGUOUS"
              : "UNFINISHED_OPERATION_STILL_RUNNING",
            operations: unresolved,
            events: machine.events,
            runtimeDir: durable.store.runDir,
          };
        } finally {
          await durable.release();
        }
      }
      await durable.abandonRetryablePending(resumed.pending, machine);
      await durable.checkpoint(machine, durableState);
    } else {
      machine = new RunStateMachine(runId);
      if (durability) {
        durable = await DurableEngineRuntime.create(runId, durability);
        await durable.checkpoint(machine, durableState);
      }
    }

    try {
      return await this.execute(request, runId, machine, durableState, durable);
    } finally {
      if (durable) await durable.release().catch(() => undefined);
    }
  }

  private async execute(
    request: Request,
    runId: string,
    machine: RunStateMachine,
    durableState: DurableEngineState,
    durable?: DurableEngineRuntime,
  ): Promise<OrchestrationResult> {
    const runtimeDir = durable?.store.runDir;
    const checkpoint = async (): Promise<void> => {
      if (durable) await durable.checkpoint(machine, durableState);
    };
    const move = async (
      to: Parameters<RunStateMachine["transition"]>[0],
      ctx: Parameters<RunStateMachine["transition"]>[1] = {},
    ): Promise<void> => {
      machine.transition(to, ctx);
      await checkpoint();
    };
    const mutateMachine = async (mutation: () => void): Promise<void> => {
      mutation();
      await checkpoint();
    };

    if (machine.state === "COMPLETED") {
      const candidateId = machine.snapshot().candidateId;
      if (candidateId && durableState.implementation && durableState.review && durableState.evidence) {
        return {
          status: "completed",
          runId,
          candidateId,
          implementation: durableState.implementation,
          review: durableState.review,
          evidence: durableState.evidence,
          events: machine.events,
          ...(durableState.artifactDir === undefined ? {} : { artifactDir: durableState.artifactDir }),
          ...(runtimeDir === undefined ? {} : { runtimeDir }),
        };
      }
      return blocked(runId, "COMPLETED_RUN_SNAPSHOT_INCOMPLETE", machine.events, runtimeDir);
    }
    if (machine.state === "ABORTED") return blocked(runId, "RUN_ALREADY_ABORTED", machine.events, runtimeDir);
    if (machine.state === "USER_DECISION_PENDING") {
      return blocked(runId, "RUN_AWAITS_USER_DECISION", machine.events, runtimeDir);
    }

    if (machine.state === "IDLE") await move("INTAKE");
    if (machine.state === "INTAKE") await move("CONTRACT_CHECK");
    if (machine.state === "CONTRACT_CHECK") await move("PLANNING");

    if (machine.state === "PLANNING" && !durableState.packet) {
      const plan = await this.parent.plan(request);
      if (plan.kind === "escalate") {
        await move("AUTHORITY_CONFLICT");
        await mutateMachine(() => machine.markEscalationPending(true));
        await move("USER_DECISION_PENDING");
        return {
          status: "user-decision-pending",
          runId,
          escalation: plan.escalation,
          events: machine.events,
          ...(runtimeDir === undefined ? {} : { runtimeDir }),
        };
      }
      durableState.packet = plan.packet;
      durableState.stage = "planned";
      await checkpoint();
    }

    if (machine.state === "PLANNING" && durableState.packet) await move("READY_TO_DELEGATE");
    let packet = durableState.packet;
    if (!packet) return blocked(runId, "DURABLE_PACKET_MISSING", machine.events, runtimeDir);

    const maxFixCycles = this.options.maxFixCycles ?? 5;

    while (true) {
      if (machine.state === "BLOCKED") {
        return blocked(runId, "RUN_ALREADY_BLOCKED", machine.events, runtimeDir);
      }

      if (machine.state === "CORRECTION_REQUIRED") {
        const review = durableState.review;
        if (review?.verdict === "FIX" && durableState.correctionPreparedFor !== review.candidateId) {
          durableState.fixCycles += 1;
          if (durableState.fixCycles > maxFixCycles) {
            await move("BLOCKED");
            return blocked(runId, "MAX_FIX_CYCLES_EXCEEDED", machine.events, runtimeDir);
          }
          packet = await this.parent.correction(packet, review);
          durableState.packet = packet;
          durableState.correctionPreparedFor = review.candidateId;
          durableState.implementation = undefined;
          durableState.evidence = undefined;
          durableState.verification = undefined;
          durableState.review = undefined;
          durableState.worker = undefined;
          durableState.reviewer = undefined;
          durableState.stage = "planned";
          await checkpoint();
        }
      }

      if (machine.state === "READY_TO_DELEGATE" || machine.state === "CORRECTION_REQUIRED") {
        const caps = await this.adapter.capabilities();
        const capabilityAvailable = caps.subagents && caps.exactModelSelection && caps.reasoningSelection;
        if (!capabilityAvailable) {
          await move("BLOCKED");
          return blocked(runId, "IMPLEMENTER_CAPABILITY_UNAVAILABLE", machine.events, runtimeDir);
        }
        durableState.stage = "implementing";
        durableState.implementation = undefined;
        durableState.evidence = undefined;
        durableState.verification = undefined;
        durableState.review = undefined;
        durableState.worker = undefined;
        durableState.reviewer = undefined;
        await checkpoint();
        const enteringFromReady = machine.state === "READY_TO_DELEGATE";
        await move(
          "IMPLEMENTING",
          enteringFromReady
            ? {
                implementationPacketComplete: isCompletePacket(packet),
                unresolvedOwnerConflict: false,
                adapterCapabilityAvailable: true,
                exactLaneKnown: Boolean(packet.routing.lane),
              }
            : {},
        );
      }

      if (machine.state !== "IMPLEMENTING" && machine.state !== "PARENT_VERIFYING" && machine.state !== "FRESH_REVIEWING" && machine.state !== "ACCEPTING" && machine.state !== "AUTHORITY_CONFLICT") {
        return blocked(runId, `UNSUPPORTED_RESUME_STATE:${machine.state}`, machine.events, runtimeDir);
      }

      if (machine.state === "IMPLEMENTING" && !durableState.implementation) {
        const operation = durable
          ? await durable.beginOperation({
              machine,
              kind: "spawn-implementer",
              idempotencyKey: `implementer:${durableState.fixCycles}:${digest(packet)}`,
              retryPolicy: "observe-before-retry",
              payload: { lane: packet.routing.lane, packetDigest: digest(packet) },
            })
          : undefined;
        const worker = await this.adapter.spawnImplementer({
          packet,
          ...(operation === undefined
            ? {}
            : { durable: { operationId: operation.operationId, idempotencyKey: operation.idempotencyKey } }),
        });
        const implementation = await this.adapter.readWorkerResult(worker);
        if (durable && operation) {
          await durable.completeOperation({ machine, operationId: operation.operationId, result: { worker, implementation } });
        }
        durableState.worker = worker;
        durableState.implementation = implementation;
        durableState.stage = "implementation-complete";
        await checkpoint();
      }

      if (machine.state === "IMPLEMENTING") {
        const implementation = durableState.implementation;
        if (!implementation) return blocked(runId, "IMPLEMENTATION_RESULT_MISSING", machine.events, runtimeDir);

        if (implementation.status === "blocked") {
          if (packet.routing.lane === "routine-implementer") {
            const promoted = await this.parent.reclassifyBlocked(packet, implementation);
            if (promoted) {
              const reason = promoted.routing.reclassificationReason?.trim();
              if (
                promoted.routing.lane !== "complex-implementer" ||
                promoted.routing.reclassifiedFrom !== "routine-implementer" ||
                !reason
              ) {
                throw new Error(
                  "Explicit routine->complex reclassification must set lane=complex-implementer, reclassifiedFrom=routine-implementer, and reclassificationReason",
                );
              }
              await move("BLOCKED");
              await mutateMachine(() => machine.recordLaneReclassified("routine-implementer", "complex-implementer", reason));
              packet = promoted;
              durableState.packet = promoted;
              durableState.stage = "planned";
              durableState.implementation = undefined;
              durableState.worker = undefined;
              await checkpoint();
              await move("READY_TO_DELEGATE");
              continue;
            }
          }
          await move("BLOCKED");
          return blocked(
            runId,
            implementation.authorityConcerns[0] ?? implementation.gaps[0] ?? "IMPLEMENTER_BLOCKED",
            machine.events,
            runtimeDir,
          );
        }

        await move("PARENT_VERIFYING", {
          implementationReportReturned: true,
          candidateObservable: true,
        });
      }

      if (machine.state === "PARENT_VERIFYING" && !durableState.verification) {
        const implementation = durableState.implementation;
        if (!implementation) return blocked(runId, "IMPLEMENTATION_RESULT_MISSING", machine.events, runtimeDir);
        let operationId: string | undefined;
        if (durable) {
          operationId = (
            await durable.beginOperation({
              machine,
              kind: "parent-verify",
              idempotencyKey: `verify:${durableState.fixCycles}:${digest(implementation)}`,
              retryPolicy: "idempotent",
              payload: { implementationDigest: digest(implementation) },
            })
          ).operationId;
        }
        const verification = await this.parent.verify(packet, implementation);
        if (durable && operationId) {
          await durable.completeOperation({ machine, operationId, result: { verification } });
        }
        durableState.verification = verification;
        durableState.evidence = verification.evidence;
        durableState.stage = "verified";
        await mutateMachine(() => machine.setCandidate(verification.candidateId));
      }

      if (machine.state === "PARENT_VERIFYING") {
        const verification = durableState.verification;
        if (!verification) return blocked(runId, "PARENT_VERIFICATION_RESULT_MISSING", machine.events, runtimeDir);
        if (machine.snapshot().candidateId !== verification.candidateId) {
          await mutateMachine(() => machine.setCandidate(verification.candidateId));
        }
        if (!verification.passed) {
          await move("BLOCKED");
          return blocked(runId, verification.blocker ?? "PARENT_VERIFICATION_FAILED", machine.events, runtimeDir);
        }
        const freshCaps = await this.adapter.capabilities();
        if (!freshCaps.freshContext) {
          await move("BLOCKED");
          return blocked(runId, "REVIEW_CAPABILITY_UNAVAILABLE", machine.events, runtimeDir);
        }
        durableState.stage = "reviewing";
        await checkpoint();
        await move("FRESH_REVIEWING", {
          parentInspectedCandidate: true,
          verificationEvidenceAvailable: true,
          unresolvedParentBlocker: false,
        });
      }

      if (machine.state === "FRESH_REVIEWING" && !durableState.review) {
        const verification = durableState.verification;
        if (!verification) return blocked(runId, "PARENT_VERIFICATION_RESULT_MISSING", machine.events, runtimeDir);
        const operation = durable
          ? await durable.beginOperation({
              machine,
              kind: "spawn-reviewer",
              idempotencyKey: `review:${durableState.fixCycles}:${verification.candidateId}`,
              retryPolicy: "observe-before-retry",
              payload: { candidateId: verification.candidateId },
            })
          : undefined;
        const reviewer = await this.adapter.spawnFreshReviewer({
          candidateId: verification.candidateId,
          objective: packet.objective.outcome,
          interfaces: packet.interfaces,
          constraints: packet.constraints,
          allowedPaths: packet.ownership.allowedPaths,
          evidence: verification.evidence,
          ...(operation === undefined
            ? {}
            : { durable: { operationId: operation.operationId, idempotencyKey: operation.idempotencyKey } }),
        });
        const review = await this.adapter.readReviewerResult(reviewer);
        if (durable && operation) {
          await durable.completeOperation({ machine, operationId: operation.operationId, result: { reviewer, review } });
        }
        durableState.reviewer = reviewer;
        durableState.review = review;
        durableState.stage = "review-complete";
        await checkpoint();
      }

      if (machine.state === "FRESH_REVIEWING") {
        const verification = durableState.verification;
        const review = durableState.review;
        if (!verification || !review) return blocked(runId, "REVIEW_RESULT_MISSING", machine.events, runtimeDir);
        const postReviewCandidateId = await this.parent.observeCandidateId();
        if (postReviewCandidateId !== verification.candidateId) {
          await mutateMachine(() => machine.setCandidate(postReviewCandidateId));
          await move("BLOCKED");
          return blocked(runId, "REVIEWER_MUTATED_CANDIDATE", machine.events, runtimeDir);
        }

        if (review.verdict === "PASS") {
          if (machine.snapshot().freshPassCandidateId !== review.candidateId) {
            await mutateMachine(() => machine.applyReview(review));
          }
          durableState.stage = "accepting";
          await checkpoint();
          await move("ACCEPTING");
        } else {
          await mutateMachine(() => machine.applyReview(review));
          if (review.verdict === "FIX") continue;
          const escalation = await this.parent.escalateReview(packet, review);
          await mutateMachine(() => machine.markEscalationPending(true));
          await move("USER_DECISION_PENDING");
          return {
            status: "user-decision-pending",
            runId,
            escalation,
            events: machine.events,
            ...(runtimeDir === undefined ? {} : { runtimeDir }),
          };
        }
      }

      if (machine.state === "AUTHORITY_CONFLICT") {
        const review = durableState.review;
        if (!review || review.verdict !== "ESCALATE") {
          return blocked(runId, "AUTHORITY_CONFLICT_REVIEW_MISSING", machine.events, runtimeDir);
        }
        const escalation = await this.parent.escalateReview(packet, review);
        if (!machine.snapshot().pendingEscalation) {
          await mutateMachine(() => machine.markEscalationPending(true));
        }
        await move("USER_DECISION_PENDING");
        return {
          status: "user-decision-pending",
          runId,
          escalation,
          events: machine.events,
          ...(runtimeDir === undefined ? {} : { runtimeDir }),
        };
      }

      if (machine.state === "ACCEPTING") {
        const implementation = durableState.implementation;
        const verification = durableState.verification;
        const review = durableState.review;
        if (!implementation || !verification || !review) {
          return blocked(runId, "ACCEPTANCE_STATE_INCOMPLETE", machine.events, runtimeDir);
        }

        let artifactDir = durableState.artifactDir;
        if (this.options.persistArtifacts !== false && !artifactDir) {
          let operationId: string | undefined;
          if (durable) {
            operationId = (
              await durable.beginOperation({
                machine,
                kind: "persist-artifacts",
                idempotencyKey: `artifacts:${runId}:${verification.candidateId}`,
                retryPolicy: "observe-before-retry",
                payload: { candidateId: verification.candidateId },
              })
            ).operationId;
          }
          artifactDir = await persistRunArtifacts(
            runId,
            {
              run: {
                schemaVersion: 1,
                status: "completed",
                candidateId: verification.candidateId,
              },
              events: machine.events,
              evidence: verification.evidence,
              review,
            },
            this.options.artifactRoot,
          );
          if (durable && operationId) {
            await durable.completeOperation({ machine, operationId, result: { artifactDir } });
          }
          durableState.artifactDir = artifactDir;
          await checkpoint();
        }

        await move("COMPLETED", { evidenceRetained: true, postReviewMutation: false });
        return {
          status: "completed",
          runId,
          candidateId: verification.candidateId,
          implementation,
          review,
          evidence: verification.evidence,
          events: machine.events,
          ...(artifactDir === undefined ? {} : { artifactDir }),
          ...(runtimeDir === undefined ? {} : { runtimeDir }),
        };
      }
    }
  }
}

function blocked(
  runId: string,
  reason: string,
  events: readonly RunEvent[],
  runtimeDir?: string,
): Extract<OrchestrationResult, { status: "blocked" }> {
  return {
    status: "blocked",
    runId,
    reason,
    events,
    ...(runtimeDir === undefined ? {} : { runtimeDir }),
  };
}

function isCompletePacket(packet: ImplementationPacket): boolean {
  return Boolean(
    packet.routing?.lane &&
      packet.routing.reason.trim() &&
      packet.objective?.outcome.trim() &&
      packet.ownership?.allowedPaths.length > 0 &&
      packet.verification?.length > 0 &&
      packet.returnContract?.trim(),
  );
}

function digest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function cloneDurableState(state: DurableEngineState): DurableEngineState {
  return structuredClone(state);
}

function hydrateOperationsAfterSnapshot(
  state: DurableEngineState,
  operations: readonly DurableOperationRecord[],
  snapshotSequence: number,
): void {
  for (const record of operations) {
    if (!record.completed || record.terminalSequence === undefined || record.terminalSequence <= snapshotSequence) continue;
    const result = asRecord(record.completionResult);
    if (!result) continue;
    if (record.intent.kind === "spawn-implementer") {
      const implementation = result.implementation as ImplementationReport | undefined;
      const worker = result.worker as DurableEngineState["worker"];
      if (implementation && worker) {
        state.implementation = implementation;
        state.worker = worker;
        state.stage = "implementation-complete";
      }
    } else if (record.intent.kind === "parent-verify") {
      const verification = result.verification as DurableEngineState["verification"];
      if (verification) {
        state.verification = verification;
        state.evidence = verification.evidence;
        state.stage = "verified";
      }
    } else if (record.intent.kind === "spawn-reviewer") {
      const review = result.review as ReviewResult | undefined;
      const reviewer = result.reviewer as DurableEngineState["reviewer"];
      if (review && reviewer) {
        state.review = review;
        state.reviewer = reviewer;
        state.stage = "review-complete";
      }
    } else if (record.intent.kind === "persist-artifacts") {
      const artifactDir = result.artifactDir;
      if (typeof artifactDir === "string") {
        state.artifactDir = artifactDir;
        state.stage = "accepting";
      }
    }
  }
}

function normalizeStageForMachine(state: DurableEngineState, machine: RunStateMachine): void {
  if (machine.state === "READY_TO_DELEGATE") state.stage = "planned";
  else if (machine.state === "IMPLEMENTING") {
    state.stage = state.implementation ? "implementation-complete" : "implementing";
  } else if (machine.state === "PARENT_VERIFYING") {
    state.stage = state.verification ? "verified" : "implementation-complete";
  } else if (machine.state === "FRESH_REVIEWING") {
    state.stage = state.review ? "review-complete" : "reviewing";
  } else if (machine.state === "ACCEPTING" || machine.state === "COMPLETED") {
    state.stage = "accepting";
  }
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : undefined;
}

async function observePersistedArtifacts(
  runId: string,
  root?: string,
): Promise<DurableOperationProbeResult> {
  const artifactDir = resolve(root ?? defaultRunRoot(), runId);
  try {
    const [runText, evidenceText, eventsText, reviewText] = await Promise.all([
      readFile(resolve(artifactDir, "run.json"), "utf8"),
      readFile(resolve(artifactDir, "evidence.json"), "utf8"),
      readFile(resolve(artifactDir, "events.jsonl"), "utf8"),
      readFile(resolve(artifactDir, "review.json"), "utf8"),
    ]);
    const run = JSON.parse(runText) as { schemaVersion?: unknown; status?: unknown; candidateId?: unknown };
    JSON.parse(evidenceText);
    JSON.parse(reviewText);
    for (const line of eventsText.split(/\r?\n/u).filter(Boolean)) JSON.parse(line);
    if (run.schemaVersion !== 1 || run.status !== "completed" || typeof run.candidateId !== "string") {
      return { outcome: "unknown", detail: `Existing run artifacts for ${runId} are incomplete or invalid` };
    }
    return {
      outcome: "completed",
      detail: `Observed complete immutable run-artifact bundle for ${runId}`,
      result: { artifactDir },
    };
  } catch (error) {
    if (isErrorCode(error, "ENOENT")) {
      try {
        await stat(artifactDir);
      } catch (inner) {
        if (isErrorCode(inner, "ENOENT")) {
          return {
            outcome: "not-found",
            detail: `No run-artifact directory exists for ${runId}`,
          };
        }
      }
    }
    return {
      outcome: "unknown",
      detail: `Run-artifact bundle for ${runId} cannot be validated: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

function isErrorCode(error: unknown, code: string): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as { code?: unknown }).code === code;
}
