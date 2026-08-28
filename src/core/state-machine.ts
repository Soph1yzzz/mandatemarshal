import type { ReviewResult, RunEvent, RunState } from "./types";

export class InvalidTransitionError extends Error {
  constructor(
    readonly from: RunState,
    readonly to: RunState,
    message?: string,
  ) {
    super(message ?? `Invalid transition: ${from} -> ${to}`);
    this.name = "InvalidTransitionError";
  }
}

const ALLOWED: Record<RunState, ReadonlySet<RunState>> = {
  IDLE: new Set(["INTAKE", "ABORTED"]),
  INTAKE: new Set(["CONTRACT_CHECK", "ABORTED"]),
  CONTRACT_CHECK: new Set(["PLANNING", "AUTHORITY_CONFLICT", "ABORTED"]),
  PLANNING: new Set(["READY_TO_DELEGATE", "AUTHORITY_CONFLICT", "BLOCKED", "ABORTED"]),
  READY_TO_DELEGATE: new Set(["IMPLEMENTING", "AUTHORITY_CONFLICT", "BLOCKED", "ABORTED"]),
  IMPLEMENTING: new Set(["PARENT_VERIFYING", "AUTHORITY_CONFLICT", "BLOCKED", "ABORTED"]),
  PARENT_VERIFYING: new Set(["FRESH_REVIEWING", "AUTHORITY_CONFLICT", "BLOCKED", "ABORTED"]),
  FRESH_REVIEWING: new Set(["ACCEPTING", "CORRECTION_REQUIRED", "AUTHORITY_CONFLICT", "BLOCKED", "ABORTED"]),
  CORRECTION_REQUIRED: new Set(["IMPLEMENTING", "BLOCKED", "ABORTED"]),
  AUTHORITY_CONFLICT: new Set(["PLANNING", "USER_DECISION_PENDING", "BLOCKED", "ABORTED"]),
  USER_DECISION_PENDING: new Set(["PLANNING", "ABORTED"]),
  ACCEPTING: new Set(["COMPLETED", "BLOCKED", "ABORTED"]),
  COMPLETED: new Set(),
  BLOCKED: new Set(["PLANNING", "READY_TO_DELEGATE", "PARENT_VERIFYING", "ABORTED"]),
  ABORTED: new Set(),
};

export interface TransitionContext {
  implementationPacketComplete?: boolean;
  unresolvedOwnerConflict?: boolean;
  adapterCapabilityAvailable?: boolean;
  exactLaneKnown?: boolean;
  implementationReportReturned?: boolean;
  candidateObservable?: boolean;
  parentInspectedCandidate?: boolean;
  verificationEvidenceAvailable?: boolean;
  unresolvedParentBlocker?: boolean;
  evidenceRetained?: boolean;
  postReviewMutation?: boolean;
}

export class RunStateMachine {
  private _state: RunState = "IDLE";
  private _candidateId: string | undefined;
  private _freshPassCandidateId: string | undefined;
  private _pendingEscalation = false;
  private readonly _events: RunEvent[] = [];

  constructor(readonly runId: string) {}

  get state(): RunState {
    return this._state;
  }

  get candidateId(): string | undefined {
    return this._candidateId;
  }

  get events(): readonly RunEvent[] {
    return this._events;
  }

  setCandidate(candidateId: string): void {
    if (!candidateId) throw new Error("candidateId must be non-empty");
    if (this._candidateId !== candidateId) {
      this._candidateId = candidateId;
      this._freshPassCandidateId = undefined;
      this.record("CandidateChanged", { candidateId });
    }
  }

  markEscalationPending(pending: boolean): void {
    this._pendingEscalation = pending;
    this.record(pending ? "EscalationPending" : "EscalationResolved");
  }

  recordLaneReclassified(
    from: "routine-implementer" | "complex-implementer",
    to: "routine-implementer" | "complex-implementer",
    reason: string,
  ): void {
    if (from === to) throw new Error("Lane reclassification must change the semantic lane");
    if (!reason.trim()) throw new Error("Lane reclassification requires an explicit reason");
    this.record("LaneReclassified", { from, to, reason });
  }

  applyReview(result: ReviewResult): void {
    if (this._state !== "FRESH_REVIEWING") {
      throw new InvalidTransitionError(this._state, this._state, "Review result may only be applied in FRESH_REVIEWING");
    }
    if (!this._candidateId || result.candidateId !== this._candidateId) {
      throw new Error(`Stale or mismatched review candidate: expected ${this._candidateId ?? "none"}, got ${result.candidateId}`);
    }

    if (result.verdict === "PASS") {
      this._freshPassCandidateId = result.candidateId;
      this.record("ReviewPassed", { candidateId: result.candidateId });
      return;
    }

    this._freshPassCandidateId = undefined;
    if (result.verdict === "FIX") {
      this.record("ReviewFixRequired", { candidateId: result.candidateId, findings: result.findings });
      this.transition("CORRECTION_REQUIRED");
      return;
    }

    this._pendingEscalation = true;
    this.record("ReviewEscalated", { candidateId: result.candidateId, findings: result.findings });
    this.transition("AUTHORITY_CONFLICT");
  }

  transition(to: RunState, ctx: TransitionContext = {}): void {
    const from = this._state;
    if (!ALLOWED[from].has(to)) throw new InvalidTransitionError(from, to);

    if (from === "READY_TO_DELEGATE" && to === "IMPLEMENTING") {
      if (!ctx.implementationPacketComplete) throw new InvalidTransitionError(from, to, "Implementation packet is incomplete");
      if (ctx.unresolvedOwnerConflict) throw new InvalidTransitionError(from, to, "Owner conflict is unresolved");
      if (!ctx.adapterCapabilityAvailable) throw new InvalidTransitionError(from, to, "Adapter capability is unavailable");
      if (!ctx.exactLaneKnown) throw new InvalidTransitionError(from, to, "Exact semantic lane mapping is unknown");
    }

    if (from === "IMPLEMENTING" && to === "PARENT_VERIFYING") {
      if (!ctx.implementationReportReturned) throw new InvalidTransitionError(from, to, "Implementation report is missing");
      if (!ctx.candidateObservable) throw new InvalidTransitionError(from, to, "Candidate state is not observable");
    }

    if (from === "PARENT_VERIFYING" && to === "FRESH_REVIEWING") {
      if (!ctx.parentInspectedCandidate) throw new InvalidTransitionError(from, to, "Parent has not inspected the candidate");
      if (!ctx.verificationEvidenceAvailable) throw new InvalidTransitionError(from, to, "Verification evidence is unavailable");
      if (ctx.unresolvedParentBlocker) throw new InvalidTransitionError(from, to, "Parent blocker remains unresolved");
      if (!this._candidateId) throw new InvalidTransitionError(from, to, "Candidate identity is missing");
    }

    if (from === "FRESH_REVIEWING" && to === "ACCEPTING") {
      if (!this._candidateId || this._freshPassCandidateId !== this._candidateId) {
        throw new InvalidTransitionError(from, to, "Current candidate has no fresh PASS");
      }
      if (this._pendingEscalation) throw new InvalidTransitionError(from, to, "Escalation remains pending");
    }

    if (from === "ACCEPTING" && to === "COMPLETED") {
      if (!ctx.evidenceRetained) throw new InvalidTransitionError(from, to, "Required evidence has not been retained");
      if (ctx.postReviewMutation) throw new InvalidTransitionError(from, to, "Candidate mutated after fresh review");
      if (!this._candidateId || this._freshPassCandidateId !== this._candidateId) {
        throw new InvalidTransitionError(from, to, "Fresh PASS is stale or absent");
      }
      if (this._pendingEscalation) throw new InvalidTransitionError(from, to, "Escalation remains pending");
    }

    this._state = to;
    this.record("StateTransition", { from, to });
  }

  private record(type: string, payload?: unknown): void {
    const event: RunEvent = {
      schemaVersion: 1,
      type,
      at: new Date().toISOString(),
      runId: this.runId,
      state: this._state,
      ...(payload === undefined ? {} : { payload }),
    };
    this._events.push(event);
  }
}
