import type {
  CorrectionPacket,
  DurableOperationProbe,
  DurableOperationProbeResult,
  HostAdapter,
  HostCapabilities,
  ImplementationReport,
  ImplementerSpawnRequest,
  ReviewerHandle,
  ReviewerSpawnRequest,
  ReviewResult,
  AgentRoutingEvidence,
  WorkerHandle,
} from "../../core/types";
import {
  DEFAULT_CODEX_ROLE_MAPPING,
  freshReviewerRoleForProfile,
  implementationRoleForLane,
  type CodexFreshReviewerProfileId,
  type CodexNativeRoleConfig,
  type CodexRoleMapping,
} from "./role-mapping";

export class CodexCapabilityError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "CodexCapabilityError";
  }
}

export interface CodexDriverRun<T> {
  id: string;
  result: T;
  observedModel?: string;
  observedEffort?: string;
}

export interface CodexDriver {
  capabilities(): Promise<HostCapabilities>;
  runImplementer(input: {
    role: CodexNativeRoleConfig;
    request: ImplementerSpawnRequest;
  }): Promise<CodexDriverRun<ImplementationReport>>;
  runReviewer(input: {
    role: CodexNativeRoleConfig;
    request: ReviewerSpawnRequest;
    readOnly: true;
    fresh: true;
  }): Promise<CodexDriverRun<ReviewResult>>;
  runCorrection?(input: {
    previousId: string;
    role: CodexNativeRoleConfig;
    correction: CorrectionPacket;
  }): Promise<CodexDriverRun<ImplementationReport>>;
  observeDurableOperation?(operation: DurableOperationProbe): Promise<DurableOperationProbeResult>;
}

export interface CodexAdapterConfig {
  freshReviewerProfile?: CodexFreshReviewerProfileId;
  roles?: Partial<{
    routineImplementer: CodexNativeRoleConfig;
    complexImplementer: CodexNativeRoleConfig;
    freshReviewer: CodexNativeRoleConfig;
  }>;
}

function mappingFromConfig(config: CodexAdapterConfig): CodexRoleMapping {
  if (config.freshReviewerProfile && config.roles?.freshReviewer) {
    throw new CodexCapabilityError(
      "AMBIGUOUS_REVIEWER_MAPPING",
      "Configure either freshReviewerProfile or roles.freshReviewer, not both",
    );
  }
  return {
    ...DEFAULT_CODEX_ROLE_MAPPING,
    routineImplementer: config.roles?.routineImplementer ?? DEFAULT_CODEX_ROLE_MAPPING.routineImplementer,
    complexImplementer: config.roles?.complexImplementer ?? DEFAULT_CODEX_ROLE_MAPPING.complexImplementer,
    freshReviewer:
      config.roles?.freshReviewer ??
      (config.freshReviewerProfile ? freshReviewerRoleForProfile(config.freshReviewerProfile) : DEFAULT_CODEX_ROLE_MAPPING.freshReviewer),
  };
}

export class CodexAdapter implements HostAdapter {
  readonly id = "codex";
  private readonly mapping: CodexRoleMapping;
  private readonly workerRuns = new Map<string, CodexDriverRun<ImplementationReport>>();
  private readonly reviewerRuns = new Map<string, CodexDriverRun<ReviewResult>>();

  constructor(
    private readonly driver: CodexDriver,
    config: CodexAdapterConfig = {},
  ) {
    this.mapping = mappingFromConfig(config);
  }

  capabilities(): Promise<HostCapabilities> {
    return this.driver.capabilities();
  }

  async spawnImplementer(input: ImplementerSpawnRequest): Promise<WorkerHandle> {
    const caps = await this.capabilities();
    this.assertExactRoutingCapability(caps);
    const role = implementationRoleForLane(this.mapping, input.packet.routing.lane);
    if (!role.model || !role.effort) {
      throw new CodexCapabilityError("INVALID_ROLE_MAPPING", `Incomplete mapping for ${input.packet.routing.lane}`);
    }

    // The packet's semantic lane is authoritative. Driver failure is surfaced; no fallback occurs here.
    const run = await this.driver.runImplementer({ role, request: input });
    this.workerRuns.set(run.id, run);
    return {
      id: run.id,
      role: input.packet.routing.lane,
      ...(run.result.candidateId === undefined ? {} : { candidateId: run.result.candidateId }),
    };
  }

  async readWorkerResult(handle: WorkerHandle): Promise<ImplementationReport> {
    const run = this.workerRuns.get(handle.id);
    if (!run) throw new CodexCapabilityError("UNKNOWN_WORKER", `Unknown worker handle: ${handle.id}`);
    return run.result;
  }

  async sendCorrection(handle: WorkerHandle, packet: CorrectionPacket): Promise<void> {
    if (!this.driver.runCorrection) {
      throw new CodexCapabilityError(
        "PERSISTENT_CORRECTION_UNAVAILABLE",
        "The active Codex driver cannot correct the prior child context; no silent replacement worker was launched.",
      );
    }
    const role = implementationRoleForLane(this.mapping, handle.role);
    const run = await this.driver.runCorrection({ previousId: handle.id, role, correction: packet });
    this.workerRuns.set(run.id, run);
  }

  async spawnFreshReviewer(input: ReviewerSpawnRequest): Promise<ReviewerHandle> {
    const caps = await this.capabilities();
    if (!caps.freshContext) {
      throw new CodexCapabilityError("REVIEW_CAPABILITY_UNAVAILABLE", "Fresh reviewer context is unavailable");
    }
    this.assertExactRoutingCapability(caps);
    const run = await this.driver.runReviewer({
      role: this.mapping.freshReviewer,
      request: input,
      readOnly: true,
      fresh: true,
    });
    if (run.result.candidateId !== input.candidateId) {
      throw new CodexCapabilityError(
        "REVIEW_CANDIDATE_MISMATCH",
        `Reviewer returned ${run.result.candidateId}, expected ${input.candidateId}`,
      );
    }
    this.reviewerRuns.set(run.id, run);
    return { id: run.id, role: "fresh-reviewer", candidateId: input.candidateId };
  }

  async readReviewerResult(handle: ReviewerHandle): Promise<ReviewResult> {
    const run = this.reviewerRuns.get(handle.id);
    if (!run) throw new CodexCapabilityError("UNKNOWN_REVIEWER", `Unknown reviewer handle: ${handle.id}`);
    return run.result;
  }

  async observeIsolation(handle: WorkerHandle | ReviewerHandle): Promise<{
    requestedReadOnly: boolean;
    observedReadOnly: boolean;
    trust: "OBSERVED" | "REPORTED" | "INFERRED" | "UNAVAILABLE";
  }> {
    const caps = await this.capabilities();
    const reviewer = handle.role === "fresh-reviewer";
    return {
      requestedReadOnly: reviewer && caps.requestedReadOnly,
      observedReadOnly: reviewer && caps.observedReadOnly,
      trust: caps.observedReadOnly ? "OBSERVED" : caps.requestedReadOnly ? "REPORTED" : "UNAVAILABLE",
    };
  }

  async observeDurableOperation(operation: DurableOperationProbe): Promise<DurableOperationProbeResult> {
    if (!this.driver.observeDurableOperation) {
      return { outcome: "unknown", detail: "Active Codex driver does not expose durable operation observation" };
    }
    return this.driver.observeDurableOperation(operation);
  }

  async observeRouting(handle: WorkerHandle | ReviewerHandle): Promise<AgentRoutingEvidence> {
    if (handle.role === "fresh-reviewer") {
      const run = this.reviewerRuns.get(handle.id);
      if (!run) throw new CodexCapabilityError("UNKNOWN_REVIEWER", `Unknown reviewer handle: ${handle.id}`);
      return {
        role: "fresh-reviewer",
        reason: "Codex adapter fresh-reviewer mapping",
        requestedModel: this.mapping.freshReviewer.model,
        requestedEffort: this.mapping.freshReviewer.effort,
        ...(run.observedModel === undefined ? {} : { observedModel: run.observedModel }),
        ...(run.observedEffort === undefined ? {} : { observedEffort: run.observedEffort }),
      };
    }

    const run = this.workerRuns.get(handle.id);
    if (!run) throw new CodexCapabilityError("UNKNOWN_WORKER", `Unknown worker handle: ${handle.id}`);
    const role = implementationRoleForLane(this.mapping, handle.role);
    return {
      role: handle.role,
      lane: handle.role,
      reason: "Codex adapter semantic role mapping",
      requestedModel: role.model,
      requestedEffort: role.effort,
      ...(run.observedModel === undefined ? {} : { observedModel: run.observedModel }),
      ...(run.observedEffort === undefined ? {} : { observedEffort: run.observedEffort }),
    };
  }

  private assertExactRoutingCapability(caps: HostCapabilities): void {
    if (!caps.exactModelSelection) {
      throw new CodexCapabilityError("EXACT_MODEL_SELECTION_UNAVAILABLE", "Exact configured model selection is unavailable");
    }
    if (!caps.reasoningSelection) {
      throw new CodexCapabilityError("EXACT_EFFORT_SELECTION_UNAVAILABLE", "Exact configured reasoning effort selection is unavailable");
    }
  }
}
