import { randomUUID } from "node:crypto";
import { RunStateMachine } from "../core/state-machine";
import type {
  EscalationPacket,
  ExecutionEvidence,
  HostAdapter,
  ImplementationPacket,
  ImplementationReport,
  ReviewResult,
  RunEvent,
} from "../core/types";
import { persistRunArtifacts } from "../runtime/evidence-store";

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
    }
  | {
      status: "blocked";
      runId: string;
      reason: string;
      events: readonly RunEvent[];
    }
  | {
      status: "user-decision-pending";
      runId: string;
      escalation: EscalationPacket;
      events: readonly RunEvent[];
    };

export interface OrchestratorOptions {
  runId?: string;
  maxFixCycles?: number;
  persistArtifacts?: boolean;
  artifactRoot?: string;
}

export class OrchestrationEngine<Request = unknown> {
  constructor(
    private readonly adapter: HostAdapter,
    private readonly parent: ParentController<Request>,
    private readonly options: OrchestratorOptions = {},
  ) {}

  async run(request: Request): Promise<OrchestrationResult> {
    const runId = this.options.runId ?? randomUUID();
    const machine = new RunStateMachine(runId);
    machine.transition("INTAKE");
    machine.transition("CONTRACT_CHECK");
    machine.transition("PLANNING");

    const plan = await this.parent.plan(request);
    if (plan.kind === "escalate") {
      machine.transition("AUTHORITY_CONFLICT");
      machine.markEscalationPending(true);
      machine.transition("USER_DECISION_PENDING");
      return { status: "user-decision-pending", runId, escalation: plan.escalation, events: machine.events };
    }

    let packet = plan.packet;
    machine.transition("READY_TO_DELEGATE");
    const caps = await this.adapter.capabilities();
    const capabilityAvailable = caps.subagents && caps.exactModelSelection && caps.reasoningSelection;
    if (!capabilityAvailable) {
      machine.transition("BLOCKED");
      return {
        status: "blocked",
        runId,
        reason: "IMPLEMENTER_CAPABILITY_UNAVAILABLE",
        events: machine.events,
      };
    }

    let fixCycles = 0;
    const maxFixCycles = this.options.maxFixCycles ?? 5;
    let lastImplementation: ImplementationReport | undefined;
    let lastEvidence: ExecutionEvidence | undefined;

    while (true) {
      if (machine.state === "READY_TO_DELEGATE") {
        machine.transition("IMPLEMENTING", {
          implementationPacketComplete: isCompletePacket(packet),
          unresolvedOwnerConflict: false,
          adapterCapabilityAvailable: true,
          exactLaneKnown: Boolean(packet.routing.lane),
        });
      } else if (machine.state === "CORRECTION_REQUIRED") {
        machine.transition("IMPLEMENTING");
      }

      const worker = await this.adapter.spawnImplementer({ packet });
      const implementation = await this.adapter.readWorkerResult(worker);
      lastImplementation = implementation;

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
            machine.transition("BLOCKED");
            machine.recordLaneReclassified("routine-implementer", "complex-implementer", reason);
            packet = promoted;
            machine.transition("READY_TO_DELEGATE");
            continue;
          }
        }

        machine.transition("BLOCKED");
        return {
          status: "blocked",
          runId,
          reason: implementation.authorityConcerns[0] ?? implementation.gaps[0] ?? "IMPLEMENTER_BLOCKED",
          events: machine.events,
        };
      }

      machine.transition("PARENT_VERIFYING", {
        implementationReportReturned: true,
        candidateObservable: true,
      });

      const verification = await this.parent.verify(packet, implementation);
      lastEvidence = verification.evidence;
      machine.setCandidate(verification.candidateId);
      if (!verification.passed) {
        machine.transition("BLOCKED");
        return {
          status: "blocked",
          runId,
          reason: verification.blocker ?? "PARENT_VERIFICATION_FAILED",
          events: machine.events,
        };
      }

      const freshCaps = await this.adapter.capabilities();
      if (!freshCaps.freshContext) {
        machine.transition("BLOCKED");
        return {
          status: "blocked",
          runId,
          reason: "REVIEW_CAPABILITY_UNAVAILABLE",
          events: machine.events,
        };
      }

      machine.transition("FRESH_REVIEWING", {
        parentInspectedCandidate: true,
        verificationEvidenceAvailable: true,
        unresolvedParentBlocker: false,
      });

      const reviewer = await this.adapter.spawnFreshReviewer({
        candidateId: verification.candidateId,
        objective: packet.objective.outcome,
        interfaces: packet.interfaces,
        constraints: packet.constraints,
        allowedPaths: packet.ownership.allowedPaths,
        evidence: verification.evidence,
      });
      const review = await this.adapter.readReviewerResult(reviewer);
      const postReviewCandidateId = await this.parent.observeCandidateId();
      if (postReviewCandidateId !== verification.candidateId) {
        machine.setCandidate(postReviewCandidateId);
        machine.transition("BLOCKED");
        return {
          status: "blocked",
          runId,
          reason: "REVIEWER_MUTATED_CANDIDATE",
          events: machine.events,
        };
      }
      machine.applyReview(review);

      if (review.verdict === "FIX") {
        fixCycles += 1;
        if (fixCycles > maxFixCycles) {
          machine.transition("BLOCKED");
          return {
            status: "blocked",
            runId,
            reason: "MAX_FIX_CYCLES_EXCEEDED",
            events: machine.events,
          };
        }
        packet = await this.parent.correction(packet, review);
        continue;
      }

      if (review.verdict === "ESCALATE") {
        const escalation = await this.parent.escalateReview(packet, review);
        machine.markEscalationPending(true);
        machine.transition("USER_DECISION_PENDING");
        return {
          status: "user-decision-pending",
          runId,
          escalation,
          events: machine.events,
        };
      }

      machine.transition("ACCEPTING");
      let artifactDir: string | undefined;
      if (this.options.persistArtifacts !== false) {
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
      }
      machine.transition("COMPLETED", { evidenceRetained: true, postReviewMutation: false });
      return {
        status: "completed",
        runId,
        candidateId: verification.candidateId,
        implementation,
        review,
        evidence: verification.evidence,
        events: machine.events,
        ...(artifactDir === undefined ? {} : { artifactDir }),
      };
    }
  }
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
