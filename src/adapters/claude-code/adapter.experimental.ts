import type {
  CorrectionPacket,
  HostAdapter,
  HostCapabilities,
  ImplementationReport,
  ImplementerSpawnRequest,
  ReviewerHandle,
  ReviewerSpawnRequest,
  ReviewResult,
  WorkerHandle,
} from "../../core/types";

/**
 * Provider-neutral seam proof for v0.1. A production Claude Code transport is v0.2 scope.
 * The bridge deliberately speaks semantic MandateMarshal contracts only.
 */
export interface ClaudeCodeBridge {
  capabilities(): Promise<HostCapabilities>;
  implement(input: ImplementerSpawnRequest): Promise<{ handle: WorkerHandle; report: ImplementationReport }>;
  correct(handle: WorkerHandle, packet: CorrectionPacket): Promise<void>;
  review(input: ReviewerSpawnRequest): Promise<{ handle: ReviewerHandle; result: ReviewResult }>;
}

export class ClaudeCodeExperimentalAdapter implements HostAdapter {
  readonly id = "claude-code-experimental";
  private readonly workers = new Map<string, ImplementationReport>();
  private readonly reviewers = new Map<string, ReviewResult>();

  constructor(private readonly bridge: ClaudeCodeBridge) {}

  capabilities(): Promise<HostCapabilities> {
    return this.bridge.capabilities();
  }

  async spawnImplementer(input: ImplementerSpawnRequest): Promise<WorkerHandle> {
    const { handle, report } = await this.bridge.implement(input);
    this.workers.set(handle.id, report);
    return handle;
  }

  async readWorkerResult(handle: WorkerHandle): Promise<ImplementationReport> {
    const report = this.workers.get(handle.id);
    if (!report) throw new Error(`Unknown Claude Code worker: ${handle.id}`);
    return report;
  }

  sendCorrection(handle: WorkerHandle, packet: CorrectionPacket): Promise<void> {
    return this.bridge.correct(handle, packet);
  }

  async spawnFreshReviewer(input: ReviewerSpawnRequest): Promise<ReviewerHandle> {
    const caps = await this.capabilities();
    if (!caps.freshContext) throw new Error("REVIEW_CAPABILITY_UNAVAILABLE");
    const { handle, result } = await this.bridge.review(input);
    if (result.candidateId !== input.candidateId) throw new Error("REVIEW_CANDIDATE_MISMATCH");
    this.reviewers.set(handle.id, result);
    return handle;
  }

  async readReviewerResult(handle: ReviewerHandle): Promise<ReviewResult> {
    const result = this.reviewers.get(handle.id);
    if (!result) throw new Error(`Unknown Claude Code reviewer: ${handle.id}`);
    return result;
  }
}
